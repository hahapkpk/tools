# 京东与淘宝评价图片墙增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为当前评价图片墙增加浏览计数、键盘导航、返回定位、加载反馈、本地筛选、缩略图尺寸、信息折叠、单图操作与当前页会话恢复。

**Architecture:** 继续发布单个 `jd-taobao-review-media-waterfall.user.js`，保持平台 adapter 与真实媒体提取逻辑不变。新增共享会话状态与视图派生函数，UI 只基于已收集媒体进行本地呈现和恢复，加载仍由原评价滚动与响应捕获驱动。

**Tech Stack:** Tampermonkey userscript、原生 DOM、`MutationObserver`、Node.js `node:test`、Kimi WebBridge 实页验证。

---

## 文件结构

- Modify: `jd-taobao-review-media-waterfall.user.js`：新增会话状态、视图控制、键盘交互、加载状态与操作入口。
- Modify: `tests/jd-taobao-review-media-waterfall.test.js`：验证纯状态函数、加载状态机与新增 UI 标志。
- Verify: `docs/superpowers/specs/2026-05-27-jd-taobao-review-media-wall-enhancements-design.md`：逐项回归规格覆盖。

### Task 1: 会话状态、媒体筛选与预览位置

**Files:**
- Modify: `tests/jd-taobao-review-media-waterfall.test.js`
- Modify: `jd-taobao-review-media-waterfall.user.js`

- [ ] **Step 1: Write the failing tests**

```javascript
test('会话状态仅在当前脚本实例内恢复筛选尺寸与浏览位置', () => {
  const session = api.createWallSession();
  session.setFilter('video');
  session.setCardSize('large');
  session.rememberView({ scrollTop: 420, previewKey: 'b.mp4' });
  assert.deepEqual(session.snapshot(), {
    mediaFilter: 'video',
    cardSize: 'large',
    scrollTop: 420,
    previewKey: 'b.mp4',
    contextCollapsed: false,
    loadingState: 'idle',
    stagnantLoads: 0
  });
});

test('类型筛选决定预览计数和切换集合', () => {
  const items = [{ type: 'image', src: 'a.jpg' }, { type: 'video', src: 'b.mp4' }];
  assert.deepEqual(api.filterMedia(items, 'video').map(item => item.src), ['b.mp4']);
  const state = api.createWallState();
  state.openWall();
  state.openPreview(api.filterMedia(items, 'video'), 0);
  assert.equal(state.snapshot().previewTotal, 1);
  assert.equal(state.snapshot().previewPosition, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/jd-taobao-review-media-waterfall.test.js`

Expected: FAIL because `createWallSession` and `filterMedia` are not defined and preview counts are absent.

- [ ] **Step 3: Write minimal implementation**

```javascript
function filterMedia(items, filter) {
  return filter === 'all' ? items.slice() : items.filter((item) => item.type === filter);
}

function createWallSession() {
  const saved = { mediaFilter: 'all', cardSize: 'medium', scrollTop: 0, previewKey: '', contextCollapsed: false, loadingState: 'idle', stagnantLoads: 0 };
  return {
    setFilter: (value) => { saved.mediaFilter = value; },
    setCardSize: (value) => { saved.cardSize = value; },
    rememberView: ({ scrollTop, previewKey }) => Object.assign(saved, { scrollTop, previewKey }),
    snapshot: () => ({ ...saved })
  };
}
```

