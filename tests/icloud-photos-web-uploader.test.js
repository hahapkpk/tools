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
