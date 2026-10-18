'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const { SubtitleCache } = require('../storage/subtitle-cache.js');
const WORKER_SOURCE = fs.readFileSync(
  path.join(ROOT, 'background', 'service-worker.js'),
  'utf8'
);

function loadWorker(options) {
  const opts = options || {};
  const calls = {
    badge: [],
    titles: [],
    messages: [],
    files: [],
    imports: [],
    execute: [],
    cssInserts: [],
    cssRemoves: [],
    optionsOpened: 0,
    sendError: opts.sendError || null
  };
  let clickListener = null;
  let messageListener = null;
  let probeIndex = 0;
  const probes = opts.probes || [false, true];

  const chrome = {
    runtime: {
      getURL(value) {
        return 'chrome-extension://test-id/' + value;
      },
      onMessage: {
        addListener(fn) {
          messageListener = fn;
        }
      },
      async openOptionsPage() {
        calls.optionsOpened += 1;
      }
    },
    action: {
      onClicked: {
        addListener(fn) {
          clickListener = fn;
        }
      },
      async setBadgeBackgroundColor(value) {
        calls.badge.push(['bg', value]);
      },
      async setBadgeText(value) {
        calls.badge.push(['text', value]);
      },
      async setTitle(value) {
        calls.titles.push(value);
      }
    },
    scripting: {
      async executeScript(value) {
        calls.execute.push(value);
        if (value.files) {
          calls.files.push(value.files.slice());
          return [{ result: true }];
        }
        const result = probes[probeIndex];
        probeIndex += 1;
        return [{ result: Boolean(result) }];
      },
      async insertCSS(value) {
        calls.cssInserts.push(value);
      },
      async removeCSS(value) {
        calls.cssRemoves.push(value);
      }
    },
    tabs: {
      async sendMessage(tabId, message) {
        calls.messages.push({ tabId, message });
        if (calls.sendError) throw calls.sendError;
        return { ok: true };
      }
    }
  };

  const context = vm.createContext({
    chrome,
    console: { error() {}, log() {} },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    SmartSubtitle: {
      storage: {
        SubtitleCache: { SubtitleCache }
      }
    },
    importScripts(...paths) {
      calls.imports.push(paths);
    }
  });
  vm.runInContext(WORKER_SOURCE, context, {
    filename: 'background/service-worker.js'
  });
  assert.equal(typeof clickListener, 'function');
  assert.equal(typeof messageListener, 'function');
  return { context, calls, clickListener, messageListener };
}

function sendMessageToWorker(worker, message, sender) {
  return new Promise((resolve) => {
    const returned = worker.messageListener(message, sender || {}, resolve);
    if (returned !== true) resolve(undefined);
  });
}

test('service worker imports modules with full extension URLs', () => {
  const worker = loadWorker();
  assert.equal(worker.calls.imports.length, 1);
  assert.deepEqual(worker.calls.imports[0], [
    'chrome-extension://test-id/shared/namespace.js',
    'chrome-extension://test-id/storage/subtitle-cache.js',
    'chrome-extension://test-id/storage/provider-store.js',
    'chrome-extension://test-id/matching/opensubtitles-provider.js'
  ]);
});

test('manifest is minimal and does not request broad host access', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage', 'tabCapture', 'offscreen']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.options_ui.page, 'options/options.html');
  for (const file of [
    'options/options.html',
    'options/options.css',
    'options/options.js',
    'storage/settings-model.js',
    'storage/settings-store.js',
    'content/cue-style-controller.js',
    'offscreen/offscreen.html',
    'offscreen/offscreen.js'
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), file + ' must exist');
  }
  const serialized = JSON.stringify(manifest);
  assert.ok(!serialized.includes('<all_urls>'));
  assert.ok(!serialized.includes('tabs'), 'tabs permission is not required');
});

test('every injected module exists and app.js is injected last', async () => {
  const { calls, context } = loadWorker();
  await context.handleActionClick({ id: 7, url: 'https://example.com/watch' });
  assert.equal(calls.files.length, 1);
  const files = calls.files[0];
  for (const file of files) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), file + ' must exist');
  }
  assert.equal(files[files.length - 1], 'content/app.js');
  assert.equal(calls.messages.length, 0);
  assert.ok(calls.execute.some((entry) => entry.files));
});

test('a second click toggles the existing panel instead of reinjecting', async () => {
  const { context, calls } = loadWorker({ probes: [true] });
  await context.handleActionClick({ id: 8, url: 'https://example.com/' });
  assert.equal(calls.files.length, 0);
  assert.equal(calls.messages.length, 1);
  assert.equal(calls.messages[0].message.type, 'SMART_SUBTITLE_TOGGLE');
});

