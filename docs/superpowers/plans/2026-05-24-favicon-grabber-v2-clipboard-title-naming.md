# Favicon Grabber V2 剪贴板读取与标题命名实现计划

> **供执行代理使用：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务执行本计划，并使用复选框跟踪进度。

**目标：** 维护 V2 单页工具，在保持原页面和图标读取流程不变的前提下，增加复制网站名称能力，并优先使用网页标题中的简短中文名称。

**架构：** 继续只修改 `favicon-grabber-v2.html`：复用已有保存名称字段和 `getActiveSiteName()`，增加旁侧复制按钮及 `copySiteName()`；扩展 `normalizeSiteName()` 的候选选择以优先短中文名称。测试脚本从 V2 HTML 装载页面脚本验证新增逻辑；原页面通过版本差异检查确保未被改动。

**技术栈：** HTML、CSS、原生浏览器 JavaScript、Node.js 内置 `node:test` 与 `vm`。

---

### 任务 1：锁定 V2 新增行为

**文件：**
- 新建：`tests/favicon-grabber-v2.test.js`
- 预期新建：`favicon-grabber-v2.html`

- [ ] **步骤 1：编写失败测试**

测试应读取 V2 HTML，并验证以下可调用行为：

```js
assert.equal(context.deriveDomainName('www.github.com'), 'GitHub');
assert.equal(context.normalizeSiteName('GitHub: Let us build from here | Developer Platform', 'github.com'), 'GitHub');
assert.equal(context.normalizeSiteName('微信读书 / 精选阅读：发现好内容?', 'weread.qq.com'), '微信读书');
assert.ok(context.normalizeSiteName('ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890LONGNAME', 'example.com').length <= 40);
assert.equal(context.buildDownloadFilename('GitHub', 'Favicon.ico', 'ico'), 'GitHub-Favicon.ico');
```

测试还应模拟 `navigator.clipboard.readText()` 返回 `https://github.com/openai`，调用 `readClipboardAndGrab()`，断言网址写入输入框并触发获取流程。

- [ ] **步骤 2：执行测试并观察正确失败**

执行：

```powershell
node --test tests/favicon-grabber-v2.test.js
```

预期：测试因 `favicon-grabber-v2.html` 尚不存在而失败。

### 任务 2：创建 V2 页面并接入新增功能

**文件：**
- 新建：`favicon-grabber-v2.html`
- 不修改：`favicon-grabber.html`
- 测试：`tests/favicon-grabber-v2.test.js`

- [ ] **步骤 1：复制现有视觉和图标获取流程**

将原页面内容作为 V2 基线，保留当前候选图标来源、manifest 获取和图标卡片逻辑。

- [ ] **步骤 2：增加剪贴板入口和保存名称区域**

在 V2 增加按钮和名称输入区域：

```html
<button class="clipboard-btn" onclick="readClipboardAndGrab()">从剪贴板读取网址并获取图标</button>
<section id="namePanel" class="name-panel hidden">
  <label for="siteNameInput">保存名称</label>
  <input type="text" id="siteNameInput" maxlength="40" placeholder="网站名称" />
  <p id="titleStatus" class="name-status"></p>
</section>
```

- [ ] **步骤 3：实现标题短名称及域名回退**

实现：

```js
function deriveDomainName(domain) { /* 域名主体回退名称 */ }
function normalizeSiteName(title, domain) { /* 分隔截取、非法字符清理、40 字限制 */ }
async function fetchPageTitle(origin) { /* 通过 r.jina.ai 获取标题文本 */ }
function getActiveSiteName() { /* 获取当前安全名称 */ }
function buildDownloadFilename(siteName, label, ext) { /* 生成 网站-图标.扩展名 */ }
```

`grab()` 在图标展示时先使用域名回退名称，再异步更新为标题名称，标题失败仅提示用户可手动调整。

- [ ] **步骤 4：将 V2 下载命名接入当前保存名称**

