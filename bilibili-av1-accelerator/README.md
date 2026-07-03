# Bilibili AV1 缓冲加速器

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

一个用于 Bilibili（B 站）的 Tampermonkey 用户脚本，通过**多连接并发预取 AV1 视频分片**来解决倍速播放时的缓冲卡顿问题。

## 动机

在 B 站用 8 倍速看视频时，AV1 编码的视频分片常常下载跟不上播放速度，导致频繁缓冲。浏览器默认只对同一域名保持少量并发连接，在高速播放场景下带宽利用率不足。

本脚本通过：

1. **并发 HTTP 预取** — 用 `GM.xmlHttpRequest` 同时拉取多个未来的视频分片
2. **智能缓存命中** — 劫持 `fetch` 和 `XMLHttpRequest`，播放器请求的分片若已缓存则直接返回
3. **缓冲水位监控** — 每 500ms 检查 `video.buffered`，缓冲不足时自动触发预取

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 点击脚本的 Raw 链接，或手动新建脚本，将 `bilibili-av1-buffer-accelerator.user.js` 内容粘贴进去
3. 确认脚本的 `@match` 已覆盖 `https://www.bilibili.com/video/*`
4. 打开任意 B 站视频，控制台应输出 `[BiliAV1Boost] ✅ 加速器就绪`

## 配置

脚本开头的 `CONFIG` 对象可自定义：

```javascript
const CONFIG = {
    codecId: 177,            // AV1 1080P (125=AVC, 32=HEVC, 30216=AV1-4K)
    maxConcurrent: 4,        // 同时预取的最大连接数
    maxCacheSegments: 50,    // 内存中最多缓存的分数数 (LRU 淘汰)
    bufferThreshold: 30,     // 剩余缓冲低于此秒数时触发预取
    checkInterval: 500,      // 缓冲检查周期 (ms)
    minBufferForPrefetch: 60,// 预取目标：将缓冲拉到至少此秒数
};
```

如果你选择的不是 AV1 编码，改 `codecId` 即可。常见 ID：

| ID | 编码 | 分辨率 |
|----|------|--------|
| 177 | AV1 | 1080P |
| 30216 | AV1 | 4K |
| 125 | AVC (H.264) | 1080P |
| 32 | HEVC (H.265) | 4K |

## 原理

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│ __playinfo__ │────▶│  分片 URL 列表    │────▶│  PrefetchPool│
│  (DASH数据)   │     │ [url1,url2,...]  │     │ (并发4连接)   │
└──────────────┘     └──────────────────┘     └──────┬───────┘
                                                     │
                                              ┌──────▼───────┐
                                              │  LRU Cache   │
                                              │ Map<url,buf> │
                                              └──────┬───────┘
                                                     │
┌──────────────┐     ┌──────────────────┐     ┌──────▼───────┐
│  <video>     │────▶│ fetch / XHR 劫持  │────▶│ 命中→返回缓存 │
│  buffered    │     │ (m4s 请求拦截)    │     │ 未命中→透传   │
└──────────────┘     └──────────────────┘     └──────────────┘
```

1. **发现阶段**：从 `window.__playinfo__` 或 `window.__INITIAL_STATE__` 读取 DASH 数据，找到目标编码（默认 AV1 id=177）的视频流，解析其 `segmentUrls` 列表
2. **预取阶段**：`PrefetchPool` 维护一个并发连接池，循环拉取当前播放位置之后的 N 个分片
3. **拦截阶段**：劫持 `fetch` 和 `XMLHttpRequest`，当播放器请求某个 m4s 分片时，先查缓存
4. **监控阶段**：每 500ms 读取 `video.buffered.end()` 和 `video.currentTime`，若剩余缓冲 < 30s 则加速预取
5. **切换检测**：MutationObserver 监听 DOM 变化，当用户切换画质时自动清空旧缓存并重新拉取

## 注意事项

- 脚本需要 `GM.xmlHttpRequest` 权限才能跨域请求 CDN 视频分片
- 仅在 `www.bilibili.com/video/*` 页面生效
- 若视频没有 `segmentUrls` 列表（罕见），脚本自动降级为被动缓存模式
- 内存占用约 20-40MB（50 个分片 × ~500KB/片）

## 开发计划

- [x] MVP: 解析 DASH → 并发预取 → fetch/XHR 拦截
- [ ] 用户配置面板（油猴菜单，可视化调参）
- [ ] 非 segmentUrls 格式的兼容（base_url 模板推算分片）
- [ ] 播放器 API 直连方案（直接写入 SourceBuffer）
- [ ] 智能并发数调整（根据实际下载速度动态调节）

## License

MIT
