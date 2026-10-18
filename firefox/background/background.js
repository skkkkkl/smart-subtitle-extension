/*
 * Firefox Android background page (Manifest V2).
 *
 * Firefox Android has no tabCapture/offscreen or chrome.scripting, so this
 * build uses tabs.executeScript/tabs.insertCSS and keeps audio-capture UI
 * hidden via shared/capabilities.js.
 */
'use strict';

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

const DEFAULT_TITLE = '打开本地字幕面板';

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

function lastError() {
  return chrome.runtime.lastError
    ? new Error(chrome.runtime.lastError.message)
    : null;
}

function executeScript(tabId, options) {
  return new Promise(function (resolve, reject) {
    chrome.tabs.executeScript(tabId, options, function (result) {
      const error = lastError();
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise(function (resolve, reject) {
    chrome.tabs.sendMessage(tabId, message, function (response) {
      const error = lastError();
      if (error) reject(error);
      else resolve(response);
    });
  });
}

function insertCSS(tabId, css) {
  return new Promise(function (resolve, reject) {
    chrome.tabs.insertCSS(
      tabId,
      { code: css, cssOrigin: 'user' },
      function () {
        const error = lastError();
        if (error) reject(error);
        else resolve();
      }
    );
  });
}

function removeCSS(tabId, css) {
  return new Promise(function (resolve, reject) {
    chrome.tabs.removeCSS(
      tabId,
      { code: css, cssOrigin: 'user' },
      function () {
        const error = lastError();
        if (error) reject(error);
        else resolve();
      }
    );
  });
}

function setBadge(tabId, text, color) {
  try {
    if (chrome.browserAction.setBadgeText) {
      chrome.browserAction.setBadgeText({ tabId, text });
    }
    if (color && chrome.browserAction.setBadgeBackgroundColor) {
      chrome.browserAction.setBadgeBackgroundColor({ tabId, color });
    }
    if (chrome.browserAction.setTitle) {
      chrome.browserAction.setTitle({
        tabId,
        title: text ? '本地字幕无法运行' : DEFAULT_TITLE
      });
    }
  } catch (error) {
    // Mobile Firefox may not expose badges.
  }
}

function flashError(tabId, message) {
  setBadge(tabId, '!', '#B42318');
  console.error('[本地字幕]', message);
  setTimeout(function () {
    setBadge(tabId, '');
  }, 6000);
}

function restrictedReason(url) {
  if (!url) return null;
  if (
    url.startsWith('about:') ||
    url.startsWith('moz-extension://') ||
    url.startsWith('chrome://') ||
    url.startsWith('https://addons.mozilla.org/')
  ) {
    return '浏览器内部页面不允许扩展注入脚本。';
  }
  return null;
}

async function handleActionClick(tab) {
  if (!tab || !Number.isInteger(tab.id)) return;
  const restricted = restrictedReason(tab.url);
  if (restricted) {
    flashError(tab.id, restricted);
    return;
  }
  try {
    const probe = await executeScript(tab.id, {
      code: 'Boolean(globalThis.__SMART_SUBTITLE_APP__)'
    });
    if (probe && probe[0]) {
      try {
        await sendTabMessage(tab.id, { type: 'SMART_SUBTITLE_TOGGLE' });
        setBadge(tab.id, '');
        return;
      } catch (error) {
        throw new Error('面板已存在，但与页面脚本通信失败。请刷新网页后重试。');
      }
    }
    for (const file of CONTENT_FILES) {
      await executeScript(tab.id, { file, runAt: 'document_idle' });
    }
    const verify = await executeScript(tab.id, {
      code: 'Boolean(globalThis.__SMART_SUBTITLE_APP__)'
    });
    if (!verify || !verify[0]) {
      throw new Error('内容脚本已注入，但面板初始化失败。请刷新页面后重试。');
    }
    setBadge(tab.id, '');
    chrome.browserAction.setTitle({
      tabId: tab.id,
      title: DEFAULT_TITLE
    });
  } catch (error) {
    flashError(tab.id, error && error.message ? error.message : '注入失败');
  }
}

function hasProviderPermission() {
  return new Promise(function (resolve) {
    if (!chrome.permissions || !chrome.permissions.contains) {
      resolve(false);
      return;
    }
    chrome.permissions.contains(
      { origins: ['https://*.opensubtitles.com/*'] },
      function (granted) {
        resolve(Boolean(granted) && !lastError());
      }
    );
  });
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
    return { ok: true, candidates: await provider.search(message.query) };
  }
  if (message.type === 'SMART_SUBTITLE_PROVIDER_DOWNLOAD') {
    return Object.assign(
      { ok: true },
      await provider.download(message.candidate)
    );
  }
  throw new Error('未知的在线来源操作。');
}

async function handleCacheMessage(message) {
  if (!subtitleCache) throw new Error('字幕缓存模块不可用。');
  if (message.type === 'SMART_SUBTITLE_CACHE_PUT') {
    const entry = message.entry;
    if (!entry || typeof entry.text !== 'string') {
      throw new Error('缓存条目缺少字幕文本。');
    }
    if (entry.text.length > 12 * 1024 * 1024) {
      throw new Error('字幕缓存条目过大。');
    }
    return { ok: true, item: await subtitleCache.put(entry) };
  }
  if (message.type === 'SMART_SUBTITLE_CACHE_LIST') {
    return {
      ok: true,
      items: await subtitleCache.list(
        Math.min(100, Math.max(1, Number(message.limit) || 50))
      )
    };
  }
  if (message.type === 'SMART_SUBTITLE_CACHE_GET') {
    return { ok: true, entry: (await subtitleCache.get(message.id)) || null };
  }
  if (message.type === 'SMART_SUBTITLE_CACHE_TOUCH') {
    return { ok: true, item: await subtitleCache.touch(message.id) };
  }
  if (message.type === 'SMART_SUBTITLE_CACHE_CLEAR') {
    await subtitleCache.clear();
    return { ok: true };
  }
  if (message.type === 'SMART_SUBTITLE_CACHE_COUNT') {
    return { ok: true, count: await subtitleCache.count() };
  }
  throw new Error('未知的字幕缓存操作。');
}

async function replaceCueCss(tabId, previousCss, css) {
  if (typeof previousCss === 'string' && previousCss) {
    try {
      await removeCSS(tabId, previousCss);
    } catch (error) {
      // Navigation may have already removed it.
    }
  }
  if (!css) return;
  if (typeof css !== 'string' || css.length > 20000) {
    throw new Error('字幕样式表无效或过大。');
  }
  await insertCSS(tabId, css);
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message) return false;

  if (
    message.type === 'SMART_SUBTITLE_PROVIDER_SEARCH' ||
    message.type === 'SMART_SUBTITLE_PROVIDER_DOWNLOAD'
  ) {
    handleProviderMessage(message).then(sendResponse, function (error) {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : '在线来源请求失败。',
        code: error && error.code ? error.code : 'PROVIDER_ERROR'
      });
    });
    return true;
  }

  if (
    typeof message.type === 'string' &&
    message.type.startsWith('SMART_SUBTITLE_CACHE_')
  ) {
    handleCacheMessage(message).then(sendResponse, function (error) {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : '缓存操作失败。'
      });
    });
    return true;
  }

  if (message.type === 'SMART_SUBTITLE_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type !== 'SMART_SUBTITLE_CUE_CSS') return false;
  const tabId = sender && sender.tab ? sender.tab.id : null;
  if (!Number.isInteger(tabId)) {
    sendResponse({ ok: false, error: '无法确定当前标签页。' });
    return false;
  }
  replaceCueCss(tabId, message.previousCss, message.css).then(
    function () {
      sendResponse({ ok: true });
    },
    function (error) {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : '样式注入失败。'
      });
    }
  );
  return true;
});

chrome.browserAction.onClicked.addListener(function (tab) {
  handleActionClick(tab);
});
