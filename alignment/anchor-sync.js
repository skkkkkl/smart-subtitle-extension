/*
 * Text-anchor synchronization.
 *
 * Audio/cue correlation is not reliable on mixed or DRM media. This module
 * implements a deterministic fallback: the user identifies a subtitle line by
 * text, then the current video time gives the exact target offset.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartSubtitle.alignment.AnchorSync = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function normalizeText(value) {
    return String(value == null ? '' : value)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/[\s\p{P}\p{S}]/gu, '');
  }

  function searchCues(cues, query, options) {
    const needle = normalizeText(query);
    const limit =
      options && Number.isInteger(options.limit) && options.limit > 0
        ? options.limit
        : 12;
    if (needle.length < 2) return [];
    const results = [];
    for (let index = 0; index < cues.length; index += 1) {
      const cue = cues[index];
      if (!cue) continue;
      const haystack = normalizeText(cue.text);
      const at = haystack.indexOf(needle);
      if (at < 0) continue;
      let score = 100;
      if (haystack === needle) score += 500;
      else if (at === 0) score += 250;
      score += Math.max(0, 80 - at);
      score += Math.max(0, 80 - Math.abs(haystack.length - needle.length));
      results.push({
        cueIndex: index,
        startMs: cue.startMs,
        endMs: cue.endMs,
        text: cue.text,
        score
      });
    }
    results.sort(function (a, b) {
      return b.score - a.score || a.startMs - b.startMs;
    });
    return results.slice(0, limit);
  }

  function offsetForAnchor(videoTimeMs, cue) {
    if (!Number.isFinite(videoTimeMs) || !cue || !Number.isFinite(cue.startMs)) {
      return {
        ok: false,
        code: 'INVALID_ANCHOR',
        message: '锚点时间无效。'
      };
    }
    const offsetMs = Math.round(videoTimeMs - cue.startMs);
    if (!Number.isFinite(offsetMs)) {
      return {
        ok: false,
        code: 'INVALID_ANCHOR',
        message: '锚点偏移无效。'
      };
    }
    return {
      ok: true,
      offsetMs,
      cueStartMs: cue.startMs,
      videoTimeMs: Math.round(videoTimeMs)
    };
  }

  return {
    normalizeText,
    searchCues,
    offsetForAnchor
  };
});
