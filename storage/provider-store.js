/*
 * Optional OpenSubtitles provider configuration.
 *
 * The API key is stored only in chrome.storage.local and is never sent to the
 * content script. Searches/downloads are proxied by the service worker.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartSubtitle.storage.ProviderStore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY = 'smartSubtitle.provider.v1';
  const DEFAULT_USER_AGENT = 'SmartSubtitle/0.5.0 (Chrome extension)';
  const DEFAULT_LANGUAGES = ['zh', 'en'];
  const LANGUAGE_RE = /^[a-z]{2}(-[a-z]{2})?$/;

  function createDefaultProviderConfig() {
    return {
      provider: 'opensubtitles',
      enabled: false,
      apiKey: '',
      userAgent: DEFAULT_USER_AGENT,
      languages: DEFAULT_LANGUAGES.slice()
    };
  }

  function sanitizeProviderConfig(value) {
    const input = value && typeof value === 'object' ? value : {};
    const defaults = createDefaultProviderConfig();
    const apiKey =
      typeof input.apiKey === 'string' ? input.apiKey.trim().slice(0, 200) : '';
    const userAgent =
      typeof input.userAgent === 'string' && input.userAgent.trim()
        ? input.userAgent.trim().slice(0, 160)
        : defaults.userAgent;
    let languages = Array.isArray(input.languages)
      ? input.languages
          .map(function (item) {
            return String(item || '').toLowerCase();
          })
          .filter(function (item) {
            return LANGUAGE_RE.test(item);
          })
      : defaults.languages;
    languages = Array.from(new Set(languages)).slice(0, 5);
    if (!languages.length) languages = defaults.languages.slice();
    return {
      provider: 'opensubtitles',
      enabled: Boolean(input.enabled),
      apiKey,
      userAgent,
      languages
    };
  }

  class ProviderStore {
    constructor(options) {
      const opts = options || {};
      this.storage =
        opts.storage ||
        (typeof browser !== 'undefined' && browser.storage
          ? browser.storage.local
          : typeof chrome !== 'undefined' && chrome.storage
            ? chrome.storage.local
            : null);
      this.memory = null;
    }

    get persistent() {
      return Boolean(this.storage);
    }

    async load() {
      if (!this.storage) {
        return this.memory
          ? sanitizeProviderConfig(this.memory)
          : createDefaultProviderConfig();
      }
      const result = await this.storage.get(STORAGE_KEY);
      return sanitizeProviderConfig(result ? result[STORAGE_KEY] : null);
    }

    async save(value) {
      const config = sanitizeProviderConfig(value);
      if (!this.storage) {
        this.memory = config;
        return config;
      }
      await this.storage.set({ [STORAGE_KEY]: config });
      return config;
    }

    async clear() {
      if (!this.storage) {
        this.memory = null;
        return true;
      }
      await this.storage.remove(STORAGE_KEY);
      return true;
    }
  }

  return {
    STORAGE_KEY,
    DEFAULT_USER_AGENT,
    DEFAULT_LANGUAGES,
    createDefaultProviderConfig,
    sanitizeProviderConfig,
    ProviderStore
  };
});
