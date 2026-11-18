const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'youtube-auto-zh-hans-captions.user.js'), 'utf8');

test('caption fallback ignores other languages, auto-generated tracks and empty responses', async () => {
  const start = source.indexOf('  async function fetchCaptionJsonWithFallback(');
  const end = source.indexOf('  async function primeNativeCaptionRequest(', start);
  const origin = 'https://www.youtube.com';
  const base = origin + '/api/timedtext?v=one&lang=en';
  const attempts = [];
  const context = {
    URL, location: {origin}, getVideoId: () => 'one',
    performance: {getEntriesByType: () => [
      {name: base + '&fmt=json3'},
      {name: base + '&kind=asr'},
      {name: origin + '/api/timedtext?v=one&lang=de'}
    ]},
    makeCaptionUrl: () => base,
    normalizeRawCues: payload => payload.events,
    fetchCaptionJson: async url => {
      attempts.push(url);
      return { events: url === base ? ['correct captions'] : [] };
    }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const result = await context.fetchCaptionJsonWithFallback('one', {baseUrl: base, languageCode:'en'});
  assert.deepEqual(result.events, ['correct captions']);
  assert.deepEqual(attempts, [base + '&fmt=json3', base]);
});

test('leaving a watch route cleans up playback, while changing the same video URL does not restart it', () => {
  const start = source.indexOf('  function checkRoute()');
  const end = source.indexOf('  function scheduleRouteCheck(', start);
  const calls = [];
  const video = {};
  const location = { href: 'https://www.youtube.com/watch?v=one&t=10' };
  const state = {videoId: 'one', videoHooked: video, rafId: 1};
  const context = {
    state, URL, location, getVideoEl: () => video, ensureOverlay() {},
    resetVideoState: id => { state.videoId = id; calls.push('reset'); },
    hookVideoEvents: target => { if (target === null) calls.push('detach'); },
    reloadCurrentVideo: () => calls.push('reload'), scheduleRouteCheck() {}
  };
  vm.createContext(context);
  const extractStart = source.indexOf('  function getVideoId()');
  const extractEnd = source.indexOf('  function getPlayerRoot(', extractStart);
  vm.runInContext(source.slice(extractStart, extractEnd) + source.slice(start, end), context);
  context.checkRoute();
  assert.deepEqual(calls, []);
  location.href = 'https://www.youtube.com/results?v=one';
  context.checkRoute();
  context.checkRoute();
  assert.deepEqual(calls, ['reset', 'detach']);
});

test('skipping a late audio response keeps the next synthesis protected against overlapping requests', async () => {
  const start = source.indexOf('  async function playNextVolcCue()');
  const end = source.indexOf('  function prefetchVolcCues(', start);
  const video = {paused:false, currentTime:0};
  const state = {
    settings: {voiceEnabled:true, offsetMs:0},
    remoteVoiceQueue: [{text:'old', end:1}, {text:'next', start:4, end:8}, {text:'later', end:12}],
    remoteAudio:null, remoteVoiceToken:1, remoteVoiceStarting:false
  };
  const requests = [];
  const context = {
    state, getVideoEl:()=>video, isRemoteVoiceEngine:()=>true, refreshVoiceProgressStatus(){},
    shouldSkipQueuedVolcCue: item => video.currentTime > item.end,
    getVolcAudioUrl: text => new Promise(resolve => requests.push({text,resolve}))
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const pending = context.playNextVolcCue();
  video.currentTime = 4;
  requests[0].resolve('blob:old');
  await pending;
  assert.equal(state.remoteVoiceStarting, true);
  await context.playNextVolcCue();
  assert.deepEqual(requests.map(request => request.text), ['old', 'next']);
  state.remoteVoiceToken++;
  requests[1].resolve('blob:next');
});

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
    simplifyChinese: text => text,
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
  const context = { state, getVideoEl: () => ({ currentTime: 5 }), isRemoteVoiceEngine: () => true, findVoiceCueIndex: () => 3, estimateVoiceLag: () => 0, VOICE_MAX_LAG_SECONDS: 1.5, cancelSpeech() { cancelled = true; } };
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
    mergeSentenceCues: cues => cues, mergeVoiceCues: cues => cues.slice(), cleanCaptionText: text => text, simplifyChinese: text => text, limitLines: cue => cue, showStatus() {}
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const result = await context.translateCuesLocally([{start:0,end:5,text:'a'}, {start:10,end:15,text:'b'}, {start:16,end:20,text:'c'}], 'en', 1, cues => partial.push(cues.map(c => c.text).join(',')));
  assert.deepEqual(order, ['b', 'c', 'a']);
  assert.equal(partial[0], '中b');
  assert.equal(Array.from(result, x => x.text).join(','), '中a,中b,中c');
});

test('translation changes priority when playback seeks to an untranslated cue', async () => {
  const start = source.indexOf('  async function translateCuesLocally(');
  const end = source.indexOf('  async function waitForCaptionSource(', start);
  let time = 0;
  const order = [];
  const context = {state:{loadToken:1},getVideoEl:()=>({currentTime:time}),getLocalTranslator:async()=>({translate:async text=>{order.push(text);if(text==='a') time=16;return text;}}),mergeSentenceCues:cues=>cues,mergeVoiceCues:cues=>cues.slice(),cleanCaptionText:text=>text,simplifyChinese:text=>text,limitLines:cue=>cue,showStatus(){}};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end),context);
  await context.translateCuesLocally([{start:0,end:5,text:'a'},{start:6,end:10,text:'b'},{start:16,end:20,text:'c'}],'en',1,()=>{});
  assert.deepEqual(order,['a','c','b']);
});

