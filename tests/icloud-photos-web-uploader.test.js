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

  assert.equal(file.name, 'icloud-screenshot-20260512-080910.png');
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
  assert.equal(files[0].name, 'icloud-screenshot-20260512-080910.png');
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

test('waits for iCloud to create its file input after clicking upload', async () => {
  const image = { name: 'shot.png', type: 'image/png' };
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
  assert.match(messages.at(-1), /Sent to iCloud upload queue/);
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
