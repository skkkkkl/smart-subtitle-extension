/*
 * Format-neutral subtitle document.
 *
 * This is the boundary between parsing and presentation. It has no DOM or
 * Chrome dependencies: the same object can later feed a native <track>, a
 * custom renderer (ASS), or an Android WebView renderer.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./subtitle-error.js'),
      require('./srt-parser.js'),
      require('./vtt-parser.js'),
      require('./ass-parser.js'),
      require('../alignment/offset-model.js')
    );
  } else {
    root.SmartSubtitle.subtitles.SubtitleDocument = factory(
      root.SmartSubtitle.subtitles.SubtitleError,
      root.SmartSubtitle.subtitles.SrtParser,
      root.SmartSubtitle.subtitles.VttParser,
      root.SmartSubtitle.subtitles.AssParser,
      root.SmartSubtitle.alignment.OffsetModel
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (
  ErrorModule,
  SrtParser,
  VttParser,
  AssParser,
  OffsetModel
) {
  'use strict';

  const SubtitleError = ErrorModule.SubtitleError;

  function extensionOf(fileName) {
    const match = /\.([a-z0-9]+)$/i.exec(String(fileName || ''));
    return match ? match[1].toLowerCase() : '';
  }

  function startsWithWebVtt(text) {
    return /^\s*WEBVTT(?:[ \t].*)?(?:\r?\n|$)/.test(
      String(text || '').replace(/^\uFEFF/, '')
    );
  }

  function hasLineSetting(settings) {
    const base = typeof settings === 'string' ? settings.trim() : '';
    return /(?:^|\s)line:\S+/.test(base);
  }

  function withLinePosition(settings, linePercent) {
    const base = typeof settings === 'string' ? settings.trim() : '';
    if (
      !Number.isInteger(linePercent) ||
      linePercent < 0 ||
      linePercent > 100 ||
      hasLineSetting(base)
    ) {
      return base;
    }
    return (base ? base + ' ' : '') + 'line:' + linePercent + '%';
  }

  function detectFormat(fileName, text) {
    const ext = extensionOf(fileName);

    if (ext === 'ass' || ext === 'ssa') return ext;
    if (ext === 'vtt') return 'vtt';
    if (/^\s*\[(?:Script Info|Events|V4\+? Styles)\]/im.test(text)) {
      return /^\s*\[V4 Styles\]/im.test(text) ? 'ssa' : 'ass';
    }
    if (ext === 'srt') return startsWithWebVtt(text) ? 'vtt' : 'srt';
    return startsWithWebVtt(text) ? 'vtt' : 'srt';
  }

  class SubtitleDocument {
    constructor(options) {
      this.fileName = options.fileName || '';
      this.format = options.format;
      this.cues = options.cues;
      this.warnings = options.warnings || [];
      this.styleBlocks = options.styleBlocks || [];
      this.assStyles = options.assStyles || null;
      this.assInfo = options.assInfo || null;
    }

    get cueCount() {
      return this.cues.length;
    }

    get firstStartMs() {
      return this.cues.length ? this.cues[0].startMs : 0;
    }

    get lastEndMs() {
      return this.cues.reduce(function (max, cue) {
        return Math.max(max, cue.endMs);
      }, 0);
    }

    get approximateDurationMs() {
      return this.lastEndMs;
    }

    /**
     * Generate a WebVTT blob payload after applying a global offset.
     * The original document is not modified.
     *
     * options.linePercent adds a vertical cue line to cues that do not already
     * define their own line setting.
     */
    toVtt(offsetMs, options) {
      if (this.format === 'ass' || this.format === 'ssa') {
        throw new SubtitleError(
          'ASS_REQUIRES_OVERLAY',
          'ASS/SSA 使用专用覆盖层渲染，不能转换为 WebVTT。'
        );
      }
      const offset =
        offsetMs === undefined || offsetMs === null ? 0 : offsetMs;
      const linePercent = options && options.linePercent;
      const shift = OffsetModel.shiftCues(this.cues, offset);
      if (shift.cues.length === 0) {
        throw new SubtitleError(
          'OFFSET_DROPS_ALL',
          '该偏移会把所有字幕移出视频时间轴，请减小偏移量。'
        );
      }
      const lineManaged = [];
      const cues = shift.cues.map(function (cue) {
        const managed = !hasLineSetting(cue.settings);
        lineManaged.push(managed);
        return Object.assign({}, cue, {
          settings: withLinePosition(cue.settings, linePercent)
        });
      });
      return {
        vtt: VttParser.serialize(cues, {
          styleBlocks: this.styleBlocks
        }),
        shift,
        lineManaged
      };
    }
  }

  /**
   * @param {string} fileName
   * @param {string} text already decoded Unicode text
   * @returns {SubtitleDocument}
   */
  function parseSubtitleFile(fileName, text) {
    const format = detectFormat(fileName, text);
    if (format === 'ass' || format === 'ssa') {
      const parsed = AssParser.parse(text);
      return new SubtitleDocument({
        fileName,
        format,
        cues: parsed.cues,
        warnings: parsed.warnings,
        assStyles: parsed.styles,
        assInfo: parsed.info
      });
    }
    const parsed = format === 'vtt' ? VttParser.parse(text) : SrtParser.parse(text);

    return new SubtitleDocument({
      fileName,
      format,
      cues: parsed.cues,
      warnings: parsed.warnings,
      styleBlocks: parsed.styleBlocks
    });
  }

  return {
    SubtitleDocument,
    parseSubtitleFile,
    detectFormat
  };
});
