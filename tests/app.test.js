import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deferred, fakeDownloads, until } from './helpers.js';

class Element {
  children = []; dataset = {}; disabled = false; hidden = false; checked = false;
  textContent = ''; value = ''; className = '';
  append(...elements) { this.children.push(...elements); }
  replaceChildren(...elements) { this.children = elements; }
  setAttribute(key, value) { this[key] = value; }
  removeAttribute(key) { delete this[key]; }
  get firstElementChild() { return this.children[0]; }
}

const dictionaries = Object.fromEntries(await Promise.all(['en', 'fa'].map(async (code) =>
  [code, JSON.parse(await readFile(new URL(`../locales/${code}.json`, import.meta.url), 'utf8'))])));
let revision = 0;
async function setup(t, { fetchAPI, downloads = fakeDownloads() } = {}) {
  const names = ['document', 'window', 'localStorage', 'matchMedia', 'location', 'browser'];
  const previous = Object.fromEntries(names.map((name) => [name, globalThis[name]]));
  const elements = new Map();
  const $ = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  for (const id of ['cSelected', 'cDone', 'cSkipped', 'cFailed']) $(id).append(new Element());
  $('q').value = '720';
  globalThis.document = { documentElement: new Element(), querySelector: (selector) => $(selector.slice(1)), querySelectorAll: () => [], createElement: () => new Element() };
  globalThis.window = {};
  globalThis.localStorage = { getItem: () => 'en', setItem: () => {} };
  globalThis.matchMedia = () => ({ matches: false, addEventListener: () => {} });
  globalThis.location = { search: '' };
  globalThis.browser = { downloads };
  t.after(() => Object.assign(globalThis, previous));
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const locale = url.pathname.match(/\/locales\/(en|fa)\.json$/)?.[1];
    if (locale) return Response.json(dictionaries[locale]);
    return fetchAPI(url, options);
  });
  await import(`../app.js?test=${revision++}`);
  const load = (id = '123') => {
    $('url').value = id;
    return $('loader').onsubmit({ preventDefault() {} });
  };
  return { $, load, downloads, statuses: () => $('list').children.map((li) => li.children[3]) };
}

const playlist = (uids = ['a', 'b', 'c']) => ({ data: { title: 'test', cnt: uids.length, video: { data: uids.map((uid) => ({ uid, title: uid, duration: 60 })) } } });
const video = { video: { can_download: true, file_link_all: [{ profile: '720p', urls: ['https://cdn.test/a.mp4'] }] } };

test('concurrent load and run attempts cannot replace the list or duplicate the queue', async (t) => {
  const pending = deferred();
  let requests = 0, starts = 0;
  const app = await setup(t, {
    fetchAPI: async (url) => {
      if (url.pathname.includes('/playlist/')) { requests++; return pending.promise; }
      return Response.json(video);
    },
    downloads: fakeDownloads({ download: async () => ++starts, search: async () => [{ state: 'complete' }] }),
  });
  const loading = app.load();
  await app.load('456');
  await app.$('go').onclick();
  assert.equal(requests, 1);
  assert.equal(app.$('go').disabled, true);
  pending.resolve(Response.json(playlist()));
  await loading;
  const running = app.$('go').onclick();
  await app.$('go').onclick();
  await app.load('789');
  await running;
  assert.equal(starts, 3);
  assert.ok(app.statuses().every((status) => status.className === 'status ok'));
  assert.equal(app.$('go').disabled, true);
  assert.equal(app.$('load').disabled, false);
  assert.equal(window.onbeforeunload, null);
});

