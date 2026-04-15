# tools

个人工具集，主要包含油猴脚本（Userscripts）和小工具。

---

## 油猴脚本

### [X Element Blocker](./x-element-blocker.user.js)

在 X.com（Twitter）上通过点选元素来屏蔽不想要的页面区域，类似 uBlock Origin 的自定义屏蔽功能。

**功能**

- 点选模式：点击页面元素即可将其加入屏蔽列表，支持多选
- 预览：保存前先预览屏蔽效果，确认无误再保存
- 稳定选择器：优先使用 `data-testid` / `aria-label` 生成选择器，不依赖随机 class，规则长期有效
- 动态内容支持：通过 MutationObserver 监听懒加载内容，新加载的元素也会被自动屏蔽
- 可拖动面板，默认隐藏不打扰
- 右下角悬浮按钮 + 油猴菜单命令，随时显示/隐藏面板

**安装**

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)
2. 点击下方链接一键安装：

   [安装脚本](https://raw.githubusercontent.com/hahapkpk/tools/main/x-element-blocker.user.js)

**使用流程**

1. 打开 X.com，点击右下角 🚫 按钮（或油猴菜单 → 显示/隐藏 Element Blocker）
2. 点击「🖱 点击选取元素」进入选取模式
3. 鼠标悬停高亮目标元素，点击选中（可多选）
4. 点「预览」确认效果，满意后点「确认保存」
5. 规则永久保存，刷新页面后自动生效

---

### [X Blocker](./x-blocker.user.js)

X.com 用户/关键词屏蔽脚本。

---

### [湖北21世纪 自动学习](./hubei21-autolearn.user.js)

湖北21世纪教育平台自动挂机学习脚本。

---

### [湖北21世纪 考试辅助](./hubei21-exam.user.js)

湖北21世纪教育平台考试辅助脚本。详见 [说明文档](./hubei21-exam.md)。

---

### [乐书8 下载器](./leshu8-downloader.user.js)

乐书8 电子书下载脚本。

---

## 小工具

### [Favicon Grabber](./favicon-grabber.html)

网站 favicon 批量抓取工具，纯 HTML 单文件，无需安装。

---

### [Book Downloader](./book-downloader/)

书籍下载工具。
