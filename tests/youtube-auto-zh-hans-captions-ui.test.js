const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'youtube-auto-zh-hans-captions.user.js'),
  'utf8'
);

test('settings panel groups secondary controls into collapsible sections', () => {
  assert.match(source, /function makeSettingsSection\(/);
  assert.match(source, /makeSettingsSection\('字幕显示'/);
  assert.match(source, /makeSettingsSection\('配音服务'/);
  assert.match(source, /makeSettingsSection\('同步与术语'/);
  assert.match(source, /aria-expanded/);
});

test('compact panel prevents horizontal overflow on narrow players', () => {
  assert.match(source, /overflow-x:\s*hidden/);
  assert.match(source, /box-sizing:\s*border-box/);
  assert.match(source, /-settings-section/);
});

test('YouTube settings stay focused on YouTube', () => {
  assert.doesNotMatch(source, /makeSettingsSection\('X 视频转写'/);
});

test('local translator requires a user action only when a model needs downloading', async () => {
  const start = source.indexOf('  async function getLocalTranslator(');
  const end = source.indexOf('  async function prepareLocalTranslationForCurrentVideo(', start);
  let creates = 0;
  const translator = { translate() {} };
  const context = {
    state: { localTranslators: new Map() },
    normalizeTranslatorLanguage: value => value,
    showStatus() {},
    self: { Translator: true },
    Translator: {
      availability: async () => 'downloadable',
      create: () => { creates++; return Promise.resolve(translator); }
    }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  await assert.rejects(context.getLocalTranslator('en', true), /准备本地翻译/);
  assert.equal(creates, 0);
  const pending = context.getLocalTranslator('en', true, true);
  assert.equal(creates, 1, 'create must run before the click handler yields');
  assert.equal(await pending, translator);
});
