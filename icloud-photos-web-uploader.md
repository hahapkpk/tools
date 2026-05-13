# iCloud Photos Web Uploader

Tampermonkey 脚本，为 iCloud 网页版照片添加快速上传、自动转码、滚轮缩放和智能刷新功能。

## 安装

点击下方链接，Tampermonkey 会自动提示安装：

```
https://raw.githubusercontent.com/hahapkpk/tools/main/icloud-photos-web-uploader.user.js
```

## 功能

### 📤 快速上传

- **粘贴上传**：页面任意位置 Ctrl+V 粘贴截图/图片直接上传
- **拖拽上传**：拖拽图片文件到悬浮球上传
- **点击选择**：点击悬浮球打开文件选择器
- 右键悬浮球：运行上传控件检测诊断

### 🔄 自动格式转码

iCloud 网页版只接受 JPEG，脚本自动将其他格式转为 JPEG：

| 格式 | 支持 | 说明 |
|------|------|------|
| JPEG | ✅ 直接上传 | 不转码 |
| PNG, WebP, GIF, BMP, AVIF, APNG | ✅ 自动转码 | 浏览器原生解码 |
| SVG, ICO | ✅ 自动转码 | SVG 无尺寸时默认 1024×1024 |
| HEIC, HEIF, TIFF | ⚠️ 接受但可能失败 | Windows Chrome 无解码器 |

转码细节：
- 透明背景填白色
- JPEG 质量 0.92
- 文件名自动改为 `.jpg`

### 🔍 滚轮缩放 + 拖拽平移

- **滚轮缩放**：鼠标悬在预览图上滚轮缩放 1x～8x
- **拖拽平移**：缩放后按住左键拖动
- **Esc / 0**：立即复位
- 缩放锚点跟随鼠标位置
- 模仿 iCloud 原生缩放机制（transform 加在 `OneUpCarouselItem-itemWrapper` 上）

### ⚡ 智能刷新

上传后自动检测服务器处理状态：

1. 上传成功 → 记录当前 CloudKit sync token
2. 每 2 秒轮询 `zones/list` API 检查 token 变化
3. Token 变化 = 服务器已处理 → 自动 hash 路由切换刷新图库
4. 最多等 30 秒，超时强制刷新
5. 等待期间点击悬浮球可立即刷新

### 🎯 悬浮球 UI

- 44×44 圆形 FAB，右下角
- 可拖动，位置自动记忆
- 上传中：灰色 + 旋转光环
- 等待刷新：绿色 + 刷新图标
- 状态 toast 自动消失

## 技术实现

### 架构

脚本注入到 iCloud Photos 的内部 iframe（`/applications/photos3/current/<locale>/index.html`），不在外层 shell 页面。

```
https://www.icloud.com.cn/photos/          ← 外层 shell（不注入面板）
  └ iframe /applications/photos3/...       ← 真正的 Photos App（注入面板）
```

### 关键 DOM 结构（通过 chrome-devtools-mcp 逆向）

```
UI-MAIN-PANE
  └ PhotosRootContent
    └ NavigationPageContainer (overflow:hidden)
      └ OneUp (position:fixed, 全屏)
        └ ReactSwipeCarousel (overflow:hidden)
          └ OneUpCarouselItem.is-center (overflow:hidden)
            └ OneUpCarouselItem-itemWrapper (overflow:hidden, iCloud 在此加 transform 缩放)
              └ ProgressiveImageElement
                └ IMG
```

### iCloud 原生缩放原理

iCloud 的缩放滑块（`ToolbarOneUpZoomSlider`）通过在 `OneUpCarouselItem-itemWrapper` 上设置 `transform: matrix(scale, 0, 0, scale, tx, 0)` 实现缩放。容器的 `width/height/left/top` 保持不变，`overflow:hidden` 不影响（因为是容器自身在缩放）。

本脚本完全模仿此行为。

### iCloud 照片刷新机制

- **Push 通知**：shared worker 通过 WebSocket 连接 `push.apple.com`
- **Sync Token**：CloudKit `zones/list` API 返回当前同步状态
- **数据拉取**：`records/query` 获取照片列表
- **路由刷新**：hash 切换（如 `#/recents` → 回原 hash）触发 React 组件重挂载

### 粘贴事件处理

- 全局只注册一次（`installPasteListener`）
- 在 `window` / `document` / `body` 三层 capture 阶段注册
- 事件级去重（`__iCloudUploaderPasteHandled` 标记）
- 跳过 input/textarea/contentEditable 目标

## 开发

### 运行测试

```bash
cd tools
node --test tests/icloud-photos-web-uploader.test.js
```

### Chrome DevTools 调试

使用 `chrome-devtools-mcp` 连接已打开的 Chrome 进行实时 DOM 分析：

```bash
# 1. 用调试模式启动 Chrome（桌面有快捷方式）
#    参数：--remote-debugging-port=9222 --user-data-dir=%LOCALAPPDATA%\Google\Chrome\User Data

# 2. 启动 MCP 守护进程
chrome-devtools start --browser-url http://127.0.0.1:9222

# 3. 操作
chrome-devtools list_pages
chrome-devtools select_page 1
chrome-devtools evaluate_script "() => { return document.title; }"
chrome-devtools take_snapshot
chrome-devtools click <uid>
```

### 直接 CDP 连接

```javascript
// 不依赖 MCP，直接用 WebSocket 连接 Chrome
const http = require('http');
const { WebSocket } = require('ws');
http.get('http://127.0.0.1:9222/json', res => {
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => {
    const tab = JSON.parse(d).find(t => t.url.includes('icloud'));
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{expression:'document.title', returnByValue:true}}));
    });
    ws.on('message', data => console.log(JSON.parse(data)));
  });
});
```

## 版本历史

| 版本 | 主要变更 |
|------|----------|
| 1.12.0 | 智能刷新：轮询 CloudKit sync token 替代盲等计时器 |
| 1.11.0 | 缩放 transform 加在 wrapper 上（模仿 iCloud 原生） |
| 1.10.x | 修复缩放遮挡 UI、红色矩形、图片跑偏等问题 |
| 1.9.0 | 软刷新改用 hash 路由切换 |
| 1.8.x | 滚轮缩放 + 拖拽平移 + rAF 看护 |
| 1.7.x | 粘贴去重、保留当前视图、模拟点击 |
| 1.5.0 | 悬浮球 FAB 重设计 |
| 1.4.0 | 注入到 iframe 内部修复核心 bug |
| 1.3.0 | 初始版本 |

## 许可

MIT
