/*
 * WebVTT parser and serializer.
 *
 * The parser validates cue timing and preserves cue text plus cue settings.
 * STYLE/REGION blocks are retained and re-emitted by the serializer. NOTE
 * blocks are accepted but not preserved. This is intentionally a subset of the
 * full WebVTT specification, not a claim of complete compliance.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./subtitle-error.js'),
      require('./timing.js')
    );
  } else {
    root.SmartSubtitle.subtitles.VttParser = factory(
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

  function isNoteStart(line) {
    return /^NOTE(?:[ \t]|$)/.test(line);
  }

  function isStyleStart(line) {
    return /^STYLE(?:[ \t]|$)/.test(line);
  }

  function isRegionStart(line) {
    return /^REGION(?:[ \t]|$)/.test(line);
  }

  function collectBlocks(lines, startIndex) {
    const blocks = [];
    let i = startIndex;
    while (i < lines.length) {
      while (i < lines.length && isBlank(lines[i])) i += 1;
      if (i >= lines.length) break;
      const startLine = i + 1;
      const block = [];
      while (i < lines.length && !isBlank(lines[i])) {
        block.push(lines[i]);
        i += 1;
      }
      blocks.push({ startLine, lines: block });
    }
    return blocks;
  }

  function parseTimingLine(line, lineNumber) {
    const match = TIMING_RE.exec(line);
    if (!match) {
      throw new SubtitleError(
        'VTT_INVALID_TIMING_LINE',
        '无法识别 WebVTT 时间轴行（第 ' + lineNumber + ' 行）。',
        { line: lineNumber, details: line }
      );
    }

    const startMs = Timing.parseTimestamp(match[1], {
      format: 'vtt',
      line: lineNumber
    });
    const endMs = Timing.parseTimestamp(match[2], {
      format: 'vtt',
      line: lineNumber
    });

    if (endMs < startMs) {
      throw new SubtitleError(
        'VTT_END_BEFORE_START',
        '字幕结束时间早于开始时间（第 ' + lineNumber + ' 行）。',
        { line: lineNumber, details: { startMs, endMs } }
      );
    }

    return {
      startMs,
      endMs,
      settings: match[3] ? match[3].trim() : ''
    };
  }

  function parse(text) {
    const normalized = normalize(text);
    const lines = normalized.split('\n');
    if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0])) {
      throw new SubtitleError(
        'VTT_MISSING_HEADER',
        'WebVTT 文件必须以 WEBVTT 开头。',
        { line: 1, details: lines[0] }
      );
    }

    let headerEnd = 1;
    while (headerEnd < lines.length && !isBlank(lines[headerEnd])) {
      headerEnd += 1;
    }

    const cues = [];
    const warnings = [];
    const styleBlocks = [];
    let seenCue = false;
    const blocks = collectBlocks(lines, headerEnd);

    for (const block of blocks) {
      const first = block.lines[0];

      if (isNoteStart(first)) {
        continue;
      }

      if (isStyleStart(first) || isRegionStart(first)) {
        if (seenCue) {
          warnings.push({
            code: 'VTT_LATE_STYLE_BLOCK',
            message:
              'STYLE/REGION 块出现在字幕之后（第 ' + block.startLine +
              ' 行），已移到输出文件开头。',
            line: block.startLine
          });
        }
        styleBlocks.push(block.lines.join('\n'));
        continue;
      }

      let timingIndex = -1;
      let id = null;
      if (block.lines[0].includes('-->')) {
        timingIndex = 0;
      } else if (block.lines[1] && block.lines[1].includes('-->')) {
        timingIndex = 1;
        id = block.lines[0].trim() || null;
      } else {
        throw new SubtitleError(
          'VTT_EXPECTED_TIMING',
          'WebVTT 字幕块缺少时间轴行（第 ' + block.startLine + ' 行）。',
          { line: block.startLine, details: first }
        );
      }

      const timing = parseTimingLine(
        block.lines[timingIndex],
        block.startLine + timingIndex
      );
      const cueText = block.lines.slice(timingIndex + 1).join('\n');

      if (timing.endMs === timing.startMs) {
        warnings.push({
          code: 'VTT_ZERO_DURATION',
          message: '存在开始与结束时间相同的字幕（第 ' + block.startLine + ' 行）。',
          line: block.startLine
        });
      }
      if (!cueText) {
        warnings.push({
          code: 'VTT_EMPTY_TEXT',
          message: '存在没有对白文字的字幕（第 ' + block.startLine + ' 行）。',
          line: block.startLine
        });
      }

      cues.push({
        id,
        startMs: timing.startMs,
        endMs: timing.endMs,
        text: cueText,
        settings: timing.settings
      });
      seenCue = true;
    }

    if (cues.length === 0) {
      throw new SubtitleError('VTT_NO_CUES', '未在 WebVTT 文件中找到任何字幕。');
    }

    return {
      format: 'vtt',
      cues,
      warnings,
      styleBlocks
    };
  }

  /**
   * @param {Array<{startMs:number,endMs:number,text:string,id?:string|null,settings?:string}>} cues
   * @param {{styleBlocks?: string[]}} [options]
   */
  function serialize(cues, options) {
    if (!Array.isArray(cues)) {
      throw new SubtitleError('INVALID_CUES', '字幕数据不是有效的数组。');
    }
    const styleBlocks = (options && options.styleBlocks) || [];
    const parts = ['WEBVTT'];

    for (const styleBlock of styleBlocks) {
      if (typeof styleBlock === 'string' && styleBlock.trim()) {
        parts.push('');
        parts.push(styleBlock.replace(/\s+$/, ''));
      }
    }

    for (const cue of cues) {
      parts.push('');
      if (cue.id != null && String(cue.id).trim()) {
        parts.push(String(cue.id).trim());
      }
      const settings = cue.settings ? ' ' + cue.settings.trim() : '';
      parts.push(
        Timing.formatTimestamp(cue.startMs, { separator: '.' }) +
          ' --> ' +
          Timing.formatTimestamp(cue.endMs, { separator: '.' }) +
          settings
      );
      if (cue.text) {
        parts.push(cue.text);
      }
    }

    if (cues.length > 0) {
      parts.push('');
    }

    return parts.join('\n');
  }

  return { parse, serialize };
});
