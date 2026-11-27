import { parsePlaylistId, decodeEntities, fmtDuration, totalParts, numLabel } from './lib.js';
import { current, detectLang, setLang, nextLang, t, tp, num, digits, ltr } from './i18n.js';

const api = globalThis.browser ?? globalThis.chrome;
const $ = (selector) => document.querySelector(selector);
let state = { rows: [], playlist: null }, views = [], signature = '', pending = 0, epoch = 0, disposed = false, timer;
const busy = (row) => row.downloadId != null || ['queued', 'getting', 'starting', 'retry'].includes(row.status);
const eligible = (row) => !busy(row) && row.status !== 'done' && !row.blocked;
const rpc = async (action, data = {}) => {
  const response = await api.runtime.sendMessage({ type: 'playlist-downloader', action, data });
  if (!response?.ok) throw new Error(response?.error || t('error.background'));
  return response.state;
};
const say = (text = '') => { $('#msg').textContent = text; };

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function syncButtons() {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : darkQuery.matches;
  $('#theme').dataset.mode = dark ? 'dark' : 'light';
  $('#theme').title = t(dark ? 'theme.toLight' : 'theme.toDark');
  $('#theme').setAttribute('aria-label', $('#theme').title);
  $('#langBadge').textContent = current().badge;
  $('#lang').title = t('lang.change');
  $('#lang').setAttribute('aria-label', t('lang.change'));
}
$('#theme').onclick = () => {
  const theme = $('#theme').dataset.mode === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('theme', theme); } catch {}
  syncButtons();
};
$('#lang').onclick = async () => {
  $('#lang').disabled = true;
  try { await setLang(nextLang(), true); syncButtons(); render(); }
  catch (error) { say(error.message); }
  finally { $('#lang').disabled = false; }
};
darkQuery.addEventListener('change', syncButtons);

function controls() {
  const active = state.rows.some(busy);
  $('#load').disabled = !!pending || state.loading || active;
  $('#url').disabled = !!pending || state.loading || active;
  $('#go').disabled = !!pending || state.loading || !state.rows.some((row) => row.selected && eligible(row));
  $('#stop').hidden = !active;
  $('#stop').disabled = !!pending;
  $('#all').disabled = !!pending || !state.rows.length;
  $('#quality-all').disabled = !!pending || state.loading || active || !state.rows.length;
  views.forEach((view, i) => {
    const row = state.rows[i];
    view.cb.disabled = !!pending;
    view.quality.disabled = !!pending || busy(row) || row.details !== 'ready' || !row.qualities.length;
    view.single.disabled = !!pending || !eligible(row);
    view.retry.disabled = !!pending || busy(row);
  });
}
async function command(action, data) {
  const version = ++epoch;
  pending++; controls();
  if (action === 'load') say(t('msg.loading'));
  try {
    const next = await rpc(action, data);
    if (!disposed && version === epoch) { state = next; render(); }
  } catch (error) { if (!disposed) say(t('msg.runFailed', { error: ltr(error.message) })); }
  finally { pending--; if (!disposed) controls(); }
}

