/*
 * ASS / SSA parser.
 *
 * This is a deliberately bounded, dependency-free parser for the common
 * subtitle subset: [Script Info], V4/V4+ styles, and Dialogue events. Rendering
 * is handled by the content overlay; this module has no DOM dependencies.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./subtitle-error.js'),
      require('./ass-text.js')
    );
  } else {
    root.SmartSubtitle.subtitles.AssParser = factory(
      root.SmartSubtitle.subtitles.SubtitleError,
      root.SmartSubtitle.subtitles.AssText
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (
  ErrorModule,
  AssText
) {
  'use strict';

  const SubtitleError = ErrorModule.SubtitleError;

  const DEFAULT_STYLE = {
    name: 'Default',
    fontName: 'Arial',
    fontSize: 24,
    primaryColor: '#ffffff',
    secondaryColor: '#ffffff',
    outlineColor: '#000000',
    backColor: 'rgba(0,0,0,0.55)',
    bold: false,
    italic: false,
    underline: false,
    strikeOut: false,
    borderStyle: 1,
    outline: 2,
    shadow: 1,
    alignment: 2,
    marginL: 20,
    marginR: 20,
    marginV: 20
  };

  function parseTime(value) {
    const match = /^\s*(\d+):(\d{2}):(\d{2})[.,](\d{1,3})\s*$/.exec(
      String(value || '')
    );
    if (!match) return null;
    const fraction = match[4].padEnd(3, '0').slice(0, 3);
    return (
      Number(match[1]) * 3600000 +
      Number(match[2]) * 60000 +
      Number(match[3]) * 1000 +
      Number(fraction)
    );
  }

  function parseInteger(value, fallback) {
    const number = Number.parseInt(String(value || '').trim(), 10);
    return Number.isFinite(number) ? number : fallback;
  }

  function splitFields(line) {
    const parts = String(line || '').split(',');
    return {
      first: parts.shift() || '',
      fields: parts
    };
  }

  function fieldMap(formatLine) {
    const value = String(formatLine || '').replace(/^Format\s*:\s*/i, '');
    return value
      .split(',')
      .map(function (name) {
        return name.trim().toLowerCase();
      })
      .filter(Boolean);
  }

  function readField(fields, names, index) {
    if (typeof fields[index] === 'undefined') return '';
    return String(fields[index]).trim();
  }

  function parseStyle(fields, format, warnings, lineNumber) {
    const map = {};
    format.forEach(function (name, index) {
      map[name] = readField(fields, format, index);
    });
    const name = map.name || 'Default';
    const primary = AssText.parseAssColor(map.primarycolour || '');
    const secondary = AssText.parseAssColor(map.secondarycolour || '');
    const outline = AssText.parseAssColor(map.outlinecolour || '');
    const back = AssText.parseAssColor(map.backcolour || '');
    const boldValue = parseInteger(map.bold, 0);
    const style = Object.assign({}, DEFAULT_STYLE, {
      name,
      fontName: map.fontname || DEFAULT_STYLE.fontName,
      fontSize: parseInteger(map.fontsize, DEFAULT_STYLE.fontSize),
      primaryColor: primary || DEFAULT_STYLE.primaryColor,
      secondaryColor: secondary || DEFAULT_STYLE.secondaryColor,
      outlineColor: outline || DEFAULT_STYLE.outlineColor,
      backColor: back || DEFAULT_STYLE.backColor,
      bold: boldValue === -1 || boldValue >= 700,
      italic: parseInteger(map.italic, 0) !== 0,
      underline: parseInteger(map.underline, 0) !== 0,
      strikeOut: parseInteger(map.strikeout, 0) !== 0,
      borderStyle: parseInteger(map.borderstyle, 1),
      outline: parseInteger(map.outline, 2),
      shadow: parseInteger(map.shadow, 1),
      alignment: Math.min(
        9,
        Math.max(1, parseInteger(map.alignment, 2))
      ),
      marginL: parseInteger(map.marginl, DEFAULT_STYLE.marginL),
      marginR: parseInteger(map.marginr, DEFAULT_STYLE.marginR),
      marginV: parseInteger(map.marginv, DEFAULT_STYLE.marginV)
    });
    if (!map.name) {
      warnings.push({
        line: lineNumber,
        message: '样式行缺少名称，已归入 Default。'
      });
    }
    return style;
  }

  function parseDialogue(fields, format, styles, lineNumber, warnings) {
    const map = {};
    format.forEach(function (name, index) {
      map[name] = readField(fields, format, index);
    });
    const startMs = parseTime(map.start);
    const endMs = parseTime(map.end);
    if (startMs === null || endMs === null || endMs <= startMs) {
      warnings.push({
        line: lineNumber,
        message: 'ASS 对白时间无效，已跳过。'
      });
      return null;
    }
    const text = String(map.text || '').trim();
    if (!text) return null;
    const styleName = map.style || 'Default';
    const style = styles[styleName] || styles.Default || DEFAULT_STYLE;
    return {
      id: 'ass-' + lineNumber,
      startMs,
      endMs,
      text,
      style: styleName,
      styleData: style,
      layer: parseInteger(map.layer || map.marked, 0),
      actor: map.name || '',
      effect: map.effect || '',
      marginL: parseInteger(map.marginl, style.marginL),
      marginR: parseInteger(map.marginr, style.marginR),
      marginV: parseInteger(map.marginv, style.marginV),
      line: lineNumber
    };
  }

  function parse(text) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    const lines = source.split(/\r?\n/);
    let section = '';
    let scriptInfo = {
      playResX: 384,
      playResY: 288,
      wrapStyle: 0,
      scaledBorderAndShadow: true
    };
    let styleFormat = [];
    let eventFormat = [];
    const styles = { Default: Object.assign({}, DEFAULT_STYLE) };
    const cues = [];
    const warnings = [];

    lines.forEach(function (line, index) {
      const lineNumber = index + 1;
      const trimmed = line.trim();
      if (!trimmed) return;
      const sectionMatch = /^\[([^\]]+)\]$/.exec(trimmed);
      if (sectionMatch) {
        section = sectionMatch[1].toLowerCase();
        return;
      }
      if (/^;/.test(trimmed)) return;

      if (section === 'script info') {
        const pair = /^([^:]+):\s*(.*)$/.exec(trimmed);
        if (!pair) return;
        const key = pair[1].trim().toLowerCase();
        const value = pair[2].trim();
        if (key === 'playresx') scriptInfo.playResX = parseInteger(value, 384);
        if (key === 'playresy') scriptInfo.playResY = parseInteger(value, 288);
        if (key === 'wrapstyle') scriptInfo.wrapStyle = parseInteger(value, 0);
        if (key === 'scaledborderandshadow') {
          scriptInfo.scaledBorderAndShadow = !/^no$/i.test(value);
        }
        return;
      }

      if (section === 'v4+ styles' || section === 'v4 styles') {
        if (/^format\s*:/i.test(trimmed)) {
          styleFormat = fieldMap(trimmed);
          return;
        }
        if (/^style\s*:/i.test(trimmed)) {
          if (!styleFormat.length) {
            warnings.push({
              line: lineNumber,
              message: '样式缺少 Format 行，已使用默认字段。'
            });
            styleFormat = [
              'name', 'fontname', 'fontsize', 'primarycolour',
              'secondarycolour', 'outlinecolour', 'backcolour', 'bold',
              'italic', 'underline', 'strikeout', 'scalex', 'scaley',
              'spacing', 'angle', 'borderstyle', 'outline', 'shadow',
              'alignment', 'marginl', 'marginr', 'marginv', 'encoding'
            ];
          }
          const split = splitFields(trimmed.replace(/^Style\s*:\s*/i, ''));
          const style = parseStyle(
            [split.first].concat(split.fields),
            styleFormat,
            warnings,
            lineNumber
          );
          styles[style.name] = style;
        }
        return;
      }

      if (section === 'events') {
        if (/^format\s*:/i.test(trimmed)) {
          eventFormat = fieldMap(trimmed);
          return;
        }
        if (/^dialogue\s*:/i.test(trimmed)) {
          if (!eventFormat.length) {
            eventFormat = [
              'layer', 'start', 'end', 'style', 'name', 'marginl',
              'marginr', 'marginv', 'effect', 'text'
            ];
          }
          const rest = trimmed.replace(/^Dialogue\s*:\s*/i, '');
          const parts = rest.split(',');
          const textIndex = eventFormat.indexOf('text');
          const fieldCount = textIndex >= 0 ? textIndex + 1 : eventFormat.length;
          const fields = parts.slice(0, Math.max(0, fieldCount - 1));
          const text = parts.slice(Math.max(0, fieldCount - 1)).join(',');
          fields.push(text);
          const cue = parseDialogue(
            fields,
            eventFormat,
            styles,
            lineNumber,
            warnings
          );
          if (cue) cues.push(cue);
        }
      }
    });

    if (!cues.length) {
      throw new SubtitleError(
        'EMPTY_SUBTITLE',
        'ASS/SSA 文件没有可显示的对白。'
      );
    }
    cues.sort(function (a, b) {
      return a.startMs - b.startMs || a.layer - b.layer;
    });
    if (!styles.Default) styles.Default = Object.assign({}, DEFAULT_STYLE);
    return {
      info: scriptInfo,
      styles,
      cues,
      warnings
    };
  }

  return {
    DEFAULT_STYLE,
    parse,
    parseTime
  };
});
