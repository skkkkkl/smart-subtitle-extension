'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, parseAssColor } = require('../subtitles/ass-text.js');

test('ASS colors convert BGR and alpha to CSS rgba', () => {
  assert.equal(parseAssColor('&H000000FF&'), 'rgba(255, 0, 0, 1.000)');
  assert.equal(parseAssColor('&H00FFFFFF&'), 'rgba(255, 255, 255, 1.000)');
  assert.equal(parseAssColor('&H80000000&'), 'rgba(0, 0, 0, 0.498)');
  assert.equal(parseAssColor('not-a-color'), null);
});

test('ASS inline tags produce styled segments and alignment', () => {
  const result = parse(
    '{\\an8\\b1}Hello\\N{\\i1\\c&H0000FF&}Red',
    {
      fontSize: 24,
      primaryColor: '#ffffff',
      outlineColor: '#000000',
      outline: 2,
      shadow: 1,
      alignment: 2
    },
    {}
  );
  assert.equal(result.alignment, 8);
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].bold, true);
  assert.equal(result.segments[0].text, 'Hello\n');
  assert.equal(result.segments[1].italic, true);
  assert.equal(result.segments[1].color, 'rgba(255, 0, 0, 1.000)');
});

test('ASS position and reset tags are parsed', () => {
  const style = {
    fontSize: 20,
    bold: true,
    primaryColor: '#ffffff',
    outlineColor: '#000000',
    outline: 1,
    shadow: 0,
    alignment: 2
  };
  const result = parse('{\\pos(100,50)\\b0\\fs30}Text', style, {});
  assert.deepEqual(result.position, { x: 100, y: 50 });
  assert.equal(result.fontSize, 30);
  assert.equal(result.segments[0].bold, false);
  assert.equal(result.segments[0].text, 'Text');
});
