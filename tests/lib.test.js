import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaylistId, decodeEntities, cleanName, parsePlaylist, pickLink, fmtDuration, totalParts, numLabel } from '../lib.js';

test('playlist links accept Aparat URLs, IDs and Persian/Arabic digits', () => {
  for (const [input, expected] of [
    ['1301084', '1301084'], [' ۱۳۰۱۰۸۴ ', '1301084'], ['١٣٠١٠٨٤', '1301084'],
    ['https://www.aparat.com/playlist/1301084/', '1301084'],
    ['https://aparat.com/v/abc?playlist=1301084&x=1', '1301084'],
    ['aparat.com/playlist/1301084/title', '1301084'],
    ['https://www.aparat.com/playlist/%DB%B1%DB%B2%DB%B3/', '123'],
    ['https://www.aparat.com/v/abc?playlist=%DB%B1%DB%B2%DB%B3', '123'],
  ]) assert.equal(parsePlaylistId(input), expected, input);
});

test('playlist IDs reject unrelated sites, partial matches and invalid schemes', () => {
  for (const input of [null, '', '0', '۰۰', 'https://evil.test/playlist/123',
    'https://www.aparat.com.evil.test/playlist/123', 'https://evil.test/?playlist=123',
    'https://www.aparat.com/playlist/123bad', 'https://www.aparat.com/v/x?playlist=123bad',
    'https://user@www.aparat.com/playlist/123', 'ftp://www.aparat.com/playlist/123',
    'https://www.aparat.com/other/playlist/123', 'text /playlist/123']) {
    assert.equal(parsePlaylistId(input), null, String(input));
  }
});

test('entity decoding tolerates invalid Unicode references', () => {
  assert.equal(decodeEntities('A &amp; B &#x1f600; &zwnj; &#171;'), 'A & B 😀 ‌ «');
  assert.equal(decodeEntities('&#9999999999; &#x110000; &#xD800; &#0;'), '� � � �');
  assert.equal(decodeEntities('&unknown;'), '&unknown;');
});

test('file names are safe path components across platforms', () => {
  assert.equal(cleanName('  a/b\\c:*?"<>|\u0000  '), 'a b c');
  assert.equal(cleanName('..'), 'untitled');
  assert.equal(cleanName('...hidden... '), 'hidden');
  assert.equal(cleanName('CON'), '_CON');
  assert.equal(cleanName('nul.txt'), '_nul.txt');
  assert.equal(cleanName('LPT¹'), '_LPT¹');
  assert.equal(cleanName('نام\u200cفایل\u202etest'), 'نام‌فایلtest');
  assert.equal(cleanName('a😀b', 2), 'a😀');
  assert.ok(new TextEncoder().encode(cleanName('😀'.repeat(100))).length <= 200);
  assert.equal(cleanName('e\u0301'), 'é');
});

const video = (uid, title = uid) => ({ uid, title, duration: '60' });
test('simple playlist responses handle empty lists and missing/invalid totals', () => {
  const parsed = parsePlaylist({ data: { title: 'test', video: { data: [video('abc')] } } });
  assert.equal(parsed.total, 1);
  assert.equal(parsed.items[0].duration, 60);
  assert.deepEqual(parsePlaylist({ data: { cnt: 0, video: { data: [] } } }).items, []);
  assert.equal(parsePlaylist({ data: { cnt: 'bad', video: { data: [video('abc')] } } }).total, 1);
});

test('JSON:API playlist uses relationship order and excludes unrelated videos', () => {
  const parsed = parsePlaylist({
    data: { attributes: { title: 'test', cnt: 2 }, relationships: { video: { data: [{ id: '2' }, { id: '1' }] } } },
    included: [
      { type: 'Video', id: '1', attributes: video('first') },
      { type: 'Video', id: 'outside', attributes: video('unrelated') },
      { type: 'Video', id: '2', attributes: video('second') },
      { type: 'channel', id: 'channel' },
    ],
  });
  assert.deepEqual(parsed.items.map((v) => v.uid), ['second', 'first']);
});

test('malformed playlist data fails before rendering or requesting video URLs', () => {
  for (const value of [null, {}, { data: [] }, { data: { video: { data: {} } } },
    { data: { video: { data: [video('../bad')] } } },
    { data: { attributes: {}, relationships: { video: { data: [{ id: 'missing' }] } } } }]) {
    assert.throws(() => parsePlaylist(value));
  }
  const items = parsePlaylist({ data: { video: { data: [{ ...video('a'), duration: Infinity }] } } }).items;
  assert.equal(items[0].duration, 0);
});

test('quality picks the best within the cap, or the lowest available', () => {
  const links = [1080, 240, 720, 480].map((h) => ({ profile: `${h}p`, urls: [`https://cdn.test/${h}.mp4`] }));
  assert.equal(pickLink(links, 720).h, 720);
  assert.equal(pickLink(links, 144).h, 240);
  assert.equal(pickLink(links, 2160).h, 1080);
});

test('quality ignores malformed entries and finds valid fallback URLs', () => {
  assert.equal(pickLink({}, 720), null);
  assert.equal(pickLink([null, {}, { profile: '720p', urls: 'bad' }], 720), null);
  const result = pickLink([{ profile: '720p', urls: ['', 'javascript:bad', 'https://cdn.test/video.mp4'] }], 720);
  assert.equal(result.url, 'https://cdn.test/video.mp4');
  assert.equal(pickLink([{ profile: 'unknown', urls: ['https://cdn.test/video.mp4'] }], 720), null);
});

test('time formatting and numbering handle malformed values and boundaries', () => {
  assert.equal(fmtDuration(3661), '01:01:01');
  assert.equal(fmtDuration(Infinity), '00:00');
  assert.equal(fmtDuration(-5), '00:00');
  assert.deepEqual(totalParts(3599), { h: 1, m: 0 });
  assert.deepEqual(totalParts(NaN), { h: 0, m: 0 });
  assert.equal(numLabel(0, 100), '001');
  assert.equal(numLabel(99, 100), '100');
});
