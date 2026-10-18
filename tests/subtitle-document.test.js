'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseSubtitleFile,
  detectFormat
} = require('../subtitles/subtitle-document.js');
const { SubtitleError } = require('../subtitles/subtitle-error.js');

test('routes SRT and converts it to WebVTT with dot timestamps', () => {
  const doc = parseSubtitleFile(
    'movie.srt',
    '1\n00:00:01,250 --> 00:00:03,500\n你好\n世界\n'
  );
  assert.equal(doc.format, 'srt');
  assert.equal(doc.cueCount, 1);

  const output = doc.toVtt(0).vtt;
  assert.ok(output.startsWith('WEBVTT\n'));
  assert.match(output, /00:00:01\.250 --> 00:00:03\.500/);
  assert.match(output, /你好\n世界/);
});

test('routes VTT by extension and by content sniffing', () => {
  const vtt = 'WEBVTT\n\n00:01.000 --> 00:02.000\nHello\n';
  assert.equal(detectFormat('captions.vtt', vtt), 'vtt');
  assert.equal(detectFormat('misnamed.srt', vtt), 'vtt');
  assert.equal(detectFormat('captions.srt', 'plain-ish'), 'srt');
});

test('routes ASS/SSA to the dedicated overlay document', () => {
  const ass = [
    '[Script Info]',
    'PlayResX: 384',
    'PlayResY: 288',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Arial,24,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,1,2,1,2,20,20,20,1',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello'
  ].join('\n');
  const doc = parseSubtitleFile('movie.ass', ass);
  assert.equal(doc.format, 'ass');
  assert.equal(doc.cueCount, 1);
  assert.ok(doc.assStyles.Default);
  assert.throws(
    () => doc.toVtt(0),
    (error) =>
      error instanceof SubtitleError &&
      error.code === 'ASS_REQUIRES_OVERLAY'
  );
  const ssa = parseSubtitleFile(
    'movie.ssa',
    '[Script Info]\n[V4 Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,1,2,1,2,20,20,20,0,1\n[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: Marked=0,0:00:01.00,0:00:02.00,Default,,0,0,0,,SSA'
  );
  assert.equal(ssa.format, 'ssa');
  assert.equal(ssa.cueCount, 1);
});

test('detects ASS by extension and content', () => {
  assert.equal(detectFormat('movie.ass', ''), 'ass');
  assert.equal(detectFormat('movie.ssa', ''), 'ssa');
  assert.equal(
    detectFormat('misnamed.srt', '[Script Info]\n[Events]\n'),
    'ass'
  );
});

test('applies offsets when generating VTT and keeps the original intact', () => {
  const doc = parseSubtitleFile(
    'movie.srt',
    '1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:00:03,000 --> 00:00:04,000\nB\n'
  );
  const result = doc.toVtt(1000);
  assert.equal(result.shift.offsetMs, 1000);
  assert.match(result.vtt, /00:00:02\.000 --> 00:00:03\.000/);
  assert.match(result.vtt, /00:00:04\.000 --> 00:00:05\.000/);
  assert.equal(doc.cues[0].startMs, 1000);
  assert.equal(doc.firstStartMs, 1000);
  assert.equal(doc.approximateDurationMs, 4000);
});

test('adds a vertical line position without overriding authored line settings', () => {
  const srtDoc = parseSubtitleFile(
    'movie.srt',
    '1\n00:00:01,000 --> 00:00:02,000\nA\n'
  );
  const srtResult = srtDoc.toVtt(0, { linePercent: 90 });
  assert.match(
    srtResult.vtt,
    /00:00:01\.000 --> 00:00:02\.000 line:90%/
  );
  assert.deepEqual(srtResult.lineManaged, [true]);

  const vttDoc = parseSubtitleFile(
    'movie.vtt',
    'WEBVTT\n\n00:01.000 --> 00:02.000 line:75% align:start\nA\n'
  );
  const vttResult = vttDoc.toVtt(0, { linePercent: 90 });
  assert.match(
    vttResult.vtt,
    /line:75% align:start/,
    'authored line setting wins'
  );
  assert.deepEqual(vttResult.lineManaged, [false]);
});

const ASS_FALLBACK_FIXTURE = [
  '[Script Info]',
  'ScriptType: v4.00+',
  'PlayResX: 384',
  'PlayResY: 288',
  '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  'Style: Default,Arial,24,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,2,10,10,10,1',
  'Style: Top,Arial,24,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,1,8,10,10,10,1',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\i1}你好{\\i0} 世界\\N第二行',
  'Dialogue: 0,0:00:03.00,0:00:04.00,Top,,0,0,0,,{\\an8}顶部字幕',
  'Dialogue: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100 0 100'
].join('\n');

test('ASS fallback VTT keeps dialogue text for fullscreen native cues', () => {
  const doc = parseSubtitleFile('movie.ass', ASS_FALLBACK_FIXTURE);
  const result = doc.toFallbackVtt(500, { linePercent: 90 });

  assert.match(result.vtt, /^WEBVTT/);
  assert.match(result.vtt, /00:00:01\.500 --> 00:00:02\.500 align:center line:90%/);
  assert.match(result.vtt, /你好 世界\n第二行/, 'inline tags stripped');
  assert.match(result.vtt, /00:00:03\.500 --> 00:00:04\.500 align:center line:90%/);
  assert.match(result.vtt, /顶部字幕/);
  assert.doesNotMatch(result.vtt, /\\i1|\\an8|\{\\p1\}/);
  assert.doesNotMatch(result.vtt, /m 0 0 l/, 'vector drawings are dropped');
  assert.deepEqual(result.lineManaged, [true, true]);
  assert.equal(doc.cues[0].startMs, 1000, 'source document untouched');
});

test('ASS fallback maps alignment onto VTT align', () => {
  const doc = parseSubtitleFile(
    'movie.ass',
    ASS_FALLBACK_FIXTURE.replace('{\\an8}顶部字幕', '{\\an6}右上字幕')
  );
  const result = doc.toFallbackVtt(0, {});
  assert.match(result.vtt, /00:00:03\.000 --> 00:00:04\.000 align:right/);
});

test('ASS fallback survives a document without any dialogue text', () => {
  const doc = parseSubtitleFile(
    'movie.ass',
    '[Script Info]\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\p1}m 0 0 l 1 1\n'
  );
  assert.throws(
    () => doc.toFallbackVtt(0),
    (error) =>
      error instanceof SubtitleError && error.code === 'ASS_NO_PLAIN_TEXT'
  );
});

test('non-ASS documents fall back to the normal VTT path', () => {
  const doc = parseSubtitleFile(
    'movie.srt',
    '1\n00:00:01,000 --> 00:00:02,000\nA\n'
  );
  const result = doc.toFallbackVtt(0, { linePercent: 80 });
  assert.equal(result.vtt, doc.toVtt(0, { linePercent: 80 }).vtt);
});

test('all cues dropped by an offset is an explicit error', () => {  const doc = parseSubtitleFile(
    'movie.srt',
    '1\n00:00:01,000 --> 00:00:02,000\nA\n'
  );
  assert.throws(
    () => doc.toVtt(-3600000),
    (error) =>
      error instanceof SubtitleError && error.code === 'OFFSET_DROPS_ALL'
  );
  assert.throws(
    () => doc.toVtt(NaN),
    (error) =>
      error instanceof SubtitleError && error.code === 'INVALID_OFFSET'
  );
});
