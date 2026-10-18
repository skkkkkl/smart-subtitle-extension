'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const VttParser = require('../subtitles/vtt-parser.js');
const { SubtitleError } = require('../subtitles/subtitle-error.js');

const SAMPLE = `WEBVTT - 示例

NOTE 这是注释
不会显示

STYLE
::cue { color: yellow; }

cue-1
00:00:01.000 --> 00:00:03.000 align:start position:10%
第一行
第二行

00:04.000 --> 00:06.000
短时间格式
`;

test('parses cue ids, settings, short timestamps, NOTE and STYLE', () => {
  const doc = VttParser.parse(SAMPLE);
  assert.equal(doc.format, 'vtt');
  assert.equal(doc.cues.length, 2);
  assert.equal(doc.cues[0].id, 'cue-1');
  assert.equal(doc.cues[0].settings, 'align:start position:10%');
  assert.equal(doc.cues[0].text, '第一行\n第二行');
  assert.equal(doc.cues[1].startMs, 4000);
  assert.equal(doc.cues[1].endMs, 6000);
  assert.ok(doc.styleBlocks.some((block) => block.startsWith('STYLE')));
});

test('serializes cues with settings and preserved style blocks', () => {
  const doc = VttParser.parse(SAMPLE);
  const output = VttParser.serialize(doc.cues, {
    styleBlocks: doc.styleBlocks
  });
  assert.ok(output.startsWith('WEBVTT\n\nSTYLE\n'));
  assert.match(
    output,
    /cue-1\n00:00:01\.000 --> 00:00:03\.000 align:start position:10%\n第一行\n第二行/
  );
  assert.match(output, /00:00:04\.000 --> 00:00:06\.000\n短时间格式/);
  assert.ok(!output.includes('NOTE'));
});

test('requires the WEBVTT header', () => {
  assert.throws(
    () => VttParser.parse('00:00:01.000 --> 00:00:02.000\nA\n'),
    (error) =>
      error instanceof SubtitleError && error.code === 'VTT_MISSING_HEADER'
  );
});

test('rejects comma timestamps and end-before-start', () => {
  assert.throws(
    () =>
      VttParser.parse(
        'WEBVTT\n\n00:00:01,000 --> 00:00:02.000\nA\n'
      ),
    (error) =>
      error instanceof SubtitleError && error.code === 'INVALID_TIMESTAMP'
  );
  assert.throws(
    () =>
      VttParser.parse(
        'WEBVTT\n\n00:00:03.000 --> 00:00:02.000\nA\n'
      ),
    (error) =>
      error instanceof SubtitleError && error.code === 'VTT_END_BEFORE_START'
  );
});

test('rejects a file with no cues', () => {
  assert.throws(
    () => VttParser.parse('WEBVTT\n\nNOTE only a note\n'),
    (error) =>
      error instanceof SubtitleError && error.code === 'VTT_NO_CUES'
  );
});

test('rejects malformed blocks and tracks the line number', () => {
  assert.throws(
    () => VttParser.parse('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA\n\ngarbage\n'),
    (error) =>
      error instanceof SubtitleError &&
      error.code === 'VTT_EXPECTED_TIMING' &&
      error.line === 6
  );
});
