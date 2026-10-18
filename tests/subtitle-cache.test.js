'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SubtitleCache,
  fingerprint
} = require('../storage/subtitle-cache.js');
const { SubtitleCacheClient } = require('../storage/cache-client.js');

test('fingerprints are stable and include the file name', () => {
  const a = fingerprint('WEBVTT\n\n00:00.000 --> 00:01.000\nA\n', 'a.vtt');
  const b = fingerprint('WEBVTT\n\n00:00.000 --> 00:01.000\nA\n', 'a.vtt');
  const c = fingerprint('WEBVTT\n\n00:00.000 --> 00:01.000\nA\n', 'b.vtt');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^sub-[0-9a-f]{8}-/);
});

test('memory cache stores text and lists metadata without text', async () => {
  const cache = new SubtitleCache();
  assert.equal(cache.persistent, false);
  const stored = await cache.put({
    fileName: 'movie.srt',
    text: '1\n00:00:01,000 --> 00:00:02,000\nHello\n',
    format: 'srt',
    cueCount: 1,
    title: 'Movie',
    source: 'local'
  });
  assert.equal(stored.text, undefined);
  assert.equal(stored.title, 'Movie');
  assert.equal(await cache.count(), 1);

  const full = await cache.get(stored.id);
  assert.equal(full.text, '1\n00:00:01,000 --> 00:00:02,000\nHello\n');
  const list = await cache.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].text, undefined);

  assert.equal(await cache.remove(stored.id), true);
  assert.equal(await cache.count(), 0);
});

test('cache enforces its entry limit by newest lastUsedAt', async () => {
  const cache = new SubtitleCache({ maxEntries: 2 });
  const first = await cache.put({
    fileName: 'first.srt',
    text: 'a',
    title: 'First'
  });
  await new Promise((resolve) => setTimeout(resolve, 2));
  const second = await cache.put({
    fileName: 'second.srt',
    text: 'b',
    title: 'Second'
  });
  await new Promise((resolve) => setTimeout(resolve, 2));
  const third = await cache.put({
    fileName: 'third.srt',
    text: 'c',
    title: 'Third'
  });
  assert.equal(await cache.count(), 2);
  assert.equal(await cache.get(first.id), null);
  assert.ok(await cache.get(second.id));
  assert.ok(await cache.get(third.id));
  await cache.clear();
  assert.equal(await cache.count(), 0);
});

test('content cache client has a safe memory fallback', async () => {
  const client = new SubtitleCacheClient({ runtime: null });
  assert.equal(client.persistent, false);
  const stored = await client.put({
    fileName: 'client.vtt',
    text: 'WEBVTT\n\n00:00.000 --> 00:01.000\nA\n',
    format: 'vtt',
    cueCount: 1,
    title: 'Client'
  });
  assert.equal(stored.text, undefined);
  assert.equal(await client.count(), 1);
  assert.equal((await client.list())[0].title, 'Client');
  assert.ok((await client.get(stored.id)).text.includes('WEBVTT'));
  await client.touch(stored.id);
  await client.clear();
  assert.equal(await client.count(), 0);
});
