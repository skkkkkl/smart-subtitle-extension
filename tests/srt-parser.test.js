'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const SrtParser = require('../subtitles/srt-parser.js');
const { SubtitleError } = require('../subtitles/subtitle-error.js');

test('parses BOM, CRLF, optional indices and multi-line dialogue', () => {
  const text =
    '\uFEFF1\r\n' +
    '00:00:01,000 --> 00:00:03,500\r\n' +
    '第一行\r\n' +
    '第二行\r\n' +
    '\r\n' +
    '00:00:04,000 --> 00:00:05,000\r\n' +
    '没有序号\r\n';

  const doc = SrtParser.parse(text);
  assert.equal(doc.format, 'srt');
  assert.equal(doc.cues.length, 2);
  assert.deepEqual(
    doc.cues.map((cue) => [cue.startMs, cue.endMs, cue.text]),
    [
      [1000, 3500, '第一行\n第二行'],
      [4000, 5000, '没有序号']
    ]
  );
});

test('accepts dot milliseconds and retains empty cue text as a warning', () => {
  const doc = SrtParser.parse(
    '1\n00:00:01.000 --> 00:00:02.000\n\n2\n00:00:03,000 --> 00:00:04,000\n对白\n'
  );
  assert.equal(doc.cues.length, 2);
  assert.equal(doc.cues[0].text, '');
  assert.ok(doc.warnings.some((warning) => warning.code === 'SRT_EMPTY_TEXT'));
});

test('recovers a missing blank line between numbered cues', () => {
  const doc = SrtParser.parse(
    '1\n00:00:01,000 --> 00:00:02,000\n甲\n' +
      '2\n00:00:03,000 --> 00:00:04,000\n乙\n'
  );
  assert.equal(doc.cues.length, 2);
  assert.equal(doc.cues[1].text, '乙');
  assert.ok(
    doc.warnings.some((warning) => warning.code === 'SRT_MISSING_BLANK_LINE')
  );
});

test('reports invalid timestamps with the source line', () => {
  assert.throws(
    () =>
      SrtParser.parse(
        '1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:61:00,000 --> 00:01:02,000\nB\n'
      ),
    (error) =>
      error instanceof SubtitleError &&
      error.code === 'INVALID_TIMESTAMP' &&
      error.line === 6
  );
});

test('rejects end time before start time', () => {
  assert.throws(
    () => SrtParser.parse('1\n00:00:05,000 --> 00:00:04,000\nA\n'),
    (error) =>
      error instanceof SubtitleError &&
      error.code === 'SRT_END_BEFORE_START' &&
      error.line === 2
  );
});

test('rejects a numeric index without a timing line', () => {
  assert.throws(
    () => SrtParser.parse('1\n这不是时间轴\n'),
    (error) =>
      error instanceof SubtitleError && error.code === 'SRT_EXPECTED_TIMING'
  );
});

test('rejects empty files and files without cues', () => {
  assert.throws(
    () => SrtParser.parse('   \r\n'),
    (error) => error instanceof SubtitleError && error.code === 'EMPTY_FILE'
  );
  assert.throws(
    () => SrtParser.parse('not a subtitle'),
    (error) =>
      error instanceof SubtitleError && error.code === 'SRT_EXPECTED_TIMING'
  );
});

test('warns on unsupported trailing text instead of silently keeping it', () => {
  const doc = SrtParser.parse(
    '1\n00:00:01,000 --> 00:00:02,000 X1:10 X2:20 Y1:30 Y2:40\n对白\n'
  );
  assert.equal(doc.cues[0].text, '对白');
  assert.ok(
    doc.warnings.some((warning) => warning.code === 'SRT_IGNORED_TRAILING_TEXT')
  );
});
