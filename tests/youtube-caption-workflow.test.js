const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'youtube-auto-zh-hans-captions.user.js'), 'utf8');

test('switching video stops translation before the next sentence', async () => {
  const start = source.indexOf('  async function translateCuesLocally(');
  const end = source.indexOf('  async function waitForCaptionSource(', start);
  let release;
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  let calls = 0;
  const state = { loadToken: 1 };
  const context = {
    state,
    getLocalTranslator: async () => ({ translate: () => { calls++; return new Promise(resolve => { release = resolve; signalStarted(); }); } }),
    mergeSentenceCues: cues => cues,
    cleanCaptionText: text => text,
    limitLines: cue => cue,
    showStatus() {}
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const pending = context.translateCuesLocally([{ text: 'first' }, { text: 'second' }], 'en', 1);
  await started;
  state.loadToken = 2;
  release('第一句');
  const result = await pending;
  assert.equal(calls, 1);
  assert.equal(result.length, 0);
});

test('remote seeking compares the same voice cue index', () => {
  const start = source.indexOf('  function handleVideoSeeking()');
  const end = source.indexOf('  function syncVoice(', start);
  const state = { remoteVoiceCurrent: null, spokenCueIndex: 3, seekVoiceSuppressUntil: -1 };
  const context = { state, getVideoEl: () => ({ currentTime: 5 }), isRemoteVoiceEngine: () => true, findVoiceCueIndex: () => 3, cancelSpeech() {} };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  context.handleVideoSeeking();
  assert.equal(state.seekVoiceSuppressUntil, 3);
});

test('podcast prefetch is limited to the next cue', () => {
  const start = source.indexOf('  function enqueueVolcCue(');
  const end = source.indexOf('  function shouldSkipQueuedVolcCue(', start);
  let prefetched;
  const context = {
    state: { settings: { voiceEngine: 'podcast' }, remoteVoiceQueue: [] },
    applyVoiceTerminology: value => value,
    refreshVoiceProgressStatus() {},
    prefetchVolcCues: (index, count) => { prefetched = [index, count]; },
    playNextVolcCue() {}
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  context.enqueueVolcCue({ text: '测试语音', start: 0, end: 1 }, 2);
  assert.deepEqual(prefetched, [3, 1]);
});
