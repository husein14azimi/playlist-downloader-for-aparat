// Pure helpers: no DOM and no extension APIs, so they can be tested in Node.

export function parsePlaylistId(input) {
  const s = String(input || '').trim();
  const m = s.match(/\/playlist\/(\d+)/) || s.match(/[?&]playlist=(\d+)/) || s.match(/^(\d+)$/);
  return m ? m[1] : null;
}

const ENTITIES = { zwnj: '\u200c', zwj: '\u200d', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", laquo: '«', raquo: '»', nbsp: ' ' };
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, dec, hex, name) =>
    dec ? String.fromCodePoint(+dec) : hex ? String.fromCodePoint(parseInt(hex, 16)) : (ENTITIES[name.toLowerCase()] ?? m));
}

// Safe for one path segment on Windows, macOS and Linux.
export function cleanName(s, max = 100) {
  const t = decodeEntities(s)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, '');
  return t || 'untitled';
}

const slim = (v) => ({
  uid: v.uid,
  title: v.title,
  duration: +v.duration || 0,
  poster: v.small_poster || v.medium_poster || v.big_poster || '',
});

// Accepts both response shapes of /api/fa/v1/video/playlist/one/playlist_id/{id}:
// JSON:API (default) and the flat one Aparat's page requests with the "jsonType: simple" header.
export function parsePlaylist(j) {
  const d = j?.data;
  if (d?.video?.data) {
    return { title: d.title, channel: d.channel_name, cover: d.small_poster || '', total: +d.cnt, items: d.video.data.map(slim) };
  }
  const a = d?.attributes;
  if (!a) throw new Error('Unexpected playlist response');
  const items = (j.included || []).filter((x) => x.type === 'Video').map((x) => slim(x.attributes));
  return { title: a.title, channel: a.channel_name, cover: a.small_poster || '', total: +a.cnt, items };
}

// file_link_all: [{ profile: '720p', urls: ['https://…'] }, …]. Best quality not above maxHeight,
// or the lowest available if everything is above it.
export function pickLink(all, maxHeight) {
  const c = (all || [])
    .map((x) => ({ profile: x.profile, h: parseInt(x.profile, 10) || 0, url: x.urls?.[0] }))
    .filter((x) => x.url)
    .sort((a, b) => b.h - a.h);
  return c.find((x) => x.h <= maxHeight) || c[c.length - 1] || null;
}

export function fmtDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const p = (n) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${p(h)}:${p(m)}:${p(r)}` : `${p(m)}:${p(r)}`;
}

// Zero-padded position so files sort correctly: 2 digits up to 99 videos, 3 up to 999, and so on.
export const numLabel = (i, total) => String(i + 1).padStart(Math.max(2, String(total).length), '0');

// Whole hours and leftover minutes, for the caller to word in the active language.
export function totalParts(sec) {
  const m = Math.round((sec || 0) / 60);
  return { h: Math.floor(m / 60), m: m % 60 };
}
