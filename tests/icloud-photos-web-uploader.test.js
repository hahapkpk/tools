const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const api = require('../icloud-photos-web-uploader.user.js');
const source = fs.readFileSync(
  path.join(__dirname, '..', 'icloud-photos-web-uploader.user.js'),
  'utf8'
);

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

test('滚动缩放只在指针位于缩放目标内时复用已附加元素', () => {
  // 回归：状态清理函数被重命名后，滚轮临时状态不能再泄漏到下一次手势。
  assert.match(source, /function resetView\(\)/);
  assert.match(source, /const overTarget = event\.target &&/);
  assert.match(source, /if \(overTarget\) img = state\.element;/);
  assert.match(source, /function clampTranslation\(\)/);
  assert.doesNotMatch(source, /const img = state\.element \|\| findPreviewImage/);
});

test('刷新轮询不再用整页 reload 作为超时兜底', () => {
  assert.match(source, /let pollActive = false;/);
  assert.match(source, /if \(!pollActive\) return;/);
  assert.doesNotMatch(source, /超时，强制刷新/);
});

test('粘贴监听器按目标幂等注册，不会因首次挂载过早而永久失效', () => {
  assert.doesNotMatch(source, /let pasteListenerInstalled = false;/);
  assert.match(source, /const PASTE_FLAG = '__iCloudUploaderPasteHandler';/);
  assert.match(source, /if \(target\[PASTE_FLAG\] === dispatchPaste\) return;/);
});

test('面板拖拽会阻止 drop 冒泡，避免 iCloud 重复入队', () => {
  assert.match(source, /Keep the drop from bubbling to iCloud's own drop handling/);
  assert.match(source, /event\.stopPropagation\(\);\n\s*panel\.classList\.remove\('is-dragging'\);/);
});

test('画布尺寸受浏览器上限保护', () => {
  assert.match(source, /const MAX_CANVAS_EDGE_PX = 8192;/);
  assert.match(source, /const DECODE_TIMEOUT_MS = 20000;/);
  assert.match(source, /const ENCODE_TIMEOUT_MS = 30000;/);
});

test('版本号已升级', () => {
  assert.match(source, /\/\/ @version\s+1\.13\.0/);
});
