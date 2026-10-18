/*
 * SRT parser. Produces a structured cue document; conversion to WebVTT happens
 * in subtitle-document.js through the shared serializer.
 *
 * Supported: optional cue numbers, BOM, CRLF/CR, comma or dot milliseconds,
 * multi-line dialogue, blank lines. Invalid timestamps and malformed blocks are
 * reported with a line number instead of being silently "fixed".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./subtitle-error.js'),
      require('./timing.js')
    );
  } else {
    root.SmartSubtitle.subtitles.SrtParser = factory(
      root.SmartSubtitle.subtitles.SubtitleError,
      root.SmartSubtitle.subtitles.Timing
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (
  ErrorModule,
  Timing
) {
  'use strict';

  const SubtitleError = ErrorModule.SubtitleError;
  const INDEX_RE = /^\s*\d+\s*$/;
  const TIMING_RE = /^\s*(\S+)\s*-->\s*(\S+)(?:\s+(.*?))?\s*$/;

  function normalize(text) {
    if (typeof text !== 'string') {
      throw new SubtitleError('INVALID_INPUT', '字幕内容不是文本。');
    }
    if (!text.trim()) {
      throw new SubtitleError('EMPTY_FILE', '字幕文件为空。');
    }
    return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  }

  function isBlank(line) {
    return /^\s*$/.test(line);
  }

  function parseTimingLine(line, lineNumber) {
    const match = TIMING_RE.exec(line);
    if (!match) {
      throw new SubtitleError(
        'SRT_INVALID_TIMING_LINE',
        '无法识别 SRT 时间轴行。应为“00:00:01,000 --> 00:00:02,000”。',
        { line: lineNumber, details: line }
      );
    }

    const startMs = Timing.parseTimestamp(match[1], {
      format: 'srt',
      line: lineNumber
    });
    const endMs = Timing.parseTimestamp(match[2], {
      format: 'srt',
      line: lineNumber
    });

    if (endMs < startMs) {
      throw new SubtitleError(
        'SRT_END_BEFORE_START',
        '字幕结束时间早于开始时间（第 ' + lineNumber + ' 行）。',
        { line: lineNumber, details: { startMs, endMs } }
      );
    }

    return {
      startMs,
      endMs,
      trailing: match[3] ? match[3].trim() : ''
    };
  }

  function parse(text) {
    const normalized = normalize(text);
    const lines = normalized.split('\n');
    const cues = [];
    const warnings = [];
    let i = 0;

    while (i < lines.length) {
      while (i < lines.length && isBlank(lines[i])) i += 1;
      if (i >= lines.length) break;

      const cueStartLine = i + 1;
      let id = null;

      if (INDEX_RE.test(lines[i])) {
        const next = lines[i + 1];
        if (next === undefined || !next.includes('-->')) {
          throw new SubtitleError(
            'SRT_EXPECTED_TIMING',
            '序号行后没有找到有效的时间轴行（第 ' + (i + 1) + ' 行）。',
            { line: i + 1 }
          );
        }
        id = lines[i].trim();
        i += 1;
      }

      if (!lines[i].includes('-->')) {
        throw new SubtitleError(
          'SRT_EXPECTED_TIMING',
          '此处应为 SRT 时间轴行（第 ' + (i + 1) + ' 行）。',
          { line: i + 1, details: lines[i] }
        );
      }

      const timingLineNumber = i + 1;
      const timing = parseTimingLine(lines[i], timingLineNumber);
      i += 1;

      if (timing.trailing) {
        warnings.push({
          code: 'SRT_IGNORED_TRAILING_TEXT',
          message:
            '已忽略时间轴行末的附加内容（第 ' + timingLineNumber + ' 行）：“' +
            timing.trailing.slice(0, 80) + '”。',
          line: timingLineNumber
        });
      }

      if (timing.endMs === timing.startMs) {
        warnings.push({
          code: 'SRT_ZERO_DURATION',
          message: '存在开始与结束时间相同的字幕（第 ' + cueStartLine + ' 条）。',
          line: cueStartLine
        });
      }

      const textLines = [];
      while (i < lines.length && !isBlank(lines[i])) {
        // Recover a common malformed case: the next numbered cue starts without
        // a separating blank line. Only treat it as a new cue when the following
        // line is clearly a timing line.
        if (
          textLines.length > 0 &&
          INDEX_RE.test(lines[i]) &&
          lines[i + 1] &&
          lines[i + 1].includes('-->')
        ) {
          warnings.push({
            code: 'SRT_MISSING_BLANK_LINE',
            message:
              '字幕块之间缺少空行，已在第 ' + (i + 1) + ' 行恢复解析。',
            line: i + 1
          });
          break;
        }
        textLines.push(lines[i]);
        i += 1;
      }

      const cueText = textLines.join('\n').replace(/^\n+|\n+$/g, '');
      if (!cueText) {
        warnings.push({
          code: 'SRT_EMPTY_TEXT',
          message: '存在没有对白文字的字幕（第 ' + cueStartLine + ' 条）。',
          line: cueStartLine
        });
      }

      cues.push({
        id,
        startMs: timing.startMs,
        endMs: timing.endMs,
        text: cueText
      });

      if (i < lines.length && isBlank(lines[i])) i += 1;
    }

    if (cues.length === 0) {
      throw new SubtitleError('SRT_NO_CUES', '未在 SRT 文件中找到任何字幕。');
    }

    return {
      format: 'srt',
      cues,
      warnings,
      styleBlocks: []
    };
  }

  return { parse };
});