V2 的 `downloadIcon()` 使用 `buildDownloadFilename(getActiveSiteName(), label, ext)` 构造文件名；原页面的下载函数保持不变。

- [ ] **步骤 5：执行测试并确认通过**

执行：

```powershell
node --test tests/favicon-grabber-v2.test.js
```

预期：全部 V2 行为测试通过。

### 任务 3：验证并发布 V2

**文件：**
- 修改：`docs/superpowers/specs/2026-05-24-favicon-grabber-clipboard-title-naming-design.md`
- 新建：`docs/superpowers/plans/2026-05-24-favicon-grabber-v2-clipboard-title-naming.md`
- 新建：`favicon-grabber-v2.html`
- 新建：`tests/favicon-grabber-v2.test.js`

- [ ] **步骤 1：确认旧页面未变化并做页面验证**

执行自动验证并在本地浏览器打开 V2，确认剪贴板按钮、保存名称字段和图标卡片展示存在；下载名称以填写的网站名称开头。

- [ ] **步骤 2：执行最终检查**

执行：

```powershell
node --test tests/favicon-grabber-v2.test.js
git diff --check
git diff --exit-code -- favicon-grabber.html
git status --short --branch
```

预期：测试通过，无空白错误；旧页面没有差异；只出现 V2 相关文件及本次文档修订。

- [ ] **步骤 3：仅提交并推送 V2 范围**

```powershell
git add -- favicon-grabber-v2.html tests/favicon-grabber-v2.test.js docs/superpowers/specs/2026-05-24-favicon-grabber-clipboard-title-naming-design.md docs/superpowers/plans/2026-05-24-favicon-grabber-v2-clipboard-title-naming.md
git commit -m "feat: add favicon grabber v2 title naming"
git push origin main
```

发布后提供 GitHub Pages 可访问地址，供用户测试 V2 页面。

### 任务 4：复制名称与中文优先迭代

**文件：**
- 修改：`favicon-grabber-v2.html`
- 修改：`tests/favicon-grabber-v2.test.js`
- 修改：`docs/superpowers/specs/2026-05-24-favicon-grabber-clipboard-title-naming-design.md`

- [ ] **步骤 1：先写失败测试**

加入断言：

```js
assert.equal(context.normalizeSiteName('RED | 小红书 - 你的生活指南', 'xiaohongshu.com'), '小红书');
await context.copySiteName();
assert.equal(copiedText, '小红书');
```

预期执行 `node --test tests/favicon-grabber-v2.test.js` 时失败，因为现有 V2 未提供 `copySiteName()`，且中英候选规则尚未明确覆盖该案例。

- [ ] **步骤 2：实现复制名称按钮和中文优先规则**

在 `保存名称` 行内加入按钮：

```html
<div class="name-row">
  <input type="text" id="siteNameInput" maxlength="40" placeholder="网站名称" />
  <button id="copyNameBtn" class="copy-name-btn" onclick="copySiteName()">复制名称</button>
</div>
```

实现：

```js
async function copySiteName() {
  const name = getActiveSiteName();
  try {
    await navigator.clipboard.writeText(name);
    copyNameBtn.textContent = '已复制';
  } catch {
    titleStatus.textContent = '无法复制名称，请手动复制。';
  }
}
```

并在 `normalizeSiteName()` 对分隔后的候选项优先选取包含中文且不像描述语的简短候选，未找到时继续沿用现有英文或域名回退逻辑。

- [ ] **步骤 3：验证并发布**

执行：

```powershell
node --test tests/favicon-grabber-v2.test.js
git diff --check
git diff --exit-code -- favicon-grabber.html
git add -- favicon-grabber-v2.html tests/favicon-grabber-v2.test.js docs/superpowers/specs/2026-05-24-favicon-grabber-clipboard-title-naming-design.md docs/superpowers/plans/2026-05-24-favicon-grabber-v2-clipboard-title-naming.md
git commit -m "feat: add copy name action to favicon grabber v2"
git push origin main
```

发布后验证 GitHub Pages 中 V2 页面存在 `复制名称` 按钮。
