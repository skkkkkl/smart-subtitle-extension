'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDefaultProviderConfig,
  sanitizeProviderConfig,
  ProviderStore
} = require('../storage/provider-store.js');

test('provider defaults are disabled and have no key', () => {
  const config = createDefaultProviderConfig();
  assert.equal(config.enabled, false);
  assert.equal(config.apiKey, '');
  assert.equal(config.provider, 'opensubtitles');
  assert.deepEqual(config.languages, ['zh', 'en']);
});

test('provider sanitizer trims key and normalizes languages', () => {
  const config = sanitizeProviderConfig({
    enabled: true,
    apiKey: '  secret-key  ',
    userAgent: '  Custom UA  ',
    languages: ['zh', 'EN', 'bad', 'zh', 'ja']
  });
  assert.equal(config.enabled, true);
  assert.equal(config.apiKey, 'secret-key');
  assert.equal(config.userAgent, 'Custom UA');
  assert.deepEqual(config.languages, ['zh', 'en', 'ja']);
});

test('provider store uses memory fallback and clears', async () => {
  const store = new ProviderStore();
  assert.equal(store.persistent, false);
  assert.equal((await store.load()).enabled, false);
  await store.save({ enabled: true, apiKey: 'abc' });
  assert.equal((await store.load()).apiKey, 'abc');
  await store.clear();
  assert.equal((await store.load()).apiKey, '');
});
