const assert = require('node:assert/strict');
const test = require('node:test');

const helpers = require('../icloud-photos-web-uploader.user.js');

test('accepts common image files and rejects non-images', () => {
  assert.equal(helpers.isImageLikeFile({ name: 'shot.png', type: 'image/png' }), true);
  assert.equal(helpers.isImageLikeFile({ name: 'photo.heic', type: '' }), true);
  assert.equal(helpers.isImageLikeFile({ name: 'notes.txt', type: 'text/plain' }), false);
  assert.equal(helpers.isImageLikeFile({ name: 'archive.zip', type: '' }), false);
});

test('creates stable screenshot names from clipboard image blobs', () => {
  const file = helpers.createNamedImageFile(
    { type: 'image/png', size: 10 },
    new Date('2026-05-12T08:09:10.321Z')
  );

  assert.match(file.name, /^icloud-screenshot-20260512-080910-321-[0-9a-f]{4}\.png$/);
  assert.equal(file.type, 'image/png');
});

test('filters paste items down to image files', () => {
  const png = { type: 'image/png', size: 1 };
  const txt = { type: 'text/plain', size: 1 };
  const event = {
    clipboardData: {
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => png },
        { kind: 'file', type: 'text/plain', getAsFile: () => txt },
        { kind: 'string', type: 'text/html', getAsFile: () => null },
      ],
    },
  };

  const files = helpers.extractImageFilesFromPaste(event, new Date('2026-05-12T08:09:10Z'));

  assert.equal(files.length, 1);
  assert.match(files[0].name, /^icloud-screenshot-20260512-080910-000-[0-9a-f]{4}\.png$/);
});

test('ignores the helper panel file input when searching for iCloud upload input', () => {
  const helperInput = {
    multiple: true,
    getAttribute: () => 'image/*',
    closest: (selector) => selector === '#icloud-web-uploader-panel',
  };
  const icloudInput = {
    multiple: true,
    getAttribute: () => 'image/*',
    closest: () => null,
  };
  const doc = {
    querySelectorAll: () => [helperInput, icloudInput],
  };

  assert.equal(helpers.findICloudFileInput(doc), icloudInput);
});

test('searches same-origin iframes for iCloud upload input', () => {
  const frameInput = {
    multiple: true,
    getAttribute: () => 'image/*',
    closest: () => null,
  };
  const frameDocument = {
    querySelectorAll: (selector) => (selector === 'input[type="file"]' ? [frameInput] : []),
  };
  const frame = {
    contentDocument: frameDocument,
    contentWindow: { document: frameDocument },
  };
  const doc = {
    querySelectorAll: (selector) => (selector === 'iframe, frame' ? [frame] : []),
  };

  assert.equal(helpers.findICloudFileInput(doc), frameInput);
});

test('waits for iCloud to create its file input after clicking upload', async () => {
  const image = { name: 'shot.jpg', type: 'image/jpeg' };
  const events = [];
  let clicked = false;
  let inserted = false;
  const input = {
    multiple: true,
    files: null,
    getAttribute: () => 'image/*',
    closest: () => null,
    dispatchEvent: (event) => events.push(event.type),
  };
  const uploadButton = {
    getAttribute: (name) => (name === 'aria-label' ? 'Upload' : ''),
    textContent: '',
    closest: () => null,
    click: () => {
      clicked = true;
      setTimeout(() => {
        inserted = true;
      }, 5);
    },
  };
  const doc = {
    querySelectorAll: (selector) => {
      if (selector === 'input[type="file"]') return inserted ? [input] : [];
      return [uploadButton];
    },
  };
  class FakeDataTransfer {
    constructor() {
      this.files = [];
      this.items = {
        add: (file) => {
          this.files.push(file);
        },
      };
    }
  }
  const win = {
    DataTransfer: FakeDataTransfer,
    Event,
  };
  const messages = [];

  const uploaded = await helpers.uploadViaICloudPage([image], doc, win, (message) => {
    messages.push(message);
  });

  assert.equal(clicked, true);
  assert.equal(uploaded, true);
  assert.deepEqual(input.files, [image]);
  assert.deepEqual(events, ['input', 'change']);
  assert.match(messages.at(-1), /已发送到 iCloud 上传队列/);
});

test('calculates draggable panel position and clamps it inside viewport', () => {
  const position = helpers.calculateDraggedPanelPosition({
    pointerX: 20,
    pointerY: 900,
    offsetX: 50,
    offsetY: 20,
    panelWidth: 280,
    panelHeight: 190,
    viewportWidth: 320,
    viewportHeight: 240,
    margin: 8,
  });

  assert.deepEqual(position, { left: 8, top: 42 });
});

