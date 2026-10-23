// The toolbar icon opens the downloader in a tab. A tab (unlike a popup) stays alive while
// downloads are queued. If the current tab is an Aparat page, its URL is passed along.
chrome.action.onClicked.addListener((tab) => {
  const base = chrome.runtime.getURL('app.html');
  const onAparat = tab?.url && /^https:\/\/www\.aparat\.com\//.test(tab.url);
  chrome.tabs.create({ url: onAparat ? `${base}?u=${encodeURIComponent(tab.url)}` : base });
});
