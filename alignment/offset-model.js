/*
 * Pure global-offset model.
 *
 * Positive values delay the subtitles; negative values advance them. Cues that
 * would finish before t=0 are removed from the rendered document (the original
 * parsed document is never mutated). Cues crossing t=0 are clamped.
 *
 * This module deliberately knows nothing about audio, video elements or
 * Chrome. A future LocalAligner can reuse the same output type.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../subtitles/subtitle-error.js'));
  } else {
    root.SmartSubtitle.alignment.OffsetModel = factory(
      root.SmartSubtitle.subtitles.SubtitleError
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ErrorModule) {
  'use strict';

  const SubtitleError = ErrorModule.SubtitleError;

  const MIN_OFFSET_MS = -3600000; // -1 hour
  const MAX_OFFSET_MS = 3600000; // +1 hour

  function normalizeOffset(offsetMs) {
    const value = offsetMs;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      !Number.isInteger(value)
    ) {
      throw new SubtitleError(
        'INVALID_OFFSET',
        '偏移量必须是整数毫秒。',
        { details: offsetMs }
      );
    }
    if (value < MIN_OFFSET_MS || value > MAX_OFFSET_MS) {
      throw new SubtitleError(
        'OFFSET_OUT_OF_RANGE',
        '偏移量必须在 -3,600,000 ms 到 +3,600,000 ms（±1 小时）之间。',
        { details: value }
      );
    }
    return value;
  }

  /**
   * @param {Array<{startMs:number,endMs:number,text:string,id?:string|null,settings?:string}>} cues
   * @param {number} offsetMs
   * @returns {{cues:Array, offsetMs:number, dropped:number, clamped:number}}
   */
  function shiftCues(cues, offsetMs) {
    const offset = normalizeOffset(offsetMs);
    if (!Array.isArray(cues)) {
      throw new SubtitleError('INVALID_CUES', '字幕数据不是有效的数组。');
    }

    const shifted = [];
    let dropped = 0;
    let clamped = 0;

    for (const cue of cues) {
      if (
        !cue ||
        !Number.isInteger(cue.startMs) ||
        !Number.isInteger(cue.endMs) ||
        cue.startMs < 0 ||
        cue.endMs < cue.startMs
      ) {
        throw new SubtitleError(
          'INVALID_CUES',
          '字幕中存在无效的时间轴数据，无法应用偏移。'
        );
      }

      let startMs = cue.startMs + offset;
      let endMs = cue.endMs + offset;

      if (endMs <= 0) {
        dropped += 1;
        continue;
      }
      if (startMs < 0) {
        startMs = 0;
        clamped += 1;
      }
      if (endMs < startMs) {
        endMs = startMs;
      }

      shifted.push(
        Object.assign({}, cue, {
          startMs,
          endMs
        })
      );
    }

    return { cues: shifted, offsetMs: offset, dropped, clamped };
  }

  function formatOffset(offsetMs) {
    const value = normalizeOffset(offsetMs);
    if (value === 0) return '0 ms';
    return (value > 0 ? '+' : '') + value + ' ms';
  }

  return {
    MIN_OFFSET_MS,
    MAX_OFFSET_MS,
    normalizeOffset,
    shiftCues,
    formatOffset
  };
});
