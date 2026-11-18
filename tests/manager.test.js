import test from 'node:test';
import assert from 'node:assert/strict';
import { DownloadManager, QUEUE_ALARM, videoOptions } from '../manager.js';
import { deferred, until } from './helpers.js';
import { harness, playlistJSON, videoJSON } from './manager-helpers.js';

async function loaded(options) {
  const h = harness(options);
  await h.manager.handle('load', { input: '123' });
  await until(() => h.manager.state.rows.every((row) => ['ready', 'error'].includes(row.details)));
  return h;
}

test('metadata exposes only real qualities and their reported sizes, without persisting signed URLs', async () => {
  const h = await loaded();
  assert.deepEqual(videoOptions(videoJSON.video).map((value) => value.height), [720, 360]);
  const row = h.manager.state.rows[0];
  assert.equal(row.quality, 720);
  assert.equal(row.qualities[0].size, '3.51 مگابایت');
  assert.ok(!JSON.stringify(h.storage).includes('cdn.test'));
  assert.equal(videoOptions({ file_link_all: null }).length, 0);
});

test('single downloads ignore checkbox selection and honor each selected quality', async () => {
  const h = await loaded();
  await h.manager.handle('select', { selected: false });
  await h.manager.handle('quality', { i: 1, quality: 360 });
  await h.manager.handle('enqueue', { i: 1 });
  await until(() => h.started.length === 1);
  assert.equal(h.started[0].url, 'https://cdn.test/360.mp4');
  assert.equal(h.started[0].filename, 'Aparat/Example/02 - b.mp4');
  await h.complete(1);
  await h.manager.handle('enqueue');
  assert.equal(h.started.length, 1);
  await h.manager.handle('quality', { i: 1, quality: 720 });
  assert.equal(h.manager.state.rows[1].status, 'idle');
});

test('bulk and repeated single requests share the same two-download limit', async () => {
  const h = await loaded();
  await h.manager.handle('enqueue');
  await h.manager.handle('enqueue', { i: 0 });
  await until(() => h.started.length === 2);
  assert.equal(h.manager.state.rows[2].status, 'queued');
  await assert.rejects(h.manager.handle('load', { input: '456' }), /Stop the current queue/);
  await h.complete(1);
  await until(() => h.started.length === 3);
  await h.complete(2); await h.complete(3);
  await h.manager.handle('enqueue');
  assert.equal(h.started.length, 3);
});

test('Firefox pause retains its slot and completion after resume advances the queue', async () => {
  const h = await loaded();
  await h.manager.handle('enqueue');
  await until(() => h.started.length === 2);
  await h.manager.changed({ id: 1, state: { current: 'interrupted' }, paused: { current: true }, error: { current: 'USER_CANCELED' } });
  assert.equal(h.manager.state.rows[0].status, 'paused');
  assert.equal(h.started.length, 2);
  await h.manager.changed({ id: 1, state: { current: 'in_progress' }, paused: { current: false } });
  await h.complete(1);
  await until(() => h.started.length === 3);
  await h.manager.handle('stop');
});

test('persisted active IDs and queue continue after the background worker is recreated', async () => {
  const h = await loaded();
  await h.manager.handle('enqueue');
  await until(() => h.manager.state.rows.filter((row) => row.downloadId != null).length === 2);
  await h.manager.writes;
  const resumed = new DownloadManager(h.api, { metadataDelay: 0, request: async () => structuredClone(videoJSON) });
  await resumed.ready;
  assert.equal(resumed.state.rows[0].downloadId, 1);
  assert.equal(h.started.length, 2);
  h.records.set(1, { id: 1, state: 'complete', paused: false });
  await resumed.changed({ id: 1, state: { current: 'complete' } });
  await until(() => h.started.length === 3);
  await resumed.handle('stop');
});

