const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('X transcription controls have their own secondary section', () => {
  assert.match(source, /makeSettingsSection\('X 视频转写'/);
});
