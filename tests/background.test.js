import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { ExtensionEvent } from './helpers.js';

const source = await readFile(new URL('../background.js', import.meta.url), 'utf8');

for (const namespace of ['browser', 'chrome']) {
  test(`toolbar opens the downloader and forwards only Aparat tabs using ${namespace}`, async () => {
    const opened = [], errors = [];
    const api = {
      action: { onClicked: new ExtensionEvent() },
      runtime: { getURL: (path) => `extension://test/${path}` },
      tabs: { create: async (options) => { opened.push(options.url); } },
    };
    // No window or document: this also exercises the service-worker environment.
    runInNewContext(source, { [namespace]: api, console: { error: (error) => errors.push(error) } });
    assert.equal(api.action.onClicked.listeners.size, 1);
    for (const url of ['https://www.aparat.com/playlist/123/', 'https://aparat.com/v/a?playlist=123']) {
      api.action.onClicked.emit({ url });
      const destination = new URL(opened.at(-1));
      assert.equal(destination.pathname, '/app.html');
      assert.equal(destination.searchParams.get('u'), url);
    }
    for (const tab of [undefined, {}, { url: 'https://example.com/' }, { url: 'https://www.aparat.com.evil.test/playlist/123' }]) {
      api.action.onClicked.emit(tab);
      assert.equal(opened.at(-1), 'extension://test/app.html');
    }
    api.tabs.create = async () => { throw new Error('Cannot open tab'); };
    api.action.onClicked.emit({});
    await Promise.resolve();
    assert.equal(errors[0].message, 'Cannot open tab');
  });
}