Extend `createWallState().snapshot()` with `previewPosition` and `previewTotal`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/jd-taobao-review-media-waterfall.test.js`

Expected: PASS including existing tests.

### Task 2: Toolbar controls, keyboard flow and return positioning

**Files:**
- Modify: `tests/jd-taobao-review-media-waterfall.test.js`
- Modify: `jd-taobao-review-media-waterfall.user.js`

- [ ] **Step 1: Write the failing tests**

```javascript
test('图片墙包含类型、尺寸与键盘可达的卡片控制', () => {
  assert.match(source, /rmw-filter/);
  assert.match(source, /rmw-size/);
  assert.match(source, /card\.tabIndex\s*=\s*0/);
  assert.match(source, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(source, /scrollIntoView/);
  assert.match(source, /rmw-current/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/jd-taobao-review-media-waterfall.test.js`

Expected: FAIL because toolbar controls, keyboard-open handling and returned-card highlight are absent.

- [ ] **Step 3: Write minimal implementation**

Add toolbar button groups in `openWall()`, pass filtered items into `renderCards()`, apply grid size classes, make each card focusable, handle `Enter`/space, and on preview close call a helper that finds the current `data-media-key` card, runs `scrollIntoView({ block: 'center' })`, and applies a temporary `.rmw-current` class.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/jd-taobao-review-media-waterfall.test.js`

Expected: PASS including existing overlap and close-behavior tests.

### Task 3: Loading lifecycle and current-page restoration

**Files:**
- Modify: `tests/jd-taobao-review-media-waterfall.test.js`
- Modify: `jd-taobao-review-media-waterfall.user.js`

- [ ] **Step 1: Write the failing tests**

```javascript
test('加载状态防止重复请求并在连续无新增后结束', () => {
  const session = api.createWallSession();
  assert.equal(session.beginLoad(), true);
  assert.equal(session.beginLoad(), false);
  session.finishLoad(false);
  session.beginLoad();
  session.finishLoad(false);
  assert.equal(session.snapshot().loadingState, 'exhausted');
  session.retryLoad();
  assert.equal(session.snapshot().loadingState, 'idle');
});

test('入口复用同一页面会话状态对象', () => {
  assert.match(source, /const wallSession = createWallSession\(\)/);
  assert.match(source, /openWall\(doc, adapter, wallSession\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/jd-taobao-review-media-waterfall.test.js`

Expected: FAIL because loading methods and persistent page-session wiring are absent.

- [ ] **Step 3: Write minimal implementation**

Implement `beginLoad()`, `finishLoad(added)`, `failLoad()` and `retryLoad()` on the session object. Instantiate one `wallSession` in `init()` and pass it into each reopened wall. Use it to restore grid scroll, filter and size; render a retry button when `loadingState === 'error'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/jd-taobao-review-media-waterfall.test.js`

Expected: PASS including loading lifecycle tests.

### Task 4: Preview utilities and real-page verification

**Files:**
- Modify: `tests/jd-taobao-review-media-waterfall.test.js`
- Modify: `jd-taobao-review-media-waterfall.user.js`

- [ ] **Step 1: Write the failing tests**

```javascript
test('预览提供计数、评价折叠、打开与下载原图入口', () => {
  assert.match(source, /rmw-counter/);
  assert.match(source, /rmw-context-toggle/);
  assert.match(source, /打开原图/);
  assert.match(source, /下载原图/);
  assert.match(source, /contextCollapsed/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/jd-taobao-review-media-waterfall.test.js`

Expected: FAIL because preview utilities are absent.

- [ ] **Step 3: Write minimal implementation**

Add preview count, context-collapse toggle and two links bound to `item.src`; fold state into `wallSession`. Raise userscript version and add `@updateURL` / `@downloadURL` for direct Tampermonkey update support.

- [ ] **Step 4: Run automated verification**

Run:

```powershell
node --check jd-taobao-review-media-waterfall.user.js
node --test tests\jd-taobao-review-media-waterfall.test.js
git diff --check
```

Expected: syntax check exits `0`, test output reports `fail 0`, and diff check exits `0`.

- [ ] **Step 5: Verify in live pages and publish**

With Kimi WebBridge, test current Chrome product pages for Tmall/Taobao and JD: open the wall, change size/type controls, open a preview, collapse text, return and verify card positioning, close/reopen and verify in-page restoration, and trigger JD downward loading. Commit script and tests, push `main`, then provide:

```text
https://raw.githubusercontent.com/hahapkpk/tools/main/jd-taobao-review-media-waterfall.user.js
```
