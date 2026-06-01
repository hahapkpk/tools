const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const scriptPath = path.join(__dirname, '..', 'form-memory-autofill.user.js');
const source = fs.readFileSync(scriptPath, 'utf8');

test('脚本识别自定义点击式单选和多选控件', () => {
  assert.match(source, /function getClickableControls\(/);
  assert.match(source, /\[role="radio"\]/);
  assert.match(source, /\[role="checkbox"\]/);
  assert.match(source, /\[aria-checked\]/);
  assert.match(source, /\[aria-selected\]/);
});

test('自定义点击控件会被保存并在恢复时通过 click 触发页面逻辑', () => {
  assert.match(source, /clickables: customClickableSnapshot\(\)/);
  assert.match(source, /restoreCustomClickables\(data\.clickables\)/);
  assert.match(source, /\.click\(\)/);
  assert.match(source, /setTimeout\(\(\) => debouncedSave\(\), 0\)/);
});
