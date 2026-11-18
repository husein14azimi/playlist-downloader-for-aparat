import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { archiveName, buildExtensions } from '../scripts/build.mjs';

// Read ZIP entries independently of the packaging implementation.
function unzip(buffer) {
  const result = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    assert.equal(buffer.readUInt16LE(offset + 8), 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    const data = inflateRawSync(buffer.subarray(start, start + size));
    assert.equal(data.length, buffer.readUInt32LE(offset + 22));
    result.set(name, data);
    offset = start + size;
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50);
  return result;
}

const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
async function outputRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'aparat-build-'));
  t.after(async () => {
    if (dirname(resolve(root)) !== resolve(tmpdir())) throw new Error('Unsafe test cleanup path');
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test('builds installable browser-specific folders without shipping development files', async (t) => {
  const root = await outputRoot(t);
  const directories = await buildExtensions({ outputRoot: root });
  assert.equal(directories.length, 3);
  const source = await json(new URL('../manifest.json', import.meta.url));
  const manifests = {};
  for (const browser of ['firefox', 'chrome', 'edge']) {
    const directory = join(root, browser);
    const manifest = manifests[browser] = await json(join(directory, 'manifest.json'));
    assert.equal(manifest.version, source.version);
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions, source.permissions);
    assert.deepEqual(manifest.host_permissions, source.host_permissions);
    assert.deepEqual(manifest.icons, source.icons);
    const paths = [
      ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
      ...(manifest.background.scripts ?? [manifest.background.service_worker]),
      'app.html', 'app.js', 'api.js', 'downloads.js', 'lib.js', 'i18n.js', 'boot.js', 'app.css',
      'fonts/Vazirmatn-VariableFont_wght.ttf', 'fonts/OFL.txt',
      'locales/fa.json', 'locales/en.json', '_locales/en/messages.json', '_locales/fa/messages.json',
    ];
    for (const path of paths) assert.ok((await stat(join(directory, path))).isFile(), `${browser}/${path}`);
    const archived = unzip(await readFile(join(root, archiveName(browser, manifest.version))));
    const unpacked = await readdir(directory, { recursive: true, withFileTypes: true });
    assert.equal(archived.size, unpacked.filter((entry) => entry.isFile()).length);
    for (const [name, data] of archived) {
      assert.deepEqual(data, await readFile(join(directory, name)), `${browser}: ZIP content ${name}`);
      assert.ok(!name.includes('\\') && !name.startsWith('/'));
    }
    assert.deepEqual(JSON.parse(archived.get('manifest.json').toString()), manifest);
    const listing = await readdir(directory);
    for (const excluded of ['tests', 'scripts', 'manifests', '.git', 'README.md', 'package.json', 'docs']) {
      assert.ok(!listing.includes(excluded), `${browser}: should not contain ${excluded}`);
    }
  }
  assert.deepEqual(manifests.firefox, source);
  assert.deepEqual(manifests.chrome, manifests.edge);
  assert.deepEqual(manifests.chrome.background, { service_worker: 'background.js' });
  assert.equal(manifests.chrome.minimum_chrome_version, '123');
  assert.equal('browser_specific_settings' in manifests.chrome, false);
  const index = await readFile(join(root, 'index.html'), 'utf8');
  for (const browser of ['firefox', 'chrome', 'edge']) {
    assert.ok(index.includes(archiveName(browser, source.version)));
  }
});

test('rebuilding one target removes stale generated files and preserves other targets', async (t) => {
  const root = await outputRoot(t);
  await buildExtensions({ outputRoot: root });
  await writeFile(join(root, 'chrome', 'stale.js'), 'old');
  await writeFile(join(root, 'edge', 'keep.txt'), 'keep');
  const outputs = await buildExtensions({ target: 'chrome', outputRoot: root });
  assert.deepEqual(outputs, [join(root, 'chrome')]);
  assert.ok(!(await readdir(outputs[0])).includes('stale.js'));
  assert.equal(await readFile(join(root, 'edge', 'keep.txt'), 'utf8'), 'keep');
});

test('invalid build targets fail without creating output folders', async (t) => {
  const root = await outputRoot(t);
  await assert.rejects(buildExtensions({ target: '../invalid', outputRoot: root }), /Unknown browser/);
  assert.deepEqual(await readdir(root), []);
});

test('a single-browser build creates only its own package and viewer entry', async (t) => {
  const root = await outputRoot(t);
  await buildExtensions({ target: 'edge', outputRoot: root });
  const index = await readFile(join(root, 'index.html'), 'utf8');
  assert.ok(index.includes('edge/'));
  assert.ok(!index.includes('href="chrome/') && !index.includes('href="firefox/'));
  const version = (await json(join(root, 'edge/manifest.json'))).version;
  const before = await readFile(join(root, archiveName('edge', version)));
  await buildExtensions({ target: 'edge', outputRoot: root });
  assert.deepEqual(await readFile(join(root, archiveName('edge', version))), before, 'ZIPs must be reproducible');
});
