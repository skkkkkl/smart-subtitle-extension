/*
 * Experimental audio capture / calibration.
 *
 * This uses video.captureStream() rather than createMediaElementSource so the
 * page's normal audio path is not muted. Cross-origin/DRM media may expose no
 * audio track; in that case the caller must fall back to manual calibration.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../alignment/audio-aligner.js'));
  } else {
    root.SmartSubtitle.content.AudioCalibrator = factory(
      root.SmartSubtitle.alignment.AudioAligner
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (AudioAligner) {
  'use strict';

  const SAMPLE_INTERVAL_MS = 100;
  const SAMPLE_DURATION_MS = 8000;

  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  class AudioCalibrator {
    constructor(video, options) {
      this.video = video;
      this.options = options || {};
      this.sampleDurationMs =
        this.options.sampleDurationMs || SAMPLE_DURATION_MS;
      this.sampleIntervalMs =
        this.options.sampleIntervalMs || SAMPLE_INTERVAL_MS;
    }

    _captureStream() {
      const video = this.video;
      if (!video) throw new Error('没有可分析的视频。');
      const capture =
        video.captureStream ||
        video.mozCaptureStream ||
        video.webkitCaptureStream;
      if (typeof capture !== 'function') {
        throw new Error('当前浏览器不支持视频音频捕获。');
      }
      return capture.call(video);
    }

    async _openAnalyser() {
      const stream = this._captureStream();
      const audioTracks = stream.getAudioTracks
        ? stream.getAudioTracks()
        : [];
      if (!audioTracks.length) {
        if (stream.getTracks) {
          for (const track of stream.getTracks()) track.stop();
        }
        throw new Error('视频没有可用的音频轨道（可能是跨域、DRM 或静音源）。');
      }
      const AudioContextClass =
        typeof AudioContext !== 'undefined'
          ? AudioContext
          : typeof webkitAudioContext !== 'undefined'
            ? webkitAudioContext
            : null;
      if (!AudioContextClass) {
        for (const track of audioTracks) track.stop();
        throw new Error('当前环境没有 Web Audio API。');
      }
      const context = new AudioContextClass();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      if (context.state === 'suspended') {
        await context.resume();
      }
      return {
        context,
        source,
        analyser,
        stream,
        audioTracks
      };
    }

    _rms(analyser) {
      const array = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(array);
      let sum = 0;
      for (const value of array) sum += value * value;
      return Math.sqrt(sum / array.length);
    }

    _close(opened) {
      try {
        opened.source.disconnect();
      } catch (error) {
        // ignore
      }
      for (const track of opened.audioTracks) {
        try {
          track.stop();
        } catch (error) {
          // ignore
        }
      }
      return opened.context.close().catch(function () {});
    }

    async probe() {
      let opened;
      try {
        opened = await this._openAnalyser();
        await wait(180);
        const rms = this._rms(opened.analyser);
        await this._close(opened);
        return {
          ok: true,
          rms,
          silent: rms < 0.0005,
          sampleRate: opened.context.sampleRate
        };
      } catch (error) {
        if (opened) await this._close(opened);
        return {
          ok: false,
          code: 'AUDIO_UNAVAILABLE',
          message: error && error.message ? error.message : '无法读取视频音频。'
        };
      }
    }

    async calibrate(cues) {
      if (!this.video) {
        return { ok: false, code: 'NO_VIDEO', message: '没有可分析的视频。' };
      }
      if (this.video.paused) {
        return {
          ok: false,
          code: 'PAUSED',
          message: '请先播放视频，再开始 8 秒音频采样。'
        };
      }
      let opened;
      try {
        opened = await this._openAnalyser();
        const samples = [];
        const started = performance.now();
        while (performance.now() - started < this.sampleDurationMs) {
          if (this.video.paused || this.video.ended) break;
          samples.push({
            mediaMs: this.video.currentTime * 1000,
            rms: this._rms(opened.analyser)
          });
          await wait(this.sampleIntervalMs);
        }
        await this._close(opened);
        if (samples.length < 12) {
          return {
            ok: false,
            code: 'NOT_ENOUGH_AUDIO',
            message: '采样时间不足，请播放视频 8 秒后重试。'
          };
        }
        const result = AudioAligner.estimateAudioOffset(samples, cues);
        return Object.assign({}, result, { sampleCount: samples.length });
      } catch (error) {
        if (opened) await this._close(opened);
        return {
          ok: false,
          code: 'AUDIO_UNAVAILABLE',
          message: error && error.message ? error.message : '无法读取视频音频。'
        };
      }
    }
  }

  return {
    SAMPLE_DURATION_MS,
    SAMPLE_INTERVAL_MS,
    AudioCalibrator
  };
});
