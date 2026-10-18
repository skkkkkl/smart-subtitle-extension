/*
 * Detects HTML5 <video> elements in the top document and reports changes.
 *
 * This module is intentionally unaware of subtitles. It handles SPA mutations,
 * multiple videos and media state labels. iframe documents are out of scope for
 * Phase 1 because the extension does not request broad host permissions.
 */
(function (root) {
  'use strict';

  const NS = root.SmartSubtitle;
  const ids = new WeakMap();
  let nextId = 1;

  function idFor(video) {
    let id = ids.get(video);
    if (!id) {
      id = 'video-' + nextId;
      nextId += 1;
      ids.set(video, id);
    }
    return id;
  }

  function safeComputedStyle(video) {
    try {
      return root.getComputedStyle(video);
    } catch (error) {
      return null;
    }
  }

  function describeVideo(video, index) {
    const rect = video.getBoundingClientRect();
    const style = safeComputedStyle(video);
    const visible =
      video.isConnected &&
      rect.width >= 2 &&
      rect.height >= 2 &&
      (!style || (style.display !== 'none' && style.visibility !== 'hidden'));

    const playing = !video.paused && !video.ended && video.readyState >= 2;
    const labels = [];
    labels.push('视频 ' + (index + 1));

    if (rect.width && rect.height) {
      labels.push(Math.round(rect.width) + '×' + Math.round(rect.height));
    }
    if (playing) labels.push('播放中');
    if (!visible) labels.push('隐藏');

    const aria = (video.getAttribute('aria-label') || '').trim();
    if (aria) labels.push(aria.slice(0, 28));

    return {
      id: idFor(video),
      video,
      label: labels.join(' · '),
      visible,
      playing,
      width: rect.width,
      height: rect.height,
      area: rect.width * rect.height,
      readyState: video.readyState,
      ended: video.ended
    };
  }

  function pickBestVideo(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return null;
    const ranked = entries.slice().sort(function (a, b) {
      const aScore =
        (a.playing ? 1e9 : 0) + (a.visible ? 1e7 : 0) + (a.area || 0);
      const bScore =
        (b.playing ? 1e9 : 0) + (b.visible ? 1e7 : 0) + (b.area || 0);
      return bScore - aScore;
    });
    return ranked[0];
  }

  class VideoDetector {
    constructor(options) {
      const opts = options || {};
      this.onChange = typeof opts.onChange === 'function' ? opts.onChange : null;
      this.debounceMs = Number.isFinite(opts.debounceMs) ? opts.debounceMs : 120;
      this.observer = null;
      this.timer = null;
      this.lastSignature = '';
      this.lastEntries = [];
      this.started = false;
      this._onMutation = this._onMutation.bind(this);
      this._onMediaEvent = this._onMediaEvent.bind(this);
      this._onViewportChange = this._onViewportChange.bind(this);
    }

    start() {
      if (this.started) return;
      this.started = true;

      if (typeof MutationObserver === 'function' && document.documentElement) {
        this.observer = new MutationObserver(this._onMutation);
        this.observer.observe(document.documentElement, {
          childList: true,
          subtree: true
        });
      }

      document.addEventListener('play', this._onMediaEvent, true);
      document.addEventListener('pause', this._onMediaEvent, true);
      document.addEventListener('ended', this._onMediaEvent, true);
      document.addEventListener('loadedmetadata', this._onMediaEvent, true);
      document.addEventListener('durationchange', this._onMediaEvent, true);
      document.addEventListener('emptied', this._onMediaEvent, true);
      root.addEventListener('resize', this._onViewportChange, { passive: true });

      this.refresh(true);
    }

    refresh(force) {
      if (!this.started) return;
      const videos = Array.from(document.querySelectorAll('video'));
      const entries = videos.map(describeVideo);
      const signature = entries
        .map(function (entry) {
          return [
            entry.id,
            entry.label,
            entry.playing ? '1' : '0',
            entry.visible ? '1' : '0'
          ].join(':');
        })
        .join('|');

      if (force || signature !== this.lastSignature) {
        this.lastSignature = signature;
        this.lastEntries = entries;
        if (this.onChange) {
          this.onChange(entries.slice(), pickBestVideo(entries));
        }
      }
    }

    _onMutation() {
      this._schedule();
    }

    _onMediaEvent() {
      this._schedule();
    }

    _onViewportChange() {
      this._schedule();
    }

    _schedule() {
      if (!this.started) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.refresh(false);
      }, this.debounceMs);
    }

    destroy() {
      this.started = false;
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      document.removeEventListener('play', this._onMediaEvent, true);
      document.removeEventListener('pause', this._onMediaEvent, true);
      document.removeEventListener('ended', this._onMediaEvent, true);
      document.removeEventListener('loadedmetadata', this._onMediaEvent, true);
      document.removeEventListener('durationchange', this._onMediaEvent, true);
      document.removeEventListener('emptied', this._onMediaEvent, true);
      root.removeEventListener('resize', this._onViewportChange);
      this.lastEntries = [];
    }
  }

  NS.content.VideoDetector = VideoDetector;
  NS.content.pickBestVideo = pickBestVideo;
})(typeof globalThis !== 'undefined' ? globalThis : this);
