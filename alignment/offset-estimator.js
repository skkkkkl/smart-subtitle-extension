/*
 * Heuristic overall-offset estimator.
 *
 * This is intentionally conservative: without audio/ASR there is no reliable
 * way to know where dialogue starts. The only strong anchor available locally
 * is the subtitle tail vs. the video duration. The result is therefore a
 * suggestion with a confidence label, never an automatic destructive change.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartSubtitle.alignment.OffsetEstimator = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_OFFSET = 3600000;
  // A tail difference larger than this is usually credits/extras or a missing
  // ending, not a global offset. Do not offer a dangerous auto-apply.
  const MAX_TAIL_GAP_MS = 10000;
  const MAX_AUTO_OFFSET_MS = 10000;
  const MAX_ANCHOR_CONFLICT_MS = 15000;

  function validCues(cues) {
    return (Array.isArray(cues) ? cues : []).filter(function (cue) {
      return (
        cue &&
        Number.isFinite(cue.startMs) &&
        Number.isFinite(cue.endMs) &&
        cue.endMs > cue.startMs
      );
    });
  }

  function estimateOffset(videoDurationMs, cues, options) {
    const duration = Number(videoDurationMs);
    const list = validCues(cues);
    if (!Number.isFinite(duration) || duration <= 0) {
      return {
        ok: false,
        code: 'NO_DURATION',
        message: '无法获取视频时长，不能分析整体偏移。'
      };
    }
    if (!list.length) {
      return {
        ok: false,
        code: 'NO_SUBTITLE',
        message: '没有可用于分析的字幕。'
      };
    }

    let firstStartMs = Infinity;
    let lastEndMs = 0;
    for (const cue of list) {
      firstStartMs = Math.min(firstStartMs, cue.startMs);
      lastEndMs = Math.max(lastEndMs, cue.endMs);
    }
    const tailGapMs = Math.abs(duration - lastEndMs);
    const tailOffsetMs = Math.round(duration - lastEndMs);
    const firstAnchorMs = Math.round(-firstStartMs);
    if (tailGapMs > MAX_TAIL_GAP_MS) {
      return {
        ok: false,
        code: 'TAIL_TOO_FAR',
        message:
          '末条字幕距离视频结尾约 ' +
          Math.round(tailGapMs / 1000) +
          ' 秒，可能缺少片尾或包含彩蛋；不建议用尾锚定，请归零后手动校准。'
      };
    }
    if (
      Math.abs(tailOffsetMs - firstAnchorMs) > MAX_ANCHOR_CONFLICT_MS
    ) {
      return {
        ok: false,
        code: 'ANCHOR_CONFLICT',
        message:
          '首条字幕与末条字幕给出的方向不一致（首条约 ' +
          Math.round(firstAnchorMs / 1000) +
          ' 秒，末条约 ' +
          Math.round(tailOffsetMs / 1000) +
          ' 秒）；这更像片尾差，不支持自动应用，请手动校准。'
      };
    }
    let offsetMs = tailOffsetMs;
    if (Math.abs(offsetMs) > MAX_AUTO_OFFSET_MS) {
      return {
        ok: false,
        code: 'OFFSET_TOO_LARGE',
        message:
          '建议偏移 ' +
          Math.round(offsetMs / 1000) +
          ' 秒，超出自动建议安全范围；请归零后手动校准。'
      };
    }
    let clamped = false;
    if (firstStartMs + offsetMs < 0) {
      offsetMs = Math.round(-firstStartMs);
      clamped = true;
    }
    offsetMs = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, offsetMs));

    const firstShiftedMs = firstStartMs + offsetMs;
    let score = 0;
    const reasons = [];
    const warnings = [];

    if (list.length >= 30) score += 2;
    else if (list.length >= 10) score += 1;
    else warnings.push('字幕条数较少。');

    if (tailGapMs <= 5000) score += 3;
    else if (tailGapMs <= 30000) score += 2;
    else if (tailGapMs <= 120000) score += 1;
    else warnings.push('末条字幕距离视频结尾较远，可能包含片尾或缺少结尾。');

    if (Math.abs(offsetMs) <= 5000) score += 2;
    else if (Math.abs(offsetMs) <= 30000) score += 1;
    else if (Math.abs(offsetMs) <= 120000) score += 1;
    else warnings.push('建议偏移较大，可能不是整体偏移问题。');

    if (firstShiftedMs >= 0) score += 1;
    else warnings.push('建议偏移会让首条字幕落到视频开始之前，已限制。');
    if (clamped) {
      warnings.push('已限制偏移以保留首条字幕。');
      score = Math.min(score, 4);
    }

    const confidence = score >= 6 ? 'medium' : 'low';
    reasons.push(
      '视频 ' + Math.round(duration / 1000) + 's，末条字幕结束于 ' +
        Math.round(lastEndMs / 1000) + 's。'
    );
    reasons.push(
      '候选偏移 ' + Math.round(offsetMs / 1000) + 's（基于原始时间轴）。'
    );
    reasons.push(
      '首条锚点约 ' + Math.round(firstAnchorMs / 1000) + 's。'
    );
    if (tailGapMs <= 30000) reasons.push('末条字幕靠近视频结尾。');

    return {
      ok: true,
      offsetMs,
      confidence,
      score,
      durationMs: duration,
      firstStartMs,
      lastEndMs,
      tailGapMs,
      reasons,
      warnings
    };
  }

  return {
    MAX_OFFSET,
    estimateOffset
  };
});
