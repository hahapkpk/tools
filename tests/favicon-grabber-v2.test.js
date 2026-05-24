const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '..', 'favicon-grabber-v2.html');

class StubElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.value = '';
    this.textContent = '';
    this.className = '';
    this._innerHTML = '';
    this.classList = {
      add: (...classes) => this.addClasses(classes),
      remove: (...classes) => this.removeClasses(classes),
      toggle: (className, force) => {
        const shouldAdd = force === undefined
          ? !this.className.split(/\s+/).includes(className)
          : force;
        if (shouldAdd) this.addClasses([className]);
        else this.removeClasses([className]);
      }
    };
  }

  addClasses(classes) {
    const names = new Set(this.className.split(/\s+/).filter(Boolean));
    classes.forEach(name => names.add(name));
    this.className = [...names].join(' ');
  }

  removeClasses(classes) {
    const removed = new Set(classes);
    this.className = this.className
      .split(/\s+/)
      .filter(name => name && !removed.has(name))
      .join(' ');
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    this.children.push(...children);
  }

  addEventListener(name, handler) {
    this.listeners[name] = handler;
  }

  click() {}

  remove() {}

  set innerHTML(value) {
    this._innerHTML = value;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

function loadPage(overrides = {}) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const source = scripts.at(-1)[1];
  const elements = Object.fromEntries(
    ['urlInput', 'results', 'ddgLink', 'namePanel', 'siteNameInput', 'copyNameBtn', 'titleStatus', 'nameCandidates', 'exportMode']
      .map(id => [id, new StubElement()])
  );
  elements.exportMode.value = 'original';
  const document = {
    activeElement: null,
    body: new StubElement('body'),
    createElement: tag => new StubElement(tag),
    getElementById: id => elements[id],
    addEventListener() {}
  };
  const fetch = overrides.fetch || (async url => {
    if (String(url).startsWith('https://r.jina.ai/')) {
      return { ok: true, text: async () => 'Title: GitHub: Let us build from here | Developer Platform' };
    }
    return { ok: false, json: async () => ({}) };
  });
  const clipboardWrites = [];
  const context = {
    document,
    navigator: {
      clipboard: {
        readText: async () => 'https://github.com/openai',
        writeText: async text => clipboardWrites.push(text)
      }
    },
    fetch,
    URL,
    AbortSignal,
    setTimeout: fn => fn(),
    clearTimeout() {},
    console
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: htmlPath });
  return { context, elements, clipboardWrites };
}

test('根据标题和域名生成简洁、安全的网站名称', () => {
  const { context } = loadPage();
  assert.equal(context.deriveDomainName('www.github.com'), 'GitHub');
  assert.equal(
    context.normalizeSiteName('GitHub: Let us build from here | Developer Platform', 'github.com'),
    'GitHub'
  );
  assert.equal(
    context.normalizeSiteName('GitHub · Change is constant. GitHub keeps you ahead.', 'github.com'),
    'GitHub'
  );
  assert.equal(context.normalizeSiteName('微信读书 / 精选阅读：发现好内容?', 'weread.qq.com'), '微信读书');
  assert.equal(context.normalizeSiteName('RED | 小红书 - 你的生活指南', 'xiaohongshu.com'), '小红书');
  assert.equal(context.normalizeSiteName('Appark | 全球应用排行 | App Store 数据', 'apparark.ai'), 'Appark');
  assert.ok(context.normalizeSiteName('ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890LONGNAME', 'example.com').length <= 40);
});

test('下载文件名使用网站名称前缀并避免重复扩展名', () => {
  const { context } = loadPage();
  assert.equal(context.buildDownloadFilename('GitHub', 'Favicon.ico', 'ico'), 'GitHub-Favicon.ico');
  assert.equal(context.buildDownloadFilename('微信读书', 'Apple Touch Icon', 'png'), '微信读书-Apple-Touch-Icon.png');
});

