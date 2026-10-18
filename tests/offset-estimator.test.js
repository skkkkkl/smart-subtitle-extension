'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateOffset } = require('../alignment/offset-estimator.js');

function cues(items) {
  return items.map((item, index) => ({
    startMs: item[0],
    endMs: item[1],
    text: 'cue-' + index
  }));
}

test('tail anchor estimates a small positive offset with medium confidence', () => {
  const result = estimateOffset(
    120000,
    cues([
      [1000, 3000],
      [60000, 62000],
      [116000, 118000]
    ])
  );
  assert.equal(result.ok, true);
  assert.equal(result.offsetMs, 2000);
  assert.equal(result.confidence, 'medium');
  assert.equal(result.tailGapMs, 2000);
});

test('a 20 second tail gap is rejected as likely credits', () => {
  const result = estimateOffset(
    120000,
    cues([
      [1000, 3000],
      [60000, 62000],
      [98000, 100000]
    ])
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TAIL_TOO_FAR');
});

test('a real-like 29 second tail gap is rejected, not suggested', () => {
  const result = estimateOffset(5322000, [
    { startMs: 1000, endMs: 3000 },
    { startMs: 5000000, endMs: 5293250 }
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TAIL_TOO_FAR');
  assert.match(result.message, /手动校准/);
});

test('conflicting first and tail anchors are rejected', () => {
  const result = estimateOffset(120000, [
    { startMs: 30000, endMs: 32000 },
    { startMs: 110000, endMs: 112000 }
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ANCHOR_CONFLICT');
});

test('a candidate that would push the first cue below zero is clamped', () => {
  const result = estimateOffset(
    120000,
    cues([
      [1000, 3000],
      [123000, 125000]
    ])
  );
  assert.equal(result.ok, true);
  assert.equal(result.offsetMs, -1000);
  assert.equal(result.confidence, 'low');
  assert.ok(result.warnings.some((warning) => warning.includes('首条')));
});

test('a seven-minute tail gap is rejected instead of auto-applied', () => {
  const result = estimateOffset(
    5322000,
    cues([
      [1000, 3000],
      [60000, 62000],
      [4880000, 4883000]
    ])
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TAIL_TOO_FAR');
  assert.match(result.message, /手动校准/);
});

test('missing duration or empty cues is explicit', () => {
  assert.equal(estimateOffset(NaN, cues([[0, 1000]])).code, 'NO_DURATION');
  assert.equal(estimateOffset(100000, []).code, 'NO_SUBTITLE');
});

test('a large tail difference is rejected before range clamping', () => {
  const result = estimateOffset(100000, cues([[1000, 2000]]));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TAIL_TOO_FAR');
});
