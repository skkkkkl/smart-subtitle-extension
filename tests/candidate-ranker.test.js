'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Ranker = require('../matching/candidate-ranker.js');

test('title similarity handles CJK and punctuation differences', () => {
  assert.equal(Ranker.titleSimilarity('Spider-Man', 'Spider Man'), 1);
  assert.ok(
    Ranker.titleSimilarity('流浪地球2', '流浪地球 2') > 0.85,
    'CJK punctuation differences should still match'
  );
  assert.ok(Ranker.titleSimilarity('流浪地球', '流浪地球2') > 0.7);
  assert.ok(Ranker.titleSimilarity('Dune', 'Alien') < 0.2);
});

test('exact metadata yields a high-confidence candidate', () => {
  const result = Ranker.scoreCandidate(
    {
      title: '流浪地球2',
      year: 2023,
      durationMs: 10380000,
      language: 'zh'
    },
    {
      title: '流浪地球2',
      year: 2023,
      durationMs: 10380000,
      language: 'zh'
    }
  );
  assert.equal(result.score, 100);
  assert.equal(result.confidence, 'high');
  assert.equal(result.coverage, 0.95);
  assert.ok(result.reasons.some((reason) => reason.includes('片名')));
  assert.ok(result.reasons.some((reason) => reason.includes('时长一致')));
});

test('year and duration mismatches reduce the score', () => {
  const baseQuery = {
    title: 'Dune: Part Two',
    year: 2024,
    durationMs: 9960000,
    language: 'en'
  };
  const good = Ranker.scoreCandidate(baseQuery, {
    title: 'Dune Part Two',
    year: 2024,
    durationMs: 9962000,
    language: 'en'
  });
  const wrongYear = Ranker.scoreCandidate(baseQuery, {
    title: 'Dune Part Two',
    year: 2021,
    durationMs: 9962000,
    language: 'en'
  });
  const wrongDuration = Ranker.scoreCandidate(baseQuery, {
    title: 'Dune Part Two',
    year: 2024,
    durationMs: 6000000,
    language: 'en'
  });
  assert.ok(good.score > wrongYear.score);
  assert.ok(good.score > wrongDuration.score);
  assert.ok(wrongYear.mismatches.some((item) => item.includes('年份')));
  assert.ok(wrongDuration.mismatches.some((item) => item.includes('时长')));
});

test('missing metadata lowers confidence instead of claiming a perfect match', () => {
  const result = Ranker.scoreCandidate(
    { title: 'Dune' },
    { title: 'Dune' }
  );
  assert.equal(result.score, 100);
  assert.equal(result.confidence, 'low');
  assert.ok(result.coverage < 0.6);
  assert.ok(result.mismatches.some((item) => item.includes('年份')));
  assert.ok(result.mismatches.some((item) => item.includes('时长')));
});

test('filename fallback extracts title/year and ignores release tags', () => {
  const result = Ranker.scoreCandidate(
    {
      title: 'The Matrix',
      year: 1999,
      durationMs: 8160000,
      language: 'en'
    },
    {
      fileName: 'The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv',
      durationMs: 8160000,
      language: 'en'
    }
  );
  assert.equal(result.title, 'The Matrix');
  assert.ok(result.score >= 90);
  assert.equal(result.confidence, 'high');
});

test('episode mismatch is reported separately', () => {
  const query = {
    title: 'Severance',
    year: 2022,
    durationMs: 3000000,
    season: 2,
    episode: 5,
    language: 'en'
  };
  const same = Ranker.scoreCandidate(query, {
    title: 'Severance',
    year: 2022,
    durationMs: 3000000,
    season: 2,
    episode: 5,
    language: 'en'
  });
  const other = Ranker.scoreCandidate(query, {
    title: 'Severance',
    year: 2022,
    durationMs: 3000000,
    season: 2,
    episode: 6,
    language: 'en'
  });
  assert.ok(same.score > other.score);
  assert.ok(other.mismatches.includes('集数不一致'));
});

test('rankCandidates sorts by score and ignores invalid input', () => {
  const results = Ranker.rankCandidates(
    { title: 'Dune', year: 2024, durationMs: 9960000 },
    [
      { title: 'Alien', year: 1979, durationMs: 7000000 },
      { title: 'Dune Part Two', year: 2024, durationMs: 9960000 },
      null,
      { title: 'Dune', year: 2021, durationMs: 9960000 }
    ]
  );
  assert.equal(results.length, 3);
  assert.equal(results[0].candidate.title, 'Dune Part Two');
  assert.equal(Ranker.rankCandidates(null, []).length, 0);
});
