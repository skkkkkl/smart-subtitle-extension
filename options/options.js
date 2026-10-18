'use strict';

(function () {
  const NS = globalThis.SmartSubtitle;
  const SettingsModel = NS.storage.SettingsModel;
  const SettingsStore = NS.storage.SettingsStore.SettingsStore;
  const SubtitleCache = NS.storage.SubtitleCache.SubtitleCache;
  const ProviderStore = NS.storage.ProviderStore.ProviderStore;
  const store = new SettingsStore();
  const cache = new SubtitleCache({ maxEntries: 50 });
  const providerStore = new ProviderStore();

  const form = document.getElementById('settings-form');
  const status = document.querySelector('[data-role="status"]');
  const statusText = document.querySelector('[data-role="status-text"]');
  const saveButton = form.querySelector('button[type="submit"]');
  const clearButton = document.getElementById('clear-data');
  const resetFormButton = document.getElementById('reset-form');
  const previewCue = document.querySelector('[data-role="preview-cue"]');
  const previewText = document.querySelector('[data-role="preview-text"]');
  const cacheCount = document.querySelector('[data-role="cache-count"]');
  const providerApiKey = document.querySelector(
    '[data-role="provider-api-key"]'
  );
  const providerEnabled = document.querySelector(
    '[data-role="provider-enabled"]'
  );
  const providerStatus = document.querySelector(
    '[data-role="provider-status"]'
  );
  const providerStatusText = document.querySelector(
    '[data-role="provider-status-text"]'
  );
  const saveProviderButton = document.getElementById('save-provider');
  const testProviderButton = document.getElementById('test-provider');

  const controls = {};
  for (const input of form.querySelectorAll('[data-setting]')) {
    controls[input.getAttribute('data-setting')] = input;
  }

  let settings = SettingsModel.createDefaultSettings();
  let busy = false;

  function setStatus(message, tone) {
    status.className = 'status' + (tone ? ' ' + tone : '');
    statusText.textContent = message;
  }

  function setProviderStatus(message, tone) {
    providerStatus.className = 'status' + (tone ? ' ' + tone : '');
    providerStatusText.textContent = message;
  }

  function hasPermissionsApi() {
    return Boolean(
      typeof chrome !== 'undefined' &&
        chrome.permissions &&
        chrome.permissions.contains
    );
  }

  async function providerPermissionGranted() {
    if (!hasPermissionsApi()) return false;
    try {
      return await chrome.permissions.contains({
        origins: ['https://*.opensubtitles.com/*']
      });
    } catch (error) {
      return false;
    }
  }

  async function requestProviderPermission() {
    if (
      typeof chrome === 'undefined' ||
      !chrome.permissions ||
      !chrome.permissions.request
    ) {
      return false;
    }
    return chrome.permissions.request({
      origins: ['https://*.opensubtitles.com/*']
    });
  }

  async function removeProviderPermission() {
    if (
      typeof chrome === 'undefined' ||
      !chrome.permissions ||
      !chrome.permissions.remove
    ) {
      return false;
    }
    return chrome.permissions.remove({
      origins: ['https://*.opensubtitles.com/*']
    });
  }

  async function loadProviderSettings() {
    try {
      const config = await providerStore.load();
      providerApiKey.value = config.apiKey || '';
      providerEnabled.checked = Boolean(config.enabled);
      if (config.enabled && config.apiKey) {
        const granted = await providerPermissionGranted();
        setProviderStatus(
          granted
            ? 'OpenSubtitles 已启用。搜索时会发送片名/年份/语言/集数。'
            : '已保存设置，但域名权限未授予；请在保存时允许。',
          granted ? 'ok' : 'warn'
        );
      } else {
        setProviderStatus('在线来源未启用；本地候选和字幕库仍可用。', '');
      }
    } catch (error) {
      setProviderStatus(
        '来源设置读取失败：' +
          (error && error.message ? error.message : '未知错误'),
        'error'
      );
    }
  }

  async function saveProviderSettings() {
    const apiKey = providerApiKey.value.trim();
    const enabled = providerEnabled.checked;
    if (enabled && !apiKey) {
      setProviderStatus('启用在线搜索前需要填写 API Key。', 'error');
      return;
    }
    try {
      saveProviderButton.disabled = true;
      let permissionDenied = false;
      if (enabled) {
        const granted = await requestProviderPermission();
        permissionDenied = !granted;
      } else {
        await removeProviderPermission().catch(function () {});
      }
      const saved = await providerStore.save({
        enabled: enabled && !permissionDenied,
        apiKey,
        userAgent: 'SmartSubtitle/0.5.1 (Chrome extension)',
        languages: ['zh', 'en']
      });
      if (permissionDenied) {
        providerApiKey.value = saved.apiKey;
        providerEnabled.checked = false;
        setProviderStatus(
          'API Key 已保存，但域名权限未授予，在线搜索未启用。' +
            '请重新勾选启用并允许权限。',
          'warn'
        );
        return;
      }
      providerApiKey.value = saved.apiKey;
      providerEnabled.checked = saved.enabled;
      setProviderStatus(
        saved.enabled
          ? 'OpenSubtitles 已启用；在面板「在线搜索」中提交片名。'
          : '在线来源已关闭。',
        saved.enabled ? 'ok' : ''
      );
    } catch (error) {
      setProviderStatus(
        '保存来源设置失败：' +
          (error && error.message ? error.message : '未知错误'),
        'error'
      );
    } finally {
      saveProviderButton.disabled = false;
    }
  }

  async function testProviderConnection() {
    if (
      typeof chrome === 'undefined' ||
      !chrome.runtime ||
      !chrome.runtime.sendMessage
    ) {
      setProviderStatus('当前不是扩展环境，无法测试在线来源。', 'warn');
      return;
    }
    testProviderButton.disabled = true;
    setProviderStatus('正在连接 OpenSubtitles…', '');
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SMART_SUBTITLE_PROVIDER_SEARCH',
        query: { title: 'matrix', language: 'en' }
      });
      if (!response || response.ok !== true) {
        throw new Error(
          response && response.error
            ? response.error
            : 'OpenSubtitles 返回失败。'
        );
      }
      const candidates = Array.isArray(response.candidates)
        ? response.candidates
        : [];
      setProviderStatus(
        '连接成功，OpenSubtitles 返回 ' +
          candidates.length +
          ' 条测试结果。现在可在面板「在线搜索」使用。',
        'ok'
      );
    } catch (error) {
      setProviderStatus(
        '连接失败：' +
          (error && error.message ? error.message : '未知错误'),
        'error'
      );
    } finally {
      testProviderButton.disabled = false;
    }
  }

  function setBusy(value) {
    busy = value;
    saveButton.disabled = value;
    clearButton.disabled = value;
    resetFormButton.disabled = value;
    form.setAttribute('aria-busy', value ? 'true' : 'false');
  }

  function readAppearance() {
    return {
      fontSize: Number(controls.fontSize.value),
      color: controls.color.value,
      fontWeight: Number(controls.fontWeight.value),
      outlineColor: controls.outlineColor.value,
      backgroundColor: controls.backgroundColor.value,
      backgroundOpacity: Number(controls.backgroundOpacity.value) / 100,
      outlineWidth: Number(controls.outlineWidth.value),
      position: Number(controls.position.value),
      shadowEnabled: Boolean(controls.shadowEnabled.checked),
      shadowColor: controls.shadowColor.value,
      shadowOpacity: Number(controls.shadowOpacity.value) / 100,
      shadowBlur: Number(controls.shadowBlur.value),
      shadowOffsetX: Number(controls.shadowOffsetX.value),
      shadowOffsetY: Number(controls.shadowOffsetY.value)
    };
  }

  function updateOutputs(appearance) {
    const signed = function (value) {
      return (value > 0 ? '+' : '') + value + 'px';
    };
    document.getElementById('fontSizeOut').textContent =
      appearance.fontSize + 'px';
    document.getElementById('outlineWidthOut').textContent =
      appearance.outlineWidth + 'px';
    document.getElementById('backgroundOpacityOut').textContent =
      Math.round(appearance.backgroundOpacity * 100) + '%';
    document.getElementById('positionOut').textContent =
      appearance.position + '%';
    document.getElementById('shadowOpacityOut').textContent =
      Math.round(appearance.shadowOpacity * 100) + '%';
    document.getElementById('shadowBlurOut').textContent =
      appearance.shadowBlur + 'px';
    document.getElementById('shadowOffsetXOut').textContent =
      signed(appearance.shadowOffsetX);
    document.getElementById('shadowOffsetYOut').textContent =
      signed(appearance.shadowOffsetY);
  }

  function updateShadowControls(enabled) {
    const section = document.querySelector('.shadow-section');
    if (section) section.classList.toggle('is-disabled', !enabled);
    for (const control of [
      controls.shadowColor,
      controls.shadowOpacity,
      controls.shadowBlur,
      controls.shadowOffsetX,
      controls.shadowOffsetY
    ]) {
      if (control) control.disabled = !enabled;
    }
  }

  async function refreshCacheCount() {
    try {
      const count = await cache.count();
      if (cacheCount) cacheCount.textContent = String(count);
      return count;
    } catch (error) {
      if (cacheCount) cacheCount.textContent = '?';
      return 0;
    }
  }

  function renderPreview(appearance) {
    const value = SettingsModel.sanitizeAppearance(appearance);
    const style = SettingsModel.buildPreviewStyle(value);
    previewCue.style.top = value.position + '%';
    previewText.style.color = style.color;
    previewText.style.fontSize = style.fontSize;
    previewText.style.fontWeight = style.fontWeight;
    previewText.style.lineHeight = style.lineHeight;
    previewText.style.textAlign = style.textAlign;
    previewText.style.backgroundColor = style.backgroundColor;
    previewText.style.textShadow = style.textShadow;
    updateOutputs(value);
    updateShadowControls(value.shadowEnabled);
    return value;
  }

  function fillForm(appearance) {
    const value = SettingsModel.sanitizeAppearance(appearance);
    controls.fontSize.value = String(value.fontSize);
    controls.fontWeight.value = String(value.fontWeight);
    controls.color.value = value.color;
    controls.outlineColor.value = value.outlineColor;
    controls.backgroundColor.value = value.backgroundColor;
    controls.backgroundOpacity.value = String(
      Math.round(value.backgroundOpacity * 100)
    );
    controls.outlineWidth.value = String(value.outlineWidth);
    controls.position.value = String(value.position);
    controls.shadowEnabled.checked = value.shadowEnabled;
    controls.shadowColor.value = value.shadowColor;
    controls.shadowOpacity.value = String(
      Math.round(value.shadowOpacity * 100)
    );
    controls.shadowBlur.value = String(value.shadowBlur);
    controls.shadowOffsetX.value = String(value.shadowOffsetX);
    controls.shadowOffsetY.value = String(value.shadowOffsetY);
    renderPreview(value);
  }

  function onFormInput() {
    renderPreview(readAppearance());
    setStatus('有未保存的修改。', 'warn');
  }

  async function saveSettings() {
    if (busy) return;
    setBusy(true);
    setStatus('正在保存…', '');
    try {
      const next = SettingsModel.sanitizeSettings({
        version: settings.version,
        appearance: readAppearance()
      });
      settings = await store.save(next);
      fillForm(settings.appearance);
      setStatus(
        store.persistent ? '设置已保存到本机。' : '已保存到临时内存（当前不是扩展页）。',
        'ok'
      );
    } catch (error) {
      console.error('[本地字幕] 保存设置失败：', error);
      setStatus('保存失败：' + (error && error.message ? error.message : '未知错误'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function clearData() {
    if (busy) return;
    const confirmed = window.confirm(
      '确定清除本地字幕助手的所有本地数据吗？\n\n' +
        '包括外观设置和字幕库缓存；不会删除网页、视频或字幕文件。'
    );
    if (!confirmed) return;
    setBusy(true);
    setStatus('正在清除…', '');
    try {
      const cacheEntries = await cache.count().catch(function () {
        return 0;
      });
      const keys = await store.clearAll();
      await cache.clear();
      await providerStore.clear();
      await removeProviderPermission().catch(function () {});
      if (providerApiKey) providerApiKey.value = '';
      if (providerEnabled) providerEnabled.checked = false;
      setProviderStatus('在线来源设置已清除。', '');
      await refreshCacheCount();
      settings = SettingsModel.createDefaultSettings();
      fillForm(settings.appearance);
      const cleared = keys.length + cacheEntries;
      setStatus(
        cleared
          ? '已清除 ' + keys.length + ' 项设置和 ' + cacheEntries +
            ' 条字幕缓存，外观已恢复默认。'
          : '没有需要清除的本地数据。',
        'ok'
      );
    } catch (error) {
      console.error('[本地字幕] 清除数据失败：', error);
      setStatus('清除失败：' + (error && error.message ? error.message : '未知错误'), 'error');
    } finally {
      setBusy(false);
    }
  }

  function resetForm() {
    fillForm(SettingsModel.DEFAULT_APPEARANCE);
    setStatus('已填入默认值，点击“保存设置”后生效。', 'warn');
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    void saveSettings();
  });
  form.addEventListener('input', onFormInput);
  clearButton.addEventListener('click', function () {
    void clearData();
  });
  resetFormButton.addEventListener('click', resetForm);
  saveProviderButton.addEventListener('click', function () {
    void saveProviderSettings();
  });
  testProviderButton.addEventListener('click', function () {
    void testProviderConnection();
  });

  (async function init() {
    try {
      settings = await store.load();
      fillForm(settings.appearance);
      setStatus(
        store.persistent
          ? '设置已加载。修改后点击“保存设置”。'
          : '当前为临时内存存储；在扩展页中会使用 chrome.storage.local。',
        store.persistent ? 'ok' : 'warn'
      );
      await refreshCacheCount();
    } catch (error) {
      console.error('[本地字幕] 读取设置失败：', error);
      fillForm(SettingsModel.DEFAULT_APPEARANCE);
      setStatus('读取设置失败，已显示默认值。', 'error');
      await refreshCacheCount();
    }
    await loadProviderSettings();
  })();
})();
