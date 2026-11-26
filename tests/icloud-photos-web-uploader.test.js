const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const api = require('../icloud-photos-web-uploader.user.js');
const source = fs.readFileSync(
  path.join(__dirname, '..', 'icloud-photos-web-uploader.user.js'),
  'utf8'
);

class UploaderElement extends EventTarget {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase();
    this.attrs = new Map();
    this.style = {};
    this.children = [];
    this.files = [];
    const classes = new Set();
    this.classList = {
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name),
    };
  }
  setAttribute(key, value) { this.attrs.set(key, value); }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  hasAttribute(key) { return this.attrs.has(key); }
  closest() { return null; }
  removeChild(node) {
    this.children.splice(this.children.indexOf(node), 1);
    node.parentNode = null;
  }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    this.children.push(node);
    node.parentNode = this;
  }
}

function createUploaderEnvironment() {
  const panelId = 'icloud-web-uploader-panel';
  const view = new UploaderElement('main');
  const nativeInput = Object.assign(new UploaderElement('input'), { type: 'file', multiple: true });
  nativeInput.setAttribute('accept', 'image/*');
  const doc = Object.assign(new EventTarget(), {
    head: new UploaderElement('head'),
    body: new UploaderElement('body'),
    documentElement: new UploaderElement('html'),
    createElement: tag => new UploaderElement(tag),
    getElementById(id) {
      return [...this.head.children, ...this.body.children].find(element => element.id === id) || null;
    },
    querySelector: selector => selector.includes('PhotosRootContent') ? view : null,
    querySelectorAll: selector => selector === 'input[type="file"]' ? [nativeInput] : [],
  });
  const batches = [];
  const timers = new Map();
  const observers = new Set();
  let timerId = 0;
  const win = Object.assign(new EventTarget(), {
    document: doc,
    location: {
      pathname: '/applications/photos3/current/zh-cn/index.html',
      href: 'https://www.icloud.com/applications/photos3/current/zh-cn/index.html',
    },
    DataTransfer: class {
      constructor() {
        this.files = [];
        this.items = { add: file => this.files.push(file) };
      }
    },
    Event,
    AbortController,
    MutationObserver: class {
      targets = new Set();
      constructor(callback) { this.callback = callback; observers.add(this); }
      observe(target) { this.targets.add(target); }
      disconnect() { this.targets.clear(); }
    },
    setTimeout(callback, delay) {
      timers.set(++timerId, { callback, delay });
      return timerId;
    },
    clearTimeout(id) { timers.delete(id); },
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} },
    Image: class {
      set src(url) { if (url) queueMicrotask(() => this.onerror()); }
    },
  });
  doc.defaultView = win;
  nativeInput.ownerDocument = doc;
  nativeInput.addEventListener('change', () => batches.push([...nativeInput.files]));
  function bootstrap(window = win) {
    vm.runInNewContext(source, {
      window, document: window.document, File, Event, AbortController,
      setTimeout: win.setTimeout, clearTimeout: win.clearTimeout,
      console: { debug() {}, warn() {}, log() {} },
    });
  }
  function notify(target) {
    for (const observer of observers) {
      if (observer.targets.has(target)) observer.callback([{ type: 'childList', target }]);
    }
  }
  return {
    doc, win, batches, timers, bootstrap, notify,
    panel: () => doc.getElementById(panelId),
    toast: () => doc.getElementById(panelId + '-toast'),
  };
}

function uploadFixture() {
  return new File(['fixture'], 'photo.jpg', { type: 'image/jpeg' });
}

test('外壳先接管 iframe 后，iframe 自身初始化不会让一次粘贴重复交接', async () => {
  const env = createUploaderEnvironment();
  env.bootstrap({
    document: { body: {}, querySelector: () => null },
    location: { pathname: '/photos/', href: 'https://www.icloud.com/photos/' },
    frames: [env.win],
  });
  env.bootstrap();
  const paste = new Event('paste', { cancelable: true });
  Object.defineProperty(paste, 'clipboardData', {
    value: { items: [{ kind: 'file', getAsFile: uploadFixture }] },
  });
  env.win.dispatchEvent(paste);
  await new Promise(setImmediate);
  assert.equal(env.batches.length, 1);
  assert.equal(env.batches[0].length, 1);
});

test('替换 body 后复用原悬浮球和对应的 resize 监听', () => {
  const env = createUploaderEnvironment();
  let reads = 0;
  env.win.localStorage = { getItem() { reads += 1; return null; } };
  env.bootstrap();
  const originalPanel = env.panel();
  env.doc.body = new UploaderElement('body');
  env.notify(env.doc.documentElement);
  assert.equal(env.panel(), originalPanel);
  assert.ok(env.toast());
  reads = 0;
  env.win.dispatchEvent(new Event('resize'));
  assert.equal(reads, 1);
});

test('混合批次和后一批均保留转码失败文件名，且已提交批次继续刷新', async () => {
  const env = createUploaderEnvironment();
  env.bootstrap();
  const bad = name => new File(['fixture'], name, { type: 'image/heic' });
  const send = env.panel()._handlePasteUpload;
  await Promise.all([send([bad('unreadable.heic'), uploadFixture()]), send([bad('second.heic')])]);
  assert.equal(env.batches.length, 1);
  const result = env.toast().textContent;
  assert.match(result, /已向 iCloud 提交 1 张/);
  assert.match(result, /unreadable\.heic/);
  assert.match(result, /second\.heic/);
  assert.match(result, /尝试软刷新/);
});

test('空或非图片批次保留原同步计时器', async () => {
  const env = createUploaderEnvironment();
  env.bootstrap();
  const send = env.panel()._handlePasteUpload;
  await send([uploadFixture()]);
  const current = Array.from(env.timers.entries()).find(([, item]) => item.delay === 5000);
  assert.ok(current);
  await send([new File(['log'], 'log.txt', { type: 'text/plain' })]);
  assert.ok(env.timers.has(current[0]));
  assert.equal(env.batches.length, 1);
});

test('网格滚动命中外层容器时不遍历其全部缩略图', () => {
  const env = createUploaderEnvironment();
  const container = new UploaderElement('div');
  const stack = [container, env.doc.body, env.doc.documentElement];
  for (const element of stack) {
    element.querySelectorAll = () => assert.fail('滚轮不得枚举整个图库');
  }
  env.doc.elementsFromPoint = () => stack;
  env.bootstrap();
  const wheel = new Event('wheel', { cancelable: true });
  Object.defineProperties(wheel, {
    target: { value: container },
    clientX: { value: 120 },
    clientY: { value: 90 },
    deltaY: { value: 60 },
  });
  env.win.dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented, false);
});

function setupOneUpBlankClick() {
  const handlers = {};
  let backClicks = 0;
  const back = { click: () => { backClicks += 1; }, getAttribute: () => null };
  const oneUp = { querySelector: selector => selector === '.ToolbarBackButton' ? back : null };
  const photo = {
    naturalWidth: 640,
    naturalHeight: 480,
    getBoundingClientRect: () => ({ left: 180, right: 620, top: 90, bottom: 420, width: 440, height: 330 }),
  };
  const viewer = {
    closest: selector => selector === '.OneUp' ? oneUp : null,
    querySelectorAll: () => [photo],
  };
  const stage = { contains: node => node === viewer };
  const background = { closest: selector => selector === '.OneUp-mainViewer' ? stage : null };
  const doc = {
    documentElement: { clientWidth: 800, clientHeight: 500 },
    querySelector: selector => selector === '.OneUpCarouselItem.is-center' ? viewer : null,
    querySelectorAll: () => [],
    addEventListener: (type, handler) => { handlers[type] = handler; },
  };
  api.installOneUpBlankClickExit(doc);

  function send(type, props) {
    const event = {
      isTrusted: true,
      button: 0,
      pointerId: 1,
      detail: 1,
      clientX: 80,
      clientY: 200,
      target: background,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      ...props,
    };
    handlers[type](event);
    return event;
  }
  function click(props) {
    send('pointerdown', { isPrimary: true, ...props });
    return send('click', { isPrimary: false, ...props });
  }
  return { doc, back, send, click, count: () => backClicks };
}

test('Chrome 实际点击事件不是主指针时，单击大图两侧留白仍执行原生返回', () => {
  const env = setupOneUpBlankClick();
  for (const clientX of [80, 720]) {
    const event = env.click({ clientX });
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.stopped, true);
  }
  assert.equal(env.count(), 2);
});

test('即使透明轮播层盖在照片上，单击照片内或边缘也不会退出', () => {
  const env = setupOneUpBlankClick();
  for (const clientX of [180, 400, 620]) {
    assert.equal(env.click({ clientX }).defaultPrevented, false);
  }
  assert.equal(env.count(), 0);
});

test('工具栏、缩略图条和控件仍接收自己的点击', () => {
  const env = setupOneUpBlankClick();
  for (const selector of ['.Toolbar', '.Thumbstrip', '[role="button"]']) {
    const target = { closest: choices => choices.split(', ').includes(selector) ? {} : null };
    assert.equal(env.click({ target }).defaultPrevented, false);
  }
  assert.equal(env.count(), 0);
});

test('从照片拖出、从留白拖动后回到起点、取消触摸都不会退出', () => {
  const env = setupOneUpBlankClick();
  env.send('pointerdown', { clientX: 400 });
  env.send('click');
  env.send('pointerdown');
  env.send('pointermove', { clientX: 120 });
  env.send('click');
  env.send('pointerdown');
  env.send('pointercancel');
  env.send('click');
  assert.equal(env.count(), 0);
});

