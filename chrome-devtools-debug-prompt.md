# Chrome DevTools 页面调试 - AI Prompt

## 环境

用户的 Chrome 以 `--remote-debugging-port=9222` 启动（桌面有"Chrome（调试模式）"快捷方式）。已安装 `chrome-devtools-mcp@0.21.0`（全局 npm）。

## 连接步骤

```bash
# 1. 验证端口
Invoke-RestMethod "http://127.0.0.1:9222/json/version"

# 2. 启动 MCP 守护进程
chrome-devtools start --browser-url http://127.0.0.1:9222

# 3. 选择目标页面
chrome-devtools list_pages
chrome-devtools select_page <pageId>
```

## 常用命令

```bash
# 页面快照（含 uid）
chrome-devtools take_snapshot

# 执行 JS（函数形式，返回 JSON）
chrome-devtools evaluate_script "() => { return document.title; }"

# 异步 JS
chrome-devtools evaluate_script "async () => { const r = await fetch('/api'); return await r.json(); }"

# 点击元素（用 take_snapshot 获取 uid）
chrome-devtools click <uid>

# 截图
chrome-devtools take_screenshot

# 网络请求
chrome-devtools list_network_requests --resourceTypes xhr
chrome-devtools get_network_request --reqid <id>
```

## 注意事项

- iCloud 等 SPA 的真实 DOM 在 iframe 内，需通过 `document.querySelectorAll('iframe')[0].contentDocument` 访问
- `evaluate_script` 的参数必须是**函数声明字符串**，如 `"() => { ... }"`
- 如果端口 9222 不通：确认 Chrome 完全关闭后再用调试快捷方式启动（同一 user-data-dir 只能有一个实例）
- 如果 `list_pages` 为空或 MCP 超时：运行 `chrome-devtools stop` 再 `chrome-devtools start --browser-url http://127.0.0.1:9222`

## 直接 CDP（绕过 MCP）

当 MCP 不可用时，直接用 Node.js WebSocket 连接：

```javascript
const http = require('http');
const { WebSocket } = require('ws');
http.get('http://127.0.0.1:9222/json', res => {
  let d = ''; res.on('data', c => d += c);
  res.on('end', () => {
    const tab = JSON.parse(d).find(t => t.url.includes('目标域名'));
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    ws.on('open', () => {
      ws.send(JSON.stringify({id:1, method:'Runtime.evaluate', params:{expression:'你的JS代码', returnByValue:true}}));
    });
    ws.on('message', data => console.log(JSON.parse(data).result));
  });
});
```

## 故障排查

| 现象 | 解决 |
|------|------|
| 端口拒绝连接 | 关闭所有 Chrome → 用调试快捷方式重启 |
| `list_pages` 为空 | `chrome-devtools stop` → 重新 `start` |
| evaluate 超时 | 检查 JS 是否有语法错误或死循环 |
| iframe 内容访问不到 | 在 evaluate 里遍历 `document.querySelectorAll('iframe')` 找 contentDocument |
