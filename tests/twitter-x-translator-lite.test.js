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

function createMockElement({ tagName = 'div', attrs = {}, text = '', children = [] } = {}) {
  const element = {
    tagName: tagName.toUpperCase(),
    nodeType: 1,
    attrs,
    innerText: text,
    textContent: text,
    parent: null,
    parentElement: null,
    children: [],
    contains(node) {
      if (node === element) return true;
      return element.children.some(child => child.contains(node));
    },
    matches(selector) {
      if (selector === 'article') return element.tagName === 'ARTICLE';
      if (selector === 'div[data-testid="tweetText"]') return element.tagName === 'DIV' && attrs['data-testid'] === 'tweetText';
      if (selector === 'div[lang][dir="auto"]') return element.tagName === 'DIV' && Boolean(attrs.lang) && attrs.dir === 'auto';
      if (selector === 'span[lang][dir="auto"]') return element.tagName === 'SPAN' && Boolean(attrs.lang) && attrs.dir === 'auto';
      if (selector === 'div[dir="auto"][lang]') return element.tagName === 'DIV' && attrs.dir === 'auto' && Boolean(attrs.lang);
      if (selector === 'span[dir="auto"][lang]') return element.tagName === 'SPAN' && attrs.dir === 'auto' && Boolean(attrs.lang);
      return false;
    },
    querySelectorAll(selector) {
      const results = [];
      const visit = (node) => {
        node.children.forEach(child => {
          if (child.matches(selector)) results.push(child);
          visit(child);
        });
      };
      visit(element);
      return results;
    },
    closest(selector) {
      let node = element;
      while (node) {
        if (selector === '.ling-trans-box' && node.attrs.class === 'ling-trans-box') return node;
        if (selector === '[data-testid="User-Name"]' && node.attrs['data-testid'] === 'User-Name') return node;
        if (selector === 'time' && node.tagName === 'TIME') return node;
        if (selector === 'article' && node.tagName === 'ARTICLE') return node;
        node = node.parent;
      }
      return null;
    }
  };

  element.children = children;
  element.children.forEach(child => {
    child.parent = element;
    child.parentElement = element;
  });
  return element;
}

const context = {
  setTimeout,
  clearTimeout,
  Promise,
  Map,
  JSON,
  Boolean
};
vm.createContext(context);
vm.runInContext(`
${extractFunction('shouldTranslateToChinese')}
${extractFunction('createTranslationCoordinator')}
${extractFunction('collectMatches')}
${extractFunction('isInsideExistingTranslation')}
${extractFunction('getTwitterScanRoot')}
${extractFunction('findTwitterTextNodes')}
this.shouldTranslateToChinese = shouldTranslateToChinese;
this.createTranslationCoordinator = createTranslationCoordinator;
this.getTwitterScanRoot = getTwitterScanRoot;
this.findTwitterTextNodes = findTwitterTextNodes;
`, context);

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

test('does not translate url-only or handle-only content', () => {
  assert.equal(context.shouldTranslateToChinese('https://t.co/abc123 @imwsl90 #AI', 'twitter'), false);
});

test('translates Japanese and Korean text to Simplified Chinese', () => {
  assert.equal(context.shouldTranslateToChinese('これは新しいダッシュボードです', 'twitter'), true);
  assert.equal(context.shouldTranslateToChinese('이것은 새로운 대시보드입니다', 'twitter'), true);
});

test('does not translate short noise with only punctuation and emoji', () => {
  assert.equal(context.shouldTranslateToChinese('!!! 🚀✨', 'twitter'), false);
});

test('finds Twitter comment text even without tweetText test id', () => {
  const article = createMockElement({
    tagName: 'article',
    children: [
      createMockElement({
        tagName: 'div',
        attrs: { 'data-testid': 'User-Name' },
        text: 'Steve Brown @_SteveBrown · 6小时'
      }),
      createMockElement({
        tagName: 'div',
        attrs: { lang: 'en', dir: 'auto' },
        text: 'So bad ass. With tabs I could see not opening chrome again'
      })
    ]
  });

  const matches = context.findTwitterTextNodes(article);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].innerText, 'So bad ass. With tabs I could see not opening chrome again');
});

test('uses nearest article as scan root for nested Twitter text nodes', () => {
  const textNode = createMockElement({
    tagName: 'div',
    attrs: { lang: 'en', dir: 'auto' },
    text: 'With all new plugins and skills I suggest you all copy the post into Code'
  });
  const wrapper = createMockElement({
    tagName: 'div',
    children: [textNode]
  });
  const article = createMockElement({
    tagName: 'article',
    children: [wrapper]
  });

  assert.equal(context.getTwitterScanRoot(textNode), article);
});

test('deduplicates in-flight translation requests and reuses cached results', async () => {
  let calls = 0;
  let resolver;
  const coordinator = context.createTranslationCoordinator({
    loadCache: () => [],
    saveCache: () => {},
    maxEntries: 10,
    makeCacheKey: (text, cfg) => `${cfg.translator}:${text}`,
    translate: (text) => {
      calls += 1;
      return new Promise((resolve) => {
        resolver = () => resolve(`zh:${text}`);
      });
    }
  });

  const cfg = { translator: 'google' };
  const pendingA = coordinator('Hello world', cfg);
  const pendingB = coordinator('Hello world', cfg);

  assert.equal(calls, 1);
  assert.equal(pendingA, pendingB);

  resolver();

  const resultA = await pendingA;
  const resultB = await pendingB;
  assert.equal(resultA, 'zh:Hello world');
  assert.equal(resultB, 'zh:Hello world');

  const cached = await coordinator('Hello world', cfg);
  assert.equal(calls, 1);
  assert.equal(cached, 'zh:Hello world');
});