test('右键、组合键、程序点击和失去当前大图时不拦截', () => {
  const env = setupOneUpBlankClick();
  for (const props of [
    { button: 2 },
    { ctrlKey: true },
    { isTrusted: false },
    { detail: 0 },
    { isPrimary: false },
  ]) {
    assert.equal(env.click(props).defaultPrevented, false);
  }
  env.send('pointerdown');
  env.doc.querySelector = () => null;
  assert.equal(env.send('click').defaultPrevented, false);
  assert.equal(env.count(), 0);
});

function fakeElement(attributes, text) {
  return {
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
    },
    textContent: text || '',
  };
}

function fakeFile(name, type) {
  return { name, type, size: 1024, lastModified: 1 };
}

test('脚本以 UMD 形式导出可在 Node 中直接 require 的 API', () => {
  assert.equal(typeof api.bootstrap, 'function');
  assert.equal(typeof api.uploadViaICloudPage, 'function');
  assert.equal(typeof api.transferFilesToInput, 'function');
  assert.equal(typeof api.isUploadTrigger, 'function');
  assert.equal(typeof api.withTimeout, 'function');
});

test('上传触发器识别上传语义的标签', () => {
  assert.equal(api.isUploadTrigger(fakeElement({ 'aria-label': 'Upload photos' })), true);
  assert.equal(api.isUploadTrigger(fakeElement({ title: '上传照片' })), true);
  assert.equal(api.isUploadTrigger(fakeElement({}, '添加照片')), true);
  assert.equal(api.isUploadTrigger(fakeElement({ 'aria-label': 'Import photos' })), true);
});

test('上传触发器不会把相簿/描述等“添加”按钮误判为上传入口', () => {
  assert.equal(api.isUploadTrigger(fakeElement({}, '添加到相簿')), false);
  assert.equal(api.isUploadTrigger(fakeElement({ 'aria-label': 'Add to album' })), false);
  assert.equal(api.isUploadTrigger(fakeElement({}, '添加描述')), false);
  assert.equal(api.isUploadTrigger(fakeElement({ 'aria-label': 'Add a caption' })), false);
  assert.equal(api.isUploadTrigger(fakeElement({}, '新建共享相簿')), false);
  assert.equal(api.isUploadTrigger(fakeElement({})), false);
});
test('上传触发器排除取消和停止上传操作', () => {
  assert.equal(api.isUploadTrigger(fakeElement({}, '取消上传')), false);
  assert.equal(api.isUploadTrigger(fakeElement({}, '停止上传')), false);
  assert.equal(api.isUploadTrigger(fakeElement({ 'aria-label': 'Cancel upload' })), false);
  assert.equal(api.isUploadTrigger(fakeElement({ title: 'Stop uploading' })), false);
});

test('图片 MIME 与扩展名冲突时优先使用 MIME 判断是否转码', () => {
  assert.equal(api.shouldConvertForICloudWeb(fakeFile('wrong.jpg', 'image/png')), true);
  assert.equal(api.shouldConvertForICloudWeb(fakeFile('wrong.png', 'image/jpeg')), false);
});


test('转换失败只跳过该文件，其余图片继续上传', async () => {
  const good = fakeFile('good.png', 'image/png');
  const bad = fakeFile('bad.heic', 'image/heic');
  const messages = [];
  const status = (message, isError) => messages.push({ message, isError });

  const converter = async (file) => {
    if (file.name === 'bad.heic') throw new Error('no decoder');
    return fakeFile('good.jpg', 'image/jpeg');
  };

  const normalized = await api.normalizeFilesForICloudWebUpload([bad, good], {}, status, converter);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].name, 'good.jpg');

  const failure = messages.find((entry) => entry.message.includes('跳过 1 张'));
  assert.ok(failure, '应报告被跳过的文件');
  assert.match(failure.message, /bad\.heic/);
  assert.match(failure.message, /no decoder/);
  assert.equal(failure.isError, false, '部分失败不应标记为整体错误');
});

test('全部转换失败时报告为错误且返回空列表', async () => {
  const messages = [];
  const status = (message, isError) => messages.push({ message, isError });
  const converter = async () => {
    throw new Error('boom');
  };

  const normalized = await api.normalizeFilesForICloudWebUpload(
    [fakeFile('a.heic', 'image/heic')],
    {},
    status,
    converter
  );

  assert.deepEqual(normalized, []);
  const failure = messages.find((entry) => entry.message.includes('跳过 1 张'));
  assert.ok(failure);
  assert.equal(failure.isError, true);
  assert.match(failure.message, /没有可上传的图片/);
});

test('JPEG 文件不进入转换流程', async () => {
  let converted = 0;
  const status = () => {};
  const converter = async () => {
    converted += 1;
    return fakeFile('x.jpg', 'image/jpeg');
  };

  const normalized = await api.normalizeFilesForICloudWebUpload(
    [fakeFile('already.jpg', 'image/jpeg')],
    {},
    status,
    converter
  );

  assert.equal(converted, 0);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].name, 'already.jpg');
});

test('缺少 status 回调时归一化流程不会抛错', async () => {
  const converter = async () => fakeFile('a.jpg', 'image/jpeg');
  const normalized = await api.normalizeFilesForICloudWebUpload(
    [fakeFile('a.png', 'image/png')],
    {},
    null,
    converter
  );
  assert.equal(normalized.length, 1);
});

test('转换器未返回文件时按失败处理，不把空值放进上传批次', async () => {
  const messages = [];
  const status = (message, isError) => messages.push({ message, isError });
  const converter = async () => undefined;

  const normalized = await api.normalizeFilesForICloudWebUpload(
    [fakeFile('a.png', 'image/png')],
    {},
    status,
    converter
  );

  assert.deepEqual(normalized, []);
  const failure = messages.find((entry) => entry.message.includes('跳过 1 张'));
  assert.ok(failure);
  assert.match(failure.message, /converter returned no file/);
});

test('input.files 赋值被浏览器忽略时 transferFilesToInput 返回 false', () => {
  const files = [fakeFile('a.png', 'image/png')];
  const win = {
    DataTransfer: function DataTransfer() {
      this.items = { add() {} };
      this.files = files;
    },
  };

  let rejected = false;
  const input = {
    files: { length: 0 },
    dispatchEvent() {
      return true;
    },
  };
  Object.defineProperty(input, 'files', {
    get() {
      return { length: 0 };
    },
    set() {
      rejected = true;
    },
  });

  assert.equal(api.transferFilesToInput(input, files, win), false);
  assert.equal(rejected, true, '赋值本身是静默 no-op，必须通过回读发现');
});

test('input.files 赋值生效时 transferFilesToInput 返回 true 并派发事件', () => {
  const files = [fakeFile('a.png', 'image/png'), fakeFile('b.png', 'image/png')];
  const win = {
    DataTransfer: function DataTransfer() {
      this.items = { add() {} };
      this.files = files;
    },
    Event: function Event(type) {
      this.type = type;
    },
  };

  const dispatched = [];
  let stored = null;
  const input = {
    dispatchEvent(event) {
      dispatched.push(event.type);
      return true;
    },
  };
  Object.defineProperty(input, 'files', {
    get() {
      return stored;
    },
    set(value) {
      stored = value;
    },
  });

  assert.equal(api.transferFilesToInput(input, files, win), true);
  assert.deepEqual(dispatched, ['input', 'change']);
});

test('input.files 保留相同数量的旧文件时不会派发上传事件', () => {
  const stale = fakeFile('same.jpg', 'image/jpeg');
  const fresh = fakeFile('same.jpg', 'image/jpeg');
  const win = {
    DataTransfer: function () {
      this.files = [];
      this.items = { add: (file) => this.files.push(file) };
    },
  };
  const input = {
    get files() { return [stale]; },
    set files(_) {},
    dispatchEvent() { assert.fail('不能转交旧文件'); },
  };
  assert.equal(api.transferFilesToInput(input, [fresh], win), false);
});

function setupUploadHandoff() {
  const events = [];
  const messages = [];
  const win = {
    location: { href: 'https://www.icloud.com/applications/photos#library' },
    DataTransfer: function () {
      this.files = [];
      this.items = { add: (file) => this.files.push(file) };
    },
  };
  const makeInput = () => ({
    isConnected: true,
    multiple: true,
    files: [],
    getAttribute: (name) => name === 'accept' ? 'image/*' : null,
    dispatchEvent(event) { events.push({ input: this, type: event.type }); },
  });
  let current = makeInput();
  const doc = {
    defaultView: win,
    querySelectorAll: (selector) => selector === 'input[type="file"]' ? [current] : [],
  };
  const file = fakeFile('image.jpg', 'image/jpeg');
  function upload(beforeDispatch, routeKey) {
    return api.uploadViaICloudPage(
      [file], doc, win, (message, error) => messages.push({ message, error }), { beforeDispatch, routeKey }
    );
  }
  return {
    events, messages, win, doc, file, upload,
    replaceInput() {
      current.isConnected = false;
      current = makeInput();
      return current;
    },
  };
}

test('读取同步状态期间控件被替换时只向新控件交接', async () => {
  const env = setupUploadHandoff();
  const oldInput = api.findICloudFileInput(env.doc);
  let replacement;
  assert.equal(await env.upload(async () => { replacement = env.replaceInput(); }), 1);
  assert.deepEqual(oldInput.files, []);
  assert.deepEqual(replacement.files, [env.file]);
  assert.deepEqual(env.events.map(({ input, type }) => [input, type]), [
    [replacement, 'input'], [replacement, 'change'],
  ]);
});

test('异步上传准备期间切换图库路由会中止本批交接', async () => {
  const env = setupUploadHandoff();
  assert.equal(await env.upload(async () => { env.win.location.href += '-changed'; }), 0);
  assert.deepEqual(env.events, []);
  assert.equal(env.messages.at(-1).error, true);
  assert.match(env.messages.at(-1).message, /本批未发送/);
});