test('partial translation never merges voice cues across untranslated gaps', () => {
  const start = source.indexOf('  function buildPartialVoiceCues(');
  const end = source.indexOf('  async function waitForCaptionSource(', start);
  const context = {mergeVoiceCues:cues=>[{start:cues[0].start,end:cues.at(-1).end}]};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end),context);
  const voices = context.buildPartialVoiceCues([{start:0,end:1},undefined,{start:2,end:3},{start:3,end:4}],[true,false,true,true]);
  assert.equal(voices.length,1);
  assert.equal(voices[0].start,2);
  assert.equal(voices[0].end,4);
});

test('voice lag accounts for audio progress and subtitle offset', () => {
  const start = source.indexOf('  function shouldSkipQueuedVolcCue(');
  const end = source.indexOf('  function recoverVolcQueueAfterError(', start);
  const context = {state:{settings:{voiceSyncMode:'smart',offsetMs:0}},VOICE_MAX_LAG_SECONDS:1.5,VOICE_NATURAL_MAX_LAG_SECONDS:6,VOICE_SMART_MAX_LAG_SECONDS:3,VOICE_SMART_LAG_THRESHOLD_SECONDS:0.8,VOICE_SMART_MAX_PLAYBACK_RATE:1.18,clamp:(v,min,max)=>Math.min(max,Math.max(min,Number.isFinite(v)?v:min))};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end),context);
  const item={start:10,end:30};
  assert.equal(context.estimateVoiceLag({currentTime:20},item,{currentTime:10,duration:20}),0);
  assert.equal(context.estimateVoiceLag({currentTime:23},item,{currentTime:10,duration:20}),3);
  assert.equal(context.estimateVoiceLag({currentTime:23},item,{currentTime:0,duration:NaN}),null);
  assert.equal(context.shouldSkipQueuedVolcCue({end:10},{currentTime:14}),true);
  context.state.settings.voiceSyncMode='natural';
  assert.equal(context.shouldSkipQueuedVolcCue({end:10},{currentTime:14}),false);
  assert.equal(context.shouldSkipQueuedVolcCue({end:10},{currentTime:17}),true);
  assert.equal(context.getVolcPlaybackRate(item,{currentTime:20,playbackRate:1.5}),1.5);
  const audio={currentTime:1,duration:20};
  assert.equal(context.alignVoiceToVideo({currentTime:25},item,audio),true);
  assert.equal(audio.currentTime,15);
});

test('seeked on a paused video does not resume remote audio', () => {
  const start = source.indexOf('  function handleVideoPlay()');
  const end = source.indexOf('  function handleVideoSeeking()', start);
  let plays = 0;
  const context = {getVideoEl:()=>({paused:true,seeking:false}),state:{settings:{voiceEnabled:true},remoteAudio:{paused:true,play(){plays++;return Promise.resolve();}}},isRemoteVoiceEngine:()=>true,window:{}};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end),context);
  context.handleVideoPlay();
  assert.equal(plays,0);
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
  const context = {state,getVideoEl:()=>video,isRemoteVoiceEngine:()=>true,shouldSkipQueuedVolcCue:()=>false,refreshVoiceProgressStatus(){},syncNarrationVolume(){},getVolcAudioUrl:()=>new Promise(resolve=>{release=resolve;}),getVolcPlaybackRate:()=>1,VOICE_MAX_LAG_SECONDS:1.5,Audio:function(){this.play=()=>{plays++;return Promise.resolve();};this.addEventListener=()=>{};}};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end),context);
  const pending = context.playNextVolcCue();
  video.paused = true;
  release('blob:new');
  await pending;
  assert.equal(plays,0);
  assert.ok(state.remoteAudio);
});

test('a late cue seeks audio to the current position before playing', async () => {
  const start = source.indexOf('  async function playNextVolcCue()');
  const end = source.indexOf('  function prefetchVolcCues(', start);
  const calls = [];
  const video = {paused:false,seeking:false,currentTime:15};
  const state = {settings:{voiceEnabled:true,offsetMs:0},remoteVoiceQueue:[{text:'one',start:0,end:20}],remoteAudio:null,remoteVoiceStarting:false,remoteVoiceToken:1};
  const context = {state,getVideoEl:()=>video,isRemoteVoiceEngine:()=>true,shouldSkipQueuedVolcCue:()=>false,refreshVoiceProgressStatus(){},syncNarrationVolume(){},getVolcAudioUrl:async()=> 'blob:new',getVolcPlaybackRate:()=>1,VOICE_MAX_LAG_SECONDS:1.5,waitForAudioMetadata:async()=>true,alignVoiceToVideo:()=>{calls.push('align');return true;},Audio:function(){this.play=()=>{calls.push('play');return Promise.resolve();};this.addEventListener=()=>{};}};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end),context);
  await context.playNextVolcCue();
  assert.deepEqual(calls,['align','play']);
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
