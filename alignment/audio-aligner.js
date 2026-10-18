/*
 * Experimental audio/cue correlation.
 *
 * This is pure math: it receives short RMS samples captured from a video's
 * captured audio stream and compares the energy envelope with subtitle cue
 * activity at candidate offsets. It is deliberately conservative; a flat or
 * music-only signal must not produce a confident suggestion.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartSubtitle.alignment.AudioAligner = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MIN_SPAN_MS = 5000;
  const MIN_SAMPLES = 12;
  const MAX_OFFSET_MS = 15000;
  const STEP_MS = 250;
  const DISTINCT_PEAK_SEPARATION_MS = 1000;

  function normalize(values) {
    const count = values.length;
    if (!count) return null;
    let mean = 0;
    for (const value of values) mean += value;
    mean /= count;
    let variance = 0;
    for (const value of values) {
      const diff = value - mean;
      variance += diff * diff;
    }
    variance /= count;
    const std = Math.sqrt(variance);
    if (!Number.isFinite(std) || std < 0.0005) return null;
    return values.map(function (value) {
      return (value - mean) / std;
    });
  }

  function mergeCueIntervals(cues) {
    const sorted = cues.slice().sort(function (a, b) {
      return a.startMs - b.startMs || a.endMs - b.endMs;
    });
    const merged = [];
    for (const cue of sorted) {
      const previous = merged[merged.length - 1];
      if (previous && cue.startMs <= previous.endMs) {
        previous.endMs = Math.max(previous.endMs, cue.endMs);
      } else {
        merged.push({ startMs: cue.startMs, endMs: cue.endMs });
      }
    }
    return merged;
  }

  function activeMask(samples, intervals, offsetMs) {
    const mask = [];
    let intervalIndex = 0;
    for (const sample of samples) {
      const subtitleTime = sample.mediaMs - offsetMs;
      while (
        intervalIndex < intervals.length &&
        intervals[intervalIndex].endMs < subtitleTime
      ) {
        intervalIndex += 1;
      }
      const interval = intervals[intervalIndex];
      mask.push(
        interval &&
          interval.startMs <= subtitleTime &&
          subtitleTime <= interval.endMs
          ? 1
          : 0
      );
    }
    return mask;
  }

  function selectDistinctPeaks(candidates, best, separationMs) {
    if (!best) return [];
    const separation =
      Number.isInteger(separationMs) && separationMs > 0
        ? separationMs
        : DISTINCT_PEAK_SEPARATION_MS;
    const peaks = [best];
    for (const candidate of candidates) {
      if (Math.abs(candidate.offsetMs - best.offsetMs) < separation) continue;
      if (
        peaks.some(function (peak) {
          return Math.abs(peak.offsetMs - candidate.offsetMs) < separation;
        })
      ) {
        continue;
      }
      peaks.push(candidate);
      if (peaks.length >= 2) break;
    }
    return peaks;
  }

  function pearson(left, right) {
    const count = left.length;
    if (!count) return 0;
    let sumA = 0;
    let sumB = 0;
    for (let i = 0; i < count; i += 1) {
      sumA += left[i];
      sumB += right[i];
    }
    const meanA = sumA / count;
    const meanB = sumB / count;
    let num = 0;
    let denA = 0;
    let denB = 0;
    for (let i = 0; i < count; i += 1) {
      const a = left[i] - meanA;
      const b = right[i] - meanB;
      num += a * b;
      denA += a * a;
      denB += b * b;
    }
    if (denA <= 0 || denB <= 0) return 0;
    return num / Math.sqrt(denA * denB);
  }

  function estimateAudioOffset(samples, cues, options) {
    const list = (Array.isArray(samples) ? samples : [])
      .filter(function (sample) {
        return (
          sample &&
          Number.isFinite(sample.mediaMs) &&
          Number.isFinite(sample.rms) &&
          sample.rms >= 0
        );
      })
      .sort(function (a, b) {
        return a.mediaMs - b.mediaMs;
      });
    const cueList = (Array.isArray(cues) ? cues : []).filter(function (cue) {
      return (
        cue &&
        Number.isFinite(cue.startMs) &&
        Number.isFinite(cue.endMs) &&
        cue.endMs > cue.startMs
      );
    });
    if (list.length < MIN_SAMPLES || !cueList.length) {
      return {
        ok: false,
        code: 'NOT_ENOUGH_DATA',
        message: '音频样本或字幕数据不足。'
      };
    }
    const span = list[list.length - 1].mediaMs - list[0].mediaMs;
    if (span < MIN_SPAN_MS) {
      return {
        ok: false,
        code: 'SPAN_TOO_SHORT',
        message: '音频采样不足 5 秒，请播放更长时间后重试。'
      };
    }
    const normalized = normalize(
      list.map(function (sample) {
        return sample.rms;
      })
    );
    if (!normalized) {
      return {
        ok: false,
        code: 'FLAT_AUDIO',
        message: '检测到静音或能量变化过小，无法用音频对齐。'
      };
    }

    const maxOffset =
      Number.isInteger(options && options.maxOffsetMs) &&
      options.maxOffsetMs > 0
        ? Math.min(options.maxOffsetMs, MAX_OFFSET_MS)
        : MAX_OFFSET_MS;
    // Merge overlapping cues once. Each offset scan can then walk the sorted
    // samples and intervals linearly instead of testing every cue per sample.
    const cueIntervals = mergeCueIntervals(cueList);
    const candidates = [];
    for (let offset = -maxOffset; offset <= maxOffset; offset += STEP_MS) {
      const mask = activeMask(list, cueIntervals, offset);
      const score = pearson(normalized, mask);
      candidates.push({ offsetMs: offset, score });
    }
    candidates.sort(function (a, b) {
      return b.score - a.score;
    });
    const best = candidates[0];
    const second = candidates[1] || { score: -1 };
    const margin = best.score - second.score;
    const distinctPeaks = selectDistinctPeaks(
      candidates,
      best,
      options && options.distinctPeakSeparationMs
    );
    const secondDistinct = distinctPeaks[1] || null;
    const distinctMargin = secondDistinct
      ? best.score - secondDistinct.score
      : best.score;
    if (!best || best.score < 0.2 || distinctMargin < 0.02) {
      return {
        ok: false,
        code: 'LOW_CORRELATION',
        message: '音频与字幕的相关性不足，无法可靠对齐。',
        bestPeakOffsetMs: best ? best.offsetMs : null,
        bestPeakScore: best ? Number(best.score.toFixed(3)) : null,
        secondDistinctPeakOffsetMs: secondDistinct
          ? secondDistinct.offsetMs
          : null,
        secondDistinctPeakScore: secondDistinct
          ? Number(secondDistinct.score.toFixed(3))
          : null,
        distinctMargin: Number(distinctMargin.toFixed(3)),
        candidates: candidates.slice(0, 8).map(function (candidate) {
          return {
            offsetMs: candidate.offsetMs,
            score: Number(candidate.score.toFixed(3))
          };
        })
      };
    }
    const confidence =
      best.score >= 0.4 && distinctMargin >= 0.05 ? 'medium' : 'low';
    const warnings = [];
    if (confidence === 'low') {
      warnings.push('音频相关性较弱，请手动确认。');
    }
    const atBoundary = Math.abs(best.offsetMs) >= maxOffset - STEP_MS;
    if (atBoundary) {
      warnings.push('最佳偏移落在搜索边界，可能不准确。');
    }
    return {
      ok: true,
      offsetMs: best.offsetMs,
      confidence,
      score: Number(best.score.toFixed(3)),
      margin: Number(margin.toFixed(3)),
      bestPeakOffsetMs: best.offsetMs,
      bestPeakScore: Number(best.score.toFixed(3)),
      secondDistinctPeakOffsetMs: secondDistinct
        ? secondDistinct.offsetMs
        : null,
      secondDistinctPeakScore: secondDistinct
        ? Number(secondDistinct.score.toFixed(3))
        : null,
      distinctMargin: Number(distinctMargin.toFixed(3)),
      atBoundary,
      candidates: candidates.slice(0, 8).map(function (candidate) {
        return {
          offsetMs: candidate.offsetMs,
          score: Number(candidate.score.toFixed(3))
        };
      }),
      spanMs: span,
      sampleCount: list.length,
      reasons: [
        '音频/字幕相关系数 ' + best.score.toFixed(2) + '。',
        '采样 ' + (span / 1000).toFixed(1) + 's。'
      ],
      warnings
    };
  }

  return {
    MIN_SPAN_MS,
    MAX_OFFSET_MS,
    STEP_MS,
    DISTINCT_PEAK_SEPARATION_MS,
    selectDistinctPeaks,
    estimateAudioOffset
  };
});
