'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OpenSubtitlesProvider,
  ProviderError
} = require('../matching/opensubtitles-provider.js');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

function configuredProvider(fetchImpl) {
  return new OpenSubtitlesProvider({
    fetchImpl,
    config: {
      enabled: true,
      apiKey: 'test-key',
      languages: ['zh', 'en']
    }
  });
}

test('search builds query and maps OpenSubtitles attributes', async () => {
  let called;
  const provider = configuredProvider(async (url, options) => {
    called = { url, options };
    return jsonResponse({
      data: [
        {
          attributes: {
            subtitle_id: '123',
            language: 'zh-cn',
            download_count: 42,
            hearing_impaired: false,
            release: 'Movie.2024.1080p',
            feature_details: { title: 'Movie', year: 2024 },
            files: [{ file_id: 765, file_name: 'Movie.zh.srt' }]
          }
        }
      ]
    });
  });
  const results = await provider.search({
    title: 'Movie',
    year: 2024,
    language: 'zh'
  });
  assert.equal(called.options.method, 'GET');
  assert.equal(called.options.headers['Api-Key'], 'test-key');
  assert.match(called.url, /query=Movie/);
  assert.match(called.url, /languages=zh/);
  assert.match(called.url, /year=2024/);
  assert.equal(results.length, 1);
  assert.equal(results[0].provider, 'opensubtitles');
  assert.equal(results[0].fileId, 765);
  assert.equal(results[0].title, 'Movie');
  assert.equal(results[0].year, 2024);
  assert.equal(results[0].format, 'srt');
});

test('download posts file_id and returns UTF-8 text', async () => {
  const calls = [];
  const provider = configuredProvider(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/download')) {
      return jsonResponse({ link: 'https://dl.opensubtitles.com/a.srt', file_name: 'a.srt', remaining: 4 });
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\nHi\n').buffer
    };
  });
  const result = await provider.download({ fileId: 10, fileName: 'a.srt' });
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { file_id: 10 });
  assert.equal(result.fileName, 'a.srt');
  assert.match(result.text, /Hi/);
  assert.equal(result.remaining, 4);
});

test('download rejects ZIP payloads clearly', async () => {
  const provider = configuredProvider(async (url) => {
    if (url.endsWith('/download')) {
      return jsonResponse({ link: 'https://dl.opensubtitles.com/a.zip' });
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([0x50, 0x4b, 3, 4]).buffer
    };
  });
  await assert.rejects(
    () => provider.download({ fileId: 10 }),
    (error) =>
      error instanceof ProviderError && error.code === 'ZIP_UNSUPPORTED'
  );
});

test('provider binds the injected fetch so native fetch is not called as a method', async () => {
  let receiver = null;
  const provider = new OpenSubtitlesProvider({
    fetchImpl: function () {
      receiver = this;
      return Promise.resolve(jsonResponse({ data: [] }));
    },
    config: { enabled: true, apiKey: 'key', languages: ['en'] }
  });
  await provider.search({ title: 'Matrix' });
  assert.equal(receiver, globalThis);
});

test('search requires configuration and reports API errors', async () => {
  const disabled = new OpenSubtitlesProvider({
    fetchImpl: async () => jsonResponse({}),
    config: { enabled: false, apiKey: '' }
  });
  await assert.rejects(
    () => disabled.search({ title: 'Movie' }),
    (error) => error.code === 'NOT_CONFIGURED'
  );

  const provider = configuredProvider(async () =>
    jsonResponse({ message: 'bad key' }, 403)
  );
  await assert.rejects(
    () => provider.search({ title: 'Movie' }),
    (error) => error.code === 'AUTH_ERROR' && error.status === 403
  );
});