test('外层页面切换相簿也会中止 iframe 中待交接的批次', async () => {
  const env = setupUploadHandoff();
  env.win.location.origin = 'https://www.icloud.com';
  const shell = { href: 'https://www.icloud.com/photos/', origin: env.win.location.origin };
  env.win.parent = { location: shell };
  assert.equal(await env.upload(async () => { shell.href += '#/favorites/'; }), 0);
  assert.deepEqual(env.events, []);
});

test('批量转码发现视图切换后不再解码剩余文件', async () => {
  let current = true;
  let conversions = 0;
  const files = [fakeFile('first.png', 'image/png'), fakeFile('second.png', 'image/png')];
  const result = await api.normalizeFilesForICloudWebUpload(files, null, null, async () => {
    conversions += 1;
    current = false;
    return fakeFile('first.jpg', 'image/jpeg');
  }, { shouldContinue: () => current });
  assert.deepEqual(result, []);
  assert.equal(conversions, 1);
});

test('排队期间离开原图库路由时不会开始上传准备', async () => {
  const env = setupUploadHandoff();
  const routeKey = env.win.location.href;
  env.win.location.href += '-changed';
  assert.equal(await env.upload(() => assert.fail('路由变化后不能开始准备'), routeKey), 0);
  assert.deepEqual(env.events, []);
  assert.match(env.messages.at(-1).message, /本批未发送/);
});

test('粘贴提取会过滤非图片项并命名图片', () => {
  const items = [
    { kind: 'string', getAsFile: () => null },
    { kind: 'file', getAsFile: () => fakeFile('shot.png', 'image/png') },
    { kind: 'file', getAsFile: () => fakeFile('notes.txt', 'text/plain') },
  ];
  const event = { clipboardData: { items } };

  const files = api.extractImageFilesFromPaste(event, new Date(Date.UTC(2024, 0, 2, 3, 4, 5, 6)));

  assert.equal(files.length, 1);
  assert.match(files[0].name, /^icloud-screenshot-20240102-030405-006-/);
  assert.match(files[0].name, /\.png$/);
});

test('没有 clipboardData 时粘贴提取返回空数组', () => {
  assert.deepEqual(api.extractImageFilesFromPaste({}, new Date()), []);
  assert.deepEqual(api.extractImageFilesFromPaste(null, new Date()), []);
});

test('浅层查找会排除脚本自身的文件输入框', () => {
  const panelInput = {
    getAttribute: () => 'image/*',
    multiple: true,
    closest: (selector) => (selector === '#icloud-web-uploader-panel' ? panelInput : null),
  };
  const appInput = {
    getAttribute: () => 'image/*',
    multiple: true,
    closest: () => null,
  };
  const doc = {
    querySelectorAll(selector) {
      assert.equal(selector, 'input[type="file"]');
      return [panelInput, appInput];
    },
  };

  assert.equal(api.findICloudFileInputShallow(doc), appInput);
  assert.equal(
    api.findICloudFileInputShallow({ querySelectorAll: () => [panelInput] }),
    null
  );
});
test('文件输入缓存按 document 隔离', () => {
  function makeInput() {
    return {
      isConnected: true,
      multiple: true,
      getAttribute: () => 'image/*',
      closest: () => null,
    };
  }
  function makeDocument(input) {
    return {
      querySelectorAll(selector) {
        return selector === 'input[type="file"]' ? [input] : [];
      },
    };
  }

  const first = makeInput();
  const second = makeInput();
  assert.equal(api.findICloudFileInput(makeDocument(first)), first);
  assert.equal(api.findICloudFileInput(makeDocument(second)), second);
});


test('应用帧判定对未知路由保留 DOM 兜底', () => {
  const inApp = { location: { pathname: '/applications/photos3/current/zh-cn/index.html' } };
  const shell = { location: { pathname: '/photos/' } };
  const renamedShell = { location: { pathname: '/photos-next/' } };
  const photosDoc = { querySelector: () => ({}) };
  const emptyDoc = { querySelector: () => null };

  assert.equal(api.isInICloudPhotosAppFrame(inApp, emptyDoc), true);
  assert.equal(api.isInICloudPhotosAppFrame(shell, emptyDoc), false);
  assert.equal(api.isInICloudPhotosAppFrame(renamedShell, photosDoc), true);
  assert.equal(api.isInICloudPhotosAppFrame(renamedShell, emptyDoc), false);
});

test('withTimeout 让卡住的解码以超时结束而不是永远挂起', async () => {
  const never = new Promise(() => {});
  await assert.rejects(
    () => api.withTimeout(never, 20, 'decoding timed out'),
    /decoding timed out/
  );

  const fast = await api.withTimeout(Promise.resolve('ok'), 1000, 'unused');
  assert.equal(fast, 'ok');

  await assert.rejects(() => api.withTimeout(Promise.reject(new Error('boom')), 1000, 'unused'), /boom/);
});

test('转换后的文件名统一为 .jpg', () => {
  assert.equal(api.getConvertedJpegFileName('photo.png'), 'photo.jpg');
  assert.equal(api.getConvertedJpegFileName('photo.jpeg'), 'photo.jpg');
  assert.equal(api.getConvertedJpegFileName('archive.tar.gz'), 'archive.tar.jpg');
  assert.equal(api.getConvertedJpegFileName(''), 'icloud-upload-image.jpg');
});

test('文件选择结果可在 input 清空前复制为稳定数组', () => {
  const file = fakeFile('picked.png', 'image/png');
  const liveFileList = { 0: file, length: 1 };

  const snapshot = api.snapshotFiles(liveFileList);
  delete liveFileList[0];
  liveFileList.length = 0;

  assert.deepEqual(snapshot, [file]);
});

test('滚轮只复用指针命中的缩放目标', () => {
  const image = {};
  const inside = {};
  const outside = {};
  const zoomTarget = {
    contains(node) {
      return node === inside;
    },
  };
  let pointLookups = 0;

  assert.equal(
    api.resolveZoomMedia(image, zoomTarget, inside, () => {
      pointLookups += 1;
      return null;
    }),
    image
  );
  assert.equal(pointLookups, 0);
  assert.equal(api.resolveZoomMedia(image, zoomTarget, outside, () => null), null);
  assert.equal(api.resolveZoomMedia(image, zoomTarget, outside, () => image), image);
});

test('平移边界使用未缩放尺寸，八倍缩放不会重复放大', () => {
  assert.deepEqual(api.calculatePanLimits(400, 300, 8), {
    x: 1400,
    y: 1050,
  });
});

test('粘贴监听器在同一目标上只注册一次', () => {
  function listenerTarget() {
    const counts = new Map();
    return {
      addEventListener(type) {
        counts.set(type, (counts.get(type) || 0) + 1);
      },
      count(type) {
        return counts.get(type) || 0;
      },
    };
  }

  const win = listenerTarget();
  const body = listenerTarget();
  const doc = Object.assign(listenerTarget(), {
    body,
    getElementById() {
      return null;
    },
  });

  api.installPasteListener(doc, win);
  api.installPasteListener(doc, win);

  assert.equal(win.count('paste'), 1);
  assert.equal(doc.count('paste'), 1);
  assert.equal(body.count('paste'), 1);
});

test('刷新代际令牌会让旧轮询立即失效', () => {
  const gate = api.createGenerationGate();
  const first = gate.next();
  assert.equal(gate.isCurrent(first), true);

  const second = gate.next();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);

  gate.invalidate();
  assert.equal(gate.isCurrent(second), false);
});

test('未被页面接受的拖放不会报告上传成功，也不会广播到多个目标', () => {
  const dispatched = [];
  const target = {
    dispatchEvent(event) {
      dispatched.push(event.type);
      return true;
    },
  };
  const doc = {
    body: { dispatchEvent() { throw new Error('不应广播到 body'); } },
    documentElement: { dispatchEvent() { throw new Error('不应广播到 html'); } },
    querySelectorAll(selector) {
      if (selector === '[role="main"]') return [target];
      return [];
    },
  };
  class DataTransferStub {
    constructor() {
      this.items = { add() {} };
    }
  }
  class EventStub {
    constructor(type, options) {
      this.type = type;
      this.defaultPrevented = false;
      Object.assign(this, options);
    }
    preventDefault() {
      this.defaultPrevented = true;
    }
  }

  const accepted = api.dropFilesOnICloudPage(
    [fakeFile('photo.jpg', 'image/jpeg')],
    doc,
    { DataTransfer: DataTransferStub, DragEvent: EventStub, Event: EventStub }
  );

  assert.equal(accepted, false);
  assert.deepEqual(dispatched, ['dragenter', 'dragover', 'drop']);
});

test('只有 drop 被处理才记录拖放事件已处理，且不宣称文件已入队', async () => {
  const dispatched = [];
  let handlesDrop = false;
  const target = {
    dispatchEvent(event) {
      dispatched.push(event.type);
      if (event.type === 'dragover') event.preventDefault();
      if (event.type === 'drop' && handlesDrop) event.preventDefault();
      return !event.defaultPrevented;
    },
  };
  const doc = {
    querySelectorAll(selector) {
      if (selector === '[data-testid*="drop" i]') return [target];
      return [];
    },
  };
  class DataTransferStub {
    constructor() {
      this.items = { add() {} };
    }
  }
  class EventStub {
    constructor(type, options) {
      this.type = type;
      this.defaultPrevented = false;
      Object.assign(this, options);
    }
    preventDefault() {
      this.defaultPrevented = true;
    }
  }

  const photos = [fakeFile('photo.jpg', 'image/jpeg')];
  const win = { DataTransfer: DataTransferStub, DragEvent: EventStub, Event: EventStub };
  assert.equal(api.dropFilesOnICloudPage(photos, doc, win), false);
  assert.deepEqual(dispatched, ['dragenter', 'dragover', 'drop']);
  handlesDrop = true;
  assert.equal(api.dropFilesOnICloudPage(photos, doc, win), true);
  const messages = [];
  assert.equal(await api.uploadViaICloudPage(photos, doc, win, message => messages.push(message)), 0);
  assert.match(messages.at(-1), /确认是否入队/);
});

