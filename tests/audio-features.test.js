'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAudioFrames,
  splitWindows
} = require('../alignment/audio-features.js');

function samples(durationMs, highRanges) {
  const result = [];
  for (let time = 0; time <= durationMs; time += 100) {
    const high = highRanges.some(function (range) {
      return time >= range[0] && time <= range[1];
    });
    result.push({ mediaMs: time, rms: high ? 1 : 0.02 });
  }
  return result;
}

test('computes hysteretic activity frames from an energy envelope', () => {
  const result = buildAudioFrames(samples(10000, [[2000, 5000]]));
  assert.equal(result.ok, true);
  assert.ok(result.activeRatio > 0.2);
  assert.ok(result.frames.some((frame) => frame.active));
  assert.ok(result.frames.some((frame) => !frame.active));
});

test('rejects flat audio and media-time gaps', () => {
  const flat = Array.from({ length: 30 }, (_, index) => ({
    mediaMs: index * 100,
    rms: 0.1
  }));
  assert.equal(buildAudioFrames(flat).code, 'FLAT_AUDIO');
  const gapped = samples(10000, [[2000, 5000]]);
  gapped[10].mediaMs = 500;
  assert.equal(buildAudioFrames(gapped).code, 'INVALID_TIME_ORDER');
});

test('splits valid windows without overlap', () => {
  const result = buildAudioFrames(samples(42000, [[0, 2000], [4000, 6000]]));
  const windows = splitWindows(result.frames, {
    windowMs: 8000,
    count: 5
  });
  assert.equal(windows.length, 5);
  assert.equal(windows[0].startMs, 0);
  assert.equal(windows[1].startMs, 8000);
  assert.ok(windows[0].frames.length >= 30);
});