function createRows() {
  $('#list').replaceChildren();
  views = state.rows.map((row) => {
    const li = document.createElement('li');
    const pick = Object.assign(document.createElement('label'), { className: 'pick' });
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox' });
    cb.setAttribute('aria-label', decodeEntities(row.title));
    cb.onchange = () => command('select', { i: row.i, selected: cb.checked });
    pick.append(cb);
    const number = Object.assign(document.createElement('span'), { className: 'n' });
    const title = Object.assign(document.createElement('span'), { className: 'title', textContent: decodeEntities(row.title) });
    const info = Object.assign(document.createElement('span'), { className: 'video-info' });
    const thumbnail = Object.assign(document.createElement('img'), {
      className: 'video-thumbnail', alt: '', loading: 'lazy', decoding: 'async', referrerPolicy: 'no-referrer',
      width: 64, height: 36,
    });
    let poster;
    try { poster = new URL(row.poster); } catch {}
    thumbnail.hidden = !poster || !['https:', 'http:'].includes(poster.protocol);
    if (!thumbnail.hidden) thumbnail.src = poster.href;
    thumbnail.onerror = () => { thumbnail.hidden = true; };
    info.append(thumbnail, title);
    const status = Object.assign(document.createElement('span'), { className: 'status' });
    const bar = Object.assign(document.createElement('progress'), { max: 1, value: 0, hidden: true });
    const tools = Object.assign(document.createElement('div'), { className: 'row-controls' });
    const qualityLabel = document.createElement('label');
    const qualityText = document.createElement('span');
    const quality = document.createElement('select');
    quality.onchange = () => command('quality', { i: row.i, quality: Number(quality.value) });
    qualityLabel.append(qualityText, quality);
    const size = Object.assign(document.createElement('span'), { className: 'file-size' });
    const single = Object.assign(document.createElement('button'), { type: 'button', className: 'single quiet' });
    single.onclick = () => command('enqueue', { i: row.i });
    const retry = Object.assign(document.createElement('button'), { type: 'button', className: 'details-retry quiet' });
    retry.onclick = () => command('details', { i: row.i });
    tools.append(qualityLabel, size, retry, single);
    li.append(pick, number, info, status, tools, bar);
    $('#list').append(li);
    return { cb, number, status, bar, quality, qualityText, size, single, retry, options: '' };
  });
}

function statusText(row) {
  if (row.status === 'idle') return digits(fmtDuration(row.duration));
  if (row.status === 'queued') return t('status.queued');
  if (['getting', 'starting'].includes(row.status)) return t('status.getting');
  if (row.status === 'paused') return t('status.paused');
  if (row.status === 'done') return t('status.done', { quality: ltr(`${row.quality}p`) });
  if (row.status === 'skipped') return t('status.skipped');
  if (row.status === 'stopped') return t('status.stopped');
  if (row.status === 'cancelled') return t('status.cancelled');
  if (row.status === 'retry') return t('status.retrying', { attempt: num(row.attempts), max: num(3) });
  if (row.status === 'error') return t('status.failed', { error: ltr(row.error) });
  return row.totalBytes > 0
    ? t('status.progress', { got: num(row.bytesReceived / 1048576, 1), total: num(row.totalBytes / 1048576, 1) })
    : t('status.downloading', { quality: ltr(`${row.quality}p`) });
}