test('input.files setter 抛错时上传交接返回 false 而不是泄漏异常', () => {
  const input = {
    set files(value) {
      void value;
      const error = new Error('blocked');
      error.name = 'SecurityError';
      throw error;
    },
  };
  class DataTransferStub {
    constructor() {
      this.items = { add() {} };
      this.files = [];
    }
  }

  assert.doesNotThrow(() => {
    assert.equal(
      api.transferFilesToInput(
        input,
        [fakeFile('photo.jpg', 'image/jpeg')],
        { DataTransfer: DataTransferStub }
      ),
      false
    );
  });
});

test('createImageBitmap 超时后不会再串行等待 img 解码', async () => {
  const startedAt = Date.now();

  await assert.rejects(
    api.decodeImageForCanvas(
      fakeFile('stalled.png', 'image/png'),
      {
        createImageBitmap() {
          return new Promise(() => {});
        },
        document: {
          createElement() {
            throw new Error('超时后不应回退到 img');
          },
        },
      },
      15
    ),
    /Decoding timed out/
  );

  assert.ok(Date.now() - startedAt < 100);
});

test('画布尺寸同时受长边和总像素限制', () => {
  const landscape = api.calculateCanvasSize(12000, 8000, 8192, 40000000);
  const square = api.calculateCanvasSize(8192, 8192, 8192, 40000000);

  assert.ok(landscape.width <= 8192);
  assert.ok(landscape.width * landscape.height <= 40000000);
  assert.ok(square.width * square.height <= 40000000);
  assert.ok(Math.abs(landscape.width / landscape.height - 1.5) < 0.001);
});
test('转码成功保留源时间并释放位图和画布', async () => {
  let bitmapClosed = false;
  let drawnSize = null;
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        fillStyle: '',
        fillRect() {},
        imageSmoothingQuality: '',
        drawImage(image, x, y, width, height) {
          void image;
          void x;
          void y;
          drawnSize = { width, height };
        },
      };
    },
    toBlob(callback) {
      callback({ type: 'image/jpeg', size: 8 });
    },
  };
  class FileStub {
    constructor(parts, name, options) {
      this.parts = parts;
      this.name = name;
      Object.assign(this, options);
    }
  }
  const sourceFile = {
    name: 'source.png',
    type: 'image/png',
    lastModified: 123456,
  };

  const converted = await api.convertImageFileToJpeg(sourceFile, {
    async createImageBitmap() {
      return {
        width: 400,
        height: 300,
        close() {
          bitmapClosed = true;
        },
      };
    },
    document: {
      createElement() {
        return canvas;
      },
    },
    File: FileStub,
  });

  assert.equal(converted.name, 'source.jpg');
  assert.equal(converted.lastModified, sourceFile.lastModified);
  assert.deepEqual(drawnSize, { width: 400, height: 300 });
  assert.equal(bitmapClosed, true);
  assert.deepEqual({ width: canvas.width, height: canvas.height }, { width: 1, height: 1 });
});

test('画布初始化失败时仍释放已解码位图', async () => {
  let bitmapClosed = false;
  await assert.rejects(
    api.convertImageFileToJpeg(
      fakeFile('source.png', 'image/png'),
      {
        async createImageBitmap() {
          return {
            width: 10,
            height: 10,
            close() {
              bitmapClosed = true;
            },
          };
        },
        document: {
          createElement() {
            return {
              width: 0,
              height: 0,
              getContext() {
                return null;
              },
            };
          },
        },
      }
    ),
    /Canvas 2D rendering/
  );
  assert.equal(bitmapClosed, true);
});


test('连续缩放使用当前视觉中心计算锚点，不重复缩放旧平移量', () => {
  const first = api.calculateZoomTranslation({
    tx: 0,
    ty: 0,
    pointerOffsetX: 100,
    pointerOffsetY: 50,
    scaleRatio: 2,
  });
  const second = api.calculateZoomTranslation({
    tx: first.tx,
    ty: first.ty,
    pointerOffsetX: 200,
    pointerOffsetY: 100,
    scaleRatio: 2,
  });

  assert.deepEqual(first, { tx: -100, ty: -50 });
  assert.deepEqual(second, { tx: -300, ty: -150 });
});

test('成功上传后的刷新需求会跨过后续失败批次并在队列结束时恢复', () => {
  const demand = api.createRefreshDemandTracker();
  demand.enqueue();
  demand.enqueue();
  demand.recordSuccess('token-a');

  assert.equal(demand.finish(), null);
  // The second batch failed, so it records no success. Finishing it must expose
  // the first batch's still-outstanding refresh demand.
  assert.deepEqual(demand.finish(), { baseline: 'token-a' });

  demand.recordSuccess('token-b');
  assert.deepEqual(demand.ready(), { baseline: 'token-b' });
  demand.clear();
  assert.equal(demand.ready(), null);
});

