/*
 * Pack dist/firefox into a self-distributable ZIP that Android Firefox can
 * install without going through AMO.
 *
 * Android Firefox ignores `xpinstall.signatures.required` and has no
 * about:config switch to relax it, so an unsigned add-on cannot be sideloaded
 * the way a desktop "unbranded" build allows. The only supported path is an
 * XPI signed by an unlisted Mozilla add-on ID:
 *
 *   1. AMO -> Developer Hub -> Submit a New Add-on -> "On your own"
 *      (unlisted). Use the same add-on ID every release:
 *      smart-subtitle-mobile@skkkkkl.github.io
 *   2. Collect the two credential strings (JWT issuer / JWT secret).
 *   3. WEB_EXT_API_KEY=user:12345:67 WEB_EXT_API_SECRET=... npm run sign:firefox
 *
 * Output: dist/smart-subtitle-firefox-mobile-<version>.zip, whose root is the
 * add-on. Copy it to the phone, open it in any file manager, and choose
 * Firefox to install.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const sourceDir = path.join(root, 'dist', 'firefox');
const manifestPath = path.join(sourceDir, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error('Missing dist/firefox. Run "npm run build:firefox" first.');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = manifest.version;
const geckoId =
  manifest.browser_specific_settings &&
  manifest.browser_specific_settings.gecko &&
  manifest.browser_specific_settings.gecko.id;
if (!geckoId) {
  console.error('Built manifest has no gecko.id; AMO signing would change the ID.');
  process.exit(1);
}
if (manifest.manifest_version !== 2) {
  console.error('Mobile pack expects the Manifest V2 Firefox build.');
  process.exit(1);
}

const target = path.join(root, 'dist', `smart-subtitle-firefox-mobile-${version}.zip`);
fs.rmSync(target, { force: true });

const webExtCli = path.join(
  root,
  'node_modules',
  'web-ext',
  'bin',
  'web-ext.js'
);
const run = (args) =>
  execFileSync(process.execPath, [webExtCli, ...args], {
    cwd: root,
    stdio: 'inherit'
  });

const hasCredentials =
  process.env.WEB_EXT_API_KEY && process.env.WEB_EXT_API_SECRET;

if (hasCredentials) {
  console.log('Signing', geckoId, 'as an unlisted AMO add-on...');
  run([
    'sign',
    '--source-dir',
    sourceDir,
    '--artifacts-dir',
    path.join(root, 'dist'),
    '--channel',
    'unlisted',
    '--filename',
    path.basename(target),
    '--overwrite-dest'
  ]);
} else {
  console.log('No WEB_EXT_API_KEY / WEB_EXT_API_SECRET set; writing unsigned ZIP.');
  console.log('(For step 1 of the AMO "unlisted" submission.)');
  run([
    'build',
    '--source-dir',
    sourceDir,
    '--artifacts-dir',
    path.join(root, 'dist'),
    '--filename',
    path.basename(target),
    '--overwrite-dest'
  ]);
}

if (!fs.existsSync(target)) {
  console.error('Packaging finished without producing', target);
  process.exit(1);
}
console.log('Output:', target);
if (!hasCredentials) {
  console.log('');
  console.log('Next: upload this ZIP to addons.mozilla.org ("On your own" / unlisted),');
  console.log('then download the signed XPI and copy it to the phone to install in Firefox Android.');
}
