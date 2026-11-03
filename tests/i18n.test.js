import test from 'node:test';
import assert from 'node:assert/strict';
import { deferred, until } from './helpers.js';

let revision = 0;
async function setup(t, fetch) {
  const previous = { document: globalThis.document, localStorage: globalThis.localStorage };
  const saved = new Map();
  globalThis.document = { documentElement: {}, querySelectorAll: () => [] };
  globalThis.localStorage = { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  t.after(() => Object.assign(globalThis, previous));
  t.mock.method(globalThis, 'fetch', fetch);
  const i18n = await import(`../i18n.js?test=${revision++}`);
  return { i18n, saved };
}

test('language fallback, Persian digits, direction, plurals and saved choice', async (t) => {
  const { i18n, saved } = await setup(t, async (url) => Response.json(url.pathname.endsWith('en.json')
    ? { greeting: 'Hello {name}', 'items.one': '{count} item', 'items.other': '{count} items', fallback: 'English' }
    : { greeting: 'سلام {name}', 'items.one': '{count} مورد', 'items.other': '{count} مورد' }));
  assert.equal(i18n.detectLang(), 'fa');
  await i18n.setLang('fa', true);
  assert.equal(document.documentElement.dir, 'rtl');
  assert.equal(i18n.t('greeting', { name: 'علی' }), 'سلام علی');
  assert.equal(i18n.t('fallback'), 'English');
  assert.equal(i18n.digits('01:23'), '۰۱:۲۳');
  assert.equal(i18n.tp('items', 2), '۲ مورد');
  assert.equal(saved.get('uiLang'), 'fa');
  assert.equal(i18n.t('toString'), 'toString');
  await i18n.setLang('en');
  assert.equal(document.documentElement.dir, 'ltr');
  assert.equal(i18n.tp('items', 1), '1 item');
});

test('overlapping language requests commit only the most recent choice', async (t) => {
  const pending = deferred();
  let requested = false;
  const { i18n, saved } = await setup(t, async (url) => {
    if (url.pathname.endsWith('fa.json')) { requested = true; return pending.promise; }
    return Response.json({ greeting: 'Hello' });
  });
  const first = i18n.setLang('fa', true);
  await until(() => requested);
  await i18n.setLang('en', true);
  pending.resolve(Response.json({ greeting: 'سلام' }));
  await first;
  assert.equal(i18n.current().code, 'en');
  assert.equal(i18n.t('greeting'), 'Hello');
  assert.equal(saved.get('uiLang'), 'en');
});

test('translation failures retain the current language and can be retried', async (t) => {
  let attempts = 0;
  const { i18n } = await setup(t, async (url) => {
    if (url.pathname.endsWith('fa.json')) {
      if (++attempts === 1) return new Response('', { status: 500 });
      return Response.json({ greeting: 'سلام' });
    }
    return Response.json({ greeting: 'Hello' });
  });
  await i18n.setLang('en');
  await assert.rejects(i18n.setLang('fa'), /HTTP 500/);
  assert.equal(i18n.current().code, 'en');
  await i18n.setLang('fa');
  assert.equal(i18n.t('greeting'), 'سلام');
});
