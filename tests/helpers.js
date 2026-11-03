import assert from 'node:assert/strict';

export class ExtensionEvent {
  listeners = new Set();
  addListener = (listener) => this.listeners.add(listener);
  removeListener = (listener) => this.listeners.delete(listener);
  emit = (...args) => { for (const listener of this.listeners) listener(...args); };
}

export function fakeDownloads(overrides = {}) {
  return {
    onChanged: new ExtensionEvent(), onErased: new ExtensionEvent(),
    download: async () => 1,
    search: async () => [{ id: 1, state: 'in_progress', totalBytes: 100, bytesReceived: 50 }],
    cancel: async () => {},
    ...overrides,
  };
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail('Timed out waiting for expected state');
}