test('hash 往返没有观察到图库变化时软刷新返回 false', async () => {
  let hash = '#/recents';
  const win = {
    location: {
      get hash() {
        return hash;
      },
      set hash(value) {
        hash = value;
      },
    },
    MutationObserver: class MutationObserverStub {
      observe() {}
      disconnect() {}
    },
  };
  const doc = {
    body: {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };

  const refreshed = await api.softRefreshLibraryView(doc, win, {
    verificationTimeout: 5,
  });

  assert.equal(refreshed, false);
  assert.equal(hash, '#/recents');
});

test('等候软刷新时手动切换路由会保留用户选择', async () => {
  let hash = '#/recents';
  let view = {};
  let notify;
  const win = {
    location: { get hash() { return hash; }, set hash(value) { hash = value; } },
    MutationObserver: class {
      constructor(callback) { notify = callback; }
      observe() {}
      disconnect() {}
    },
  };
  const doc = { body: {}, querySelector: selector => selector.includes('PhotosRootContent') ? view : null,
    querySelectorAll: () => [] };
  const refresh = api.softRefreshLibraryView(doc, win, { verificationTimeout: 30 });
  assert.equal(hash, '#/favorites');
  win.location.hash = '#/albums';
  view = {};
  notify();
  assert.equal(await refresh, false);
  assert.equal(hash, '#/albums');
});

test('软刷新通过侧栏并等待外层路由确认两程都完成', async () => {
  const shell = Object.assign(new EventTarget(), {
    location: { origin: 'https://www.icloud.com.cn', pathname: '/photos/', hash: '' },
  });
  let selected = '图库';
  let notify;
  const visited = [];
  const items = [
    ['图库', ''],
    ['最近项目', '#/recents/'],
  ].map(([name, hash]) => ({
    textContent: name,
    getAttribute: attr => attr === 'href' ? 'https://www.icloud.com.cn/photos/' + hash : null,
    matches: () => name === selected,
    click() {
      visited.push(name);
      if (name === '图库') assert.equal(shell.location.hash, '#/recents/');
      selected = name;
      notify();
      queueMicrotask(() => {
        shell.location.hash = hash;
        shell.dispatchEvent(new Event('hashchange'));
      });
    },
  }));
  const win = {
    parent: shell,
    location: { origin: shell.location.origin, hash: '#launchRoute=fixture' },
    MutationObserver: class {
      constructor(callback) { notify = callback; }
      observe() {}
      disconnect() {}
    },
  };
  const doc = { body: {}, querySelector: () => null,
    querySelectorAll: selector => selector.includes('Sidebar-innerContainer') ? items : [] };
  assert.equal(await api.softRefreshLibraryView(doc, win, { verificationTimeout: 800 }), true);
  assert.deepEqual(visited, ['最近项目', '图库']);
  assert.equal(shell.location.hash, '');
  assert.equal(win.location.hash, '#launchRoute=fixture');
});

test('观察到两次图库变化后软刷新才返回 true', async () => {
  let hash = '#/recents';
  const observers = new Set();
  let viewNode = { closest: () => null };
  class MutationObserverStub {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {
      observers.add(this);
    }
    disconnect() {
      observers.delete(this);
    }
  }
  const win = {
    location: {
      get hash() {
        return hash;
      },
      set hash(value) {
        hash = value;
        viewNode = { closest: () => null };
        setTimeout(function () {
          Array.from(observers).forEach(function (observer) {
            observer.callback([{ target: viewNode }]);
          });
        }, 0);
      },
    },
    MutationObserver: MutationObserverStub,
  };
  const doc = {
    body: viewNode,
    querySelector(selector) {
      return selector.indexOf('PhotosRootContent') !== -1 ? viewNode : null;
    },
    querySelectorAll() {
      return [];
    },
  };

  const refreshed = await api.softRefreshLibraryView(doc, win, {
    verificationTimeout: 50,
  });

  assert.equal(refreshed, true);
  assert.equal(hash, '#/recents');
});

test('无关 DOM 变化不能冒充图库路由刷新', async () => {
  let hash = '#/recents';
  const observers = new Set();
  const stableView = { closest: () => null };
  class MutationObserverStub {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {
      observers.add(this);
    }
    disconnect() {
      observers.delete(this);
    }
  }
  const win = {
    location: {
      get hash() {
        return hash;
      },
      set hash(value) {
        hash = value;
        setTimeout(function () {
          Array.from(observers).forEach(function (observer) {
            observer.callback([{ target: { closest: () => null } }]);
          });
        }, 0);
      },
    },
    MutationObserver: MutationObserverStub,
  };
  const doc = {
    body: stableView,
    querySelector(selector) {
      return selector.indexOf('PhotosRootContent') !== -1 ? stableView : null;
    },
    querySelectorAll() {
      return [];
    },
  };

  assert.equal(
    await api.softRefreshLibraryView(doc, win, { verificationTimeout: 30 }),
    false
  );
  assert.equal(hash, '#/recents');
});

test('软刷新只有第一程改变图库时仍返回 false', async () => {
  let hash = '#/recents';
  const observers = new Set();
  let viewNode = { closest: () => null };
  class MutationObserverStub {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {
      observers.add(this);
    }
    disconnect() {
      observers.delete(this);
    }
  }
  const win = {
    location: {
      get hash() {
        return hash;
      },
      set hash(value) {
        hash = value;
        if (value !== '#/recents') viewNode = { closest: () => null };
        setTimeout(function () {
          Array.from(observers).forEach(function (observer) {
            observer.callback([{ target: viewNode }]);
          });
        }, 0);
      },
    },
    MutationObserver: MutationObserverStub,
  };
  const doc = {
    body: {},
    querySelector(selector) {
      return selector.indexOf('PhotosRootContent') !== -1 ? viewNode : null;
    },
    querySelectorAll() {
      return [];
    },
  };

  assert.equal(
    await api.softRefreshLibraryView(doc, win, { verificationTimeout: 30 }),
    false
  );
  assert.equal(hash, '#/recents');
});

test('文件输入选择排除禁用和非图片控件', () => {
  function input(accept, options) {
    return Object.assign({
      accept,
      disabled: false,
      isConnected: true,
      multiple: true,
      getAttribute(name) {
        return name === 'accept' ? this.accept : null;
      },
      closest() {
        return null;
      },
    }, options);
  }
  const disabled = input('image/*', { disabled: true });
  const unrelated = input('application/pdf');
  const photos = input('image/*');
  const doc = {
    querySelectorAll(selector) {
      return selector === 'input[type="file"]'
        ? [disabled, unrelated, photos]
        : [];
    },
  };

  assert.equal(api.findICloudFileInput(doc), photos);
});

test('点击上传后优先选择新出现的文件输入控件', () => {
  const existing = {
    disabled: false,
    isConnected: true,
    multiple: true,
    getAttribute: () => 'image/*',
    closest: () => null,
  };
  const added = {
    disabled: false,
    isConnected: true,
    multiple: true,
    getAttribute: () => 'image/*',
    closest: () => null,
  };

  assert.equal(
    api.selectICloudFileInput([existing, added], null, new Set([existing])),
    added
  );
});

test('等待上传控件时跳过先出现的低置信新文件输入', async () => {
  const unknown = {
    disabled: false,
    isConnected: true,
    multiple: false,
    getAttribute: () => '',
    closest: () => null,
  };
  const photos = {
    disabled: false,
    isConnected: true,
    multiple: true,
    getAttribute: () => 'image/*',
    closest: () => null,
  };
  let fileQueries = 0;
  const doc = {
    querySelectorAll(selector) {
      if (selector !== 'input[type="file"]') return [];
      fileQueries += 1;
      return fileQueries < 3 ? [unknown] : [unknown, photos];
    },
  };

  const found = await api.waitForICloudFileInput(doc, 100, 1, new Set());

  assert.equal(found, photos);
});

test('已缓存的文件输入失效后重新选择控件', () => {
  const first = {
    disabled: false,
    isConnected: true,
    multiple: true,
    getAttribute: () => 'image/*',
    closest: () => null,
  };
  const second = {
    disabled: false,
    isConnected: true,
    multiple: true,
    getAttribute: () => 'image/*',
    closest: () => null,
  };
  let inputs = [first];
  const doc = {
    querySelectorAll(selector) {
      return selector === 'input[type="file"]' ? inputs : [];
    },
  };

  assert.equal(api.findICloudFileInput(doc), first);
  first.disabled = true;
  inputs = [second];
  assert.equal(api.findICloudFileInput(doc), second);
});

test('路由变化会使文件输入缓存失效', () => {
  const first = {
    disabled: false,
    isConnected: true,
    multiple: true,
    getAttribute: () => 'image/*',
    closest: () => null,
  };
  const second = {
    disabled: false,
    isConnected: true,
    multiple: true,
    getAttribute: () => 'image/*',
    closest: () => null,
  };
  const location = { href: 'https://www.icloud.com/photos/#/recents', hash: '#/recents' };
  let inputs = [first];
  const doc = {
    defaultView: { location },
    querySelectorAll(selector) {
      return selector === 'input[type="file"]' ? inputs : [];
    },
  };

  assert.equal(api.findICloudFileInput(doc), first);
  location.href = 'https://www.icloud.com/photos/#/favorites';
  location.hash = '#/favorites';
  inputs = [second];
  assert.equal(api.findICloudFileInput(doc), second);
});

test('CloudKit 同步状态比较全部 zone 且不受返回顺序影响', () => {
  const first = {
    zones: [
      { zoneID: { zoneName: 'photos', ownerRecordName: 'a' }, syncToken: 'one' },
      { zoneID: { zoneName: 'shared', ownerRecordName: 'b' }, syncToken: 'two' },
    ],
  };
  const reordered = {
    zones: [
      { zoneID: { ownerRecordName: 'b', zoneName: 'shared' }, syncToken: 'two' },
      { zoneID: { ownerRecordName: 'a', zoneName: 'photos' }, syncToken: 'one' },
    ],
  };
  const changed = {
    zones: [
      { zoneID: { zoneName: 'photos', ownerRecordName: 'a' }, syncToken: 'one' },
      { zoneID: { zoneName: 'shared', ownerRecordName: 'b' }, syncToken: 'three' },
    ],
  };

  assert.equal(api.serializeZoneSyncState(first), api.serializeZoneSyncState(reordered));
  assert.notEqual(api.serializeZoneSyncState(first), api.serializeZoneSyncState(changed));
});

test('CloudKit 请求禁用缓存、传递取消信号并返回全部 zone 状态', async () => {
  const controller = new AbortController();
  let request = null;
  const win = {
    async fetch(url, options) {
      request = { url, options };
      return {
        ok: true,
        async json() {
          return {
            zones: [
              { zoneID: { zoneName: 'photos' }, syncToken: 'one' },
              { zoneID: { zoneName: 'shared' }, syncToken: 'two' },
            ],
          };
        },
      };
    },
  };

  const state = await api.fetchCloudKitSyncState(
    win,
    'https://photos.cloud.example/zones/list',
    controller.signal
  );

  assert.equal(request.url, 'https://photos.cloud.example/zones/list');
  assert.equal(request.options.credentials, 'include');
  assert.equal(request.options.cache, 'no-store');
  assert.equal(request.options.signal, controller.signal);
  assert.equal(typeof state, 'string');
  assert.match(state, /one/);
  assert.match(state, /two/);
});


test('可中止任务会把取消信号传给底层请求', async () => {
  let signal = null;
  const task = api.startAbortableTask(
    function (requestSignal) {
      signal = requestSignal;
      return new Promise(function (resolve) {
        requestSignal.addEventListener('abort', function () {
          resolve('aborted');
        }, { once: true });
      });
    },
    1000,
    AbortController,
    'request timed out'
  );
  await Promise.resolve();
  task.abort();

  assert.equal(await task.promise, 'aborted');
  assert.equal(signal.aborted, true);
});

test('请求超时时会中止底层任务', async () => {
  let signal = null;
  const task = api.startAbortableTask(
    function (requestSignal) {
      signal = requestSignal;
      return new Promise(function () {});
    },
    5,
    AbortController,
    'request timed out'
  );

  await assert.rejects(task.promise, /request timed out/);
  assert.equal(signal.aborted, true);
});


test('媒体来源变化可以被缩放看护识别', () => {
  assert.equal(
    api.hasMediaSourceChanged({ currentSrc: 'photo-a.jpg', src: 'fallback.jpg' }, 'photo-a.jpg'),
    false
  );
  assert.equal(
    api.hasMediaSourceChanged({ currentSrc: 'photo-b.jpg', src: 'fallback.jpg' }, 'photo-a.jpg'),
    true
  );
});

test('缩放清理只恢复脚本仍然拥有的内联样式', () => {
  const hostUpdated = { transform: 'matrix(2, 0, 0, 2, 10, 0)' };
  assert.equal(
    api.restoreOwnedInlineStyle(
      hostUpdated,
      'transform',
      'translate(-20px, 0px) scale(1.5)',
      'matrix(1.2, 0, 0, 1.2, 0, 0)'
    ),
    false
  );
  assert.equal(hostUpdated.transform, 'matrix(2, 0, 0, 2, 10, 0)');

  const stillOwned = { transform: 'translate(-20px, 0px) scale(1.5)' };
  assert.equal(
    api.restoreOwnedInlineStyle(
      stillOwned,
      'transform',
      'translate(-20px, 0px) scale(1.5)',
      'matrix(1.2, 0, 0, 1.2, 0, 0)'
    ),
    true
  );
  assert.equal(stillOwned.transform, 'matrix(1.2, 0, 0, 1.2, 0, 0)');
});


test('图库右键目标只接受直接命中的照片', () => {
  const image = {
    tagName: 'IMG',
    currentSrc: 'https://photos.example/full.jpg',
    src: 'https://photos.example/thumb.jpg',
  };
  const tile = {
    tagName: 'DIV',
    querySelectorAll(selector) {
      assert.equal(selector, 'img');
      return [image];
    },
    parentElement: null,
  };

  assert.equal(api.findCopyablePhotoImage(image), image);
  assert.equal(api.findCopyablePhotoImage(tile), null);
  assert.equal(api.findCopyablePhotoImage({ tagName: 'DIV', parentElement: null }), null);
});

test('网格照片的遮罩事件可从事件路径解析实际图片', () => {
  const image = {
    tagName: 'IMG',
    currentSrc: 'https://photos.example/full.jpg',
    src: 'https://photos.example/thumb.jpg',
  };
  const overlay = { tagName: 'DIV' };

  assert.equal(
    api.findCopyablePhotoImageFromEvent({
      target: overlay,
      composedPath: () => [overlay, image],
    }),
    image
  );
});

test('照片 img 被 pointer-events 穿透时从容器按坐标解析', () => {
  const image = {
    tagName: 'IMG',
    currentSrc: 'blob:https://www.icloud.com/photo',
    src: '',
    getBoundingClientRect() {
      return { width: 115, height: 115, left: 100, top: 50, right: 215, bottom: 165 };
    },
  };
  const tile = {
    tagName: 'DIV',
    querySelectorAll(selector) {
      assert.equal(selector, 'img');
      return [image];
    },
    closest() {
      return null;
    },
  };

  const hit = api.findCopyablePhotoImageFromEvent({
    target: tile,
    composedPath: () => [tile],
    clientX: 150,
    clientY: 100,
  });
  assert.equal(hit, image);

  const miss = api.findCopyablePhotoImageFromEvent({
    target: tile,
    composedPath: () => [tile],
    clientX: 500,
    clientY: 500,
  });
  assert.equal(miss, null);
});

test('自定义菜单容器可由下载项的类名定位', () => {
  const menu = {
    id: 'menu',
    textContent: '个人收藏 下载',
    parentElement: null,
    getAttribute(name) { return name === 'role' ? 'menu' : null; },
  };
  const download = {
    textContent: '下载',
    parentElement: menu,
    closest(selector) {
      assert.match(selector, /role="menu"/i);
      return null;
    },
  };
  const doc = {
    querySelectorAll(selector) {
      assert.match(selector, /class\*="menu"/i);
      return [download];
    },
  };

  assert.deepEqual(api.findPhotoContextMenus(doc), [menu]);
});

test('繁体中文照片菜单可由下载项定位', () => {
  const menu = {
    className: 'PhotosMenu-pane',
    textContent: '加入喜好項目 下載 更多下載選項 隱藏 刪除',
    parentElement: null,
    getAttribute() { return null; },
  };
  const download = {
    textContent: '下載',
    parentElement: menu,
    closest() { return null; },
  };
  const doc = {
    querySelectorAll() { return [download]; },
  };

  assert.deepEqual(api.findPhotoContextMenus(doc), [menu]);
});

test('拷贝图片在用户手势内开始写入，读取当前渲染源并提交 PNG', async () => {
  let request = null;
  let written = null;
  const blob = { type: 'image/png' };
  let userGestureActive = true;
  const image = {
    currentSrc: 'https://photos.example/full.jpg',
    src: 'https://photos.example/thumb.jpg',
  };
  const win = {
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: true, blob: async () => blob };
    },
    ClipboardItem: function ClipboardItem(items) {
      this.items = items;
    },
    navigator: {
      clipboard: {
        write: async (items) => {
          assert.equal(userGestureActive, true);
          assert.deepEqual(Object.keys(items[0].items), ['image/png']);
          written = await items[0].items['image/png'];
        },
      },
    },
  };

  const copy = api.copyPhotoImageToClipboard(image, win);
  userGestureActive = false;
  assert.equal(await copy, true);
  assert.equal(request.url, 'https://photos.example/full.jpg');
  assert.equal(request.options.credentials, 'include');
  assert.equal(written, blob);

  const preparedBlob = { type: 'image/png' };
  const preparedWin = {
    fetch: async () => { throw new Error('不应重新读取已验证的图片'); },
    ClipboardItem: function ClipboardItem(items) { this.items = items; },
    navigator: {
      clipboard: {
        write: async (items) => { written = await items[0].items['image/png']; },
      },
    },
  };
  assert.equal(await api.copyPhotoImageToClipboard(image, preparedWin, preparedBlob), true);
  assert.equal(written, preparedBlob);
});

