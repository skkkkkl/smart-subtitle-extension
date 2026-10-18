/*
 * Multi-window audio calibration.
 *
 * One 8s correlation is fragile. This module independently estimates each
 * window, rejects weak/ambiguous windows, then aggregates with a weighted
 * median plus MAD. It returns a target total offset, never an increment.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./audio-aligner.js'),
      require('./audio-features.js')
    );
  } else {
    root.SmartSubtitle.alignment.AudioSession = factory(
      root.SmartSubtitle.alignment.AudioAligner,
      root.SmartSubtitle.alignment.AudioFeatures
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (
  AudioAligner,
  AudioFeatures
) {
  'use strict';

  function weightedMedian(items) {
    const sorted = items.slice().sort(function (a, b) {
      return a.value - b.value;
    });
    const total = sorted.reduce(function (sum, item) {
      return sum + item.weight;
    }, 0);
    if (total <= 0) return 0;
    let running = 0;
    for (const item of sorted) {
      running += item.weight;
      if (running >= total / 2) return item.value;
    }
    return sorted[sorted.length - 1].value;
  }

  function median(values) {
    if (!values.length) return 0;
    const sorted = values.slice().sort(function (a, b) {
      return a - b;
    });
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function cueActivityRatio(frames, cues, offsetMs) {
    if (!frames.length) return 0;
    let active = 0;
    for (const frame of frames) {
      const subtitleTime = frame.mediaMs - offsetMs;
      if (
        cues.some(function (cue) {
          return subtitleTime >= cue.startMs && subtitleTime <= cue.endMs;
        })
      ) {
        active += 1;
      }
    }
    return active / frames.length;
  }

  function windowTiming(window) {
    const frames = window.frames || [];
    let discontinuity = false;
    for (let i = 1; i < frames.length; i += 1) {
      const delta = frames[i].mediaMs - frames[i - 1].mediaMs;
      if (delta <= 0 || delta > 1500) discontinuity = true;
    }
    return {
      windowStartMediaMs: window.startMs,
      windowEndMediaMs: window.endMs,
      audioSampleStartMs: frames.length ? frames[0].mediaMs : null,
      audioSampleEndMs: frames.length
        ? frames[frames.length - 1].mediaMs
        : null,
      mediaTimeDiscontinuity: discontinuity
    };
  }

  function candidateConsensus(entries, options) {
    const opts = options || {};
    const tolerance = opts.consensusToleranceMs || 1000;
    const minScore = opts.consensusMinScore == null ? 0.2 : opts.consensusMinScore;
    const clusters = [];
    for (const entry of entries || []) {
      for (const candidate of entry.candidates || []) {
        if (!Number.isFinite(candidate.offsetMs) || candidate.score < minScore) {
          continue;
        }
        let cluster = clusters.find(function (item) {
          return Math.abs(item.centerMs - candidate.offsetMs) <= tolerance;
        });
        if (!cluster) {
          cluster = {
            centerMs: candidate.offsetMs,
            totalScore: 0,
            weight: 0,
            maxScore: 0,
            windows: new Set(),
            candidates: []
          };
          clusters.push(cluster);
        }
        cluster.totalScore += candidate.score;
        cluster.weight += 1;
        cluster.maxScore = Math.max(cluster.maxScore, candidate.score);
        cluster.windows.add(entry.index);
        cluster.candidates.push({
          index: entry.index,
          offsetMs: candidate.offsetMs,
          score: candidate.score
        });
        // Update a score-weighted center; nearby candidates stay one cluster.
        cluster.centerMs =
          (cluster.centerMs * (cluster.weight - 1) + candidate.offsetMs) /
          cluster.weight;
      }
    }
    const ranked = clusters
      .map(function (cluster) {
        const scores = cluster.candidates.map(function (candidate) {
          return candidate.score;
        });
        return {
          offsetMs: Math.round(cluster.centerMs),
          support: cluster.windows.size,
          totalWindows: (entries || []).length,
          medianScore: median(scores),
          maxScore: cluster.maxScore,
          windows: Array.from(cluster.windows).sort(function (a, b) {
            return a - b;
          })
        };
      })
      .sort(function (a, b) {
        return b.support - a.support || b.medianScore - a.medianScore;
      });
    if (!ranked.length) return null;
    const best = ranked[0];
    const second = ranked.find(function (candidate) {
      return Math.abs(candidate.offsetMs - best.offsetMs) > tolerance;
    });
    return {
      offsetMs: best.offsetMs,
      support: best.support,
      totalWindows: best.totalWindows,
      medianScore: Number(best.medianScore.toFixed(3)),
      maxScore: Number(best.maxScore.toFixed(3)),
      windows: best.windows,
      secondOffsetMs: second ? second.offsetMs : null,
      secondSupport: second ? second.support : null,
      marginSupport: second ? best.support - second.support : best.support
    };
  }

  function analyzeAudioSession(samples, cues, options) {
    const opts = options || {};
    const features = AudioFeatures.buildAudioFrames(samples, opts);
    if (!features.ok) {
      return {
        ok: false,
        code: features.code,
        message: features.message
      };
    }
    const windows = AudioFeatures.splitWindows(features.frames, {
      windowMs: opts.windowMs || 8000,
      count: opts.count || 5,
      gapMs: opts.gapMs || 0,
      minFrames: opts.minFrames || 30
    });
    if (windows.length < 2) {
      return {
        ok: false,
        code: 'NOT_ENOUGH_WINDOWS',
        message: '有效音频窗口不足。'
      };
    }

    const globalEstimate = AudioAligner.estimateAudioOffset(
      features.frames,
      cues,
      { maxOffsetMs: opts.maxOffsetMs || 15000 }
    );
    const estimates = [];
    const rejected = [];
    const maxOffset = opts.maxOffsetMs || 15000;
    const minPeakMargin = opts.minPeakMargin == null ? 0.03 : opts.minPeakMargin;
    const boundaryMarginMs = opts.boundaryMarginMs == null ? 1500 : opts.boundaryMarginMs;
    for (const window of windows) {
      if (window.activeRatio < (opts.minActiveRatio || 0.12)) {
        rejected.push(Object.assign(windowTiming(window), {
          index: window.index,
          startMs: window.startMs,
          endMs: window.endMs,
          activeRatio: window.activeRatio,
          code: 'LOW_ACTIVITY',
          rejectReason: 'LOW_ACTIVITY',
          message: '活动音频过少'
        }));
        continue;
      }
      const windowCues = cues.filter(function (cue) {
        return (
          cue.endMs >= window.startMs - maxOffset &&
          cue.startMs <= window.endMs + maxOffset
        );
      });
      const result = AudioAligner.estimateAudioOffset(
        window.frames,
        windowCues,
        { maxOffsetMs: maxOffset }
      );
      if (!result.ok) {
        rejected.push(Object.assign(windowTiming(window), {
          index: window.index,
          startMs: window.startMs,
          endMs: window.endMs,
          activeRatio: window.activeRatio,
          code: result.code,
          rejectReason: result.code,
          message: result.message,
          bestPeakOffsetMs: result.bestPeakOffsetMs,
          bestPeakScore: result.bestPeakScore,
          secondDistinctPeakOffsetMs: result.secondDistinctPeakOffsetMs,
          secondDistinctPeakScore: result.secondDistinctPeakScore,
          distinctMargin: result.distinctMargin,
          candidates: result.candidates || []
        }));
        continue;
      }
      const atBoundary =
        result.atBoundary ||
        Math.abs(result.offsetMs) >= maxOffset - boundaryMarginMs;
      // The nearest 250ms candidate is not an independent alternative peak.
      // Use the score gap to the next distinct offset to detect true ambiguity.
      const distinctMargin =
        result.distinctMargin == null ? result.margin : result.distinctMargin;
      if (distinctMargin < minPeakMargin) {
        rejected.push(Object.assign(windowTiming(window), {
          index: window.index,
          startMs: window.startMs,
          endMs: window.endMs,
          activeRatio: window.activeRatio,
          offsetMs: result.offsetMs,
          score: result.score,
          margin: result.margin,
          secondScore: Number(
            Math.max(0, result.score - (result.margin || 0)).toFixed(3)
          ),
          bestPeakOffsetMs: result.bestPeakOffsetMs,
          bestPeakScore: result.bestPeakScore,
          secondDistinctPeakOffsetMs: result.secondDistinctPeakOffsetMs,
          secondDistinctPeakScore: result.secondDistinctPeakScore,
          distinctMargin: result.distinctMargin,
          atBoundary,
          searchBoundaryHit: atBoundary,
          code: 'AMBIGUOUS_PEAK',
          rejectReason: 'AMBIGUOUS_PEAK',
          message: '最佳峰与独立候选峰分差小于 ' + minPeakMargin,
          candidates: result.candidates || []
        }));
        continue;
      }
      if (atBoundary) {
        rejected.push(Object.assign(windowTiming(window), {
          index: window.index,
          startMs: window.startMs,
          endMs: window.endMs,
          activeRatio: window.activeRatio,
          offsetMs: result.offsetMs,
          score: result.score,
          margin: result.margin,
          bestPeakOffsetMs: result.bestPeakOffsetMs,
          bestPeakScore: result.bestPeakScore,
          secondDistinctPeakOffsetMs: result.secondDistinctPeakOffsetMs,
          secondDistinctPeakScore: result.secondDistinctPeakScore,
          distinctMargin: result.distinctMargin,
          atBoundary: true,
          searchBoundaryHit: true,
          code: 'SEARCH_BOUNDARY',
          rejectReason: 'SEARCH_BOUNDARY',
          message: '最佳偏移贴近 ±' + maxOffset / 1000 + 's 搜索边界，不能自动应用',
          candidates: result.candidates || []
        }));
        continue;
      }
      estimates.push(Object.assign(windowTiming(window), {
        index: window.index,
        startMs: window.startMs,
        endMs: window.endMs,
        offsetMs: result.offsetMs,
        value: result.offsetMs,
        weight: Math.max(0.1, result.score),
        score: result.score,
        secondScore: Number(
          Math.max(0, result.score - (result.margin || 0)).toFixed(3)
        ),
        margin: result.margin,
        bestPeakOffsetMs: result.bestPeakOffsetMs,
        bestPeakScore: result.bestPeakScore,
        secondDistinctPeakOffsetMs: result.secondDistinctPeakOffsetMs,
        secondDistinctPeakScore: result.secondDistinctPeakScore,
        distinctMargin: result.distinctMargin,
        atBoundary,
        searchBoundaryHit: atBoundary,
        candidates: result.candidates || [],
        confidence: result.confidence,
        activeRatio: window.activeRatio,
        cueActivityRatio: Number(
          cueActivityRatio(window.frames, windowCues, result.offsetMs).toFixed(3)
        )
      }));
    }

    if (estimates.length < 3) {
      return {
        ok: false,
        code: 'NOT_ENOUGH_VALID_WINDOWS',
        message:
          '只有 ' + estimates.length + ' 个有效窗口，至少需要 3 个。',
        windows: estimates,
        rejected,
        diagnostics: {
          global: globalEstimate,
          consensus: candidateConsensus(
            estimates.concat(rejected).map(function (item) {
              return { index: item.index, candidates: item.candidates || [] };
            }),
            opts
          ),
          validWindows: estimates.length,
          totalWindows: windows.length,
          windows: estimates,
          rejected
        }
      };
    }

    const offsets = estimates.map(function (estimate) {
      return estimate.value;
    });
    const medianOffset = median(offsets);
    const target = Math.round(
      weightedMedian(
        estimates.map(function (estimate) {
          return {
            value: estimate.value,
            weight: estimate.weight
          };
        })
      )
    );
    const residuals = offsets.map(function (value) {
      return Math.abs(value - medianOffset);
    });
    const mad = median(residuals);
    const targetResiduals = offsets.map(function (value) {
      return Math.abs(value - target);
    });
    const targetResidualMad = median(targetResiduals);
    const spread = Math.max.apply(null, offsets) - Math.min.apply(null, offsets);
    const allCandidates = estimates.concat(rejected).map(function (item) {
      return {
        index: item.index,
        candidates: item.candidates || []
      };
    });
    const consensus = candidateConsensus(allCandidates, opts);
    const diagnostics = {
      global: globalEstimate,
      consensus,
      medianOffsetMs: Math.round(medianOffset),
      targetOffsetMs: target,
      madMs: Math.round(mad),
      targetResidualMadMs: Math.round(targetResidualMad),
      spreadMs: spread,
      validWindows: estimates.length,
      totalWindows: windows.length,
      windows: estimates,
      rejected
    };
    if (mad > (opts.maxMadMs || 500) || targetResidualMad > (opts.maxMadMs || 500)) {
      return {
        ok: false,
        code: 'INCONSISTENT_WINDOWS',
        message:
          '各窗口偏移差异过大（MAD ' +
          Math.round(mad) +
          'ms，目标残差 MAD ' +
          Math.round(targetResidualMad) +
          'ms），不能自动应用。',
        windows: estimates,
        rejected,
        madMs: mad,
        targetResidualMadMs: targetResidualMad,
        medianOffsetMs: Math.round(medianOffset),
        diagnostics
      };
    }
    if (spread > (opts.maxSpreadMs || 2500)) {
      return {
        ok: false,
        code: 'MULTI_CLUSTER',
        message: '窗口结果分成多个偏移簇，不能强行平均。',
        windows: estimates,
        rejected,
        madMs: mad,
        spreadMs: spread,
        diagnostics
      };
    }
    const meanScore =
      estimates.reduce(function (sum, estimate) {
        return sum + estimate.score;
      }, 0) / estimates.length;
    const confidence =
      estimates.length >= 4 && mad <= 250 && meanScore >= 0.35
        ? 'high'
        : estimates.length >= 3 && mad <= 500
          ? 'medium'
          : 'low';
    return {
      ok: true,
      offsetMs: target,
      confidence,
      score: Number(meanScore.toFixed(3)),
      madMs: Math.round(mad),
      targetResidualMadMs: Math.round(targetResidualMad),
      medianOffsetMs: Math.round(medianOffset),
      spreadMs: spread,
      validWindows: estimates.length,
      totalWindows: windows.length,
      estimates,
      rejected,
      diagnostics,
      features: {
        activeRatio: features.activeRatio,
        spanMs: features.spanMs,
        sampleCount: features.sampleCount
      },
      reasons: [
        '有效窗口 ' + estimates.length + '/' + windows.length + '。',
        'MAD ' + Math.round(mad) + 'ms，跨度 ' + spread + 'ms。'
      ],
      warnings:
        confidence === 'low' ? ['跨窗口一致性较弱，请手动确认。'] : []
    };
  }

  return {
    analyzeAudioSession,
    candidateConsensus,
    weightedMedian,
    median
  };
});
