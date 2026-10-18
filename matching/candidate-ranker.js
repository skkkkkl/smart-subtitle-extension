/*
 * Pure subtitle candidate scoring.
 *
 * The ranker never performs network requests. A provider supplies candidate
 * metadata; this module explains the match with a score, coverage and reasons.
 * Missing fields lower confidence instead of being treated as perfect matches.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./metadata-extractor.js'));
  } else {
    root.SmartSubtitle.matching.CandidateRanker = factory(
      root.SmartSubtitle.matching.MetadataExtractor
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Metadata) {
  'use strict';

  const WEIGHTS = {
    title: 0.5,
    year: 0.18,
    duration: 0.2,
    language: 0.07,
    episode: 0.05
  };
  const TOTAL_WEIGHT = Object.keys(WEIGHTS).reduce(function (sum, key) {
    return sum + WEIGHTS[key];
  }, 0);

  function normalizeForCompare(value) {
    return String(value == null ? '' : value)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\[\](){}【】]/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  function compact(value) {
    return normalizeForCompare(value).replace(/\s+/g, '');
  }

  function tokenJaccard(a, b) {
    const aTokens = new Set(normalizeForCompare(a).split(' ').filter(Boolean));
    const bTokens = new Set(normalizeForCompare(b).split(' ').filter(Boolean));
    if (!aTokens.size || !bTokens.size) return 0;
    let intersection = 0;
    for (const token of aTokens) {
      if (bTokens.has(token)) intersection += 1;
    }
    return intersection / (aTokens.size + bTokens.size - intersection);
  }

  function bigramDice(a, b) {
    const left = compact(a);
    const right = compact(b);
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.length < 2 || right.length < 2) return left === right ? 1 : 0;
    const map = new Map();
    for (let i = 0; i < left.length - 1; i += 1) {
      const pair = left.slice(i, i + 2);
      map.set(pair, (map.get(pair) || 0) + 1);
    }
    let overlap = 0;
    for (let i = 0; i < right.length - 1; i += 1) {
      const pair = right.slice(i, i + 2);
      const count = map.get(pair) || 0;
      if (count > 0) {
        overlap += 1;
        map.set(pair, count - 1);
      }
    }
    return (2 * overlap) / (left.length - 1 + right.length - 1);
  }

  function titleSimilarity(a, b) {
    const left = normalizeForCompare(a);
    const right = normalizeForCompare(b);
    if (!left || !right) return 0;
    if (left === right) return 1;
    return Math.max(tokenJaccard(left, right), bigramDice(left, right));
  }

  function durationSimilarity(leftMs, rightMs) {
    const diff = Math.abs(Number(leftMs) - Number(rightMs)) / 1000;
    if (!Number.isFinite(diff)) return 0;
    if (diff <= 2) return 1;
    if (diff <= 20) return 0.9;
    if (diff <= 60) return 0.7;
    if (diff <= 180) return 0.4;
    if (diff <= 600) return 0.15;
    return 0;
  }

  function yearSimilarity(left, right) {
    if (!left || !right) return 0;
    const diff = Math.abs(Number(left) - Number(right));
    if (diff === 0) return 1;
    if (diff === 1) return 0.6;
    return 0;
  }

  function languageSimilarity(left, right) {
    const a = Metadata.normalizeLanguage(left);
    const b = Metadata.normalizeLanguage(right);
    if (!a || !b) return 0;
    return a === b ? 1 : 0;
  }

  function episodeSimilarity(query, candidate) {
    const qSeason = Number(query.season);
    const qEpisode = Number(query.episode);
    const cSeason = Number(candidate.season);
    const cEpisode = Number(candidate.episode);
    if (!Number.isFinite(qEpisode) || !Number.isFinite(cEpisode)) return 0;
    if (qEpisode !== cEpisode) return 0;
    if (Number.isFinite(qSeason) && Number.isFinite(cSeason)) {
      return qSeason === cSeason ? 1 : 0;
    }
    return 0.8;
  }

  function candidateTitle(candidate) {
    const explicit = String(candidate.title || '').trim();
    if (explicit) return explicit;
    if (candidate.fileName) {
      return Metadata.parseReleaseName(candidate.fileName).title;
    }
    return '';
  }

  function candidateYear(candidate) {
    if (candidate.year) return Number(candidate.year);
    if (candidate.fileName) {
      return Metadata.parseReleaseName(candidate.fileName).year;
    }
    return null;
  }

  function candidateEpisode(candidate) {
    if (candidate.episode) {
      return {
        season: candidate.season ? Number(candidate.season) : null,
        episode: Number(candidate.episode)
      };
    }
    if (candidate.fileName) {
      const parsed = Metadata.parseReleaseName(candidate.fileName);
      return { season: parsed.season, episode: parsed.episode };
    }
    return { season: null, episode: null };
  }

  function scoreCandidate(query, candidate) {
    const reasons = [];
    const mismatches = [];
    const components = {};
    let weighted = 0;
    let availableWeight = 0;
    let penalty = 0;

    const title = candidateTitle(candidate);
    if (query.title && title) {
      const similarity = titleSimilarity(query.title, title);
      components.title = similarity;
      weighted += similarity * WEIGHTS.title;
      availableWeight += WEIGHTS.title;
      reasons.push('片名相似度 ' + Math.round(similarity * 100) + '%');
      if (similarity < 0.35) mismatches.push('片名差异较大：' + title);
    } else {
      mismatches.push('缺少片名，无法评估标题匹配');
    }

    const year = candidateYear(candidate);
    if (query.year && year) {
      const similarity = yearSimilarity(query.year, year);
      components.year = similarity;
      weighted += similarity * WEIGHTS.year;
      availableWeight += WEIGHTS.year;
      if (similarity === 1) {
        reasons.push('年份一致 (' + query.year + ')');
      } else if (similarity > 0) {
        reasons.push(
          '年份相差 1 年 (' + query.year + ' vs ' + year + ')'
        );
      } else {
        mismatches.push('年份不一致 (' + query.year + ' vs ' + year + ')');
        penalty += 12;
      }
    } else {
      mismatches.push('缺少年份，置信度受限');
    }

    const candidateDuration = Number(candidate.durationMs);
    if (query.durationMs && Number.isFinite(candidateDuration) && candidateDuration > 0) {
      const similarity = durationSimilarity(query.durationMs, candidateDuration);
      components.duration = similarity;
      weighted += similarity * WEIGHTS.duration;
      availableWeight += WEIGHTS.duration;
      const diff = Math.abs(query.durationMs - candidateDuration) / 1000;
      if (diff <= 2) {
        reasons.push('时长一致');
      } else if (similarity > 0) {
        reasons.push('时长相差 ' + diff.toFixed(1) + ' 秒');
      } else {
        mismatches.push('时长差异过大 (' + diff.toFixed(0) + ' 秒)');
        penalty += 12;
      }
    } else {
      mismatches.push('缺少时长，置信度受限');
    }

    if (query.language && candidate.language) {
      const similarity = languageSimilarity(query.language, candidate.language);
      components.language = similarity;
      weighted += similarity * WEIGHTS.language;
      availableWeight += WEIGHTS.language;
      if (similarity === 1) {
        reasons.push('语言一致 (' + Metadata.normalizeLanguage(candidate.language) + ')');
      } else {
        mismatches.push(
          '语言不一致 (' +
            Metadata.normalizeLanguage(query.language) +
            ' vs ' +
            Metadata.normalizeLanguage(candidate.language) +
            ')'
        );
        penalty += 5;
      }
    }

    const queryEpisode = Number(query.episode);
    const episode = candidateEpisode(candidate);
    if (Number.isFinite(queryEpisode) && Number.isFinite(episode.episode)) {
      const similarity = episodeSimilarity(query, episode);
      components.episode = similarity;
      weighted += similarity * WEIGHTS.episode;
      availableWeight += WEIGHTS.episode;
      if (similarity > 0) {
        reasons.push(
          '集数一致' +
            (Number.isFinite(Number(query.season))
              ? ' S' + String(query.season).padStart(2, '0')
              : '') +
            'E' + String(queryEpisode).padStart(2, '0')
        );
      } else {
        mismatches.push('集数不一致');
      }
    }

    const rawScore = availableWeight
      ? Math.round((weighted / availableWeight) * 100)
      : 0;
    const score = Math.max(0, Math.min(100, rawScore - penalty));
    const coverage = availableWeight / TOTAL_WEIGHT;
    const titleMatched = Boolean(query.title && title);
    let confidence = 'low';
    if (titleMatched && score >= 82 && coverage >= 0.8) {
      confidence = 'high';
    } else if (titleMatched && score >= 62 && coverage >= 0.55) {
      confidence = 'medium';
    }
    const confidenceLabel =
      confidence === 'high' ? '高' : confidence === 'medium' ? '中' : '低';

    return {
      candidate,
      score,
      coverage: Math.round(coverage * 100) / 100,
      confidence,
      confidenceLabel,
      title: title || '',
      components,
      reasons,
      mismatches
    };
  }

  function rankCandidates(query, candidates) {
    if (!query || typeof query !== 'object') return [];
    if (!Array.isArray(candidates)) return [];
    return candidates
      .filter(function (candidate) {
        return candidate && typeof candidate === 'object';
      })
      .map(function (candidate) {
        return scoreCandidate(query, candidate);
      })
      .sort(function (left, right) {
        if (right.score !== left.score) return right.score - left.score;
        if (right.coverage !== left.coverage) {
          return right.coverage - left.coverage;
        }
        return left.title.localeCompare(right.title);
      });
  }

  return {
    WEIGHTS,
    normalizeForCompare,
    titleSimilarity,
    scoreCandidate,
    rankCandidates
  };
});