async function assertCanvasClipboardFallback(fetch) {
  let written = null;
  const drawCalls = [];
  const canvasBlob = { type: 'image/png', size: 4096 };
  const image = {
    currentSrc: 'blob:https://www.icloud.com/revoked',
    src: '',
    naturalWidth: 480,
    naturalHeight: 360,
    ownerDocument: {
      createElement(tag) {
        assert.equal(tag, 'canvas');
        return {
          width: 0,
          height: 0,
          getContext() {
            return {
              drawImage(el, x, y, w, h) {
                drawCalls.push({ el, x, y, w, h });
              },
            };
          },
          toBlob(callback, type) {
            drawCalls.push({ type });
            callback(canvasBlob);
          },
        };
      },
    },
  };
  const win = {
    fetch,
    ClipboardItem: function ClipboardItem(items) {
      this.items = items;
    },
    navigator: {
      clipboard: {
        write: async (items) => { written = await items[0].items['image/png']; },
      },
    },
  };

  assert.equal(await api.copyPhotoImageToClipboard(image, win), true);
  assert.equal(drawCalls.length, 2);
  assert.equal(drawCalls[0].el, image);
  assert.equal(drawCalls[0].w, 480);
  assert.equal(drawCalls[0].h, 360);
  assert.equal(drawCalls[1].type, 'image/png');
  assert.equal(written, canvasBlob);
}

test('已解码的图片优先通过 canvas 拷贝，避免再次读取对象地址', async () => {
  let requests = 0;
  await assertCanvasClipboardFallback(async () => {
    requests += 1;
    throw new TypeError('Failed to fetch');
  });
  assert.equal(requests, 0);
});

test('JPEG 来源重绘为 PNG 后才写入剪贴板', async () => {
  await assertCanvasClipboardFallback(async () => ({ ok: true, blob: async () => ({ type: 'image/jpeg' }) }));
});

test('对象地址回收且画布无法重绘时报告读取失败', async () => {
  const image = {
    currentSrc: 'blob:https://www.icloud.com/revoked',
    naturalWidth: 0,
    naturalHeight: 0,
    ownerDocument: {
      createElement() {
        throw new Error('canvas unavailable');
      },
    },
  };
  const win = {
    fetch: async () => {
      throw new TypeError('Failed to fetch');
    },
    ClipboardItem: function ClipboardItem(items) {
      this.items = items;
    },
    navigator: {
      clipboard: {
        write: async ([item]) => { await item.items['image/png']; },
      },
    },
  };

  await assert.rejects(api.copyPhotoImageToClipboard(image, win), /无法读取图片数据/);
});

test('等待图片数据时切换照片不会把新照片误写入剪贴板', async () => {
  const image = {
    currentSrc: 'blob:https://www.icloud.com/first',
    complete: false,
    naturalWidth: 480,
    naturalHeight: 360,
    ownerDocument: {
      createElement() { assert.fail('不能重绘切换后的照片'); },
    },
  };
  const win = {
    fetch: async () => {
      image.currentSrc = 'blob:https://www.icloud.com/second';
      return { ok: false };
    },
    ClipboardItem: function (items) { this.items = items; },
    navigator: {
      clipboard: { write: async ([item]) => { await item.items['image/png']; } },
    },
  };
  await assert.rejects(api.copyPhotoImageToClipboard(image, win), /照片已切换/);
});

test('超大图片拷贝在分配画布前提示使用原生下载', async () => {
  const photo = { naturalWidth: 9000, naturalHeight: 7000,
    ownerDocument: { createElement() { assert.fail('超大画布不能分配'); } } };
  await assert.rejects(api.renderPhotoImageToBlob(photo, {}), /剪贴板转换上限/);
});

function fakeKeydownEvent(overrides) {
  return Object.assign(
    {
      key: 'c',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
      defaultPrevented: false,
      target: { tagName: 'DIV' },
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      },
    },
    overrides || {}
  );
}

function setupKeyboardCopyEnv() {
  const handlers = {};
  const messages = [];
  let written = null;
  const canvasBlob = { type: 'image/png', size: 2400 };
  const image = {
    tagName: 'IMG',
    src: 'blob:https://www.icloud.com/revoked',
    currentSrc: 'blob:https://www.icloud.com/revoked',
    naturalWidth: 480,
    naturalHeight: 360,
    getBoundingClientRect() {
      return { width: 115, height: 115, left: 0, top: 0, right: 115, bottom: 115 };
    },
    ownerDocument: {
      createElement() {
        return {
          width: 0,
          height: 0,
          getContext() {
            return { drawImage() {} };
          },
          toBlob(callback) {
            callback(canvasBlob);
          },
        };
      },
    },
  };
  // iCloud marks tile <img>s as pointer-events:none, so hit testing returns
  // the tile container and the photo must be resolved from its descendants.
  const tile = {
    tagName: 'DIV',
    querySelectorAll() {
      return [image];
    },
  };
  const doc = {
    addEventListener(type, handler) {
      handlers[type] = handlers[type] || [];
      handlers[type].push(handler);
    },
    elementsFromPoint() {
      return [tile];
    },
    getElementById() {
      return {
        _showUploaderStatus(message, isError) {
          messages.push({ message, isError });
        },
      };
    },
  };
  const win = {
    fetch: async () => {
      throw new TypeError('Failed to fetch');
    },
    ClipboardItem: function ClipboardItem(items) {
      this.items = items;
    },
    navigator: {
      clipboard: {
        write: async (items) => {
          written = await items[0].items['image/png'];
        },
      },
    },
    getSelection: () => ({ isCollapsed: true, toString: () => '' }),
  };
  return { handlers, messages, doc, win, image, canvasBlob, getWritten: () => written };
}

