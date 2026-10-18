/*
 * Shared namespace for classic content scripts.
 *
 * Chrome content scripts listed in manifest.json cannot be ES modules, so the
 * extension uses a small, explicit namespace instead of a bundler. Every other
 * content script depends on this file being injected first.
 */
(function (root) {
  'use strict';

  var NS = root.SmartSubtitle = root.SmartSubtitle || {};
  NS.VERSION = '0.12.3';
  NS.subtitles = NS.subtitles || {};
  NS.alignment = NS.alignment || {};
  NS.storage = NS.storage || {};
  NS.matching = NS.matching || {};
  NS.content = NS.content || {};
})(typeof globalThis !== 'undefined' ? globalThis : this);