function render() {
  $('#panel').hidden = !state.playlist;
  if (!state.playlist) { controls(); return; }
  $('#quality-all').value = String(state.playlistQuality ?? '');
  $('#quality-all').title = t('quality.hint');
  const nextSignature = `${state.playlistId}:${state.rows.map((row) => row.uid).join(',')}`;
  if (signature !== nextSignature) { signature = nextSignature; createRows(); }
  $('#plTitle').textContent = decodeEntities(state.playlist.title);
  $('#plChannel').textContent = decodeEntities(state.playlist.channel);
  const { h, m } = totalParts(state.rows.reduce((sum, row) => sum + row.duration, 0));
  const duration = h ? t('duration.hm', { h: num(h), m: num(m) }) : t('duration.m', { m: num(m) });
  $('#plMeta').textContent = tp('playlist.meta', state.rows.length, { duration });
  const src = state.playlist.cover || state.rows[0]?.poster;
  $('#plThumb').hidden = !src;
  if (src && $('#plThumb').getAttribute('src') !== src) $('#plThumb').src = src;
  state.rows.forEach((row, i) => {
    const view = views[i];
    view.cb.checked = row.selected; view.cb.disabled = !!pending;
    view.number.textContent = digits(numLabel(i, state.rows.length));
    view.status.textContent = statusText(row);
    view.status.className = `status ${{ done: 'ok', skipped: 'skip', stopped: 'skip', cancelled: 'skip', error: 'err' }[row.status] || ''}`;
    view.qualityText.textContent = t('list.quality');
    view.quality.setAttribute('aria-label', `${t('list.quality')}: ${decodeEntities(row.title)}`);
    const options = row.qualities.map((option) => option.height).join(',');
    if (options !== view.options || !view.quality.children.length) {
      view.options = options; view.quality.replaceChildren();
      for (const option of row.qualities.length ? row.qualities : [{ height: row.quality, profile: `${row.quality}p` }]) {
        view.quality.append(Object.assign(document.createElement('option'), { value: String(option.height), textContent: option.profile }));
      }
    }
    view.quality.value = String(row.quality);
    view.quality.disabled = !!pending || busy(row) || row.details !== 'ready' || !row.qualities.length;
    const reported = row.qualities.find((option) => option.height === row.quality)?.size;
    const size = row.totalBytes > 0 ? t('size.mb', { value: num(row.totalBytes / 1048576, 2) })
      : reported ? digits(reported) : t(['pending', 'loading'].includes(row.details) ? 'size.loading' : 'size.unknown');
    view.size.textContent = `${t('size.label')}: ${size}`;
    view.size.title = reported ? t('size.reported') : t('size.unknown');
    view.single.textContent = t('action.single');
    view.single.setAttribute('aria-label', `${t('action.single')}: ${decodeEntities(row.title)}`);
    view.single.disabled = !!pending || !eligible(row);
    view.retry.hidden = row.details !== 'error';
    view.retry.textContent = t('action.details'); view.retry.disabled = !!pending || busy(row);
    view.bar.hidden = !['downloading', 'paused'].includes(row.status) || !(row.totalBytes > 0);
    if (!view.bar.hidden) view.bar.value = Math.max(0, Math.min(1, row.bytesReceived / row.totalBytes));
  });
  const selected = state.rows.filter((row) => row.selected).length;
  $('#all').checked = selected > 0 && selected === state.rows.length;
  $('#all').indeterminate = selected > 0 && selected < state.rows.length;
  $('#cSelected').firstElementChild.textContent = `${num(selected)}/${num(state.rows.length)}`;
  for (const [id, status, cls] of [['cDone', 'done', 'ok'], ['cSkipped', 'skipped', 'skip'], ['cFailed', 'error', 'err']]) {
    const count = state.rows.filter((row) => row.status === status).length;
    $(`#${id}`).firstElementChild.textContent = num(count);
    $(`#${id}`).className = `count ${count ? cls : ''}`;
  }
  say(state.error || (state.rows.some((row) => row.status === 'cancelled') ? t('msg.browserCancelled') : '') || (!state.rows.length ? t('msg.empty') : state.rows.length < state.playlist.total
    ? t('msg.partial', { got: num(state.rows.length), total: num(state.playlist.total) }) : ''));
  controls();
}

$('#loader').onsubmit = (event) => {
  event.preventDefault();
  if (!parsePlaylistId($('#url').value)) return say(t('msg.pasteLink', { example: ltr('https://www.aparat.com/playlist/1301084/') }));
  return command('load', { input: $('#url').value });
};
$('#go').onclick = () => command('enqueue');
$('#stop').onclick = () => command('stop');
$('#all').onchange = () => command('select', { selected: $('#all').checked });
$('#quality-all').onchange = () => command('qualityAll', { quality: Number($('#quality-all').value) });
$('#plThumb').onerror = () => { $('#plThumb').hidden = true; };

async function poll() {
  const version = epoch;
  try {
    const next = await rpc('snapshot');
    if (!disposed && !pending && version === epoch) { state = next; render(); }
  } catch (error) { if (!disposed) say(error.message); }
  if (!disposed) timer = setTimeout(poll, 1000);
}
window.addEventListener('pagehide', () => { disposed = true; clearTimeout(timer); });
await setLang(detectLang());
$('#lang').disabled = false; syncButtons(); controls();
document.documentElement.dataset.ready = '1';
try {
  state = await rpc('snapshot'); render();
  $('#url').value = state.playlistId || '';
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const id = parsePlaylistId(tab?.url);
  if (id && id !== state.playlistId && !state.rows.some(busy)) {
    $('#url').value = tab.url; await command('load', { input: tab.url });
  }
} catch (error) { say(error.message); }
if (!disposed) timer = setTimeout(poll, 1000);
