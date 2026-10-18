/*
 * Provider contract and registry.
 *
 * This module contains NO built-in network provider and NO endpoint URL. The
 * extension may only send metadata to a provider after the user explicitly
 * configures an audited source; the provider object is responsible for honoring
 * that source's terms, rate limits and privacy disclosure.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartSubtitle.matching.SubtitleProvider = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  class ProviderError extends Error {
    constructor(code, message, options) {
      super(message);
      this.name = 'ProviderError';
      this.code = code;
      this.details = options && options.details;
    }
  }

  function validateProvider(provider) {
    if (!provider || typeof provider !== 'object') {
      throw new ProviderError('INVALID_PROVIDER', '字幕来源必须是对象。');
    }
    if (
      typeof provider.id !== 'string' ||
      !/^[a-z0-9][a-z0-9._-]{1,40}$/.test(provider.id)
    ) {
      throw new ProviderError(
        'INVALID_PROVIDER_ID',
        '字幕来源 id 必须是小写字母、数字、点、下划线或短横线。'
      );
    }
    if (typeof provider.name !== 'string' || !provider.name.trim()) {
      throw new ProviderError(
        'INVALID_PROVIDER_NAME',
        '字幕来源必须提供显示名称。'
      );
    }
    if (typeof provider.search !== 'function') {
      throw new ProviderError(
        'INVALID_PROVIDER_SEARCH',
        '字幕来源必须实现 search(query, context)。'
      );
    }
    if (typeof provider.download !== 'function') {
      throw new ProviderError(
        'INVALID_PROVIDER_DOWNLOAD',
        '字幕来源必须实现 download(candidate, context)。'
      );
    }
    if (
      provider.enabled !== undefined &&
      typeof provider.enabled !== 'boolean'
    ) {
      throw new ProviderError(
        'INVALID_PROVIDER_ENABLED',
        'enabled 必须是布尔值。'
      );
    }
    return true;
  }

  function normalizeCandidate(candidate, provider) {
    if (!candidate || typeof candidate !== 'object') {
      throw new ProviderError(
        'INVALID_CANDIDATE',
        '字幕来源返回了无效候选。'
      );
    }
    return Object.assign({}, candidate, {
      providerId: provider.id,
      providerName: provider.name,
      sourceId: provider.id
    });
  }

  class ProviderRegistry {
    constructor() {
      this.providers = new Map();
    }

    register(provider) {
      validateProvider(provider);
      if (this.providers.has(provider.id)) {
        throw new ProviderError(
          'DUPLICATE_PROVIDER',
          '字幕来源已存在：' + provider.id
        );
      }
      this.providers.set(provider.id, provider);
      return provider;
    }

    unregister(providerId) {
      return this.providers.delete(providerId);
    }

    get(providerId) {
      return this.providers.get(providerId) || null;
    }

    list() {
      return Array.from(this.providers.values()).map(function (provider) {
        return {
          id: provider.id,
          name: provider.name,
          enabled: provider.enabled !== false,
          termsUrl: provider.termsUrl || null
        };
      });
    }

    async search(query, context) {
      const enabled = Array.from(this.providers.values()).filter(
        function (provider) {
          return provider.enabled !== false;
        }
      );
      const errors = [];
      const candidates = [];
      const settled = await Promise.allSettled(
        enabled.map(function (provider) {
          return provider.search(query, context);
        })
      );

      settled.forEach(function (result, index) {
        const provider = enabled[index];
        if (result.status === 'rejected') {
          const reason = result.reason;
          errors.push({
            providerId: provider.id,
            code:
              reason && reason.code ? reason.code : 'PROVIDER_SEARCH_FAILED',
            message:
              reason && reason.message
                ? reason.message
                : '字幕来源搜索失败。'
          });
          return;
        }
        const value = result.value;
        const list = Array.isArray(value)
          ? value
          : value && Array.isArray(value.candidates)
            ? value.candidates
            : [];
        for (const candidate of list) {
          try {
            candidates.push(normalizeCandidate(candidate, provider));
          } catch (error) {
            errors.push({
              providerId: provider.id,
              code: error.code || 'INVALID_CANDIDATE',
              message: error.message
            });
          }
        }
      });

      return {
        candidates,
        errors,
        providerCount: enabled.length
      };
    }

    async download(providerId, candidate, context) {
      const provider = this.providers.get(providerId);
      if (!provider) {
        throw new ProviderError(
          'PROVIDER_NOT_FOUND',
          '未找到字幕来源：' + providerId
        );
      }
      if (provider.enabled === false) {
        throw new ProviderError(
          'PROVIDER_DISABLED',
          '字幕来源当前已禁用：' + provider.name
        );
      }
      return provider.download(candidate, context);
    }
  }

  return {
    ProviderError,
    ProviderRegistry,
    validateProvider,
    normalizeCandidate
  };
});
