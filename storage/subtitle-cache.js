/*
 * Extension-origin IndexedDB subtitle cache.
 *
 * The cache is opened from the service worker or options page, not from a
 * content script: IndexedDB inside a content script is scoped to the host page's
 * origin. Content scripts access this store through the service worker.
 *
 * Node tests use the in-memory fallback; the browser path uses IndexedDB.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartSubtitle.storage.SubtitleCache = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DB_NAME = 'smartSubtitleCache';
  const DB_VERSION = 1;
  const STORE = 'subtitles';

  function fingerprint(text, fileName) {
    const input = String(fileName || '') + '\u0000' + String(text || '');
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (
      'sub-' +
      (hash >>> 0).toString(16).padStart(8, '0') +
      '-' +
      input.length.toString(36)
    );
  }

  function newestFirst(a, b) {
    return (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
  }

  function stripText(entry) {
    if (!entry) return null;
    const copy = Object.assign({}, entry);
    delete copy.text;
    return copy;
  }

  class SubtitleCache {
    constructor(options) {
      const opts = options || {};
      const globalFactory =
        typeof indexedDB !== 'undefined' ? indexedDB : null;
      this.factory = opts.indexedDB || globalFactory;
      this.maxEntries = Number.isInteger(opts.maxEntries)
        ? opts.maxEntries
        : 50;
      this.memory = new Map();
      this.dbPromise = null;
    }

    get persistent() {
      return Boolean(this.factory);
    }

    _open() {
      if (!this.factory) {
        return Promise.reject(new Error('IndexedDB is unavailable.'));
      }
      if (this.dbPromise) return this.dbPromise;
      this.dbPromise = new Promise((resolve, reject) => {
        const request = this.factory.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = function () {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) {
            const store = db.createObjectStore(STORE, { keyPath: 'id' });
            store.createIndex('lastUsedAt', 'lastUsedAt', { unique: false });
            store.createIndex('title', 'title', { unique: false });
          }
        };
        request.onsuccess = function () {
          resolve(request.result);
        };
        request.onerror = function () {
          reject(request.error || new Error('IndexedDB open failed.'));
        };
      });
      return this.dbPromise;
    }

    async _withStore(mode, operation) {
      const db = await this._open();
      return new Promise((resolve, reject) => {
        let result;
        const transaction = db.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
        const request = operation(store);
        if (request) {
          request.onsuccess = function () {
            result = request.result;
          };
          request.onerror = function () {
            reject(request.error || transaction.error);
          };
        }
        transaction.oncomplete = function () {
          resolve(result);
        };
        transaction.onerror = function () {
          reject(transaction.error || new Error('IndexedDB transaction failed.'));
        };
        transaction.onabort = function () {
          reject(transaction.error || new Error('IndexedDB transaction aborted.'));
        };
      });
    }

    _normalize(entry) {
      if (!entry || typeof entry !== 'object') {
        throw new Error('缓存条目无效。');
      }
      const text = typeof entry.text === 'string' ? entry.text : '';
      if (!text.trim()) {
        throw new Error('不能缓存空字幕。');
      }
      const now = Date.now();
      const id = entry.id || fingerprint(text, entry.fileName);
      return Object.assign({}, entry, {
        id,
        text,
        size: text.length,
        createdAt: entry.createdAt || now,
        lastUsedAt: now
      });
    }

    async put(entry) {
      const record = this._normalize(entry);
      if (!this.factory) {
        this.memory.set(record.id, record);
        this._pruneMemory();
        return stripText(record);
      }
      await this._withStore('readwrite', function (store) {
        return store.put(record);
      });
      await this._pruneDb();
      return stripText(record);
    }

    async get(id) {
      if (!id) return null;
      if (!this.factory) {
        return this.memory.get(id) || null;
      }
      return this._withStore('readonly', function (store) {
        return store.get(id);
      });
    }

    async list(limit) {
      const max = Number.isInteger(limit) && limit > 0 ? limit : 50;
      let entries;
      if (!this.factory) {
        entries = Array.from(this.memory.values());
      } else {
        entries = await this._withStore('readonly', function (store) {
          return store.getAll();
        });
      }
      return (entries || [])
        .slice()
        .sort(newestFirst)
        .slice(0, max)
        .map(stripText);
    }

    async touch(id) {
      const entry = await this.get(id);
      if (!entry) return null;
      entry.lastUsedAt = Date.now();
      return this.put(entry);
    }

    async remove(id) {
      if (!id) return false;
      if (!this.factory) {
        return this.memory.delete(id);
      }
      await this._withStore('readwrite', function (store) {
        return store.delete(id);
      });
      return true;
    }

    async clear() {
      if (!this.factory) {
        this.memory.clear();
        return true;
      }
      await this._withStore('readwrite', function (store) {
        return store.clear();
      });
      return true;
    }

    async count() {
      if (!this.factory) return this.memory.size;
      const value = await this._withStore('readonly', function (store) {
        return store.count();
      });
      return value || 0;
    }

    _pruneMemory() {
      if (this.memory.size <= this.maxEntries) return;
      const entries = Array.from(this.memory.values()).sort(newestFirst);
      for (const entry of entries.slice(this.maxEntries)) {
        this.memory.delete(entry.id);
      }
    }

    async _pruneDb() {
      const entries = await this._withStore('readonly', function (store) {
        return store.getAll();
      });
      if (!entries || entries.length <= this.maxEntries) return;
      const stale = entries.sort(newestFirst).slice(this.maxEntries);
      await this._withStore('readwrite', function (store) {
        for (const entry of stale) store.delete(entry.id);
        return null;
      });
    }
  }

  return {
    DB_NAME,
    STORE,
    fingerprint,
    SubtitleCache
  };
});
