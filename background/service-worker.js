/*
 * Manifest V3 service worker.
 *
 * MV3 service workers have no DOM, so this file only:
 *  - handles the toolbar action / Alt+Shift+S,
 *  - injects the content-script modules on demand using activeTab,
 *  - toggles an already-injected panel,
 *  - applies/removes ::cue appearance CSS on behalf of the content script.
 *
 * There are intentionally no host_permissions and no declarative content
 * scripts: the extension can only touch a tab after an explicit user action.
 */
'use strict';

// Classic MV3 service worker: load the shared namespace and the cache module.
// In Node tests importScripts is absent, so the cache handlers degrade safely.
if (typeof importScripts === 'function') {
  try {
    const assetUrl = function (path) {
      if (chrome.runtime && typeof chrome.runtime.getURL === 'function') {
        return chrome.runtime.getURL(path);
      }
      return path;
    };
    importScripts(
      assetUrl('shared/namespace.js'),
      assetUrl('storage/subtitle-cache.js'),
      assetUrl('storage/provider-store.js'),
      assetUrl('matching/opensubtitles-provider.js')
    );
  } catch (error) {
    console.error('[本地字幕] 缓存/来源模块加载失败：', error);
  }
}

const cacheModule =
  typeof SmartSubtitle !== 'undefined' &&
  SmartSubtitle.storage &&
  SmartSubtitle.storage.SubtitleCache
    ? SmartSubtitle.storage.SubtitleCache
    : null;
const subtitleCache = cacheModule
  ? new cacheModule.SubtitleCache({ maxEntries: 50 })
  : null;

const providerStoreModule =
  typeof SmartSubtitle !== 'undefined' &&
  SmartSubtitle.storage &&
  SmartSubtitle.storage.ProviderStore
    ? SmartSubtitle.storage.ProviderStore
    : null;
const providerStore = providerStoreModule
  ? new providerStoreModule.ProviderStore()
  : null;

const providerModule =
  typeof SmartSubtitle !== 'undefined' &&
  SmartSubtitle.matching &&
  SmartSubtitle.matching.OpenSubtitlesProvider
    ? SmartSubtitle.matching.OpenSubtitlesProvider
    : null;

const CONTENT_FILES = [
  'shared/namespace.js',
  'shared/capabilities.js',
  'subtitles/subtitle-error.js',
  'subtitles/timing.js',
  'subtitles/file-decoder.js',
  'subtitles/srt-parser.js',
  'subtitles/vtt-parser.js',
  'subtitles/ass-text.js',
  'subtitles/ass-parser.js',
  'alignment/offset-model.js',
  'alignment/offset-estimator.js',
  'alignment/anchor-sync.js',
  'alignment/first-line.js',
  'alignment/audio-aligner.js',
  'alignment/audio-features.js',
  'alignment/audio-session.js',
  'subtitles/subtitle-document.js',
  'matching/metadata-extractor.js',
  'matching/candidate-ranker.js',
  'storage/settings-model.js',
  'storage/settings-store.js',
  'storage/subtitle-cache.js',
  'storage/cache-client.js',
  'storage/provider-client.js',
  'content/video-detector.js',
  'content/track-controller.js',
  'content/cue-style-controller.js',
  'content/ass-overlay.js',
  'content/audio-calibrator.js',
  'content/panel-view.js',
  'content/app.js'
];

const DEFAULT_TITLE = '打开本地字幕面板（Alt+Shift+S）';

function isInstalled() {
  return Boolean(globalThis.__SMART_SUBTITLE_APP__);
}

function restrictedReason(url) {
  if (!url) return null;
  if (
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('devtools://')
  ) {
    return '浏览器内部页面不允许扩展注入脚本。';
  }
  if (
    url.startsWith('https://chromewebstore.google.com/') ||
    url.startsWith('https://chrome.google.com/webstore')
  ) {
    return 'Chrome 应用商店页面不允许扩展注入脚本。';
  }
  return null;
}

async function flashError(tabId, message) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#B42318' });
    await chrome.action.setBadgeText({ tabId, text: '!' });
    await chrome.action.setTitle({
      tabId,
      title: '本地字幕无法运行：' + message
    });
  } catch (error) {
    // The tab may have closed.
  }

  setTimeout(async () => {
    try {
      await chrome.action.setBadgeText({ tabId, text: '' });
      await chrome.action.setTitle({ tabId, title: DEFAULT_TITLE });
    } catch (error) {
      // The tab may have closed.
    }
  }, 6000);
}

