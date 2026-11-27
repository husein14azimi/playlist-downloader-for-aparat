import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { harness } from './manager-helpers.js';
import { until } from './helpers.js';

class Element {
  children = []; dataset = {}; disabled = false; hidden = false; checked = true;
  textContent = ''; value = ''; className = '';
  append(...elements) { this.children.push(...elements); }
  replaceChildren(...elements) { this.children = elements; }
  setAttribute(key, value) { this[key] = value; }
  getAttribute(key) { return this[key] ?? null; }
  get firstElementChild() { return this.children[0]; }
}
const dictionaries = Object.fromEntries(await Promise.all(['en', 'fa'].map(async (code) =>
  [code, JSON.parse(await readFile(new URL(`../locales/${code}.json`, import.meta.url), 'utf8'))])));
let revision = 0;
async function setup(t, namespace, h = harness()) {
  const keys = ['document', 'window', 'localStorage', 'matchMedia', 'browser', 'chrome'];
  const previous = Object.fromEntries(keys.map((key) => [key, globalThis[key]]));
  const elements = new Map(), handlers = {};
  const $ = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  for (const id of ['cSelected', 'cDone', 'cSkipped', 'cFailed']) $(id).append(new Element());
  globalThis.document = { documentElement: new Element(), querySelector: (selector) => $(selector.slice(1)), querySelectorAll: () => [], createElement: () => new Element() };
  globalThis.window = { addEventListener: (name, fn) => { handlers[name] = fn; } };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.localStorage = { getItem: (key) => key === 'uiLang' ? 'en' : null, setItem() {} };
  globalThis.browser = undefined; globalThis.chrome = undefined; globalThis[namespace] = h.api;
  t.mock.method(globalThis, 'fetch', async (url) => Response.json(dictionaries[url.pathname.endsWith('fa.json') ? 'fa' : 'en']));
  t.after(() => { handlers.pagehide?.(); Object.assign(globalThis, previous); });
  await import(`../app.js?popup=${revision++}`);
  await until(() => h.manager.state.rows.every((row) => row.details === 'ready'));
  // Refresh via an unchanged selection without overwriting saved selections.
  if (h.manager.state.rows.length) {
    const checkbox = $('list').children[0].children[0].children[0];
    checkbox.checked = h.manager.state.rows[0].selected;
    await checkbox.onchange();
  }
  const row = (i) => {
    const li = $('list').children[i], controls = li.children[4];
    return { cb: li.children[0].children[0], status: li.children[3], quality: controls.children[0].children[1], size: controls.children[1], single: controls.children[3] };
  };
  return { $, row, close: () => handlers.pagehide?.(), h };
}

