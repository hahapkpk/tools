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

test('页面取消 dragover 时拖放备用通道才报告已接受', () => {
  const dispatched = [];
  const target = {
    dispatchEvent(event) {
      dispatched.push(event.type);
      if (event.type === 'dragover') event.preventDefault();
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

  const accepted = api.dropFilesOnICloudPage(
    [fakeFile('photo.jpg', 'image/jpeg')],
    doc,
    { DataTransfer: DataTransferStub, DragEvent: EventStub, Event: EventStub }
  );

  assert.equal(accepted, true);
  assert.deepEqual(dispatched, ['dragenter', 'dragover', 'drop']);
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


test('面板拖拽会阻止 drop 冒泡，避免 iCloud 重复入队', () => {
  assert.match(
    source,
    /event\.stopPropagation\(\);\r?\n\s*panel\.classList\.remove\('is-dragging'\);/
  );
});

test('版本号已升级到 1.13.1', () => {
  assert.match(source, /\/\/ @version\s+1\.13\.1/);
});
