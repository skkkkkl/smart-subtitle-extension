'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Metadata = require('../matching/metadata-extractor.js');

test('cleanTitle removes common site suffixes but preserves title hyphens', () => {
  assert.equal(
    Metadata.cleanTitle('The Matrix | Netflix'),
    'The Matrix'
  );
  assert.equal(
    Metadata.cleanTitle('Spider-Man: No Way Home - YouTube'),
    'Spider-Man: No Way Home'
  );
  assert.equal(
    Metadata.cleanTitle('流浪地球2 - 在线观看 - 高清'),
    '流浪地球2'
  );
});

test('extractYear handles titles and ignores resolutions', () => {
  assert.equal(Metadata.extractYear('Dune Part Two 2024 2160p'), 2024);
  assert.equal(Metadata.extractYear('1920x1080 trailer'), null);
  assert.equal(Metadata.extractYear('The 1999 movie'), 1999);
  assert.equal(Metadata.extractYear('no year here'), null);
});

test('parseDuration supports ISO, clock, units and seconds', () => {
  assert.equal(Metadata.parseDuration('PT1H2M3S'), 3723000);
  assert.equal(Metadata.parseDuration('01:02:03'), 3723000);
  assert.equal(Metadata.parseDuration('2:03'), 123000);
  assert.equal(Metadata.parseDuration('1h 2m 3s'), 3723000);
  assert.equal(Metadata.parseDuration('92 min'), 5520000);
  assert.equal(Metadata.parseDuration(90), 90000);
  assert.equal(Metadata.parseDuration('bad'), null);
});

test('normalizeLanguage maps common subtitle tags', () => {
  assert.equal(Metadata.normalizeLanguage('zh-CN'), 'zh');
  assert.equal(Metadata.normalizeLanguage('chs'), 'zh');
  assert.equal(Metadata.normalizeLanguage('繁體中文'), 'zh');
  assert.equal(Metadata.normalizeLanguage('eng'), 'en');
  assert.equal(Metadata.normalizeLanguage('Japanese'), 'ja');
  assert.equal(Metadata.normalizeLanguage('unknown'), null);
});

test('episode parsing supports SxxExx and Chinese season/episode', () => {
  assert.deepEqual(Metadata.extractEpisodeInfo('Show.S02E05.1080p'), {
    season: 2,
    episode: 5
  });
  assert.deepEqual(Metadata.extractEpisodeInfo('第 3 季 第 12 集'), {
    season: 3,
    episode: 12
  });
  assert.deepEqual(Metadata.extractEpisodeInfo('1x08'), {
    season: 1,
    episode: 8
  });
});

test('release-name parsing removes quality tags and release groups', () => {
  assert.deepEqual(
    Metadata.parseReleaseName(
      'The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv'
    ),
    {
      title: 'The Matrix',
      year: 1999,
      season: null,
      episode: null,
      language: null
    }
  );
  const chineseRelease = Metadata.parseReleaseName(
    '流浪地球2.2023.1080p.WEB-DL.中字.mp4'
  );
  assert.equal(chineseRelease.title, '流浪地球2');
  assert.equal(chineseRelease.language, 'zh');
});

function fakeDocument(options) {
  const opts = options || {};
  const scripts = opts.jsonLd
    ? [
        {
          textContent: JSON.stringify(opts.jsonLd)
        }
      ]
    : [];
  const metas = opts.metas || {};
  return {
    title: opts.title || '',
    documentElement: {
      getAttribute(name) {
        return name === 'lang' ? opts.htmlLang || '' : null;
      }
    },
    querySelectorAll(selector) {
      if (selector === 'script[type="application/ld+json"]') return scripts;
      return [];
    },
    querySelector(selector) {
      if (selector === 'h1') {
        return opts.heading ? { textContent: opts.heading } : null;
      }
      const match = /meta\[[^\]]+="([^"]+)"\]/.exec(selector);
      if (match && metas[match[1]]) {
        return {
          getAttribute(name) {
            return name === 'content' ? metas[match[1]] : null;
          },
          textContent: ''
        };
      }
      return null;
    }
  };
}

test('extractFromDocument prefers JSON-LD movie metadata', () => {
  const doc = fakeDocument({
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Movie',
      name: '流浪地球2',
      datePublished: '2023-01-22',
      duration: 'PT2H53M',
      inLanguage: { name: '中文' }
    },
    title: '流浪地球2 - 在线观看',
    htmlLang: 'zh-CN'
  });
  const metadata = Metadata.extractFromDocument(doc, {
    duration: 10380,
    getAttribute() {
      return '';
    }
  });
  assert.equal(metadata.title, '流浪地球2');
  assert.equal(metadata.year, 2023);
  assert.equal(metadata.durationMs, 10380000);
  assert.equal(metadata.language, 'zh');
  assert.equal(metadata.source, 'jsonld');
  assert.ok(metadata.confidence >= 0.8);
});

test('extractFromDocument falls back to page metadata and video duration', () => {
  const doc = fakeDocument({
    title: '示例电影 (2022) | 某视频站',
    heading: '示例电影',
    metas: {
      'og:title': '示例电影 2022',
      'video:release_date': '2022-06-01',
      'og:locale': 'zh_CN'
    }
  });
  const metadata = Metadata.extractFromDocument(doc, {
    duration: 5400,
    getAttribute() {
      return '';
    }
  });
  assert.equal(metadata.title, '示例电影 2022');
  assert.equal(metadata.year, 2022);
  assert.equal(metadata.durationMs, 5400000);
  assert.equal(metadata.language, 'zh');
  assert.equal(metadata.source, 'meta');
});
