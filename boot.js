// Classic script in <head>: runs before first paint so the saved theme, language and direction are in
// place with no flash, and reveals the page even if the app script fails.
// Language defaults to Persian (RTL) until the user picks one with the globe button.
(() => {
  const d = document.documentElement;
  try {
    const theme = localStorage.getItem('theme');
    if (theme === 'light' || theme === 'dark') d.dataset.theme = theme;
    const lang = localStorage.getItem('uiLang') || 'fa';
    d.lang = lang;
    d.dir = localStorage.getItem('uiDir') || (lang === 'fa' ? 'rtl' : 'ltr');
  } catch {}
  setTimeout(() => { d.dataset.ready = '1'; }, 1500);
})();
