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
const autolearnV2 = fs.readFileSync(
  path.join(__dirname, '..', 'hubei21-autolearn-v2.user.js'),
  'utf8'
);
const examV2 = fs.readFileSync(
  path.join(__dirname, '..', 'hubei21-exam-v2.user.js'),
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

test('autolearn stops a lesson when progress reporting fails', () => {
  assert.match(autolearn, /throw new Error\(`学习进度上报失败/);
  assert.match(autolearn, /const duration = getLessonDuration\(lesson\)/);
  assert.match(autolearn, /function getLessonDuration\(/);
});

test('exam documentation links to existing autolearn script', () => {
  assert.match(examDoc, /\[hubei21-autolearn\.user\.js\]\(hubei21-autolearn\.user\.js\)/);
});

// ---------- v2 独立脚本 ----------
// v2 是另建的新脚本，不能顶替旧版的更新地址，否则已安装的旧版会被静默升级
test('v2 scripts are standalone installs, not auto-updates of the old ones', () => {
  assert.match(autolearnV2, /@name\s+.*\(v2\)/);
  assert.match(examV2, /@name\s+.*\(v2\)/);
  assert.match(
    autolearnV2,
    /@downloadURL\s+https:\/\/raw\.githubusercontent\.com\/hahapkpk\/tools\/main\/hubei21-autolearn-v2\.user\.js/
  );
  assert.match(
    autolearnV2,
    /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/hahapkpk\/tools\/main\/hubei21-autolearn-v2\.user\.js/
  );
  assert.match(
    examV2,
    /@downloadURL\s+https:\/\/raw\.githubusercontent\.com\/hahapkpk\/tools\/main\/hubei21-exam-v2\.user\.js/
  );
  assert.match(
    examV2,
    /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/hahapkpk\/tools\/main\/hubei21-exam-v2\.user\.js/
  );
  // 旧版仍指向自己的地址，保持原样
  assert.match(
    autolearn,
    /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/hahapkpk\/tools\/main\/hubei21-autolearn\.user\.js/
  );
  assert.match(
    exam,
    /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/hahapkpk\/tools\/main\/hubei21-exam\.user\.js/
  );
});

test('autolearn v2 isolates a failed lesson instead of aborting the run', () => {
  assert.match(autolearnV2, /class ApiError extends Error/);
  assert.match(autolearnV2, /throw new ApiError\(String\(msg\), \{ retryable \}\)/);
  assert.match(autolearnV2, /run\.failures\.push\(/);
  assert.match(autolearnV2, /if \(err instanceof StopError \|\| err instanceof FatalError\) throw err;/);
});

test('autolearn v2 keeps the study API wire format stable', () => {
  assert.match(autolearnV2, /const ratioText = ratio\.toFixed\(2\)/);
  assert.match(autolearnV2, /video_detail_id: lesson\.detailId/);
  assert.match(
    autolearnV2,
    /water_plan_id: ctx\.courseId,\s*water_plan_detail_id: lesson\.detailId,\s*ratio: ratioText,\s*time,/
  );
  // 已学时长不能当视频长度
  assert.doesNotMatch(autolearnV2, /merged\.time,/);
  assert.doesNotMatch(autolearnV2, /merged\.study_time,/);
});

test('autolearn v2 paginates water lessons and blocks concurrent runs', () => {
  assert.match(autolearnV2, /for \(let page = 1; page <= CONFIG\.maxPages; page\+\+\)/);
  assert.match(autolearnV2, /if \(activeRun\) return;/);
  assert.match(autolearnV2, /new AbortController\(\)/);
});

test('exam v2 sends option letters to the AI and validates answers', () => {
  // 选项必须带 A./B./C. 前缀，否则 AI 只能靠位置猜字母
  assert.match(examV2, /String\.fromCharCode\(65 \+ index\)/);
  assert.match(examV2, /function resolveJudgeAnswer\(/);
  assert.match(examV2, /function prepareAnswers\(/);
  assert.match(examV2, /function chunk\(/);
  assert.match(examV2, /requireAllAnswered/);
  // 交卷确认不能点到取消/关闭
  assert.match(examV2, /取消\|关闭\|返回\|放弃/);
  assert.doesNotMatch(examV2, /return \{ A: 1, B: 2, C: 3, D: 4, E: 5, F: 6 \}\[letter\.toUpperCase\(\)\] \|\| 1;/);
});

test('exam v2 keeps the same config surface as 1.0.2', () => {
  assert.match(examV2, /apiBase: 'https:\/\/api\.deepseek\.com'/);
  assert.match(examV2, /model: 'deepseek-v4-pro'/);
  assert.match(examV2, /id="cfg-provider"/);
  assert.match(examV2, /DeepSeek 官方/);
  assert.match(examV2, /function applyProviderPreset\(/);
  assert.match(examV2, /setInputValue\('cfg-base', config\.apiBase\)/);
  assert.match(examV2, /setInputValue\('cfg-key', config\.apiKey\)/);
  assert.match(examV2, /setInputValue\('cfg-model', 'deepseek-v4-pro'\)/);
  assert.doesNotMatch(examV2, /id="cfg-base" value="\$\{config\.apiBase\}"/);
});

test('exam documentation lists the v2 scripts', () => {
  assert.match(examDoc, /hubei21-autolearn-v2\.user\.js/);
  assert.match(examDoc, /hubei21-exam-v2\.user\.js/);
});
