/*
 * Local movie metadata extraction for the future subtitle-search pipeline.
 *
 * Nothing is transmitted. The extractor reads generic page metadata (JSON-LD,
 * Open Graph, title, video duration) and tolerates missing/ambiguous values.
 * Confidence is deliberately conservative: a page title alone is not treated
 * as a verified movie identity.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartSubtitle.matching.MetadataExtractor = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_TITLE = 200;
  const QUALITY_TAG_RE =
    /\b(?:2160p|1440p|1080p|720p|480p|4k|uhd|hdr10\+?|hdr|dolby\.?vision|dv|web-?dl|webrip|web-?rip|bluray|blu-ray|bdrip|brrip|dvdrip|x264|x265|h\.?264|h\.?265|hevc|avc|aac|ac3|eac3|ddp?5\.1|atmos|remux|proper|repack|extended|uncut|multi|dual|subbed|dubbed|chs|cht|eng|jpn|kor|中字|双语|中英|字幕)\b/gi;
  const SITE_SUFFIX_RE =
    /\s*(?:[-|–—]\s*)?(?:youtube|youtu\.be|netflix|bilibili|哔哩哔哩|腾讯视频|爱奇艺|优酷|disney\+|hbo max|prime video|apple tv\+)\s*$/i;

  function normalizeWhitespace(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function cleanTitle(value) {
    let title = normalizeWhitespace(value);
    if (!title) return '';
    title = title.replace(/\s*[|｜]\s*[^|｜]{1,40}$/u, '');
    title = title.replace(SITE_SUFFIX_RE, '');
    title = title.replace(/^【[^】]{1,40}】\s*/u, '');
    title = title.replace(/\s*[-–—]\s*在线观看.*$/u, '');
    title = title.replace(/\s*[-–—]\s*高清.*$/u, '');
    title = title.replace(/\s+[-–—]\s+/u, ' ').trim();
    return title.slice(0, MAX_TITLE);
  }

  function extractYear(value) {
    const text = String(value == null ? '' : value);
    const regex = /(?:^|[^\d])((?:19|20)\d{2})(?!\d)/g;
    let match;
    while ((match = regex.exec(text))) {
      const year = Number(match[1]);
      const start = match.index + match[0].indexOf(match[1]);
      const end = start + 4;
      const before = text.charAt(start - 1);
      const after = text.charAt(end);
      if (/[x×]/i.test(before) || /[x×]/i.test(after)) continue;
      if (year >= 1900 && year <= 2099) return year;
    }
    return null;
  }

  function parseDuration(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.round(value * 1000);
    }
    if (typeof value !== 'string') return null;
    const text = normalizeWhitespace(value);
    if (!text) return null;

    const iso = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(text);
    if (iso) {
      const days = Number(iso[1] || 0);
      const hours = Number(iso[2] || 0);
      const minutes = Number(iso[3] || 0);
      const seconds = Number(iso[4] || 0);
      const total = ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
      return total > 0 ? Math.round(total * 1000) : null;
    }

    const clock = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(text);
    if (clock) {
      if (clock[3] !== undefined) {
        return (
          (Number(clock[1]) * 3600 +
            Number(clock[2]) * 60 +
            Number(clock[3])) *
          1000
        );
      }
      return (Number(clock[1]) * 60 + Number(clock[2])) * 1000;
    }

    const hoursMatch = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours|小时|小時|時)/i.exec(text);
    const minutesMatch = /(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes|分钟|分鐘|分)/i.exec(text);
    const secondsMatch = /(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds|秒)/i.exec(text);
    if (hoursMatch || minutesMatch || secondsMatch) {
      const seconds =
        Number(hoursMatch ? hoursMatch[1] : 0) * 3600 +
        Number(minutesMatch ? minutesMatch[1] : 0) * 60 +
        Number(secondsMatch ? secondsMatch[1] : 0);
      return seconds > 0 ? Math.round(seconds * 1000) : null;
    }

    if (/^\d+(?:\.\d+)?$/.test(text)) {
      const seconds = Number(text);
      return seconds > 0 ? Math.round(seconds * 1000) : null;
    }
    return null;
  }

  function normalizeLanguage(value) {
    const raw = normalizeWhitespace(value).toLowerCase().replace(/_/g, '-');
    if (!raw) return null;
    if (/^(zh|zh-cn|zh-hans|chs|chi|zho|chinese|中文|简体中文|中字|汉语|漢語)$/i.test(raw)) {
      return 'zh';
    }
    if (/^(zh-tw|zh-hk|zh-hant|cht|繁体中文|繁體中文)$/i.test(raw)) {
      return 'zh';
    }
    if (/^(en|eng|english|英文|英语|英語)$/i.test(raw)) return 'en';
    if (/^(ja|jpn|japanese|日文|日语|日語)$/i.test(raw)) return 'ja';
    if (/^(ko|kor|korean|韩文|韩语|韓語)$/i.test(raw)) return 'ko';
    if (/^(fr|fre|fra|french|法语|法語)$/i.test(raw)) return 'fr';
    if (/^(de|ger|deu|german|德语|德語)$/i.test(raw)) return 'de';
    if (/^(es|spa|spanish|西班牙语)$/i.test(raw)) return 'es';
    if (/^(ru|rus|russian|俄语|俄語)$/i.test(raw)) return 'ru';
    const primary = raw.split('-')[0];
    return /^[a-z]{2,3}$/.test(primary) ? primary : null;
  }

  function extractEpisodeInfo(value) {
    const text = String(value == null ? '' : value);
    let match = /\bS(\d{1,2})[\s._-]*E(\d{1,3})\b/i.exec(text);
    if (match) {
      return { season: Number(match[1]), episode: Number(match[2]) };
    }
    match = /\b(?:Season|S)\s*(\d{1,2})[\s._-]*(?:Episode|Ep|E)\s*(\d{1,3})\b/i.exec(text);
    if (match) {
      return { season: Number(match[1]), episode: Number(match[2]) };
    }
    match = /第\s*(\d{1,2})\s*季[\s\S]*?第\s*(\d{1,3})\s*集/u.exec(text);
    if (match) {
      return { season: Number(match[1]), episode: Number(match[2]) };
    }
    match = /\b(\d{1,2})x(\d{1,3})\b/.exec(text);
    if (match) {
      return { season: Number(match[1]), episode: Number(match[2]) };
    }
    return { season: null, episode: null };
  }

  function parseReleaseName(value) {
    const original = String(value == null ? '' : value);
    const languageMatch =
      /(?:^|[.\s_-])(chs|cht|chi|zho|eng|jpn|kor|中字|中英|双语|中文)(?=[.\s_-]|$)/i.exec(
        original
      );
    let text = original
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[._]+/g, ' ');
    text = text.replace(/\[[^\]]{1,80}\]/g, ' ');
    text = text.replace(/\([^)]{1,40}\)/g, ' ');
    text = text.replace(QUALITY_TAG_RE, ' ');
    text = text.replace(/(?:中字|中英|双语|简中|繁中|内嵌|外挂)/g, ' ');
    const episode = extractEpisodeInfo(text);
    const year = extractYear(text);
    text = text.replace(/\b(?:19|20)\d{2}\b/g, ' ');
    text = text.replace(/\bS\d{1,2}[\s._-]*E\d{1,3}\b/gi, ' ');
    text = text.replace(/\s+-\s*[A-Za-z0-9]{2,20}\s*$/u, ' ');
    text = text.replace(/\s*[-–—]+\s*$/u, '');
    return {
      title: cleanTitle(text),
      year,
      season: episode.season,
      episode: episode.episode,
      language: normalizeLanguage(languageMatch ? languageMatch[1] : '')
    };
  }

  function extractFromText(value) {
    const text = String(value == null ? '' : value);
    const episode = extractEpisodeInfo(text);
    return {
      year: extractYear(text),
      durationMs: null,
      season: episode.season,
      episode: episode.episode
    };
  }

  function readMeta(doc, selectors) {
    if (!doc || !doc.querySelector) return '';
    for (const selector of selectors) {
      const element = doc.querySelector(selector);
      if (!element) continue;
      const content =
        element.getAttribute('content') ||
        element.getAttribute('datetime') ||
        element.textContent;
      const value = normalizeWhitespace(content);
      if (value) return value;
    }
    return '';
  }

  function flattenJsonLd(value, output) {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) flattenJsonLd(item, output);
      return;
    }
    if (typeof value !== 'object') return;
    if (value['@graph']) flattenJsonLd(value['@graph'], output);
    const type = value['@type'];
    const types = Array.isArray(type) ? type : [type];
    if (
      types.some(function (item) {
        return /(?:Movie|TVSeries|TVEpisode|VideoObject|Episode)/i.test(
          String(item || '')
        );
      })
    ) {
      output.push(value);
    }
    if (value.mainEntity) flattenJsonLd(value.mainEntity, output);
  }

  function metadataFromJsonLd(doc) {
    if (!doc || !doc.querySelectorAll) return null;
    const results = [];
    for (const script of Array.from(
      doc.querySelectorAll('script[type="application/ld+json"]')
    )) {
      try {
        flattenJsonLd(JSON.parse(script.textContent), results);
      } catch (error) {
        // Ignore malformed structured data.
      }
    }
    if (!results.length) return null;
    for (const item of results) {
      const title = normalizeWhitespace(
        item.name || item.headline || item.alternateName
      );
      if (!title) continue;
      const inLanguage =
        item.inLanguage && typeof item.inLanguage === 'object'
          ? item.inLanguage.name || item.inLanguage.alternateName
          : item.inLanguage;
      const season =
        item.partOfSeason && item.partOfSeason.seasonNumber
          ? item.partOfSeason.seasonNumber
          : item.seasonNumber;
      const episode =
        item.partOfEpisode && item.partOfEpisode.episodeNumber
          ? item.partOfEpisode.episodeNumber
          : item.episodeNumber;
      return {
        title: cleanTitle(title),
        year: extractYear(item.datePublished || item.releaseDate || ''),
        durationMs: parseDuration(item.duration),
        language: normalizeLanguage(inLanguage),
        season: Number.isFinite(Number(season)) ? Number(season) : null,
        episode: Number.isFinite(Number(episode)) ? Number(episode) : null,
        source: 'jsonld'
      };
    }
    return null;
  }

  function getHtmlLanguage(doc) {
    if (!doc || !doc.documentElement) return null;
    return normalizeLanguage(
      doc.documentElement.getAttribute('lang') ||
        doc.documentElement.getAttribute('xml:lang') ||
        ''
    );
  }

  function getVideoDuration(video) {
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      return null;
    }
    return Math.round(video.duration * 1000);
  }

  function extractFromDocument(doc, video) {
    const documentRef = doc || (typeof document !== 'undefined' ? document : null);
    if (!documentRef) {
      return {
        title: '',
        year: null,
        durationMs: null,
        language: null,
        pageLanguage: null,
        season: null,
        episode: null,
        source: 'none',
        confidence: 0
      };
    }

    const jsonLd = metadataFromJsonLd(documentRef);
    const ogTitle = readMeta(documentRef, [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[name="title"]',
      'meta[itemprop="name"]'
    ]);
    const heading = normalizeWhitespace(
      documentRef.querySelector('h1') &&
        documentRef.querySelector('h1').textContent
    );
    const pageTitle = cleanTitle(documentRef.title || '');
    const videoTitle = normalizeWhitespace(
      (video && (video.getAttribute('title') || video.getAttribute('aria-label'))) ||
        ''
    );

    let title = jsonLd && jsonLd.title;
    let source = 'jsonld';
    if (!title && ogTitle) {
      title = cleanTitle(ogTitle);
      source = 'meta';
    }
    if (!title && heading) {
      title = cleanTitle(heading);
      source = 'page';
    }
    if (!title && pageTitle) {
      title = pageTitle;
      source = 'page';
    }
    if (!title && videoTitle) {
      title = cleanTitle(videoTitle);
      source = 'video';
    }

    const year =
      (jsonLd && jsonLd.year) ||
      extractYear(
        readMeta(documentRef, [
          'meta[property="video:release_date"]',
          'meta[property="article:published_time"]',
          'meta[name="date"]'
        ])
      ) ||
      extractYear(title);
    const durationMs =
      getVideoDuration(video) ||
      (jsonLd && jsonLd.durationMs) ||
      parseDuration(
        readMeta(documentRef, [
          'meta[property="og:video:duration"]',
          'meta[property="video:duration"]',
          'meta[itemprop="duration"]'
        ])
      );
    const language =
      (jsonLd && jsonLd.language) ||
      normalizeLanguage(
        readMeta(documentRef, [
          'meta[name="content-language"]',
          'meta[property="og:locale"]'
        ])
      );
    const pageLanguage = getHtmlLanguage(documentRef);
    const episodeInfo =
      jsonLd && (jsonLd.season || jsonLd.episode)
        ? { season: jsonLd.season, episode: jsonLd.episode }
        : extractEpisodeInfo(title || pageTitle);

    const fields = [title, year, durationMs, language, episodeInfo.episode];
    const filled = fields.filter(function (value) {
      return value !== null && value !== undefined && value !== '';
    }).length;
    const confidence = Math.min(
      1,
      (title ? 0.4 : 0) +
        (year ? 0.2 : 0) +
        (durationMs ? 0.2 : 0) +
        (language ? 0.1 : 0) +
        (episodeInfo.episode ? 0.1 : 0) +
        (source === 'jsonld' ? 0.1 : 0)
    );

    return {
      title: title || '',
      year: year || null,
      durationMs: durationMs || null,
      language: language || null,
      pageLanguage: pageLanguage || null,
      season: episodeInfo.season || null,
      episode: episodeInfo.episode || null,
      source,
      confidence: Math.round(confidence * 100) / 100,
      fieldCount: filled
    };
  }

  function mergeMetadata(base, patch) {
    const left = base || {};
    const right = patch || {};
    return {
      title: right.title || left.title || '',
      year: right.year || left.year || null,
      durationMs: right.durationMs || left.durationMs || null,
      language: right.language || left.language || null,
      pageLanguage: right.pageLanguage || left.pageLanguage || null,
      season: right.season || left.season || null,
      episode: right.episode || left.episode || null,
      source: right.source || left.source || 'none',
      confidence:
        typeof right.confidence === 'number'
          ? right.confidence
          : left.confidence || 0
    };
  }

  return {
    cleanTitle,
    extractYear,
    parseDuration,
    normalizeLanguage,
    extractEpisodeInfo,
    parseReleaseName,
    extractFromText,
    extractFromDocument,
    mergeMetadata
  };
});
