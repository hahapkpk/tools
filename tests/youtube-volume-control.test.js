const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'youtube-auto-zh-hans-captions.user.js'), 'utf8');

function setup() {
  let volume = 0.8;
  const video = {muted:false,get volume(){return volume;},set volume(value){volume=value;}};
  const audio = {volume:1,muted:false};
  const state = {settings:{enabled:true,voiceEnabled:true,originalVolume:0},videoHooked:video,originalVolumeBeforeVoice:null,narrationVolume:null,lastVideoVolume:0.8,expectedVideoVolume:null,remoteAudio:audio,spokenCueIndex:-1};
  const context = {state,getVideoEl:()=>video,getVideoId:()=>'video',cancelSpeech(){state.remoteAudio=null;},saveSettings(){},syncControlValues(){}};
  const start = source.indexOf('  function applyVoiceSettings(');
  const end = source.indexOf('  function showStatus(', start);
  vm.createContext(context);
  vm.runInContext(source.slice(start,end),context);
  return {context,state,video,audio,notify:()=>context.handleVideoVolumeChange({currentTarget:video})};
}

test('background defaults to zero without muting narration', () => {
  const {context,state,video,audio,notify}=setup();
  context.applyVoiceSettings(); notify();
  assert.equal(video.volume,0);
  assert.equal(audio.volume,0.8);
  assert.equal(state.settings.originalVolume,0);
});

test('native volume and mute control narration and survive setting updates', () => {
  const {context,state,video,audio,notify}=setup();
  context.applyVoiceSettings(); notify();
  video.volume=0.35; notify();
  assert.equal(audio.volume,0.35);
  assert.equal(state.settings.originalVolume,0.35);
  video.muted=true; notify();
  assert.equal(audio.muted,true);
  video.muted=false; notify();
  assert.equal(audio.muted,false);
  context.applyVoiceSettings();
  assert.equal(video.volume,0.35);
  state.settings.voiceEnabled=false;
  context.applyVoiceSettings();
  assert.equal(video.volume,0.35);
});

test('background slider does not change narration volume', () => {
  const {context,state,video,audio,notify}=setup();
  context.applyVoiceSettings(); notify();
  state.settings.originalVolume=0.2;
  context.applyVoiceSettings(); notify();
  assert.equal(video.volume,0.2);
  assert.equal(audio.volume,0.8);
});

test('disabling the script stops narration and restores the bound video volume', () => {
  const {context,state,video}=setup();
  context.applyVoiceSettings();
  state.settings.enabled = false;
  context.getVideoEl = () => null;
  context.applyVoiceSettings();
  assert.equal(state.remoteAudio, null);
  assert.equal(video.volume, 0.8);
});
