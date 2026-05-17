# 夸克网盘油猴脚本工具集

针对夸克网盘 PC 网页版的两个油猴脚本，弥补网页版缺失的功能。

---

## 脚本一：夸克网盘链接预检

**安装地址：** https://github.com/hahapkpk/tools/raw/refs/heads/main/quark-link-precheck.user.js

**版本：** 0.5.3

### 功能

- 扫描当前页面中所有 `pan.quark.cn/s/` 链接
- 批量检测链接是否有效、是否需要提取码、是否部分违规
- 检测结果在链接旁边显示 badge 标记
- 页面有夸克链接时自动展开面板
- 打开电影页面时自动切换到"夸克网盘"tab
- 支持设置并发线程数和检测间隔

### 适用网站

- 教父.com（`xn--wcv59z.com`）
- 任何包含夸克网盘链接的页面

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

**安装地址：** https://github.com/hahapkpk/tools/raw/refs/heads/main/quark-save-rename.user.js

**版本：** 0.8.6

**适用页面：**
- `pan.quark.cn/s/*`（分享页）
- `pan.quark.cn/list*`（网盘列表页）

### 功能

#### 分享页（`pan.quark.cn/s/`）

- 在页面顶部注入重命名输入框
- 保存文件到网盘后自动重命名为输入的名称
- 自动从来源页面（教父.com）的链接文字提取标准电影名称填入输入框
- 自动清理文件名中的特殊符号、emoji、技术参数，保留电影名和年份

**工作流程：**
1. 在教父.com 点击夸克链接 → 链接文字自动传递到夸克分享页
2. 输入框预填清理后的电影名（如 `鬼灭之刃：无限城篇 第一章 猗窝座再袭 (2025)`）
3. 点击"保存到网盘" → 脚本自动重命名保存后的文件夹

#### 网盘列表页（`pan.quark.cn/list`）

**回收站功能（侧边栏 🗑️ 按钮）：**
- 查看回收站文件列表（使用 App 端 `deep_recycle/list` API）
- 多选文件
- **彻底删除**选中文件（`recycle/remove` API）
- **还原**选中文件到原位置
- 手动刷新按钮（↻）
- 删除后立即从列表移除，无需等待服务端缓存刷新

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

教父.com 点击夸克链接时，脚本将链接文字编码到 URL hash：
```
pan.quark.cn/s/xxx#/list/share?_title=电影名
```
夸克分享页从 hash 读取并填入输入框。

---

## 安装方式

需要先安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展，然后点击上方安装地址即可。
