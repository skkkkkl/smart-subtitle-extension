/*
 * DOM overlay renderer for the supported ASS/SSA subset.
 *
 * Native <track>/::cue cannot express per-event ASS positioning and styling.
 * This overlay is a fixed layer aligned to the selected video's bounding box.
 * It is intentionally limited: no vector drawings, karaoke timing, \t
 * transforms, \move or full libass layout.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../subtitles/ass-text.js'));
  } else {
    root.SmartSubtitle.content.AssOverlay = factory(
      root.SmartSubtitle.subtitles.AssText
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (AssText) {
  'use strict';

  const OVERLAY_Z = 2147483645;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function outlineShadow(width, color) {
    const radius = Math.max(0, width);
    if (radius <= 0.1) return [];
    const dirs = [
      [-1, -1], [0, -1], [1, -1],
      [-1, 0], [1, 0],
      [-1, 1], [0, 1], [1, 1]
    ];
    return dirs.map(function (dir) {
      return (
        (dir[0] * radius).toFixed(2) +
        'px ' +
        (dir[1] * radius).toFixed(2) +
        'px 0 ' +
        color
      );
    });
  }

  function hexToRgba(hex, opacity) {
    const value = String(hex || '#000000').replace('#', '');
    const normalized =
      value.length === 3
        ? value[0] + value[0] + value[1] + value[1] + value[2] + value[2]
        : value.padEnd(6, '0').slice(0, 6);
    const number = parseInt(normalized, 16);
    if (!Number.isFinite(number)) return 'rgba(0,0,0,' + opacity + ')';
    return (
      'rgba(' +
      ((number >> 16) & 255) +
      ',' +
      ((number >> 8) & 255) +
      ',' +
      (number & 255) +
      ',' +
      opacity +
      ')'
    );
  }

  class AssOverlay {
    constructor(video, options) {
      this.video = video;
      this.options = options || {};
      this.doc = null;
      this.offsetMs = 0;
      this.enabled = true;
      this.host = null;
      this.shadow = null;
      this.layer = null;
      this.frame = null;
      this.lastKey = '';
      this.appearance = this.options.appearance || null;
      this._tick = this._tick.bind(this);
      this._onFullscreenChange = this._onFullscreenChange.bind(this);
      document.addEventListener('fullscreenchange', this._onFullscreenChange);
      document.addEventListener(
        'webkitfullscreenchange',
        this._onFullscreenChange
      );
      this._ensureHost();
      this._start();
    }

    _ensureHost() {
      if (this.host && this.host.isConnected) return;
      this.host = document.createElement('div');
      this.host.setAttribute('aria-hidden', 'true');
      this.host.style.cssText =
        'all:initial;position:fixed;left:0;top:0;width:0;height:0;' +
        'pointer-events:none;overflow:hidden;z-index:' +
        OVERLAY_Z +
        ';contain:layout style paint;';
      this.shadow = this.host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent =
        ':host{all:initial} .layer{position:absolute;inset:0;' +
        'pointer-events:none;overflow:hidden;font-synthesis:none}' +
        '.cue{position:absolute;box-sizing:border-box;white-space:pre-wrap;' +
        'line-height:1.16;word-break:normal;overflow-wrap:anywhere}' +
        '.cue span{white-space:pre-wrap}';
      this.layer = document.createElement('div');
      this.layer.className = 'layer';
      this.shadow.appendChild(style);
      this.shadow.appendChild(this.layer);
      this._syncHostParent();
    }

    _syncHostParent() {
      if (!this.host) return;
      const fullscreen =
        document.fullscreenElement || document.webkitFullscreenElement || null;
      let target = document.documentElement;
      if (
        fullscreen &&
        fullscreen !== this.video &&
        fullscreen.contains(this.video)
      ) {
        target = fullscreen;
      }
      if (this.host.parentNode !== target) target.appendChild(this.host);
      this.lastKey = '';
    }

    _onFullscreenChange() {
      this._syncHostParent();
    }

    setAppearance(appearance) {
      this.appearance = appearance || null;
      this.lastKey = '';
    }

    _start() {
      if (this.frame !== null) return;
      const raf =
        typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : function (fn) {
              return setTimeout(fn, 33);
            };
      this._raf = raf;
      this.frame = raf(this._tick);
    }

    _stop() {
      if (this.frame === null) return;
      const caf =
        typeof cancelAnimationFrame === 'function'
          ? cancelAnimationFrame
          : clearTimeout;
      caf(this.frame);
      this.frame = null;
    }

    show(doc, options) {
      this.doc = doc;
      const opts = options || {};
      this.offsetMs = opts.offsetMs || 0;
      this.enabled = opts.enabled !== false;
      this.lastKey = '';
      this._ensureHost();
      this._start();
    }

    setOffset(offsetMs) {
      this.offsetMs = Number(offsetMs) || 0;
      this.lastKey = '';
    }

    setEnabled(enabled) {
      this.enabled = Boolean(enabled);
      this.lastKey = '';
      this._applyVisibility();
    }

    get isActive() {
      return Boolean(
        this.enabled &&
          this.doc &&
          this.video &&
          this.video.isConnected &&
          this.host &&
          this.host.isConnected
      );
    }

    _applyVisibility() {
      if (!this.host) return;
      const show = this.isActive;
      this.host.style.display = show ? 'block' : 'none';
    }

    _activeCues(timeMs) {
      if (!this.doc) return [];
      return this.doc.cues
        .filter(function (cue) {
          return timeMs >= cue.startMs && timeMs < cue.endMs;
        })
        .sort(function (a, b) {
          return a.layer - b.layer || a.startMs - b.startMs;
        });
    }

    _tick() {
      this.frame = null;
      try {
        this._renderFrame();
      } catch (error) {
        console.warn('[本地字幕] ASS 覆盖层渲染失败：', error);
      }
      this._start();
    }

    _renderFrame() {
      if (!this.host || !this.video) return;
      this._syncHostParent();
      if (!this.enabled || !this.doc || !this.video.isConnected) {
        this._applyVisibility();
        return;
      }
      const rect = this.video.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        this._applyVisibility();
        return;
      }
      this.host.style.display = 'block';
      this.host.style.left = rect.left + 'px';
      this.host.style.top = rect.top + 'px';
      this.host.style.width = rect.width + 'px';
      this.host.style.height = rect.height + 'px';

      const currentMs = this.video.currentTime * 1000 - this.offsetMs;
      const active = this._activeCues(currentMs);
      const key =
        active
          .map(function (cue) {
            return cue.id;
          })
          .join('|') +
        '@' +
        Math.round(rect.width) +
        'x' +
        Math.round(rect.height);
      if (key === this.lastKey) return;
      this.lastKey = key;
      this.layer.textContent = '';
      for (const cue of active) {
        this._renderCue(cue, rect);
      }
    }

    _renderCue(cue, rect) {
      const styles = this.doc.assStyles || {};
      const style = cue.styleData || styles[cue.style] || styles.Default;
      const parsed = AssText.parse(cue.text, style, styles);
      if (!parsed.segments.length) return;
      const info = this.doc.assInfo || {};
      const playResX = info.playResX > 0 ? info.playResX : 384;
      const playResY = info.playResY > 0 ? info.playResY : 288;
      const scaleX = rect.width / playResX;
      const scaleY = rect.height / playResY;
      const appearance = this.appearance;
      const override = Boolean(appearance && appearance.overrideAss);
      const overrideFontPx = override
        ? Math.max(8, appearance.fontSize * (rect.height / 1080))
        : 0;
      const alignment = clamp(
        parsed.alignment || style.alignment || 2,
        1,
        9
      );
      const horizontal = (alignment - 1) % 3;
      const vertical = Math.floor((alignment - 1) / 3);
      const element = document.createElement('div');
      element.className = 'cue';
      element.style.textAlign =
        horizontal === 0 ? 'left' : horizontal === 1 ? 'center' : 'right';
      element.style.maxWidth = '100%';
      element.style.fontFamily =
        (style.fontName || 'Arial') + ', "Microsoft YaHei", sans-serif';

      const marginL = cue.marginL != null ? cue.marginL : style.marginL || 20;
      const marginR = cue.marginR != null ? cue.marginR : style.marginR || 20;
      const marginV = cue.marginV != null ? cue.marginV : style.marginV || 20;
      let transformX = '0';
      let transformY = '0';

      if (override) {
        element.style.left = '50%';
        element.style.right = 'auto';
        element.style.top = 'auto';
        element.style.bottom =
          Math.max(0, Math.min(40, 100 - appearance.position)) + '%';
        element.style.textAlign = 'center';
        transformX = '-50%';
        transformY = '0';
      } else if (parsed.position) {
        element.style.left = parsed.position.x * scaleX + 'px';
        element.style.top = parsed.position.y * scaleY + 'px';
        transformX =
          horizontal === 0 ? '0' : horizontal === 1 ? '-50%' : '-100%';
        transformY = vertical === 0 ? '-100%' : vertical === 1 ? '-50%' : '0';
      } else {
        if (horizontal === 0) {
          element.style.left = marginL * scaleX + 'px';
        } else if (horizontal === 1) {
          element.style.left = '50%';
          transformX = '-50%';
        } else {
          element.style.right = marginR * scaleX + 'px';
        }
        if (vertical === 0) {
          element.style.bottom = marginV * scaleY + 'px';
        } else if (vertical === 1) {
          element.style.top = '50%';
          transformY = '-50%';
        } else {
          element.style.top = marginV * scaleY + 'px';
        }
      }
      element.style.transform =
        'translate(' + transformX + ', ' + transformY + ')';
      if (override) {
        if (appearance.backgroundOpacity > 0) {
          element.style.background = hexToRgba(
            appearance.backgroundColor,
            appearance.backgroundOpacity
          );
          element.style.padding =
            Math.max(1, appearance.outlineWidth) + 'px 5px';
        }
      } else if (style.borderStyle === 3 && style.backColor) {
        element.style.background = style.backColor;
        element.style.padding =
          Math.max(1, style.outline * 0.5 * scaleY) + 'px ' + 4 + 'px';
      }

      for (const segment of parsed.segments) {
        if (!segment.text) continue;
        const span = document.createElement('span');
        span.textContent = segment.text;
        span.style.color = override ? appearance.color : segment.color;
        span.style.fontSize =
          Math.max(
            7,
            override ? overrideFontPx : segment.fontSize * scaleY
          ) + 'px';
        span.style.fontWeight = override
          ? String(appearance.fontWeight)
          : segment.bold
            ? '700'
            : '400';
        span.style.fontStyle = segment.italic ? 'italic' : 'normal';
        const outlineWidth = override
          ? appearance.outlineWidth
          : segment.outline * scaleY;
        const outlineColor = override
          ? appearance.outlineColor
          : segment.outlineColor;
        const shadows = outlineShadow(outlineWidth, outlineColor);
        if (override) {
          if (appearance.shadowEnabled) {
            shadows.push(
              appearance.shadowOffsetX +
                'px ' +
                appearance.shadowOffsetY +
                'px ' +
                appearance.shadowBlur +
                'px ' +
                hexToRgba(appearance.shadowColor, appearance.shadowOpacity)
            );
          }
        } else if (segment.shadow > 0) {
          shadows.push(
            segment.shadow * scaleY +
              'px ' +
              segment.shadow * scaleY +
              'px 0 ' +
              segment.shadowColor
          );
        }
        span.style.textShadow = shadows.join(', ');
        element.appendChild(span);
      }
      this.layer.appendChild(element);
    }

    destroy() {
      this._stop();
      document.removeEventListener('fullscreenchange', this._onFullscreenChange);
      document.removeEventListener(
        'webkitfullscreenchange',
        this._onFullscreenChange
      );
      this.doc = null;
      if (this.host && this.host.parentNode) {
        this.host.parentNode.removeChild(this.host);
      }
      this.host = null;
      this.shadow = null;
      this.layer = null;
    }
  }

  return { AssOverlay };
});