test('keeps JPEG files and plans other images for iCloud web JPEG conversion', () => {
  assert.equal(helpers.isJpegLikeFile({ name: 'photo.jpeg', type: '' }), true);
  assert.equal(helpers.isJpegLikeFile({ name: 'photo.jpg', type: 'image/jpeg' }), true);
  assert.equal(helpers.shouldConvertForICloudWeb({ name: 'shot.png', type: 'image/png' }), true);
  assert.equal(helpers.shouldConvertForICloudWeb({ name: 'photo.jpg', type: 'image/jpeg' }), false);
  assert.equal(helpers.getConvertedJpegFileName('PixPin_2026-05-12.png'), 'PixPin_2026-05-12.jpg');
});

test('normalizes non-JPEG images through a converter before upload', async () => {
  const jpg = { name: 'camera.jpg', type: 'image/jpeg' };
  const png = { name: 'screenshot.png', type: 'image/png' };
  const convertedPng = { name: 'screenshot.jpg', type: 'image/jpeg' };
  const seenMessages = [];

  const files = await helpers.normalizeFilesForICloudWebUpload(
    [jpg, png],
    {},
    (message) => seenMessages.push(message),
    async (file) => {
      assert.equal(file, png);
      return convertedPng;
    }
  );

  assert.deepEqual(files, [jpg, convertedPng]);
  assert.match(seenMessages.join('\n'), /已将 1 张图片转换为 JPEG/);
});

test('uses Simplified Chinese panel labels', () => {
  const text = helpers.getPanelText();

  assert.equal(text.title, 'iCloud 上传');
  assert.equal(text.tooltip, '点击选择 · 粘贴 · 拖拽');
  assert.equal(text.waiting, '等待图片');
});

test('soft refresh navigates away from the library then back without reloading', async () => {
  const clicks = [];
  function makeItem(label) {
    return {
      textContent: label,
      click: () => clicks.push(label),
      closest: () => null,
    };
  }
  const library = makeItem('图库');
  const pivot = makeItem('最近项目');
  const doc = {
    getElementById: () => null,
    querySelectorAll: (selector) => {
      if (selector === 'a, button, [role="button"], [role="menuitem"], [role="tab"], [role="treeitem"]') {
        return [library, pivot];
      }
      return [];
    },
  };

  const softened = await helpers.softRefreshLibraryView(doc, {}, { pivotDelay: 0 });

  assert.equal(softened, true);
  assert.deepEqual(clicks, ['最近项目', '图库']);
});

test('soft refresh returns false when sidebar items are missing', async () => {
  const doc = {
    getElementById: () => null,
    querySelectorAll: () => [],
  };

  const softened = await helpers.softRefreshLibraryView(doc, {}, { pivotDelay: 0 });

  assert.equal(softened, false);
});

test('findSidebarItem matches labels including trailing counts', () => {
  const library = {
    textContent: '图库 (123)',
    click: () => {},
    closest: () => null,
  };
  const doc = {
    getElementById: () => null,
    querySelectorAll: () => [library],
  };

  const found = helpers.findSidebarItem(doc, ['图库', 'Library']);
  assert.equal(found, library);
});


test('only mounts the panel inside the inner iCloud Photos application frame', () => {
  assert.equal(
    helpers.isInICloudPhotosAppFrame({
      location: { pathname: '/applications/photos3/current/en-us/index.html' },
    }),
    true
  );
  assert.equal(
    helpers.isInICloudPhotosAppFrame({
      location: { pathname: '/applications/photos/current/zh-cn/index.html' },
    }),
    true
  );
  assert.equal(
    helpers.isInICloudPhotosAppFrame({ location: { pathname: '/photos/' } }),
    false
  );
  assert.equal(helpers.isInICloudPhotosAppFrame(undefined), false);
  assert.equal(helpers.isInICloudPhotosAppFrame({}), false);
});

test('calculates resizable panel size and clamps it inside viewport', () => {
  const size = helpers.calculatePanelSize({
    width: 900,
    height: 80,
    viewportWidth: 640,
    viewportHeight: 420,
    margin: 8,
  });

  assert.deepEqual(size, { width: 624, height: 220 });
});

test('falls back to drop upload when iCloud file input is unavailable', async () => {
  const image = { name: 'shot.jpg', type: 'image/jpeg' };
  const dropped = [];
  const body = {
    dispatchEvent: (event) => {
      dropped.push(event.type);
      return true;
    },
  };
  const doc = {
    body,
    documentElement: body,
    querySelectorAll: () => [],
  };
  class FakeDataTransfer {
    constructor() {
      this.files = [];
      this.items = {
        add: (file) => {
          this.files.push(file);
        },
      };
    }
  }
  const win = {
    DataTransfer: FakeDataTransfer,
    Event,
    DragEvent: class {
      constructor(type, options) {
        this.type = type;
        this.dataTransfer = options.dataTransfer;
      }
    },
  };
  const messages = [];

  const uploaded = await helpers.uploadViaICloudPage([image], doc, win, (message) => {
    messages.push(message);
  });

  assert.equal(uploaded, true);
  assert.deepEqual(dropped, ['dragenter', 'dragover', 'drop']);
  assert.match(messages.at(-1), /已通过拖拽上传通道发送/);
});
