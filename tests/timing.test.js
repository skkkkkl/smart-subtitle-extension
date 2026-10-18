'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Timing = require('../subtitles/timing.js');
const { SubtitleError } = require('../subtitles/subtitle-error.js');

test('SRT timestamps parse to integer milliseconds', () => {
  assert.equal(Timing.parseTimestamp('00:00:00,000', { format: 'srt' }), 0);
  assert.equal(Timing.parseTimestamp('00:00:01,001', { format: 'srt' }), 1001);
  assert.equal(Timing.parseTimestamp('01:02:03,004', { format: 'srt' }), 3723004);
  assert.equal(Timing.parseTimestamp('00:00:59,999', { format: 'srt' }), 59999);
});

test('SRT accepts a dot separator but VTT rejects a comma', () => {
  assert.equal(Timing.parseTimestamp('00:00:02.250', { format: 'srt' }), 2250);
  assert.throws(
    () => Timing.parseTimestamp('00:00:02,250', { format: 'vtt' }),
    (error) => error instanceof SubtitleError && error.code === 'INVALID_TIMESTAMP'
  );
});

test('WebVTT supports MM:SS.mmm and HH:MM:SS.mmm', () => {
  assert.equal(Timing.parseTimestamp('02:03.004', { format: 'vtt' }), 123004);
  assert.equal(Timing.parseTimestamp('01:02:03.004', { format: 'vtt' }), 3723004);
});

test('invalid timestamp components are rejected with a line number', () => {
  for (const value of ['00:60:00,000', '00:00:60,000', '00:00:01,00', 'nope']) {
    assert.throws(
      () =>
        Timing.parseTimestamp(value, {
          format: 'srt',
          line: 7
        }),
      (error) =>
        error instanceof SubtitleError &&
        error.code === 'INVALID_TIMESTAMP' &&
        error.line === 7,
      value
    );
  }
});

test('timestamp and clock formatting pad correctly', () => {
  assert.equal(Timing.formatTimestamp(0), '00:00:00.000');
  assert.equal(Timing.formatTimestamp(3723004), '01:02:03.004');
  assert.equal(Timing.formatTimestamp(360000000), '100:00:00.000');
  assert.equal(Timing.formatClock(65000), '01:05');
  assert.equal(Timing.formatClock(3665000), '1:01:05');
});
