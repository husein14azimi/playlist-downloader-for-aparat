// Tiny runtime i18n. Strings live in locales/<code>.json (flat key -> text, with {placeholders}).
// To add a language: add locales/<code>.json and one entry to LANGS below.
export const LANGS = [
  { code: 'en', badge: 'EN', dir: 'ltr', digits: null },
  { code: 'fa', badge: 'FA', dir: 'rtl', digits: '۰۱۲۳۴۵۶۷۸۹' },
];
const DEFAULT = LANGS[0];          // source language and fallback for missing keys
export const START_LANG = 'fa';    // language used until the user picks one (Aparat is a Persian-language site)
let cur = DEFAULT, dict = {}, base = null;

const load = async (code) => (await fetch(new URL(`./locales/${code}.json`, import.meta.url))).json();

export const current = () => cur;

export function detectLang() {
  try {
    const saved = localStorage.getItem('uiLang');
    if (LANGS.some((l) => l.code === saved)) return saved;
  } catch {}
  return START_LANG;
}

export function nextLang() {
  return LANGS[(LANGS.indexOf(cur) + 1) % LANGS.length].code;
}

// remember=true stores the choice (only done when the user presses the language button).
export async function setLang(code, remember = false) {
  cur = LANGS.find((l) => l.code === code) || DEFAULT;
  base ??= await load(DEFAULT.code);
  dict = cur === DEFAULT ? base : await load(cur.code).catch(() => ({}));
  const root = document.documentElement;
  root.lang = cur.code;
  root.dir = cur.dir;
  if (remember) { try { localStorage.setItem('uiLang', cur.code); localStorage.setItem('uiDir', cur.dir); } catch {} }
  applyStatic();
}

// Text for elements marked data-i18n="key". Missing keys fall back to English, then to the key itself.
export function applyStatic() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.title = t('app.title');
}

const has = (k) => k in dict || (base && k in base);

export function t(key, params = {}) {
  const s = dict[key] ?? base?.[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m));
}

// Plural-aware: looks up "<key>.one" / "<key>.other" (per the language's plural rules); {count} is filled in.
export function tp(key, n, params = {}) {
  const form = `${key}.${new Intl.PluralRules(cur.code).select(n)}`;
  return t(has(form) ? form : `${key}.other`, { count: num(n), ...params });
}

export const num = (n, frac = 0) =>
  new Intl.NumberFormat(cur.code, { minimumFractionDigits: frac, maximumFractionDigits: frac }).format(n);

// Swap ASCII digits for the language's own (e.g. Persian) in a ready-made string like "3:16".
export const digits = (s) => (cur.digits ? String(s).replace(/\d/g, (d) => cur.digits[d]) : String(s));

// Keeps URLs, codes and error text in reading order when embedded in right-to-left sentences.
export const ltr = (s) => `\u2066${s}\u2069`;
