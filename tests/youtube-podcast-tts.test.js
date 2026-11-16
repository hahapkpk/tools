const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'youtube-auto-zh-hans-captions.user.js'), 'utf8');
const start = source.indexOf('  function parsePodcastAudioStream(');
const end = source.indexOf('  function parseVolcAudioStream(', start);
const captured = [];
const context = {
  Blob, Uint8Array, atob,
  base64ToBytes: value => Uint8Array.from(Buffer.from(value, 'base64')),
  URL: { createObjectURL: blob => { captured.push(blob); return 'blob:test'; } }
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

test('podcast parser accepts audio after completed round and session', async () => {
  const raw = 'event: 361\ndata: {"code":0,"data":"AQID"}\n\nevent: 362\ndata: {"code":0}\n\nevent: 152\ndata: {"code":0}\n\n';
  assert.equal(context.parsePodcastAudioStream(raw), 'blob:test');
  assert.deepEqual([...new Uint8Array(await captured.at(-1).arrayBuffer())], [1, 2, 3]);
});

test('podcast parser rejects incomplete and failed sessions', () => {
  assert.throws(() => context.parsePodcastAudioStream('event: 361\ndata: {"code":0,"data":"AQID"}\n\n'), /完整音频/);
  assert.throws(() => context.parsePodcastAudioStream('event: 362\ndata: {"code":0,"payload":{"is_error":true}}\n\n'), /中断/);
});
