const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scriptPath = path.join(__dirname, '..', 'twitter-x-translator-lite.user.js');
const script = fs.readFileSync(scriptPath, 'utf8');

function extractFunction(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);

  const bodyStart = script.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < script.length; index += 1) {
    const char = script[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return script.slice(start, index + 1);
    }
  }

  throw new Error(`Could not extract ${name}`);
}

const context = {};
vm.createContext(context);
vm.runInContext(`${extractFunction('shouldTranslateToChinese')}; this.shouldTranslateToChinese = shouldTranslateToChinese;`, context);

test('does not translate Simplified Chinese mixed with English product names', () => {
  const text = [
    '通过Claude 读取Google drive数据',
    '推送到github',
    'cloudflare自动构建发布',
    '我终于有了自己的dashboard了'
  ].join('\n');

  assert.equal(context.shouldTranslateToChinese(text, 'twitter'), false);
});

test('translates foreign language text to Simplified Chinese', () => {
  assert.equal(context.shouldTranslateToChinese('Read Google Drive data via Claude and push to GitHub', 'twitter'), true);
});

test('does not translate unsupported platforms', () => {
  assert.equal(context.shouldTranslateToChinese('Read Google Drive data via Claude', 'unknown'), false);
});
