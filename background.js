import { DownloadManager, QUEUE_ALARM } from './manager.js';

export function installBackground(api, manager = new DownloadManager(api)) {
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== api.runtime.id || message?.type !== 'playlist-downloader') return false;
    const reply = (response) => {
      // The popup may close while its command is completing; queue work must still finish.
      try { sendResponse(response); } catch {}
    };
    manager.handle(message.action, message.data).then(
      (state) => reply({ ok: true, state }),
      (error) => reply({ ok: false, error: error.message }),
    );
    return true;
  });
  api.downloads.onChanged.addListener((delta) => { void manager.changed(delta).catch(console.error); });
  api.downloads.onErased.addListener((id) => { void manager.erased(id).catch(console.error); });
  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === QUEUE_ALARM) void manager.recover().catch(console.error);
  });
  void manager.ready.catch(console.error);
  return manager;
}

const api = globalThis.browser ?? globalThis.chrome;
if (api?.runtime?.onMessage) installBackground(api);