async function flushKeyboardCopy() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

test('快捷键 Ctrl+C 拷贝鼠标下的照片并写入剪贴板', async () => {
  const env = setupKeyboardCopyEnv();
  api.installGridPhotoKeyboardCopy(env.doc, env.win);
  env.handlers.mousemove[0]({ clientX: 50, clientY: 50 });
  const event = fakeKeydownEvent();
  env.handlers.keydown[0](event);
  assert.equal(event.defaultPrevented, true);

  await flushKeyboardCopy();
  assert.equal(env.getWritten(), env.canvasBlob);
  const last = env.messages[env.messages.length - 1];
  assert.equal(last.message, '图像已拷贝到剪贴板');
});

test('快捷键 Alt+C 同样触发照片拷贝', async () => {
  const env = setupKeyboardCopyEnv();
  api.installGridPhotoKeyboardCopy(env.doc, env.win);
  env.handlers.mousemove[0]({ clientX: 50, clientY: 50 });
  const event = fakeKeydownEvent({ ctrlKey: false, altKey: true });
  env.handlers.keydown[0](event);
  assert.equal(event.defaultPrevented, true);

  await flushKeyboardCopy();
  assert.equal(env.getWritten(), env.canvasBlob);
});

test('快捷键在输入框内或有文本选择时不拦截', async () => {
  const env = setupKeyboardCopyEnv();
  api.installGridPhotoKeyboardCopy(env.doc, env.win);
  env.handlers.mousemove[0]({ clientX: 50, clientY: 50 });

  const inInput = fakeKeydownEvent({ target: { tagName: 'INPUT' } });
  env.handlers.keydown[0](inInput);
  assert.equal(inInput.defaultPrevented, false);

  env.win.getSelection = () => ({ isCollapsed: false, toString: () => 'hello' });
  const withSelection = fakeKeydownEvent();
  env.handlers.keydown[0](withSelection);
  assert.equal(withSelection.defaultPrevented, false);

  await flushKeyboardCopy();
  assert.equal(env.getWritten(), null);
});

test('鼠标下没有照片时快捷键不拦截', () => {
  const env = setupKeyboardCopyEnv();
  env.doc.elementsFromPoint = () => [{ tagName: 'DIV' }];
  api.installGridPhotoKeyboardCopy(env.doc, env.win);
  env.handlers.mousemove[0]({ clientX: 50, clientY: 50 });
  const event = fakeKeydownEvent();
  env.handlers.keydown[0](event);
  assert.equal(event.defaultPrevented, false);
});

test('鼠标下的小图标不会被当作照片', () => {
  const icon = {
    tagName: 'IMG',
    src: 'https://www.icloud.com/system/icon.png',
    getBoundingClientRect() {
      return { width: 24, height: 24 };
    },
  };
  assert.equal(api.findGridPhotoImageAtPoint({ elementsFromPoint: () => [icon] }, 10, 10), null);
  const photo = {
    tagName: 'IMG',
    src: 'blob:https://www.icloud.com/photo',
    getBoundingClientRect() {
      return { width: 115, height: 115 };
    },
  };
  assert.equal(api.findGridPhotoImageAtPoint({ elementsFromPoint: () => [photo] }, 10, 10), photo);
});

test('首次悬停到照片时提示一次快捷键用法', () => {
  const env = setupKeyboardCopyEnv();
  api.installGridPhotoKeyboardCopy(env.doc, env.win);
  env.handlers.mouseover[0]({ clientX: 50, clientY: 50 });
  assert.ok(env.messages.some((entry) => entry.message.includes('Ctrl+C')));
  const count = env.messages.length;
  env.handlers.mouseover[0]({ clientX: 60, clientY: 60 });
  assert.equal(env.messages.length, count);
});

test('编辑控件判定覆盖输入框与 contenteditable', () => {
  assert.equal(api.isEditablePhotoCopyTarget({ tagName: 'INPUT' }), true);
  assert.equal(api.isEditablePhotoCopyTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(api.isEditablePhotoCopyTarget({ tagName: 'DIV' }), false);
  assert.equal(api.isEditablePhotoCopyTarget(null), false);
});

test('面板拖拽会阻止 drop 冒泡，避免 iCloud 重复入队', () => {
  assert.match(
    source,
    /event\.stopPropagation\(\);\r?\n\s*panel\.classList\.remove\('is-dragging'\);/
  );
});

test('油猴元数据块包含可更新的三段式版本号', () => {
  const metadata = source.split('// ==/UserScript==', 1)[0];
  assert.match(metadata, /^\/\/ @version[ \t]+\d+\.\d+\.\d+\s*$/m);
});

test('resolveOneUpImage 靠尺寸识别大图，不吃网格缩略图，也不吃轮播里预加载的邻图', () => {
  const viewer = (natW, natH, rect, inGrid) => ({
    naturalWidth: natW,
    naturalHeight: natH,
    closest: (sel) => (inGrid && sel === '.grid-item' ? {} : null),
    getBoundingClientRect: () => rect,
  });
  const viewport = { clientWidth: 1600, clientHeight: 900 };
  const makeDoc = (imgs) => ({ documentElement: viewport, querySelectorAll: () => imgs });

  // centered viewer photo wins over a bigger-looking preloaded neighbour
  const centered = viewer(2048, 1536, { left: 400, top: 100, width: 1200, height: 800 });
  const neighbour = viewer(4032, 3024, { left: -4000, top: 0, width: 3000, height: 2000 });
  assert.equal(
    api.resolveOneUpImage(makeDoc([neighbour, centered])),
    centered,
    '应选靠近视口中心的那张'
  );

  // grid thumbnails are small on screen and inside .grid-item
  const gridThumb = viewer(480, 360, { left: 10, top: 10, width: 159, height: 159 }, true);
  assert.equal(api.resolveOneUpImage(makeDoc([gridThumb])), null, '网格缩略图不算大图');

  // big natural size but rendered small (e.g. not yet laid out) does not count
  const notRendered = viewer(4032, 3024, { left: 0, top: 0, width: 120, height: 90 });
  assert.equal(api.resolveOneUpImage(makeDoc([notRendered])), null, '屏幕尺寸太小不算大图');

  // header avatar: large on screen but not a photo original
  const avatar = viewer(420, 420, { left: 20, top: 20, width: 44, height: 44 });
  assert.equal(api.resolveOneUpImage(makeDoc([avatar])), null);

  assert.equal(api.resolveOneUpImage(makeDoc([])), null);
  assert.equal(api.resolveOneUpImage(null), null);
});

test('大图按钮是图标按钮，随大图出现与移除', async () => {
  const created = [];
  const documentListeners = {};
  let viewerPresent = true;
  const viewerImg = {
    naturalWidth: 2048,
    naturalHeight: 1536,
    closest: () => null,
    getBoundingClientRect: () => ({ left: 400, top: 100, width: 1200, height: 800, right: 1600, bottom: 900 }),
  };
  const makeButton = () => ({
    style: { cssText: '' },
    attrs: {},
    listeners: {},
    innerHTML: '',
    type: '',
    title: '',
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    removeEventListener(type) {
      delete this.listeners[type];
    },
    remove() {
      this.removed = true;
    },
    getBoundingClientRect: () => ({ left: 20, top: 700, width: 40, height: 40, right: 60, bottom: 740 }),
  });
  const doc = {
    documentElement: { clientWidth: 1600, clientHeight: 900 },
    body: {
      appendChild(node) {
        node.parentNode = this;
        created.push(node);
      },
    },
    addEventListener(type, fn) { documentListeners[type] = fn; },
    createElement: () => makeButton(),
    querySelectorAll(selector) {
      if (selector !== 'img') return [];
      return viewerPresent ? [viewerImg] : [];
    },
  };
  const listeners = {};
  const timers = new Map();
  let nextTimer = 0;
  const win = {
    innerWidth: 1600,
    innerHeight: 900,
    localStorage: null,
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    removeEventListener() {},
    setTimeout(fn) {
      timers.set(++nextTimer, fn);
      return nextTimer;
    },
    clearTimeout(id) { timers.delete(id); },
  };

  api.installOneUpCopyButton(doc, win);
  assert.equal(created.length, 1, '大图出现时应注入按钮');
  const btn = created[0];
  assert.equal(btn.innerHTML.indexOf('<svg') !== -1, true, '按钮应使用图标而不是文字');
  assert.equal(btn.getAttribute('aria-label'), '拷贝大图');
  assert.match(btn.style.cssText, /pointer-events:auto/);
  assert.match(btn.style.cssText, /border-radius:50%/);
  assert.equal(btn.getAttribute('data-icloud-oneup-copy'), '');
  assert.ok(btn.listeners.click, '点击监听应存在');
  assert.ok(btn.listeners.mousedown, '拖动监听应存在');
  assert.equal(btn.style.left, '20px', '未保存过位置时应落在默认左下角');
  assert.equal(btn.style.top, '840px');

  doc.hidden = true;
  documentListeners.visibilitychange();
  assert.equal(timers.size, 0, '后台页面暂停轮询');
  viewerPresent = false;
  doc.hidden = false;
  documentListeners.visibilitychange();
  await Promise.resolve();
  assert.equal(created.length, 1, '不能重复注入按钮');
  assert.equal(btn.removed, true, '大图关闭后按钮应被移除');
  assert.equal(btn.listeners.mousedown, undefined, '移除按钮时解除拖动监听');
  assert.equal(timers.size, 0, '回到前台时按事件同步，无常驻轮询');
});

test('拖动大图按钮会记住位置，并且拖动结束那一下不触发拷贝', () => {
  const store = {};
  const listeners = {};
  const button = {
    style: { cssText: '', left: '', top: '', right: '', bottom: '' },
    attrs: {},
    listeners: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    getBoundingClientRect: () => ({ left: 20, top: 840, width: 40, height: 40, right: 60, bottom: 880 }),
  };
  const win = {
    innerWidth: 1600,
    innerHeight: 900,
    localStorage: {
      getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
      setItem: (key, value) => {
        store[key] = value;
      },
    },
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    removeEventListener() {},
  };

  api.enableOneUpButtonDragging(button, win);
  // default spot when nothing is stored
  assert.equal(button.style.left, '20px');

  button.listeners.mousedown({ button: 0, clientX: 30, clientY: 860 });
  listeners.mousemove({ clientX: 400, clientY: 300 });
  listeners.mouseup({});
  assert.equal(button.style.left, '390px', '拖动后应跟随指针（含抓取偏移）');
  assert.equal(button.style.top, '280px');

  const saved = JSON.parse(store['icloud-web-uploader-oneup-copy-position']);
  assert.deepEqual(saved, { left: 390, top: 280 }, '拖动结束应保存位置');
  assert.equal(typeof button.__icloudDraggedAt, 'number', '拖动后应标记，避免把这次点击当成拷贝');

  // a second instance (e.g. reopening the viewer) restores the saved spot
  const reopened = {
    style: { cssText: '', left: '', top: '', right: '', bottom: '' },
    listeners: {},
    setAttribute() {},
    getAttribute: () => null,
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 40, height: 40, right: 40, bottom: 40 }),
  };
  api.enableOneUpButtonDragging(reopened, win);
  assert.equal(reopened.style.left, '390px', '重开时应恢复保存的位置');
  assert.equal(reopened.style.top, '280px');
});

