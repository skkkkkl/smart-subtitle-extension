'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const SettingsModel = require('../storage/settings-model.js');

test('default settings are local appearance values only', () => {
  const settings = SettingsModel.createDefaultSettings();
  assert.deepEqual(Object.keys(settings).sort(), ['appearance', 'version']);
  assert.equal(settings.appearance.fontSize, 24);
  assert.equal(settings.appearance.color, '#ffffff');
  assert.equal(settings.appearance.position, 90);
  assert.equal(settings.appearance.fontWeight, 600);
  assert.equal(settings.appearance.shadowEnabled, true);
  assert.equal(settings.appearance.shadowBlur, 4);
  assert.equal(settings.appearance.overrideAss, false);
});

test('sanitizeAppearance clamps numbers and normalizes colors', () => {
  const appearance = SettingsModel.sanitizeAppearance({
    fontSize: 999,
    color: '#ABC',
    outlineColor: 'not-a-color',
    outlineWidth: -3,
    backgroundColor: '#112233',
    backgroundOpacity: 4,
    position: 20
  });
  assert.equal(appearance.fontSize, 48);
  assert.equal(appearance.color, '#aabbcc');
  assert.equal(appearance.outlineColor, '#000000');
  assert.equal(appearance.outlineWidth, 0);
  assert.equal(appearance.backgroundColor, '#112233');
  assert.equal(appearance.backgroundOpacity, 0.95);
  assert.equal(appearance.position, 60);
  assert.equal(SettingsModel.sanitizeAppearance({ overrideAss: 1 }).overrideAss, true);
  assert.equal(
    SettingsModel.sanitizeAppearance({ outlineWidth: 2.3 }).outlineWidth,
    2.5
  );
  assert.equal(
    SettingsModel.sanitizeAppearance({ fontWeight: 523 }).fontWeight,
    500
  );
  assert.equal(
    SettingsModel.sanitizeAppearance({ shadowBlur: 99 }).shadowBlur,
    16
  );
  assert.equal(
    SettingsModel.sanitizeAppearance({ shadowOffsetX: -99 }).shadowOffsetX,
    -16
  );
  assert.equal(
    SettingsModel.sanitizeAppearance({ shadowOpacity: 3 }).shadowOpacity,
    0.9
  );
});

test('invalid numeric values fall back instead of becoming NaN', () => {
  const appearance = SettingsModel.sanitizeAppearance({
    fontSize: 'wide',
    outlineWidth: null,
    backgroundOpacity: undefined,
    position: ''
  });
  assert.equal(appearance.fontSize, 24);
  assert.equal(appearance.outlineWidth, 2);
  assert.equal(appearance.backgroundOpacity, 0.7);
  assert.equal(appearance.position, 90);
});

test('cue CSS contains sanitized values and a smooth outline', () => {
  const css = SettingsModel.buildCueCss({
    fontSize: 30,
    color: '#ffcc00',
    outlineColor: '#001122',
    outlineWidth: 2,
    backgroundColor: '#000000',
    backgroundOpacity: 0.5,
    position: 88,
    shadowEnabled: false
  });
  assert.match(css, /font-size: 30px !important/);
  assert.match(css, /color: #ffcc00 !important/);
  assert.match(css, /rgba\(0, 0, 0, 0\.50\)/);
  assert.match(css, /text-shadow: 2px 0px 0\.24px #001122/);
  const shadowPart = css.split('text-shadow: ')[1].split(' !important')[0];
  assert.equal(shadowPart.split(', ').length, 24);
  assert.ok(css.includes('video[data-smart-subtitle-cue="true"]::cue'));

  const wideCss = SettingsModel.buildCueCss(
    Object.assign({}, SettingsModel.DEFAULT_APPEARANCE, {
      outlineWidth: 4,
      shadowEnabled: false
    })
  );
  const wideShadows = wideCss.split('text-shadow: ')[1].split(' !important')[0];
  assert.equal(wideShadows.split(', ').length, 32);
});

test('drop shadow is composed behind the outline and uses sanitized rgba', () => {
  const css = SettingsModel.buildCueCss({
    outlineWidth: 2,
    shadowEnabled: true,
    shadowColor: '#112233',
    shadowOpacity: 0.5,
    shadowBlur: 6,
    shadowOffsetX: 3,
    shadowOffsetY: -2
  });
  const shadowPart = css.split('text-shadow: ')[1].split(' !important')[0];
  assert.ok(shadowPart.endsWith('3px -2px 6px rgba(17, 34, 51, 0.50)'));
  assert.ok(shadowPart.includes('2px 0px 0.24px #000000'));
  assert.match(css, /font-weight: 600 !important/);
});

test('cue CSS can scale fullscreen text, outline and shadow together', () => {
  const css = SettingsModel.buildCueCss({
    fontSize: 24,
    outlineWidth: 2,
    outlineColor: '#001122',
    shadowEnabled: true,
    shadowColor: '#112233',
    shadowOpacity: 0.5,
    shadowBlur: 6,
    shadowOffsetX: 3,
    shadowOffsetY: -2
  }, { fontScale: 1.5 });
  const shadowPart = css.split('text-shadow: ')[1].split(' !important')[0];

  assert.match(css, /font-size: 36px !important/);
  assert.ok(shadowPart.includes('3px 0px 0.36px #001122'));
  assert.ok(shadowPart.endsWith('4.5px -3px 9px rgba(17, 34, 51, 0.50)'));
});

test('outline width supports half-pixel values', () => {
  const css = SettingsModel.buildCueCss({
    outlineWidth: 0.5,
    outlineColor: '#123456',
    shadowEnabled: false
  });
  assert.match(css, /text-shadow: 0\.5px 0px 0\.12px #123456/);
  assert.equal(
    SettingsModel.buildCueCss({
      outlineWidth: 0,
      shadowEnabled: false
    }).includes('text-shadow: none'),
    true
  );
});

test('line position is added only when the cue has no line setting', () => {
  assert.equal(
    SettingsModel.addCueLineSetting('align:center', 90),
    'align:center line:90%'
  );
  assert.equal(
    SettingsModel.addCueLineSetting('align:start line:75%', 90),
    'align:start line:75%'
  );
  assert.equal(SettingsModel.addCueLineSetting('', 88), 'line:88%');
  assert.equal(SettingsModel.addCueLineSetting('align:end', 'bad'), 'align:end');
});

test('settings comparison and rgba conversion are deterministic', () => {
  const a = SettingsModel.createDefaultSettings();
  const b = SettingsModel.sanitizeSettings({
    appearance: Object.assign({}, a.appearance, { fontSize: '24' })
  });
  assert.equal(SettingsModel.sameSettings(a, b), true);
  assert.equal(SettingsModel.hexToRgba('#ffffff', 0.7), 'rgba(255, 255, 255, 0.70)');
});
