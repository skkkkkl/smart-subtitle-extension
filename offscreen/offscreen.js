/*
 * Offscreen document used only for tab audio capture.
 *
 * Chrome tab capture must be consumed by an extension document with DOM/audio
 * APIs; this document samples RMS and returns it to the service worker. Audio
 * is routed back to the destination so capturing does not silently mute the tab.
 */
'use strict';

const SAMPLE_INTERVAL_MS = 100;
const MAX_DURATION_MS = 60000;

function wait(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function captureTab(request) {
  const streamId = request.streamId;
  if (!streamId) throw new Error('缺少标签页音频流 ID。');
  const durationMs = Math.min(
    MAX_DURATION_MS,
    Math.max(2000, Number(request.durationMs) || 8000)
  );
  const startMediaMs = Number(request.startMediaMs) || 0;

  let stream = null;
  let context = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });
    const tracks = stream.getAudioTracks();
    if (!tracks.length) throw new Error('标签页没有可用的音频轨道。');
    context = new AudioContext();
    if (context.state === 'suspended') await context.resume();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    // Keep the captured tab audible; tab capture can mute the original output.
    source.connect(context.destination);

    const samples = [];
    const started = performance.now();
    const data = new Float32Array(analyser.fftSize);
    while (performance.now() - started < durationMs) {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const value of data) sum += value * value;
      samples.push({
        mediaMs: startMediaMs + (performance.now() - started),
        rms: Math.sqrt(sum / data.length)
      });
      await wait(SAMPLE_INTERVAL_MS);
    }
    return { ok: true, samples };
  } catch (error) {
    return {
      ok: false,
      code: 'TAB_AUDIO_FAILED',
      message: error && error.message ? error.message : '标签页音频捕获失败。'
    };
  } finally {
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch (error) {
          // ignore
        }
      }
    }
    if (context) {
      await context.close().catch(function () {});
    }
  }
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || message.type !== 'SMART_SUBTITLE_OFFSCREEN_CAPTURE') {
    return false;
  }
  captureTab(message).then(sendResponse, function (error) {
    sendResponse({
      ok: false,
      code: 'TAB_AUDIO_FAILED',
      message: error && error.message ? error.message : '标签页音频捕获失败。'
    });
  });
  return true;
});
