/*
 * Applies user appearance settings to native TextTrack cues.
 *
 * Chrome's native cue renderer accepts a subset of CSS through ::cue. A page's
 * CSP can block a <style> element, so the preferred path asks the MV3 service
 * worker to call chrome.scripting.insertCSS with USER origin. When that API is
 * unavailable (for example in a DOM harness), an inline <style> fallback keeps
 * the preview functional.
 *
 * Only the local track's <video> gets the marker attribute, so site-provided
 * captions are not restyled.
 */
(function (root) {
  'use strict';

  const NS = root.SmartSubtitle;
  const SettingsModel = NS.storage.SettingsModel;
  const CUE_ATTRIBUTE = 'data-smart-subtitle-cue';
  const STYLE_ID = 'smart-subtitle-cue-style';

  class CueStyleController {
    constructor(options) {
      const opts = options || {};
      this.appearance = SettingsModel.sanitizeAppearance(opts.appearance);
      this.fontScale = 1;
      this.video = null;
      this.sequence = 0;
      this.lastCss = '';
      this.styleElement = null;
      this.chain = Promise.resolve();
    }

    setAppearance(appearance, options) {
      this.appearance = SettingsModel.sanitizeAppearance(appearance);
      const requestedScale = Number(options && options.fontScale);
      this.fontScale = Number.isFinite(requestedScale)
        ? Math.max(1, Math.min(2, requestedScale))
        : 1;
      this.apply();
    }

    attach(video) {
      if (this.video === video) {
        this.apply();
        return;
      }
      if (this.video) {
        this.video.removeAttribute(CUE_ATTRIBUTE);
      }
      this.video = video || null;
      if (this.video) {
        this.video.setAttribute(CUE_ATTRIBUTE, 'true');
      }
      this.apply();
    }

    detach() {
      if (this.video) {
        this.video.removeAttribute(CUE_ATTRIBUTE);
      }
      this.video = null;
      this.fontScale = 1;
      this.apply();
    }

    apply() {
      const sequence = ++this.sequence;
      const css = this.video
        ? SettingsModel.buildCueCss(this.appearance, {
            fontScale: this.fontScale
          })
        : '';
      const previousCss = this.lastCss;
      this.lastCss = css;

      this.chain = this.chain
        .then(() => this._send(sequence, previousCss, css))
        .catch(() => {
          if (sequence === this.sequence) this._applyFallback(css);
        });
      return this.chain;
    }

    async _send(sequence, previousCss, css) {
      if (this._hasRuntime()) {
        try {
          const response = await root.chrome.runtime.sendMessage({
            type: 'SMART_SUBTITLE_CUE_CSS',
            previousCss,
            css
          });
          if (response && response.ok) {
            this._removeFallback();
            return;
          }
        } catch (error) {
          // Fall through to the inline style fallback.
        }
      }
      if (sequence === this.sequence) {
        this._applyFallback(css);
      }
    }

    _hasRuntime() {
      return Boolean(
        root.chrome &&
          root.chrome.runtime &&
          root.chrome.runtime.id &&
          root.chrome.runtime.sendMessage
      );
    }

    _applyFallback(css) {
      if (!css) {
        this._removeFallback();
        return;
      }
      if (!this.styleElement || !this.styleElement.isConnected) {
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.setAttribute('data-smart-subtitle-style', 'true');
        (document.head || document.documentElement).appendChild(style);
        this.styleElement = style;
      }
      this.styleElement.textContent = css;
    }

    _removeFallback() {
      if (this.styleElement) {
        this.styleElement.remove();
        this.styleElement = null;
      }
    }

    destroy() {
      this.detach();
      this.sequence += 1;
      this._removeFallback();
      if (this.video) {
        this.video.removeAttribute(CUE_ATTRIBUTE);
        this.video = null;
      }
    }
  }

  NS.content.CueStyleController = CueStyleController;
})(typeof globalThis !== 'undefined' ? globalThis : this);
