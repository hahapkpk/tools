# leshu8.com 书籍下载器 — 逆向分析笔记

## 项目背景

对 [leshu8.com](https://leshu8.com) 电子书平台进行逆向分析，实现整本书的批量下载，并封装为 Tampermonkey 油猴脚本。

---

## 平台技术栈

| 项目 | 内容 |
|------|------|
| 框架 | Nuxt 3 (SSR + SPA) |
| 状态管理 | Pinia + pinia-plugin-persistedstate |
| CDN | Cloudflare |
| 反爬 | Cloudflare Turnstile (CAPTCHA)、请求签名 (dsac) |
| 认证 | JWT，存于 `localStorage["token"]` |

---

## 逆向过程

### 1. 初步探索

- SSR 页面 `/book-chapter?bookId=...&page=N`：免费章节返回 200，付费章节返回 403
- 测试发现：免费页码为 1–9，page 10+ 返回 403
- `totalPage: 106` 是电子书内物理阅读页数，API 章节编号为 1–24（实际章节数）
- `tryMaxPage: 47` 含义为免费字数页，非 API 页码

### 2. 寻找真实 API

通过注入 fetch 拦截器 + Chrome DevTools Network 面板，捕获登录用户点击付费章节时的请求：

```
GET /api/public/ebook/{bookId}/chapter?page={N}
```

该接口返回 JSON：

```json
{
  "hrefs": ["Text/Section10.xhtml"],
  "content": "<h2>...</h2><p class=\"normaltext\">...</p>",
  "textLength": 2743
}
```

### 3. 认证机制逆向

分析主 bundle `/_nuxt/6aWz4ODr.js`，发现三个必要 header：

| Header | 来源 | 说明 |
|--------|------|------|
| `authorization` | `localStorage["token"]` | JWT Bearer token |
| `cid` | `useNuxtApp().$getClientId()` | 浏览器指纹 ID，由 `/api/public/script/cid` 下发并加密缓存于 `localStorage["cid2"]` |
| `dsac` | `useNuxtApp().$getRequestAccessKey('ebook', bookId)` | 动态签名 = 加密(`{time, ac: access_key}`)，access_key 来自 `resource_ac` |

### 4. 解锁流程

首次访问付费书籍需先解锁：

```
$resourceUnlock('ebook', bookId, turnstileToken)
  → POST /api/public/unlock_resource
  → 返回 access_key
  → 加密存入 localStorage["resource_ac"]
```

**关键发现**：服务端对已登录用户不强制验证 Turnstile token，传空字符串即可完成解锁：

```js
await useNuxtApp().$resourceUnlock('ebook', bookId, '');
```

### 5. 书名提取

`document.title` 在部分页面为空，改用 Nuxt SSR state 中 bookId 定位：

```js
// __NUXT_DATA__ inline script 中，bookId 后紧跟书名
new RegExp(`"${bookId}","([^"]{2,60})"`)
```

### 6. PDF 原站排版

- 动态获取原站 CSS URL：`Array.from(document.styleSheets).find(s => s.href?.includes('leshu8'))`
- 新窗口使用原站 `reader-article` CSS 类渲染内容
- 自动触发 `window.print()`，用户选「另存为 PDF」

---

## API 汇总

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/public/ebook/{bookId}/chapter?page={N}` | GET | 获取章节内容（需认证） |
| `/api/public/unlock_resource` | POST | 解锁书籍（获取 access_key） |
| `/api/public/script/cid` | POST | 获取客户端 ID |
| `/api/auth/login` | POST | 登录 |
| `/api/auth/refresh` | POST | 刷新 token |
| `/api/user/me` | GET | 获取用户信息 |

---

## 脚本功能

- **⬇ 下载 HTML**：自动解锁 → 遍历全部章节 → 导出带自定义排版的单文件 HTML
- **🖨 打印 / PDF**：同上 → 新窗口加载原站 CSS → 自动弹出打印对话框

### 关键实现

```js
// 自动解锁
await useNuxtApp().$resourceUnlock('ebook', bookId, '');

// 获取章节（每章刷新 dsac 防过期）
const headers = {
  authorization: `Bearer ${localStorage.getItem('token')}`,
  dsac: await useNuxtApp().$getRequestAccessKey('ebook', bookId),
  cid:  await useNuxtApp().$getClientId(),
};
const { content } = await fetch(`/api/public/ebook/${bookId}/chapter?page=${page}`, { headers }).then(r => r.json());
```

---

## 脚本地址

- **安装**：https://raw.githubusercontent.com/hahapkpk/tools/main/leshu8-downloader.user.js
- **源码**：https://github.com/hahapkpk/tools/blob/main/leshu8-downloader.user.js

### 版本历史

| 版本 | 说明 |
|------|------|
| v1.0.0 | 基础 HTML 下载功能 |
| v1.1.0 | 自动解锁（无需手动触发） |
| v1.2.0 | 修复书名提取；新增 PDF 打印模式（原站排版） |
