# hubei21-autolearn - 湖北21世纪学习平台自动刷课脚本

## 项目背景

[湖北21世纪学习平台](https://www.hubei21.com)（hubei21.com）是湖北省专业技术人员继续教育学习平台。用户需要按顺序观看所有课程视频并达到规定学时后才能参加考试。平台限制必须看完当前课程才能进入下一课，整个过程耗时较长。

本脚本通过分析平台的前端 API 机制，直接向服务器上报学习进度，跳过实际观看环节，实现快速完成全部课程学习。

## 实现原理

### 1. 平台技术栈分析

通过 Chrome DevTools 分析，该平台使用：

- **前端框架**: Vue 3 + Naive UI
- **路由**: Hash 模式 SPA（如 `#/course/368?year=2026`）
- **认证**: localStorage 存储 token，API 请求通过 `token` header 携带
- **API 基地址**: `https://api.hubei21.com/api`

### 2. 学习进度上报机制

通过拦截 XMLHttpRequest，发现平台的视频播放页面在播放过程中会**每隔约 10 秒**向服务器上报一次学习进度：

**API 端点**: `POST https://api.hubei21.com/api/video_detail_study`

**请求参数**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `video_id` | number | 课程 ID（如 368） |
| `video_detail_id` | number | 单节课 ID（如 948-963） |
| `ratio` | string | 学习进度百分比（"50.00" 表示 50%） |
| `time` | number | 已播放时间（秒） |
| `year` | string | 年份（如 "2026"） |

**请求头**:



### 3. 课程列表获取

**API 端点**: `GET https://api.hubei21.com/api/video_detail?video_id={id}&year={year}`

返回数据包含：

- `list`: 所有课程章节数组（含 id、title、url 等）
- `study_detail`: 每节课的学习状态（status、ratio、time）
- `total_studytime`: 总需学时
- `get_studytime`: 已获学时

### 4. 脚本工作流程



### 5. 关键设计决策

- **分 2 次上报（而非直接 100%）**: 模拟渐进式观看，降低被平台检测的风险
- **课程间设置间隔**: 避免请求过于密集触发限流
- **使用 localStorage 中的 token**: 无需额外登录，复用浏览器已有的认证状态
- **SPA 路由监听**: 通过 `hashchange` 事件适配 Vue Router，仅在课程页面显示面板

## 文件结构



## 使用方式

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. [点击安装脚本](https://raw.githubusercontent.com/hahapkpk/tools/main/hubei21-autolearn.user.js)
3. 登录 [hubei21.com](https://www.hubei21.com) 并打开课程页面
4. 页面右上角出现「自动刷课助手」面板
5. 点击「开始刷课」，等待约 1 分钟即可完成全部 16 节课

## 注意事项

- 需要先在平台上正常登录并购买课程
- 脚本依赖浏览器 localStorage 中的 token，如 token 过期需重新登录
- 如平台更新 API 接口，脚本可能需要对应调整
