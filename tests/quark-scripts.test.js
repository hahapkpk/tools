'use strict';

// 直接从 .user.js 源码里抽出纯函数来测，避免测试副本和线上脚本各写一套而漂移。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function readSource(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function extractFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`未在源码中找到 function ${name}`);
  let depth = 0;
  let started = false;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') {
      depth--;
      if (started && depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`function ${name} 花括号不闭合`);
}

function loadFunction(file, name) {
  const code = extractFunction(readSource(file), name);
  // eslint-disable-next-line no-new-func
  return new Function(`return (${code});`)();
}

const cleanMovieName = loadFunction('quark-save-rename.user.js', 'cleanMovieName');
const classifyTokenResponse = loadFunction('quark-link-precheck.user.js', 'classifyTokenResponse');

test('cleanMovieName 不再把【】里的标签当成片名', () => {
  assert.equal(cleanMovieName('人性本兽 Animals (2026)'), '人性本兽 Animals (2026)');
  assert.equal(cleanMovieName('【高清】人性本兽 Animals (2026)'), '人性本兽 Animals (2026)');
  assert.equal(cleanMovieName('【4K】人性本兽 Animals (2026) 1080p'), '人性本兽 Animals 1080p (2026)');
  assert.equal(cleanMovieName('🔥【首发】人性本兽 Animals (2026)'), '人性本兽 Animals (2026)');
  assert.equal(cleanMovieName('【合集】漫威电影宇宙 22部 1080p'), '漫威电影宇宙 22部 1080p');
});

test('cleanMovieName 不会只留下一个 (年份)', () => {
  for (const raw of ['(2026)', '【🔥】(2026)', '【】', '🎬🔥', '🔥🔥🔥', '   ', '']) {
    assert.equal(cleanMovieName(raw), '', `输入 ${JSON.stringify(raw)} 应返回空串`);
  }
});

test('cleanMovieName 保留方括号开头的正常片名', () => {
  assert.equal(cleanMovieName('[电影] 星际穿越 (2014)'), '星际穿越 (2014)');
});

test('cleanMovieName 剥离非法文件名字符', () => {
  assert.equal(cleanMovieName('片名/副标题:测试?'), '片名 副标题 测试');
});

test('cleanMovieName 输出不超过 100 字符', () => {
  const out = cleanMovieName('长'.repeat(300));
  assert.equal(out.length, 100);
});

test('classifyTokenResponse 以业务码判断成功，不看 message 文案', () => {
  const okBodies = [
    { status: 200, code: 0, message: '', data: { stoken: 'S1', title: '片名' } },
    { status: 200, code: 0, data: { stoken: 'S2', title: '片名' } },
    { status: 200, code: 0, message: 'ok', data: { stoken: 'S3', title: '片名' } },
  ];
  for (const body of okBodies) {
    const r = classifyTokenResponse(body);
    assert.equal(r.status, 'token', JSON.stringify(body));
    assert.ok(r.stoken);
  }
});

test('classifyTokenResponse 区分失效与需提取码', () => {
  assert.equal(
    classifyTokenResponse({ status: 404, code: 41008, message: '分享不存在或已取消', data: null }).status,
    'invalid'
  );
  assert.equal(
    classifyTokenResponse({ status: 400, code: 41010, message: '需要提取码', data: null }).status,
    'passcode'
  );
  assert.equal(
    classifyTokenResponse({ status: 400, code: 41011, message: '提取码错误', data: null }).status,
    'passcode'
  );
});

test('classifyTokenResponse 对空响应不抛错', () => {
  assert.equal(classifyTokenResponse(null).status, 'unknown');
  assert.equal(classifyTokenResponse(undefined).status, 'unknown');
});
