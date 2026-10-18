/*
 * Strict timestamp parsing and formatting. All internal cue times are integer
 * milliseconds, which avoids floating-point drift when offsets are applied.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./subtitle-error.js'));
  } else {
    root.SmartSubtitle.subtitles.Timing = factory(
      root.SmartSubtitle.subtitles.SubtitleError
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ErrorModule) {
  'use strict';

  const SubtitleError = ErrorModule.SubtitleError;

  // SRT: HH:MM:SS,mmm (a dot is accepted because many real files use it).
  const SRT_RE = /^(\d{1,3}):(\d{2}):(\d{2})[.,](\d{3})$/;
  // WebVTT full form: HH:MM:SS.mmm; short form: MM:SS.mmm.
  const VTT_FULL_RE = /^(\d{1,3}):(\d{2}):(\d{2})\.(\d{3})$/;
  const VTT_SHORT_RE = /^(\d{2}):(\d{2})\.(\d{3})$/;

  function parseTimestamp(value, options) {
    const format = (options && options.format) || 'srt';
    const line = options && options.line;
    const raw = String(value == null ? '' : value).trim();
    let match;
    let hours;
    let minutes;
    let seconds;
    let millis;

    if (format === 'vtt') {
      match = VTT_FULL_RE.exec(raw);
      if (match) {
        hours = Number(match[1]);
        minutes = Number(match[2]);
        seconds = Number(match[3]);
        millis = Number(match[4]);
      } else {
        match = VTT_SHORT_RE.exec(raw);
        if (!match) {
          throw new SubtitleError(
            'INVALID_TIMESTAMP',
            'WebVTT 时间戳格式无效：“' + raw + '”。应为 HH:MM:SS.mmm 或 MM:SS.mmm。',
            { line, details: raw }
          );
        }
        hours = 0;
        minutes = Number(match[1]);
        seconds = Number(match[2]);
        millis = Number(match[3]);
      }
    } else {
      match = SRT_RE.exec(raw);
      if (!match) {
        throw new SubtitleError(
          'INVALID_TIMESTAMP',
          'SRT 时间戳格式无效：“' + raw + '”。应为 HH:MM:SS,mmm。',
          { line, details: raw }
        );
      }
      hours = Number(match[1]);
      minutes = Number(match[2]);
      seconds = Number(match[3]);
      millis = Number(match[4]);
    }

    if (minutes > 59) {
      throw new SubtitleError(
        'INVALID_TIMESTAMP',
        '时间戳的分钟值必须在 00–59 之间：“' + raw + '”。',
        { line, details: raw }
      );
    }
    if (seconds > 59) {
      throw new SubtitleError(
        'INVALID_TIMESTAMP',
        '时间戳的秒值必须在 00–59 之间：“' + raw + '”。',
        { line, details: raw }
      );
    }
    if (millis > 999) {
      throw new SubtitleError(
        'INVALID_TIMESTAMP',
        '毫秒必须为 000–999：“' + raw + '”。',
        { line, details: raw }
      );
    }

    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
  }

  function formatTimestamp(ms, options) {
    const separator = (options && options.separator) || '.';
    const safe = Math.max(0, Math.round(Number(ms) || 0));
    const hours = Math.floor(safe / 3600000);
    const minutes = Math.floor((safe % 3600000) / 60000);
    const seconds = Math.floor((safe % 60000) / 1000);
    const millis = safe % 1000;
    return (
      String(hours).padStart(2, '0') +
      ':' +
      String(minutes).padStart(2, '0') +
      ':' +
      String(seconds).padStart(2, '0') +
      separator +
      String(millis).padStart(3, '0')
    );
  }

  function formatClock(ms) {
    const safe = Math.max(0, Math.round(Number(ms) || 0));
    const hours = Math.floor(safe / 3600000);
    const minutes = Math.floor((safe % 3600000) / 60000);
    const seconds = Math.floor((safe % 60000) / 1000);
    if (hours > 0) {
      return (
        String(hours) +
        ':' +
        String(minutes).padStart(2, '0') +
        ':' +
        String(seconds).padStart(2, '0')
      );
    }
    return (
      String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0')
    );
  }

  return { parseTimestamp, formatTimestamp, formatClock };
});