for (const namespace of ['browser', 'chrome']) describe(`popup using ${namespace}`, () => {
  test('auto-loads the active playlist and renders available qualities and per-quality sizes', async (t) => {
    const app = await setup(t, namespace);
    assert.equal(app.$('list').children.length, 3);
    assert.deepEqual(app.row(0).quality.children.map((option) => option.value), ['720', '360']);
    assert.ok(app.row(0).size.textContent.includes('3.51'));
    app.row(0).quality.value = '360';
    await app.row(0).quality.onchange();
    assert.equal(app.row(0).cb.disabled, false);
    assert.equal(app.row(0).single.disabled, false);
    assert.ok(app.row(0).size.textContent.includes('1.48'));
    assert.equal(app.row(1).quality.value, '720');
  });

  test('single download works for an unchecked row without enqueuing other rows', async (t) => {
    const app = await setup(t, namespace);
    app.row(1).cb.checked = false; await app.row(1).cb.onchange();
    assert.equal(app.$('all').indeterminate, true);
    app.row(1).quality.value = '360'; await app.row(1).quality.onchange();
    await app.row(1).single.onclick();
    await until(() => app.h.started.length === 1);
    assert.equal(app.h.started[0].url, 'https://cdn.test/360.mp4');
    assert.equal(app.h.started[0].filename, 'Aparat/Example/02 - b.mp4');
    await app.h.complete(1);
  });

  test('shared quality updates sizes, survives reopening, and permits individual overrides', async (t) => {
    const app = await setup(t, namespace);
    app.row(2).cb.checked = false; await app.row(2).cb.onchange();
    app.$('quality-all').value = '360'; await app.$('quality-all').onchange();
    for (let i = 0; i < 3; i++) {
      assert.equal(app.row(i).quality.value, '360');
      assert.ok(app.row(i).size.textContent.includes('1.48'));
    }
    assert.equal(app.row(2).cb.checked, false);
    app.close();
    const reopened = await setup(t, namespace, app.h);
    assert.equal(reopened.$('quality-all').value, '360');
    reopened.row(1).quality.value = '720'; await reopened.row(1).quality.onchange();
    assert.equal(reopened.$('quality-all').value, '');
    assert.equal(reopened.row(0).quality.value, '360');
    assert.ok(reopened.row(1).size.textContent.includes('3.51'));
    await reopened.$('go').onclick();
    await until(() => app.h.started.length === 2);
    assert.equal(reopened.$('quality-all').disabled, true);
    assert.deepEqual(app.h.started.map((item) => item.url), ['https://cdn.test/360.mp4', 'https://cdn.test/720.mp4']);
    await app.h.manager.handle('stop');
  });

  test('closing and reopening the popup preserves selections, qualities, and active downloads', async (t) => {
    const app = await setup(t, namespace);
    app.row(0).quality.value = '360'; await app.row(0).quality.onchange();
    app.row(2).cb.checked = false; await app.row(2).cb.onchange();
    await app.$('go').onclick();
    await until(() => app.h.started.length === 2);
    app.close();
    await app.h.complete(1); await app.h.complete(2);
    const reopened = await setup(t, namespace, app.h);
    assert.equal(reopened.row(0).quality.value, '360');
    assert.equal(reopened.row(2).cb.checked, false);
    assert.equal(app.h.started.length, 2);
    assert.equal(reopened.row(0).status.className, 'status ok');
    assert.equal(app.h.requests.filter((path) => path.includes('/playlist/')).length, 1);
  });

  test('unavailable sizes are shown honestly without synthetic size estimates', async (t) => {
    const h = harness({ request: async (path) => path.includes('/playlist/')
      ? { data: { title: 'Test', video: { data: [{ uid: 'a', title: 'a', duration: 1 }] } } }
      : { video: { can_download: true, file_link_all: [{ profile: '720p', urls: ['https://cdn.test/a.mp4'] }] } } });
    const app = await setup(t, namespace, h);
    assert.equal(app.row(0).size.textContent, 'Size: Unavailable');
  });

  test('thumbnails use lazy HTTP images and missing, unsafe or broken posters leave titles usable', async (t) => {
    const h = harness({ request: async (path) => path.includes('/playlist/')
      ? { data: { title: 'Test', video: { data: [
        { uid: 'a', title: '<b>Title</b>', small_poster: 'https://cdn.test/poster.jpg' },
        { uid: 'b', title: 'No poster' },
        { uid: 'c', title: 'Unsafe poster', small_poster: 'javascript:alert(1)' },
      ] } } } : { video: { file_link_all: [] } } });
    const app = await setup(t, namespace, h);
    const info = (i) => app.$('list').children[i].children[2];
    const image = info(0).children[0];
    assert.equal(image.src, 'https://cdn.test/poster.jpg');
    assert.equal(image.loading, 'lazy');
    assert.equal(image.referrerPolicy, 'no-referrer');
    assert.equal(image.alt, '');
    image.onerror();
    assert.equal(image.hidden, true);
    assert.equal(info(0).children[1].textContent, '<b>Title</b>');
    assert.equal(info(1).children[0].hidden, true);
    assert.equal(info(2).children[0].hidden, true);
    assert.equal(info(2).children[0].src, undefined);
  });

  test('browser cancellation gives neutral external-manager guidance while Stop stays distinct', async (t) => {
    const app = await setup(t, namespace);
    await app.$('go').onclick();
    await until(() => app.h.manager.state.rows.filter((row) => row.downloadId != null).length === 2);
    app.h.records.set(1, { id: 1, state: 'interrupted', paused: false, error: 'USER_CANCELED' });
    await app.h.manager.changed({ id: 1, state: { current: 'interrupted' }, error: { current: 'USER_CANCELED' } });
    await app.row(0).cb.onchange();
    assert.equal(app.row(0).status.textContent, 'Cancelled in browser');
    assert.ok(app.$('msg').textContent.includes('If an external manager took over'));
    assert.equal(app.h.started.length, 2);
    await app.$('stop').onclick();
    assert.equal(app.row(1).status.textContent, 'Stopped');
  });
});
