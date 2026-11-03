import test from 'node:test';
import assert from 'node:assert/strict';
import { getJSON, delay } from '../api.js';

test('API requests stay on Aparat and include login credentials', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.origin, 'https://www.aparat.com');
    assert.equal(options.credentials, 'include');
    return Response.json({ ok: true });
  });
  assert.deepEqual(await getJSON('/api/example'), { ok: true });
  await assert.rejects(getJSON('https://evil.test/api'), /Invalid API URL/);
});

test('API propagates HTTP and JSON parsing failures', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 429 }));
  await assert.rejects(getJSON('/api/example'), /HTTP 429/);
  fetch.mock.mockImplementation(async () => new Response('broken json'));
  await assert.rejects(getJSON('/api/example'), SyntaxError);
});

const untilAbort = (signal) => new Promise((resolve, reject) => {
  signal.addEventListener('abort', () => reject(signal.reason), { once: true });
});

test('request timeout also covers a stalled JSON body', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, { signal }) => ({ ok: true, json: () => untilAbort(signal) }));
  await assert.rejects(getJSON('/api/example', { timeout: 5 }), { name: 'TimeoutError' });
});

test('Stop aborts pending API requests and retry waits', async (t) => {
  t.mock.method(globalThis, 'fetch', (url, { signal }) => untilAbort(signal));
  const controller = new AbortController();
  const request = getJSON('/api/example', { signal: controller.signal });
  const wait = delay(60000, controller.signal);
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
  await assert.rejects(wait, { name: 'AbortError' });
  await assert.rejects(getJSON('/api/example', { signal: controller.signal }), { name: 'AbortError' });
});