test('restricted browser pages are rejected with a badge, not injected', async () => {
  const { context, calls } = loadWorker({ probes: [false] });
  await context.handleActionClick({ id: 9, url: 'chrome://settings/' });
  assert.equal(calls.execute.length, 0);
  assert.ok(
    calls.badge.some(
      (entry) => entry[0] === 'text' && entry[1].text === '!'
    )
  );
});

test('message failure is surfaced as an actionable badge error', async () => {
  const { context, calls } = loadWorker({
    probes: [true],
    sendError: new Error('Receiving end does not exist')
  });
  await context.handleActionClick({ id: 10, url: 'https://example.com/' });
  assert.equal(calls.files.length, 0);
  assert.ok(
    calls.badge.some(
      (entry) => entry[0] === 'text' && entry[1].text === '!'
    )
  );
});

test('cue CSS messages remove the old sheet and insert the new one', async () => {
  const worker = loadWorker();
  const response = await sendMessageToWorker(
    worker,
    {
      type: 'SMART_SUBTITLE_CUE_CSS',
      previousCss: 'video::cue { color: red; }',
      css: 'video::cue { color: white; }'
    },
    { tab: { id: 12 } }
  );
  assert.equal(response.ok, true);
  assert.equal(worker.calls.cssRemoves.length, 1);
  assert.equal(worker.calls.cssRemoves[0].css, 'video::cue { color: red; }');
  assert.equal(worker.calls.cssRemoves[0].origin, 'USER');
  assert.equal(worker.calls.cssInserts.length, 1);
  assert.equal(worker.calls.cssInserts[0].css, 'video::cue { color: white; }');
  assert.equal(worker.calls.cssInserts[0].target.tabId, 12);
});

test('empty cue CSS only removes the previous sheet', async () => {
  const worker = loadWorker();
  const response = await sendMessageToWorker(
    worker,
    {
      type: 'SMART_SUBTITLE_CUE_CSS',
      previousCss: 'old',
      css: ''
    },
    { tab: { id: 13 } }
  );
  assert.equal(response.ok, true);
  assert.equal(worker.calls.cssRemoves.length, 1);
  assert.equal(worker.calls.cssInserts.length, 0);
});

test('oversized cue CSS is rejected without inserting', async () => {
  const worker = loadWorker();
  const response = await sendMessageToWorker(
    worker,
    {
      type: 'SMART_SUBTITLE_CUE_CSS',
      previousCss: '',
      css: 'x'.repeat(20001)
    },
    { tab: { id: 14 } }
  );
  assert.equal(response.ok, false);
  assert.equal(worker.calls.cssInserts.length, 0);
});

test('options message opens the extension options page', async () => {
  const worker = loadWorker();
  const response = await sendMessageToWorker(
    worker,
    { type: 'SMART_SUBTITLE_OPEN_OPTIONS' },
    { tab: { id: 15 } }
  );
  assert.equal(response.ok, true);
  assert.equal(worker.calls.optionsOpened, 1);
});

test('cache messages store, list, get, count and clear subtitles', async () => {
  const worker = loadWorker();
  const put = await sendMessageToWorker(worker, {
    type: 'SMART_SUBTITLE_CACHE_PUT',
    entry: {
      fileName: 'cached.srt',
      text: '1\n00:00:01,000 --> 00:00:02,000\nCached\n',
      format: 'srt',
      cueCount: 1,
      title: 'Cached'
    }
  });
  assert.equal(put.ok, true);
  assert.ok(put.item.id);

  const list = await sendMessageToWorker(worker, {
    type: 'SMART_SUBTITLE_CACHE_LIST',
    limit: 10
  });
  assert.equal(list.ok, true);
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].title, 'Cached');
  assert.equal(list.items[0].text, undefined);

  const get = await sendMessageToWorker(worker, {
    type: 'SMART_SUBTITLE_CACHE_GET',
    id: put.item.id
  });
  assert.equal(get.ok, true);
  assert.ok(get.entry.text.includes('Cached'));

  const count = await sendMessageToWorker(worker, {
    type: 'SMART_SUBTITLE_CACHE_COUNT'
  });
  assert.equal(count.count, 1);

  const clear = await sendMessageToWorker(worker, {
    type: 'SMART_SUBTITLE_CACHE_CLEAR'
  });
  assert.equal(clear.ok, true);
  const after = await sendMessageToWorker(worker, {
    type: 'SMART_SUBTITLE_CACHE_COUNT'
  });
  assert.equal(after.count, 0);
});
