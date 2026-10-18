'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const OffsetModel = require('../alignment/offset-model.js');
const { SubtitleError } = require('../subtitles/subtitle-error.js');

const CUES = [
  { id: '1', startMs: 1000, endMs: 2000, text: 'A' },
  { id: '2', startMs: 5000, endMs: 7000, text: 'B' }
];

test('positive offsets delay and negative offsets advance without mutation', () => {
  const delayed = OffsetModel.shiftCues(CUES, 500);
  assert.deepEqual(
    delayed.cues.map((cue) => [cue.startMs, cue.endMs]),
    [
      [1500, 2500],
      [5500, 7500]
    ]
  );

  const advanced = OffsetModel.shiftCues(CUES, -500);
  assert.deepEqual(
    advanced.cues.map((cue) => [cue.startMs, cue.endMs]),
    [
      [500, 1500],
      [4500, 6500]
    ]
  );

  assert.deepEqual(CUES, [
    { id: '1', startMs: 1000, endMs: 2000, text: 'A' },
    { id: '2', startMs: 5000, endMs: 7000, text: 'B' }
  ]);
});

test('cues crossing zero are clamped and finished cues are dropped', () => {
  const result = OffsetModel.shiftCues(
    [
      { startMs: 1000, endMs: 2000, text: 'drop' },
      { startMs: 1500, endMs: 4000, text: 'clamp' },
      { startMs: 3000, endMs: 5000, text: 'keep' }
    ],
    -2000
  );
  assert.equal(result.dropped, 1);
  assert.equal(result.clamped, 1);
  assert.deepEqual(
    result.cues.map((cue) => [cue.startMs, cue.endMs, cue.text]),
    [
      [0, 2000, 'clamp'],
      [1000, 3000, 'keep']
    ]
  );
});

test('invalid and out-of-range offsets are rejected', () => {
  assert.throws(
    () => OffsetModel.normalizeOffset(1.5),
    (error) =>
      error instanceof SubtitleError && error.code === 'INVALID_OFFSET'
  );
  assert.throws(
    () => OffsetModel.normalizeOffset(-3600001),
    (error) =>
      error instanceof SubtitleError && error.code === 'OFFSET_OUT_OF_RANGE'
  );
  assert.throws(
    () => OffsetModel.shiftCues([], '10'),
    (error) =>
      error instanceof SubtitleError && error.code === 'INVALID_OFFSET'
  );
});

test('invalid cue data is rejected', () => {
  assert.throws(
    () =>
      OffsetModel.shiftCues(
        [{ startMs: 2000, endMs: 1000, text: 'bad' }],
        0
      ),
    (error) => error instanceof SubtitleError && error.code === 'INVALID_CUES'
  );
});

test('offset display is stable', () => {
  assert.equal(OffsetModel.formatOffset(0), '0 ms');
  assert.equal(OffsetModel.formatOffset(120), '+120 ms');
  assert.equal(OffsetModel.formatOffset(-120), '-120 ms');
});
