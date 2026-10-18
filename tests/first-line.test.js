'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectFirstOnset,
  offsetFromFirstLine
} = require('../alignment/first-line.js');

function samples(onsetMs) {
  const result = [];
  for (let time = 0; time <= 15000; time += 100) {
    const high = time >= onsetMs && time < onsetMs + 2000;
    result.push({ mediaMs: time, rms: high ? 1 : 0.02 });
  }
  return result;
}

test('detects the first sustained audio onset', () => {
  const result = detectFirstOnset(samples(5000));
  assert.equal(result.ok, true);
  assert.equal(result.onsetMs, 5000);
});

test('rejects a capture with no onset', () => {
  const flat = Array.from({ length: 100 }, (_, index) => ({
    mediaMs: index * 100,
    rms: 0.1
  }));
  const result = detectFirstOnset(flat);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'FLAT_AUDIO');
});

test('converts first-line onset to a target offset', () => {
  const zero = offsetFromFirstLine(5000, 5000);
  assert.equal(zero.ok, true);
  assert.equal(zero.offsetMs, 0);
  const late = offsetFromFirstLine(7000, 5000);
  assert.equal(late.offsetMs, 2000);
  const early = offsetFromFirstLine(3000, 5000);
  assert.equal(early.offsetMs, -2000);
});
