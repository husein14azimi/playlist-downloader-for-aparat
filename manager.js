import { getJSON, delay } from './api.js';
import { cleanName, numLabel, parsePlaylist, parsePlaylistId, pickLink } from './lib.js';

export const QUEUE_ALARM = 'download-queue';
const KEY = 'downloadQueue';
const busy = (row) => row.downloadId != null || ['queued', 'getting', 'starting', 'retry'].includes(row.status);
export const isBusy = (state) => state.rows.some(busy);

export function videoOptions(video) {
  const options = [];
  for (const entry of Array.isArray(video?.file_link_all) ? video.file_link_all : []) {
    const link = pickLink([entry], Infinity);
    if (link && !options.some((option) => option.height === link.h)) {
      options.push({ height: link.h, profile: link.profile, size: typeof entry.size === 'string' ? entry.size : '' });
    }
  }
  return options.sort((a, b) => b.height - a.height);
}

// Queue ownership is independent of popup documents. Events and alarms wake suspended workers.
export class DownloadManager {
  constructor(api, { request = getJSON, now = Date.now, metadataDelay = 200 } = {}) {
    this.api = api; this.request = request; this.now = now; this.metadataDelay = metadataDelay;
    this.state = { schema: 1, playlistId: null, playlist: null, playlistQuality: 1080, rows: [], loading: false, error: '' };
    this.controllers = new Map(); this.writes = Promise.resolve(); this.requests = Promise.resolve();
    this.ready = this.initialize();
  }
  async initialize() {
    const saved = (await this.api.storage.local.get(KEY))[KEY];
    if (saved?.schema === 1 && Array.isArray(saved.rows)) this.state = saved;
    this.state.loading = false;
    for (const row of this.state.rows) {
      if (row.details === 'loading') row.details = 'pending';
      if (row.status === 'getting') row.status = row.stopRequested ? 'stopped' : 'queued';
      // Never blindly repeat a download whose creation was interrupted by a forced restart.
      if (row.status === 'starting' && row.downloadId == null) {
        row.status = 'error'; row.error = 'Download startup was interrupted. Check browser downloads before retrying.';
      }
    }
    await this.refresh(); await this.persist(); this.kick();
  }
  persist() {
    const snapshot = structuredClone(this.state);
    this.writes = this.writes.catch(() => {}).then(async () => {
      await this.api.storage.local.set({ [KEY]: snapshot });
      const needsAlarm = isBusy(snapshot) || snapshot.rows.some((row) => ['pending', 'loading'].includes(row.details));
      if (needsAlarm && !this.alarmArmed) {
        await this.api.alarms.create(QUEUE_ALARM, { periodInMinutes: 0.5 }); this.alarmArmed = true;
      } else if (!needsAlarm && this.alarmArmed) {
        await this.api.alarms.clear(QUEUE_ALARM); this.alarmArmed = false;
      }
    });
    return this.writes;
  }
  fetchVideo(row, signal) {
    const run = () => {
      signal?.throwIfAborted();
      return this.request(`/etc/api/video/videohash/${encodeURIComponent(row.uid)}`, { signal, timeout: 20000 });
    };
    const result = this.requests.then(run, run);
    this.requests = result.catch(() => {});
    return result.then((json) => {
      if (!json?.video) throw new Error('Video not found');
      return json.video;
    });
  }
  setOptions(row, video) {
    row.qualities = videoOptions(video);
    row.blocked = [false, 0, 'false', '0'].includes(video.can_download);
    if (row.blocked && row.status === 'idle') row.status = 'skipped';
    const option = row.qualities.find((value) => value.height <= row.quality) || row.qualities.at(-1);
    if (option) row.quality = option.height;
    row.details = 'ready'; row.detailsError = '';
  }
  setQuality(row, quality) {
    const available = row.qualities.find((option) => option.height <= quality) || row.qualities.at(-1);
    const height = available?.height ?? quality;
    if (row.quality !== height) {
      row.quality = height; row.totalBytes = 0; row.bytesReceived = 0;
      if (row.status === 'done') row.status = 'idle';
    }
  }
  kick() {
    this.pump();
    if (!this.hydrating) {
      this.hydrating = true;
      this.hydration = this.hydrate().catch((error) => { this.state.error = error.message; })
        .finally(() => { this.hydrating = false; });
    }
  }
  async hydrate() {
    for (;;) {
      const row = this.state.rows.find((item) => item.details === 'pending');
      if (!row) break;
      row.details = 'loading';
      try {
        const video = await this.fetchVideo(row);
        if (!this.state.rows.includes(row)) continue;
        this.setOptions(row, video);
      } catch (error) {
        if (!this.state.rows.includes(row)) continue;
        row.details = 'error'; row.detailsError = error.message;
      }
      await this.persist();
      if (this.metadataDelay) await delay(this.metadataDelay);
    }
  }
  pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.state.rows.filter((row) => row.downloadId != null || ['getting', 'starting'].includes(row.status)).length < 2) {
        const row = this.state.rows.find((item) => item.status === 'queued' || (item.status === 'retry' && item.retryAt <= this.now()));
        if (!row) break;
        row.status = 'getting'; row.attempts++; row.stopRequested = false;
        void this.start(row).catch((error) => { this.state.error = error.message; }).finally(() => this.pump());
      }
    } finally { this.pumping = false; }
  }
  fail(row, error) {
    row.downloadId = null; row.error = error;
    if (row.stopRequested || error === 'USER_CANCELED') row.status = 'stopped';
    else if (row.attempts < 3) { row.status = 'retry'; row.retryAt = this.now() + 30000; }
    else row.status = 'error';
  }
  async start(row) {
    const controller = new AbortController();
    this.controllers.set(row.i, controller);
    try {
      await this.persist();
      const video = await this.fetchVideo(row, controller.signal);
      controller.signal.throwIfAborted();
      this.setOptions(row, video);
      if (row.blocked) { row.status = 'skipped'; return; }
      const link = pickLink(video.file_link_all, row.quality);
      if (!link) throw new Error('No download link available');
      row.status = 'starting';
      row.filename = `Aparat/${cleanName(this.state.playlist.title)}/${numLabel(row.i, this.state.rows.length)} - ${cleanName(row.title)}.mp4`;
      await this.persist();
      controller.signal.throwIfAborted();
      row.downloadId = await this.api.downloads.download({ url: link.url, filename: row.filename, conflictAction: 'uniquify' });
      if (!Number.isInteger(row.downloadId)) throw new Error('Could not start download');
      row.status = 'downloading'; row.downloadState = { state: 'in_progress', paused: false };
      await this.persist();
      if (row.stopRequested) await this.cancel(row);
      else await this.refreshRow(row);
    } catch (error) {
      if (controller.signal.aborted) row.stopRequested = true;
      if (row.downloadId == null) this.fail(row, error.message);
      else this.state.error = error.message;
    } finally {
      this.controllers.delete(row.i);
      await this.persist();
    }
  }
  observe(row, changes) {
    const fields = { ...row.downloadState };
    for (const key of ['state', 'paused', 'error', 'totalBytes', 'fileSize', 'bytesReceived']) {
      if (Object.hasOwn(changes, key)) fields[key] = changes[key];
    }
    row.downloadState = fields;
    const item = row.downloadState;
    if (item.totalBytes > 0) row.totalBytes = item.totalBytes;
    else if (item.fileSize > 0) row.totalBytes = item.fileSize;
    if (Number.isFinite(item.bytesReceived)) row.bytesReceived = item.bytesReceived;
    if (item.state === 'complete') { row.status = 'done'; row.downloadId = null; row.error = ''; }
    else if (item.state === 'interrupted' && !item.paused) this.fail(row, item.error || 'interrupted');
    else row.status = item.paused ? 'paused' : 'downloading';
  }
  async changed(delta) {
    await this.ready;
    const row = this.state.rows.find((item) => item.downloadId === delta.id);
    if (!row) return;
    row.revision = (row.revision || 0) + 1;
    const changes = {};
    for (const key of ['state', 'paused', 'error', 'totalBytes', 'fileSize']) {
      if (delta[key]) changes[key] = delta[key].current;
    }
    this.observe(row, changes);
    await this.persist(); this.pump();
  }
  async erased(id) {
    await this.ready;
    const row = this.state.rows.find((item) => item.downloadId === id);
    if (!row) return;
    row.downloadId = null; row.status = 'error'; row.error = 'Download removed from browser history';
    await this.persist(); this.pump();
  }
  async refreshRow(row) {
    const id = row.downloadId, revision = row.revision || 0;
    if (id == null) return;
    const [item] = await this.api.downloads.search({ id });
    if (row.downloadId !== id || (row.revision || 0) !== revision) return;
    if (item) this.observe(row, item);
    else { row.downloadId = null; row.status = 'error'; row.error = 'Download removed from browser history'; }
  }
  async refresh() {
    await Promise.all(this.state.rows.filter((row) => row.downloadId != null).map((row) => this.refreshRow(row).catch(() => {})));
  }
  async cancel(row) {
    const id = row.downloadId;
    if (id == null) return;
    try {
      await this.api.downloads.cancel(id);
      await this.refreshRow(row);
      if (row.downloadId === id) { row.downloadId = null; row.status = 'stopped'; }
    } catch (error) {
      await this.refreshRow(row).catch(() => {});
      if (row.downloadId != null) this.state.error = `Could not stop download: ${error.message}`;
    }
  }
  async handle(action, data = {}) {
    await this.ready;
    if (action === 'load') {
      if (this.state.loading || isBusy(this.state)) throw new Error('Stop the current queue before loading another playlist');
      const id = parsePlaylistId(data.input);
      if (!id) throw new Error('Invalid playlist link');
      this.state.loading = true;
      try {
        const playlist = parsePlaylist(await this.request(`/api/fa/v1/video/playlist/one/playlist_id/${id}`, { timeout: 20000 }));
        this.state = { schema: 1, playlistId: id, playlist, playlistQuality: 1080, loading: false, error: '', rows: playlist.items.map((item, i) => ({
          ...item, i, selected: true, quality: 1080, qualities: [], details: 'pending', detailsError: '',
          status: 'idle', attempts: 0, downloadId: null, error: '', totalBytes: 0, bytesReceived: 0,
        })) };
      } finally { this.state.loading = false; }
    } else if (action === 'select') {
      for (const row of this.state.rows) if (data.i == null || row.i === data.i) row.selected = data.selected === true;
    } else if (action === 'quality') {
      const row = this.state.rows.find((item) => item.i === data.i);
      if (!row || busy(row) || !row.qualities.some((option) => option.height === data.quality)) throw new Error('Quality is not available');
      if (row.quality !== data.quality) this.state.playlistQuality = null;
      this.setQuality(row, data.quality);
    } else if (action === 'qualityAll') {
      if (!Number.isSafeInteger(data.quality) || data.quality <= 0) throw new Error('Quality is not available');
      if (isBusy(this.state)) throw new Error('Stop the current queue before changing all qualities');
      this.state.playlistQuality = data.quality;
      for (const row of this.state.rows) this.setQuality(row, data.quality);
    } else if (action === 'enqueue') {
      for (const row of this.state.rows) {
        if ((data.i == null ? row.selected : row.i === data.i) && !busy(row) && row.status !== 'done' && !row.blocked) {
          row.status = 'queued'; row.attempts = 0; row.error = ''; row.stopRequested = false;
        }
      }
      this.state.error = '';
    } else if (action === 'stop') {
      for (const row of this.state.rows.filter(busy)) {
        row.stopRequested = true;
        this.controllers.get(row.i)?.abort();
        if (['queued', 'retry'].includes(row.status)) row.status = 'stopped';
      }
      await Promise.all(this.state.rows.filter((row) => row.downloadId != null).map((row) => this.cancel(row)));
    } else if (action === 'details') {
      const row = this.state.rows.find((item) => item.i === data.i);
      if (row && !busy(row)) row.details = 'pending';
    } else if (action !== 'snapshot') throw new Error('Unknown action');
    if (action === 'snapshot') await this.refresh();
    await this.persist(); this.kick();
    return structuredClone(this.state);
  }
  async recover() {
    await this.ready; await this.refresh(); await this.persist(); this.kick();
  }
}
