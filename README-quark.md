# 夸克网盘油猴脚本工具集

针对夸克网盘 PC 网页版的两个油猴脚本，弥补网页版缺失的功能。

---

## 脚本一：夸克网盘链接预检

**安装地址：** https://raw.githubusercontent.com/hahapkpk/tools/main/quark-link-precheck.user.js

**版本：** 0.7.0

### 功能

- 扫描当前页面中所有 `pan.quark.cn/s/` 链接
- 批量检测链接是否有效、是否需要提取码、是否部分违规
- 检测结果在链接旁边显示 badge 标记
- 页面有夸克链接时自动展开面板
- 打开电影页面时自动切换到"夸克网盘"tab
- 支持设置并发线程数和检测间隔
- 点击夸克链接时把**影片页 H1 的片名**写进 `_title`，供保存脚本预填重命名

### 适用网站

- 教父.com（`xn--wcv59z.com`）
- qmp4.com
- 白名单外的页面会在 10 秒内快速退出

### 检测状态说明

| 状态 | 含义 |
|------|------|
| 可用 | 链接有效，可正常访问 |
| 需提取码 | 链接存在但需要提取码 |
| 部分违规 | 链接可访问，但部分文件可能被屏蔽 |
| 失效 | 链接已失效或被删除 |
| 检测失败 | 网络请求失败 |

---

## 脚本二：夸克网盘保存并重命名

**安装地址：** https://raw.githubusercontent.com/hahapkpk/tools/main/quark-save-rename.user.js

**版本：** 0.9.0

**适用页面：**
- `pan.quark.cn/s/*`（分享页）
- `pan.quark.cn/list*`（网盘列表页）

### 功能

#### 分享页（`pan.quark.cn/s/`）

- 在页面顶部注入重命名输入框
- 保存文件到网盘后自动重命名为输入的名称
- 从来源页面传入的影片标题预填输入框
- 清理文件名中的特殊符号、emoji、标签，保留片名和年份

**工作流程：**
1. 在教父.com 点击夸克链接 → 脚本把影片页 H1 的片名写进 URL hash
2. 输入框预填清理后的电影名（如 `人性本兽 Animals (2026)`）
3. 点击"保存到网盘" → 脚本自动重命名保存后的文件夹

#### 网盘列表页（`pan.quark.cn/list`）

**回收站功能（侧边栏 🗑️ 按钮）：**
- 查看回收站文件列表（使用 App 端 `deep_recycle/list` API）
- 多选文件
- **彻底删除**选中文件（`recycle/remove` API）
- **还原**选中文件到原位置
- 手动刷新按钮（↻）
- 删除/还原后立即从列表移除，无需等待服务端缓存刷新

> 注：夸克服务端对 `deep_recycle/list` 有缓存，刷新按钮可能需要等几分钟才能反映 App 端的操作。彻底删除操作本身是即时生效的。

---

## 技术说明

### 夸克网盘 API

| 接口 | 用途 |
|------|------|
| `POST /1/clouddrive/share/sharepage/token` | 获取分享 token |
| `GET /1/clouddrive/share/sharepage/detail` | 获取分享详情 |
| `POST /1/clouddrive/share/sharepage/save` | 保存分享到网盘 |
| `GET /1/clouddrive/task` | 查询任务状态 |
| `POST /1/clouddrive/file/rename` | 重命名文件 |
| `GET /1/clouddrive/file/deep_recycle/list` | 回收站列表（App 端 API） |
| `POST /1/clouddrive/file/recycle/remove` | 彻底删除回收站文件 |
| `POST /1/clouddrive/file/recycle/recover` | 还原回收站文件 |

### 跨页面标题传递

教父.com 点击夸克链接时，脚本把**详情页 H1 的片名**编码到 URL hash：

```
pan.quark.cn/s/xxx#/list/share?_title=人性本兽 Animals (2026)
```

夸克分享页从 hash 读取，清理后填入输入框。

> 早期版本用的是资源行的链接文字，而那是上传者自己起的分享名（常被改成「人姓本授」这类规避关键词的写法），所以经常取到错的片名。0.7.0 起改为取 H1，取不到才退回链接文字。

---

## 更新记录

### 0.7.0 / 0.9.0

**取标题修复（两个脚本一起更新才生效）**
- 预检脚本改为从影片页 `h1`（其次 `og:title`）取片名，不再用资源行链接文字
- 保存脚本的 `cleanMovieName` 重写：不再把 `【】` 里的标签当片名，不再产出只剩 `(年份)` 的空名字
- 清洗后为空时明确提示并跳过重命名，不再静默发出 `file_name: ""`

**保存脚本（0.9.0）**
- 修复 fetch 钩子：初始 `fetch` 也会被包装（旧实现只有页面重新赋值 `fetch` 时才生效）
- 重命名只走直连一次，失败才通过 BroadcastChannel 转交网盘页，避免 N+1 次重复请求
- 支持一次保存多个条目（遍历 `save_as_top_fids`）
- 首次重命名前等待 1.5s，网络错误自动重试 3 次
- 输入框注入改为等待 `.share-info-wrap`，不再提前掉进浮动兜底
- 回收站文件名做 HTML 转义；还原不再清空整个列表
- 移除未使用的 `renameFile()` / `API_FILE`

**预检脚本（0.7.0）**
- `classifyTokenResponse` 改用 `code === 0 && data.stoken` 判断成功（旧实现依赖 `message` 含 `ok`，message 为空时全判成「未知」）
- 白名单改为 origin + pathname 前缀匹配（旧实现 `indexOf` 可被 `?next=` 绕过）
- DOM 变化回调加 400ms debounce，避免每次 mutation 都做全量 `innerHTML` + `innerText`
- 扫描结束保持面板展开
- `findPasscode` 不再把「解压密码」「验证码」误判成提取码
- 白名单拉取不再阻塞页面激活
- `@connect` 收窄为 `drive-h.quark.cn` + `raw.githubusercontent.com`
- 移除 `www.wdku.net` 的 `@match`（该域是「依奇 在线超级转换工具」，且不在白名单里，实际从未生效）

---

## 安装方式

需要先安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展，然后点击上方安装地址即可。
