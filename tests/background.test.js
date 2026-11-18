import test from 'node:test';
import assert from 'node:assert/strict';
import { installBackground } from '../background.js';
import { ExtensionEvent } from './helpers.js';

test('background registers handlers synchronously, replies asynchronously, and rejects foreign senders', async () => {
  const calls = [];
  const api = {
    runtime: { id: 'own', onMessage: new ExtensionEvent() },
    downloads: { onChanged: new ExtensionEvent(), onErased: new ExtensionEvent() },
    alarms: { onAlarm: new ExtensionEvent() },
  };
  const manager = {
    ready: Promise.resolve(),
    handle: async (action, data) => { calls.push([action, data]); return { rows: [] }; },
    changed: async () => {}, erased: async () => {}, recover: async () => {},
  };
  installBackground(api, manager);
  assert.equal(api.downloads.onChanged.listeners.size, 1);
  assert.equal(api.downloads.onErased.listeners.size, 1);
  assert.equal(api.alarms.onAlarm.listeners.size, 1);
  const [listener] = api.runtime.onMessage.listeners;
  assert.equal(listener({ type: 'playlist-downloader', action: 'stop' }, { id: 'foreign' }, () => assert.fail()), false);
  const result = await new Promise((resolve) => {
    assert.equal(listener({ type: 'playlist-downloader', action: 'snapshot' }, { id: 'own' }, resolve), true);
  });
  assert.deepEqual(result, { ok: true, state: { rows: [] } });
  assert.deepEqual(calls, [['snapshot', undefined]]);
  // A reply to a popup that has already closed must not produce an unhandled rejection.
  listener({ type: 'playlist-downloader', action: 'snapshot' }, { id: 'own' }, () => { throw new Error('Popup closed'); });
  await new Promise((resolve) => setImmediate(resolve));
});
