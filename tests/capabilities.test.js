'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(
  path.join(ROOT, 'shared', 'capabilities.js'),
  'utf8'
);

function detect(options) {
  const opts = options || {};
  const context = vm.createContext({
    chrome: opts.chrome,
    innerWidth: opts.innerWidth === undefined ? 1280 : opts.innerWidth,
    matchMedia(query) {
      return { matches: Boolean(opts.coarse && query === '(pointer: coarse)') };
    }
  });
  vm.runInContext(SOURCE, context, { filename: 'shared/capabilities.js' });
  return context.SmartSubtitle.capabilities;
}

function chromelike(permissions, api) {
  return {
    runtime: {
      getManifest() {
        return { permissions };
      }
    },
    tabCapture: api && api.tabCapture,
    offscreen: api && api.offscreen
  };
}

const fullApi = {
  tabCapture: { getMediaStreamId() {} },
  offscreen: { createDocument() {} }
};

test('desktop Chrome with the capture APIs keeps audio calibration', () => {
  const caps = detect({
    chrome: chromelike(['activeTab', 'tabCapture', 'offscreen'], fullApi)
  });
  assert.equal(caps.audioCapture, true);
  assert.equal(caps.mobile, false);
  assert.equal(caps.platform, 'chrome');
});

test('a declared permission without the runtime API is not a capability', () => {
  const caps = detect({
    chrome: chromelike(['activeTab', 'tabCapture', 'offscreen'], null)
  });
  assert.equal(caps.audioCapture, false);
});

test('missing offscreen blocks audio calibration even with tabCapture', () => {
  const caps = detect({
    chrome: chromelike(['tabCapture'], { tabCapture: fullApi.tabCapture })
  });
  assert.equal(caps.audioCapture, false);
});

test('mobile Chromium keeps MV3 permissions but loses audio calibration', () => {
  // Kiwi and other phone browsers reuse the Chrome manifest verbatim.
  const caps = detect({
    chrome: chromelike(['activeTab', 'tabCapture', 'offscreen'], fullApi),
    innerWidth: 412,
    coarse: true
  });
  assert.equal(caps.mobile, true);
  assert.equal(caps.audioCapture, false);
  assert.equal(caps.viewportWidth, 412);
});

test('a narrow desktop window with a fine pointer stays desktop', () => {
  const caps = detect({
    chrome: chromelike(['activeTab', 'tabCapture', 'offscreen'], fullApi),
    innerWidth: 420,
    coarse: false
  });
  assert.equal(caps.mobile, false);
  assert.equal(caps.audioCapture, true);
});

test('a coarse-pointer tablet in landscape counts as mobile', () => {
  const caps = detect({
    chrome: chromelike(['tabCapture', 'offscreen'], fullApi),
    innerWidth: 640,
    coarse: true
  });
  assert.equal(caps.mobile, true);
});

test('Firefox mobile has no tabCapture and is reported as firefox', () => {
  const context = vm.createContext({
    browser: {
      runtime: {
        getManifest() {
          return { permissions: ['activeTab', 'storage'] };
        }
      }
    },
    innerWidth: 390,
    matchMedia() {
      return { matches: true };
    }
  });
  vm.runInContext(SOURCE, context, { filename: 'shared/capabilities.js' });
  const caps = context.SmartSubtitle.capabilities;
  assert.equal(caps.platform, 'firefox');
  assert.equal(caps.audioCapture, false);
  assert.equal(caps.mobile, true);
});

test('a missing matchMedia falls back to desktop so nothing disappears', () => {
  const caps = detect({
    chrome: chromelike(['tabCapture', 'offscreen'], fullApi),
    innerWidth: 360
  });
  assert.equal(caps.mobile, false);
});
