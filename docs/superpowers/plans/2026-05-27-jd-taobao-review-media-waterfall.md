# 京东与淘宝评价实拍墙油猴脚本 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在京东和淘宝/天猫商品评价页提供复用原生筛选状态的大弹窗实拍瀑布流浏览工具。

**Architecture:** 发布单个 `jd-taobao-review-media-waterfall.user.js`，将站点识别和原生评价抽取封装为 adapter，将瀑布流弹窗及预览层作为共享 UI。脚本不自行构造含签名的评价接口请求，而是触发平台原生图/视频筛选、监听其 DOM 变化并镜像媒体节点，从而保留京东“最新/当前商品”和天猫“默认/时间排序/款式筛选”语义。

**Tech Stack:** Tampermonkey userscript、原生 DOM/MutationObserver/IntersectionObserver、Node.js `node:test` + `vm` 的轻量 DOM 测试、Kimi WebBridge 实页验证。

---

## 已取得的页面证据

- 京东页面为 `https://item.jd.com/100117729409.html`；评价页签容器为 `.left-tabs-nav`，评价根节点为 `#comment-root`，“全部评价”入口为 `.all-btn`。点击后弹窗根节点为 `#rateList`，其中有“图/视频”“最新”“当前商品”控件。
- 京东点击“图/视频”后，原生请求访问 `https://api.m.jd.com/client.action`，响应标签数据包含 `identification: "YOUTU"` 与 `identification: "SHAITU"`。当前观察页面中筛选后未渲染媒体卡片，必须保留无媒体/等待加载提示，不能从商品主图错误取图。
- 天猫页面为 `https://detail.tmall.com/item.htm?...`；评价抽屉可定位到类名前缀 `Drawer--`，评价卡片类名前缀 `Comment--`，媒体集合类名前缀 `album--`，原有控件含“图/视频”“图集”“默认排序”“款式筛选”。
- 天猫原生媒体评价请求为 `mtop.taobao.rate.detaillist.get`；图/视频状态为 `rateType: "7"`，时间排序将 `orderType` 从空字符串变为 `"feedbackdate"`。脚本只点击原控件并读取已渲染媒体，不复用请求签名。

## 文件结构

- Create: `jd-taobao-review-media-waterfall.user.js`：发布脚本，包含站点 adapter、媒体 store、弹窗、预览和生命周期管理。
- Create: `tests/jd-taobao-review-media-waterfall.test.js`：在最小 DOM stub 中测试站点识别、媒体去重/抽取、分层关闭状态与幂等入口插入。
- Modify: `docs/superpowers/plans/2026-05-27-jd-taobao-review-media-waterfall.md`：执行过程中仅勾选完成步骤和记录真实验证证据。

### Task 1: 可测试核心与媒体归一化

**Files:**
- Create: `tests/jd-taobao-review-media-waterfall.test.js`
- Create: `jd-taobao-review-media-waterfall.user.js`

- [ ] **Step 1: 写失败测试，定义站点识别与媒体去重行为**

测试先从尚不存在的脚本导出测试 API，并断言：

```javascript
test('识别京东和天猫商品详情站点', () => {
  assert.equal(api.detectSite('https://item.jd.com/100117729409.html'), 'jd');
  assert.equal(api.detectSite('https://detail.tmall.com/item.htm?id=942720563609'), 'taobao');
});

test('媒体条目按原图地址去重且保留评价上下文', () => {
  const store = api.createMediaStore();
  store.replace([{ type: 'image', src: 'a.jpg', text: '第一条' }, { type: 'image', src: 'a.jpg', text: '重复' }]);
  assert.deepEqual(store.items().map(item => item.text), ['第一条']);
});
```

- [ ] **Step 2: 运行测试并确认因脚本不存在或 API 未定义而失败**

Run: `node --test tests/jd-taobao-review-media-waterfall.test.js`

Expected: `FAIL`，错误指向 `jd-taobao-review-media-waterfall.user.js` 尚不存在或 `detectSite/createMediaStore` 未定义。

- [ ] **Step 3: 最小实现站点识别、store 与测试导出**

发布脚本以最小权限开头，并在测试环境暴露纯逻辑：

```javascript
// ==UserScript==
// @name         京东/淘宝评价实拍墙
// @namespace    https://github.com/hahapkpk/tools
// @version      0.1.0
// @description  将京东和淘宝/天猫评价图视频以瀑布流弹窗展示。
// @match        https://item.jd.com/*
// @match        https://detail.tmall.com/*
// @match        https://item.taobao.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

function detectSite(href) {
  if (/https:\/\/item\.jd\.com\//.test(href)) return 'jd';
  if (/https:\/\/(?:detail\.tmall|item\.taobao)\.com\//.test(href)) return 'taobao';
  return null;
}

function createMediaStore() {
  let media = [];
  const replace = (items) => {
    const seen = new Set();
    media = items.filter(item => item.src && !seen.has(item.src) && seen.add(item.src));
  };
  return { replace, items: () => media.slice() };
}
```

