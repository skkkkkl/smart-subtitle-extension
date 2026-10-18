'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SettingsStore,
  createMemoryArea,
  SETTINGS_KEY
} = require('../storage/settings-store.js');
const SettingsModel = require('../storage/settings-model.js');

function fakeOnChanged() {
  const listeners = [];
  return {
    addListener(fn) {
      listeners.push(fn);
    },
    removeListener(fn) {
      const index = listeners.indexOf(fn);
      if (index >= 0) listeners.splice(index, 1);
    },
    emit(changes, areaName) {
      for (const fn of listeners.slice()) fn(changes, areaName || 'local');
    },
    count() {
      return listeners.length;
    }
  };
}

test('load returns defaults for missing or malformed values', async () => {
  const area = createMemoryArea();
  const store = new SettingsStore({ area });
  const defaults = await store.load();
  assert.equal(defaults.appearance.fontSize, 24);

  await area.set({ [SETTINGS_KEY]: { appearance: { fontSize: 999 } } });
  const loaded = await store.load();
  assert.equal(loaded.appearance.fontSize, 48);
  assert.equal(loaded.appearance.color, '#ffffff');
});

test('save and reset persist only sanitized settings', async () => {
  const area = createMemoryArea();
  const store = new SettingsStore({ area });
  await store.save({
    appearance: {
      fontSize: 30,
      color: '#ABCDEF',
      position: 999,
      extra: 'ignored'
    }
  });
  const raw = await area.get(SETTINGS_KEY);
  assert.equal(raw[SETTINGS_KEY].appearance.fontSize, 30);
  assert.equal(raw[SETTINGS_KEY].appearance.color, '#abcdef');
  assert.equal(raw[SETTINGS_KEY].appearance.position, 96);
  assert.equal(raw[SETTINGS_KEY].appearance.extra, undefined);

  const reset = await store.reset();
  assert.equal(reset.appearance.fontSize, 24);
  assert.deepEqual(await area.get(SETTINGS_KEY), {});
});

test('clearAll removes smartSubtitle keys but not unrelated extension data', async () => {
  const area = createMemoryArea();
  const store = new SettingsStore({ area });
  await area.set({
    'smartSubtitle.settings.v1': { appearance: {} },
    'smartSubtitle.futureCache': { a: 1 },
    'other.data': { keep: true }
  });
  const removed = await store.clearAll();
  assert.deepEqual(removed.sort(), [
    'smartSubtitle.futureCache',
    'smartSubtitle.settings.v1'
  ]);
  assert.deepEqual(await area.get('other.data'), { 'other.data': { keep: true } });
});

test('subscribe receives sanitized settings and can be removed', () => {
  const onChanged = fakeOnChanged();
  const store = new SettingsStore({
    area: createMemoryArea(),
    onChanged
  });
  const values = [];
  const unsubscribe = store.subscribe((next) => values.push(next));
  assert.equal(onChanged.count(), 1);

  onChanged.emit({
    [SETTINGS_KEY]: {
      newValue: { appearance: { fontSize: 40, position: 10 } }
    }
  });
  assert.equal(values.length, 1);
  assert.equal(values[0].appearance.fontSize, 40);
  assert.equal(values[0].appearance.position, 60);

  onChanged.emit({ 'unrelated.key': { newValue: 1 } });
  assert.equal(values.length, 1);

  unsubscribe();
  assert.equal(onChanged.count(), 0);
});

test('memory fallback works when chrome.storage is unavailable', async () => {
  const store = new SettingsStore();
  assert.equal(store.persistent, false);
  const saved = await store.save(SettingsModel.createDefaultSettings());
  assert.equal(saved.appearance.position, 90);
  assert.equal((await store.load()).appearance.position, 90);
});
