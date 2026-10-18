import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'dist', 'firefox');
const runtimeDirs = [
  'alignment',
  'content',
  'icons',
  'matching',
  'options',
  'shared',
  'storage',
  'subtitles'
];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const dir of runtimeDirs) {
  fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
}
fs.mkdirSync(path.join(out, 'background'), { recursive: true });
fs.copyFileSync(
  path.join(root, 'firefox', 'background', 'background.js'),
  path.join(out, 'background', 'background.js')
);
fs.copyFileSync(
  path.join(root, 'firefox', 'manifest.json'),
  path.join(out, 'manifest.json')
);

const manifest = JSON.parse(
  fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')
);
if (process.env.FIREFOX_ADDON_ID) {
  manifest.browser_specific_settings.gecko.id = process.env.FIREFOX_ADDON_ID;
  fs.writeFileSync(
    path.join(out, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8'
  );
}
if (manifest.manifest_version !== 2) {
  throw new Error('Firefox build must stay on Manifest V2 for Android support.');
}
for (const script of manifest.background.scripts) {
  if (!fs.existsSync(path.join(out, script))) {
    throw new Error('Missing background script: ' + script);
  }
}
const app = fs.readFileSync(path.join(out, 'content', 'app.js'), 'utf8');
if (!app.includes('FirstLine') || !app.includes('AnchorSync')) {
  throw new Error('Content app is missing sync modules.');
}
console.log('Firefox build ready:', out);
console.log('Files:', fs.readdirSync(out).length, 'top-level entries');
