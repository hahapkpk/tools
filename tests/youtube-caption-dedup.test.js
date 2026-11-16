const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'youtube-auto-zh-hans-captions.user.js'), 'utf8');
const start = src.indexOf('  function mergeSentenceCues(');
const end = src.indexOf('  function mergeVoiceCues(', start);
const context = { limitLines: cue => cue, countTextUnits: text => text.length, cleanCaptionText: text => text.trim(), needsSpace: (a,b) => /[A-Za-z]$/.test(a) && /^[A-Za-z]/.test(b) };
vm.createContext(context);
vm.runInContext(src.slice(start,end), context);

test('overlapping repeated or extended captions are not repeated', () => {
  const result = context.mergeSentenceCues([{start:0,end:3,text:'慢慢来，小心。'},{start:1,end:4,text:'慢慢来，小心。'}]);
  assert.equal(result.length,1);
  assert.equal(result[0].text,'慢慢来，小心。');
  assert.equal(result[0].end,4);
  const english = context.mergeSentenceCues([{start:0,end:3,text:'take it'},{start:1,end:4,text:'take it slowly'}]);
  assert.equal(english[0].text,'take it slowly');
});

test('separate repeated speech is preserved', () => {
  const result = context.mergeSentenceCues([{start:0,end:1,text:'慢慢来，小心。'},{start:1,end:2,text:'慢慢来，小心。'}]);
  assert.equal(result.length,2);
});