test('点击剪贴板读取后填入网址并触发现有图标流程', async () => {
  const { context, elements } = loadPage();
  await context.readClipboardAndGrab();
  assert.equal(elements.urlInput.value, 'https://github.com/openai');
  assert.equal(elements.siteNameInput.value, 'GitHub');
  assert.equal(elements.namePanel.className.includes('hidden'), false);
  assert.ok(elements.results.children.length > 0);
});

test('网页标题读取失败时仍使用域名名称保存', async () => {
  const { context, elements } = loadPage({
    fetch: async () => ({ ok: false, json: async () => ({}) })
  });
  elements.urlInput.value = 'https://github.com';
  await context.grab();
  assert.equal(elements.siteNameInput.value, 'GitHub');
  assert.match(elements.titleStatus.textContent, /使用域名名称/);
  assert.ok(elements.results.children.length > 0);
});

test('复制名称按钮复制当前网站名称而非下载文件名', async () => {
  const { context, elements, clipboardWrites } = loadPage();
  elements.urlInput.value = 'https://xiaohongshu.com';
  elements.siteNameInput.value = '小红书';
  await context.copySiteName();
  assert.deepEqual(clipboardWrites, ['小红书']);
});

test('图标推荐排序遵循格式、真实尺寸与直链优先级', () => {
  const { context } = loadPage();
  const metas = [
    { format: 'svg', area: Infinity, isDirect: true },
    { format: 'ico', area: 64 * 64, isDirect: false },
    { format: 'png', area: 64 * 64, isDirect: false },
    { format: 'png', area: 256 * 256, isDirect: true },
    { format: 'jpg', area: 512 * 512, isDirect: true }
  ].sort(context.compareIconMeta);
  assert.deepEqual(metas.map(meta => meta.format), ['png', 'png', 'ico', 'svg', 'jpg']);
  assert.equal(metas[0].area, 256 * 256);
  assert.equal(metas[0].isDirect, true);
});

test('名称候选最多三个且点击候选会更新当前名称', () => {
  const { context, elements } = loadPage();
  assert.deepEqual(
    Array.from(context.buildNameCandidates('RED | 小红书 - 你的生活指南', 'xiaohongshu.com')),
    ['小红书', 'RED', 'Xiaohongshu']
  );
  context.selectSiteName('RED');
  assert.equal(elements.siteNameInput.value, 'RED');
});

test('重复图标只标记不移除且卡片可复制当前导出文件名', async () => {
  const { context, elements, clipboardWrites } = loadPage();
  const metas = [
    { fingerprint: 'same-image', duplicate: false },
    { fingerprint: 'same-image', duplicate: false }
  ];
  const marked = context.markDuplicateMetas(metas);
  assert.equal(marked.length, 2);
  assert.equal(marked[0].duplicate, false);
  assert.equal(marked[1].duplicate, true);
  elements.urlInput.value = 'https://xiaohongshu.com';
  elements.siteNameInput.value = '小红书';
  elements.exportMode.value = 'png';
  await context.copyCardFilename({ label: 'Favicon.ico', url: 'https://x/favicon.ico' });
  assert.deepEqual(clipboardWrites, ['小红书-Favicon.png']);
});

test('卡片尺寸显示实际信息且 PNG 转换失败时回退原格式', async () => {
  const { context, elements } = loadPage({
    fetch: async () => ({ ok: true, blob: async () => ({ type: 'image/x-icon' }) })
  });
  assert.equal(context.describeActualSize('svg', 0, 0), '矢量 SVG');
  assert.equal(context.describeActualSize('png', 256, 128), '实际 256×128');
  elements.urlInput.value = 'https://github.com';
  elements.siteNameInput.value = 'GitHub';
  elements.exportMode.value = 'png';
  context.convertImageToPng = async () => { throw new Error('blocked'); };
  URL.createObjectURL = () => 'blob:download';
  await context.downloadIcon({ label: 'Favicon.ico', url: 'https://github.com/favicon.ico' });
  assert.match(elements.titleStatus.textContent, /按原格式保存/);
});
