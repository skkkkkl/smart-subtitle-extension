/*
 * Runtime capability detection shared by Chrome and Firefox builds.
 *
 * Chromium builds on phone browsers such as Kiwi keep Chrome's Manifest V3
 * manifests, so a permission check alone is not enough: `tabCapture` and
 * `offscreen` are declared but unusable on mobile. Capabilities are therefore
 * decided by declared permission AND a runtime probe, and mobile Chromium is
 * detected from the viewport (there is no cheap UA check on one UI and the
 * panel has to be touch-sized regardless of the brand).
 */
(function (root) {
  'use strict';
  const NS = (root.SmartSubtitle = root.SmartSubtitle || {});

  let permissions = [];
  let hasTabCapture = false;
  let hasOffscreen = false;
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

  const api =
    root.chrome && root.chrome.tabCapture
      ? root.chrome
      : root.browser && root.browser.tabCapture
        ? root.browser
        : null;
  hasTabCapture = Boolean(
    permissions.indexOf('tabCapture') !== -1 &&
      api &&
      api.tabCapture &&
      typeof api.tabCapture.getMediaStreamId === 'function'
  );
  hasOffscreen = Boolean(
    permissions.indexOf('offscreen') !== -1 &&
      api &&
      api.offscreen &&
      typeof api.offscreen.createDocument === 'function'
  );

  let viewportWidth = 0;
  let coarsePointer = false;
  try {
    viewportWidth = Number(root.innerWidth) || 0;
    if (root.matchMedia) {
      coarsePointer = root.matchMedia('(pointer: coarse)').matches;
    }
  } catch (error) {
    viewportWidth = 0;
    coarsePointer = false;
  }
  // 768px covers phones and small tablet portrait; a phone UI always reports a
  // coarse pointer, which keeps a narrow desktop window from being misread.
  const touchViewport = viewportWidth > 0 && viewportWidth <= 768;
  const mobile = touchViewport && coarsePointer;

  NS.capabilities = {
    audioCapture: hasTabCapture && hasOffscreen && !mobile,
    platform: root.chrome && root.chrome.runtime ? 'chrome' : 'firefox',
    mobile,
    viewportWidth
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
