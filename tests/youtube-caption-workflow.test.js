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
    getVideoEl: () => ({ currentTime: 0 }),
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

test('seeking within the current remote cue does not interrupt audio', () => {
  const start = source.indexOf('  function handleVideoSeeking()');
  const end = source.indexOf('  function syncVoice(', start);
  const state = { remoteAudio: {}, remoteVoiceCurrent: { index: 3 }, remoteVoiceQueue: [1], spokenCueIndex: 3, seekVoiceSuppressUntil: -1 };
  let cancelled = false;
  const context = { state, getVideoEl: () => ({ currentTime: 5 }), isRemoteVoiceEngine: () => true, findVoiceCueIndex: () => 3, cancelSpeech() { cancelled = true; } };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  context.handleVideoSeeking();
  assert.equal(cancelled, false);
  assert.equal(state.spokenCueIndex, 3);
  assert.equal(state.remoteVoiceQueue.length, 0);
});

test('seeking while audio is still generating allows the target cue to restart', () => {
  const start = source.indexOf('  function handleVideoSeeking()');
  const end = source.indexOf('  function syncVoice(', start);
  const state = { remoteAudio: null, remoteVoiceCurrent: null, spokenCueIndex: 3, seekVoiceSuppressUntil: -1 };
  let cancelled = false;
  const context = { state, getVideoEl: () => ({ currentTime: 5 }), isRemoteVoiceEngine: () => true, findVoiceCueIndex: () => 3, cancelSpeech() { cancelled = true; } };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  context.handleVideoSeeking();
  assert.equal(cancelled, true);
  assert.equal(state.spokenCueIndex, -1);
});

test('translation starts at the current position and publishes before finishing', async () => {
  const start = source.indexOf('  async function translateCuesLocally(');
  const end = source.indexOf('  async function waitForCaptionSource(', start);
  const order = [];
  const partial = [];
  const context = {
    state: { loadToken: 1 }, getVideoEl: () => ({ currentTime: 12 }),
    getLocalTranslator: async () => ({ translate: async text => { order.push(text); return `中${text}`; } }),
    mergeSentenceCues: cues => cues, cleanCaptionText: text => text, limitLines: cue => cue, showStatus() {}
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const result = await context.translateCuesLocally([{start:0,end:5,text:'a'}, {start:10,end:15,text:'b'}, {start:16,end:20,text:'c'}], 'en', 1, cues => partial.push(cues.map(c => c.text).join(',')));
  assert.deepEqual(order, ['b', 'c', 'a']);
  assert.equal(partial[0], '中b');
  assert.equal(Array.from(result, x => x.text).join(','), '中a,中b,中c');
});

test('progressive publication remaps existing remote voice indexes', () => {
  const start = source.indexOf('  function publishTranslatedCues(');
  const end = source.indexOf('  async function switchToLocalTranslationAfterYouTubeRateLimit(', start);
  const state = {loadToken:1, videoId:'v', voiceCues:[{start:10,end:15}], cues:[{start:10,end:15}], spokenCueIndex:0, seekVoiceSuppressUntil:-1, remoteVoiceQueue:[{start:10,index:0}], remoteVoiceCurrent:null, rafId:1};
  const context = {state, isRemoteVoiceEngine:()=>true, mergeVoiceCues:cues=>cues, startSyncLoop() {}};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end),context);
  context.publishTranslatedCues('v',[{start:0,end:5},{start:10,end:15}],[],1,true);
  assert.equal(state.spokenCueIndex,1);
  assert.equal(state.remoteVoiceQueue[0].index,1);
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

test('audio finishing after a seek does not play an old cue', async () => {
  const start = source.indexOf('  async function playNextVolcCue()');
  const end = source.indexOf('  function prefetchVolcCues(', start);
  let release;
  let audioCreated = false;
  const state = {settings:{voiceEnabled:true},remoteVoiceQueue:[{text:'one',start:0,end:2}],remoteAudio:null,remoteVoiceStarting:false,remoteVoiceToken:1};
  const context = {state,getVideoEl:()=>({paused:false,currentTime:1}),isRemoteVoiceEngine:()=>true,shouldSkipQueuedVolcCue:()=>false,refreshVoiceProgressStatus(){},getVolcAudioUrl:()=>new Promise(resolve=>{release=resolve;}),Audio:function(){audioCreated=true;}};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end),context);
  const pending = context.playNextVolcCue();
  state.remoteVoiceToken = 2;
  release('blob:old');
  await pending;
  assert.equal(audioCreated,false);
});

test('a paused video does not start a newly generated voice', async () => {
  const start = source.indexOf('  async function playNextVolcCue()');
  const end = source.indexOf('  function prefetchVolcCues(', start);
  let release;
  let plays = 0;
  const video = {paused:false,currentTime:1};
  const state = {settings:{voiceEnabled:true},remoteVoiceQueue:[{text:'one',start:0,end:2}],remoteAudio:null,remoteVoiceStarting:false,remoteVoiceToken:1};
  const context = {state,getVideoEl:()=>video,isRemoteVoiceEngine:()=>true,shouldSkipQueuedVolcCue:()=>false,refreshVoiceProgressStatus(){},getVolcAudioUrl:()=>new Promise(resolve=>{release=resolve;}),getVolcPlaybackRate:()=>1,Audio:function(){this.play=()=>{plays++;return Promise.resolve();};this.addEventListener=()=>{};}};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end),context);
  const pending = context.playNextVolcCue();
  video.paused = true;
  release('blob:new');
  await pending;
  assert.equal(plays,0);
  assert.ok(state.remoteAudio);
});

test('a seek during retry delay prevents another remote request', async () => {
  const start = source.indexOf('  async function requestRemoteAudioWithRetry(');
  const end = source.indexOf('  function requestRemoteAudio(', start);
  let attempts = 0;
  let finishDelay;
  const state = { remoteVoiceToken: 1 };
  const context = {
    state,
    requestRemoteAudio: async () => { attempts++; throw Object.assign(new Error('limit'), { volcRetryable: true }); },
    isRetryableVolcError: error => error.volcRetryable,
    updateVoiceProgressStatus() {},
    sleep: () => new Promise(resolve => { finishDelay = resolve; })
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const pending = context.requestRemoteAudioWithRetry('text');
  while (!finishDelay) await new Promise(resolve => setImmediate(resolve));
  state.remoteVoiceToken++;
  finishDelay();
  await assert.rejects(pending, /取消/);
  assert.equal(attempts, 1);
});
