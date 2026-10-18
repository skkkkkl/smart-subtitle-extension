'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeText,
  searchCues,
  offsetForAnchor
} = require('../alignment/anchor-sync.js');

const cues = [
  { startMs: 1000, endMs: 3000, text: '你好，世界。' },
  { startMs: 4000, endMs: 6000, text: 'Hello, world!' },
  { startMs: 7000, endMs: 9000, text: '你好，再见。' }
];

test('normalizes punctuation, case, whitespace and tags', () => {
  assert.equal(normalizeText('  Hello, <i>World</i>!  '), 'helloworld');
  assert.equal(normalizeText('你好，世界。'), '你好世界');
});

test('finds exact and partial subtitle lines', () => {
  const exact = searchCues(cues, '你好');
  assert.equal(exact.length, 2);
  assert.equal(exact[0].startMs, 1000);
  const english = searchCues(cues, 'hello world');
  assert.equal(english.length, 1);
  assert.equal(english[0].startMs, 4000);
  assert.deepEqual(searchCues(cues, '你'), []);
});

test('computes positive and negative target offsets from an anchor', () => {
  const positive = offsetForAnchor(10000, { startMs: 8000 });
  assert.equal(positive.ok, true);
  assert.equal(positive.offsetMs, 2000);
  const negative = offsetForAnchor(6000, { startMs: 8000 });
  assert.equal(negative.ok, true);
  assert.equal(negative.offsetMs, -2000);
});

test('rejects invalid anchors', () => {
  assert.equal(offsetForAnchor(NaN, { startMs: 8000 }).ok, false);
  assert.equal(offsetForAnchor(1000, null).ok, false);
});
