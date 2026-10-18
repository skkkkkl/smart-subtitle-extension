/*
 * Audio feature/window preparation for multi-window calibration.
 *
 * This does not claim speech detection. It estimates a noise floor, creates a
 * hysteretic activity mask, and validates the media-time mapping. Windows with
 * too little activity are rejected before any correlation is attempted.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartSubtitle.alignment.AudioFeatures = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function percentile(values, ratio) {
    if (!values.length) return 0;
    const sorted = values.slice().sort(function (a, b) {
      return a - b;
    });
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor((sorted.length - 1) * ratio))
    );
    return sorted[index];
  }

  function buildAudioFrames(samples, options) {
    const opts = options || {};
    const list = (Array.isArray(samples) ? samples : [])
      .filter(function (sample) {
        return (
          sample &&
          Number.isFinite(sample.mediaMs) &&
          Number.isFinite(sample.rms) &&
          sample.rms >= 0
        );
      })
      .sort(function (a, b) {
        return a.mediaMs - b.mediaMs;
      });
    if (list.length < 12) {
      return {
        ok: false,
        code: 'NOT_ENOUGH_SAMPLES',
        message: '音频样本不足。'
      };
    }
    const deltas = [];
    for (let i = 1; i < list.length; i += 1) {
      deltas.push(list[i].mediaMs - list[i - 1].mediaMs);
    }
    const maxGap = opts.maxGapMs || 1500;
    if (deltas.some(function (delta) { return delta <= 0; })) {
      return {
        ok: false,
        code: 'INVALID_TIME_ORDER',
        message: '音频时间戳不是单调递增，采样窗口无效。'
      };
    }
    if (deltas.some(function (delta) { return delta > maxGap; })) {
      return {
        ok: false,
        code: 'TIME_GAP',
        message: '音频采样发生时间跳变，窗口无效。'
      };
    }
    const rmsValues = list.map(function (sample) {
      return sample.rms;
    });
    const noiseFloor = percentile(rmsValues, 0.2);
    const peak = percentile(rmsValues, 0.95);
    const range = peak - noiseFloor;
    if (range < (opts.minRange || 0.005)) {
      return {
        ok: false,
        code: 'FLAT_AUDIO',
        message: '音频能量变化过小，无法区分活动片段。'
      };
    }
    const high = noiseFloor + range * 0.35;
    const low = noiseFloor + range * 0.2;
    let active = false;
    const frames = list.map(function (sample) {
      if (!active && sample.rms >= high) active = true;
      else if (active && sample.rms <= low) active = false;
      return {
        mediaMs: sample.mediaMs,
        rms: sample.rms,
        active
      };
    });
    const activeCount = frames.reduce(function (sum, frame) {
      return sum + (frame.active ? 1 : 0);
    }, 0);
    return {
      ok: true,
      frames,
      noiseFloor,
      peak,
      activeRatio: activeCount / frames.length,
      spanMs: frames[frames.length - 1].mediaMs - frames[0].mediaMs,
      sampleCount: frames.length
    };
  }

  function splitWindows(frames, options) {
    const opts = options || {};
    const windowMs = opts.windowMs || 8000;
    const count = opts.count || 5;
    const gapMs = opts.gapMs || 0;
    const minFrames = opts.minFrames || 20;
    if (!Array.isArray(frames) || frames.length < minFrames) return [];
    const start = frames[0].mediaMs;
    const windows = [];
    for (let index = 0; index < count; index += 1) {
      const from = start + index * (windowMs + gapMs);
      const to = from + windowMs;
      const slice = frames.filter(function (frame) {
        return frame.mediaMs >= from && frame.mediaMs < to;
      });
      if (slice.length < minFrames) continue;
      const active = slice.reduce(function (sum, frame) {
        return sum + (frame.active ? 1 : 0);
      }, 0);
      windows.push({
        index,
        startMs: from,
        endMs: to,
        frames: slice,
        activeRatio: active / slice.length
      });
    }
    return windows;
  }

  return {
    buildAudioFrames,
    splitWindows,
    percentile
  };
});