async function clearError(tabId) {
  try {
    await chrome.action.setBadgeText({ tabId, text: '' });
    await chrome.action.setTitle({ tabId, title: DEFAULT_TITLE });
  } catch (error) {
    // Ignore.
  }
}

async function handleActionClick(tab) {
  if (!tab || !Number.isInteger(tab.id)) return;

  const restricted = restrictedReason(tab.url);
  if (restricted) {
    await flashError(tab.id, restricted);
    return;
  }

  try {
    const probe = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      func: isInstalled
    });

    if (probe && probe[0] && probe[0].result) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'SMART_SUBTITLE_TOGGLE'
        });
        await clearError(tab.id);
        return;
      } catch (messageError) {
        throw new Error(
          '面板已存在，但与页面脚本通信失败。请刷新网页后重试。'
        );
      }
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      files: CONTENT_FILES
    });

    const verify = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      func: isInstalled
    });
    if (!verify || !verify[0] || !verify[0].result) {
      throw new Error('内容脚本已注入，但面板初始化失败。请刷新页面后重试。');
    }
    await clearError(tab.id);
  } catch (error) {
    const message =
      error && error.message ? error.message : '未知错误';
    console.error('[本地字幕] 注入失败：', error);
    await flashError(tab.id, message);
  }
}

const MAX_CUE_CSS_LENGTH = 20000;

async function replaceCueCss(tabId, previousCss, css) {
  if (typeof previousCss === 'string' && previousCss) {
    try {
      await chrome.scripting.removeCSS({
        target: { tabId, allFrames: false },
        css: previousCss,
        origin: 'USER'
      });
    } catch (error) {
      // A navigated tab may already have discarded the previous stylesheet.
    }
  }
  if (!css) return;
  if (typeof css !== 'string' || css.length > MAX_CUE_CSS_LENGTH) {
    throw new Error('字幕样式表无效或过大。');
  }
  await chrome.scripting.insertCSS({
    target: { tabId, allFrames: false },
    css,
    origin: 'USER'
  });
}

async function hasProviderPermission() {
  if (!chrome.permissions || !chrome.permissions.contains) return false;
  return chrome.permissions.contains({
    origins: ['https://*.opensubtitles.com/*']
  });
}

async function ensureOffscreenDocument() {
  if (chrome.offscreen && chrome.offscreen.hasDocument) {
    const exists = await chrome.offscreen.hasDocument();
    if (exists) return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Capture tab audio locally for subtitle timing calibration.'
    });
  } catch (error) {
    const message = error && error.message ? error.message : '';
    if (!/single offscreen|already exists/i.test(message)) throw error;
  }
}

async function handleTabAudioCalibration(message) {
  if (!chrome.tabCapture || !chrome.tabCapture.getMediaStreamId) {
    throw new Error('当前浏览器不支持标签页音频捕获。');
  }
  if (!chrome.offscreen) {
    throw new Error('当前浏览器不支持 offscreen 音频分析。');
  }
  const tabId = message.tabId;
  if (!Number.isInteger(tabId)) throw new Error('没有可捕获的标签页。');
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tabId
  });
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    type: 'SMART_SUBTITLE_OFFSCREEN_CAPTURE',
    streamId,
    durationMs: message.durationMs,
    startMediaMs: message.startMediaMs
  });
  if (chrome.offscreen.closeDocument) {
    await chrome.offscreen.closeDocument().catch(function () {});
  }
  return response;
}

async function handleProviderMessage(message) {
  if (!providerStore || !providerModule) {
    throw new Error('在线来源模块未加载。');
  }
  const config = await providerStore.load();
  if (!config.enabled || !config.apiKey) {
    throw new Error('OpenSubtitles 未启用或缺少 API Key。');
  }
  if (!(await hasProviderPermission())) {
    throw new Error('未授予 OpenSubtitles 域名权限，请到设置页重新启用。');
  }
  const provider = new providerModule.OpenSubtitlesProvider({
    config,
    userAgent: config.userAgent,
    fetchImpl: fetch
  });
  if (message.type === 'SMART_SUBTITLE_PROVIDER_SEARCH') {
    const candidates = await provider.search(message.query);
    return { ok: true, candidates };
  }
  if (message.type === 'SMART_SUBTITLE_PROVIDER_DOWNLOAD') {
    const result = await provider.download(message.candidate);
    return { ok: true, ...result };
  }
  throw new Error('未知的在线来源操作。');
}

