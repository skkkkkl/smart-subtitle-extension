/*
 * Pure settings schema and appearance helpers.
 *
 * This module is shared by the panel, options page, storage adapter and tests.
 * It has no Chrome or DOM dependency so it can be reused by a future Android
 * host.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartSubtitle.storage.SettingsModel = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;

  const DEFAULT_APPEARANCE = Object.freeze({
    fontSize: 24,
    color: '#ffffff',
    fontWeight: 600,
    outlineColor: '#000000',
    outlineWidth: 2,
    backgroundColor: '#000000',
    backgroundOpacity: 0.7,
    position: 90,
    shadowEnabled: true,
    shadowColor: '#000000',
    shadowOpacity: 0.55,
    shadowBlur: 4,
    shadowOffsetX: 0,
    shadowOffsetY: 2,
    overrideAss: false
  });

  function cloneAppearance(appearance) {
    return {
      fontSize: appearance.fontSize,
      color: appearance.color,
      fontWeight: appearance.fontWeight,
      outlineColor: appearance.outlineColor,
      outlineWidth: appearance.outlineWidth,
      backgroundColor: appearance.backgroundColor,
      backgroundOpacity: appearance.backgroundOpacity,
      position: appearance.position,
      shadowEnabled: appearance.shadowEnabled,
      shadowColor: appearance.shadowColor,
      shadowOpacity: appearance.shadowOpacity,
      shadowBlur: appearance.shadowBlur,
      shadowOffsetX: appearance.shadowOffsetX,
      shadowOffsetY: appearance.shadowOffsetY,
      overrideAss: Boolean(appearance.overrideAss)
    };
  }

  function createDefaultSettings() {
    return {
      version: VERSION,
      appearance: cloneAppearance(DEFAULT_APPEARANCE)
    };
  }

  function numberInRange(value, min, max, fallback, integer) {
    if (value === null || value === undefined || value === '') return fallback;
    let number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    if (integer) number = Math.round(number);
    if (number < min) number = min;
    if (number > max) number = max;
    return number;
  }

  function normalizeColor(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const input = value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(input)) return input;
    if (/^#[0-9a-f]{3}$/.test(input)) {
      return (
        '#' +
        input[1] + input[1] +
        input[2] + input[2] +
        input[3] + input[3]
      );
    }
    return fallback;
  }

  function sanitizeAppearance(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const rawWeight = numberInRange(
      input.fontWeight,
      400,
      800,
      DEFAULT_APPEARANCE.fontWeight,
      true
    );
    return {
      fontSize: numberInRange(
        input.fontSize,
        10,
        48,
        DEFAULT_APPEARANCE.fontSize,
        true
      ),
      color: normalizeColor(input.color, DEFAULT_APPEARANCE.color),
      fontWeight: Math.round(rawWeight / 100) * 100,
      outlineColor: normalizeColor(
        input.outlineColor,
        DEFAULT_APPEARANCE.outlineColor
      ),
      outlineWidth:
        Math.round(
          numberInRange(
            input.outlineWidth,
            0,
            6,
            DEFAULT_APPEARANCE.outlineWidth,
            false
          ) * 2
        ) / 2,
      backgroundColor: normalizeColor(
        input.backgroundColor,
        DEFAULT_APPEARANCE.backgroundColor
      ),
      backgroundOpacity: Math.round(
        numberInRange(
          input.backgroundOpacity,
          0,
          0.95,
          DEFAULT_APPEARANCE.backgroundOpacity,
          false
        ) * 100
      ) / 100,
      position: numberInRange(
        input.position,
        60,
        96,
        DEFAULT_APPEARANCE.position,
        true
      ),
      shadowEnabled:
        input.shadowEnabled === undefined
          ? DEFAULT_APPEARANCE.shadowEnabled
          : Boolean(input.shadowEnabled),
      shadowColor: normalizeColor(
        input.shadowColor,
        DEFAULT_APPEARANCE.shadowColor
      ),
      shadowOpacity: Math.round(
        numberInRange(
          input.shadowOpacity,
          0,
          0.9,
          DEFAULT_APPEARANCE.shadowOpacity,
          false
        ) * 100
      ) / 100,
      shadowBlur: numberInRange(
        input.shadowBlur,
        0,
        16,
        DEFAULT_APPEARANCE.shadowBlur,
        true
      ),
      shadowOffsetX: numberInRange(
        input.shadowOffsetX,
        -16,
        16,
        DEFAULT_APPEARANCE.shadowOffsetX,
        true
      ),
      shadowOffsetY: numberInRange(
        input.shadowOffsetY,
        -16,
        16,
        DEFAULT_APPEARANCE.shadowOffsetY,
        true
      ),
      overrideAss:
        input.overrideAss === undefined
          ? DEFAULT_APPEARANCE.overrideAss
          : Boolean(input.overrideAss)
    };
  }

  function sanitizeSettings(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    return {
      version: VERSION,
      appearance: sanitizeAppearance(input.appearance)
    };
  }

  function sameSettings(a, b) {
    return JSON.stringify(sanitizeSettings(a)) === JSON.stringify(sanitizeSettings(b));
  }

  function hexToRgba(hex, opacity) {
    const color = normalizeColor(hex, '#000000').slice(1);
    const r = parseInt(color.slice(0, 2), 16);
    const g = parseInt(color.slice(2, 4), 16);
    const b = parseInt(color.slice(4, 6), 16);
    return (
      'rgba(' + r + ', ' + g + ', ' + b + ', ' +
      Number(opacity).toFixed(2) + ')'
    );
  }

  function cssPx(value) {
    const rounded = Math.round(value * 100) / 100;
    const safe = Object.is(rounded, -0) ? 0 : rounded;
    return safe + 'px';
  }

  /**
   * Four hard corner shadows leave visible gaps at 12/3/6/9 o'clock and look
   * jagged on large captions. Build a dense circular ring instead, with a very
   * small blur to hide the polygon seams. The result is still plain text-shadow,
   * which is one of the ::cue properties Chrome actually supports.
   */
  function buildTextShadow(appearance) {
    const shadows = [];
    const width = Number(appearance.outlineWidth) || 0;
    if (width > 0) {
      const color = appearance.outlineColor;
      const count = width >= 4 ? 32 : 24;
      const blur = Math.min(0.4, Math.max(0.12, width * 0.12));
      for (let index = 0; index < count; index += 1) {
        const angle = (Math.PI * 2 * index) / count;
        const dx = Math.cos(angle) * width;
        const dy = Math.sin(angle) * width;
        shadows.push(
          cssPx(dx) + ' ' + cssPx(dy) + ' ' + cssPx(blur) + ' ' + color
        );
      }
    }

    if (appearance.shadowEnabled !== false) {
      const offsetX = Number(appearance.shadowOffsetX) || 0;
      const offsetY = Number(appearance.shadowOffsetY) || 0;
      const blur = Math.max(0, Number(appearance.shadowBlur) || 0);
      const opacity = Number(appearance.shadowOpacity);
      if (blur > 0 || offsetX !== 0 || offsetY !== 0) {
        // Put the drop shadow after the outline ring so it sits behind the
        // outline and text; CSS paints the first shadow on top.
        shadows.push(
          cssPx(offsetX) + ' ' + cssPx(offsetY) + ' ' + cssPx(blur) + ' ' +
            hexToRgba(
              appearance.shadowColor || '#000000',
              Number.isFinite(opacity) ? opacity : 0.55
            )
        );
      }
    }

    return shadows.length ? shadows.join(', ') : 'none';
  }

  function buildCueCss(rawAppearance) {
    const appearance = sanitizeAppearance(rawAppearance);
    const shadow = buildTextShadow(appearance);
    return (
      'video[data-smart-subtitle-cue="true"]::cue {\n' +
      '  color: ' + appearance.color + ' !important;\n' +
      '  font-size: ' + appearance.fontSize + 'px !important;\n' +
      '  font-weight: ' + appearance.fontWeight + ' !important;\n' +
      '  line-height: 1.4 !important;\n' +
      '  text-align: center !important;\n' +
      '  background-color: ' +
      hexToRgba(appearance.backgroundColor, appearance.backgroundOpacity) +
      ' !important;\n' +
      '  text-shadow: ' + shadow + ' !important;\n' +
      '}\n'
    );
  }

  function buildPreviewStyle(rawAppearance) {
    const appearance = sanitizeAppearance(rawAppearance);
    return {
      color: appearance.color,
      fontSize: appearance.fontSize + 'px',
      fontWeight: String(appearance.fontWeight),
      lineHeight: '1.4',
      textAlign: 'center',
      backgroundColor: hexToRgba(
        appearance.backgroundColor,
        appearance.backgroundOpacity
      ),
      textShadow: buildTextShadow(appearance)
    };
  }

  function addCueLineSetting(settings, position) {
    const base = typeof settings === 'string' ? settings.trim() : '';
    if (!Number.isFinite(Number(position))) return base;
    const line = numberInRange(position, 60, 96, DEFAULT_APPEARANCE.position, true);
    if (/(?:^|\s)line:\S+/.test(base)) return base;
    return (base ? base + ' ' : '') + 'line:' + line + '%';
  }

  return {
    VERSION,
    DEFAULT_APPEARANCE: cloneAppearance(DEFAULT_APPEARANCE),
    createDefaultSettings,
    sanitizeAppearance,
    sanitizeSettings,
    sameSettings,
    hexToRgba,
    buildTextShadow,
    buildCueCss,
    buildPreviewStyle,
    addCueLineSetting
  };
});
