/*
 * ASS inline override parser.
 *
 * Supports the common presentation tags used by subtitle files: \an, \pos,
 * \fs, \b, \i, colors, \bord, \shad and line breaks. Unknown tags are ignored,
 * not rendered as literal text. This is intentionally not a full libass.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SmartSubtitle.subtitles.AssText = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_STYLE = {
    fontSize: 24,
    bold: false,
    italic: false,
    primaryColor: '#ffffff',
    outlineColor: '#000000',
    backColor: 'rgba(0,0,0,0.55)',
    outline: 2,
    shadow: 1,
    alignment: 2
  };

  function hexByte(value) {
    const text = String(value || '').replace(/[^0-9a-f]/gi, '');
    return parseInt(text, 16);
  }

  function parseAssColor(value) {
    const match = /&H([0-9a-f]{6,8})&?/i.exec(String(value || ''));
    if (!match) return null;
    const hex = match[1].toUpperCase();
    const alphaByte = hex.length === 8 ? hex.slice(0, 2) : '00';
    const blue = hex.slice(-6, -4);
    const green = hex.slice(-4, -2);
    const red = hex.slice(-2);
    const alpha = Math.max(0, Math.min(1, 1 - hexByte(alphaByte) / 255));
    return (
      'rgba(' +
      hexByte(red) +
      ', ' +
      hexByte(green) +
      ', ' +
      hexByte(blue) +
      ', ' +
      alpha.toFixed(3) +
      ')'
    );
  }

  function styleToState(style) {
    const base = style || {};
    return {
      bold: Boolean(base.bold),
      italic: Boolean(base.italic),
      color: base.primaryColor || DEFAULT_STYLE.primaryColor,
      outlineColor: base.outlineColor || DEFAULT_STYLE.outlineColor,
      outline: Number.isFinite(base.outline) ? base.outline : 2,
      shadow: Number.isFinite(base.shadow) ? base.shadow : 1,
      shadowColor: base.backColor || DEFAULT_STYLE.backColor,
      fontSize: Number.isFinite(base.fontSize)
        ? base.fontSize
        : DEFAULT_STYLE.fontSize,
      fontName: base.fontName || 'Arial',
      alignment: base.alignment || DEFAULT_STYLE.alignment,
      position: null
    };
  }

  function parseNumber(value, fallback) {
    const number = Number.parseFloat(String(value || ''));
    return Number.isFinite(number) ? number : fallback;
  }

  function parsePair(value) {
    const match = /^\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*$/.exec(
      String(value || '')
    );
    if (!match) return null;
    return { x: Number(match[1]), y: Number(match[2]) };
  }

  function applyTags(block, state, baseState, styles) {
    const tagRe = /\\([a-z]+)(?:\(([^)]*)\)|([^\\}]*))/gi;
    let match;
    while ((match = tagRe.exec(block))) {
      const tag = match[1].toLowerCase();
      const arg = (match[2] || match[3] || '').trim();
      if (tag === 'an') {
        const value = parseNumber(arg, state.alignment);
        if (value >= 1 && value <= 9) state.alignment = Math.round(value);
      } else if (tag === 'pos') {
        const pair = parsePair(arg);
        if (pair) state.position = pair;
      } else if (tag === 'fs') {
        state.fontSize = parseNumber(arg, state.fontSize);
      } else if (tag === 'b') {
        state.bold = arg === '' ? true : parseNumber(arg, 0) !== 0;
      } else if (tag === 'i') {
        state.italic = arg === '' ? true : parseNumber(arg, 0) !== 0;
      } else if (tag === 'c' || tag === '1c') {
        const color = parseAssColor(arg);
        if (color) state.color = color;
      } else if (tag === '3c') {
        const color = parseAssColor(arg);
        if (color) state.outlineColor = color;
      } else if (tag === '4c') {
        const color = parseAssColor(arg);
        if (color) state.shadowColor = color;
      } else if (tag === 'bord') {
        state.outline = Math.max(0, parseNumber(arg, state.outline));
      } else if (tag === 'shad') {
        state.shadow = Math.max(0, parseNumber(arg, state.shadow));
      } else if (tag === 'r') {
        const named = arg && styles && styles[arg];
        const reset = styleToState(named || baseState.style || null);
        Object.assign(state, reset);
        state.drawing = false;
      } else if (tag === 'p') {
        state.drawing = parseNumber(arg, 0) > 0;
      } else if (
        tag === 'k' ||
        tag === 'kf' ||
        tag === 'ko' ||
        tag === 'K' ||
        tag === 'fad' ||
        tag === 'fade' ||
        tag === 'move' ||
        tag === 'alpha' ||
        tag === '1a' ||
        tag === '2a' ||
        tag === '3a' ||
        tag === '4a' ||
        tag === 'be' ||
        tag === 'blur' ||
        tag === 'fn' ||
        tag === 'q' ||
        tag === 't'
      ) {
        // Recognized but not represented by the overlay subset.
      }
    }
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\\N/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\h/g, ' ');
  }

  function parse(raw, style, styles) {
    const baseState = styleToState(style);
    baseState.style = style;
    const state = Object.assign({}, baseState);
    const segments = [];
    const text = String(raw || '');
    let cursor = 0;

    function pushText(value) {
      if (!value) return;
      if (state.drawing) return;
      segments.push({
        text: value,
        bold: state.bold,
        italic: state.italic,
        color: state.color,
        outlineColor: state.outlineColor,
        outline: state.outline,
        shadow: state.shadow,
        shadowColor: state.shadowColor,
        fontSize: state.fontSize,
        fontName: state.fontName
      });
    }

    while (cursor < text.length) {
      const open = text.indexOf('{', cursor);
      if (open === -1) {
        pushText(normalizeText(text.slice(cursor)));
        break;
      }
      pushText(normalizeText(text.slice(cursor, open)));
      const close = text.indexOf('}', open + 1);
      if (close === -1) {
        pushText(normalizeText(text.slice(open)));
        break;
      }
      applyTags(text.slice(open + 1, close), state, baseState, styles);
      cursor = close + 1;
    }

    return {
      segments,
      alignment: state.alignment,
      position: state.position,
      fontSize: state.fontSize
    };
  }

  return {
    DEFAULT_STYLE,
    parseAssColor,
    parse
  };
});
