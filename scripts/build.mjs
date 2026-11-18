import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeZip } from './zip.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const targets = ['firefox', 'chrome', 'edge'];
export const archiveName = (browser, version) => `playlist-downloader-aparat-${browser}-${version}.zip`;
const files = [
  'app.html', 'app.css', 'app.js', 'api.js', 'background.js', 'boot.js',
  'downloads.js', 'i18n.js', 'lib.js', '_locales', 'locales', 'icons', 'fonts',
];

export async function buildExtensions({ target = 'all', outputRoot = resolve(projectRoot, 'dist') } = {}) {
  if (target !== 'all' && !targets.includes(target)) throw new Error(`Unknown browser: ${target}`);
  const base = JSON.parse(await readFile(resolve(projectRoot, 'manifest.json'), 'utf8'));
  const chromium = JSON.parse(await readFile(resolve(projectRoot, 'manifests/chromium.json'), 'utf8'));
  const outputs = [];
  for (const browser of target === 'all' ? targets : [target]) {
    const manifest = structuredClone(base);
    if (browser !== 'firefox') {
      Object.assign(manifest, chromium);
      delete manifest.browser_specific_settings;
    }
    const root = resolve(outputRoot);
    const directory = resolve(root, browser);
    // Only replace a known generated browser folder directly inside the output root.
    if (dirname(directory) !== root || directory === projectRoot) throw new Error('Unsafe build path');
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    for (const file of files) await cp(resolve(projectRoot, file), resolve(directory, file), { recursive: true });
    await writeFile(resolve(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeZip(directory, resolve(root, archiveName(browser, base.version)));
    outputs.push(directory);
  }
  const available = [];
  for (const browser of targets) {
    try {
      const manifest = JSON.parse(await readFile(resolve(outputRoot, browser, 'manifest.json'), 'utf8'));
      if (manifest.version !== base.version) continue;
      await access(resolve(outputRoot, archiveName(browser, base.version)));
      available.push(browser);
    } catch { /* This target has not been built yet. */ }
  }
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  await writeFile(resolve(outputRoot, 'index.html'), `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aparat extension builds</title>
<style>body{font:16px/1.6 system-ui;max-width:850px;margin:48px auto;padding:0 24px;background:#f5f5f9;color:#222}h1{font-size:26px}article{background:white;padding:20px;border-radius:12px;margin:16px 0}a{color:#b50d42;margin-right:20px}code{background:#e8e8f0;padding:2px 6px;border-radius:4px}</style>
<h1>Playlist Downloader for Aparat — ${escape(base.version)}</h1>
<p>Ready-to-install browser builds. Extract a ZIP before using Load unpacked.</p>
${available.map((browser) => `<article><h2>${{ firefox: 'Firefox', chrome: 'Google Chrome', edge: 'Microsoft Edge' }[browser]}</h2>
<p><a href="${escape(archiveName(browser, base.version))}" download>Download ZIP</a><a href="${browser}/">Browse unpacked files</a></p>
<p>${browser === 'firefox' ? 'Open <code>about:debugging#/runtime/this-firefox</code>, choose Load Temporary Add-on, then select the ZIP or manifest.json.' : `Open <code>${browser}://extensions</code>, enable Developer mode, choose Load unpacked, then select the extracted ${browser} folder.`}</p></article>`).join('\n')}
<p>Keep the unpacked folder in place after installation. Keep the downloader tab open while videos download.</p>
</html>\n`);
  return outputs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const positional = args.filter((arg) => arg !== '--open');
    if (positional.length > 1) throw new Error('Usage: node scripts/build.mjs [all|firefox|chrome|edge] [--open]');
    const outputs = await buildExtensions({ target: positional[0] ?? 'all' });
    const version = JSON.parse(await readFile(resolve(projectRoot, 'manifest.json'), 'utf8')).version;
    console.table(outputs.map((directory) => ({ browser: basename(directory), folder: directory, zip: resolve(dirname(directory), archiveName(basename(directory), version)) })));
    const index = resolve(projectRoot, 'dist/index.html');
    console.log(`Build viewer: ${index}`);
    if (args.includes('--open')) {
      const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const child = spawn(command, [index], { stdio: 'ignore', detached: true, windowsHide: true });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
