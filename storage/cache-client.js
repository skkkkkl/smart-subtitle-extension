/*
 * Content-script client for the extension-origin subtitle cache.
 *
 * IndexedDB from a content script is page-origin, so the real store lives in the
 * service worker. This client sends cache requests there. Outside an extension
 * it falls back to memory, which keeps DOM tests functional without weakening
 * the production path.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./subtitle-cache.js'));
  } else {
    root.SmartSubtitle.storage.CacheClient = factory(
      root.SmartSubtitle.storage.SubtitleCache
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CacheModule) {
  'use strict';

  const host = typeof globalThis !== 'undefined' ? globalThis : this;

  function stripText(entry) {
    if (!entry) return null;
    const copy = Object.assign({}, entry);
    delete copy.text;
    return copy;
  }

  class SubtitleCacheClient {
    constructor(options) {
      const opts = options || {};
      this.runtime =
        opts.runtime ||
        (host.chrome && host.chrome.runtime ? host.chrome.runtime : null);
      this.maxEntries = Number.isInteger(opts.maxEntries)
        ? opts.maxEntries
        : 50;
      this.memory = new Map();
    }

    get persistent() {
      return Boolean(this.runtime && this.runtime.sendMessage);
    }

    _send(message) {
      if (!this.persistent) {
        return Promise.reject(new Error('cache runtime unavailable'));
      }
      return this.runtime.sendMessage(message).then(function (response) {
        if (!response || response.ok !== true) {
          throw new Error(
            response && response.error
              ? response.error
              : '字幕缓存操作失败。'
          );
        }
        return response;
      });
    }

    async put(entry) {
      if (!entry || typeof entry !== 'object' || !entry.text) {
        throw new Error('缓存条目无效。');
      }
      const id =
        entry.id || CacheModule.fingerprint(entry.text, entry.fileName);
      const record = Object.assign({}, entry, { id });
      if (!this.persistent) {
        record.createdAt = entry.createdAt || Date.now();
        record.lastUsedAt = Date.now();
        record.size = entry.text.length;
        this.memory.set(id, record);
        this._pruneMemory();
        return stripText(record);
      }
      const response = await this._send({
        type: 'SMART_SUBTITLE_CACHE_PUT',
        entry: record
      });
      return response.item;
    }

    async list(limit) {
      const max = Number.isInteger(limit) && limit > 0 ? limit : 50;
      if (!this.persistent) {
        return Array.from(this.memory.values())
          .sort(function (a, b) {
            return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
          })
          .slice(0, max)
          .map(stripText);
      }
      const response = await this._send({
        type: 'SMART_SUBTITLE_CACHE_LIST',
        limit: max
      });
      return response.items || [];
    }

    async get(id) {
      if (!this.persistent) {
        return this.memory.get(id) || null;
      }
      const response = await this._send({
        type: 'SMART_SUBTITLE_CACHE_GET',
        id
      });
      return response.entry || null;
    }

    async touch(id) {
      if (!this.persistent) {
        const entry = this.memory.get(id);
        if (!entry) return null;
        entry.lastUsedAt = Date.now();
        return stripText(entry);
      }
      const response = await this._send({
        type: 'SMART_SUBTITLE_CACHE_TOUCH',
        id
      });
      return response.item || null;
    }

    async clear() {
      if (!this.persistent) {
        this.memory.clear();
        return true;
      }
      await this._send({ type: 'SMART_SUBTITLE_CACHE_CLEAR' });
      return true;
    }

    async count() {
      if (!this.persistent) return this.memory.size;
      const response = await this._send({
        type: 'SMART_SUBTITLE_CACHE_COUNT'
      });
      return response.count || 0;
    }

    _pruneMemory() {
      if (this.memory.size <= this.maxEntries) return;
      const entries = Array.from(this.memory.values()).sort(function (a, b) {
        return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
      });
      for (const entry of entries.slice(this.maxEntries)) {
        this.memory.delete(entry.id);
      }
    }
  }

  return { SubtitleCacheClient };
});
