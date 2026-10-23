import { parsePlaylistId, parsePlaylist, pickLink, cleanName, decodeEntities, fmtDuration, totalParts, numLabel } from './lib.js';
import { current, detectLang, setLang, nextLang, t, tp, num, digits, ltr } from './i18n.js';

const $ = (s) => document.querySelector(s);
const ORIGIN = 'https://www.aparat.com';
const EXAMPLE = `${ORIGIN}/playlist/1301084/`;
const CONCURRENCY = 2; // simultaneous downloads
const ATTEMPTS = 3;    // tries per video

let playlist = null, rows = [], running = false, cancelled = false, msgFn = null;
const active = new Map(); // chrome download id -> { row, resolve, reject }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Messages and statuses are stored as functions so they can be re-worded when the language changes.
const say = (fn) => { msgFn = fn; $('#msg').textContent = fn ? fn() : ''; };

async function getJSON(path) {
  const r = await fetch(ORIGIN + path, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// ---------- theme and language buttons ----------
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function syncButtons() {
  const root = document.documentElement;
  const isDark = root.dataset.theme ? root.dataset.theme === 'dark' : darkQuery.matches;
  const th = $('#theme');
  th.dataset.mode = isDark ? 'dark' : 'light';
  th.title = t(isDark ? 'theme.toLight' : 'theme.toDark');
  th.setAttribute('aria-label', th.title);
  const lg = $('#lang');
  $('#langBadge').textContent = current().badge;
  lg.title = t('lang.change');
  lg.setAttribute('aria-label', lg.title);
}
$('#theme').onclick = () => {
  const next = $('#theme').dataset.mode === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
  syncButtons();
};
$('#lang').onclick = async () => { await setLang(nextLang(), true); refreshText(); };
darkQuery.addEventListener('change', syncButtons);

// Re-word everything on screen after a language change.
function refreshText() {
  syncButtons();
  if (msgFn) say(msgFn);
  if (playlist) { renderMeta(); rows.forEach(paintRow); updateSummary(); }
}

// ---------- playlist ----------
async function load(input) {
  const id = parsePlaylistId(input);
  if (!id) return say(() => t('msg.pasteLink', { example: ltr(EXAMPLE) }));
  say(() => t('msg.loading'));
  try {
    playlist = parsePlaylist(await getJSON(`/api/fa/v1/video/playlist/one/playlist_id/${id}`));
  } catch (e) {
    return say(() => t('msg.loadFailed', { error: ltr(e.message) }));
  }
  render();
  const got = playlist.items.length, total = playlist.total;
  say(got < total ? () => t('msg.partial', { got: num(got), total: num(total) }) : null);
}

function renderMeta() {
  const { h, m } = totalParts(playlist.items.reduce((s, x) => s + x.duration, 0));
  const duration = h ? t('duration.hm', { h: num(h), m: num(m) }) : t('duration.m', { m: num(m) });
  $('#plTitle').textContent = decodeEntities(playlist.title);
  $('#plChannel').textContent = decodeEntities(playlist.channel || '');
  $('#plMeta').textContent = tp('playlist.meta', playlist.items.length, { duration });
}

function render() {
  renderMeta();
  const thumb = $('#plThumb'), src = playlist.items[0]?.poster || playlist.cover;
  if (src) { thumb.src = src; thumb.hidden = false; } else { thumb.hidden = true; thumb.removeAttribute('src'); }

  const ol = $('#list');
  ol.replaceChildren();
  rows = playlist.items.map((it, i) => {
    const li = document.createElement('li');
    const pick = Object.assign(document.createElement('label'), { className: 'pick' });
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: true });
    cb.setAttribute('aria-label', decodeEntities(it.title));
    cb.onchange = updateSummary;
    pick.append(cb);
    const n = Object.assign(document.createElement('span'), { className: 'n' });
    const title = Object.assign(document.createElement('span'), { className: 'title', textContent: decodeEntities(it.title) });
    const st = document.createElement('span');
    const bar = Object.assign(document.createElement('progress'), { max: 1, value: 0, hidden: true });
    li.append(pick, n, title, st, bar);
    ol.append(li);
    const row = { it, i, cb, num: n, st, bar, cls: '', statusFn: () => digits(fmtDuration(it.duration)) };
    paintRow(row);
    return row;
  });
  $('#all').checked = true;
  $('#panel').hidden = false;
  updateSummary();
}

function paintRow(row) {
  row.num.textContent = digits(numLabel(row.i, playlist.items.length));
  row.st.textContent = row.statusFn();
  row.st.className = `status ${row.cls}`;
}
function setStatus(row, cls, fn) { row.cls = cls; row.statusFn = fn; paintRow(row); }

