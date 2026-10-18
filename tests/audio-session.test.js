'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeAudioSession, candidateConsensus, median, weightedMedian } = require('../alignment/audio-session.js');

function cues() {
  const starts = [500, 8700, 16100, 24400, 32800];
  return starts.map(function (start) {
    return { startMs: start, endMs: start + 1000 };
  });
}

function samples(offsetMs) {
  const result = [];
  for (let time = 0; time <= 42000; time += 100) {
    const subtitleTime = time - offsetMs;
    const high = cues().some(function (cue) {
      return subtitleTime >= cue.startMs && subtitleTime <= cue.endMs;
    });
    result.push({ mediaMs: time, rms: high ? 1 : 0.02 });
  }
  return result;
}

test('cross-window candidate consensus counts unique window support', () => {
  const consensus = candidateConsensus([
    {
      index: 0,
      candidates: [
        { offsetMs: -250, score: 0.3 },
        { offsetMs: 5000, score: 0.25 }
      ]
    },
    {
      index: 1,
      candidates: [
        { offsetMs: -250, score: 0.35 },
        { offsetMs: 5000, score: 0.2 }
      ]
    },
    {
      index: 2,
      candidates: [{ offsetMs: 8000, score: 0.4 }]
    }
  ]);
  assert.equal(consensus.offsetMs, -250);
  assert.equal(consensus.support, 2);
  assert.equal(consensus.secondOffsetMs, 5000);
});

test('MAD is reported around the unweighted median', () => {
  const values = [-13750, -11250, -6000, 1500];
  assert.equal(median(values), -8625);
  const residuals = values.map((value) => Math.abs(value - median(values)));
  assert.equal(median(residuals), 3875);
  assert.equal(weightedMedian([
    { value: -13750, weight: 0.37 },
    { value: -11250, weight: 0.351 },
    { value: -6000, weight: 0.459 },
    { value: 1500, weight: 0.273 }
  ]), -6000);
});

test('multi-window session recovers a positive target offset', () => {
  const result = analyzeAudioSession(samples(1000), cues(), {
    windowMs: 8000,
    count: 5
  });
  assert.equal(result.ok, true);
  assert.equal(result.offsetMs, 1000);
  assert.ok(result.validWindows >= 3);
  assert.ok(Array.isArray(result.diagnostics.windows));
  assert.ok(result.diagnostics.global != null);
  assert.ok(result.diagnostics.windows[0].margin != null);
  assert.ok(result.diagnostics.windows[0].secondDistinctPeakOffsetMs != null);
  assert.ok(result.diagnostics.windows[0].activeRatio != null);
});

test('multi-window session rejects insufficient/weak evidence', () => {
  const few = analyzeAudioSession(samples(0).slice(0, 100), cues(), {
    windowMs: 8000,
    count: 5
  });
  assert.equal(few.ok, false);
  assert.equal(few.code, 'NOT_ENOUGH_WINDOWS');

  const flat = Array.from({ length: 300 }, (_, index) => ({
    mediaMs: index * 100,
    rms: 0.1
  }));
  const noEvidence = analyzeAudioSession(flat, cues(), {
    windowMs: 8000,
    count: 5
  });
  assert.equal(noEvidence.ok, false);
  assert.equal(noEvidence.code, 'FLAT_AUDIO');
});
