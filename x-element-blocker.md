# X Element Blocker 实现原理

## 概述

X Element Blocker 是一个运行在 Tampermonkey 中的油猴脚本，通过点选页面元素生成稳定的 CSS 选择器，并利用 MutationObserver 持续监听 DOM 变化，实现对 X.com 动态内容的长效屏蔽。

---

## 核心挑战：X.com 的动态 DOM

X.com 是一个 React SPA，存在两个主要问题：

1. **随机 class 名**：构建时生成的 class 如 `css-175oi2r` 会随版本更新变化，不能作为稳定标识
2. **懒加载 / 虚拟滚动**：Timeline 内容在滚动时动态插入 DOM，页面初始化时并不存在

这意味着传统的「一次性隐藏」方案会失效——刷新后 class 变了，或者新加载的内容没有被处理到。

---

## 稳定选择器生成策略

核心函数：`getStableSelector(el)`

选择器按优先级依次尝试：

### 1. `data-testid`（最优先）

```js
if (el.dataset && el.dataset.testid) {
  return `[data-testid="${el.dataset.testid}"]`;
}
```

X.com 在大量关键元素上标注了 `data-testid`，例如：

| 元素 | testid |
|------|--------|
| 推文 | `tweet` |
| 侧边栏趋势 | `trend` |
| 推荐用户 | `UserCell` |
| 底部导航 | `BottomBar` |

这些属性由开发者手动维护，不随构建变化，是最稳定的锚点。

### 2. `aria-label`（次优先）

```js
if (el.getAttribute('aria-label')) {
  return `${tag}[aria-label="${label}"]`;
}
```

无障碍属性同样稳定，适用于按钮、导航等交互元素。

### 3. 结构路径（兜底）

```js
function buildStructuralSelector(el) {
  // 向上遍历最多 5 层，遇到 data-testid 即停止
  // 用 nth-of-type 而非 nth-child，避免因兄弟节点类型不同导致偏移
}
```

当前两种方法都不可用时，构建基于标签名和 `nth-of-type` 的结构路径。遍历过程中一旦遇到带 `data-testid` 的祖先节点，立即以其为根节点截断，避免路径过长。

---

## 动态内容处理：MutationObserver

```js
const observer = new MutationObserver(() => applyRules());
observer.observe(document.body, { childList: true, subtree: true });
```

每当 DOM 发生变化（新推文加载、路由切换等），`applyRules()` 就会重新执行一遍所有规则：

```js
function applyRules() {
  rules.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      el.style.setProperty('display', 'none', 'important');
    });
  });
}
```

使用 `!important` 确保优先级高于页面自身样式，防止被覆盖。

---

## 规则持久化

使用 Tampermonkey 提供的 `GM_setValue` / `GM_getValue` 存储规则数组：

```js
// 读取
let rules = GM_getValue('x_element_blocker_rules', []);

// 保存
GM_setValue('x_element_blocker_rules', rules);
```

数据存储在 Tampermonkey 的独立沙箱中，与页面 localStorage 隔离，不受 X.com 清除缓存影响，跨标签页共享。

---

## 选取流程

```
用户点击「选取元素」
        ↓
进入 pickMode，全局监听 mouseover / click（capture 阶段）
        ↓
mouseover → 给悬停元素加 outline 高亮（不修改布局）
        ↓
click → e.preventDefault() + e.stopPropagation() 拦截原始事件
      → getStableSelector(el) 生成选择器
      → 加入 pendingSelectors（待确认列表）
        ↓
用户点「预览」→ 临时设置 opacity: 0.15 预览效果
        ↓
用户点「确认保存」→ 写入 rules，GM_setValue 持久化，applyRules() 立即生效
```

事件监听注册在 **capture 阶段**（第三个参数 `true`），确保在 React 合成事件之前拦截，避免误触发 X.com 的点击行为（如跳转详情页）。

---

## UI 架构

| 组件 | 实现方式 |
|------|---------|
| 面板注入 | `document.createElement` 动态创建，`GM_addStyle` 注入样式 |
| 拖动 | mousedown 记录起始坐标，mousemove 计算偏移更新 `left/top` |
| 悬浮按钮 (FAB) | `position: fixed` 固定在右下角，独立于面板 |
| 油猴菜单命令 | `GM_registerMenuCommand` 注册，点击切换面板显隐 |
| 高亮效果 | 使用 `outline`（不影响布局）而非 `border` |

---

## 数据流

```
GM_getValue (持久化存储)
      ↓
rules[]  ←──────────────────────────────────────┐
      ↓                                          │
applyRules()  ←── MutationObserver              │ GM_setValue
      ↓                                          │
display:none                              pendingSelectors[]
                                                 ↑
                                          onPickClick()
                                                 ↑
                                          getStableSelector()
```

---

## 局限性

- **结构路径选择器**在 X.com 大改版后可能失效，但 `data-testid` 规则不受影响
- MutationObserver 回调频繁触发时有轻微性能开销，可考虑加 debounce 优化（当前规则数量少时影响可忽略）
- 屏蔽以 `display: none` 实现，元素仍存在于 DOM 中，不影响页面功能性请求
