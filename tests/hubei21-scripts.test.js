const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const autolearn = fs.readFileSync(
  path.join(__dirname, '..', 'hubei21-autolearn.user.js'),
  'utf8'
);
const exam = fs.readFileSync(
  path.join(__dirname, '..', 'hubei21-exam.user.js'),
  'utf8'
);
const examDoc = fs.readFileSync(
  path.join(__dirname, '..', 'hubei21-exam.md'),
  'utf8'
);

test('hubei21 userscripts expose raw install and update URLs', () => {
  assert.match(
    autolearn,
    /@downloadURL\s+https:\/\/raw\.githubusercontent\.com\/hahapkpk\/tools\/main\/hubei21-autolearn\.user\.js/
  );
  assert.match(
    autolearn,
    /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/hahapkpk\/tools\/main\/hubei21-autolearn\.user\.js/
  );
  assert.match(
    exam,
    /@downloadURL\s+https:\/\/raw\.githubusercontent\.com\/hahapkpk\/tools\/main\/hubei21-exam\.user\.js/
  );
  assert.match(
    exam,
    /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/hahapkpk\/tools\/main\/hubei21-exam\.user\.js/
  );
});

test('exam config dialog assigns saved values through DOM properties', () => {
  assert.match(exam, /function setInputValue\(/);
  assert.match(exam, /setInputValue\('cfg-base', config\.apiBase\)/);
  assert.match(exam, /setInputValue\('cfg-key', config\.apiKey\)/);
  assert.doesNotMatch(exam, /id="cfg-base" value="\$\{config\.apiBase\}"/);
  assert.doesNotMatch(exam, /id="cfg-key" type="password" value="\$\{config\.apiKey\}"/);
});

test('exam answer parsing normalizes and rejects invalid AI answers', () => {
  assert.match(exam, /function normalizeAnswer\(/);
  assert.match(exam, /normalizeAnswer\(a\.answer\)/);
  assert.match(exam, /throw new Error\(`第\$\{a\.num\}题答案格式异常/);
  assert.doesNotMatch(exam, /return \{ A: 1, B: 2, C: 3, D: 4, E: 5, F: 6 \}\[letter\.toUpperCase\(\)\] \|\| 1;/);
});

test('exam submit flow clicks common confirmation buttons after submit', () => {
  assert.match(exam, /function clickSubmitConfirm\(/);
  assert.match(exam, /clickSubmitConfirm\(\)/);
  assert.match(exam, /确认交卷|确定|确认|提交/);
});

test('autolearn stops a lesson when progress reporting fails', () => {
  assert.match(autolearn, /throw new Error\(`学习进度上报失败/);
  assert.match(autolearn, /const duration = getLessonDuration\(lesson\)/);
  assert.match(autolearn, /function getLessonDuration\(/);
});

test('exam documentation links to existing autolearn script', () => {
  assert.match(examDoc, /\[hubei21-autolearn\.user\.js\]\(hubei21-autolearn\.user\.js\)/);
});
