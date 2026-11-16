const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'youtube-auto-zh-hans-captions.user.js'), 'utf8');

test('prefers a simplified Chinese track even if traditional appears first', () => {
  const start = source.indexOf('  function selectBestCaptionSource(');
  const end = source.indexOf('  function normalizeTranslatorLanguage(', start);
  const context = {CHINESE_LANG_RE:/^(?:zh|zh-Hans|zh-CN)(?:-|$)/i,SIMPLIFIED_CHINESE_LANG_RE:/^zh-(?:Hans|CN|SG)(?:-|$)/i,state:{settings:{translationEngine:'local'}}};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end),context);
  const result = context.selectBestCaptionSource({captions:{playerCaptionsTracklistRenderer:{captionTracks:[{languageCode:'zh-TW',baseUrl:'traditional'},{languageCode:'zh-Hans',baseUrl:'simplified'}]}}});
  assert.equal(result.targetTrack.baseUrl,'simplified');
});

test('cached translated captions are normalized without changing source text', () => {
  const start = source.indexOf('  function applyCues(');
  const end = source.indexOf('  function findCueIndex(', start);
  const state = {loadToken:1,videoId:'v'};
  const context = {state,simplifyChinese:text=>text.replaceAll('這','这').replaceAll('樣','样'),mergeVoiceCues:cues=>cues,showStatus(){},startSyncLoop(){}};
  vm.createContext(context);
  vm.runInContext(source.slice(start,end),context);
  context.applyCues('v',{cues:[{text:'這樣',sourceText:'這個原文'}]},1,'loaded');
  assert.equal(state.cues[0].text,'这样');
  assert.equal(state.cues[0].sourceText,'這個原文');
});