- [ ] **Step 4: 运行核心测试并确认通过**

Run: `node --test tests/jd-taobao-review-media-waterfall.test.js`

Expected: `PASS` for site detection and media de-duplication.

### Task 2: 平台 adapter 与原生筛选复用

**Files:**
- Modify: `tests/jd-taobao-review-media-waterfall.test.js`
- Modify: `jd-taobao-review-media-waterfall.user.js`

- [ ] **Step 1: 写失败测试，定义京东与淘宝媒体抽取结果**

用精简的 DOM fixture 模拟实页已观察结构：

```javascript
test('淘宝 adapter 仅抽取 Comment 中 album 媒体并附评价文本', () => {
  const root = fixture.taobaoDrawerWithAlbum();
  assert.deepEqual(api.adapters.taobao.collectMedia(root), [{
    type: 'image',
    src: 'https://gw.alicdn.com/rate-a.jpg',
    text: '实物很漂亮',
    meta: '2026年5月15日 已购'
  }]);
});

test('京东 adapter 在尚未渲染晒单图时返回空数组', () => {
  assert.deepEqual(api.adapters.jd.collectMedia(fixture.jdEmptyRateList()), []);
});
```

- [ ] **Step 2: 运行测试并确认 adapter 未实现导致失败**

Run: `node --test tests/jd-taobao-review-media-waterfall.test.js`

Expected: `FAIL` with `adapters` or `collectMedia` undefined.

- [ ] **Step 3: 实现 adapter 行为**

实现接口必须保持以下形状：

```javascript
const adapters = {
  jd: {
    findMount: () => document.querySelector('.left-tabs-nav'),
    openNativeReviews: () => document.querySelector('.all-btn')?.click(),
    selectMedia: (root) => clickText(root, '图/视频'),
    collectMedia: (root) => collectFromReviewImages(root, {
      reviewSelector: '[class*="comment"], [class*="rate"]',
      mediaSelector: 'img[src*="shaidan"], img[src*="s300x300"], img[src*="s1440x1440"]'
    })
  },
  taobao: {
    findMount: () => document.querySelector('[class*="Comments--"], [class*="tabTitleList--"]'),
    selectMedia: (root) => clickText(root, '图/视频'),
    collectMedia: (root) => collectFromAlbums(root, '[class*="Comment--"]', '[class*="album--"] img')
  }
};
```

Adapter 只触发可见原生控件并抽取已渲染媒体；不直接重放 `api.m.jd.com` 或 `mtop.taobao.rate.detaillist.get` 的签名请求。

- [ ] **Step 4: 运行 adapter 测试并确认通过**

Run: `node --test tests/jd-taobao-review-media-waterfall.test.js`

Expected: `PASS` for both fixtures.

### Task 3: 瀑布流弹窗、预览层与关闭状态机

**Files:**
- Modify: `tests/jd-taobao-review-media-waterfall.test.js`
- Modify: `jd-taobao-review-media-waterfall.user.js`

- [ ] **Step 1: 写失败测试，约束分层关闭逻辑和单次入口注入**

```javascript
test('预览打开时点击外层只退回图片墙，再次点击才关闭图片墙', () => {
  const state = api.createWallState();
  state.openWall();
  state.openPreview({ src: 'a.jpg' });
  state.onBackdrop();
  assert.equal(state.snapshot().wallOpen, true);
  assert.equal(state.snapshot().preview, null);
  state.onBackdrop();
  assert.equal(state.snapshot().wallOpen, false);
});

test('重复初始化仅生成一个实拍墙入口', () => {
  const mount = fixture.mount();
  api.ensureLauncher(mount, () => {});
  api.ensureLauncher(mount, () => {});
  assert.equal(mount.querySelectorAll('#review-media-wall-launcher').length, 1);
});
```

- [ ] **Step 2: 运行 UI 状态测试并确认失败**

Run: `node --test tests/jd-taobao-review-media-waterfall.test.js`

Expected: `FAIL` with `createWallState` or `ensureLauncher` undefined.

- [ ] **Step 3: 实现共享弹窗与预览层**

实现应包括固定命名节点和严格关闭规则：

```javascript
const IDS = {
  launcher: 'review-media-wall-launcher',
  backdrop: 'review-media-wall-backdrop',
  modal: 'review-media-wall-modal',
  grid: 'review-media-wall-grid',
  preview: 'review-media-wall-preview'
};

function createWallState() {
  let wallOpen = false;
  let preview = null;
  return {
    openWall: () => { wallOpen = true; },
    openPreview: item => { preview = item; },
    onBackdrop: () => { if (preview) preview = null; else wallOpen = false; },
    snapshot: () => ({ wallOpen, preview })
  };
}
```

