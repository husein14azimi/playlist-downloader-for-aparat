import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadFile } from '../downloads.js';
import { deferred, fakeDownloads, until } from './helpers.js';

const options = { url: 'https://cdn.test/a.mp4', filename: 'Aparat/test/01 - a.mp4' };
const clean = (api) => {
  assert.equal(api.onChanged.listeners.size, 0);
  assert.equal(api.onErased.listeners.size, 0);
};

test('tiny files already complete at registration settle and remove listeners', async () => {
  const api = fakeDownloads({ search: async () => [{ state: 'complete', totalBytes: -1 }] });
  await downloadFile(api, options);
  clean(api);
});

test('poll recovers missed terminal events even with unknown total size', async () => {
  let searches = 0;
  const api = fakeDownloads({ search: async () => [{ state: ++searches > 1 ? 'complete' : 'in_progress', totalBytes: -1 }] });
  await downloadFile(api, options, { pollInterval: 1 });
  assert.equal(searches, 2);
  clean(api);
});

test('progress is reported only while active and completion wins over in-flight polling', async () => {
  const pending = deferred();
  const progress = [];
  const api = fakeDownloads({ search: () => pending.promise });
  const task = downloadFile(api, options, { onProgress: (item) => progress.push(item) });
  await until(() => api.onChanged.listeners.size);
  api.onChanged.emit({ id: 1, state: { current: 'complete' } });
  await task;
  pending.resolve([{ state: 'in_progress', totalBytes: 100, bytesReceived: 50 }]);
  await Promise.resolve();
  assert.deepEqual(progress, []);
  clean(api);
});

test('Stop during startup cancels the download as soon as its ID is returned', async () => {
  const pending = deferred(), controller = new AbortController(), cancelled = [];
  const api = fakeDownloads({ download: () => pending.promise, cancel: async (id) => { cancelled.push(id); } });
  const task = downloadFile(api, options, { signal: controller.signal });
  controller.abort();
  pending.resolve(42);
  await assert.rejects(task, { name: 'AbortError' });
  assert.deepEqual(cancelled, [42]);
  clean(api);
});

test('Stop settles without needing a browser onChanged cancellation event', async () => {
  const controller = new AbortController();
  const api = fakeDownloads();
  const task = downloadFile(api, options, { signal: controller.signal });
  await until(() => api.onChanged.listeners.size);
  controller.abort();
  await assert.rejects(task, { name: 'AbortError' });
  clean(api);
});

test('completion racing with a rejected cancel remains successful', async () => {
  const pending = deferred(), controller = new AbortController();
  const api = fakeDownloads({
    download: () => pending.promise,
    cancel: async () => { throw new Error('Already complete'); },
    search: async () => [{ state: 'complete' }],
  });
  const task = downloadFile(api, options, { signal: controller.signal });
  controller.abort(); pending.resolve(1);
  await task;
  clean(api);
});

test('a rejected cancellation keeps tracking the original file and reports the failure', async () => {
  const controller = new AbortController(), errors = [];
  const api = fakeDownloads({ cancel: async () => { throw new Error('Cancel failed'); } });
  const task = downloadFile(api, options, { signal: controller.signal, onCancelError: (error) => errors.push(error.message) });
  await until(() => api.onChanged.listeners.size);
  controller.abort();
  await until(() => errors.length);
  assert.deepEqual(errors, ['Cancel failed']);
  assert.equal(api.onChanged.listeners.size, 1);
  api.onChanged.emit({ id: 1, state: { current: 'complete' } });
  await task;
  clean(api);
});

test('interrupted and erased downloads reject and release listeners', async () => {
  for (const mode of ['interrupted', 'erased']) {
    const api = fakeDownloads();
    const task = downloadFile(api, options);
    await until(() => api.onChanged.listeners.size);
    if (mode === 'erased') api.onErased.emit(1);
    else api.onChanged.emit({ id: 1, state: { current: 'interrupted' }, error: { current: 'NETWORK_FAILED' } });
    await assert.rejects(task, mode === 'erased' ? /removed/ : /NETWORK_FAILED/);
    clean(api);
  }
});

test('transient search failure does not retry or duplicate a live download', async () => {
  let starts = 0, searches = 0;
  const api = fakeDownloads({
    download: async () => { starts++; return 1; },
    search: async () => { if (++searches === 1) throw new Error('Temporary search error'); return [{ state: 'complete' }]; },
  });
  await downloadFile(api, options, { pollInterval: 1 });
  assert.equal(starts, 1);
  assert.equal(searches, 2);
  clean(api);
});

test('polling is serialized when searches are slow', async () => {
  let searches = 0;
  const pending = deferred();
  const api = fakeDownloads({ search: () => { searches++; return pending.promise; } });
  const task = downloadFile(api, options, { pollInterval: 1 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(searches, 1);
  pending.resolve([{ state: 'complete' }]);
  await task;
  clean(api);
});

test('a removed record and a failed startup reject without leaking resources', async () => {
  const api = fakeDownloads({ search: async () => [] });
  await assert.rejects(downloadFile(api, options), /removed/);
  clean(api);
  await assert.rejects(downloadFile(fakeDownloads({ download: async () => { throw new Error('Denied'); } }), options), /Denied/);
});
