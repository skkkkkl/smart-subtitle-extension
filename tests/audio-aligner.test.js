'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateAudioOffset, selectDistinctPeaks } = require('../alignment/audio-aligner.js');

function makeSamples(highRanges) {
  const samples = [];
  for (let time = 0; time <= 10000; time += 200) {
    const high = highRanges.some(function (range) {
      return time >= range[0] && time <= range[1];
    });
    samples.push({ mediaMs: time, rms: high ? 1 : 0.05 });
  }
  return samples;
}

const cues = [
  { startMs: 0, endMs: 2000 },
  { startMs: 4000, endMs: 6000 }
];

test('finds a distinct second peak instead of adjacent search points', () => {
  const candidates = [
    { offsetMs: 1000, score: 0.9 },
    { offsetMs: 1250, score: 0.89 },
    { offsetMs: 2000, score: 0.7 },
    { offsetMs: 3000, score: 0.6 }
  ];
  const peaks = selectDistinctPeaks(candidates, candidates[0], 1000);
  assert.deepEqual(peaks.map((peak) => peak.offsetMs), [1000, 2000]);
});

test('detects zero offset when audio energy follows cue activity', () => {
  const result = estimateAudioOffset(makeSamples([[0, 2000], [4000, 6000]]), cues);
  assert.equal(result.ok, true);
  assert.equal(result.offsetMs, 0);
});

test('detects a one-second delayed audio envelope', () => {
  const result = estimateAudioOffset(
    makeSamples([[1000, 3000], [5000, 7000]]),
    cues
  );
  assert.equal(result.ok, true);
  assert.equal(result.offsetMs, 1000);
});

test('detects a negative/early subtitle offset', () => {
  const samples = [];
  for (let time = 0; time <= 10000; time += 200) {
    const high =
      (time >= 3000 && time <= 3600) || (time >= 7000 && time <= 7600);
    samples.push({ mediaMs: time, rms: high ? 1 : 0.05 });
  }
  const result = estimateAudioOffset(samples, [
    { startMs: 5000, endMs: 5600 },
    { startMs: 9000, endMs: 9600 }
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.offsetMs, -2000);
});

test('flat audio is rejected instead of guessed', () => {
  const flat = Array.from({ length: 40 }, (_, index) => ({
    mediaMs: index * 200,
    rms: 0.1
  }));
  const result = estimateAudioOffset(flat, cues);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'FLAT_AUDIO');
});

test('short or empty samples are rejected', () => {
  const short = estimateAudioOffset(
    [{ mediaMs: 0, rms: 0.1 }, { mediaMs: 1000, rms: 0.2 }],
    cues
  );
  assert.equal(short.ok, false);
  assert.equal(short.code, 'NOT_ENOUGH_DATA');
  const empty = estimateAudioOffset([], cues);
  assert.equal(empty.ok, false);
});
