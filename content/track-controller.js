/*
 * Owns the native <track> lifecycle for exactly one <video>.
 *
 * Key guarantees:
 *  - a new track is loaded before the old local track is removed (no blank gap
 *    while changing offsets),
 *  - Blob URLs are revoked when the track is replaced, removed or the content
 *    script is destroyed,
 *  - page-provided TextTrack modes are saved and restored,
 *  - stale asynchronous loads are aborted by a sequence token.
 */
(function (root) {
  'use strict';

  const NS = root.SmartSubtitle;
  const SubtitleError = NS.subtitles.SubtitleError.SubtitleError;
  const LOCAL_ATTR = 'data-smart-subtitle';
  const DEFAULT_TIMEOUT_MS = 10000;

  function waitForTrackLoad(trackElement, timeoutMs) {
    return new Promise(function (resolve, reject) {
      let settled = false;
      let timer = null;
      let poller = null;
      const textTrack = trackElement.track;

      function cleanup() {
        if (timer) clearTimeout(timer);
        if (poller) clearInterval(poller);
        trackElement.removeEventListener('load', onLoad);
        trackElement.removeEventListener('error', onError);
        if (textTrack) {
          textTrack.removeEventListener('load', onLoad);
          textTrack.removeEventListener('error', onError);
        }
      }

      function finish(error) {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      }

      function onLoad() {
        finish(null);
      }

      function onError() {
        finish(
          new SubtitleError(
            'TRACK_LOAD_FAILED',
            '浏览器无法加载字幕轨道。该网页可能阻止了 blob: 资源，或视频元素已失效。'
          )
        );
      }

      function checkState() {
        if (!textTrack) return;
        if (textTrack.readyState === 2) {
          finish(null);
        } else if (textTrack.readyState === 3) {
          onError();
        }
      }

      trackElement.addEventListener('load', onLoad);
      trackElement.addEventListener('error', onError);
      if (textTrack) {
        textTrack.addEventListener('load', onLoad);
        textTrack.addEventListener('error', onError);
      }

      timer = setTimeout(function () {
        finish(
          new SubtitleError(
            'TRACK_LOAD_TIMEOUT',
            '字幕轨道加载超时。可能是网页 CSP 阻止了 blob: 字幕，或浏览器没有触发 track load 事件。'
          )
        );
      }, timeoutMs);

      poller = setInterval(checkState, 80);
      Promise.resolve().then(checkState);
    });
  }

  class SubtitleTrackController {
    constructor(video, options) {
      const opts = options || {};
      this.video = video;
      this.timeoutMs = Number.isFinite(opts.timeoutMs)
        ? opts.timeoutMs
        : DEFAULT_TIMEOUT_MS;
      this.label = opts.label || '本地字幕';
      this.active = null;
      this.pending = new Set();
      this.mutedModes = new Map();
      this.enabled = opts.enabled !== false;
      this.sequence = 0;
      this.destroyed = false;

      // Clean up tracks left by a previous content-script instance after an
      // extension reload. Their original Blob URLs cannot be revoked here.
      if (video && video.querySelectorAll) {
        const orphans = video.querySelectorAll('track[' + LOCAL_ATTR + ']');
        for (const orphan of Array.from(orphans)) {
          orphan.remove();
        }
      }
    }

    get isActive() {
      return Boolean(
        this.active &&
          this.active.element &&
          this.active.element.isConnected
      );
    }

    get cueCount() {
      return this.active ? this.active.cueCount : 0;
    }

    /**
     * Load and swap in a new VTT payload.
     * @param {string} vttText
     * @param {{label?:string, enabled?:boolean}} [options]
     */
    async show(vttText, options) {
      const opts = options || {};
      if (this.destroyed) {
        throw new SubtitleError('TRACK_DESTROYED', '字幕轨道控制器已销毁。');
      }
      if (!this.video || !this.video.isConnected) {
        throw new SubtitleError(
          'VIDEO_UNAVAILABLE',
          '目标视频已从页面移除，请重新选择视频。'
        );
      }
      if (typeof vttText !== 'string' || !vttText.trim()) {
        throw new SubtitleError('EMPTY_VTT', '没有可加载的 WebVTT 内容。');
      }

      if (opts.enabled !== undefined) {
        this.enabled = Boolean(opts.enabled);
      }
      const label = opts.label || this.label;
      const sequence = ++this.sequence;
      const url = URL.createObjectURL(
        new Blob([vttText], { type: 'text/vtt;charset=utf-8' })
      );
      const element = document.createElement('track');
      element.kind = 'subtitles';
      element.label = label;
      element.srclang = 'und';
      element.default = false;
      element.src = url;
      element.setAttribute(LOCAL_ATTR, 'pending');
      this.pending.add({ element, url });

      try {
        this.video.appendChild(element);
        const textTrack = element.track;
        if (!textTrack) {
          throw new SubtitleError(
            'TRACK_UNAVAILABLE',
            '浏览器没有为 <track> 创建 TextTrack。'
          );
        }

        // "hidden" loads cues without painting them, so the old track can stay
        // visible until the replacement is ready.
        textTrack.mode = 'hidden';
        await waitForTrackLoad(element, this.timeoutMs);

        if (
          sequence !== this.sequence ||
          this.destroyed ||
          !this.video.isConnected
        ) {
          throw new SubtitleError(
            'TRACK_ABORTED',
            '字幕轨道加载已被新的操作取消。'
          );
        }

        if (!textTrack.cues || textTrack.cues.length === 0) {
          throw new SubtitleError(
            'TRACK_NO_CUES',
            '字幕轨道已加载，但没有任何可用字幕。'
          );
        }

        // Remember page tracks before muting them. Never include the pending
        // local track in this map.
        for (const other of Array.from(this.video.textTracks)) {
          if (other === textTrack) continue;
          if (!this.mutedModes.has(other)) {
            this.mutedModes.set(other, other.mode);
          }
        }

        this._removeActive();

        for (const other of Array.from(this.video.textTracks)) {
          if (other !== textTrack) {
            other.mode = 'disabled';
          }
        }

        textTrack.mode = this.enabled ? 'showing' : 'disabled';
        element.setAttribute(LOCAL_ATTR, 'active');
        this.label = label;

        const cueList = Array.from(textTrack.cues);
        const managedFlags =
          Array.isArray(opts.lineManaged) &&
          opts.lineManaged.length === cueList.length
            ? opts.lineManaged
            : null;
        const lineManagedCues = managedFlags
          ? cueList.filter(function (cue, index) {
              return managedFlags[index] === true;
            })
          : cueList;

        this.active = {
          element,
          url,
          track: textTrack,
          label,
          cueCount: textTrack.cues.length,
          lineManagedCues
        };
        this.pending.delete(this._pendingEntryFor(element));

        return {
          cueCount: textTrack.cues.length,
          label,
          enabled: this.enabled
        };
      } catch (error) {
        this._releasePending(element, url);
        if (error instanceof SubtitleError) throw error;
        throw new SubtitleError(
          'TRACK_LOAD_FAILED',
          '字幕轨道加载失败：' + (error && error.message ? error.message : '未知错误'),
          { cause: error }
        );
      }
    }

    setEnabled(enabled) {
      this.enabled = Boolean(enabled);
      if (this.active && this.active.track) {
        this.active.track.mode = this.enabled ? 'showing' : 'disabled';
      }
      return this.enabled;
    }

    /**
     * Move cues that do not have an authored line setting immediately.
     * This is used by the position slider so dragging does not repeatedly
     * recreate the <track> or Blob URL.
     *
     * @param {number} percent 0-100, usually 60-96
     * @returns {number} number of updated cues
     */
    setLinePosition(percent) {
      const value = Number(percent);
      if (!Number.isFinite(value) || value < 0 || value > 100) return 0;
      if (!this.active || !this.active.track || !this.active.track.cues) {
        return 0;
      }

      const cues =
        this.active.lineManagedCues ||
        Array.from(this.active.track.cues);
      let updated = 0;
      for (const cue of cues) {
        try {
          cue.snapToLines = false;
          cue.line = value;
          updated += 1;
        } catch (error) {
          // Ignore a cue implementation that does not allow live line changes.
        }
      }
      return updated;
    }

    _pendingEntryFor(element) {
      for (const entry of this.pending) {
        if (entry.element === element) return entry;
      }
      return null;
    }

    _releasePending(element, url) {
      for (const entry of Array.from(this.pending)) {
        if (entry.element === element) {
          this.pending.delete(entry);
        }
      }
      try {
        if (element && element.parentNode) element.remove();
      } catch (error) {
        // Detached videos can throw in unusual page environments.
      }
      try {
        URL.revokeObjectURL(url);
      } catch (error) {
        // Ignore already-revoked URLs.
      }
    }

    _removeActive() {
      if (!this.active) return;
      const active = this.active;
      this.active = null;
      try {
        if (active.element.parentNode) active.element.remove();
      } catch (error) {
        // Ignore.
      }
      try {
        URL.revokeObjectURL(active.url);
      } catch (error) {
        // Ignore.
      }
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.sequence += 1;

      for (const entry of Array.from(this.pending)) {
        this.pending.delete(entry);
        try {
          if (entry.element.parentNode) entry.element.remove();
        } catch (error) {
          // Ignore.
        }
        try {
          URL.revokeObjectURL(entry.url);
        } catch (error) {
          // Ignore.
        }
      }

      this._removeActive();

      const currentTracks = this.video
        ? Array.from(this.video.textTracks || [])
        : [];
      for (const [track, mode] of this.mutedModes) {
        if (currentTracks.includes(track)) {
          try {
            track.mode = mode;
          } catch (error) {
            // Ignore a track that disappeared during cleanup.
          }
        }
      }
      this.mutedModes.clear();
    }
  }

  NS.content.SubtitleTrackController = SubtitleTrackController;
})(typeof globalThis !== 'undefined' ? globalThis : this);
