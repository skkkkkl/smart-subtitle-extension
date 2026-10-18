/*
 * Settings persistence adapter.
 *
 * Production uses chrome.storage.local. When the module is loaded outside an
 * extension page (options-page smoke tests, Node tests, future hosts) it falls
 * back to an in-memory area so appearance controls still work.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./settings-model.js'));
  } else {
    root.SmartSubtitle.storage.SettingsStore = factory(
      root.SmartSubtitle.storage.SettingsModel
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (SettingsModel) {
  'use strict';

  const host =
    typeof globalThis !== 'undefined' ? globalThis : this;
  const SETTINGS_KEY = 'smartSubtitle.settings.v1';
  const DATA_PREFIX = 'smartSubtitle.';

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function createMemoryArea() {
    let data = {};
    return {
      async get(keys) {
        if (keys === null || keys === undefined) return clone(data);
        if (typeof keys === 'string') {
          return Object.prototype.hasOwnProperty.call(data, keys)
            ? { [keys]: clone(data[keys]) }
            : {};
        }
        if (Array.isArray(keys)) {
          const result = {};
          for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
              result[key] = clone(data[key]);
            }
          }
          return result;
        }
        const result = {};
        for (const key of Object.keys(keys)) {
          result[key] = Object.prototype.hasOwnProperty.call(data, key)
            ? clone(data[key])
            : clone(keys[key]);
        }
        return result;
      },
      async set(items) {
        data = Object.assign({}, data, clone(items));
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const key of list) delete data[key];
      }
    };
  }

  function resolveArea() {
    try {
      if (
        host.browser &&
        host.browser.storage &&
        host.browser.storage.local
      ) {
        return { area: host.browser.storage.local, persistent: true };
      }
      if (
        host.chrome &&
        host.chrome.storage &&
        host.chrome.storage.local
      ) {
        return { area: host.chrome.storage.local, persistent: true };
      }
    } catch (error) {
      // Fall through to memory.
    }
    return { area: createMemoryArea(), persistent: false };
  }

  class SettingsStore {
    constructor(options) {
      const opts = options || {};
      const resolved = opts.area
        ? { area: opts.area, persistent: opts.persistent !== false }
        : resolveArea();
      this.area = resolved.area;
      this.persistent = resolved.persistent;
      this.key = opts.key || SETTINGS_KEY;
      this.prefix = opts.prefix || DATA_PREFIX;
      this.onChanged =
        opts.onChanged ||
        (host.browser &&
          host.browser.storage &&
          host.browser.storage.onChanged) ||
        (host.chrome && host.chrome.storage && host.chrome.storage.onChanged) ||
        null;
    }

    async load() {
      const result = await this.area.get(this.key);
      const raw = result && result[this.key];
      return SettingsModel.sanitizeSettings(raw);
    }

    async save(settings) {
      const clean = SettingsModel.sanitizeSettings(settings);
      await this.area.set({ [this.key]: clean });
      return clean;
    }

    async reset() {
      await this.area.remove(this.key);
      return SettingsModel.createDefaultSettings();
    }

    /**
     * Remove only this extension's smartSubtitle.* keys. Other extension data,
     * if added later, must use the same prefix to be covered.
     */
    async clearAll() {
      const all = await this.area.get(null);
      const keys = Object.keys(all || {}).filter((key) =>
        key.startsWith(this.prefix)
      );
      if (keys.length > 0) {
        await this.area.remove(keys);
      }
      return keys;
    }

    subscribe(callback) {
      if (typeof callback !== 'function' || !this.onChanged) {
        return function () {};
      }
      const listener = (changes, areaName) => {
        if (areaName && areaName !== 'local') return;
        if (!changes || !changes[this.key]) return;
        const next = SettingsModel.sanitizeSettings(
          changes[this.key].newValue
        );
        callback(next);
      };
      this.onChanged.addListener(listener);
      return function () {
        try {
          this.onChanged.removeListener(listener);
        } catch (error) {
          // The extension may have been reloaded.
        }
      }.bind(this);
    }
  }

  return {
    SETTINGS_KEY,
    DATA_PREFIX,
    SettingsStore,
    createMemoryArea
  };
});