test('retry state survives popup closure and is resumed by an alarm without duplicate active files', async () => {
  let time = 0;
  const h = await loaded({ now: () => time });
  await h.manager.handle('enqueue', { i: 0 });
  await until(() => h.started.length === 1);
  await h.manager.changed({ id: 1, state: { current: 'interrupted' }, error: { current: 'NETWORK_FAILED' } });
  assert.equal(h.manager.state.rows[0].status, 'retry');
  assert.ok(h.alarms.has(QUEUE_ALARM));
  time = 31000;
  await h.manager.recover();
  await until(() => h.started.length === 2);
  await h.complete(2);
  assert.equal(h.manager.state.rows[0].status, 'done');
});

test('Stop during download creation cancels the ID when it becomes available', async () => {
  const h = await loaded(), pending = deferred(), cancelled = [];
  h.api.downloads.download = () => pending.promise;
  h.api.downloads.cancel = async (id) => { cancelled.push(id); h.records.set(id, { id, state: 'interrupted', paused: false, error: 'USER_CANCELED' }); };
  await h.manager.handle('enqueue', { i: 0 });
  await until(() => h.manager.state.rows[0].status === 'starting');
  await h.manager.handle('stop');
  pending.resolve(42);
  await until(() => cancelled.length);
  await until(() => h.manager.state.rows[0].status === 'stopped');
  assert.deepEqual(cancelled, [42]);
});

test('Stop aborts pending link requests and stops unstarted queue entries', async () => {
  let hanging = false;
  const h = await loaded({ request: async (path, { signal } = {}) => {
    if (path.includes('/playlist/')) return playlistJSON();
    if (!hanging) return videoJSON;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  hanging = true;
  await h.manager.handle('enqueue');
  await h.manager.handle('stop');
  await until(() => h.manager.state.rows.every((row) => row.status === 'stopped'));
  assert.equal(h.started.length, 0);
});

test('disabled downloads are skipped and actual browser cancellation is not retried', async () => {
  const h = await loaded({ request: async (path) => path.includes('/playlist/') ? playlistJSON()
    : path.endsWith('/a') ? { video: { can_download: false, file_link_all: [] } } : videoJSON });
  await h.manager.handle('enqueue');
  await until(() => h.started.length === 2);
  assert.equal(h.manager.state.rows[0].status, 'skipped');
  assert.equal(h.manager.state.rows[0].blocked, true);
  await h.manager.changed({ id: 1, state: { current: 'interrupted' }, paused: { current: false }, error: { current: 'USER_CANCELED' } });
  assert.equal(h.manager.state.rows[1].status, 'stopped');
  await h.complete(2);
});

test('empty or failed reloads and unsupported qualities leave the existing playlist usable', async () => {
  const h = await loaded({ request: async (path) => {
    if (path.includes('/playlist/')) {
      if (path.endsWith('/456')) throw new Error('HTTP 404');
      return playlistJSON([]);
    }
    return videoJSON;
  } });
  assert.equal(h.manager.state.rows.length, 0);
  await assert.rejects(h.manager.handle('load', { input: '456' }), /404/);
  assert.equal(h.manager.state.loading, false);
  await assert.rejects(h.manager.handle('quality', { i: 0, quality: 999 }), /not available/);
});

test('browser status snapshots never persist expiring media URLs', async () => {
  const h = await loaded();
  await h.manager.handle('enqueue', { i: 0 });
  await until(() => h.manager.state.rows[0].downloadId != null);
  h.records.set(1, { id: 1, state: 'in_progress', paused: false, totalBytes: 100, bytesReceived: 30,
    url: 'https://cdn.test/video.mp4?secret=signed-token', finalUrl: 'https://cdn.test/final.mp4?secret=signed-token' });
  await h.manager.handle('snapshot');
  assert.ok(!JSON.stringify(h.storage).includes('signed-token'));
  assert.ok(!JSON.stringify(h.manager.state).includes('signed-token'));
  await h.manager.handle('stop');
});
