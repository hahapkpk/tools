const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const youtube = fs.readFileSync(path.join(root, 'youtube-auto-zh-hans-captions.user.js'), 'utf8');

test('YouTube script no longer contains X page support', () => {
  assert.doesNotMatch(youtube, /@match\s+https:\/\/x\.com/);
  assert.doesNotMatch(youtube, /@match\s+https:\/\/twitter\.com/);
  assert.doesNotMatch(youtube, /function isXPage\(/);
  assert.doesNotMatch(youtube, /function transcribeCurrentXVideo\(/);
  assert.doesNotMatch(youtube, /videoComponent/);
  assert.doesNotMatch(youtube, /OPENAI_TRANSCRIPTION/);
  assert.doesNotMatch(youtube, /xCloudApiBase/);
});

test('standalone X script owns X captions and transcription', () => {
  const xScript = fs.readFileSync(path.join(root, 'x-video-auto-zh-hans-captions.user.js'), 'utf8');
  assert.match(xScript, /@match\s+https:\/\/x\.com\/\*/);
  assert.match(xScript, /@match\s+https:\/\/twitter\.com\/\*/);
  assert.doesNotMatch(xScript, /@match\s+https:\/\/www\.youtube\.com/);
  assert.doesNotMatch(xScript, /YouTube|youtube\.com/);
  assert.match(xScript, /const SCRIPT_ID = 'codex-x-video-auto-zh-hans-captions'/);
  assert.match(xScript, /function getXVideoEl\(/);
  assert.match(xScript, /function loadXCaptions\(/);
  assert.match(xScript, /function transcribeCurrentXVideo\(/);
  assert.match(xScript, /function transcribeCurrentXVideoCloud\(/);
  assert.match(xScript, /makeSettingsSection\('X 视频转写'/);
  assert.match(xScript, /-x-cloud-settings/);
  assert.doesNotMatch(xScript, /cloudUrl\.style\.width|cloudToken\.style\.width/);
  assert.doesNotMatch(xScript, /YouTube 自动翻译（备用/);
});
