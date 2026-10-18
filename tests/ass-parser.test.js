'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, parseTime } = require('../subtitles/ass-parser.js');

const SAMPLE = [
  '[Script Info]',
  'ScriptType: v4.00+',
  'PlayResX: 384',
  'PlayResY: 288',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Default,Arial,24,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,20,1',
  'Style: Top,Arial,28,&H0000FFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,2,8,10,10,10,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  'Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\\an8}Hello\\NWorld',
  'Dialogue: 1,0:00:04.00,0:00:05.25,Top,,0,0,0,,{\\pos(100,50)}Top line, with comma'
].join('\n');

test('parses ASS styles, scripts and dialogue text with commas', () => {
  const result = parse(SAMPLE);
  assert.equal(result.info.playResX, 384);
  assert.equal(result.info.playResY, 288);
  assert.equal(result.styles.Default.fontSize, 24);
  assert.equal(result.styles.Top.alignment, 8);
  assert.equal(result.styles.Top.bold, true);
  assert.equal(result.cues.length, 2);
  assert.equal(result.cues[0].startMs, 1000);
  assert.equal(result.cues[0].endMs, 3500);
  assert.equal(result.cues[0].style, 'Default');
  assert.equal(result.cues[1].text, '{\\pos(100,50)}Top line, with comma');
  assert.equal(result.cues[1].layer, 1);
});

test('parses ASS timestamps and rejects empty events', () => {
  assert.equal(parseTime('0:00:01.25'), 1250);
  assert.equal(parseTime('1:02:03.45'), 3723450);
  assert.equal(parseTime('bad'), null);
  assert.throws(
    () => parse('[Script Info]\nTitle: empty\n[Events]\n'),
    (error) => error.code === 'EMPTY_SUBTITLE'
  );
});

test('parses SSA V4 styles and Marked dialogue', () => {
  const ssa = [
    '[Script Info]',
    'PlayResX: 384',
    'PlayResY: 288',
    '[V4 Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding',
    'Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,1,2,1,2,20,20,20,0,1',
    '[Events]',
    'Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: Marked=0,0:00:01.00,0:00:02.00,Default,,0,0,0,,SSA line'
  ].join('\n');
  const result = parse(ssa);
  assert.equal(result.cues.length, 1);
  assert.equal(result.cues[0].text, 'SSA line');
  assert.equal(result.cues[0].startMs, 1000);
});
