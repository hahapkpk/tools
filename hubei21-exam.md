# hubei21-exam.user.js — AI 自动答题脚本

## 项目简介

针对湖北21世纪学习平台（hubei21.com）考试模块开发的 Tampermonkey 油猴脚本。脚本在用户进入考试页面后自动加载，通过调用 AI API 分析题目并填写答案，等待最低考试时长后自动交卷，全程无需人工干预。

## 功能特性

- **自动提取题目**：解析页面 DOM，识别单选题、多选题、判断题
- **AI 智能答题**：调用 OpenAI 兼容 API，将全部题目一次性发送给 AI 分析
- **自动填写答案**：根据 AI 返回结果自动点击对应选项
- **定时自动交卷**：等待设定时长（默认 11 分钟）后自动点击交卷
- **可视化进度面板**：悬浮 UI 显示当前状态、进度条和日志
- **灵活配置**：支持自定义 API Base、Key、模型和等待时长

## 安装方式

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 访问 [GitHub 脚本地址](https://github.com/hahapkpk/tools/blob/main/hubei21-exam.user.js)，点击 Raw 即可自动安装
3. 安装后访问考试页面，脚本会自动加载面板

## 使用流程

```
进入考试页面
    ↓
脚本自动检测并加载面板
    ↓
点击「配置」填写 AI API Key 等参数（首次使用）
    ↓
点击「一键答题」
    ↓
脚本提取题目 → 调用 AI → 解析答案 → 填写选项
    ↓
倒计时等待（默认 11 分钟）
    ↓
自动交卷
```

## 配置说明

点击面板上的「配置」按钮或通过 Tampermonkey 菜单「AI 答题配置」打开设置。

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| API Base URL | OpenAI 兼容接口地址 | `https://api.laozhang.ai/v1` |
| API Key | 你的 API 密钥 | 空（必填） |
| 模型 | 使用的模型名称 | `gpt-4o` |
| 交卷等待时间 | 提交前等待分钟数 | `11` |

> 支持任何 OpenAI 兼容 API，如 DeepSeek、Claude、通义千问等中转服务。

## 技术实现

### 核心架构

```
hubei21-exam.user.js
├── 配置管理 (GM_getValue / GM_setValue)
├── 题目提取 (extractQuestions)
├── AI 调用 (callAI / GM_xmlhttpRequest)
├── 答案解析 (parseAIResponse)
├── 答案填写 (fillAnswers)
├── 定时交卷 (clickSubmit)
└── UI 面板 (createPanel)
```

### 题目提取

脚本遍历页面中所有 `.content` 元素，通过正则匹配题目编号和文本，识别选项（`.n-radio__label` / `.n-checkbox__label`），并根据题目文本中的关键词判断题型：

```javascript
// 题型判断
if (qText.includes('多选题')) type = 'multi';
else if (qText.includes('判断题')) type = 'judge';
else type = 'single';
```

### AI Prompt 设计

将所有题目格式化后一次性发送，要求 AI 返回纯 JSON：

```
你是一个中国继续教育考试答题专家。
...
要求：直接返回 JSON 数组，格式为 [{"num": 题号, "answer": 答案}]
- 单选题和判断题：answer 为字母，如 "A"、"B"
- 多选题：answer 为字母拼接，如 "AB"、"ABCD"
- 判断题：A=正确，B=错误
```

### 跨域请求

使用 `GM_xmlhttpRequest` 绕过浏览器同源限制，直接访问 AI API：

```javascript
GM_xmlhttpRequest({
  method: 'POST',
  url: `${config.apiBase}/chat/completions`,
  headers: { Authorization: `Bearer ${config.apiKey}` },
  data: JSON.stringify({ model, messages, temperature: 0.1 }),
  timeout: 120000,
  onload(resp) { /* 解析响应 */ }
});
```

### 答案填写

字母转索引，再通过模拟点击填写：

```javascript
function letterToValue(letter) {
  return { A:1, B:2, C:3, D:4 }[letter.toUpperCase()] || 1;
}
// 单选/判断：点击对应 .n-radio
// 多选：逐个点击 .n-checkbox
```

### 最低考试时长限制

平台服务端强制要求考试时长不低于约 10 分钟（返回"考试时长过短"错误），因此脚本默认等待 11 分钟后再交卷，该时长可在配置中调整。

## 平台逆向分析摘要

| 接口 | 方法 | 说明 |
|------|------|------|
| `/start_exam` | POST | 开始考试，返回试卷 ID 和题目内容 |
| `/stop_exam` | POST | 提交答案，返回得分统计 |

**关键发现：**
- 每次考试题目从题库随机抽取，不固定
- 提交响应**不包含正确答案**，只返回得分
- 服务端校验最低答题时长（约 10 分钟），无法绕过
- 页面使用 Vue 3 + Naive UI，选项组件为 `.n-radio` / `.n-checkbox`

## 注意事项

1. **API Key 必填**：首次运行会自动弹出配置界面
2. **AI 准确率**：AI 答题准确率因题目和模型而异，建议使用 GPT-4o 或 DeepSeek
3. **不要刷新页面**：考试开始后刷新页面会保留考试，但已填写的答案需重新填写
4. **考试次数**：平台通常限制考试次数，请合理使用

## 相关脚本

- [hubei21-autolearn.user.js](hubei21-autolearn.md) — 自动完成视频学习进度

## 文件信息

- **作者**：Flywind
- **版本**：1.0.0
- **适用平台**：https://www.hubei21.com
- **GitHub**：https://github.com/hahapkpk/tools
