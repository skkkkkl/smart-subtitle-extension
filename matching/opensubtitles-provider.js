/*
 * OpenSubtitles REST API v1 adapter.
 *
 * This module performs network requests only inside the service worker. The API
 * key never enters a content script. Search results are metadata candidates;
 * subtitle text is fetched only after the user explicitly chooses a result.
 *
 * API docs / key: https://www.opensubtitles.com/ and
 * https://opensubtitles.stoplight.io/docs/opensubtitles-api
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartSubtitle.matching.OpenSubtitlesProvider = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BASE_URL = 'https://api.opensubtitles.com/api/v1';
  const DEFAULT_USER_AGENT = 'SmartSubtitle/0.5.0 (Chrome extension)';
  const MAX_RESULTS = 20;

  class ProviderError extends Error {
    constructor(code, message, status) {
      super(message);
      this.name = 'ProviderError';
      this.code = code;
      this.status = status || null;
    }
  }

  function extensionOf(fileName) {
    const match = /\.([a-z0-9]{2,5})$/i.exec(String(fileName || ''));
    return match ? match[1].toLowerCase() : 'srt';
  }

  function apiLanguage(code) {
    const value = String(code || '').toLowerCase();
    if (value === 'zh') return ['zh-cn', 'zh-tw'];
    if (value === 'pt') return ['pt-br', 'pt-pt'];
    return value ? [value] : [];
  }

  function languageList(query, config) {
    const source =
      query && query.language
        ? [query.language]
        : config && Array.isArray(config.languages) && config.languages.length
          ? config.languages
          : ['zh', 'en'];
    const expanded = [];
    for (const item of source) {
      for (const language of apiLanguage(item)) {
        if (!expanded.includes(language)) expanded.push(language);
      }
    }
    return expanded.length ? expanded : ['en'];
  }

  function mapCandidate(item, query) {
    if (!item || typeof item !== 'object') return null;
    const attrs = item.attributes || {};
    const feature = attrs.feature_details || {};
    const files = Array.isArray(attrs.files) ? attrs.files : [];
    const file = files[0] || {};
    if (!file.file_id) return null;
    const fileName = file.file_name || attrs.release || 'OpenSubtitles 字幕';
    const title =
      feature.title ||
      feature.movie_name ||
      feature.parent_title ||
      attrs.release ||
      (query && query.title) ||
      'OpenSubtitles 字幕';
    return {
      id: 'opensubtitles-' + (attrs.subtitle_id || file.file_id),
      provider: 'opensubtitles',
      providerName: 'OpenSubtitles',
      fromProvider: true,
      title,
      year: feature.year || null,
      durationMs: null,
      language: attrs.language || null,
      format: extensionOf(fileName),
      fileName,
      fileId: file.file_id,
      downloadCount: attrs.download_count || 0,
      hearingImpaired: Boolean(attrs.hearing_impaired),
      release: attrs.release || '',
      uploadDate: attrs.upload_date || '',
      url: attrs.url || ''
    };
  }

  class OpenSubtitlesProvider {
    constructor(options) {
      const opts = options || {};
      const nativeFetch =
        typeof fetch === 'function' ? fetch.bind(globalThis) : null;
      this.fetch = opts.fetchImpl
        ? opts.fetchImpl.bind(globalThis)
        : nativeFetch;
      this.baseUrl = opts.baseUrl || BASE_URL;
      this.config = opts.config || {};
      this.userAgent = opts.userAgent || DEFAULT_USER_AGENT;
    }

    get configured() {
      return Boolean(
        this.config && this.config.enabled && this.config.apiKey
      );
    }

    _headers(json) {
      // Do not set User-Agent: Chromium forbids it in fetch. The extension's
      // normal browser User-Agent is sufficient for OpenSubtitles.
      return {
        'Api-Key': this.config.apiKey,
        Accept: 'application/json',
        ...(json ? { 'Content-Type': 'application/json' } : {})
      };
    }

    async _request(url, options) {
      if (!this.fetch) {
        throw new ProviderError('NO_FETCH', '当前环境不支持网络请求。');
      }
      let response;
      try {
        response = await this.fetch(url, options);
      } catch (error) {
        throw new ProviderError(
          'NETWORK_ERROR',
          'OpenSubtitles 连接失败：' +
            (error && error.message ? error.message : '网络错误'),
          null
        );
      }
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        payload = null;
      }
      if (!response.ok) {
        throw new ProviderError(
          response.status === 401 || response.status === 403
            ? 'AUTH_ERROR'
            : 'HTTP_ERROR',
          (payload && (payload.message || payload.error)) ||
            'OpenSubtitles 请求失败（HTTP ' + response.status + '）',
          response.status
        );
      }
      return payload;
    }

    async search(query) {
      if (!this.configured) {
        throw new ProviderError(
          'NOT_CONFIGURED',
          'OpenSubtitles 未启用或缺少 API Key。'
        );
      }
      const input = query || {};
      const title = String(input.title || '').trim();
      if (!title) {
        throw new ProviderError('INVALID_QUERY', '缺少片名，无法搜索字幕。');
      }
      const params = new URLSearchParams();
      params.set('query', title);
      params.set('languages', languageList(input, this.config).join(','));
      params.set('page', '1');
      params.set('order_by', 'download_count');
      params.set('order_direction', 'desc');
      if (input.year) params.set('year', String(input.year));
      if (input.season && input.episode) {
        params.set('type', 'episode');
        params.set('season_number', String(input.season));
        params.set('episode_number', String(input.episode));
      } else {
        params.set('type', 'movie');
      }

      const payload = await this._request(
        this.baseUrl + '/subtitles?' + params.toString(),
        {
          method: 'GET',
          headers: this._headers(false)
        }
      );
      const data = payload && Array.isArray(payload.data) ? payload.data : [];
      return data
        .map(function (item) {
          return mapCandidate(item, input);
        })
        .filter(Boolean)
        .slice(0, MAX_RESULTS);
    }

    async download(candidate) {
      if (!this.configured) {
        throw new ProviderError(
          'NOT_CONFIGURED',
          'OpenSubtitles 未启用或缺少 API Key。'
        );
      }
      const input = candidate || {};
      const fileId = Number(input.fileId);
      if (!Number.isInteger(fileId) || fileId <= 0) {
        throw new ProviderError('INVALID_FILE', 'OpenSubtitles 文件 ID 无效。');
      }

      const payload = await this._request(this.baseUrl + '/download', {
        method: 'POST',
        headers: this._headers(true),
        body: JSON.stringify({ file_id: fileId })
      });
      const link = payload && payload.link;
      if (!link) {
        throw new ProviderError('NO_DOWNLOAD_LINK', '没有拿到下载链接。');
      }

      let response;
      try {
        response = await this.fetch(link, {
          method: 'GET',
          headers: { Accept: '*/*' }
        });
      } catch (error) {
        throw new ProviderError(
          'DOWNLOAD_NETWORK_ERROR',
          '字幕下载失败：' +
            (error && error.message ? error.message : '网络错误')
        );
      }
      if (!response.ok) {
        throw new ProviderError(
          'DOWNLOAD_HTTP_ERROR',
          '字幕下载失败（HTTP ' + response.status + '）。',
          response.status
        );
      }
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        throw new ProviderError(
          'ZIP_UNSUPPORTED',
          'OpenSubtitles 返回了 ZIP 包，当前版本不会自动解压，请手动下载该字幕。'
        );
      }
      const text = new TextDecoder('utf-8').decode(bytes);
      if (!text.trim()) {
        throw new ProviderError('EMPTY_DOWNLOAD', '下载到的字幕为空。');
      }
      return {
        fileName: payload.file_name || input.fileName || 'opensubtitles.srt',
        text,
        remaining: payload.remaining == null ? null : payload.remaining
      };
    }
  }

  return {
    BASE_URL,
    DEFAULT_USER_AGENT,
    MAX_RESULTS,
    ProviderError,
    OpenSubtitlesProvider
  };
});
