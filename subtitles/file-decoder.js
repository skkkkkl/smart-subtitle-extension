/*
 * Subtitle byte decoder.
 *
 * Subtitle files in the wild are not always UTF-8. We:
 *   1. honor UTF-8 / UTF-16 BOMs,
 *   2. try strict UTF-8,
 *   3. fall back to GB18030 for common Chinese subtitle files.
 *
 * The fallback is surfaced as a warning in the UI; text is never uploaded.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./subtitle-error.js'));
  } else {
    root.SmartSubtitle.subtitles.FileDecoder = factory(
      root.SmartSubtitle.subtitles.SubtitleError
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ErrorModule) {
  'use strict';

  const SubtitleError = ErrorModule.SubtitleError;

  function decodeUtf16Be(bytes) {
    const swapped = new Uint8Array(bytes.length);
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      swapped[i] = bytes[i + 1];
      swapped[i + 1] = bytes[i];
    }
    if (bytes.length % 2 === 1) {
      swapped[bytes.length - 1] = bytes[bytes.length - 1];
    }
    return new TextDecoder('utf-16le').decode(swapped);
  }

  /**
   * @param {ArrayBuffer|Uint8Array} input
   * @returns {{text:string, encoding:string, warnings:Array<{code:string,message:string}>}}
   */
  function decode(input) {
    let bytes;
    if (input instanceof Uint8Array) {
      bytes = input;
    } else if (input instanceof ArrayBuffer) {
      bytes = new Uint8Array(input);
    } else {
      throw new SubtitleError('INVALID_INPUT', '无法读取字幕文件内容。');
    }

    if (bytes.length === 0) {
      throw new SubtitleError('EMPTY_FILE', '字幕文件为空。');
    }

    let text;
    let encoding;
    const warnings = [];

    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      encoding = 'utf-8';
      text = new TextDecoder('utf-8').decode(bytes.subarray(3));
    } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      encoding = 'utf-16le';
      text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
    } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      encoding = 'utf-16be';
      text = decodeUtf16Be(bytes.subarray(2));
    } else {
      try {
        encoding = 'utf-8';
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (utf8Error) {
        try {
          encoding = 'gb18030';
          text = new TextDecoder('gb18030').decode(bytes);
          warnings.push({
            code: 'ENCODING_FALLBACK',
            message: '文件不是有效的 UTF-8，已按 GB18030 解码。请确认对白没有乱码。'
          });
        } catch (gbError) {
          throw new SubtitleError(
            'DECODE_FAILED',
            '无法识别字幕文件编码。请将文件转换为 UTF-8 后重试。',
            { cause: gbError }
          );
        }
      }
    }

    text = text.replace(/^\uFEFF/, '');
    if (!text.trim()) {
      throw new SubtitleError('EMPTY_FILE', '字幕文件为空。');
    }
    if (text.includes('\u0000')) {
      throw new SubtitleError(
        'DECODE_FAILED',
        '文件包含空字符，可能不是文本字幕或编码不正确。'
      );
    }

    return { text, encoding, warnings };
  }

  return { decode };
});
