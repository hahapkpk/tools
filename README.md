# Tools

个人工具集合 — 油猴脚本 & Web 小工具。

## 油猴脚本 (Tampermonkey)

### 1. 乐书网书籍下载器 (leshu8-downloader)

> **文件**: [`leshu8-downloader.user.js`](leshu8-downloader.user.js) · [安装脚本](https://raw.githubusercontent.com/hahapkpk/tools/main/leshu8-downloader.user.js)

在 [leshu8.com](https://leshu8.com) 书籍阅读页添加下载按钮，导出带原站排版的完整书籍。

**功能特性**:
- 一键导出 **HTML** 格式（保留排版样式）
- 一键打开 **打印/PDF** 窗口，通过浏览器打印另存为 PDF
- 自动解锁书籍章节（受平台每日免费限额控制）
- 逐章抓取 + 自动重试，支持长篇书籍
- 自动解析 Nuxt SSR 数据获取书名和章节

**使用方法**: 打开 leshu8.com 任意书籍阅读页，页面右下角出现「下载 HTML」和「打印/PDF」按钮。

---

### 2. X Blocker - 元素选取屏蔽器 (x-blocker)

> **文件**: [`x-blocker.user.js`](x-blocker.user.js) · [安装脚本](https://raw.githubusercontent.com/hahapkpk/tools/main/x-blocker.user.js)

可视化选取并屏蔽 X/Twitter 页面上不想要的区域。

**功能特性**:
- 可视化元素选取模式（点击选取，支持多选）
- 实时预览屏蔽效果，确认后保存
- 规则持久化存储，支持启用/禁用/删除
- 自动生成精简 CSS 选择器
- 可拖拽面板 + 浮动按钮，不影响正常浏览
- 支持 Tampermonkey 菜单命令快捷操作
- SPA 路由变化自动重新应用规则

**使用方法**: 打开 x.com 或 twitter.com，页面右下角出现控制面板，点击「开始选取元素」进入选取模式。

---

### 3. 湖北21世纪学习平台 - 自动刷课 (hubei21-autolearn)

> **文件**: [`hubei21-autolearn.user.js`](hubei21-autolearn.user.js) · [安装脚本](https://raw.githubusercontent.com/hahapkpk/tools/main/hubei21-autolearn.user.js)

自动完成 [hubei21.com](https://www.hubei21.com) 学习平台的所有课程视频学习进度。

**功能特性**:
- 自动获取课程列表，识别未完成课程
- 模拟视频学习进度上报（每节课 2 次上报，间隔 2 秒）
- 实时进度条 + 日志显示
- 支持随时停止
- 智能跳过已完成课程
- 16 节课约 1 分钟即可全部完成

**使用方法**: 登录 hubei21.com 并打开课程页面（如 ），右上角出现「自动刷课助手」面板，点击「开始刷课」。

---

## Web 工具

### 4. Favicon Grabber

> **文件**: [`favicon-grabber.html`](favicon-grabber.html) · [在线使用](https://hahapkpk.github.io/tools/favicon-grabber.html)

粘贴网址，自动获取网站最高清图标（Favicon / Logo）。

**功能特性**:
- 自动探测网站直链图标（SVG、Apple Touch Icon、Favicon PNG/ICO）
- 集成多个第三方图标服务（Clearbit、gstatic、DuckDuckGo、Yandex）
- 自动解析 PWA manifest.json 获取高清图标
- 一键复制链接 / 下载图标
- 暗色主题 UI，粘贴网址自动触发

**使用方法**: 打开页面，粘贴任意网址即可。

---

## 安装说明

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击上方对应脚本的「安装脚本」链接
3. 在 Tampermonkey 弹出的确认页面点击「安装」

## License

MIT