CSS 使用 `columns` 或 `grid` 形成自适应瀑布流；卡片只展示媒体。预览层展示媒体与评价文字/规格/日期上下文，视频卡片带播放标记并在预览层内使用 `<video controls autoplay>` 播放。

- [ ] **Step 4: 运行 UI 测试并确认通过**

Run: `node --test tests/jd-taobao-review-media-waterfall.test.js`

Expected: `PASS` for close hierarchy and single launcher.

### Task 4: 动态加载与平台页面生命周期

**Files:**
- Modify: `tests/jd-taobao-review-media-waterfall.test.js`
- Modify: `jd-taobao-review-media-waterfall.user.js`

- [ ] **Step 1: 写失败测试，约束增量追加和状态提示**

```javascript
test('加载新增媒体只追加此前未见的地址', () => {
  const store = api.createMediaStore();
  store.replace([{ src: 'a.jpg', type: 'image' }]);
  store.append([{ src: 'a.jpg', type: 'image' }, { src: 'b.jpg', type: 'image' }]);
  assert.deepEqual(store.items().map(x => x.src), ['a.jpg', 'b.jpg']);
});

test('原生筛选切换后会重置媒体集合', () => {
  const controller = api.createWallController({ collectMedia: () => [{ src: 'new.jpg', type: 'image' }] });
  controller.replace([{ src: 'old.jpg', type: 'image' }]);
  controller.onFilterChanged({});
  assert.deepEqual(controller.items().map(x => x.src), ['new.jpg']);
});
```

- [ ] **Step 2: 运行生命周期测试并确认失败**

Run: `node --test tests/jd-taobao-review-media-waterfall.test.js`

Expected: `FAIL` with missing `append` or controller behavior.

- [ ] **Step 3: 实现观察与滚动加载**

实现约束：

```javascript
function watchNativeList(root, onUpdate) {
  const observer = new MutationObserver(() => onUpdate(root));
  observer.observe(root, { childList: true, subtree: true, attributes: true });
  return () => observer.disconnect();
}

function requestMoreFromNative(root) {
  const scroller = findScrollableAncestor(root);
  scroller.scrollTop = scroller.scrollHeight;
  scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
}
```

弹窗底部进入视口时调用 `requestMoreFromNative`，随后由 `MutationObserver` 收集新增媒体。筛选控件仍保留在平台原生弹窗中；瀑布流提供“在原评价窗口调整筛选，实拍墙将同步刷新”的提示及同步按钮。若京东原生列表未渲染媒体，显示“当前筛选尚未加载出图片/视频，请在原评价窗口切换筛选或滚动后重试”。

- [ ] **Step 4: 运行全部自动化测试并确认通过**

Run: `node --test tests/jd-taobao-review-media-waterfall.test.js`

Expected: all tests pass with `fail 0`.

### Task 5: 实页注入验证与发布

**Files:**
- Modify: `jd-taobao-review-media-waterfall.user.js` only if实页验证暴露可复现问题，并先增加对应失败测试。

- [ ] **Step 1: 在 Kimi WebBridge 页面上下文中注入脚本并验证天猫**

在已打开的 `detail.tmall.com` 商品页上验证：

- 入口只出现一次。
- 点击后显示大尺寸瀑布流窗口，卡片来自 `Comment--` 内 `album--` 媒体而非商品主图。
- 点击卡片进入预览；点击预览外层回到墙；再次点击墙外层关闭窗口。
- 原生“时间排序”切换后媒体同步刷新。

- [ ] **Step 2: 在 Kimi WebBridge 页面上下文中注入脚本并验证京东**

在已打开的 `item.jd.com` 商品页上验证：

- “实拍墙”入口插在 `.left-tabs-nav` 且仅一次。
- 点击入口能打开 `#rateList` 并触发原有“图/视频”筛选。
- 若当前商品原生弹窗仍未渲染媒体，脚本只显示可理解提示，不误收集主图或详情图。
- 当原生评价中出现媒体节点时，预览与关闭逻辑与天猫一致。

- [ ] **Step 3: 运行最终测试和语法校验**

Run:

```powershell
node --check jd-taobao-review-media-waterfall.user.js
node --test tests/jd-taobao-review-media-waterfall.test.js
git diff --check
```

Expected: all commands exit `0`, tests report `fail 0`.

- [ ] **Step 4: 提交并推送发布文件**

```powershell
git add jd-taobao-review-media-waterfall.user.js tests/jd-taobao-review-media-waterfall.test.js docs/superpowers/plans/2026-05-27-jd-taobao-review-media-waterfall.md
git commit -m "feat: add JD and Taobao review media waterfall userscript"
git push origin main
```

- [ ] **Step 5: 交付最新安装与更新地址**

提供可直接在 Tampermonkey 中打开的地址：

```text
https://raw.githubusercontent.com/hahapkpk/tools/main/jd-taobao-review-media-waterfall.user.js
```
