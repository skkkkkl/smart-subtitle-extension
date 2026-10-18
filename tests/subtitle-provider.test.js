'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ProviderRegistry,
  ProviderError,
  validateProvider
} = require('../matching/subtitle-provider.js');

function provider(overrides) {
  return Object.assign(
    {
      id: 'demo-provider',
      name: 'Demo',
      enabled: true,
      async search() {
        return [];
      },
      async download() {
        return 'subtitle';
      }
    },
    overrides || {}
  );
}

test('validates provider contract and rejects duplicates', () => {
  const registry = new ProviderRegistry();
  const item = provider();
  assert.equal(validateProvider(item), true);
  registry.register(item);
  assert.equal(registry.list().length, 1);
  assert.throws(
    () => registry.register(provider()),
    (error) => error instanceof ProviderError && error.code === 'DUPLICATE_PROVIDER'
  );
  assert.equal(registry.unregister('demo-provider'), true);
  assert.equal(registry.list().length, 0);
});

test('rejects malformed provider objects', () => {
  assert.throws(
    () => new ProviderRegistry().register(provider({ id: 'INVALID ID' })),
    (error) => error.code === 'INVALID_PROVIDER_ID'
  );
  assert.throws(
    () => new ProviderRegistry().register(provider({ name: '' })),
    (error) => error.code === 'INVALID_PROVIDER_NAME'
  );
  assert.throws(
    () => new ProviderRegistry().register(provider({ search: null })),
    (error) => error.code === 'INVALID_PROVIDER_SEARCH'
  );
  assert.throws(
    () => new ProviderRegistry().register(provider({ download: null })),
    (error) => error.code === 'INVALID_PROVIDER_DOWNLOAD'
  );
  assert.throws(
    () => new ProviderRegistry().register(provider({ enabled: 'yes' })),
    (error) => error.code === 'INVALID_PROVIDER_ENABLED'
  );
});

test('search aggregates candidates and provider failures', async () => {
  const registry = new ProviderRegistry();
  registry.register(
    provider({
      id: 'provider-a',
      name: 'A',
      async search() {
        return [{ title: 'A1', year: 2024 }, { title: 'A2' }];
      }
    })
  );
  registry.register(
    provider({
      id: 'provider-b',
      name: 'B',
      async search() {
        throw new ProviderError('RATE_LIMITED', 'Too many requests');
      }
    })
  );
  const result = await registry.search({ title: 'A' });
  assert.equal(result.providerCount, 2);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].providerId, 'provider-a');
  assert.equal(result.candidates[0].providerName, 'A');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].providerId, 'provider-b');
  assert.equal(result.errors[0].code, 'RATE_LIMITED');
});

test('disabled providers are not queried', async () => {
  const registry = new ProviderRegistry();
  let called = false;
  registry.register(
    provider({
      id: 'disabled',
      enabled: false,
      async search() {
        called = true;
        return [{ title: 'hidden' }];
      }
    })
  );
  const result = await registry.search({ title: 'A' });
  assert.equal(result.providerCount, 0);
  assert.equal(result.candidates.length, 0);
  assert.equal(called, false);
});

test('download routes to the requested provider only', async () => {
  const registry = new ProviderRegistry();
  registry.register(
    provider({
      id: 'provider-a',
      async download(candidate) {
        return 'A:' + candidate.title;
      }
    })
  );
  registry.register(
    provider({
      id: 'provider-b',
      async download() {
        return 'B';
      }
    })
  );
  assert.equal(
    await registry.download('provider-a', { title: 'Movie' }),
    'A:Movie'
  );
  await assert.rejects(
    () => registry.download('missing', {}),
    (error) => error.code === 'PROVIDER_NOT_FOUND'
  );
});

test('an empty registry returns an empty result without network access', async () => {
  const registry = new ProviderRegistry();
  const result = await registry.search({ title: 'Movie' });
  assert.deepEqual(result, {
    candidates: [],
    errors: [],
    providerCount: 0
  });
});