function setCount(id, value, cls = '') {
  const el = $(id);
  el.firstElementChild.textContent = value;
  el.className = `count ${value !== num(0) ? cls : ''}`; // color the figure only when it is non-zero
}
function updateSummary() {
  const c = (k) => rows.filter((r) => r.st.classList.contains(k)).length;
  setCount('#cSelected', `${num(rows.filter((r) => r.cb.checked).length)}/${num(rows.length)}`);
  setCount('#cDone', num(c('ok')), 'ok');
  setCount('#cSkipped', num(c('skip')), 'skip');
  setCount('#cFailed', num(c('err')), 'err');
}

// ---------- downloading ----------
function settle(id, state, error) {
  const tk = active.get(id);
  if (!tk) return;
  if (state === 'complete') { active.delete(id); tk.resolve(); }
  else if (state === 'interrupted') { active.delete(id); tk.reject(new Error(error || 'interrupted')); }
}
chrome.downloads.onChanged.addListener((d) => settle(d.id, d.state?.current, d.error?.current));

const searchDownloads = (query) => new Promise((res) => chrome.downloads.search(query, res));
// chrome.downloads doesn't report byte progress via events, so poll.
setInterval(async () => {
  for (const [id, tk] of active) {
    const [d] = await searchDownloads({ id });
    if (!active.has(id) || !(d?.totalBytes > 0)) continue; // finished while we were asking
    tk.row.bar.hidden = false;
    tk.row.bar.value = d.bytesReceived / d.totalBytes;
    const got = d.bytesReceived / 1048576, total = d.totalBytes / 1048576;
    setStatus(tk.row, '', () => t('status.progress', { got: num(got, 1), total: num(total, 1) }));
  }
}, 1000);

function startDownload(row, url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, conflictAction: 'uniquify' }, (id) => {
      if (chrome.runtime.lastError || id === undefined) {
        return reject(new Error(chrome.runtime.lastError?.message || t('error.couldNotStart')));
      }
      active.set(id, { row, resolve, reject });
      // Tiny files can finish before the listener sees them.
      chrome.downloads.search({ id }, ([d]) => d && settle(id, d.state, d.error));
    });
  });
}

async function processRow(row, maxH, dir) {
  // File names always use ASCII digits so they sort correctly in any file manager.
  const name = `${dir}/${numLabel(row.i, playlist.items.length)} - ${cleanName(row.it.title)}.mp4`;
  for (let attempt = 1; attempt <= ATTEMPTS && !cancelled; attempt++) {
    try {
      setStatus(row, '', () => t('status.getting'));
      // Links are signed and expire within hours, so fetch each one right before its download.
      const v = (await getJSON(`/etc/api/video/videohash/${row.it.uid}`)).video;
      if (!v) throw new Error(t('error.videoNotFound'));
      if (v.can_download === false) return setStatus(row, 'skip', () => t('status.skipped'));
      const link = pickLink(v.file_link_all, maxH);
      if (!link) return setStatus(row, 'err', () => t('status.noLink'));
      setStatus(row, '', () => t('status.downloading', { quality: ltr(link.profile) }));
      await startDownload(row, link.url, name);
      row.bar.hidden = true;
      return setStatus(row, 'ok', () => t('status.done', { quality: ltr(link.profile) }));
    } catch (e) {
      if (cancelled) return setStatus(row, 'skip', () => t('status.stopped'));
      if (attempt === ATTEMPTS) return setStatus(row, 'err', () => t('status.failed', { error: ltr(e.message) }));
      setStatus(row, '', () => t('status.retrying', { attempt: num(attempt), max: num(ATTEMPTS - 1) }));
      await sleep(2000 * attempt);
    }
  }
}

function toggleUI() {
  $('#go').disabled = running;
  $('#load').disabled = running;
  $('#stop').hidden = !running;
  window.onbeforeunload = running ? (e) => { e.preventDefault(); e.returnValue = ''; } : null;
}

async function run() {
  // Videos already marked done are skipped, so clicking again retries only the rest.
  const todo = rows.filter((r) => r.cb.checked && !r.st.classList.contains('ok'));
  if (!todo.length) return;
  running = true; cancelled = false; toggleUI();
  const maxH = +$('#q').value;
  const dir = `Aparat/${cleanName(playlist.title)}`;
  let next = 0;
  const worker = async () => {
    while (!cancelled && next < todo.length) {
      await processRow(todo[next++], maxH, dir);
      updateSummary();
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  running = false; toggleUI(); updateSummary();
}

// ---------- wiring ----------
$('#plThumb').onerror = (e) => { e.target.hidden = true; };
$('#loader').onsubmit = (e) => { e.preventDefault(); load($('#url').value); };
$('#go').onclick = run;
$('#stop').onclick = () => { cancelled = true; for (const id of active.keys()) chrome.downloads.cancel(id); };
$('#all').onchange = (e) => { rows.forEach((r) => { r.cb.checked = e.target.checked; }); updateSummary(); };

await setLang(detectLang());
refreshText();
document.documentElement.dataset.ready = '1';

const fromTab = new URLSearchParams(location.search).get('u');
if (fromTab && parsePlaylistId(fromTab)) { $('#url').value = fromTab; load(fromTab); }
