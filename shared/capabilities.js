/*
 * Runtime capability detection shared by Chrome and Firefox builds.
 * Firefox Android has no tabCapture/offscreen, so audio capture UI must be
 * hidden there instead of failing at click time.
 */
(function (root) {
  'use strict';
  const NS = (root.SmartSubtitle = root.SmartSubtitle || {});
  let permissions = [];
  try {
    const runtime =
      root.chrome && root.chrome.runtime
        ? root.chrome.runtime
        : root.browser && root.browser.runtime
          ? root.browser.runtime
          : null;
    if (runtime && typeof runtime.getManifest === 'function') {
      const manifest = runtime.getManifest();
      permissions = Array.isArray(manifest.permissions)
        ? manifest.permissions
        : [];
    }
  } catch (error) {
    permissions = [];
  }
  NS.capabilities = {
    audioCapture: permissions.indexOf('tabCapture') !== -1,
    platform: root.chrome && root.chrome.runtime ? 'chrome' : 'firefox'
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
