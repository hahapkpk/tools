const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = require('../jd-taobao-review-media-waterfall.user.js');
function fixture(options = {}) {
  let time = 0, serial = 0;
  const frames = new Map();
  function element(tagName) {
    const handlers = new Map();
    return { tagName, style: {}, isConnected: true, naturalWidth: 800, naturalHeight: 600,
      clientWidth: 800, clientHeight: 600,
      classList: { toggle() {}, add() {}, remove() {} },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      addEventListener(type, fn) { handlers.set(type, fn); },
      removeEventListener(type) { handlers.delete(type); },
      setPointerCapture() {}, releasePointerCapture() {},
      fire(type, values = {}) { const e = { button: 0, pointerId: 1, clientX: 500, clientY: 350, deltaY: -100, deltaMode: 0, target: this, preventDefault() { this.prevented = true; }, ...values }; handlers.get(type)?.(e); return e; },
      closest: () => null
    };
  }
  const box = element('DIV'), media = element('IMG');
  let state;
  const host = { performance: { now: () => time }, requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; }, cancelAnimationFrame(id) { frames.delete(id); }, matchMedia: () => ({ matches: !!options.reduced }) };
  const zoom = api.createSmoothPreviewZoom(box, media, { host, initial: { src: 'test', scale: 1, offsetX: 0, offsetY: 0 }, onChange: value => state = value });
  function step(ms = 16) { time += ms; const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(time)); }
  function settle() { for (let i = 0; i < 100 && frames.size; i++) step(); assert.equal(frames.size, 0); }
  return { box, media, zoom, frames, step, settle, state: () => state };
}
test('wheel zoom eases over frames and preserves cursor anchor', () => {
  const f = fixture();
  assert.equal(f.box.fire('wheel').prevented, true);
  assert.equal(f.state().scale, 1);
  f.step(); const first = f.state();
  assert.ok(first.scale > 1 && first.scale < 1.3);
  assert.ok(Math.abs((100 - first.offsetX) / first.scale - 100) < 1e-8);
  f.settle(); assert.ok(f.state().scale > first.scale);
});
test('wheel during drag cannot compete with drag RAF', () => {
  const f = fixture(); f.box.fire('wheel'); f.settle();
  const before = f.state(); f.media.fire('pointerdown');
  f.box.fire('wheel'); f.step();
  assert.equal(f.state().scale, before.scale);
  f.media.fire('pointermove', { clientX: 520 }); f.step();
  assert.equal(f.state().scale, before.scale);
});
test('dispose cancels frames and removes interaction handlers', () => {
  const f = fixture(); f.box.fire('wheel'); assert.equal(f.frames.size, 1);
  f.zoom.dispose(); assert.equal(f.frames.size, 0);
  assert.equal(f.box.fire('wheel').prevented, undefined);
  f.media.fire('click'); assert.equal(f.frames.size, 0);
});
test('resize stops easing and clamps camera to the new viewport', () => {
  const f = fixture(); f.box.fire('wheel'); f.step();
  f.box.clientWidth = 0; f.box.clientHeight = 0;
  f.zoom.reconcile(); assert.equal(f.frames.size, 0);
  assert.equal(f.state().offsetX, 0); assert.equal(f.state().offsetY, 0);
});
test('wheel units, fractional input, limits, reduced motion and video guards', () => {
  const a = fixture(), b = fixture();
  a.box.fire('wheel', { deltaY: -32 }); b.box.fire('wheel', { deltaY: -2, deltaMode: 1 });
  a.settle(); b.settle(); assert.equal(a.state().scale, b.state().scale);
  const f = fixture({ reduced: true }); f.box.fire('wheel', { deltaY: -0.25 });
  assert.ok(f.state().scale > 1); assert.equal(f.frames.size, 0);
  for (let i = 0; i < 100; i++) f.box.fire('wheel', { deltaY: -200 });
  assert.equal(f.state().scale, 5);
  for (let i = 0; i < 100; i++) f.box.fire('wheel', { deltaY: 200 });
  assert.equal(f.state().scale, 1); assert.equal(f.state().offsetX, 0);
  f.media.tagName = 'VIDEO'; assert.equal(f.box.fire('wheel').prevented, undefined);
  f.media.fire('click'); assert.equal(f.state().scale, 1);
});

test('drag interrupts easing without jumping and reset returns exactly to 1x', () => {
  const f = fixture(); f.box.fire('wheel'); f.step();
  const before = f.state();
  f.media.fire('pointerdown');
  assert.equal(f.frames.size, 0);
  assert.deepEqual(f.state(), before);
  f.media.fire('pointermove', { clientX: 530, clientY: 360 }); f.step();
  assert.equal(f.state().scale, before.scale);
  assert.ok(f.state().offsetX > before.offsetX);
  f.media.fire('pointerup'); f.media.fire('click');
  assert.equal(f.frames.size, 0, 'drag must not trigger click reset');
  f.media.fire('click'); f.settle();
  assert.equal(f.state().scale, 1); assert.equal(f.state().offsetX, 0); assert.equal(f.state().offsetY, 0);
});
