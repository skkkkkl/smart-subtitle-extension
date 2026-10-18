/*
 * Content-script client for the optional OpenSubtitles provider.
 * Network calls and the API key stay in the service worker.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartSubtitle.storage.ProviderClient = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const host = typeof globalThis !== 'undefined' ? globalThis : this;

  class ProviderClient {
    constructor(options) {
      const opts = options || {};
      this.runtime =
        opts.runtime ||
        (host.chrome && host.chrome.runtime ? host.chrome.runtime : null);
    }

    get available() {
      return Boolean(this.runtime && this.runtime.sendMessage);
    }

    _send(message) {
      if (!this.available) {
        return Promise.reject(
          new Error('当前不是扩展环境，无法连接在线字幕来源。')
        );
      }
      return this.runtime.sendMessage(message).then(function (response) {
        if (!response || response.ok !== true) {
          const error = new Error(
            response && response.error
              ? response.error
              : '在线字幕来源请求失败。'
          );
          error.code = response && response.code;
          throw error;
        }
        return response;
      });
    }

    async search(query) {
      return this._send({
        type: 'SMART_SUBTITLE_PROVIDER_SEARCH',
        query
      });
    }

    async download(candidate) {
      return this._send({
        type: 'SMART_SUBTITLE_PROVIDER_DOWNLOAD',
        candidate: {
          provider: candidate.provider,
          fileId: candidate.fileId,
          fileName: candidate.fileName
        }
      });
    }
  }

  return { ProviderClient };
});