async function handleCacheMessage(message) {
  if (!subtitleCache) {
    throw new Error('字幕缓存模块不可用。');
  }
  switch (message.type) {
    case 'SMART_SUBTITLE_CACHE_PUT': {
      const entry = message.entry;
      if (!entry || typeof entry.text !== 'string') {
        throw new Error('缓存条目缺少字幕文本。');
      }
      if (entry.text.length > 12 * 1024 * 1024) {
        throw new Error('字幕缓存条目过大。');
      }
      const item = await subtitleCache.put(entry);
      return { ok: true, item };
    }
    case 'SMART_SUBTITLE_CACHE_LIST': {
      const limit = Math.min(
        100,
        Math.max(1, Number(message.limit) || 50)
      );
      const items = await subtitleCache.list(limit);
      return { ok: true, items };
    }
    case 'SMART_SUBTITLE_CACHE_GET': {
      const entry = await subtitleCache.get(message.id);
      return { ok: true, entry: entry || null };
    }
    case 'SMART_SUBTITLE_CACHE_TOUCH': {
      const item = await subtitleCache.touch(message.id);
      return { ok: true, item };
    }
    case 'SMART_SUBTITLE_CACHE_CLEAR': {
      await subtitleCache.clear();
      return { ok: true };
    }
    case 'SMART_SUBTITLE_CACHE_COUNT': {
      const count = await subtitleCache.count();
      return { ok: true, count };
    }
    default:
      throw new Error('未知的字幕缓存操作。');
  }
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message) return false;

  if (message.type === 'SMART_SUBTITLE_TAB_AUDIO_CALIBRATE') {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    void handleTabAudioCalibration({
      tabId,
      durationMs: message.durationMs,
      startMediaMs: message.startMediaMs
    }).then(
      function (response) {
        sendResponse(response || { ok: false, message: '没有采样结果。' });
      },
      function (error) {
        sendResponse({
          ok: false,
          code: 'TAB_CAPTURE_ERROR',
          message:
            error && error.message ? error.message : '标签页音频捕获失败。'
        });
      }
    );
    return true;
  }

  if (
    message.type === 'SMART_SUBTITLE_PROVIDER_SEARCH' ||
    message.type === 'SMART_SUBTITLE_PROVIDER_DOWNLOAD'
  ) {
    void handleProviderMessage(message).then(
      function (response) {
        sendResponse(response);
      },
      function (error) {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : '在线来源请求失败。',
          code: error && error.code ? error.code : 'PROVIDER_ERROR'
        });
      }
    );
    return true;
  }

  if (
    typeof message.type === 'string' &&
    message.type.startsWith('SMART_SUBTITLE_CACHE_')
  ) {
    void handleCacheMessage(message).then(
      function (response) {
        sendResponse(response);
      },
      function (error) {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : '缓存操作失败。'
        });
      }
    );
    return true;
  }

  if (message.type === 'SMART_SUBTITLE_OPEN_OPTIONS') {
    void chrome.runtime.openOptionsPage().then(
      function () {
        sendResponse({ ok: true });
      },
      function (error) {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : '无法打开选项页。'
        });
      }
    );
    return true;
  }

  if (message.type !== 'SMART_SUBTITLE_CUE_CSS') return false;
  const tabId = sender && sender.tab ? sender.tab.id : null;
  if (!Number.isInteger(tabId)) {
    sendResponse({ ok: false, error: '无法确定当前标签页。' });
    return false;
  }

  void replaceCueCss(tabId, message.previousCss, message.css)
    .then(function () {
      sendResponse({ ok: true });
    })
    .catch(function (error) {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : '样式注入失败。'
      });
    });
  return true;
});

chrome.action.onClicked.addListener(function (tab) {
  void handleActionClick(tab);
});
