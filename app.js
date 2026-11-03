import { parsePlaylistId, parsePlaylist, pickLink, cleanName, decodeEntities, fmtDuration, totalParts, numLabel } from './lib.js';
import { current, detectLang, setLang, nextLang, t, tp, num, digits, ltr } from './i18n.js';
import { getJSON, delay, ORIGIN } from './api.js';
import { downloadFile } from './downloads.js';

const $ = (s) => document.querySelector(s);
const EXAMPLE = `${ORIGIN}/playlist/1301084/`;
const CONCURRENCY = 2; // simultaneous downloads
const ATTEMPTS = 3;    // tries per video

let playlist = null, rows = [], running = false, loading = false, runController = null, msgFn = null;

// Messages and statuses are stored as functions so they can be re-worded when the language changes.
const say = (fn) => { msgFn = fn; $('#msg').textContent = fn ? fn() : ''; };

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
$('#lang').onclick = async () => {
  $('#lang').disabled = true;
  try { await setLang(nextLang(), true); refreshText(); }
  catch (error) { say(() => t('msg.languageFailed', { error: ltr(error.message) })); }
  finally { $('#lang').disabled = false; }
};
darkQuery.addEventListener('change', syncButtons);

// Re-word everything on screen after a language change.
function refreshText() {
  syncButtons();
  if (msgFn) say(msgFn);
  if (playlist) { renderMeta(); rows.forEach(paintRow); updateSummary(); }
}

// ---------- playlist ----------
async function load(input) {
  if (running || loading) return;
  const id = parsePlaylistId(input);
  if (!id) return say(() => t('msg.pasteLink', { example: ltr(EXAMPLE) }));
  loading = true; toggleUI();
  say(() => t('msg.loading'));
  try {
    playlist = parsePlaylist(await getJSON(`/api/fa/v1/video/playlist/one/playlist_id/${id}`));
    render();
    const got = playlist.items.length, total = playlist.total;
    say(!got ? () => t('msg.empty') : got < total ? () => t('msg.partial', { got: num(got), total: num(total) }) : null);
  } catch (e) {
    say(() => t('msg.loadFailed', { error: ltr(e.message) }));
  } finally {
    loading = false; toggleUI();
  }
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
  const c = (k) => rows.filter((r) => r.cls === k).length;
  const selected = rows.filter((r) => r.cb.checked).length;
  $('#all').checked = rows.length > 0 && selected === rows.length;
  $('#all').indeterminate = selected > 0 && selected < rows.length;
  setCount('#cSelected', `${num(selected)}/${num(rows.length)}`);
  setCount('#cDone', num(c('ok')), 'ok');
  setCount('#cSkipped', num(c('skip')), 'skip');
  setCount('#cFailed', num(c('err')), 'err');
  toggleUI();
}

// ---------- downloading ----------
async function processRow(row, maxH, dir, signal, total) {
  // File names always use ASCII digits so they sort correctly in any file manager.
  const name = `${dir}/${numLabel(row.i, total)} - ${cleanName(row.it.title)}.mp4`;
  try {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        signal.throwIfAborted();
        setStatus(row, '', () => t('status.getting'));
        // Links are signed and expire within hours, so fetch each one right before its download.
        const v = (await getJSON(`/etc/api/video/videohash/${encodeURIComponent(row.it.uid)}`, { signal }))?.video;
        signal.throwIfAborted();
        if (!v) throw new Error(t('error.videoNotFound'));
        if ([false, 0, 'false', '0'].includes(v.can_download)) {
          row.blocked = true;
          return setStatus(row, 'skip', () => t('status.skipped'));
        }
        const link = pickLink(v.file_link_all, maxH);
        if (!link) return setStatus(row, 'err', () => t('status.noLink'));
        setStatus(row, '', () => t('status.downloading', { quality: ltr(link.profile) }));
        await downloadFile(browser.downloads, { url: link.url, filename: name }, {
          signal,
          onProgress: (item) => {
            row.bar.hidden = false;
            row.bar.value = Math.max(0, Math.min(1, item.bytesReceived / item.totalBytes));
            const got = item.bytesReceived / 1048576, total = item.totalBytes / 1048576;
            setStatus(row, '', () => t('status.progress', { got: num(got, 1), total: num(total, 1) }));
          },
          onCancelError: (error) => say(() => t('msg.stopFailed', { error: ltr(error.message) })),
        });
        return setStatus(row, 'ok', () => t('status.done', { quality: ltr(link.profile) }));
      } catch (e) {
        if (signal.aborted || e.message === 'USER_CANCELED') return setStatus(row, 'skip', () => t('status.stopped'));
        if (attempt === ATTEMPTS) return setStatus(row, 'err', () => t('status.failed', { error: ltr(e.message) }));
        setStatus(row, '', () => t('status.retrying', { attempt: num(attempt), max: num(ATTEMPTS - 1) }));
        await delay(2000 * attempt, signal);
      }
    }
  } catch (error) {
    setStatus(row, signal.aborted ? 'skip' : 'err', () => signal.aborted
      ? t('status.stopped') : t('status.failed', { error: ltr(error.message) }));
  } finally { row.bar.hidden = true; }
}

function toggleUI() {
  $('#go').disabled = running || loading || !rows.some((r) => r.cb.checked && r.cls !== 'ok' && !r.blocked);
  $('#load').disabled = running || loading;
  $('#url').disabled = running || loading;
  $('#q').disabled = running || loading;
  $('#all').disabled = running || loading || !rows.length;
  rows.forEach((r) => { r.cb.disabled = running || loading; });
  $('#stop').hidden = !running;
  $('#stop').disabled = !!runController?.signal.aborted;
  window.onbeforeunload = running ? (e) => { e.preventDefault(); e.returnValue = ''; } : null;
}

async function run() {
  if (running || loading) return;
  // Videos already marked done are skipped, so clicking again retries only the rest.
  const todo = rows.filter((r) => r.cb.checked && r.cls !== 'ok' && !r.blocked);
  if (!todo.length) return;
  running = true; runController = new AbortController(); toggleUI();
  const { signal } = runController;
  const total = rows.length;
  const maxH = +$('#q').value;
  const dir = `Aparat/${cleanName(playlist.title)}`;
  let next = 0;
  const worker = async () => {
    while (!signal.aborted && next < todo.length) {
      await processRow(todo[next++], maxH, dir, signal, total);
      updateSummary();
    }
  };
  try {
    const results = await Promise.allSettled(Array.from({ length: CONCURRENCY }, worker));
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) say(() => t('msg.runFailed', { error: ltr(failure.reason.message) }));
  } finally {
    running = false; runController = null; toggleUI(); updateSummary();
  }
}

// ---------- wiring ----------
$('#plThumb').onerror = (e) => { e.target.hidden = true; };
$('#loader').onsubmit = (e) => { e.preventDefault(); return load($('#url').value); };
$('#go').onclick = run;
$('#stop').onclick = () => { runController?.abort(); toggleUI(); };
$('#all').onchange = (e) => { rows.forEach((r) => { r.cb.checked = e.target.checked; }); updateSummary(); };

await setLang(detectLang());
$('#lang').disabled = false;
refreshText();
toggleUI();
document.documentElement.dataset.ready = '1';

const fromTab = new URLSearchParams(location.search).get('u');
if (fromTab && parsePlaylistId(fromTab)) { $('#url').value = fromTab; load(fromTab); }