test('Ctrl+C 优先拷贝 OneUp 中已加载的小图，即使鼠标下有其他缩略图', async () => {
  const env = setupKeyboardCopyEnv();
  const png = { type: 'image/png', size: 3200 };
  const currentPhoto = {
    ...env.image,
    naturalWidth: 640,
    naturalHeight: 480,
    ownerDocument: {
      createElement: () => ({ getContext: () => ({ drawImage() {} }), toBlob: callback => callback(png) }),
    },
  };
  env.doc.querySelector = selector => selector === '.OneUpCarouselItem.is-center'
    ? { querySelectorAll: () => [currentPhoto] } : null;
  env.doc.documentElement = { clientWidth: 500, clientHeight: 400 };
  env.doc.querySelectorAll = () => [env.image];
  api.installGridPhotoKeyboardCopy(env.doc, env.win);
  env.handlers.mousemove[0]({ clientX: 50, clientY: 50 });
  env.handlers.keydown[0](fakeKeydownEvent());
  await flushKeyboardCopy();
  assert.equal(env.getWritten(), png);
  assert.match(env.messages.at(-1).message, /640×480/);
});

test('弹层基准高度能区分“我们已加高”和“iCloud 重写了高度”', () => {
  assert.equal(api.resolveCopyMenuBaseHeight({ current: 247.905 }), 247.905);
  assert.equal(
    api.resolveCopyMenuBaseHeight({ current: 277.905, storedBase: 247.905, storedApplied: 30 }),
    247.905
  );
  assert.equal(
    api.resolveCopyMenuBaseHeight({ current: 180, storedBase: 247.905, storedApplied: 30 }),
    180
  );
  assert.equal(api.resolveCopyMenuBaseHeight({ current: NaN, storedBase: 247.905, storedApplied: 30 }), null);
  assert.equal(api.resolveCopyMenuBaseHeight({}), null);
});

test('原生照片菜单的行和高度保持原样', () => {
  const makeNode = (tag) => {
    const node = {
      tagName: String(tag).toUpperCase(),
      children: [],
      attrs: {},
      style: { cssText: '' },
      textContent: '',
      parentNode: null,
      setAttribute(name, value) {
        this.attrs[name] = value;
      },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
      },
      addEventListener() {},
      getBoundingClientRect() {
        return { width: 169, height: 30, top: 0, left: 0, right: 169, bottom: 30 };
      },
      insertBefore(child, ref) {
        const index = ref ? this.children.indexOf(ref) : 0;
        this.children.splice(index < 0 ? 0 : index, 0, child);
        child.parentNode = this;
        return child;
      },
      appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
        return child;
      },
      get firstChild() {
        return this.children[0] || null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll(selector) {
        return selector === '[role="menuitem"]'
          ? this.children.filter((child) => child.getAttribute('role') === 'menuitem')
          : [];
      },
    };
    return node;
  };

  const doc = { createElement: (tag) => makeNode(tag) };
  const list = makeNode('div');
  list.className = 'ui-menu-scroll-container';
  const downloadRow = makeNode('div');
  downloadRow.setAttribute('role', 'menuitem');
  downloadRow.textContent = '下载';
  list.appendChild(downloadRow);

  const content = makeNode('div');
  content.style.height = '247.905px';

  const popover = makeNode('ui-popover');
  popover.style.height = '247.905px';
  popover.closest = (selector) => (selector === 'ui-popover' ? popover : null);
  popover.querySelector = (selector) => {
    if (selector === 'ui-menu-scroll-container[role="menu"]') return list;
    if (selector === 'ui-popover-content') return content;
    return null;
  };

  const deleteRow = makeNode('div');
  deleteRow.setAttribute('role', 'menuitem');
  deleteRow.textContent = '删除';
  list.appendChild(deleteRow);

  assert.equal(api.addGridDownloadMenuItem(doc, {}, popover), true);
  assert.deepEqual(list.children, [downloadRow, deleteRow]);
  assert.equal(popover.style.height, '247.905px');
  assert.equal(content.style.height, '247.905px');
});

test('findNativeDownloadItem 只认 iCloud 自己的下载行', () => {
  const make = (label, marker) => ({
    textContent: label,
    getAttribute: (name) => (marker && name === marker ? '' : null),
    getBoundingClientRect: () => ({ width: 100, height: 30 }),
  });
  const container = {
    querySelectorAll: () => [make('拷贝图像', 'data-icloud-copy-photo'), make('下载原片', 'data-icloud-download-photo'), make('下载')],
  };
  const native = api.findNativeDownloadItem(container);
  assert.ok(native);
  assert.equal(native.textContent, '下载');
  assert.equal(api.findNativeDownloadItem({ querySelectorAll: () => [make('下载原片', 'data-icloud-download-photo')] }), null);
  assert.equal(api.findNativeDownloadItem(null), null);
});

test('清除旧菜单项和旧高度时保留 iCloud 重写的高度', () => {
  const makeNode = (tag) => {
    const node = {
      tagName: String(tag).toUpperCase(),
      children: [],
      attrs: {},
      style: { cssText: '', height: '' },
      textContent: '',
      parentNode: null,
      setAttribute(name, value) { this.attrs[name] = value; },
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
      removeAttribute(name) { delete this.attrs[name]; },
      addEventListener() {},
      getBoundingClientRect() { return { width: 169, height: 30, top: 0, left: 0, right: 169, bottom: 30 }; },
      insertBefore(child, ref) { const i = ref ? this.children.indexOf(ref) : 0; this.children.splice(i < 0 ? 0 : i, 0, child); child.parentNode = this; return child; },
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      get firstChild() { return this.children[0] || null; },
      querySelector(selector) {
        const marker = selector.slice(1, -1);
        if (selector[0] === '[' && selector[selector.length - 1] === ']') {
          return this.children.find((c) => c.getAttribute(marker) !== null) || null;
        }
        return null;
      },
      querySelectorAll(selector) {
        if (selector === '[role="menuitem"]') {
          return this.children.filter((c) => c.getAttribute('role') === 'menuitem');
        }
        const markers = selector.split(', ').map((s) => s.slice(1, -1));
        return this.children.filter((c) => markers.some((marker) => c.getAttribute(marker) !== null));
      },
    };
    return node;
  };
  const doc = { createElement: (tag) => makeNode(tag) };
  const list = makeNode('div');
  const nativeRow = makeNode('div');
  nativeRow.setAttribute('role', 'menuitem');
  nativeRow.textContent = '下载';
  for (const marker of ['data-icloud-copy-photo', 'data-icloud-download-photo']) {
    const staleRow = makeNode('div');
    staleRow.setAttribute('role', 'menuitem');
    staleRow.setAttribute(marker, '');
    staleRow.remove = () => list.children.splice(list.children.indexOf(staleRow), 1);
    list.appendChild(staleRow);
  }
  list.appendChild(nativeRow);
  const content = makeNode('div');
  content.style.height = '180px';
  const popover = makeNode('ui-popover');
  popover.style.height = '277.905px';
  for (const element of [popover, content]) {
    element.setAttribute('data-icloud-copy-menu-base-height', '247.905');
    element.setAttribute('data-icloud-copy-menu-applied-height', '30');
  }
  popover.closest = (s) => (s === 'ui-popover' ? popover : null);
  popover.querySelector = (selector) => {
    if (selector === 'ui-menu-scroll-container[role="menu"]') return list;
    if (selector === 'ui-popover-content') return content;
    return null;
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(api.addGridDownloadMenuItem(doc, {}, popover), true);
    assert.deepEqual(list.children, [nativeRow]);
    assert.equal(popover.style.height, '247.905px');
    assert.equal(content.style.height, '180px');
    assert.deepEqual(popover.attrs, {});
    assert.deepEqual(content.attrs, {});
  }
});



