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

test('拷贝图片以当前渲染源读取二进制并写入系统剪贴板', async () => {
  let request = null;
  let clipboardItem = null;
  const blob = { type: 'image/jpeg' };
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
        write: async (items) => { clipboardItem = items[0]; },
      },
    },
  };

  assert.equal(await api.copyPhotoImageToClipboard(image, win), true);
  assert.equal(request.url, 'https://photos.example/full.jpg');
  assert.equal(request.options.credentials, 'include');
  assert.equal(clipboardItem.items['image/jpeg'], blob);

  const preparedBlob = { type: 'image/png' };
  const preparedWin = {
    fetch: async () => { throw new Error('不应重新读取已验证的图片'); },
    ClipboardItem: function ClipboardItem(items) { this.items = items; },
    navigator: {
      clipboard: {
        write: async (items) => { clipboardItem = items[0]; },
      },
    },
  };
  assert.equal(await api.copyPhotoImageToClipboard(image, preparedWin, preparedBlob), true);
  assert.equal(clipboardItem.items['image/png'], preparedBlob);
});

test('照片对象地址被回收后改用 canvas 重绘读取二进制', async () => {
  let clipboardItem = null;
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
    fetch: async () => {
      throw new TypeError('Failed to fetch');
    },
    ClipboardItem: function ClipboardItem(items) {
      this.items = items;
    },
    navigator: {
      clipboard: {
        write: async (items) => { clipboardItem = items[0]; },
      },
    },
  };

  assert.equal(await api.copyPhotoImageToClipboard(image, win), true);
  assert.equal(drawCalls.length, 2);
  assert.equal(drawCalls[0].el, image);
  assert.equal(drawCalls[0].w, 480);
  assert.equal(drawCalls[0].h, 360);
  assert.equal(drawCalls[1].type, 'image/png');
  assert.equal(clipboardItem.items['image/png'], canvasBlob);
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
        write: async () => {},
      },
    },
  };

  await assert.rejects(api.copyPhotoImageToClipboard(image, win), /无法读取图片数据/);
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
          written = items[0];
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
  assert.equal(env.getWritten().items['image/png'], env.canvasBlob);
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
  assert.equal(env.getWritten().items['image/png'], env.canvasBlob);
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

test('版本号已升级到 1.15.4', () => {
  assert.match(source, /\/\/ @version\s+1\.15\.4/);
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

test('下载原片行插进可交互的菜单列表，而不是 pointer-events:none 的 popover 外层', async () => {
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

  const added = api.addGridDownloadMenuItem(doc, {}, popover);

  assert.equal(added, true);
  const row = list.children.find((child) => child.getAttribute('data-icloud-download-photo') !== null);
  assert.ok(row, '应插入“下载原片”行到可交互的菜单列表里');
  assert.equal(row.parentNode, list);
  assert.equal(list.children.indexOf(row), 0, '应排在 iCloud 自己的下载行之前');
  assert.equal(row.textContent, '下载原片');
  assert.match(row.style.cssText, /pointer-events:auto/);
  assert.ok(
    list.children.every((child) => child.getAttribute('data-icloud-copy-photo') === null),
    '不再注入“拷贝图像”行'
  );
  assert.equal(popover.style.height, '277.905px');
  assert.equal(content.style.height, '277.905px');
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

test('菜单被复用时不会重复插入“下载原片”，也不重复加高弹层', async () => {
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
        if (selector[0] === '[' && selector[selector.length - 1] === ']') {
          const marker = selector.slice(1, -1);
          return this.children.filter((c) => c.getAttribute(marker) !== null);
        }
        return [];
      },
    };
    return node;
  };
  const doc = { createElement: (tag) => makeNode(tag) };
  const list = makeNode('div');
  const nativeRow = makeNode('div');
  nativeRow.setAttribute('role', 'menuitem');
  nativeRow.textContent = '下载';
  const staleCopyRow = makeNode('div');
  staleCopyRow.setAttribute('role', 'menuitem');
  staleCopyRow.setAttribute('data-icloud-copy-photo', '');
  staleCopyRow.textContent = '拷贝图像';
  staleCopyRow.remove = function () {
    const i = list.children.indexOf(this);
    if (i >= 0) list.children.splice(i, 1);
  };
  list.appendChild(staleCopyRow);
  list.appendChild(nativeRow);
  const content = makeNode('div');
  content.style.height = '247.905px';
  const popover = makeNode('ui-popover');
  popover.style.height = '247.905px';
  popover.closest = (s) => (s === 'ui-popover' ? popover : null);
  popover.querySelector = (selector) => {
    if (selector === 'ui-menu-scroll-container[role="menu"]') return list;
    if (selector === 'ui-popover-content') return content;
    return null;
  };

  api.addGridDownloadMenuItem(doc, {}, popover);
  api.addGridDownloadMenuItem(doc, {}, popover);

  assert.equal(
    list.children.filter((c) => c.getAttribute('data-icloud-download-photo') !== null).length,
    1,
    '不能重复插入'
  );
  assert.equal(
    list.children.filter((c) => c.getAttribute('data-icloud-copy-photo') !== null).length,
    0,
    '旧版本残留的“拷贝图像”行应被移除'
  );
  assert.equal(popover.style.height, '277.905px', '重复调用不应继续加高');
});



