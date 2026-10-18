/*
 * Package the Chrome/Chromium (Manifest V3) build for install on Android
 * Chromium forks such as Kiwi, which load unpacked extensions from storage.
 *
 *   1. npm run pack:chrome  ->  dist/smart-subtitle-chrome-<version>.zip
 *   2. Copy the ZIP to the phone, unzip it.
 *   3. Kiwi -> Settings -> Extensions -> enable Developer mode ->
 *      "Load unpacked extension" -> pick the unzipped folder.
 *
 * The archive root is the add-on itself (manifest.json at the top level), which
 * is what both an unpacked load and a "load from file" flow expect.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const out = path.join(root, 'dist', 'chrome');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')
);
const version = manifest.version;

const runtimeEntries = [
  'manifest.json',
  'background',
  'content',
  'subtitles',
  'alignment',
  'matching',
  'storage',
  'options',
  'offscreen',
  'shared',
  'icons'
];

for (const entry of runtimeEntries) {
  if (!fs.existsSync(path.join(root, entry))) {
    console.error('Missing runtime entry:', entry);
    process.exit(1);
  }
}

const background = path.join(out, 'background', 'service-worker.js');
if (manifest.manifest_version !== 3) {
  console.error('Chrome build must stay on Manifest V3.');
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const entry of runtimeEntries) {
  const source = path.join(root, entry);
  const target = path.join(out, entry);
  if (fs.statSync(source).isDirectory()) {
    fs.cpSync(source, target, { recursive: true });
  } else {
    fs.copyFileSync(source, target);
  }
}
if (!fs.existsSync(background)) {
  console.error('Service worker missing from the packaged build.');
  process.exit(1);
}

const webExtCli = path.join(root, 'node_modules', 'web-ext', 'bin', 'web-ext.js');
const target = path.join(root, 'dist', `smart-subtitle-chrome-${version}.zip`);
execFileSync(
  process.execPath,
  [
    webExtCli,
    'build',
    '--source-dir',
    out,
    '--artifacts-dir',
    path.join(root, 'dist'),
    '--filename',
    path.basename(target),
    '--overwrite-dest'
  ],
  { cwd: root, stdio: 'inherit' }
);

console.log('Unpacked build:', out);
console.log('ZIP for phone transfer:', target);