test('Stop during link lookup aborts both workers and prevents late downloads', async (t) => {
  let lookups = 0, starts = 0;
  const app = await setup(t, {
    fetchAPI: async (url, { signal }) => {
      if (url.pathname.includes('/playlist/')) return Response.json(playlist());
      lookups++;
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
    downloads: fakeDownloads({ download: async () => ++starts }),
  });
  await app.load();
  const running = app.$('go').onclick();
  await until(() => lookups === 2);
  app.$('stop').onclick();
  await running;
  assert.equal(starts, 0);
  assert.equal(lookups, 2);
  assert.equal(app.$('go').disabled, false);
  assert.equal(app.$('load').disabled, false);
  assert.equal(app.$('stop').hidden, true);
  assert.equal(app.statuses().filter((status) => status.textContent === 'Stopped').length, 2);
});

test('the download queue never exceeds two simultaneous files', async (t) => {
  const started = [], completed = new Set();
  const downloads = fakeDownloads({
    download: async (options) => { started.push(options); return started.length; },
    search: async ({ id }) => [{ state: completed.has(id) ? 'complete' : 'in_progress', bytesReceived: 1, totalBytes: 10 }],
  });
  const app = await setup(t, { downloads, fetchAPI: async (url) => Response.json(url.pathname.includes('/playlist/') ? playlist() : video) });
  await app.load();
  const running = app.$('go').onclick();
  await until(() => started.length === 2);
  assert.equal(downloads.onChanged.listeners.size, 2);
  assert.equal(app.$('load').disabled, true);
  completed.add(1); downloads.onChanged.emit({ id: 1, state: { current: 'complete' } });
  await until(() => started.length === 3);
  assert.equal(downloads.onChanged.listeners.size, 2);
  for (const id of [2, 3]) { completed.add(id); downloads.onChanged.emit({ id, state: { current: 'complete' } }); }
  await running;
  assert.equal(downloads.onChanged.listeners.size, 0);
  assert.deepEqual(started.map((item) => item.filename), ['Aparat/test/01 - a.mp4', 'Aparat/test/02 - b.mp4', 'Aparat/test/03 - c.mp4']);
  assert.ok(app.$('list').children.every((li) => li.children[4].hidden));
});

test('Stop interrupts retry backoff and restores controls', async (t) => {
  const app = await setup(t, { fetchAPI: async (url) => url.pathname.includes('/playlist/')
    ? Response.json(playlist(['a'])) : new Response('', { status: 503 }) });
  await app.load();
  const running = app.$('go').onclick();
  await until(() => app.statuses()[0].textContent.startsWith('Retrying'));
  app.$('stop').onclick();
  await running;
  assert.equal(app.statuses()[0].textContent, 'Stopped');
  assert.equal(app.$('load').disabled, false);
});

test('retrying unfinished rows does not download completed videos again', async (t) => {
  const lookups = [], started = [];
  let provideLink = false;
  const app = await setup(t, {
    fetchAPI: async (url) => {
      if (url.pathname.includes('/playlist/')) return Response.json(playlist(['a', 'b']));
      const uid = url.pathname.split('/').at(-1);
      lookups.push(uid);
      return Response.json(uid === 'b' && !provideLink ? { video: { can_download: true, file_link_all: [] } } : video);
    },
    downloads: fakeDownloads({
      download: async (options) => { started.push(options.filename); return started.length; },
      search: async () => [{ state: 'complete' }],
    }),
  });
  await app.load(); await app.$('go').onclick();
  assert.equal(app.statuses()[0].className, 'status ok');
  assert.equal(app.statuses()[1].className, 'status err');
  provideLink = true;
  await app.$('go').onclick();
  assert.deepEqual(lookups, ['a', 'b', 'b']);
  assert.deepEqual(started, ['Aparat/test/01 - a.mp4', 'Aparat/test/02 - b.mp4']);
  assert.ok(app.statuses().every((status) => status.className === 'status ok'));
});

test('cancelling a file in Firefox does not automatically restart it', async (t) => {
  let starts = 0;
  const app = await setup(t, {
    fetchAPI: async (url) => Response.json(url.pathname.includes('/playlist/') ? playlist(['a']) : video),
    downloads: fakeDownloads({
      download: async () => ++starts,
      search: async () => [{ state: 'interrupted', error: 'USER_CANCELED' }],
    }),
  });
  await app.load(); await app.$('go').onclick();
  assert.equal(starts, 1);
  assert.equal(app.statuses()[0].textContent, 'Stopped');
});

test('selection checkbox reflects partial selection, and blocked downloads stay skipped', async (t) => {
  let lookups = 0;
  const app = await setup(t, { fetchAPI: async (url) => {
    if (url.pathname.includes('/playlist/')) return Response.json(playlist(['a', 'b']));
    lookups++;
    return Response.json({ video: { can_download: '0' } });
  } });
  await app.load();
  const checkbox = app.$('list').children[0].children[0].children[0];
  checkbox.checked = false; checkbox.onchange();
  assert.equal(app.$('all').indeterminate, true);
  assert.equal(app.$('all').checked, false);
  await app.$('go').onclick();
  await app.$('go').onclick();
  assert.equal(lookups, 1);
  assert.equal(app.$('go').disabled, true);
  assert.equal(app.statuses()[1].className, 'status skip');
});

test('an empty playlist and a failed reload leave controls usable', async (t) => {
  let requests = 0;
  const app = await setup(t, { fetchAPI: async () => ++requests === 1
    ? Response.json(playlist([])) : new Response('', { status: 404 }) });
  await app.load();
  assert.equal(app.$('go').disabled, true);
  assert.equal(app.$('all').checked, false);
  assert.equal(app.$('all').disabled, true);
  assert.match(app.$('msg').textContent, /no available videos/);
  await app.load('456');
  assert.match(app.$('msg').textContent, /HTTP 404/);
  assert.equal(app.$('load').disabled, false);
});
