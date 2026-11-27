import { DownloadManager } from '../manager.js';
import { installBackground } from '../background.js';
import { ExtensionEvent } from './helpers.js';

export const playlistJSON = (uids = ['a', 'b', 'c']) => ({ data: { title: 'Example', cnt: uids.length,
  video: { data: uids.map((uid) => ({ uid, title: uid, duration: 60 })) } } });
export const videoJSON = { video: { can_download: true, file_link_all: [
  { profile: '720p', size: '3.51 مگابایت', urls: ['https://cdn.test/720.mp4'] },
  { profile: '360p', size: '1.48 مگابایت', urls: ['https://cdn.test/360.mp4'] },
] } };

export function harness({ request, saved, now } = {}) {
  const storage = saved || {}, records = new Map(), started = [], requests = [], alarms = new Map();
  const api = {
    runtime: { id: 'test-extension', onMessage: new ExtensionEvent() },
    tabs: { query: async () => [{ url: 'https://www.aparat.com/playlist/123/' }] },
    storage: { local: {
      get: async (key) => ({ [key]: structuredClone(storage[key]) }),
      set: async (value) => Object.assign(storage, structuredClone(value)),
    } },
    alarms: { onAlarm: new ExtensionEvent(), create: async (name, options) => alarms.set(name, options), clear: async (name) => alarms.delete(name) },
    downloads: {
      onChanged: new ExtensionEvent(), onErased: new ExtensionEvent(),
      download: async (options) => {
        started.push(options); const id = started.length;
        records.set(id, { id, state: 'in_progress', paused: false, totalBytes: 100, bytesReceived: 20 });
        return id;
      },
      search: async ({ id }) => records.has(id) ? [structuredClone(records.get(id))] : [],
      cancel: async (id) => { records.set(id, { id, state: 'interrupted', paused: false, error: 'USER_CANCELED' }); },
    },
  };
  const manager = new DownloadManager(api, {
    metadataDelay: 0, now,
    request: async (path, options) => {
      requests.push(path);
      return request ? request(path, options) : structuredClone(path.includes('/playlist/') ? playlistJSON() : videoJSON);
    },
  });
  installBackground(api, manager);
  api.runtime.sendMessage = (message) => new Promise((resolve) => {
    for (const listener of api.runtime.onMessage.listeners) listener(message, { id: api.runtime.id }, resolve);
  });
  const complete = async (id) => {
    records.set(id, { id, state: 'complete', paused: false, totalBytes: 100, bytesReceived: 100 });
    await manager.changed({ id, state: { current: 'complete' }, paused: { current: false } });
  };
  return { api, manager, storage, records, started, requests, alarms, complete };
}
