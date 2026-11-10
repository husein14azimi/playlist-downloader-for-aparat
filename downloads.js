// Firefox's Promise API lets failures propagate without unchecked runtime.lastError callbacks.
export async function downloadFile(downloads, options, { signal, onProgress, onCancelError, pollInterval = 1000 } = {}) {
  signal?.throwIfAborted();
  const id = await downloads.download({ ...options, conflictAction: 'uniquify' });
  if (!Number.isInteger(id)) throw new Error('Could not start download');

  return new Promise((resolve, reject) => {
    let finished = false, timer, revision = 0;
    let item = { state: 'in_progress', paused: false, totalBytes: -1, bytesReceived: 0 };
    const finish = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      downloads.onChanged.removeListener(changed);
      downloads.onErased.removeListener(erased);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const settle = (changes) => {
      item = { ...item, ...changes };
      if (item.state === 'complete') finish();
      // Firefox represents paused downloads as interrupted with USER_CANCELED.
      else if (item.state === 'interrupted' && !item.paused) finish(new Error(item.error || 'interrupted'));
      if (!finished) onProgress?.(item);
    };
    const changed = (delta) => {
      if (delta.id !== id) return;
      revision++;
      const changes = {};
      for (const key of ['state', 'error', 'paused']) {
        if (delta[key]) changes[key] = delta[key].current;
      }
      settle(changes);
    };
    const erased = (erasedId) => {
      if (erasedId === id) finish(new Error('Download removed'));
    };
    const abort = async () => {
      try {
        await downloads.cancel(id);
        finish(signal.reason);
      } catch (error) {
        // A completion can race with cancellation. Preserve a completed download.
        try {
          const [item] = await downloads.search({ id });
          if (item?.state === 'complete') return finish();
          if (!item || (item.state === 'interrupted' && !item.paused)) return finish(signal.reason);
        } catch {}
        // Do not abandon a live download or retry it under another ID if cancellation fails.
        if (!finished) onCancelError?.(error);
      }
    };
    const poll = async () => {
      const observedRevision = revision;
      try {
        const [item] = await downloads.search({ id });
        if (finished) return;
        // A change event is newer than a snapshot requested before that event.
        if (observedRevision === revision) {
          if (!item) return finish(new Error('Download removed'));
          settle(item);
        }
      } catch {
        // A search failure must not trigger a retry while the original file is downloading.
        // Events still settle the task; later polls can recover byte progress.
      }
      if (!finished) timer = setTimeout(poll, pollInterval);
    };
    downloads.onChanged.addListener(changed);
    downloads.onErased.addListener(erased);
    signal?.addEventListener('abort', abort, { once: true });
    // Covers both tiny files finishing before registration and Stop during download().
    if (signal?.aborted) void abort();
    void poll();
  });
}
