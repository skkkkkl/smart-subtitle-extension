/*
 * First-line synchronization.
 *
 * The first subtitle line is a useful anchor: it does not require reading or
 * understanding the language. This module detects the first sustained audio
 * activity in a short capture and converts it to a target offset.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./audio-features.js'));
  } else {
    root.SmartSubtitle.alignment.FirstLine = factory(
      root.SmartSubtitle.alignment.AudioFeatures
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (AudioFeatures) {
  'use strict';

  function detectFirstOnset(samples, options) {
    const features = AudioFeatures.buildAudioFrames(samples, options);
    if (!features.ok) {
      return {
        ok: false,
        code: features.code,
        message: features.message
      };
    }
    const sustain = (options && options.sustainFrames) || 3;
    let runStart = null;
    for (let index = 0; index < features.frames.length; index += 1) {
      const frame = features.frames[index];
      if (!frame.active) {
        runStart = null;
        continue;
      }
      if (runStart == null) runStart = index;
      if (index - runStart + 1 >= sustain) {
        const onsetMs = features.frames[runStart].mediaMs;
        return {
          ok: true,
          onsetMs,
          confidence: onsetMs < 1000 ? 'low' : 'medium',
          warnings:
            onsetMs < 1000
              ? ['检测到片头立即有声音，可能是音乐/音效；请确认首句。']
              : [],
          spanMs: features.spanMs,
          activeRatio: features.activeRatio
        };
      }
    }
    return {
      ok: false,
      code: 'NO_ONSET',
      message: '没有检测到持续声音活动，请改用手动首句或台词锚点。'
    };
  }

  function offsetFromFirstLine(onsetMs, firstCueStartMs) {
    if (!Number.isFinite(onsetMs) || !Number.isFinite(firstCueStartMs)) {
      return {
        ok: false,
        code: 'INVALID_FIRST_LINE',
        message: '首句锚点时间无效。'
      };
    }
    return {
      ok: true,
      offsetMs: Math.round(onsetMs - firstCueStartMs),
      onsetMs: Math.round(onsetMs),
      firstCueStartMs: Math.round(firstCueStartMs)
    };
  }

  return {
    detectFirstOnset,
    offsetFromFirstLine
  };
});
