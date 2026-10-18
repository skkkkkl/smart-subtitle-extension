'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const FileDecoder = require('../subtitles/file-decoder.js');
const { SubtitleError } = require('../subtitles/subtitle-error.js');

function concatBytes(...parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

test('strips a UTF-8 BOM', () => {
  const bytes = concatBytes(
    new Uint8Array([0xef, 0xbb, 0xbf]),
    new TextEncoder().encode('WEBVTT\n\n00:00.000 --> 00:01.000\nA\n')
  );
  const result = FileDecoder.decode(bytes);
  assert.equal(result.encoding, 'utf-8');
  assert.ok(result.text.startsWith('WEBVTT'));
  assert.equal(result.text.charCodeAt(0), 0x57);
});

test('decodes UTF-16LE and UTF-16BE BOM files', () => {
  const source = 'WEBVTT\n\n00:00.000 --> 00:01.000\n中文\n';
  const utf16le = new Uint8Array(2 + source.length * 2);
  utf16le[0] = 0xff;
  utf16le[1] = 0xfe;
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    utf16le[2 + i * 2] = code & 0xff;
    utf16le[2 + i * 2 + 1] = code >> 8;
  }
  const decodedLe = FileDecoder.decode(utf16le);
  assert.equal(decodedLe.encoding, 'utf-16le');
  assert.ok(decodedLe.text.includes('中文'));

  const utf16be = new Uint8Array(utf16le.length);
  utf16be[0] = 0xfe;
  utf16be[1] = 0xff;
  for (let i = 2; i + 1 < utf16le.length; i += 2) {
    utf16be[i] = utf16le[i + 1];
    utf16be[i + 1] = utf16le[i];
  }
  const decodedBe = FileDecoder.decode(utf16be);
  assert.equal(decodedBe.encoding, 'utf-16be');
  assert.ok(decodedBe.text.includes('中文'));
});

test('falls back to GB18030 for GBK-encoded Chinese text', () => {
  // "你好" in GBK/GB18030.
  const bytes = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]);
  const result = FileDecoder.decode(bytes);
  assert.equal(result.encoding, 'gb18030');
  assert.equal(result.text, '你好');
  assert.ok(
    result.warnings.some((warning) => warning.code === 'ENCODING_FALLBACK')
  );
});

test('rejects empty and NUL-containing input', () => {
  assert.throws(
    () => FileDecoder.decode(new Uint8Array([])),
    (error) => error instanceof SubtitleError && error.code === 'EMPTY_FILE'
  );
  assert.throws(
    () => FileDecoder.decode(new Uint8Array([0x57, 0x00, 0x00])),
    (error) => error instanceof SubtitleError && error.code === 'DECODE_FAILED'
  );
});
