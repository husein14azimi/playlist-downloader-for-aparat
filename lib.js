// Pure helpers: no DOM and no extension APIs, so they can be tested in Node.

const asciiDigits = (s) => s.replace(/[۰-۹٠-٩]/g, (d) =>
  String(d.charCodeAt(0) - (d >= '۰' ? 0x6f0 : 0x660)));
export function parsePlaylistId(input) {
  const s = asciiDigits(String(input ?? '').trim());
  const valid = (id) => /^\d+$/.test(id || '') && /[1-9]/.test(id) ? id : null;
  if (/^\d+$/.test(s)) return valid(s);
  try {
    const url = new URL(/^(?:www\.)?aparat\.com\//i.test(s) ? `https://${s}` : s);
    if (!['https:', 'http:'].includes(url.protocol) ||
        !['www.aparat.com', 'aparat.com'].includes(url.hostname) || url.username || url.password || url.port) return null;
    const path = asciiDigits(decodeURIComponent(url.pathname));
    const match = path.match(/^\/playlist\/(\d+)(?:\/.*)?$/);
    return valid(match?.[1] || asciiDigits(url.searchParams.get('playlist') || ''));
  } catch { return null; }
}

const ENTITIES = { zwnj: '\u200c', zwj: '\u200d', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", laquo: '«', raquo: '»', nbsp: ' ' };
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) => {
    if (name) return ENTITIES[name.toLowerCase()] ?? m;
    const code = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code) : '\ufffd';
  });
}

// Safe for one path segment on Windows, macOS and Linux.
export function cleanName(s, max = 100) {
  const text = decodeEntities(s).normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Keep whole Unicode characters and leave room for the numbering and extension.
  let t = '', bytes = 0, count = 0;
  const encoder = new TextEncoder();
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (count >= max || bytes + size > 200) break;
    t += char; bytes += size; count++;
  }
  t = t.replace(/^[. ]+|[. ]+$/g, '') || 'untitled';
  return /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:[. ]|$)/i.test(t) ? `_${t}` : t;
}

const finiteSeconds = (n) => Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : 0;
const slim = (v) => {
  if (!v || typeof v.uid !== 'string' || !/^[\w-]+$/.test(v.uid)) throw new Error('Invalid video in playlist');
  return {
    uid: v.uid,
    title: String(v.title ?? 'untitled'),
    duration: finiteSeconds(v.duration),
    poster: v.small_poster || v.medium_poster || v.big_poster || '',
  };
};

// Accepts both response shapes of /api/fa/v1/video/playlist/one/playlist_id/{id}:
// JSON:API (default) and the flat one Aparat's page requests with the "jsonType: simple" header.
export function parsePlaylist(j) {
  const d = j?.data;
  const a = d?.attributes || d;
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('Unexpected playlist response');
  let items;
  if (Array.isArray(d.video?.data)) {
    items = d.video.data.map(slim);
  } else if (d.attributes) {
    const videos = (Array.isArray(j.included) ? j.included : []).filter((x) => x?.type === 'Video');
    const refs = d.relationships?.video?.data;
    if (refs !== undefined && !Array.isArray(refs)) throw new Error('Unexpected playlist response');
    // included is an unordered resource pool; relationships defines playlist order.
    const byId = new Map(videos.map((x) => [String(x.id), x]));
    items = (refs ? refs.map((r) => byId.get(String(r.id))) : videos).map((x) => slim(x?.attributes));
  } else {
    throw new Error('Unexpected playlist response');
  }
  const count = Number(a.cnt);
  return {
    title: String(a.title ?? 'untitled'), channel: String(a.channel_name ?? ''),
    cover: a.small_poster || '',
    total: Number.isFinite(count) ? Math.max(items.length, Math.floor(count)) : items.length,
    items,
  };
}

// file_link_all: [{ profile: '720p', urls: ['https://…'] }, …]. Best quality not above maxHeight,
// or the lowest available if everything is above it.
export function pickLink(all, maxHeight) {
  const isHTTP = (value) => {
    try { return typeof value === 'string' && ['https:', 'http:'].includes(new URL(value).protocol); }
    catch { return false; }
  };
  const c = (Array.isArray(all) ? all : [])
    .filter((x) => x && Array.isArray(x.urls))
    .map((x) => ({ profile: String(x.profile ?? ''), h: Number(String(x.profile).match(/^(\d+)(?:p)?$/i)?.[1]) || 0, url: x.urls.find(isHTTP) }))
    .filter((x) => x.url && x.h > 0)
    .sort((a, b) => b.h - a.h);
  return c.find((x) => x.h <= maxHeight) || c[c.length - 1] || null;
}

export function fmtDuration(sec) {
  const s = Math.round(finiteSeconds(sec));
  const p = (n) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${p(h)}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`;
}

// Zero-padded position so files sort correctly: 2 digits up to 99 videos, 3 up to 999, and so on.
export const numLabel = (i, total) => String(i + 1).padStart(Math.max(2, String(total).length), '0');

// Whole hours and leftover minutes, for the caller to word in the active language.
export function totalParts(sec) {
  const m = Math.round(finiteSeconds(sec) / 60);
  return { h: Math.floor(m / 60), m: m % 60 };
}
