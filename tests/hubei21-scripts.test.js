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

test('exam config defaults to DeepSeek official API and exposes provider preset', () => {
  assert.match(exam, /apiBase: 'https:\/\/api\.deepseek\.com'/);
  assert.match(exam, /model: 'deepseek-v4-pro'/);
  assert.match(exam, /id="cfg-provider"/);
  assert.match(exam, /DeepSeek 官方/);
  assert.match(exam, /function applyProviderPreset\(/);
  assert.match(exam, /setInputValue\('cfg-base', 'https:\/\/api\.deepseek\.com'\)/);
  assert.match(exam, /setInputValue\('cfg-model', 'deepseek-v4-pro'\)/);
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

test('autolearn surfaces progress-reporting failures instead of swallowing them', () => {
  // 上报失败必须抛错，由单节 try/catch 记进失败清单（v2 起不再中断整轮）
  assert.match(autolearn, /class ApiError extends Error/);
  assert.match(autolearn, /throw new ApiError\(String\(msg\), \{ retryable \}\)/);
  assert.match(autolearn, /run\.failures\.push\(/);
  assert.match(autolearn, /if \(err instanceof StopError \|\| err instanceof FatalError\) throw err;/);
});

test('autolearn resolves lesson duration from video-length fields only', () => {
  assert.match(autolearn, /function pickDurationSec\(/);
  assert.match(autolearn, /source\.time,/);
  // study_detail 里的 time / study_time 是"已学时长"，不能当视频长度，否则上报时长减半
  assert.doesNotMatch(autolearn, /merged\.time,/);
  assert.doesNotMatch(autolearn, /merged\.study_time,/);
});

test('autolearn keeps the study API wire format stable', () => {
  assert.match(autolearn, /const ratioText = ratio\.toFixed\(2\)/);
  assert.match(autolearn, /video_id: ctx\.courseId/);
  assert.match(autolearn, /video_detail_id: lesson\.detailId/);
  // 水课程 body 只有 4 个字段，不带 year
  assert.match(
    autolearn,
    /water_plan_id: ctx\.courseId,\s*water_plan_detail_id: lesson\.detailId,\s*ratio: ratioText,\s*time,/
  );
});

test('autolearn paginates water lessons and blocks concurrent runs', () => {
  assert.match(autolearn, /for \(let page = 1; page <= CONFIG\.maxPages; page\+\+\)/);
  assert.match(autolearn, /if \(activeRun\) return;/);
  assert.match(autolearn, /new AbortController\(\)/);
});

test('exam documentation links to existing autolearn script', () => {
  assert.match(examDoc, /\[hubei21-autolearn\.user\.js\]\(hubei21-autolearn\.user\.js\)/);
});
