// ==UserScript==
// @name         GitHub 中文化增强版
// @name:en      GitHub Chinese Translator Pro
// @namespace    https://github.com/hahapkpk/tools
// @version      1.0.0
// @description  将 GitHub 界面（导航、下拉菜单、弹窗、工具提示、Shadow DOM 时间、Issue/PR 等）即时译为简体中文。本地词表与规则引擎零请求毫秒级响应；README / 仓库简介 / Issue·PR 正文支持无刷新就地翻译与还原；内置 Google / Bing / 有道 / MyMemory 多源在线翻译与熔断机制，支持配置 AI（DeepSeek / 硅基流动 / 智谱 GLM / OpenAI 兼容）、百度及腾讯云翻译源。
// @description:en  Translate GitHub UI and content into Simplified Chinese with a fast local dictionary, updated 2026 React/Primer selectors, in-place toggle translation without page reload, and resilient online translation providers.
// @author       hahapkpk
// @match        https://github.com/*
// @match        https://gist.github.com/*
// @match        https://githubstatus.com/*
// @match        https://www.githubstatus.com/*
// @match        https://*.githubstatus.com/*
// @icon         https://github.githubassets.com/favicons/favicon.svg
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/github-zh-translator.user.js
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/github-zh-translator.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      clients5.google.com
// @connect      translate.googleapis.com
// @connect      www.bing.com
// @connect      m.youdao.com
// @connect      api.mymemory.translated.net
// @connect      fanyi-api.baidu.com
// @connect      tmt.tencentcloudapi.com
// @connect      api.deepseek.com
// @connect      api.siliconflow.cn
// @connect      open.bigmodel.cn
// @connect      api.openai.com
// @connect      *
// @run-at       document-idle
// @license      GPL-3.0
// ==/UserScript==

/*
 * Based on concepts and base UI glossary from "GitHub 中文化（最全翻译版）"
 * by Yujan (https://greasyfork.org/zh-CN/scripts/602755), licensed under GPL-3.0.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ============================================================
   * 1. 配置与存储
   * ============================================================ */
  const ONLINE_KEY = 'gh_zh_online_v1';
  const CREDS_KEY = 'gh_zh_creds_v1';
  const CACHE_KEY = 'gh_zh_cache_v1';
  const SS_PREFIX = 'gh_zh_toggle:';
  const CACHE_MAX = 5000;

  const TRANSLATE_ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  const VALUE_ATTR_HOSTS = /^(submit|button|reset)$/i;

  const NON_REPO_OWNERS = new Set([
    'about', 'account', 'apps', 'codespaces', 'collections', 'contact',
    'copilot', 'customers', 'dashboard', 'enterprise', 'enterprises',
    'events', 'explore', 'features', 'issues', 'login', 'logout',
    'marketplace', 'new', 'notifications', 'organizations', 'orgs',
    'pricing', 'pulls', 'resources', 'search', 'security', 'settings',
    'signup', 'site', 'solutions', 'sponsors', 'stars', 'team',
    'topics', 'trending', 'users',
  ]);

  const CFG = {
    online: true,
    translateAttributes: true,
    providers: ['ai', 'baidu', 'tencentcloud', 'googleClient', 'google', 'bingWeb', 'youdaoMobile', 'mymemory'],
    batchItems: 16,
    batchChars: 1800,
    apiDelay: 60,
    requestTimeout: 6500,
    maxRetry: 2,
    fullRescanMs: 8000,
    skipSelectors: [
      'pre', 'code', 'kbd', 'samp', 'var',
      'script', 'style', 'noscript', 'textarea', 'select',
      'svg', 'canvas', 'math', 'iframe', 'object',
      '.blob-code', '.highlight', '.react-code-text', '.react-blob-print-hide',
      '.markdown-body pre', '.markdown-body code',
      '[contenteditable="true"]', '.styled-input-container', 'input',
      // 搜索输入框、查询构建器与命令面板
      'input[type="search"]', '[data-testid="search-input"]', '[data-testid="top-search-input"]',
      'input[name="q"]', '.search-input', '#search-input',
      '[role="searchbox"]', '[role="search"]',
      '[data-testid="search-results"]', '[data-testid="search-suggestions"]',
      '[class*="search-suggestions"]', '[class*="SearchSuggestions"]',
      '[class*="search-input"]', '[class*="SearchInput"]',
      '.header-search', '[class*="quick-search"]', '[class*="QuickSearch"]',
      '[class*="command-palette"]', '[class*="CommandPalette"]',
      '[data-testid*="quick-search"]', '[data-testid*="command-palette"]',
      '[role="dialog"][class*="search" i]', '[class*="SearchOverlay"]', '[class*="search-overlay"]',
      'query-builder', '[data-target*="query-builder"]',
      'query-builder [role="listbox"]', '[role="search"] [role="listbox"]',
      '[data-testid="search-results"] [role="option"]',
      // 文件树与文件列表：仅跳过文件名与提交说明单元格，保留表头与时间列翻译
      '[aria-labelledby="files"] .js-navigation-item .css-truncate',
      '.react-directory-filename-column',
      '[class*="react-directory-row-name-cell"]',
      '.react-directory-row-commit-cell',
      '[data-testid="tree-view"]', '[role="tree"]',
      // 分支/标签切换按钮自身的分支名
      '[class*="RefSelectorOverlayBtn"]',
      '[data-testid="anchor-button"][aria-label$="branch"]',
      '.BranchName', '.commit-ref',
      '[data-zh-skip]', '[data-zh-toggle]',
    ].join(','),
  };

  function readStore(key, fallback) {
    let raw = '';
    try {
      if (typeof GM_getValue === 'function') raw = GM_getValue(key, '') || '';
    } catch (e) {}
    if (!raw && typeof localStorage !== 'undefined') {
      try { raw = localStorage.getItem(key) || ''; } catch (e) {}
    }
    return raw || fallback;
  }

  function writeStore(key, value) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(key, value);
    } catch (e) {}
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem(key, value); } catch (e) {}
    }
  }

  (function loadOnlinePref() {
    const raw = readStore(ONLINE_KEY, '');
    if (raw === '0') CFG.online = false;
    else if (raw === '1') CFG.online = true;
  })();

  function saveOnline() {
    writeStore(ONLINE_KEY, CFG.online ? '1' : '0');
  }

  function repoKey(pathname) {
    const pathStr = pathname != null ? String(pathname) : (typeof location !== 'undefined' ? location.pathname : '');
    const parts = pathStr.split('/').filter(Boolean);
    if (parts.length < 2) return '';
    if (NON_REPO_OWNERS.has(parts[0].toLowerCase())) return '';
    return parts[0] + '/' + parts[1];
  }

  function ssKey(kind) {
    return SS_PREFIX + repoKey() + ':' + kind;
  }

  function ssGet(kind) {
    try {
      return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(ssKey(kind)) === '1';
    } catch (e) {
      return false;
    }
  }

  function ssSet(kind, on) {
    try {
      if (typeof sessionStorage === 'undefined') return;
      if (on) sessionStorage.setItem(ssKey(kind), '1');
      else sessionStorage.removeItem(ssKey(kind));
    } catch (e) {}
  }

  const pageState = { readme: false, about: false, issue: false };
  const zoneBusy = { readme: false, about: false, issue: false };
  const zoneSeq = { readme: 0, about: 0, issue: 0 };

  function refreshPageState() {
    pageState.readme = ssGet('readme');
    pageState.about = ssGet('about');
    pageState.issue = ssGet('issue');
  }

  /* ============================================================
   * 2. 本地词表与正则短语引擎
   * ============================================================ */
  const RAW_DICT = {
    "Code": "代码", "Issues": "议题", "Pull requests": "拉取请求", "Discussions": "讨论", "Actions": "操作",
    "Projects": "项目", "Wiki": "维基", "Security": "安全", "Insights": "洞察", "Settings": "设置", "Pulse": "动态",
    "Graphs": "图表", "Network": "网络", "Forks": "复刻", "Stars": "星标", "Watchers": "关注者", "Releases": "发行版",
    "Packages": "软件包", "Environments": "环境", "Deployments": "部署", "Codespaces": "代码空间", "Sponsors": "赞助者",
    "Marketplace": "市场", "Explore": "探索", "Notifications": "通知", "Dashboard": "仪表盘", "Trending": "趋势",
    "Topics": "话题", "Collections": "收藏", "Events": "事件", "Blog": "博客", "About": "关于", "Pricing": "定价",
    "Support": "支持", "Community": "社区", "Documentation": "文档", "Terms": "条款", "Privacy": "隐私",
    "Status": "状态", "Contact": "联系", "Search": "搜索", "Sign in": "登录", "Sign up": "注册", "Sign out": "退出登录",
    "Sign up for GitHub": "注册 GitHub", "Sign in to GitHub": "登录 GitHub", "Upgrade": "升级",
    "Feature preview": "功能预览", "Help": "帮助", "Feedback": "反馈", "Your profile": "你的个人资料",
    "Your repositories": "你的仓库", "Your stars": "你的星标", "Your gists": "你的代码片段", "Your projects": "你的项目",
    "Your organizations": "你的组织", "Your enterprises": "你的企业", "Your sponsors": "你的赞助", "Set status": "设置状态",
    "Manage account": "管理账户", "Switch theme": "切换主题", "Appearance": "外观", "Light": "浅色", "Dark": "深色",
    "System": "跟随系统", "Light default": "浅色（默认）", "Light high contrast": "浅色（高对比度）", "Dark default": "深色（默认）",
    "Dark high contrast": "深色（高对比度）", "Dark dimmed": "深色（柔和）", "Copy link": "复制链接",
    "Open in new tab": "在新标签页打开", "New repository": "新建仓库", "Import repository": "导入仓库",
    "New codespace": "新建代码空间", "New gist": "新建代码片段", "New organization": "新建组织", "New project": "新建项目",
    "Create new": "新建", "Open user menu": "打开用户菜单", "Watch": "关注", "Unwatch": "取消关注", "Star": "星标",
    "Unstar": "取消星标", "Fork": "复刻", "Pin": "置顶", "Unpin": "取消置顶", "Edit Pins": "编辑置顶", "Branches": "分支",
    "Tags": "标签", "Go to file": "转到文件", "Add file": "添加文件", "Create new file": "新建文件",
    "Upload files": "上传文件", "Find file": "查找文件", "Clone": "克隆", "Download ZIP": "下载 ZIP",
    "Open with GitHub Desktop": "用 GitHub Desktop 打开", "Open with Visual Studio": "用 Visual Studio 打开",
    "Open with Visual Studio Code": "用 Visual Studio Code 打开", "Local": "本地", "Latest commit": "最新提交",
    "History": "历史", "Commit history": "提交历史", "Contributors": "贡献者", "Languages": "语言", "Readme": "README",
    "License": "许可证", "Activity": "活动", "Custom properties": "自定义属性", "Used by": "使用者",
    "Report repository": "举报仓库", "Starred": "已星标", "Public": "公开", "Private": "私有", "Internal": "内部",
    "Archived": "已归档", "Template": "模板", "Default": "默认", "View all branches": "查看全部分支",
    "View all tags": "查看全部标签", "View all files": "查看全部文件", "Manage topics": "管理话题",
    "Edit repository details": "编辑仓库详情", "Raw": "原始", "Blame": "追溯", "Copy raw content": "复制原始内容",
    "Download raw file": "下载原始文件", "Edit this file": "编辑此文件", "Delete this file": "删除此文件",
    "Open in github.dev": "在 github.dev 中打开", "Preview": "预览", "Edit": "编辑", "Split": "分屏", "Unified": "统一",
    "Hide whitespace": "隐藏空白", "Show whitespace": "显示空白", "New issue": "新建议题", "New pull request": "新建拉取请求",
    "Open": "打开", "Closed": "已关闭", "All": "全部", "Author": "作者", "Label": "标签", "Milestone": "里程碑",
    "Assignee": "指派给", "Sort": "排序", "Comments": "评论", "Comment": "评论", "Review required": "需要评审",
    "Approved": "已批准", "Changes requested": "请求更改", "Draft": "草稿", "Ready for review": "可供评审",
    "Merge pull request": "合并拉取请求", "Squash and merge": "压缩并合并", "Rebase and merge": "变基并合并",
    "Create a merge commit": "创建合并提交", "Confirm merge": "确认合并", "Confirm squash and merge": "确认压缩并合并",
    "Confirm rebase and merge": "确认变基并合并", "Create merge commit": "创建合并提交", "Delete branch": "删除分支",
    "Restore branch": "恢复分支", "Reopen": "重新打开", "Close": "关闭", "Close issue": "关闭议题",
    "Close with comment": "评论并关闭", "Close as": "关闭为", "Close as completed": "关闭为已完成",
    "Close as not planned": "关闭为不计划", "Close as duplicate": "关闭为重复", "Add a comment": "添加评论", "Write": "编写",
    "Subscribe": "订阅", "Unsubscribe": "取消订阅", "Participants": "参与者", "Linked pull requests": "关联的拉取请求",
    "Development": "开发", "No description provided.": "未提供描述。", "Files changed": "文件变更", "Commits": "提交",
    "Checks": "检查", "Conversation": "对话", "Merge": "合并", "Merged": "已合并", "Reviewers": "评审者",
    "Assignees": "指派给", "Labels": "标签", "Linked issues": "关联议题", "This branch is up to date": "此分支已是最新",
    "Compare": "比较", "Contribute": "贡献", "Sync fork": "同步复刻", "Open pull request": "打开拉取请求",
    "Pull request": "拉取请求", "Issue": "议题", "Commit": "提交", "Review": "评审", "Approve": "批准",
    "Approve and run": "批准并运行", "Request changes": "请求更改", "Add review comment": "添加评审批注",
    "Submit review": "提交评审", "Finish your review": "完成评审", "Leave a comment": "留下评论",
    "Add your comment here...": "在此添加你的评论…", "Reference in new issue": "在新议题中引用", "Quote reply": "引用回复",
    "Edit comment": "编辑评论", "Delete comment": "删除评论", "Copy link to comment": "复制评论链接",
    "Mark as read": "标记为已读", "Mark as unread": "标记为未读", "Mark as done": "标记为完成",
    "Mark all as read": "全部标记为已读", "Mark as spam": "标记为垃圾信息", "Hide comment": "隐藏评论",
    "Report content": "举报内容", "Inbox": "收件箱", "Saved": "已保存", "Done": "已完成", "Filter notifications": "筛选通知",
    "Sort by": "排序方式", "Newest": "最新", "Oldest": "最早", "Recently updated": "最近更新",
    "Least recently updated": "最久未更新", "Most commented": "评论最多", "Most comments": "评论最多",
    "Fewest comments": "评论最少", "Best match": "最佳匹配", "Most stars": "星标最多", "Most forks": "复刻最多",
    "Recently indexed": "最近收录", "Recently created": "最近创建", "Filter by": "筛选条件", "Clear filter": "清除筛选",
    "Clear filters": "清除筛选", "Show only": "仅显示", "Everything": "全部", "Not starred": "未星标",
    "Open issues": "打开的议题", "Closed issues": "已关闭的议题", "Your issues": "你的议题",
    "Open pull requests": "打开的拉取请求", "Closed pull requests": "已关闭的拉取请求", "Your pull requests": "你的拉取请求",
    "Everything assigned to you": "指派给你的全部内容", "Everything mentioned": "提及你的全部内容",
    "Everything you’re involved in": "你参与的全部内容", "Last 24 hours": "最近 24 小时", "Last 7 days": "最近 7 天",
    "Last 30 days": "最近 30 天", "Last 3 months": "最近 3 个月", "Last year": "去年", "All time": "全部时间",
    "Filter": "筛选", "Filters": "筛选", "Clear": "清除", "Apply": "应用", "Participating and @mentions": "参与及 @提及",
    "All Activity": "所有活动", "Ignore": "忽略", "Custom": "自定义", "Stop ignoring": "停止忽略", "Not watching": "未关注",
    "Watching": "关注中", "Save": "保存", "Save changes": "保存更改", "Commit changes": "提交更改", "Cancel": "取消",
    "Delete": "删除", "Remove": "移除", "Add": "添加", "Create": "创建", "Update": "更新", "Copy": "复制",
    "Copied!": "已复制！", "Download": "下载", "Upload": "上传", "Submit": "提交", "Confirm": "确认", "Continue": "继续",
    "Back": "返回", "Next": "下一步", "Previous": "上一步", "Finish": "完成", "Retry": "重试", "Refresh": "刷新",
    "Reset": "重置", "Select": "选择", "Select all": "全选", "Deselect": "取消选择", "Show": "显示", "Hide": "隐藏",
    "Expand": "展开", "Collapse": "收起", "More": "更多", "Less": "更少", "Show more": "显示更多", "Load more": "加载更多",
    "Read more": "阅读更多", "Learn more": "了解更多", "Get started": "开始使用", "Try again": "重试", "Go back": "返回",
    "Return to": "返回", "View": "查看", "View all": "查看全部", "See all": "查看全部", "Show all": "显示全部",
    "Manage": "管理", "Configure": "配置", "Install": "安装", "Uninstall": "卸载", "Enable": "启用", "Disable": "禁用",
    "Enabled": "已启用", "Disabled": "已禁用", "Rename": "重命名", "Duplicate": "复制副本", "Archive": "档案",
    "Unarchive": "取消归档", "Transfer": "转移", "Share": "分享", "Print": "打印", "Mute": "静音", "Unmute": "取消静音",
    "Block": "屏蔽", "Unblock": "取消屏蔽", "Report": "举报", "Delete permanently": "永久删除", "Restore": "恢复",
    "Discard": "放弃", "Undo": "撤销", "Redo": "重做", "Cancel changes": "取消更改", "Ask Copilot": "询问 Copilot",
    "Add to list": "添加到列表", "Remove from list": "从列表移除", "Bold": "粗体", "Italic": "斜体", "Quote": "引用",
    "Link": "链接", "Numbered list": "有序列表", "Bulleted list": "无序列表", "Task list": "任务列表",
    "Attach files": "附加文件", "Mention": "提及", "Reference": "引用", "Add heading text": "添加标题文本",
    "Add bold text": "添加粗体文本", "Add italic text": "添加斜体文本", "Insert a quote": "插入引用", "Insert code": "插入代码",
    "Insert a link": "插入链接", "Updated": "更新于", "Created": "创建于", "Yesterday": "昨天", "Last week": "上周",
    "Last month": "上个月", "Profile": "个人资料", "Repositories": "仓库", "Gists": "代码片段", "Organizations": "组织",
    "Enterprises": "企业", "Copilot settings": "Copilot 设置", "Accessibility": "无障碍",
    "Starred repositories": "已星标仓库", "Your Copilot": "你的 Copilot", "Public profile": "公开资料", "Account": "账户",
    "Emails": "电子邮件", "Sessions": "会话", "Credentials": "凭据", "Password and authentication": "密码和身份验证",
    "SSH and GPG keys": "SSH 和 GPG 密钥", "Billing and plans": "计费和账单", "Billing and licensing": "计费与许可",
    "Moderation": "审核", "Access": "访问", "Code, planning, and automation": "代码、规划与自动化", "Copilot": "Copilot",
    "Pages": "页面", "Saved replies": "已保存的回复", "Code security": "代码安全", "Integrations": "集成",
    "Applications": "应用", "Scheduled reminders": "预定提醒", "Security log": "安全日志", "Sponsor log": "赞助日志",
    "Secrets and variables": "机密与变量", "Webhooks": "Webhooks", "Deploy keys": "部署密钥",
    "GitHub Apps": "GitHub Apps", "OAuth Apps": "OAuth 应用", "Two-factor authentication": "双重身份验证",
    "Name": "名称", "Public email": "公开的邮箱", "Bio": "个人简介", "Pronouns": "代词", "Website": "网站",
    "Social accounts": "社交账号", "Company": "公司", "Location": "地点", "Show current local time": "显示当前本地时间",
    "Profile picture": "个人资料图片", "ORCID iD": "ORCID iD", "Connect your ORCID iD": "连接您的 ORCID iD",
    "Select a verified email to display": "选择要显示的已验证电子邮件", "Don't specify": "不指定",
    "Tell us a little bit about yourself": "简单介绍一下你自己", "Link to social profile": "社交资料链接", "Endorse": "推荐",
    "Home": "首页", "Feed": "动态", "Type / to search": "输入 / 以搜索", "Type to search": "输入以搜索",
    "Search or jump to…": "搜索或跳转到…", "Search or jump to...": "搜索或跳转到…", "Top repositories": "热门仓库",
    "Popular repositories": "热门仓库", "Customize your pins": "自定义置顶", "Pin a repository": "置顶仓库",
    "Show less": "收起", "Edit profile": "编辑资料", "View profile": "查看资料", "Contribution activity": "贡献活动",
    "Contribution settings": "贡献设置", "Learn how we count contributions": "了解我们如何统计贡献",
    "Latest from our changelog": "变更日志最新动态", "View changelog": "查看变更日志", "Good morning": "早上好",
    "Good afternoon": "下午好", "Good evening": "晚上好",
    "Ask anything or type @ to add context": "输入任意内容，或键入 @ 添加上下文", "Optimized for": "优化目标",
    "Optimize for": "优化目标", "Balance": "平衡", "Auto": "自动", "Agent": "智能体", "Debug": "调试",
    "Create issue": "创建议题", "Write code": "编写代码", "All repositories": "所有仓库", "Ask": "询问",
    "No pull requests found, try a different filter.": "未找到拉取请求，请尝试其它筛选条件。", "No issues found": "未找到议题",
    "No pull requests found": "未找到拉取请求", "No repositories found": "未找到仓库", "No results found": "未找到结果",
    "Welcome to issues!": "欢迎使用议题！",
    "Issues are used to track todos, bugs, feature requests, and more.": "议题用于跟踪待办、缺陷、功能请求等。",
    "Overview": "概览", "Followers": "关注者", "Following": "正在关注", "Achievements": "成就", "Highlights": "亮点",
    "Pinned": "置顶", "Block or report": "屏蔽或举报", "Block user": "屏蔽用户", "Report user": "举报用户", "Sponsor": "赞助",
    "contributions in the last year": "过去一年的贡献", "Files": "文件", "No releases published": "暂无发布版本",
    "No packages published": "暂无已发布软件包", "Create a new release": "创建新发布",
    "No description, website, or topics provided.": "未提供描述、网站或话题。", "Add topics": "添加话题",
    "Milestones": "里程碑", "Reviews": "评审",
    "Successfully merging a pull request may close this issue.": "成功合并拉取请求可能会关闭此议题。", "Opened by": "由",
    "Updated on": "更新于", "created": "创建于", "Docs": "文档", "Training": "培训", "Manage cookies": "管理 Cookie",
    "Do not share my personal information": "不要分享我的个人信息",
    "Do not sell or share my personal information": "不要出售或分享我的个人信息", "Discard changes": "放弃更改",
    "Filter by author": "按作者筛选", "Filter by label": "按标签筛选", "Skip to content": "跳到内容",
    "Navigation Menu": "导航菜单", "Appearance settings": "外观设置", "Footer navigation": "页脚导航",
    "Site-wide Links": "全站链接", "Repository navigation": "仓库导航", "Security and quality": "安全与质量",
    "Folders and files": "文件夹与文件", "Last commit message": "最后提交信息", "Last commit date": "最后提交日期",
    "Open commit details": "打开提交详情", "Open more actions menu": "打开更多操作菜单", "Related Projects": "相关项目",
    "MIT license": "MIT 许可证", "Security policy": "安全策略", "Code of conduct": "行为准则", "Report abuse": "举报滥用",
    "Dismiss alert": "关闭提示", "Enter your email": "输入你的邮箱", "Built with GitHub": "使用 GitHub 构建",
    "This recommendation was created by GitHub staff": "此推荐由 GitHub 团队创建", "Trending repository": "趋势仓库",
    "Trending repos": "热门仓库", "Trending developers": "热门开发者", "See more trending developers": "查看更多热门开发者",
    "Popular topic": "热门话题", "Featured repositories": "精选仓库",
    "Collection recommended by GitHub": "GitHub 推荐合集", "Customer Stories": "客户案例",
    "Customer stories": "客户案例", "Read customer story": "阅读客户案例", "See all industries": "查看所有行业",
    "All Features": "所有功能", "Why GitHub": "为什么选择 GitHub", "GitHub Sponsors": "GitHub Sponsors",
    "GitHub Status": "GitHub 状态", "Community Forum": "社区论坛", "Premium Support": "高级支持",
    "Trust Center": "信任中心", "Resource center": "资源中心", "Events & webinars": "活动与网络研讨会",
    "Customer support": "客户支持", "Learn & Connect": "学习与交流", "Build & Ship": "构建与交付", "By Stage": "按阶段",
    "By Industry": "按行业", "Financial services": "金融服务", "Evaluate GitHub": "评估 GitHub",
    "Business insights": "商业洞察", "Open Source Fridays": "开源星期五", "Game Bytes": "游戏快讯",
    "Made in Brazil": "巴西制造", "See plans and pricing": "查看方案与定价", "Start Enterprise free trial": "开始企业版免费试用",
    "What our customers say": "客户怎么说", "Previous testimonial": "上一条", "Next testimonial": "下一条",
    "Product walkthrough": "产品演示", "Previous chapter": "上一章", "Next chapter": "下一章",
    "Review changes": "审查更改", "Approve and merge": "批准并合并",
    "Download GitHub Copilot app": "下载 GitHub Copilot 应用",
    "Copilot reviews proposed code changes.": "Copilot 会审查建议的代码更改。", "Compare GitHub": "比较 GitHub",
    "Developer API": "开发者 API", "GitHub CLI": "GitHub CLI", "GitHub Desktop": "GitHub Desktop",
    "GitHub Mobile": "GitHub Mobile", "MCP Registry": "MCP 注册表", "Professional Services": "专业服务",
    "Contact GitHub": "联系 GitHub", "Social Impact": "社会影响", "What is Git?": "什么是 Git？",
    "The developer newsletter": "开发者通讯", "You can’t perform that action at this time.": "目前无法执行此操作。",
    "You signed in with another tab or window.": "你在另一个标签页或窗口中登录了。",
    "You signed out in another tab or window.": "你在另一个标签页或窗口中退出了登录。",
    "You switched accounts on another tab or window.": "你在另一个标签页或窗口中切换了账号。",
    "to refresh your session.": "以刷新你的会话。", "repo forked": "仓库已复刻", "repo starred": "仓库已星标",
    "branch merged": "分支已合并", "Assigned to me": "指派给我", "Created by me": "由我创建", "Recent activity": "最近活动",
    "Collapse sidebar": "收起侧边栏", "Search issues": "搜索议题", "More Issue list controls": "更多议题列表控件",
    "Comfortable display density": "舒适显示密度", "Compact display density": "紧凑显示密度",
    "Repository files navigation": "仓库文件导航", "Change the type filter": "更改类型筛选", "type filter": "类型筛选",
    "Clear current search query, filters, and sorts": "清除当前搜索、筛选与排序", "Types": "类型", "Views": "视图",
    "Products": "产品", "Developers": "开发者", "Businesses": "企业", "Resources": "资源", "Usage": "用法",
    "AI usage": "人工智能的使用", "Budgets and alerts": "预算和警报", "Licensing": "许可", "Payment information": "付款信息",
    "Payment history": "付款记录", "Additional billing details": "额外的账单详细信息", "Education benefits": "教育福利",
    "Current metered usage": "当前计量使用量", "Current included usage": "当前包含使用量", "More details": "更多详情",
    "Next payment due": "下期应付款", "Subscriptions": "订阅", "Manage subscriptions": "管理订阅", "per month": "每月",
    "Metered usage": "计量使用量", "Usage by products": "按产品使用量", "Copilot usage": "Copilot 使用量",
    "View details": "查看详情", "Additional usage": "额外使用量", "Not enabled": "未启用", "No usage": "无使用量",
    "Get usage report": "获取使用报告", "Search or filter usage": "搜索或筛选使用量", "Group by: None": "分组方式：无",
    "Usage breakdown": "使用量明细", "Date": "日期", "Gross amount": "总金额", "Billed amount": "已计费金额",
    "Billing": "计费", "New budget": "新建预算", "Usage blocked": "使用已阻止", "spent": "已花费", "Scope": "范围",
    "Filter by scope, repository, product or SKU": "按范围、仓库、产品或 SKU 筛选",
    "Included usage alerts: On": "包含使用量警报：开启", "Included usage alerts: Off": "包含使用量警报：关闭",
    "Active subscription": "有效订阅", "Current GitHub base plan": "当前 GitHub 基础方案",
    "Compare base plans": "比较基础方案", "Upgrade to GitHub Pro": "升级到 GitHub Pro",
    "Upgrade Individual Plan": "升级个人版", "Upgrade Business": "升级企业版",
    "Your AI pair programmer": "你的 AI 结对程序员", "The basics for all developers": "面向所有开发者的基础功能",
    "Unlimited public/private repos": "无限公有/私有仓库", "Unlimited collaborators": "无限协作者",
    "Community support": "社区支持", "Not included:": "未包含：",
    "Free Codespaces usage per organization": "每个组织的免费代码空间用量",
    "Protected branches on all repos": "所有仓库的受保护分支", "Increase Codespaces spend limits": "提高代码空间消费限额",
    "Multiple reviewers in pull requests": "拉取请求中的多名评审者", "Required status checks": "必需的状态检查",
    "Code owners": "代码所有者", "Required reviewers": "必需评审者",
    "Pages for static website hosting": "用于静态网站托管的 Pages", "Web-based support": "基于网络的支持",
    "See all features and compare plans": "查看所有功能并比较方案", "Billing information": "账单信息",
    "Add your information to show on every invoice": "添加显示在每张发票上的信息", "First name": "名字", "Last name": "姓氏",
    "Address (Street, P.O. box)": "地址（街道、邮政信箱）",
    "Address line 2 (Apartment, suite, unit)": "地址第 2 行（公寓、套房、单元）", "City": "城市", "Country/Region": "国家/地区",
    "Choose your country/region": "选择你的国家/地区", "State/Province": "州/省",
    "Postal/Zip code (9-digit zip code for US)": "邮政编码（美国为 9 位邮编）",
    "Required for certain countries": "某些国家/地区必填", "VAT/GST ID": "增值税/GST 税号",
    "Save billing information": "保存账单信息", "Coupon": "优惠券", "Redeem a coupon": "兑换优惠券",
    "You don't have an active coupon.": "你没有有效的优惠券。", "Additional information": "附加信息",
    "Add information": "添加信息", "No additional information added to your receipts.": "你的收据中未添加附加信息。",
    "Start your first organization": "创建你的第一个组织", "Create an organization": "创建组织", "Sponsorships": "赞助",
    "Start sponsoring": "开始赞助",
    "Connect with the community that builds the tools you use": "与你所用工具的构建者社区建立联系",
    "You're currently not sponsoring anyone.": "你目前没有赞助任何人。",
    "Learn more about GitHub Sponsors": "了解有关 GitHub Sponsors 的更多信息", "Theme preferences": "主题偏好",
    "Theme mode": "主题模式", "Sync with system": "跟随系统同步",
    "GitHub theme will match your system active settings": "GitHub 主题将匹配你的系统活动设置", "Light theme": "浅色主题",
    "Dark theme": "深色主题", "Active": "当前", "Contrast": "对比度", "Increase contrast": "增强对比度",
    "Light mode": "浅色模式", "Dark mode": "深色模式", "Off": "关闭", "On": "开启",
    "Emoji skin tone preference": "表情符号肤色偏好", "Preferred default emoji skin tone": "首选默认表情符号肤色",
    "Tab size preference": "制表符宽度偏好", "Keyboard shortcuts": "键盘快捷键", "General": "通用",
    "Character keys": "字符键", "Save keyboard shortcut preferences": "保存键盘快捷键偏好", "Motion": "动效",
    "Autoplay animated images": "自动播放动态图片",
    "Select whether animated images should play automatically.": "选择动态图片是否应自动播放。",
    "Adopts your system preference for reduced motion": "采用系统的“减少动态效果”偏好",
    "Automatically plays animated images": "自动播放动态图片",
    "Prevents animated images from playing automatically": "阻止动态图片自动播放", "Save motion preferences": "保存动效偏好",
    "Content": "内容", "Link underlines": "链接下划线",
    "Toggle the visibility of underlines on links that are adjacent to text.": "切换与文本相邻链接的下划线可见性。",
    "Hide link underlines": "隐藏链接下划线", "Show link underlines": "显示链接下划线",
    "Save content preferences": "保存内容偏好", "Hovercards": "悬停卡片", "Show hovercards": "显示悬停卡片",
    "Save hovercard preferences": "保存悬停卡片偏好", "Default notifications email": "默认通知邮箱",
    "Custom routing": "自定义路由", "View watched repositories": "查看已关注的仓库", "Notify me": "通知我",
    "Participating, @mentions and custom": "参与、@提及与自定义", "Customize email updates": "自定义邮件更新",
    "Reviews, Pushes, Comments": "评审、推送、评论", "Ignored repositories": "已忽略的仓库",
    "You'll never be notified.": "你永远不会收到通知。", "View ignored repositories": "查看已忽略的仓库",
    "Dependabot alerts: New vulnerabilities": "Dependabot 警报：新漏洞",
    "Dependabot alerts: Email digest": "Dependabot 警报：邮件摘要", "Advanced Security": "高级安全", "Models": "模型",
    "Days": "天", "Hours": "小时", "Failed workflows only": "仅失败的工作流", "on GitHub, Email": "通过 GitHub 邮件",
    "Git LFS": "Git LFS", "Account settings": "账户设置", "Change password": "修改密码", "Change username": "更改用户名",
    "Delete your account": "删除你的账户", "Export account data": "导出账户数据", "Danger zone": "危险区域",
    "Password": "密码", "Current password": "当前密码", "New password": "新密码", "Confirm password": "确认密码",
    "Set new password": "设置新密码", "Update password": "更新密码", "Primary email address": "主电子邮件地址",
    "Backup email address": "备用电子邮件地址", "Keep my email addresses private": "对我的电子邮件地址保密",
    "Email preferences": "电子邮件偏好", "Add email address": "添加电子邮件地址", "Add email": "添加电子邮件", "Verified": "已验证",
    "Unverified": "未验证", "Primary": "主邮箱", "Backup": "备用邮箱", "Web sessions": "网页会话",
    "Current session": "当前会话", "This device": "此设备", "Last used": "上次使用",
    "Sign out of other sessions": "退出其他会话", "Active sessions": "活动会话", "Sign out of all sessions": "退出所有会话",
    "SSH keys": "SSH 密钥", "New SSH key": "新建 SSH 密钥", "Add new SSH key": "添加新的 SSH 密钥", "GPG keys": "GPG 密钥",
    "New GPG key": "新建 GPG 密钥", "Authentication keys": "身份验证密钥", "Signing keys": "签名密钥", "Title": "标题",
    "Key": "密钥", "No SSH keys": "暂无 SSH 密钥", "Personal access tokens": "个人访问令牌",
    "Fine-grained tokens": "细粒度令牌", "Classic tokens": "经典令牌", "Generate new token": "生成新令牌",
    "No tokens": "暂无令牌", "Organizations you belong to": "你所属的组织",
    "You are not a member of any organizations.": "你不是任何组织的成员。", "Enterprises you belong to": "你所属的企业",
    "You are not a member of any enterprises.": "你不是任何企业的成员。", "Moderation settings": "审核设置",
    "Blocked users": "已屏蔽的用户", "Interaction limits": "互动限制", "You have not blocked any users.": "你尚未屏蔽任何用户。",
    "Content moderation": "内容审核", "Repository default settings": "仓库默认设置", "Default branch name": "默认分支名称",
    "Default branch": "默认分支", "Repository visibility": "仓库可见性", "Default repository visibility": "默认仓库可见性",
    "Disable repository discussions": "禁用仓库讨论", "Repository policies": "仓库策略",
    "Codespaces settings": "代码空间设置", "Default editor": "默认编辑器", "Default region": "默认区域",
    "Trusted repositories": "受信任的仓库", "Dotfiles": "dotfiles", "Codespaces secrets": "代码空间机密",
    "Package settings": "软件包设置", "No packages": "暂无软件包", "Pages settings": "Pages 设置", "No sites": "暂无站点",
    "Add saved reply": "添加已保存的回复", "No saved replies": "暂无已保存的回复", "Security settings": "安全设置",
    "Sudo mode": "SUDO 模式", "Enable two-factor authentication": "启用双重身份验证",
    "Code security and analysis": "代码安全与分析", "Private vulnerability reporting": "私有漏洞报告",
    "Dependabot alerts": "Dependabot 警报", "Dependabot security updates": "Dependabot 安全更新",
    "Code scanning": "代码扫描", "Secret scanning": "密钥扫描", "Code scanning alerts": "代码扫描警报",
    "Installed GitHub Apps": "已安装的 GitHub Apps", "Authorized OAuth Apps": "已授权的 OAuth 应用",
    "Authorized GitHub Apps": "已授权的 GitHub Apps", "No installed apps": "暂无已安装应用",
    "No scheduled reminders": "暂无预定提醒", "Add reminder": "添加提醒", "Archived repositories": "已归档仓库",
    "No archived repositories": "暂无已归档仓库", "Participating": "参与中", "Notification preferences": "通知偏好",
    "Email notification preferences": "电子邮件通知偏好", "Web": "网页", "Mobile": "移动端", "Email": "电子邮件",
    "Follow": "关注", "Unfollow": "取消关注", "Sponsoring": "赞助中", "You have unread notifications": "你有未读通知",
    "Create view": "创建视图", "Manage notifications": "管理通知", "Notification settings": "通知设置",
    "Watched repositories": "关注的仓库", "Switch inbox": "切换收件箱", "Assigned": "已指派", "Mentioned": "被提及",
    "Team mentioned": "团队提及", "Review requested": "请求评审", "Add new filter": "添加新筛选",
    "Search notifications": "搜索通知", "Sort by:": "排序方式：", "Newest to oldest": "最新到最早",
    "Oldest to newest": "最早到最新", "Group by:": "分组方式：", "Clear out the clutter.": "清理杂乱。",
    "Clean up your inbox": "清理收件箱", "Mark all read notifications as done": "将所有已读通知标记为完成",
    "Notifications by date": "按日期分组的通知", "Single sign-on": "单点登录", "Authored by me": "我创建的",
    "Involves me": "与我相关", "Review requests": "评审请求", "Select repositories": "选择仓库",
    "Updated: Last month": "更新于：上个月", "Customize your view": "自定义视图", "Dismiss tip": "关闭提示",
    "Needs your review": "需要你评审", "Needs your teams review": "需要你的团队评审", "Your drafts": "你的草稿",
    "Waiting for review or checks": "等待评审或检查", "Needs action": "需要操作", "Ready to merge": "可合并",
    "Search pull requests": "搜索拉取请求", "More items": "更多项目",
    "No pull requests matched your search": "没有匹配你搜索的拉取请求",
    "About the “Needs your review” section": "关于“需要你评审”部分",
    "About the “Needs your teams’ review” section": "关于“需要你的团队评审”部分",
    "About the “Your drafts” section": "关于“你的草稿”部分",
    "About the “Waiting for review or checks” section": "关于“等待评审或检查”部分",
    "About the “Needs action” section": "关于“需要操作”部分", "About the “Ready to merge” section": "关于“可合并”部分",
    "Chrome extension": "Chrome 扩展", "Here’s what we found based on your interests...": "以下是根据你的兴趣找到的内容…",
    "Based on repositories you’ve starred": "基于你已星标的仓库", "Based on topics you’ve starred": "基于你已星标的话题",
    "Based on topics you’re interested in": "基于你感兴趣的话题",
    "Based on your public repository contributions": "基于你的公开仓库贡献",
    "See more trending repositories": "查看更多热门仓库",
    "That’s everything we found for you, for now.": "这是我们目前为你找到的全部内容。", "GitHub Blog": "GitHub 博客",
    "Hack on open source with us": "与我们一起开发开源", "Build a game this November": "今年十一月做一款游戏",
    "All apps": "所有应用", "Agent apps": "智能体应用", "AI Assisted": "AI 辅助", "API management": "API 管理",
    "Backup Utilities": "备份工具", "Code quality": "代码质量", "Code review": "代码审查",
    "Code Scanning Ready": "代码扫描就绪", "Code search": "代码搜索", "Container CI": "容器 CI",
    "Continuous integration": "持续集成", "Dependency management": "依赖管理",
    "Deployment Protection Rules": "部署保护规则", "Desktop tools": "桌面工具", "Mobile CI": "移动端 CI",
    "Open Source management": "开源管理", "Project management": "项目管理", "Recently added": "最近添加",
    "Time tracking": "时间跟踪", "All actions": "所有操作", "Game CI": "游戏 CI", "Create extension": "创建扩展",
    "Open Marketplace categories": "打开市场分类", "Enhance your workflow with extensions": "用扩展增强你的工作流",
    "Search Marketplace": "搜索市场",
    "View recommended or recent marketplace listings navigation": "查看推荐或最近的市场列表导航",
    "Contribution Graph": "贡献图", "Day of Week": "星期几", "No contributions.": "无贡献。",
    "Low contributions.": "较少贡献。", "Medium-low contributions.": "中低贡献。",
    "Medium-high contributions.": "中高贡献。", "High contributions.": "高贡献。",
    "Created an issue in": "在以下仓库创建议题：", "Show more activity": "显示更多活动",
    "Seeing something unexpected? Take a look at the": "看到意外内容？请查看", "GitHub profile guide": "GitHub 个人资料指南",
    "Drop to upload your files": "拖放以上传文件", "Add a README": "添加 README",
    "Publish your first package": "发布你的第一个软件包", "Suggested workflows": "建议的工作流",
    "Based on your tech stack": "基于你的技术栈", "More workflows": "更多工作流", "Copy code to clipboard": "复制代码到剪贴板",
    "GitHub will use your selected theme": "GitHub 将使用你选择的主题",
    "Light protanopia and deuteranopia": "浅色（红色盲与绿色盲）", "Light tritanopia": "浅色（蓝色盲）",
    "Dark protanopia and deuteranopia": "深色（红色盲与绿色盲）", "Dark tritanopia": "深色（蓝色盲）", "Soft dark": "柔和深色",
    "Selected theme:": "已选主题：", "Light Skin Tone": "浅肤色", "Medium-Light Skin Tone": "中浅肤色",
    "Medium Skin Tone": "中等肤色", "Medium-Dark Skin Tone": "中深肤色", "Dark Skin Tone": "深肤色",
    "Markdown editor font preference": "Markdown 编辑器字体偏好",
    "Use a fixed-width (monospace) font when editing Markdown": "编辑 Markdown 时使用等宽字体",
    "GitHub shortcuts": "GitHub 快捷键", "Editor settings": "编辑器设置", "URL paste behavior": "URL 粘贴行为",
    "Formatted link": "格式化链接", "Plain text": "纯文本", "Save editor settings": "保存编辑器设置",
    "Assistive technology hints": "辅助技术提示", "Enable screen reader hint": "启用屏幕阅读器提示",
    "Disable screen reader hint": "禁用屏幕阅读器提示", "Save assistive technology hint preferences": "保存辅助技术提示偏好",
    "Notify me:": "通知我：", "When you’re given access to": "当你获得访问权限时", "Don't send": "不发送",
    "Security campaign emails": "安全活动邮件", "Agent sessions": "智能体会话",
    "Notifications for agent sessions that you started.": "关于你启动的智能体会话的通知。",
    "'Deploy key' alert email": "“部署密钥”警报邮件", "In-product messages": "产品内消息",
    "Your current session": "你的当前会话", "Last accessed on": "上次访问于",
    "GitHub Mobile sessions": "GitHub Mobile 会话",
    "Learn more about authentication with GitHub Mobile.": "了解有关 GitHub Mobile 身份验证的更多信息。",
    "Check out our guide to": "查看我们的指南", "connecting to GitHub using SSH keys": "使用 SSH 密钥连接 GitHub",
    "or troubleshoot": "或排查", "common SSH problems": "常见 SSH 问题", "Learn how to": "了解如何",
    "Vigilant mode": "警惕模式", "Flag unsigned commits as unverified": "将未签名提交标记为未验证",
    "Learn about vigilant mode": "了解警惕模式", "Developer Settings": "开发者设置", "Tokens (classic)": "令牌（经典）",
    "Personal access tokens (classic)": "个人访问令牌（经典）", "Fine-grained, repo-scoped": "细粒度、按仓库范围",
    "Generate new token (classic)": "生成新令牌（经典）", "For general use": "用于一般用途",
    "I understand, delete this token": "我明白，删除此令牌", "Last used within the last week": "最近一周内使用过",
    "Never used": "从未使用", "Move to an organization": "转移到组织", "Move work to an organization": "将工作转移到组织",
    "You don't have any enterprises": "你没有任何企业", "Start free for 30 days": "免费试用 30 天",
    "Learn more about enterprises": "了解有关企业的更多信息", "Repository default branch": "仓库默认分支",
    "Learn more about default branches.": "了解有关默认分支的更多信息。", "Commit comments": "提交评论",
    "Choose whether": "选择是否", "Commit comments:": "提交评论：", "Enabled by default": "默认启用",
    "Disabled by default": "默认禁用", "Deleted repositories": "已删除的仓库", "create one": "创建一个",
    "Automatically install dotfiles": "自动安装 dotfiles", "Codespace user secrets": "代码空间用户机密",
    "There are no Codespace secrets.": "没有代码空间机密。", "New secret": "新建机密", "GPG verification": "GPG 验证",
    "GPG signing will be available in Codespaces": "GPG 签名将在代码空间中可用", "Settings Sync": "设置同步",
    "Selected repositories": "已选仓库", "Select repository": "选择仓库", "No matching repositories.": "没有匹配的仓库。",
    "Access and security": "访问与安全",
    "All Codespaces can access other repositories I own": "所有代码空间都可以访问我拥有的其他仓库",
    "Editor preference": "编辑器偏好", "Edit and preview changes straight from the browser.": "直接在浏览器中编辑和预览更改。",
    "Default idle timeout": "默认空闲超时", "minutes (4 hours).": "分钟（4 小时）。",
    "Timeout must be 240 minutes or less.": "超时不得超过 240 分钟。",
    "Timeout must be 5 minutes or more.": "超时不得少于 5 分钟。", "Default retention period": "默认保留期",
    "Learn about retention setting": "了解保留期设置", "Retention period must be 30 days or less.": "保留期不得超过 30 天。",
    "Host image version preference": "主机镜像版本偏好", "Learn more about host images": "了解有关主机镜像的更多信息",
    "Always use the latest stable configuration.": "始终使用最新稳定配置。", "Set automatically": "自动设置",
    "Set manually": "手动设置", "Choose your default region": "选择你的默认区域", "Packages permissions": "软件包权限",
    "Default Package Setting": "默认软件包设置", "Inherit access from source repository": "从源仓库继承访问权限",
    "Deleted Packages": "已删除的软件包", "Verified domains": "已验证域名", "Add a domain": "添加域名",
    "There are no verified domains.": "没有已验证的域名。",
    "Learn more about working with saved replies": "了解有关使用已保存回复的更多信息", "No saved replies yet.": "还没有已保存的回复。",
    "Add a saved reply": "添加已保存的回复", "Saved reply title": "已保存回复标题", "Unordered list": "无序列表",
    "Select a reply": "选择回复", "Create a new saved reply": "创建新的已保存回复",
    "There was an error creating your SavedReply.": "创建已保存回复时出错。", "Add your saved reply": "添加你的已保存回复",
    "We don’t support that file type.": "我们不支持该文件类型。",
    "Try again with a file that’s not empty.": "请用非空文件重试。", "This file is hidden.": "此文件已隐藏。",
    "Try again with another file.": "请用其他文件重试。", "Try again.": "重试。", "is supported": "受支持",
    "Add files": "添加文件", "Paste, drop, or click to add files": "粘贴、拖放或点击以添加文件",
    "Nothing to preview": "无可预览内容", "Sign in methods": "登录方式", "Old password": "旧密码",
    "Confirm new password": "确认新密码", "Make sure it’s": "确保它", "at least 15 characters": "至少 15 个字符",
    "at least 8 characters": "至少 8 个字符", "including a number": "包含一个数字",
    "and a lowercase letter": "以及一个小写字母", "I forgot my password": "我忘记了我的密码",
    "Passwordless sign-in with biometrics or security keys": "使用生物识别或安全密钥进行无密码登录", "Add passkey": "添加通行密钥",
    "Google sign in method dropdown": "Google 登录方式下拉菜单", "Add account": "添加账户",
    "Sign in with your Apple account": "使用你的 Apple 账户登录",
    "Two-factor authentication is not enabled yet.": "双重身份验证尚未启用。", "Filter audit logs": "筛选审计日志",
    "Yesterday’s activity": "昨天的活动", "Repository management": "仓库管理", "Billing updates": "计费更新",
    "Copilot activity": "Copilot 活动", "Personal access token activity": "个人访问令牌活动",
    "View advanced search syntax": "查看高级搜索语法", "Recent events": "最近事件", "Filter by Member": "按成员筛选",
    "Filter by Action": "按操作筛选", "Regenerated a token for": "为以下对象重新生成了令牌：", "ending in": "结尾为",
    "Created a token for": "为以下对象创建了令牌：", "Updated a token for": "为以下对象更新了令牌：",
    "Added the following repositories to the": "将以下仓库添加到", "Created the repository": "创建了仓库",
    "View all events created yesterday": "查看昨天创建的所有事件", "No GitHub Apps": "没有 GitHub Apps",
    "New GitHub App": "新建 GitHub App", "View documentation": "查看文档", "No reminders": "没有提醒",
    "Products selector navigation": "产品选择器导航", "About Copilot AI credits": "关于 Copilot AI 额度",
    "Usage by repository": "按仓库使用量", "Top repository this month": "本月使用最多的仓库",
    "Open repository usage options": "打开仓库使用量选项", "Chart options": "图表选项", "Customization settings": "自定义设置",
    "Line chart with 29 data points.": "折线图，含 29 个数据点。", "View as data table, Chart": "以数据表查看，图表",
    "End of interactive chart.": "交互式图表结束。", "Show Usage Breakdown": "显示使用量明细",
    "Included usage alerts:": "包含使用量警报：", "Learn more.": "了解更多。",
    "Clear Filter by scope, repository, product or SKU": "清除按范围、仓库、产品或 SKU 筛选",
    "All AI Credit SKUs": "所有 AI 额度 SKU", "Upgrade to Business": "升级到企业版", "for more details.": "了解更多详情。",
    "Increase Codespaces": "提高代码空间", "spend limits": "消费限额",
    "You have not added any billing information.": "你尚未添加任何账单信息。", "(Street, P.O. box)": "（街道、邮政信箱）",
    "Address line 2": "地址第 2 行", "(Apartment, suite, unit)": "（公寓、套房、单元）", "Postal/Zip code": "邮政编码",
    "(9-digit zip code for US)": "（美国为 9 位邮编）", "Payment method": "付款方式",
    "You have not added a payment method.": "你尚未添加付款方式。", "Pay with": "使用以下方式付款",
    "Credit or debit card": "信用卡或借记卡", "PayPal account": "PayPal 账户",
    "Loading payment information…": "正在加载付款信息…", "Extra billing information": "额外账单信息",
    "This information will appear on all your receipts.": "此信息将显示在你的所有收据上。",
    "To update the information that appears on": "更新显示在", "(if enabled), visit the": "（如已启用），请访问",
    "billing information section": "账单信息部分", "Full business name or address of record": "完整的公司名称或登记地址",
    "Save contact information": "保存联系信息", "Based on topics you're interested in": "基于你感兴趣的话题",
    "Based on topics you've starred": "基于你已星标的话题", "Based on repositories you've starred": "基于你已星标的仓库",
    "Here's what we found based on your interests...": "以下是根据你的兴趣找到的内容…",
    "That's everything we found for you, for now.": "这是我们目前为你找到的全部内容。",
    "Needs your teams' review": "需要你的团队评审", "About the “Needs your teams' review” section": "关于“需要你的团队评审”部分",
    "🎯 Assigned": "🎯 指派", "💬 Participating": "💬 参与", "✋ Mentioned": "✋ 提及",
    "🙌 Team mentioned": "🙌 团队提及", "👀 Review requested": "👀 请求评审", "Open menu": "打开菜单",
    "Open user navigation menu": "打开用户导航菜单", "Global navigation menu": "全局导航菜单",
    "Open quick search dialog, type / to search": "打开快速搜索对话框，输入 / 进行搜索", "Open Copilot…": "打开 Copilot…",
    "Chat with Copilot": "与 Copilot 聊天", "Create new...": "新建…", "Create new…": "新建…", "All issues": "所有议题",
    "All pull requests": "所有拉取请求", "You have no unread notifications": "你没有未读通知", "to search": "进行搜索",
    "User navigation": "用户导航", "Products selector": "产品选择器", "Marketplace navigation": "市场导航",
    "Marketplace categories": "市场分类", "Explore navigation": "探索导航", "Releases and Tags": "发行版与标签",
    "Repository files": "仓库文件", "Switch repository": "切换仓库", "Repository menu": "仓库菜单",
    "Single theme picker": "单一主题选择器", "Active Mode": "活动模式", "Light theme picker": "浅色主题选择器",
    "Dark theme picker": "深色主题选择器", "Close dialog": "关闭对话框", "Customize filters": "自定义筛选",
    "Notification filters": "通知筛选", "Get started clearing your notifications": "开始清理你的通知",
    "More options": "更多选项", "Move to inbox": "移至收件箱", "Not available": "不可用",
    "to see what's new.": "以查看最新内容。", "Pull requests navigation": "拉取请求导航",
    "Filter by age: Last month": "按时间筛选：上个月", "Expand Needs your review": "展开“需要你评审”",
    "Expand Needs your teams' review": "展开“需要你的团队评审”", "Expand Your drafts": "展开“你的草稿”",
    "Expand Waiting for review or checks": "展开“等待评审或检查”", "Expand Needs action": "展开“需要操作”",
    "Expand Ready to merge": "展开“可合并”",
    "This recommendation was generated by GitHub computers": "此推荐由 GitHub 计算机生成",
    "These results are generated by GitHub computers": "这些结果由 GitHub 计算机生成",
    "This is a recommendation by GitHub staff": "由 GitHub 团队推荐", "iOS logo": "iOS 标志",
    "Chrome logo": "Chrome 标志", "Chrome extension logo": "Chrome 扩展标志",
    "YouTube video player": "YouTube 播放器", "Search for apps and actions": "搜索应用与操作",
    "View recommended or recent marketplace listings": "查看推荐或最近的市场列表", "Select type": "选择类型",
    "Can be sponsored": "可被赞助", "Select language": "选择语言", "Last updated": "最近更新", "Select order": "选择排序",
    "Find a repository…": "查找仓库…", "Apache License 2.0": "Apache 许可证 2.0",
    "BSD 2-Clause \"Simplified\" License": "BSD 2 条款“简化”许可证",
    "GNU General Public License v2.0": "GNU 通用公共许可证 v2.0", "Name ascending (A-Z)": "名称升序（A-Z）",
    "Name descending (Z-A)": "名称降序（Z-A）",
    "Create a list to organize your starred repositories.": "创建一个列表来整理你已星标的仓库。",
    "Show all lists...": "显示所有列表…", "Type: All": "类型：全部", "All languages": "所有语言",
    "Sort by: Recently starred": "排序方式：最近星标", "Recently starred": "最近星标", "Recently active": "最近活跃",
    "Showing results": "显示结果", "Starred topics": "已星标话题", "⭐️ Name this list": "⭐️ 为此列表命名",
    "Search starred repositories": "搜索已星标仓库", "Name .": "名称", "Description .": "描述",
    "Get started with GitHub Packages": "开始使用 GitHub Packages", "Choose a registry": "选择注册表",
    "Apache Maven": "Apache Maven", "Learn more about Apache Maven": "了解有关 Apache Maven 的更多信息",
    "Learn more about NuGet": "了解有关 NuGet 的更多信息", "Learn more about RubyGems": "了解有关 RubyGems 的更多信息",
    "Learn more about npm": "了解有关 npm 的更多信息", "Learn more about Containers": "了解有关容器的更多信息",
    "Edit repository metadata": "编辑仓库元数据", "Go to Branches page": "前往分支页面", "Go to Tags page": "前往标签页面",
    "View commit history for this file.": "查看此文件的提交历史。",
    "This path skips through empty directories": "此路径跳过空目录", "New branch": "新建分支",
    "Branches navigation": "分支导航", "Check status": "检查状态", "Action menu": "操作菜单",
    "Copy branch name to clipboard": "复制分支名到剪贴板", "Branch menu": "分支菜单", "Search branches...": "搜索分支…",
    "There aren’t any releases here": "这里没有任何发行版", "our docs": "我们的文档", "Find a release": "查找发行版",
    "Get started with GitHub Actions": "开始使用 GitHub Actions", "Skip this and": "跳过此步并",
    "set up a workflow yourself": "自行设置工作流", "Suggested for this repository": "此仓库的建议",
    "deployment workflows": "部署工作流", "continuous integration workflows": "持续集成工作流",
    "automation workflows": "自动化工作流", "Pages workflows": "Pages 工作流", "Browse all categories": "浏览所有分类",
    "Learn more about GitHub Actions": "了解有关 GitHub Actions 的更多信息",
    "Getting started and core concepts": "入门与核心概念", "Configuring and managing workflows": "配置与管理工作流",
    "Language and framework guides": "语言与框架指南",
    "Guides for projects written in many programming languages.": "针对多种编程语言项目的指南。",
    "Search workflows": "搜索工作流", "Any language": "任何语言", "Policy insights": "策略洞察",
    "Internet access": "互联网访问", "MCP servers": "MCP 服务器", "Agent suggestions for issues": "议题的智能体建议",
    "Repository name": "仓库名称", "Template repository": "模板仓库",
    "Learn more about template repositories": "了解有关模板仓库的更多信息", "Rename branch": "重命名分支",
    "Rename this branch": "重命名此分支", "Enable release immutability": "启用发行版不可变性",
    "Wikis host documentation for your repository.": "Wiki 用于托管你仓库的文档。",
    "Learn more about wikis": "了解有关 Wiki 的更多信息", "Issue permissions": "议题权限",
    "Creation allowed by:": "允许创建者：", "All users": "所有用户", "Anyone can create an issue": "任何人都可以创建议题",
    "Collaborators only": "仅协作者", "Only collaborators can create issues": "只有协作者可以创建议题",
    "Get organized with issue templates": "使用议题模板进行组织", "Set up templates": "设置模板",
    "Display a \"Sponsor\" button": "显示“赞助”按钮", "Set up sponsor button": "设置赞助按钮",
    "Get started with Discussions": "开始使用讨论", "Pull request permissions": "拉取请求权限",
    "Anyone can create a pull request": "任何人都可以创建拉取请求", "Only collaborators can create PRs": "只有协作者可以创建 PR",
    "You must select at least one option": "你必须至少选择一个选项", "Allow merge commits": "允许合并提交",
    "Default commit message": "默认提交信息", "Default message": "默认信息", "Pull request title": "拉取请求标题",
    "Pull request title and description": "拉取请求标题与描述", "Allow squash merging": "允许压缩合并",
    "Allow rebase merging": "允许变基合并", "Always suggest updating pull request branches": "始终建议更新拉取请求分支",
    "Allow auto-merge": "允许自动合并", "Why is this option disabled?": "为什么此选项被禁用？",
    "Automatically delete head branches": "自动删除头分支",
    "Require contributors to sign off on web-based commits": "要求贡献者对基于网页的提交签名确认",
    "Developer Certificate of Origin (DCO)": "开发者原创声明（DCO）",
    "Learn more about signing off on commits": "了解有关提交签名确认的更多信息",
    "Allow comments on individual commits": "允许对单个提交评论",
    "Include Git LFS objects in archives": "在归档中包含 Git LFS 对象",
    "Auto-close issues with merged linked pull requests": "合并关联的拉取请求时自动关闭议题", "Change visibility": "更改可见性",
    "Change to public": "更改为公开", "Change repository visibility": "更改仓库可见性",
    "This repository is currently private.": "此仓库当前为私有。", "Disable branch protection rules": "禁用分支保护规则",
    "This action will disable:": "此操作将禁用：", "Branch protection rule enforcement": "分支保护规则强制执行",
    "Branch protection rule APIs": "分支保护规则 API", "will be disabled as part of this action": "将作为此操作的一部分被禁用",
    "Transfer ownership": "转移所有权", "Archive this repository": "归档此仓库",
    "Mark this repository as archived and read-only.": "将此仓库标记为已归档且只读。", "Archive repository": "归档仓库",
    "This repository will become read-only.": "此仓库将变为只读。",
    "All scheduled workflows will stop running.": "所有计划工作流将停止运行。",
    "Before you archive, please consider:": "归档之前，请考虑：", "Updating any repository settings": "更新任何仓库设置",
    "Closing all open issues and pull requests": "关闭所有打开的议题和拉取请求",
    "Making a note in your README": "在 README 中注明", "Please type": "请输入", "to confirm.": "以确认。",
    "I understand the consequences, archive this repository": "我了解相关后果，归档此仓库",
    "Delete this repository": "删除此仓库", "I want to delete this repository": "我想要删除此仓库",
    "General settings": "常规设置", "Effects of making this repository public": "将此仓库设为公开的影响",
    "Effects of deleting this repository": "删除此仓库的影响", "No results matched your search": "没有匹配你搜索的结果",
    "Try a different search query.": "请尝试其他搜索查询。",
    "Learn more about searching and filtering": "了解有关搜索与筛选的更多信息", "Issues sidebar navigation": "议题侧栏导航",
    "Issue filters": "议题筛选", "Filter issues by state": "按状态筛选议题", "Issue list controls": "议题列表控件",
    "Filter by labels": "按标签筛选", "Filter by projects": "按项目筛选", "Filter by milestones": "按里程碑筛选",
    "Filter by assignees": "按指派人筛选", "Issues display density": "议题显示密度", "Change the": "更改",
    "Pull request filters": "拉取请求筛选", "Filter by reviews": "按评审筛选", "Filter by assignee": "按指派人筛选",
    "Pull requests display density": "拉取请求显示密度", "Code frequency": "代码频率", "Dependency graph": "依赖图",
    "Actions usage metrics": "Actions 使用指标", "Actions performance metrics": "Actions 性能指标",
    "Upgrade now": "立即升级", "Dependency graph is disabled": "依赖图已禁用", "Enable the dependency graph": "启用依赖图",
    "Learn more about how we use your data.": "了解我们如何使用你的数据。", "Dependency Insights menu": "依赖洞察菜单",
    "Usage breakdown table (scrollable)": "使用量明细表（可滚动）", "Budget table": "预算表", "Loading budgets": "正在加载预算",
    "Loading audit log entries…": "正在加载审计日志条目…", "Dismiss this message": "关闭此消息",
    "Add billing information": "添加账单信息", "Add payment method": "添加付款方式", "Credit Card Form": "信用卡表单",
    "Application settings": "应用设置", "Confirm token deletion": "确认删除令牌",
    "Full control of repository hooks": "完全控制仓库钩子", "Create gists": "创建代码片段",
    "Full control of projects": "完全控制项目", "Full control of private repositories": "完全控制私有仓库",
    "Update github action workflows": "更新 GitHub Actions 工作流",
    "Upload packages to github package registry": "上传软件包到 GitHub 软件包注册表",
    "Search deleted packages": "搜索已删除的软件包",
    "Authenticate to the API over Basic Authentication": "通过基本身份验证向 API 认证",
    "Enable Vigilant mode": "启用警惕模式", "Add a short title to your reply": "为你的回复添加简短标题",
    "Learn more about strong passwords": "了解有关强密码的更多信息",
    "Learn more about two-factor authentication": "了解有关双重身份验证的更多信息", "GitHub status page": "GitHub 状态页面",
    "contact support": "联系支持", "Completed task": "已完成任务", "Incomplete task": "未完成任务", "Unsave": "取消保存",
    "Heading": "标题", "Closed as not planned": "关闭为不计划", "Repository": "仓库", "Breadcrumbs": "面包屑",
    "Suggestions": "建议", "User": "用户", "Loading content...": "正在加载内容…", "Pagination": "分页", "The End": "结束",
    "Wikis": "Wiki", "main branch": "主分支", "Outline": "大纲", "Budgets": "预算", "latest version": "最新版本",
    "Choose a version": "选择版本", "About badges in GitHub Marketplace": "关于 GitHub Marketplace 中的徽章",
    "What's new": "最新变化", "Open an issue": "创建议题", "View source code": "查看源代码", "Start a discussion": "开始讨论",
    "Build and Test": "构建与测试", "Recommended permissions": "建议的权限", "Upload artifact": "上传工件",
    "Archive Artifacts:": "归档工件：", "Upload Artifacts:": "上传工件：", "Remove Archive:": "移除归档：", "Inputs": "输入",
    "Explore what’s new in GitHub Copilot": "探索 GitHub Copilot 的新功能",
    "Continue work across surfaces": "跨终端继续工作", "Bring your tools together": "整合你的工具",
    "Automate recurring work": "自动化重复性工作", "Work smarter with Copilot Fusion": "用 Copilot Fusion 更智能地工作",
    "See all announcements": "查看所有公告", "Close sidebar": "关闭侧边栏", "Quick links": "快速链接", "New chat": "新建对话",
    "Condense sidebar": "收起侧边栏", "More download options": "更多下载选项", "Copilot Chat": "Copilot 对话",
    "See what’s new": "查看新功能", "Close modal": "关闭弹窗",
    "A list of Copilot connectors, some already connected": "Copilot 连接器列表（部分已连接）",
    "GitHub homepage": "GitHub 主页", "Agents (opens a new page)": "智能体（在新页面打开）",
    "Download GitHub Copilot app (opens in new tab)": "下载 GitHub Copilot 应用（在新标签页打开）",
    "Close banner": "关闭横幅", "Copilot uses AI. Check for mistakes.": "Copilot 使用 AI，请核对错误。",
    "Search results": "搜索结果", "Create your first GitHub project": "创建你的第一个 GitHub 项目",
    "You don’t have any followers yet.": "你还没有任何关注者。", "Branch selector": "分支选择器", "User selector": "用户选择器",
    "View commit details": "查看提交详情", "Browse repository at this point": "浏览此处的仓库", "More actions": "更多操作",
    "Collapse file tree": "折叠文件树", "Search this repository": "搜索此仓库", "forward slash": "正斜杠",
    "Return to the repository overview": "返回仓库概览", "Draggable pane splitter": "可拖动的窗格分隔条",
    "File Tree Navigation": "文件树导航", "Copy path": "复制路径", "Directory actions": "目录操作",
    "parent directory": "上级目录", "Parent directory": "上级目录", "Compare changes": "比较更改",
    "compare across forks": "跨复刻比较", "base repository:": "基础仓库：", "Choose a base ref": "选择基础引用",
    "head repository:": "头仓库：", "Choose a head ref": "选择头引用", "Learn about pull requests": "了解拉取请求",
    "Compare and review just about anything": "比较并审查几乎任何内容", "Example comparisons": "比较示例",
    "Find a branch": "查找分支", "Checking code scanning status...": "正在检查代码扫描状态…",
    "Set up a security policy": "设置安全策略", "Enable Dependabot alerts": "启用 Dependabot 警报",
    "Advanced Security is only available for Organizations": "高级安全仅适用于组织", "Find out more": "了解更多",
    "Dependency Scanning": "依赖扫描", "software supply chain": "软件供应链",
    "Identify and understand your project's dependencies.": "识别并了解你项目的依赖项。",
    "Enable Dependabot security updates": "启用 Dependabot 安全更新", "Grouped security updates": "分组安全更新",
    "Dependabot version updates": "Dependabot 版本更新",
    "Automatically open dependency update pull requests by": "自动打开依赖更新拉取请求，依据",
    "Optional runner information": "可选运行器信息", "Runner type": "运行器类型",
    "Standard GitHub runner": "标准 GitHub 运行器", "Edit runner type": "编辑运行器类型", "Labeled runner": "带标签的运行器",
    "Runner group name": "运行器组名称", "Runner label": "运行器标签", "Save runner selection": "保存运行器选择",
    "Existing name": "现有名称", "Existing label": "现有标签", "Actions permissions": "Actions 权限",
    "Allow all actions and reusable workflows": "允许所有操作和可复用工作流", "Disable actions": "禁用 Actions",
    "Allow actions created by GitHub": "允许 GitHub 创建的操作",
    "Allow actions by Marketplace verified creators": "允许 Marketplace 已验证创建者的操作",
    "Allow or block specified actions and reusable workflows": "允许或屏蔽指定的操作和可复用工作流",
    "Action examples:": "操作示例：", "Reusable workflow examples:": "可复用工作流示例：",
    "Entire organization or repository examples:": "整个组织或仓库示例：", "Fork pull request workflows": "复刻拉取请求工作流",
    "Run workflows from fork pull requests": "运行来自复刻拉取请求的工作流",
    "Require approval for fork pull request workflows.": "要求对复刻拉取请求工作流进行批准。",
    "Workflow permissions": "工作流权限", "Read and write permissions": "读写权限",
    "Read repository contents and packages permissions": "读取仓库内容与软件包权限", "Not accessible": "不可访问",
    "Save artifact and log retention setting": "保存工件与日志保留设置",
    "Save fork pull request workflows settings": "保存复刻拉取请求工作流设置",
    "Save workflow permissions settings": "保存工作流权限设置", "Save access setting": "保存访问设置",
    "Issue body actions": "议题正文操作", "Issue actions": "议题操作", "Add artifact": "添加工件", "Reacted by": "回应者",
    "added this to the": "将此添加到", "This milestone has been deleted": "此里程碑已被删除", "related to": "关联到",
    "this commit": "此提交", "closed this": "关闭了此", "mentioned this": "提及了此",
    "added a commit that references this issue": "添加了引用此议题的提交",
    "and limited conversation to collaborators": "并将对话限制为协作者", "Please follow this repository's": "请遵循此仓库的",
    "contributing guidelines": "贡献指南", "No one assigned": "无人指派", "No labels": "无标签", "No type": "无类型",
    "No projects": "无项目", "None yet": "暂无", "No branches or pull requests": "无分支或拉取请求",
    "You're not receiving notifications from this thread.": "你未接收此会话的通知。",
    "Open in GitHub Copilot app": "在 GitHub Copilot 应用中打开",
    "This user is the author of this issue": "此用户是该议题的作者", "reactions": "个回应", "Issues mentioned": "提及的议题",
    "Show commit message body": "显示提交信息正文", "Give feedback": "提供反馈",
    "Review required before merging": "合并前需要评审", "Draft pull request": "草稿拉取请求", "Next Page": "下一页",
    "All workflows": "所有工作流", "Open Actions": "打开 Actions", "Showing runs from all workflows": "显示所有工作流中的运行",
    "Filter workflow runs": "筛选工作流运行", "Workflow runs": "工作流运行", "Auto-refresh: 30s": "自动刷新：30 秒",
    "completed successfully:": "成功完成：", "currently running:": "当前运行中：", "In progress": "进行中",
    "Action required": "需要操作", "Actions workflows": "Actions 工作流", "Actions management": "Actions 管理",
    "Search runs": "搜索运行", "Workflow runs results": "工作流运行结果",
    "requires action with the application:": "需要应用执行操作：", "Organization navigation": "组织导航",
    "View all repositories": "查看所有仓库", "Top languages": "主要语言", "Most used topics": "最常用话题",
    "GitHub Sponsor": "GitHub 赞助者", "Developer Program Member": "开发者计划成员",
    "Fine-grained personal access tokens": "细粒度个人访问令牌", "No fine-grained tokens created": "尚未创建细粒度令牌",
    "Open Issues sidebar navigation": "打开议题侧栏导航", "Search projects": "搜索项目", "Repository projects": "仓库项目",
    "Search by name…": "按名称搜索…", "Filter projects by state": "按状态筛选项目", "Loading projects": "正在加载项目",
    "Manage repository vulnerability settings": "管理仓库漏洞设置", "Manage Dependabot rules": "管理 Dependabot 规则",
    "Manage account notification settings": "管理账户通知设置", "Refresh Dependabot alerts": "刷新 Dependabot 警报",
    "Dependabot alerts are disabled.": "Dependabot 警报已禁用。", "this repository's settings": "此仓库的设置",
    "Start setup": "开始设置", "Confirm access": "确认访问", "Signed in as": "登录身份", "Verify via email": "通过电子邮件验证",
    "You are entering": "你正在进入", "Contact GitHub Support": "联系 GitHub 支持",
    "Branch protection rules": "分支保护规则", "Protect your branches with repository rulesets": "使用仓库规则集保护你的分支",
    "Classic branch protections": "经典分支保护", "are also available but offer fewer capabilities.": "也可用，但功能较少。",
    "Add classic branch protection rule": "添加经典分支保护规则", "Add branch ruleset": "添加分支规则集",
    "Add webhook": "添加 webhook", "Webhooks Guide": "Webhooks 指南", "New environment": "新建环境",
    "I understand, delete this environment": "我明白，删除此环境", "Delete environment": "删除环境",
    "New self-hosted runner": "新建自托管运行器", "There are no runners configured": "未配置任何运行器",
    "to run actions on your own servers.": "以在你自己的服务器上运行 Actions。", "More languages...": "更多语言…",
    "Number of followers": "关注者数量", "Number of forks": "复刻数量", "Number of stars": "星标数量",
    "Date created": "创建日期", "Date pushed": "推送日期", "Advanced search": "高级搜索", "Public archive": "公开归档",
    "External links": "外部链接", "Filter by type": "按类型筛选", "Open column options": "打开列选项",
    "Sponsor open source projects you depend on": "赞助你依赖的开源项目", "Explore sponsorable projects": "探索可赞助的项目",
    "How can we improve search?": "我们如何改进搜索？",
    "Automate your workflow from idea to production": "从想法到生产自动化你的工作流", "All creators": "所有创建者",
    "Browse popular topics on GitHub.": "浏览 GitHub 上的热门话题。", "All featured topics": "所有精选话题",
    "Popular topics": "热门话题", "Spoken Language:": "口语语言：", "Select a spoken language": "选择口语语言",
    "This setting can be updated in your": "此设置可在你的", "profile settings.": "个人资料设置中更新。",
    "Clear spoken language": "清除口语语言", "Select a language": "选择语言", "Unknown languages": "未知语言",
    "Date range:": "日期范围：", "Adjust time span": "调整时间范围", "This week": "本周", "This month": "本月",
    "Built by": "参与者", "Filter spoken languages": "筛选口语语言", "Type or choose a spoken language": "输入或选择口语语言",
    "Filter languages": "筛选语言", "Type or choose a language": "输入或选择语言", "Create a collection": "创建收藏集",
    "Load more…": "加载更多…", "In Person": "线下", "On demand": "按需", "Clear all": "全部清除",
    "Selecting a sort option will reload the page.": "选择排序选项将重新加载页面。", "Date (soonest)": "日期（最近）",
    "Enter now": "立即参加", "Explore more": "探索更多", "Join now": "立即加入", "Register now": "立即注册",
    "Close navigation menu": "关闭导航菜单", "Toggle navigation": "切换导航",
    "Search or jump to, type / to search": "搜索或跳转，输入 / 进行搜索", "Previous Page": "上一页", "Previous page": "上一页",
    "Go to GitHub homepage": "前往 GitHub 首页", "Legal and Resource Links": "法律与资源链接",
    "GitHub's Social Media Links": "GitHub 社交媒体链接", "English - Select language": "英语 - 选择语言",
    "Your instant dev environment": "你的即时开发环境", "Go to docs": "前往文档",
    "Explore quick start templates": "浏览快速开始模板", "By github": "由 github", "Use this template": "使用此模板",
    "Getting started with GitHub Codespaces": "GitHub Codespaces 入门", "Learn core concepts": "学习核心概念",
    "New to Codespaces?": "初次使用 Codespaces？", "Start here": "从这里开始", "Configure and manage": "配置与管理",
    "secret management": "机密管理", "port forwarding": "端口转发", "Develop locally": "本地开发",
    "Access codespaces from within": "在以下环境中访问代码空间", "By repository": "按仓库",
    "Create a new repository": "创建新仓库",
    "Repositories contain a project's files and version history.": "仓库包含项目的文件和版本历史。",
    "Have a project elsewhere?": "在别处有项目？", "Import a repository": "导入仓库",
    "Required fields are marked with an asterisk (*).": "必填字段用星号（*）标记。",
    "Repository owner and name": "仓库所有者和名称", "Choose visibility": "选择可见性", "Add README": "添加 README",
    "READMEs can be used as longer descriptions.": "README 可用作更长的描述。", "About READMEs": "关于 README",
    "Add .gitignore": "添加 .gitignore",
    ".gitignore tells git which files not to track.": ".gitignore 告诉 git 哪些文件不跟踪。",
    "About ignoring files": "关于忽略文件", "No .gitignore": "不添加 .gitignore", "Add license": "添加许可证",
    "Licenses explain how others can use your code.": "许可证说明他人如何使用你的代码。", "About licenses": "关于许可证",
    "No license": "不添加许可证", "Create repository": "创建仓库", "Choose visibility: Public": "选择可见性：公开",
    "Contributed by me": "我贡献的", "Admin access": "管理员权限", "Open Repository filters": "打开仓库筛选",
    "Search repositories": "搜索仓库", "Repositories list": "仓库列表", "Last pushed": "最近推送",
    "Repository filters": "仓库筛选", "Repository views": "仓库视图",
    "Repositories list display density": "仓库列表显示密度", "Sort by Last pushed descending": "排序方式：最近推送优先",
    "Organization permissions": "组织权限", "Find a member…": "查找成员…", "github projects": "GitHub 项目",
    "Search all projects": "搜索所有项目", "Make a copy": "复制一份",
    "Issues and pull requests will not be copied.": "议题和拉取请求不会被复制。",
    "Draft issues will be copied if selected": "若选中，草稿议题将被复制", "Select an owner": "选择所有者",
    "New project name": "新项目名称", "Copy project": "复制项目", "On track": "进展正常", "Projects views": "项目视图",
    "More project options": "更多项目选项", "Limit to users explicitly granted": "仅限明确获授权的用户",
    "or higher access": "或更高权限", "switch to list view": "切换到列表视图",
    "No one has forked this repository yet.": "还没有人复刻此仓库。", "forking a repository": "复刻仓库",
    "More file actions": "更多文件操作", "File metadata and controls": "文件元数据与控件", "Add to space": "添加到空间",
    "Ask Copilot about this file": "就此文件询问 Copilot", "Copy raw file": "复制原始文件",
    "More edit options": "更多编辑选项", "Open symbols panel": "打开符号面板", "Edit and raw actions": "编辑与原始操作",
    "File view": "文件视图", "You’ve activated the": "你已激活", "file finder": "文件查找器", "to navigate,": "以导航，",
    "to view files,": "以查看文件，", "to exit.": "以退出。", "No matching files found.": "未找到匹配的文件。",
    "The name of the file to navigate to.": "要导航到的文件名。", "Hide this notice forever": "永久隐藏此提示",
    "Close reason": "关闭原因", "Has linked pull request": "有链接的拉取请求", "Mentioned user": "提及的用户",
    "Mentioned team": "提及的团队", "Involved user": "参与的用户", "Involves user": "涉及的用户",
    "Number of comments": "评论数量", "Number of interactions": "互动数量", "Issue origami icon": "议题图标",
    "CI status": "CI 状态", "Review status": "评审状态", "Not merged": "未合并",
    "This will revoke access for": "这将撤销以下对象的访问权限", "all third-party": "所有第三方",
    "OAuth applications. This action cannot be undone.": "OAuth 应用。此操作无法撤销。",
    "Type your username to confirm.": "输入你的用户名以确认。",
    "I understand, revoke access for everything": "我明白，撤销所有访问权限", "Recently used": "最近使用",
    "Least recently used": "最久未使用", "Revoking will deny future access to your account": "撤销后将拒绝未来对你账户的访问",
    "Are you sure you want to revoke authorization?": "你确定要撤销授权吗？",
    "I understand, revoke access": "我明白，撤销访问",
    "Read more about connecting with third-party applications at": "了解更多关于连接第三方应用的信息，请访问",
    "Upgrade to Copilot Pro": "升级到 Copilot Pro", "Copilot Spaces documentation": "Copilot Spaces 文档",
    "Space options": "空间选项", "Try Spaces in VS Code": "在 VS Code 中试用 Spaces", "Dismiss banner": "关闭横幅",
    "Create space": "创建空间", "Search spaces": "搜索空间", "Shared with me": "与我共享",
    "Start your first space": "创建你的第一个空间", "Need help? Read the docs": "需要帮助？阅读文档", "Generate code": "生成代码",
    "Produce code that follows your team's patterns.": "生成遵循你团队规范的代码。", "Share knowledge": "分享知识",
    "Plan projects": "规划项目", "Create requirements and issues your team can ship.": "创建你团队可交付的需求和议题。",
    "Filter spaces": "筛选空间",
    "Want to build something that integrates with and extends GitHub?": "想要构建与 GitHub 集成并扩展其功能的东西吗？",
    "Register a new GitHub App to get started developing on the GitHub API.": "注册一个新的 GitHub App，开始基于 GitHub API 开发。",
    "When viewing a notification, press": "查看通知时，按", "to mark it as Done.": "将其标记为完成。",
    "No OAuth apps": "没有 OAuth 应用",
    "OAuth apps are used to access the GitHub API. Read the docs to find out more.": "OAuth 应用用于访问 GitHub API。阅读文档了解更多。",
    "New OAuth app": "新建 OAuth 应用",
    "Need an API token for scripts or testing? Generate a personal access token for quick access to the GitHub API.": "需要用于脚本或测试的 API 令牌？生成个人访问令牌以快速访问 GitHub API。",
    "Tokens you have generated that can be used to access the GitHub API.": "你已生成的、可用于访问 GitHub API 的令牌。",
    "Personal access tokens (classic) function like ordinary OAuth access tokens. They can be used instead of a password for Git over HTTPS, or can be used to": "个人访问令牌（经典）的作用类似于普通的 OAuth 访问令牌。它们可代替密码用于通过 HTTPS 进行 Git 操作，也可用于",
    "Expires on": "到期于", "Ask Copilot...": "询问 Copilot…", "Ask Copilot…": "询问 Copilot…",
    "In immersive chat": "在沉浸式对话中", "In a space": "在空间中", "Download for...": "下载…", "Download for…": "下载…",
    "Dismiss": "关闭", "Dismiss for this repository only": "仅为此仓库关闭",
    "Dismiss for all repositories": "为所有仓库关闭", "Order": "排序方向", "Created on": "创建时间",
    "Total comments": "评论总数", "Furthest due date": "最晚到期日", "Closest due date": "最近到期日",
    "Least complete": "完成度最低", "Most complete": "完成度最高", "Alphabetical": "按字母顺序",
    "Reverse alphabetical": "按字母逆序", "Most issues": "议题最多", "Fewest issues": "议题最少",
    "Filter assignees": "筛选指派对象", "No assignees": "无指派对象", "Filter by milestone": "按里程碑筛选",
    "Filter milestones": "筛选里程碑", "No milestone": "无里程碑", "Filter by project": "按项目筛选",
    "Filter projects": "筛选项目", "No projects were found": "未找到项目",
    "Please try a different search query.": "请尝试其他搜索查询。", "Filter labels": "筛选标签", "Filter authors": "筛选作者",
    "Something isn't working": "功能出现异常", "Awaiting triage and prioritization": "等待分类与优先级排序",
    "New feature or request": "新功能或请求", "Process capture and runtime observation": "进程捕获与运行时观察",
    "Native analysis and decompilation, including Ghidra, IDA, and Hopper analysis behavior": "原生分析与反编译，包括 Ghidra、IDA 与 Hopper 的分析行为",
    "Popular": "热门", "P0: critical": "P0：严重", "Critical issue requiring immediate attention": "需要立即处理的严重议题",
    "No private views yet": "还没有私有视图", "Shared": "共享", "No shared views yet": "还没有共享视图",
    "No projects found": "未找到项目", "There are no projects linked to this repository.": "此仓库未关联任何项目。",
    "You haven't created any Milestones.": "你还没有创建任何里程碑。",
    "Use Milestones to create collections of Issues and Pull Requests for a particular release or project.": "使用里程碑为特定发布或项目创建议题和拉取请求的集合。",
    "Search all labels": "搜索所有标签", "Current": "当前", "Categories": "分类", "View all discussions": "查看所有讨论",
    "Announcements": "公告", "Ideas": "想法", "Polls": "投票", "Q&A": "问答", "Show and tell": "展示与分享",
    "Most helpful": "最有帮助", "last 30 days": "最近 30 天", "New discussion": "新建讨论", "Latest activity": "最近活动",
    "Unanswered": "未回答", "Community guidelines": "社区准则", "started": "发起于", "Filter: Open": "筛选：打开",
    "Filter: Closed": "筛选：已关闭", "Description": "描述", "Lists": "列表", "Create list": "创建列表",
    "Filter lists": "筛选列表", "List name": "列表名称", "People": "成员", "Members": "成员", "Relevance": "相关性",
    "Ascending": "升序", "Descending": "降序", "Type": "类型", "Sources": "来源", "Mirror": "镜像", "Mirrors": "镜像",
    "Deployable": "可部署", "Deployed": "已部署", "Language": "语言", "Exclude": "排除", "Visibility": "可见性",
    "Templates": "模板", "Featured": "精选", "Apps": "应用", "Listing type": "列表类型",
    "GitHub Copilot": "GitHub Copilot", "Visual Studio Code": "Visual Studio Code", "Free": "免费",
    "Getting started": "入门", "Install Copilot in your editor": "在编辑器中安装 Copilot",
    "Ask about coding problems and get code completions while you work.": "工作时询问编码问题并获取代码补全。",
    "Chat with Copilot anywhere": "随处与 Copilot 聊天", "Start building with Copilot": "开始用 Copilot 构建",
    "copilot": "Copilot", "Homepage": "主页", "Reload": "重新加载", "Loading": "加载中", "Use": "使用", "Locked": "已锁定",
    "Unlocked": "未锁定", "Answered": "已回答", "items": "项", "Enterprise": "企业", "Today": "今天", "Normal": "正常",
    "Incident": "事件", "Degradation": "降级", "Related": "相关", "Product": "产品", "Features": "功能",
    "Changing your username can have unintended side effects.": "更改用户名可能会产生意想不到的副作用。",
    "unintended side effects": "意想不到的副作用",
    "Looking to manage account security settings? You can find them in the": "想管理账户安全设置？你可以在",
    "Link Patreon account": "关联 Patreon 账户", "Connect with Patreon": "使用 Patreon 连接", "Start export": "开始导出",
    "Successor settings": "继任者设置", "Search by username, full name, or email address": "按用户名、全名或电子邮件地址搜索",
    "Advanced": "高级", "Owner": "所有者", "Size": "大小", "Topic": "话题", "Switch branches/tags": "切换分支/标签",
    "Find a branch...": "查找分支…", "Workflows": "工作流", "Preview checks": "预览检查", "Management": "管理",
    "Completed": "已完成", "No sessions match your filters": "没有匹配筛选条件的会话",
    "Try adjusting your search or filters.": "请尝试调整搜索或筛选条件。", "No reviews": "暂无评审",
    "Approved review": "已批准的评审", "Reviewed by you": "你已评审", "Not reviewed by you": "你未评审",
    "Awaiting review from you": "等待你评审", "Awaiting review from you or your team": "等待你或你的团队评审",
    "Stacks": "堆栈", "Archives": "档案", "Export": "导出", "JSON": "JSON", "CSV": "CSV", "All-time": "全部时间",
    "New sponsorships, changes, and cancellations": "新的赞助、变更与取消",
    "No sponsorship activity in this time period": "此时间段内没有赞助活动",
    "This is where you can review activity from your sponsorships.": "你可以在此查看你的赞助活动。",
    "GitHub Apps augment and extend your workflows on GitHub with commercial, open source, and homegrown tools.": "GitHub Apps 通过商业、开源和自研工具增强并扩展你在 GitHub 上的工作流。",
    "Incidents": "事件", "Uptime": "正常运行时间", "Operational": "运行正常", "Show All": "显示全部", "+ Show All": "+ 显示全部",
    "Uh oh!": "出错了！", "There was an error while loading.": "加载时出错。", "Please reload this page": "请重新加载此页面",
    "September": "九月", "October": "十月", "November": "十一月", "Sep": "9月", "Oct": "10月", "Nov": "11月",
    "Contributor": "贡献者", "added": "添加", "Committed": "已提交", "commented": "评论了", "removed": "移除",
    "remaining": "剩余", "opened": "创建", "Agents": "智能体", "Team": "团队", "Roadmap": "路线图", "Platform": "平台",
    "Partners": "合作伙伴", "Education": "教育", "Skills": "技能", "Careers": "招聘", "Newsroom": "新闻中心",
    "Inclusion": "多元包容", "Shop": "商店", "Footer": "页脚", "GitHub footer": "GitHub 页脚",
    "GitHub Status History - Atom Feed": "GitHub 状态历史 - Atom 订阅",
    "GitHub Status History - RSS Feed": "GitHub 状态历史 - RSS 订阅",
    "This branch is protected by branch protections": "此分支受分支保护规则保护", "Branch": "分支", "Behind": "落后",
    "Ahead": "领先", "Stale": "陈旧", "Active branches": "活动分支", "All branches": "全部分支",
    "Search branch...": "搜索分支…", "Total reactions": "反应总数", "Thumbs up": "赞", "Thumbs down": "踩",
    "Laugh": "大笑", "Hooray": "庆祝", "Confused": "困惑", "Rocket": "火箭", "Eyes": "眼睛", "Heart": "爱心",
    "Suggested": "建议", "Merge candidate": "合并候选", "Create new issue": "新建议题", "Bug Report": "缺陷报告",
    "Feature request": "功能请求", "Blank issue": "空白议题", "Submit a Bug Report": "提交缺陷报告",
    "Suggest an idea for this project": "为该项目提出建议", "Create a new issue from scratch": "从空白开始创建新议题",
    "Add a title": "添加标题", "Create more": "继续创建", "Filter inbox by...": "按以下条件筛选收件箱…",
    "Create new filter": "创建新筛选", "Filter inbox": "筛选收件箱", "Query": "查询", "Team mention": "团队提及",
    "Review request": "评审请求", "Unread": "未读", "Read": "已读", "subscribed": "已订阅", "author": "作者",
    "ci activity": "CI 活动", "mentioned": "被提及", "review requested": "请求评审", "state change": "状态变更",
    "assign": "指派", "team mention": "团队提及", "Code review limits": "代码评审限制", "Sponsorship log": "赞助日志",
    "Cloud": "云", "Sort by: Most recent": "排序方式：最新到最早", "Most recent": "最新", "Close menu": "关闭菜单",
    "Close user navigation menu": "关闭用户导航菜单", "Create new repository": "新建仓库",
    "Your personal account": "你的个人账户", "Settings menu": "设置菜单", "User settings": "用户设置",
    "Issue types": "议题类型", "Issue fields": "议题字段", "Expand sidebar": "展开侧边栏",
    "Items will be filtered as you type": "输入时自动筛选",
    "Find code, projects, and people on GitHub:": "在 GitHub 上查找代码、项目和人员：",
    "Sorry, something went wrong.": "抱歉，出了点问题。", "Community standards": "社区准则",
    "Community Standards": "社区准则", "Fork this repository and edit the file": "复刻此仓库并编辑该文件",
    "Update profile": "更新个人资料", "Update preferences": "更新偏好设置",
    "Please upload a picture smaller than 1 MB.": "请上传小于 1 MB 的图片。",
    "We only support PNG, GIF, or JPG pictures.": "仅支持 PNG、GIF 或 JPG 格式的图片。",
    "File contents don’t match the file extension.": "文件内容与扩展名不匹配。", "Upload a photo…": "上传照片…",
    "Remove photo": "移除照片", "Show Achievements on my profile": "在我的个人资料中显示成就",
    "Join the GitHub Developer Program": "加入 GitHub 开发者计划", "Save jobs profile": "保存求职资料",
    "No Preference": "无偏好", "Select notification channels": "选择通知渠道", "Select events": "选择事件",
    "Comments on Issues and Pull Requests": "议题与拉取请求的评论", "Only notify for failed workflows": "仅在工作流失败时通知",
    "Send weekly": "每周发送", "Send daily": "每天发送", "No usage found": "未找到使用记录",
    "Manage Copilot policy": "管理 Copilot 策略", "Manage email preferences": "管理电子邮件偏好设置",
    "Resend verification email": "重新发送验证邮件", "Select email to become primary": "选择要设为主的邮箱",
    "Select email to become backup": "选择要设为备用的邮箱", "Only allow primary email": "仅允许主邮箱",
    "Disable two-factor authentication": "禁用双重身份验证", "Preferred 2FA method": "首选双重验证方式",
    "Two-factor methods": "双重验证方式", "SMS/Text message": "短信", "Security keys": "安全密钥",
    "Delete confirmation": "删除确认", "Register new security key": "注册新的安全密钥",
    "This security key has already been registered.": "此安全密钥已被注册。", "Recovery options": "恢复选项",
    "Recovery codes": "恢复代码", "Two-factor authentication options": "双重身份验证选项",
    "Edit Authenticator app": "编辑身份验证器应用", "Add SMS/Text message": "添加短信", "Edit Security keys": "编辑安全密钥",
    "Add GitHub Mobile": "添加 GitHub Mobile", "View Recovery codes": "查看恢复代码", "Hide Security keys": "隐藏安全密钥",
    "Enable JavaScript to use your security key.": "请启用 JavaScript 以使用安全密钥。",
    "Filter inbox by…": "按以下条件筛选收件箱…", "Filter by…": "筛选条件…", "New filter": "新建筛选", "Inbox name": "收件箱名称",
    "Issues navigation": "议题导航", "Filter issues": "筛选议题", "Sort by Updated descending": "按更新时间降序排列",
    "Any time": "任何时间", "All caught up": "全部处理完毕", "Failing checks": "失败的检查",
    "Pull requests that are waiting for your review": "等待你评审的拉取请求",
    "Your pull requests that are ready to merge": "可合并的你的拉取请求", "Frequently Asked Questions": "常见问题",
    "Quick Start": "快速开始", "Install via Homebrew": "通过 Homebrew 安装", "Features in Detail": "功能详解",
    "Custom Scan Paths": "自定义扫描路径", "Quick Launchers": "快速启动器", "Workflow run filters": "工作流运行筛选",
    "Every 10 seconds": "每 10 秒", "Every 30 seconds": "每 30 秒", "Every minute": "每分钟",
    "Every 5 minutes": "每 5 分钟", "Filter by Workflow": "按工作流筛选", "Filter by Event": "按事件筛选",
    "Filter by Status": "按状态筛选", "Filter by Branch": "按分支筛选", "Filter by Actor": "按操作者筛选",
    "Filter by user": "按用户筛选", "Filter by issue type": "按议题类型筛选", "Issues with no type": "无类型的议题",
    "Filter types": "筛选类型", "View workflow file": "查看工作流文件", "Sort…": "排序…",
    "Search all discussions": "搜索所有讨论", "No labels found. Sorry about that.": "未找到标签，抱歉。",
    "Community links": "社区链接", "Export SBOM": "导出 SBOM", "Search all dependencies": "搜索所有依赖",
    "Filter by ecosystem": "按生态系统筛选", "No ecosystems found.": "未找到生态系统。",
    "Show dependency options": "显示依赖选项", "Show paths": "显示路径", "View transitive paths": "查看传递路径",
    "Dependency files checked": "已检查的依赖文件", "Reporting a Vulnerability": "报告漏洞",
    "Response Expectations": "响应预期", "Supported Versions": "支持的版本",
    "Security fixes are only guaranteed for:": "安全修复仅保证适用于：",
    "What We Consider a Security Issue": "我们认定的安全问题", "What Usually Does Not Qualify": "通常不属于安全问题的情形",
    "There aren't any published security advisories": "暂无已发布的安全公告",
    "View merged pull requests": "查看已合并的拉取请求", "View open pull requests": "查看打开的拉取请求",
    "View closed issues": "查看已关闭的议题", "View open issues": "查看打开的议题", "Top committers": "提交最多的贡献者",
    "Interactive chart": "交互式图表", "Issue templates": "议题模板", "Pull request template": "拉取请求模板",
    "Not added yet": "尚未添加", "Create pull request": "创建拉取请求", "Contributions & activity": "贡献与活动",
    "Make profile private and hide activity": "将个人资料设为私密并隐藏活动",
    "Include private contributions on my profile": "在个人资料中包含私有贡献", "Profile settings": "个人资料设置",
    "GitHub Developer Program": "GitHub 开发者计划", "GitHub developer program": "GitHub 开发者计划",
    "Jobs profile": "求职资料", "Available for hire": "可接受聘用", "Trending settings": "趋势设置",
    "Trending Repositories": "趋势仓库", "Display current local time": "显示当前本地时间", "Time zone": "时区",
    "Social account": "社交账号", "Link to social profile 1": "链接到社交资料 1",
    "Link to social profile 2": "链接到社交资料 2", "Link to social profile 3": "链接到社交资料 3",
    "Link to social profile 4": "链接到社交资料 4", "Account switcher": "账户切换", "Single theme": "单一主题",
    "Pull Request reviews": "拉取请求评审", "Pull Request pushes": "拉取请求推送",
    "Includes your own updates": "包含你自己的更新", "GitHub Free": "GitHub 免费版", "Copilot Free": "Copilot 免费版",
    "Connected to Google": "已连接 Google", "Disconnect from Google": "断开 Google 连接",
    "set your email in Git": "在 Git 中设置你的邮箱", "Allow all verified emails": "允许所有已验证邮箱",
    "Less secure": "安全性较低", "now required": "现在必需", "— Registered on": "— 注册于", "| Last used": "| 上次使用",
    "Upgrade `macOS` to passkey": "将 `macOS` 升级为通行密钥", "Delete `macOS` security key": "删除 `macOS` 安全密钥",
    "Confirm delete of `macOS` security key": "确认删除 `macOS` 安全密钥",
    "Cancel `macOS` security key delete": "取消删除 `macOS` 安全密钥",
    "Confirm delete `macOS` security key": "确认删除 `macOS` 安全密钥",
    "Enter a nickname for this security key": "为此安全密钥输入昵称", "Chrome on macOS": "macOS 上的 Chrome",
    "generate a GPG key and add it to your account": "生成 GPG 密钥并添加到你的账户",
    "Are you sure you want to delete this token?": "确定要删除此令牌吗？",
    "Last used within the last 2 weeks": "最近两周内使用过", "ProTip!": "小提示！", "Mentioning me": "提及我的",
    "No saved views": "没有已保存的视图", "View options": "视图选项", "Saved views": "已保存的视图",
    "Set as default view": "设为默认视图", "Default to this view when visiting": "访问时默认使用此视图",
    "issues and pull requests": "议题和拉取请求", "Collapse Your drafts": "收起你的草稿",
    "Collapse Waiting for review or checks": "收起等待评审或检查", "Collapse Needs action": "收起需要处理",
    "Collapse Ready to merge": "收起可合并", "Collapse Merging": "收起合并中", "Customize sections": "自定义分区",
    "Collapse Needs your review": "收起需要你评审", "Collapse Needs your teams' review": "收起需要你团队评审",
    "Add this repository to a list": "将此仓库添加到列表", "You don't have any lists yet.": "你还没有任何列表。",
    "Select lists": "选择列表", "Create Issue Branch": "创建议题分支", "Language:": "语言：",
    "Trending repositories": "趋势仓库", "CI/CD and automation": "CI/CD 与自动化",
    "Quality analysis, fixes, and enforcement": "质量分析、修复与强制执行", "Cloud development environments": "云开发环境",
    "Vulnerability detection and remediation": "漏洞检测与修复", "Secret Protection": "密钥保护",
    "Secret scanning and leak prevention": "密钥扫描与泄漏防护", "Build with Copilot": "使用 Copilot 构建",
    "Customize Copilot": "自定义 Copilot", "Developer articles": "开发者文章",
    "GitHub Advanced Security": "GitHub 高级安全", "Enterprise-grade code security": "企业级代码安全",
    "Copilot for business": "企业版 Copilot", "Enterprise-grade AI features": "企业级 AI 功能",
    "Enterprise-grade 24/7 support": "企业级 7×24 支持", "GitHub Universe": "GitHub Universe 大会",
    "See your top dependencies": "查看你的主要依赖", "Get sponsored": "获得赞助",
    "Support the developers who power open source": "支持驱动开源生态的开发者",
    "Given back to our maintainers": "已回馈给我们的维护者", "Regions supported globally": "支持的国家和地区",
    "Organizations sponsoring": "赞助的组织", "Learn about invoiced billing": "了解发票结算",
    "Help open source thrive": "助力开源繁荣", "Invest in open source. It powers your world.": "投资开源，它支撑着你的世界。",
    "How do I sponsor a project?": "如何赞助一个项目？", "How do I get paid for my contributions?": "我的贡献如何获得报酬？",
    "GitHub on LinkedIn": "GitHub 的 LinkedIn", "GitHub on Instagram": "GitHub 的 Instagram",
    "GitHub on YouTube": "GitHub 的 YouTube", "GitHub on X": "GitHub 的 X",
    "GitHub on TikTok": "GitHub 的 TikTok", "GitHub on Twitch": "GitHub 的 Twitch",
    "(opens in a new tab)": "（在新标签页中打开）", "(required)": "（必填）", "Choose an owner": "选择所有者",
    "Search owner": "搜索所有者", "Choose a .gitignore template": "选择 .gitignore 模板", "Choose a license": "选择许可证",
    "License filter": "许可证筛选", "Choose a plan": "选择方案", "Pick a plan for your organization": "为你的组织选择方案",
    "per user/month": "每位用户/月", "Create a free organization": "创建免费组织",
    "Unlimited public/private repositories": "无限公有/私有仓库",
    "Dependabot security and version updates": "Dependabot 安全与版本更新",
    "Free for public repositories": "公有仓库免费", "Issues & Projects": "议题与项目", "Featured add-ons": "精选附加功能",
    "GitHub Codespaces Access": "GitHub Codespaces 访问权限", "GitHub Codespaces": "GitHub Codespaces",
    "Show features": "显示功能", "Most popular": "最受欢迎", "Advanced collaboration for": "面向以下对象的高级协作：",
    "individuals and organizations": "个人与组织", "Continue with Team": "继续使用 Team",
    "Everything included in Free, plus...": "包含免费版全部功能，另有…",
    "Access to GitHub Codespaces": "可使用 GitHub Codespaces", "Repository rules": "仓库规则",
    "Draft pull requests": "草稿拉取请求", "Pages and Wikis": "页面与 Wiki",
    "Environment deployment branches and secrets": "环境部署分支与密钥", "GitHub Secret Protection": "GitHub 密钥保护",
    "GitHub Code Security": "GitHub 代码安全", "Security, compliance,": "安全、合规，", "Starting at": "起价",
    "Start a free trial": "开始免费试用", "Contact Sales": "联系销售", "Contact our sales team": "联系我们的销售团队",
    "Everything included in Team, plus...": "包含 Team 版全部功能，另有…", "Data residency": "数据驻留",
    "Start a free 30 day trial": "开始 30 天免费试用", "Enterprise Managed Users": "企业托管用户",
    "User provisioning through SCIM": "通过 SCIM 配置用户", "Environment protection rules": "环境保护规则",
    "Audit Log API": "审计日志 API", "SAML single sign-on": "SAML 单点登录", "Advanced auditing": "高级审计",
    "GitHub Connect": "GitHub Connect", "Exclusive add-on": "专属附加功能", "Compare features": "比较功能",
    "Features on": "功能位于", "Switch plans": "切换方案", "Select a plan to review its features": "选择方案以查看其功能",
    "How to get started": "如何开始", "Join for free": "免费加入", "Start Enterprise trial": "开始 Enterprise 试用",
    "Code management": "代码管理", "Public repositories": "公有仓库", "Private repositories": "私有仓库",
    "Code workflow": "代码工作流", "With policies and controls": "含策略与管控",
    "Ability to increase spend limit": "可提高支出上限", "GitHub Packages": "GitHub Packages",
    "GitHub sandbox (public preview)": "GitHub 沙箱（公开预览）", "Code reviews": "代码评审",
    "Multiple pull request assignees": "拉取请求多指派人",
    "Assign more than one person to a pull request.": "为一个拉取请求指派多人。", "Repository insights": "仓库洞察",
    "Automatic code review assignment": "自动分配代码评审", "Collaborators for public repositories": "公有仓库协作者",
    "Collaborators for private repositories": "私有仓库协作者", "Organization and team management": "组织与团队管理",
    "Pages and wikis": "页面与 Wiki", "Multiple issue assignees": "议题多指派人",
    "Assign more than one person to an issue.": "为一个议题指派多人。", "Push protection": "推送保护",
    "Provider patterns": "提供方模式", "Provider notification": "提供方通知", "Validity checks": "有效性检查",
    "AI detection for alerts": "告警的 AI 检测", "AI detection for push protection": "推送保护的 AI 检测",
    "Generic patterns": "通用模式", "Custom patterns": "自定义模式", "Push protection bypass controls": "推送保护绕过管控",
    "Insights in security overview": "安全概览中的洞察", "Scan history API": "扫描历史 API",
    "Copilot Autofix": "Copilot 自动修复", "Security campaigns": "安全活动", "Dependency review action": "依赖审查操作",
    "Dependabot custom auto-triage rules": "Dependabot 自定义自动分诊规则",
    "Platform security and compliance": "平台安全与合规", "Artifact attestations": "制品证明",
    "GitHub Security Advisories": "GitHub 安全公告", "Role-based access control": "基于角色的访问控制",
    "Required 2FA": "强制双重验证", "Audit log": "审计日志", "SAML single sign-on (SSO)": "SAML 单点登录（SSO）",
    "IP allow list": "IP 允许列表", "Enterprise Cloud": "企业云",
    "Limit access to known allowed IP addresses.": "仅允许访问已知 IP 地址。", "Marketplace and integrations": "市场与集成",
    "Status checks": "状态检查", "Pre-receive hooks": "接收前钩子", "Enterprise Server": "企业服务器",
    "Support and deployment": "支持与部署", "Standard Support": "标准支持",
    "Premium and Premium Plus Support": "高级与高级增强支持", "Invoice billing": "发票结算",
    "Self-hosted deployment": "自托管部署", "Open Branch views": "打开分支视图",
    "Open Releases and tags navigation": "打开发布与标签导航", "Releases and tags navigation": "发布与标签导航",
    "Tags results": "标签结果", "Update Contributors": "更新贡献者", "Usage metrics": "使用指标",
    "Performance metrics": "性能指标", "Refresh now": "立即刷新", "Filter workflow options": "筛选工作流选项",
    "Filter event options": "筛选事件选项", "Filter status options": "筛选状态选项", "Filter branch options": "筛选分支选项",
    "Filter actor options": "筛选操作者选项", "User results": "用户结果", "Milestone results": "里程碑结果",
    "Issue Type results": "议题类型结果", "Categories, most helpful, and community links": "分类、最有帮助与社区链接",
    "OK, got it": "知道了", "· Detected by": "· 检测方式",
    "Showing 1 path. Export SBOM to view all paths.": "显示 1 条路径。导出 SBOM 可查看全部路径。",
    "Filter ecosystems": "筛选生态系统", "Filter by ecosystem options": "筛选生态系统选项", "Email:": "电子邮箱：",
    "Subject line:": "邮件主题：", "Include as much of the following as possible:": "请尽可能包含以下信息：",
    "Period:": "时间范围：", "Active pull requests": "活跃的拉取请求", "Active issues": "活跃的议题", "New issues": "新建议题",
    "releases published": "个发布已上线", "pull requests merged": "个拉取请求已合并", "privacy statement": "隐私声明",
    "Copy query for Needs your review to clipboard": "复制「需要你评审」的查询到剪贴板",
    "Open search for Needs your review": "打开「需要你评审」的搜索",
    "Open search for Needs your teams' review": "打开「需要你团队评审」的搜索",
    "Copy query for Your drafts to clipboard": "复制「你的草稿」的查询到剪贴板",
    "Open search for Your drafts": "打开「你的草稿」的搜索",
    "Open search for Waiting for review or checks": "打开「等待评审或检查」的搜索",
    "Copy query for Changes requested to clipboard": "复制「请求更改」的查询到剪贴板",
    "Open search for Changes requested": "打开「请求更改」的搜索",
    "Copy query for Failing checks to clipboard": "复制「失败的检查」的查询到剪贴板",
    "Open search for Failing checks": "打开「失败的检查」的搜索",
    "Copy query for Ready to merge to clipboard": "复制「可合并」的查询到剪贴板",
    "Open search for Ready to merge": "打开「可合并」的搜索",
    "GitHub Sponsors allows the developer community": "GitHub Sponsors 让开发者社区",
    "Sign in and start by navigating to": "登录后先前往", "your dependencies": "你的依赖", "explore tab": "探索标签页",
    "trending repositories": "趋势仓库", "GitHub’s organization on GitHub": "GitHub 在 GitHub 上的组织",
    "Chart displaying months a total amount spent": "显示每月总支出金额的图表",
    "Use suggested repository name shiny-telegram": "使用建议的仓库名 shiny-telegram", "today or": "立即，或",
    "contact our sales team": "联系我们的销售团队", "Audit log API": "审计日志 API", "queued:": "排队中：",
    "cancelled:": "已取消：", "failed:": "失败：", "Build Windows Prerelease": "构建 Windows 预发布版",
    "Bundle Drift Audit": "包体偏移审计", "Copilot code review": "Copilot 代码评审",
    "Dependabot Updates": "Dependabot 更新", "Linux Release": "Linux 发布",
    "Real Flatpak and Snap": "真实 Flatpak 与 Snap", "Windows CI": "Windows 持续集成",
    "Jupyter Notebook": "Jupyter Notebook", "2,000 CI/CD minutes/month": "每月 2,000 CI/CD 分钟",
    "3,000 CI/CD minutes/month": "每月 3,000 CI/CD 分钟", "50,000 CI/CD minutes/month": "每月 50,000 CI/CD 分钟",
    "2,000 minutes/month": "每月 2,000 分钟", "3,000 minutes/month": "每月 3,000 分钟",
    "50,000 minutes/month": "每月 50,000 分钟", "500MB of Packages storage": "500MB Packages 存储",
    "2GB of Packages storage": "2GB Packages 存储", "50GB of Packages storage": "50GB Packages 存储",
    "$0 spend limit": "0 美元支出上限", "GitHub Actions": "GitHub Actions", "settings": "设置",
    "Email address": "电子邮箱地址", "Default notification email": "默认通知邮箱", "Remove section": "移除分区",
    "More editors": "更多编辑器", "Go to Copilot": "前往 Copilot", "Inline suggestions": "内联建议",
    "Included credits": "包含的额度", "Upgrade plan": "升级方案", "Copilot in the cloud": "云端 Copilot",
    "Coming soon": "即将推出", "Copilot Chat in GitHub.com": "GitHub.com 上的 Copilot Chat",
    "Copilot CLI": "Copilot CLI", "Copilot in GitHub Desktop": "GitHub Desktop 中的 Copilot",
    "GitHub Copilot app": "GitHub Copilot 应用", "Copilot can search the web": "Copilot 可以搜索网络",
    "Microsoft Privacy Statement": "Microsoft 隐私声明", "Dashboard Entry Point": "仪表盘入口",
    "MCP servers in Copilot": "Copilot 中的 MCP 服务器", "Copilot-generated commit messages": "Copilot 生成的提交信息",
    "Copilot Spaces": "Copilot Spaces", "Suggestions matching public code": "匹配公开代码的建议",
    "Allow GitHub to use my data for AI model training": "允许 GitHub 使用我的数据训练 AI 模型",
    "Privacy Statement": "隐私声明", "Show Copilot": "显示 Copilot",
    "Get Copilot from an organization": "从组织获取 Copilot",
    "You do not belong to any organizations.": "你不属于任何组织。", "Copilot Auto model selection": "Copilot 自动选择模型",
    "You will have access to the feature": "你将可以使用此功能", "You won't have access to the feature": "你将无法使用此功能",
    "Semantic indexing for Non-GitHub Repositories": "非 GitHub 仓库的语义索引", "Current plan": "当前方案",
    "Advanced tools for private repos": "私有仓库的高级工具", "Upgrade to Pro": "升级到 Pro",
    "Looking for GitHub Copilot Pro?": "在找 GitHub Copilot Pro？", "View Copilot plans": "查看 Copilot 方案",
    "Protected branches": "受保护的分支", "Compare plans": "比较方案", "All the basics": "所有基础功能",
    "Organization features": "组织功能", "Enterprise compliance features": "企业合规功能",
    "Enterprise support": "企业支持", "The basics for individuals": "面向个人的基础方案", "and organizations": "与组织",
    "Export a software bill of materials (SBOM) for your repository.": "为你的仓库导出软件物料清单（SBOM）。",
    "Ensure unfalsifiable provenance and integrity for your software.": "为你的软件提供不可篡改的来源与完整性保障。",
    "Define users' level of access to your code, data and settings.": "定义用户对你代码、数据和设置的访问级别。",
    "Quickly review the actions performed by members of your organization.": "快速审查组织成员执行的操作。",
    "Assign multiple users or a team to review a pull request.": "指派多个用户或一个团队来评审拉取请求。",
    "Read more about viewing contributions on your profile": "详细了解如何在个人资料中查看贡献",
    "You can manage verified email addresses in your": "你可以在", "email settings": "电子邮件设置",
    "Other users will see the time difference from their local time.": "其他用户会看到与其本地时间的时差。",
    "Your achievements will be shown on your profile.": "你的成就将显示在个人资料中。",
    "GitHub's standard light theme with full color contrast and brightness.": "GitHub 标准浅色主题，色彩对比与亮度完整。",
    "This theme will be active when your system is set to “light mode”": "当系统设为「浅色模式」时启用此主题",
    "This theme will be active when your system is set to “dark mode”": "当系统设为「深色模式」时启用此主题",
    "Choose the number of spaces a tab is equal to when rendering code": "选择渲染代码时一个制表符等于多少个空格",
    "Add or remove instructions for how to operate complex controls.": "添加或移除复杂控件的操作说明。",
    "Select if URLs should be formatted on paste. You can use": "选择粘贴时是否格式化 URL。你可以使用",
    "Pasting a URL while having text selected will replace the text": "选中文本时粘贴 URL 会替换该文本",
    "There are no SSH keys associated with your account.": "你的账户尚未关联任何 SSH 密钥。",
    "There are no GPG keys associated with your account.": "你的账户尚未关联任何 GPG 密钥。",
    "Note that this will include your existing unsigned commits.": "注意：这将包含你现有的未签名提交。",
    "You don’t have any repositories yet. Would you like to": "你还没有任何仓库。是否要",
    "Tokens you have generated that can be used to access the": "你生成的、可用于访问",
    "Verify domains to restrict who can publish GitHub Pages on them.": "验证域名以限制谁可以在其上发布 GitHub Pages。",
    "Are you sure you want to disable two-factor authentication?": "确定要禁用双重身份验证吗？",
    "This browser doesn't support security keys yet.": "此浏览器尚不支持安全密钥。",
    "Delete: At least one verified email is required.": "删除：至少需要一个已验证的邮箱。",
    "Something went really wrong and we can’t process that picture.": "出现严重错误，无法处理该图片。",
    "Please upload a picture smaller than 10,000x10,000.": "请上传小于 10,000×10,000 的图片。",
    "Building an application, service, or tool that integrates with GitHub?": "正在构建与 GitHub 集成的应用、服务或工具？",
    "Backlog": "待办积压", "Triage": "分类处理", "In review": "评审中", "Ready": "就绪", "Relationships": "关联关系",
    "Metadata": "元数据", "Parent issue": "父议题", "Sub-issues": "子议题", "Add sub-issue": "添加子议题",
    "Blocked by": "被阻塞于", "Blocking": "阻塞", "Mark as blocked by": "标记为被阻塞", "Global": "全局",
    "Contributing": "参与贡献", "Code of Conduct": "行为准则", "Contributing Guide": "贡献指南",
    "Good First Issues": "新手友好议题", "Remote URL selector": "远程 URL 选择器", "Repository actions": "仓库操作",
    "Select a branch": "选择分支", "Select a tag": "选择标签", "Filter branches...": "筛选分支…",
    "Filter tags...": "筛选标签…", "Show options": "显示选项", "Hide options": "隐藏选项", "Sign up for free": "免费注册",
    "Sign in to comment": "登录后评论", "Commit message body": "提交信息正文", "Pull request navigation": "拉取请求导航",
    "Here's what's popular on GitHub today...": "以下是今天 GitHub 上的热门内容…", "Copilot Workspace": "Copilot 工作区",
    "Agent tasks": "智能体任务", "Copilot coding agent": "Copilot 编程智能体", "Ref selector": "引用选择器",
    "Select reviewers": "选择评审者", "Select assignees": "选择指派人", "Select projects": "选择项目",
    "Select milestones": "选择里程碑", "Select labels": "选择标签", "Link issues": "关联议题",
    "Explore GitHub": "探索 GitHub",
    "Trending repositories on GitHub today · GitHub": "今日 GitHub 趋势仓库 · GitHub",
    "GitHub · Change is constant. GitHub keeps you ahead. · GitHub": "GitHub · 变化恒常，GitHub 助你领先 · GitHub",
    "Which remote URL should I use?": "应使用哪个远程 URL？",
    "Copy URL to clipboard": "复制 URL 到剪贴板",
    "Certifications": "认证", "Startups": "初创企业", "Nonprofits": "非营利组织",
    "Healthcare": "医疗健康", "Manufacturing": "制造业", "Government": "政府机构",
    "Changelog": "更新日志", "Contributor": "贡献者", "Member": "成员", "Collaborator": "协作者",
    "Successfully merging this pull request may close these issues.": "成功合并此拉取请求可能会关闭以下议题。",
    "Installation": "安装", "Summary": "摘要", "Usage": "用法", "Features": "特性",
    "Overview": "概览", "Motivation": "动机", "Background": "背景", "Testing": "测试",
    "Troubleshooting": "故障排查", "Requirements": "环境要求", "Prerequisites": "前置条件",
    "Configuration": "配置", "Deployment": "部署", "References": "参考", "Acknowledgments": "致谢",
  };

  function normalizeKey(text) {
    return String(text || '')
      .replace(/\u00A0/g, ' ')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const DICT_EXACT = Object.create(null);
  const DICT_LOWER = Object.create(null);
  for (const k in RAW_DICT) {
    const v = RAW_DICT[k];
    const nk = normalizeKey(k);
    DICT_EXACT[k] = v;
    if (nk && !(nk in DICT_EXACT)) DICT_EXACT[nk] = v;
    const lk = nk.toLowerCase();
    if (lk && !(lk in DICT_LOWER)) DICT_LOWER[lk] = v;
  }

  function dictLookup(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    if (DICT_EXACT[raw]) return DICT_EXACT[raw];
    const norm = normalizeKey(raw);
    if (DICT_EXACT[norm]) return DICT_EXACT[norm];
    // 防止全大写 2 字符缩略词（如 ON / GO / IN）被小写命中普通介词/动词
    if (norm.length <= 2 && /^[A-Z0-9]+$/.test(norm)) return '';
    return DICT_LOWER[norm.toLowerCase()] || '';
  }

  function dictHasExact(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    const norm = normalizeKey(raw);
    if (DICT_EXACT[raw] || DICT_EXACT[norm]) return true;
    if (norm.length <= 2 && /^[A-Z0-9]+$/.test(norm)) return false;
    return !!DICT_LOWER[norm.toLowerCase()];
  }

  const MONTH_CN = Object.create(null);
  [
    ['january', 'jan', '1月'], ['february', 'feb', '2月'], ['march', 'mar', '3月'],
    ['april', 'apr', '4月'], ['may', 'may', '5月'], ['june', 'jun', '6月'],
    ['july', 'jul', '7月'], ['august', 'aug', '8月'], ['september', 'sep', '9月'],
    ['october', 'oct', '10月'], ['november', 'nov', '11月'], ['december', 'dec', '12月'],
  ].forEach(([full, abbr, cn]) => {
    MONTH_CN[full] = cn;
    MONTH_CN[abbr] = cn;
  });

  const WEEK_CN = {
    mon: '周一', monday: '周一', tue: '周二', tuesday: '周二',
    wed: '周三', wednesday: '周三', thu: '周四', thursday: '周四',
    fri: '周五', friday: '周五', sat: '周六', saturday: '周六',
    sun: '周日', sunday: '周日',
  };
  const REL_UNIT = { second: '秒', minute: '分钟', hour: '小时', day: '天', week: '周', month: '个月', year: '年' };
  const UNIT_ABBR = { s: '秒', m: '分钟', h: '小时', d: '天', w: '周', mo: '个月', y: '年' };
  const VERB_TIME = {
    opened: '打开于 ', updated: '更新于 ', committed: '提交于 ', created: '创建于 ',
    closed: '关闭于 ', merged: '合并于 ', pushed: '推送于 ', reopened: '重新打开于 ',
  };
  const GREET = { morning: '早上好', afternoon: '下午好', evening: '晚上好', night: '夜深了' };

  const monthCn = (n) => MONTH_CN[(n || '').toLowerCase()] || '';

  function cnDate(phrase) {
    const t = normalizeKey(phrase);
    const m = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s*(\d{4})?$/.exec(t);
    if (m) {
      const c = monthCn(m[1]);
      if (c) return `${m[3] ? m[3] + '年' : ''}${c}${m[2]}日`;
    }
    return t;
  }

  function cnDateTime(phrase) {
    const t = normalizeKey(phrase);
    const m = /^([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4}),?\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)(?:\s+(GMT[+-]\d{1,2}(?::\d{2})?|UTC))?$/i.exec(t);
    if (!m) return '';
    const c = monthCn(m[1]);
    if (!c) return '';
    return `${m[3]}年${c}${m[2]}日 ${m[4]}${m[5] ? ' ' + m[5].toUpperCase() : ''}`;
  }

  function relCn(num, unit) {
    const u = REL_UNIT[String(unit).toLowerCase().replace(/s$/, '')];
    return u ? `${num} ${u}前` : '';
  }

  function translateRelative(t) {
    const s = normalizeKey(t);
    let m;
    if (/^just now$/i.test(s)) return '刚刚';
    if ((m = /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i.exec(s))) return relCn(m[1], m[2]);
    if ((m = /^an?\s+(second|minute|hour|day|week|month|year)\s+ago$/i.exec(s))) return relCn('1', m[1]);
    if ((m = /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+from now$/i.exec(s))) return relCn(m[1], m[2]).replace('前', '后');
    if ((m = /^(yesterday|today)$/i.exec(s))) return /yesterday/i.test(m[1]) ? '昨天' : '今天';
    return '';
  }

  const SORT_MAP = {
    'newest descending': '最新优先',
    'newest ascending': '最早优先',
    'recently starred': '最近星标',
    'recently active': '最近活跃',
    'best match': '最佳匹配',
    'most stars': '星标最多',
    'last updated': '最近更新',
  };

  const LABEL_MAP = {
    verified: '已验证',
    public: '公开',
    'github sponsor': 'GitHub 赞助者',
  };

  const PERIOD_MAP = {
    'all-time': '全部时间',
    today: '今天',
    'last week': '上周',
    'last month': '上个月',
    'last year': '去年',
  };

  const TIMEFRAME_MAP = {
    'current month': '本月',
    'last month': '上个月',
    'last 30 days': '最近 30 天',
  };

  const PATTERN_RULES = [
    [/^(\d[\d,]*)\s+contributions? in the last year$/i, (m) => `${m[1]} 次贡献（过去一年）`],
    [/^(\d[\d,]*)\s+contributions?$/i, (m) => `${m[1]} 次贡献`],
    [/^(\d[\d,]*)\s+followers?\s*[·•]\s*(\d[\d,]*)\s+following$/i, (m) => `${m[1]} 位关注者 · 正在关注 ${m[2]} 人`],
    [/^(\d[\d,]*)\s+followers?$/i, (m) => `${m[1]} 位关注者`],
    [/^(\d[\d,]*)\s+following$/i, (m) => `正在关注 ${m[1]} 人`],
    [/^(\d[\d,]*)\s+watching$/i, (m) => `${m[1]} 人关注`],
    [/^(\d[\d,]*)\s+participants?$/i, (m) => `${m[1]} 位参与者`],
    [/^Created (\d[\d,]*)\s+commits? in (\d[\d,]*)\s+repositor(?:y|ies)$/i, (m) => `在 ${m[2]} 个仓库中创建了 ${m[1]} 个提交`],
    [/^Created (\d[\d,]*)\s+repositor(?:y|ies)$/i, (m) => `创建了 ${m[1]} 个仓库`],
    [/^Created (\d[\d,]*)\s+commits?$/i, (m) => `创建了 ${m[1]} 个提交`],
    [/^Created (\d[\d,]*)\s+branch(?:es)?$/i, (m) => `创建了 ${m[1]} 个分支`],
    [/^Created (\d[\d,]*)\s+issues?$/i, (m) => `创建了 ${m[1]} 个议题`],
    [/^Created (\d[\d,]*)\s+pull requests?$/i, (m) => `创建了 ${m[1]} 个拉取请求`],
    [/^Forked from (\S+)$/i, (m) => `复刻自 ${m[1]}`],
    [/^Opened by (.+)$/i, (m) => `由 ${m[1]} 打开`],
    [/^Updated (.+)$/i, (m) => { const r = translateRelative(m[1]); return r ? `更新于 ${r}` : ''; }],
    [/^Last updated (.+)$/i, (m) => { const r = translateRelative(m[1]); return r ? `最近更新于 ${r}` : ''; }],
    [/^(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)$/i, (m) => translateRelative(m[1])],
    [/^(an?\s+(?:second|minute|hour|day|week|month|year)\s+ago)$/i, (m) => translateRelative(m[1])],
    [/^(just now|yesterday|today)$/i, (m) => translateRelative(m[1])],
    [/^on ([A-Za-z]+)\.?\s+(\d{1,2}),?\s*(\d{4})?$/i, (m) => { const c = monthCn(m[1]); return c ? `于 ${m[3] ? m[3] + '年' : ''}${c}${m[2]}日` : ''; }],
    [/^(\d[\d,]*)\s+commits?$/i, (m) => `${m[1]} 个提交`],
    [/^(\d[\d,]*)\s+repositories$/i, (m) => `${m[1]} 个仓库`],
    [/^(\d[\d,]*)\s+stars?$/i, (m) => `${m[1]} 个星标`],
    [/^(\d[\d,]*)\s+forks?$/i, (m) => `${m[1]} 个复刻`],
    [/^(\d[\d,]*)\s+issues?$/i, (m) => `${m[1]} 个议题`],
    [/^(\d[\d,]*)\s+pull requests?$/i, (m) => `${m[1]} 个拉取请求`],
    [/^(\d[\d,]*)\s+comments?$/i, (m) => `${m[1]} 条评论`],
    [/^(\d[\d,]*)\s+Branch(?:es)?$/i, (m) => `${m[1]} 个分支`],
    [/^(\d[\d,]*)\s+Tags?$/i, (m) => `${m[1]} 个标签`],
    [/^(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s+checks?\s+(?:OK|passing|passed|successful)$/i, (m) => `${m[1]} / ${m[2]} 项检查通过`],
    [/^(\d[\d,]*)\s+workflow runs?$/i, (m) => `${m[1]} 次工作流运行`],
    [/^([A-Za-z]+\.?\s+\d{1,2},\s*\d{4},?\s+\d{1,2}:\d{2}(?:\s*[AP]M)?(?:\s+(?:GMT[+-]\d{1,2}(?::\d{2})?|UTC))?)$/i, (m) => cnDateTime(m[1])],
    [/^([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})$/i, (m) => { const c = monthCn(m[1]); return c ? `${m[3]}年${c}${m[2]}日` : ''; }],
    [/^([A-Za-z]+)\.?\s+(\d{1,2})$/i, (m) => { const c = monthCn(m[1]); return c ? `${c}${m[2]}日` : ''; }],
    [/^Updated on (.+)$/i, (m) => `更新于 ${cnDate(m[1])}`],
    [/^(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i, (m) => WEEK_CN[m[1].toLowerCase()] || ''],
    [/^Good (morning|afternoon|evening|night)[,!]?\s*(.*?)[!.]?$/i, (m) => {
      const g = GREET[m[1].toLowerCase()] || '';
      const who = (m[2] || '').replace(/[!.,]+$/, '').trim();
      return g + (who ? `，${who}` : '') + '！';
    }],
    [/^(\d[\d,]*)\s+new stars? this week$/i, (m) => `本周新增 ${m[1]} 个星标`],
    [/^([\d,]+)\s+stars?\s+today$/i, (m) => `今日新增 ${m[1]} 个星标`],
    [/^([\d,]+)\s+stars?\s+this\s+month$/i, (m) => `本月新增 ${m[1]} 个星标`],
    [/^([\d,]+)\s+stars?\s+this\s+year$/i, (m) => `今年新增 ${m[1]} 个星标`],
    [/^Starred\s+([\d,]+)\s+times?$/i, (m) => `已被星标 ${m[1]} 次`],
    [/^No contributions on (.+)$/i, (m) => `${cnDate(m[1])} 无贡献`],
    [/^This contribution was made on (.+)$/i, (m) => `此贡献于 ${cnDate(m[1])}`],
    [/^See the (\d[\d,]*)\s+items? in this collection$/i, (m) => `查看此合集中的 ${m[1]} 项`],
    [/^(\d[\d,]*)\s+items? in this collection$/i, (m) => `此合集共 ${m[1]} 项`],
    [/^(opened|updated|committed|created|closed|merged|pushed|reopened)\s+(\d+)\s*(mo|s|m|h|d|w|y)\s+ago$/i, (m) => `${VERB_TIME[m[1].toLowerCase()] || ''}${m[2]}${UNIT_ABBR[m[3].toLowerCase()]}前`],
    [/^(\d+)\s*(mo|s|m|h|d|w|y)\s+ago$/i, (m) => `${m[1]}${UNIT_ABBR[m[2].toLowerCase()]}前`],
    [/^(\d[\d,]*)\s+budgets?$/i, (m) => `${m[1]} 个预算`],
    [/^(\d+)-(\d+) of (\d+)$/, (m) => `第 ${m[1]}-${m[2]} 条，共 ${m[3]} 条`],
    [/^\$([\d,.]+)\s*\/\s*\$([\d,.]+)\s+spent$/i, (m) => `$${m[1]} / $${m[2]} 已花费`],
    [/^Timeframe: (.+)$/i, (m) => `时间范围：${TIMEFRAME_MAP[m[1].trim().toLowerCase()] || m[1].trim()}`],
    [/^Group by: (.+)$/i, (m) => `分组方式：${m[1].trim() === 'None' ? '无' : m[1].trim()}`],
    [/^Scope: (.+)$/i, (m) => `范围：${m[1].trim()}`],
    [/^of (\d+)$/i, (m) => `共 ${m[1]} 条`],
    [/^View (.+) website$/i, (m) => `访问 ${m[1]} 网站`],
    [/^Starred, click to unstar this repository(?: \(\d[\d,]*\))?$/i, () => '已星标，点击取消星标此仓库'],
    [/^Star (.+)$/i, (m) => `星标 ${m[1]}`],
    [/^Unstar (.+)$/i, (m) => `取消星标 ${m[1]}`],
    [/^Selected (\d+) repositories?\.$/i, (m) => `已选 ${m[1]} 个仓库。`],
    [/^Showing (\d+) to (\d+) of (\d+) budgets$/i, (m) => `显示第 ${m[1]} 至 ${m[2]} 个预算，共 ${m[3]} 个`],
    [/^Seen in (.+)$/i, (m) => `出现在 ${m[1]}`],
    [/^About the ["“](.+)["”] section$/i, (m) => `关于“${m[1]}”部分`],
    [/^Sponsor @(.+)$/i, (m) => `赞助 @${m[1]}`],
    [/^Repository menu: (.+)$/i, (m) => `仓库菜单：${m[1]}`],
    [/^Topic: (.+)$/i, (m) => `话题：${m[1]}`],
    [/^Commit ([0-9a-f]{6,})$/i, (m) => `提交 ${m[1]}`],
    [/^commits by (.+)$/i, (m) => `由 ${m[1]} 提交`],
    [/^Releases: (.+)$/i, (m) => `发行版：${m[1]}`],
    [/^Learn more about (.+)$/i, (m) => `了解有关 ${m[1]} 的更多信息`],
    [/^Filter by age: (.+)$/i, (m) => `按时间筛选：${m[1]}`],
    [/^Sort by (.+)$/i, (m) => { const v = SORT_MAP[m[1].trim().toLowerCase()]; return v ? `排序方式：${v}` : ''; }],
    [/^No recoverable packages were found for (.+)\.$/i, (m) => `未找到 ${m[1]} 的可恢复软件包。`],
    [/^Permalink: (.+)$/i, (m) => `永久链接：${m[1]}`],
    [/^Copy full SHA for (.+)$/i, (m) => `复制 ${m[1]} 的完整 SHA`],
    [/^Show description for (.+)$/i, (m) => `显示 ${m[1]} 的描述`],
    [/^More actions for workflow run (\d+)$/i, (m) => `工作流运行 ${m[1]} 的更多操作`],
    [/^Actions for (.+?)'s comment, (.+)$/i, (m) => `对 ${m[1]} 评论的操作`],
    [/^Follow (.+)$/i, (m) => `关注 ${m[1]}`],
    [/^Unfollow (.+)$/i, (m) => `取消关注 ${m[1]}`],
    [/^Filter by author (.+)$/i, (m) => `按作者筛选：${m[1]}`],
    [/^Filter by review: (.+)$/i, (m) => `按评审筛选：${m[1]}`],
    [/^Filter by assignee (.+)$/i, (m) => `按指派人筛选：${m[1]}`],
    [/^Milestone: (.+)$/i, (m) => `里程碑：${m[1]}`],
    [/^Page (\d+)$/i, (m) => `第 ${m[1]} 页`],
    [/^Page (\d+)\.\.\.$/i, (m) => `第 ${m[1]} 页…`],
    [/^Showing (\d+) of (\d+) repositories$/i, (m) => `显示 ${m[1]}/${m[2]} 个仓库`],
    [/^React with (.+)$/i, (m) => `用 ${m[1]} 回应`],
    [/^Label: (.+)$/i, (m) => `标签：${LABEL_MAP[m[1].trim().toLowerCase()] || m[1]}`],
    [/^Show (\d+) more topics?$/i, (m) => `显示另外 ${m[1]} 个话题`],
    [/^(.+) language$/i, (m) => `${m[1]} 语言`],
    [/^Starred, click to unstar this topic$/i, () => '已星标，点击取消星标此话题'],
    [/^#(\d+) updated$/i, (m) => `#${m[1]} 已更新`],
    [/^Revoke (.+)$/i, (m) => `撤销 ${m[1]}`],
    [/^Report (.+)$/i, (m) => `举报 ${m[1]}`],
    [/^Expires on \w+, (.+)\.$/i, (m) => `于 ${cnDate(m[1])} 到期。`],
    [/^(\d+)\/(\d+) complete$/i, (m) => `已完成 ${m[1]}/${m[2]}`],
    [/^Export all repositories and profile metadata for (.+?)\. Exports will be available for 7 days\.$/i, (m) => `导出 ${m[1]} 的所有仓库和个人资料元数据。导出文件将在 7 天内可用。`],
    [/^Connect a Patreon account for (.+?) to sponsor maintainers with\. Get recognition on GitHub for sponsorships made on Patreon when the sponsored person has linked Patreon and GitHub, too, and has a public GitHub Sponsors profile\.$/i, (m) => `为 ${m[1]} 关联一个 Patreon 账户以赞助维护者。当被赞助者同时关联了 Patreon 与 GitHub 并拥有公开的 GitHub Sponsors 主页时，你在 Patreon 上的赞助也能在 GitHub 上获得认可。`],
    [/^By clicking "Add Successor" below, I acknowledge that I am the owner of the (.+?) account, and am authorizing GitHub to transfer content within that account to my GitHub Successor, designated below, in the event of my death\. I understand that this appointment of a successor does not override legally binding next-of-kin rules or estate laws of any relevant jurisdiction, and does not create a binding will\.$/i, (m) => `点击下方“添加继任者”，即表示我确认自己是 ${m[1]} 账户的所有者，并授权 GitHub 在我身故时将账户内的内容转移给下方指定的 GitHub 继任者。我理解此继任者指定不凌驾于任何相关司法管辖区的法定近亲规则或遗产法，也不构成具有约束力的遗嘱。`],
    [/^Period: (.+)$/i, (m) => `时间范围：${PERIOD_MAP[m[1].trim().toLowerCase()] || m[1].trim()}`],
    [/^base: (.+)$/i, (m) => `基础：${m[1]}`],
    [/^compare: (.+)$/i, (m) => `比较：${m[1]}`],
    [/^Delete (.+)$/i, (m) => `删除 ${m[1]}`],
    [/^Open search for (.+)$/i, (m) => `打开「${m[1]}」的搜索`],
    [/^Copy query for (.+) to clipboard$/i, (m) => `复制「${m[1]}」的查询到剪贴板`],
    [/^(.+) branch$/i, (m) => `${m[1]} 分支`],
  ];

  function patternTranslate(text) {
    const t = normalizeKey(text);
    if (!t) return '';
    for (const [re, fn] of PATTERN_RULES) {
      const m = re.exec(t);
      if (m) {
        const r = fn(m);
        if (r) return r;
      }
    }
    return '';
  }

  function translateTitleText(title) {
    const t = String(title || '').trim();
    if (!t) return '';
    const direct = dictLookup(t);
    if (direct) return direct;
    const m = /^([^·]+?)\s*·\s*(.+)$/.exec(t);
    if (m) {
      const left = dictLookup(m[1].trim());
      if (left) return `${left} · ${m[2].trim()}`;
    }
    return '';
  }

  /* ============================================================
   * 3. 缓存（内存 + 持久化）
   * ============================================================ */
  const cache = new Map();

  (function loadCache() {
    try {
      const rawText = readStore(CACHE_KEY, '');
      if (!rawText) return;
      const obj = JSON.parse(rawText);
      for (const k in obj) cache.set(k, obj[k]);
    } catch (e) {}
  })();

  let saveTimer = null;
  function saveCache() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        const entries = [...cache.entries()].slice(-CACHE_MAX);
        writeStore(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
      } catch (e) {}
    }, 1500);
  }

  /* ============================================================
   * 4. 区域与跳过判定（兼容 2026 GitHub React + Primer DOM）
   * ============================================================ */
  const processedText = new WeakSet();
  const nodeOriginalText = new WeakMap();
  const attrOriginalMap = new WeakMap();
  const onlineTextNodes = new Set();
  const onlineAttrEls = new Set();
  const zhToEn = new Map();

  const CJK = /[\u2E80-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;
  const containsCJK = (s) => CJK.test(s);

  function isTranslatable(text) {
    const t = (text || '').trim();
    if (t.length < 2) return false;
    if (containsCJK(t)) return false;
    if (!/[A-Za-z]/.test(t)) return false;
    if (/^[\d\s\W]+$/.test(t)) return false;
    if (/^v?\d+(\.\d+){1,4}[-+.\w]*$/i.test(t)) return false;
    if (/^(https?:\/\/|www\.)/i.test(t)) return false;
    if (!/\s/.test(t) && /^[\w.\-/@]+\.(js|mjs|cjs|ts|jsx|tsx|json|md|yml|yaml|py|go|rs|java|c|cpp|h|css|scss|html|sh|toml|lock|txt|png|jpg|jpeg|gif|webp|svg)$/i.test(t)) return false;
    return true;
  }

  function isIdentifierLike(t) {
    const s = t.trim();
    if (/\s/.test(s)) return false;
    if (s.length > 80) return false;
    return /[\/.]/.test(s) && /^[A-Za-z0-9._\-\/]+$/.test(s);
  }

  function isIdentifierInLink(node) {
    const el = node.parentElement;
    if (!el) return false;
    const link = el.closest('a, [role="link"]');
    if (!link) return false;
    const t = (node.nodeValue || '').trim();
    if (/\s/.test(t) || t.length > 60) return false;
    return /^[A-Za-z0-9._\-\/@]+$/.test(t);
  }

  const ABOUT_SECTION_SEL = [
    '[class*="OverviewSidebar"]',
    '[class*="SidebarSection"]',
    '[class*="sidebarSection" i]',
    '[data-component="SplitPageLayout.Pane"]',
    '.BorderGrid',
  ].join(', ');

  const REPO_DESC_SELECTORS = [
    '[itemprop="description"]',
    '.repository-description',
    '[data-testid="repository-description"]',
    '.repo-list-description',
    '.org-repos-repo-description',
    '[class*="SidebarAbout"][class*="description"]',
    '[class*="sidebarSection" i] p[class*="description" i]',
    '[data-component="SplitPageLayout.Pane"] p[class*="description" i]',
    '[class*="repo-description"]',
    '[class*="OverviewSidebar"] [class*="description"]',
  ].join(', ');

  const README_SELECTORS = [
    '.repository-content .markdown-body',
    '[data-testid="readme"] .markdown-body',
    '#readme .markdown-body',
    '[class*="DirectoryRichtextContent"] .markdown-body',
    '[class*="SharedMarkdownContent"] .markdown-body',
    '[data-testid="readme-content"]',
  ].join(', ');

  const ISSUE_SELECTORS = [
    '[data-testid="issue-body"] .markdown-body',
    '[data-testid="issue-viewer-comments-container"] .markdown-body',
    '[class*="IssueBody"] .markdown-body',
    '[class*="IssueCommentBody"] .markdown-body',
    '[class*="CommentBody"] .markdown-body',
    '[class*="PullRequestComment"] .markdown-body',
    '[class*="ReviewComment"] .markdown-body',
    '.comment-body.markdown-body',
    '.js-comment-body.markdown-body',
  ].join(', ');

  const USER_SELECTORS = [
    '.p-name', '.p-nickname', '.user-mention',
    '[data-hovercard-type="user"]', '[data-hovercard-url^="/users/"]',
    '[data-testid="avatar-link"]', '[data-testid="issue-body-header-author"]',
    'a.author', '.author', '[itemprop="name"]', '[data-testid="profile-name"]',
    '#settings-header', 'h1#settings-header', '.vcard-fullname', '.vcard-username',
    '[data-testid="profile-name-link"]',
  ].join(', ');

  const REPO_NAME_SELECTORS = [
    '[itemprop="name codeRepository"]',
    '[data-hovercard-type="repository"]',
    'a[data-testid="repo-name-link"]',
  ].join(', ');

  const SEARCH_INPUT_SEL = [
    'input[role="combobox"]', 'input[type="search"]', 'input[name="q"]',
    '[role="searchbox"]', '[data-testid*="search-input"]',
    '[data-testid*="quick-search"]', '.header-search', '[class*="quick-search"]',
    '[class*="FilesSearchBox"]', '[class*="SearchBox"]',
  ].join(', ');

  function isRepoDescContext(el) {
    try {
      if (!el || !el.closest) return false;
      if (el.closest('a, button, [data-zh-toggle]')) return false;
      return !!el.closest(REPO_DESC_SELECTORS);
    } catch (e) { return false; }
  }

  function isReadmeContext(el) {
    try { return !!(el && el.closest && el.closest(README_SELECTORS)); } catch (e) { return false; }
  }

  function isIssueContext(el) {
    try { return !!(el && el.closest && el.closest(ISSUE_SELECTORS)); } catch (e) { return false; }
  }

  function isUserContext(el) {
    try { return !!(el && el.closest && el.closest(USER_SELECTORS)); } catch (e) { return false; }
  }

  function isRepoNameContext(el) {
    try { return !!(el && el.closest && el.closest(REPO_NAME_SELECTORS)); } catch (e) { return false; }
  }

  function isSearchControl(el) {
    try {
      if (!el || !el.closest) return false;
      if (el.matches && el.matches(SEARCH_INPUT_SEL)) return true;
      return !!el.closest(SEARCH_INPUT_SEL);
    } catch (e) { return false; }
  }

  function shouldSkip(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest && el.closest('[data-zh-toggle], [data-zh-skip]')) return true;
    if (el.isContentEditable) return true;
    if (el.closest && el.closest(CFG.skipSelectors)) return true;
    if (!pageState.about && isRepoDescContext(el)) return true;
    if (!pageState.readme && isReadmeContext(el)) return true;
    if (!pageState.issue && isIssueContext(el)) return true;
    return false;
  }

  function shouldSkipAttr(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest && el.closest('[data-zh-skip], [data-zh-toggle]')) return true;
    if (isSearchControl(el)) return true;
    if (el.closest && el.closest('pre, code, .blob-code, .highlight, .react-directory-filename-column, [class*="react-directory-row-name-cell"], .react-directory-row-commit-cell, [role="tree"]')) {
      return true;
    }
    return false;
  }

  function dedupeScopes(list) {
    return list.filter((el) => !list.some((other) => other !== el && other.contains(el)));
  }

  /* ============================================================
   * 5. 翻译单元操作（记录原文以支持无刷新还原）
   * ============================================================ */
  function unitText(u) {
    return u.kind === 'text' ? (u.node.nodeValue || '') : (u.el.getAttribute(u.attr) || '');
  }

  function applyUnit(u, zh, isOnline) {
    if (u.kind === 'text') {
      const raw = u.node.nodeValue || '';
      if (!nodeOriginalText.has(u.node)) nodeOriginalText.set(u.node, raw);
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
      u.node.nodeValue = (m ? m[1] : '') + zh + (m ? m[3] : '');
      if (isOnline) onlineTextNodes.add(u.node);
    } else {
      const orig = u.el.getAttribute(u.attr);
      if (orig != null) {
        let m = attrOriginalMap.get(u.el);
        if (!m) { m = new Map(); attrOriginalMap.set(u.el, m); }
        if (!m.has(u.attr)) m.set(u.attr, orig);
      }
      u.el.setAttribute(u.attr, zh);
      if (isOnline) onlineAttrEls.add(u.el);
    }
  }

  function isUnitDone(u) {
    if (u.kind === 'text') return processedText.has(u.node);
    return !!(u.el.__zhAttrs && u.el.__zhAttrs.has(u.attr));
  }

  function markUnitDone(u) {
    if (u.kind === 'text') processedText.add(u.node);
    else (u.el.__zhAttrs || (u.el.__zhAttrs = new Set())).add(u.attr);
  }

  function unitHostEl(u) {
    return u.kind === 'text' ? u.node.parentElement : u.el;
  }

  /* ============================================================
   * 6. 网络请求与在线翻译源（可用性修复 + 熔断保护）
   * ============================================================ */
  function gmRequest(opts) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest unavailable'));
        return;
      }
      GM_xmlhttpRequest({
        timeout: CFG.requestTimeout,
        onload: (r) => (r.status >= 200 && r.status < 300)
          ? resolve(r) : reject(new Error('HTTP ' + r.status)),
        onerror: () => reject(new Error('network')),
        ontimeout: () => reject(new Error('timeout')),
        ...opts,
      });
    });
  }

  const gmGetText = async (url, headers) => (await gmRequest({ method: 'GET', url, headers: headers || {} })).responseText;
  const gmPostText = async (url, body, headers) => (await gmRequest({ method: 'POST', url, data: body, headers: headers || {} })).responseText;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function decodeHtmlEntities(str) {
    if (!str || str.indexOf('&') === -1) return str;
    if (typeof DOMParser === 'function') {
      try {
        const doc = new DOMParser().parseFromString(str, 'text/html');
        return doc.documentElement.textContent || str;
      } catch (e) {}
    }
    return str
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }

  // 6.1 Google Chrome 扩展接口（clients5）：支持多 q= POST 参数精确对齐，无换行拆分错误
  async function googleClientBatch(texts) {
    const body = texts.map((t) => 'q=' + encodeURIComponent(t)).join('&');
    const res = await gmPostText(
      'https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=zh-CN',
      body,
      { 'Content-Type': 'application/x-www-form-urlencoded' }
    );
    const data = JSON.parse(res);
    if (!Array.isArray(data) || data.length !== texts.length) throw new Error('googleClient align');
    return data.map((item) => {
      if (typeof item === 'string') return item;
      if (Array.isArray(item) && typeof item[0] === 'string') return item[0];
      return '';
    });
  }

  // 6.2 Google gtx 接口：优先批量，若换行对齐异常则降级逐条请求，避免误触发熔断
  async function googleSingle(text) {
    const res = await gmPostText(
      'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t',
      'q=' + encodeURIComponent(text),
      { 'Content-Type': 'application/x-www-form-urlencoded' }
    );
    const data = JSON.parse(res);
    if (!data || !Array.isArray(data[0])) throw new Error('google empty');
    return data[0].map((seg) => (seg && seg[0]) || '').join('');
  }

  async function googleBatch(texts) {
    if (texts.length === 1) return [await googleSingle(texts[0])];
    const clean = texts.map((t) => t.replace(/\s*\n+\s*/g, ' '));
    const joined = clean.join('\n');
    const res = await gmPostText(
      'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t',
      'q=' + encodeURIComponent(joined),
      { 'Content-Type': 'application/x-www-form-urlencoded' }
    );
    const data = JSON.parse(res);
    if (!data || !Array.isArray(data[0])) throw new Error('google empty');
    const out = data[0].map((seg) => (seg && seg[0]) || '').join('');
    const parts = out.split('\n');
    if (parts.length === texts.length) return parts;

    const fallback = [];
    for (const t of clean) {
      fallback.push(await googleSingle(t));
      await sleep(40);
    }
    return fallback;
  }

  // 6.3 Bing 网页翻译接口（www.bing.com/ttranslatev3）
  let bingSession = null;
  async function getBingSession(forceRefresh) {
    if (!forceRefresh && bingSession && Date.now() < bingSession.exp) return bingSession;
    const html = await gmGetText('https://www.bing.com/translator', {
      'Accept': 'text/html,application/xhtml+xml',
    });
    const ig = (/IG:"([^"]+)"/.exec(html) || [])[1];
    const iid = (/data-iid="([^"]+)"/.exec(html) || [])[1] || 'translator.5023';
    const pm = /params_AbusePreventionHelper\s*=\s*\[(\d+),"([^"]+)",(\d+)\]/.exec(html);
    if (!ig || !pm) throw new Error('bing token missing');
    bingSession = {
      ig,
      iid,
      key: pm[1],
      token: pm[2],
      count: 1,
      exp: Date.now() + 8 * 60 * 1000,
    };
    return bingSession;
  }

  async function bingWebSingle(text) {
    let sess = await getBingSession(false);
    for (let attempt = 0; attempt < 2; attempt++) {
      const url = `https://www.bing.com/ttranslatev3?isVertical=1&&IG=${encodeURIComponent(sess.ig)}&IID=${encodeURIComponent(sess.iid)}.${sess.count++}`;
      const body = `fromLang=auto-detect&text=${encodeURIComponent(text)}&to=zh-Hans&token=${encodeURIComponent(sess.token)}&key=${encodeURIComponent(sess.key)}`;
      const res = await gmPostText(url, body, {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Origin': 'https://www.bing.com',
        'Referer': 'https://www.bing.com/translator',
      });
      const data = JSON.parse(res);
      if (Array.isArray(data) && data[0] && data[0].translations && data[0].translations[0]) {
        return data[0].translations[0].text || '';
      }
      if (attempt === 0 && (data && (data.ShowCaptcha || data.statusCode))) {
        sess = await getBingSession(true);
        continue;
      }
      throw new Error('bing blocked');
    }
    throw new Error('bing failed');
  }

  async function bingWebBatch(texts) {
    const out = [];
    for (const t of texts) {
      out.push(await bingWebSingle(t));
      await sleep(70);
    }
    return out;
  }

  // 6.4 有道手机版网页接口（m.youdao.com/translate）
  function parseYoudaoMobileHtml(html) {
    if (typeof DOMParser === 'function') {
      try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const li = doc.querySelector('#translateResult li');
        if (li && li.textContent) return li.textContent.trim();
      } catch (e) {}
    }
    const ulMatch = /<ul[^>]*id=["']translateResult["'][^>]*>([\s\S]*?)<\/ul>/i.exec(html);
    if (!ulMatch) return '';
    const liMatch = /<li[^>]*>([\s\S]*?)<\/li>/i.exec(ulMatch[1]);
    if (!liMatch) return '';
    return decodeHtmlEntities(liMatch[1].replace(/<[^>]+>/g, '').trim());
  }

  async function youdaoMobileBatch(texts) {
    const out = [];
    for (const t of texts) {
      const html = await gmPostText(
        'https://m.youdao.com/translate',
        `inputtext=${encodeURIComponent(t)}&type=EN2ZH_CN`,
        { 'Content-Type': 'application/x-www-form-urlencoded' }
      );
      const translated = parseYoudaoMobileHtml(html);
      if (!translated) throw new Error('youdao empty');
      out.push(translated);
      await sleep(80);
    }
    return out;
  }

  // 6.5 MyMemory（免费兜底）
  async function myMemoryBatch(texts) {
    const out = [];
    for (const t of texts) {
      const url = 'https://api.mymemory.translated.net/get?langpair=en|zh-CN&q=' + encodeURIComponent(t);
      const data = JSON.parse(await gmGetText(url));
      const s = (data && data.responseData && data.responseData.translatedText) || '';
      if (!s || /MYMEMORY WARNING/i.test(s)) throw new Error('mymemory unavailable');
      out.push(s);
      await sleep(120);
    }
    return out;
  }

  // 6.6 可选付费 / AI 翻译源（AI OpenAI 兼容 / 百度 / 腾讯云 TMT）
  const creds = (function loadCreds() {
    try { return JSON.parse(readStore(CREDS_KEY, '{}') || '{}') || {}; } catch (e) { return {}; }
  })();

  function saveCreds() {
    writeStore(CREDS_KEY, JSON.stringify(creds));
  }

  function isConfigured(name) {
    if (name === 'baidu') return !!(creds.baidu && creds.baidu.appid && creds.baidu.key);
    if (name === 'tencentcloud') return !!(creds.tencentcloud && creds.tencentcloud.secretId && creds.tencentcloud.secretKey);
    if (name === 'ai') return !!(creds.ai && creds.ai.apiKey && creds.ai.model && creds.ai.baseUrl);
    return true;
  }

  function utf8(s) {
    try { return unescape(encodeURIComponent(s)); } catch (e) { return s; }
  }

  function md5(str) {
    function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
    function cmn(q, a, b, x, s2, t) { a = add32(add32(a, q), add32(x, t)); return add32((a << s2) | (a >>> (32 - s2)), b); }
    function ff(a, b, c, d, x, s2, t) { return cmn((b & c) | ((~b) & d), a, b, x, s2, t); }
    function gg(a, b, c, d, x, s2, t) { return cmn((b & d) | (c & (~d)), a, b, x, s2, t); }
    function hh(a, b, c, d, x, s2, t) { return cmn(b ^ c ^ d, a, b, x, s2, t); }
    function ii(a, b, c, d, x, s2, t) { return cmn(c ^ (b | (~d)), a, b, x, s2, t); }
    function md5blk(s2) {
      const k = [];
      for (let i = 0; i < 64; i += 4) {
        k[i >> 2] = s2.charCodeAt(i) + (s2.charCodeAt(i + 1) << 8) + (s2.charCodeAt(i + 2) << 16) + (s2.charCodeAt(i + 3) << 24);
      }
      return k;
    }
    function cycle(x, k) {
      let a = x[0], b = x[1], c = x[2], d = x[3];
      a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586); c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
      a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426); c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
      a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417); c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
      a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101); c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
      a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632); c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
      a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083); c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
      a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690); c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
      a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784); c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
      a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463); c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
      a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353); c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
      a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222); c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
      a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835); c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
      a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415); c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
      a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606); c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
      a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744); c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
      a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379); c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
      x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
    }
    function md5str(s2) {
      const n = s2.length, state = [1732584193, -271733879, -1732584194, 271733878];
      let i;
      for (i = 64; i <= s2.length; i += 64) cycle(state, md5blk(s2.substring(i - 64, i)));
      s2 = s2.substring(i - 64);
      let tail = new Array(16).fill(0);
      for (i = 0; i < s2.length; i++) tail[i >> 2] |= s2.charCodeAt(i) << ((i % 4) << 3);
      tail[i >> 2] |= 0x80 << ((i % 4) << 3);
      if (i > 55) { cycle(state, tail); tail = new Array(16).fill(0); }
      tail[14] = n * 8;
      cycle(state, tail);
      return state;
    }
    function rhex(n) {
      let s2 = '';
      for (let j = 0; j < 4; j++) s2 += ('0' + ((n >> (j * 8)) & 255).toString(16)).slice(-2);
      return s2;
    }
    return md5str(str).map(rhex).join('');
  }

  async function baiduBatch(texts) {
    if (!isConfigured('baidu')) throw new Error('baidu unconfigured');
    const { appid, key } = creds.baidu;
    const q = texts.join('\n');
    const salt = String(Date.now());
    const sign = md5(utf8(appid + q + salt + key));
    const body = `q=${encodeURIComponent(q)}&from=auto&to=zh&appid=${encodeURIComponent(appid)}&salt=${salt}&sign=${sign}`;
    const data = JSON.parse(await gmPostText(
      'https://fanyi-api.baidu.com/api/trans/vip/translate',
      body,
      { 'Content-Type': 'application/x-www-form-urlencoded' }
    ));
    if (!data || data.error_code) throw new Error('baidu ' + (data ? data.error_code : 'empty'));
    const arr = (data.trans_result || []).map((x) => x.dst);
    if (arr.length !== texts.length) throw new Error('baidu align');
    return arr;
  }

  function hexOf(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), (b) => ('0' + b.toString(16)).slice(-2)).join('');
  }
  async function sha256Hex(str) {
    return hexOf(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)));
  }
  async function hmacBytes(keyInput, msgStr) {
    const enc = new TextEncoder();
    const rawKey = typeof keyInput === 'string' ? enc.encode(keyInput) : keyInput;
    const k = await crypto.subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msgStr)));
  }

  async function tencentCloudOne(text) {
    const c = creds.tencentcloud;
    const region = c.region || 'ap-guangzhou';
    const service = 'tmt', host = 'tmt.tencentcloudapi.com', action = 'TextTranslate', version = '2018-03-21';
    const payload = JSON.stringify({ SourceText: text, Source: 'en', Target: 'zh', ProjectId: 0 });
    const ts = Math.floor(Date.now() / 1000);
    const date = new Date(ts * 1000).toISOString().slice(0, 10);
    const ct = 'application/json; charset=utf-8';
    const canonicalHeaders = `content-type:${ct}\nhost:${host}\n`;
    const signedHeaders = 'content-type;host';
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${await sha256Hex(payload)}`;
    const credentialScope = `${date}/${service}/tc3_request`;
    const stringToSign = `TC3-HMAC-SHA256\n${ts}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;
    const secretDate = await hmacBytes('TC3' + c.secretKey, date);
    const secretService = await hmacBytes(secretDate, service);
    const secretSigning = await hmacBytes(secretService, 'tc3_request');
    const signature = hexOf(await hmacBytes(secretSigning, stringToSign));
    const auth = `TC3-HMAC-SHA256 Credential=${c.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const res = await gmPostText('https://' + host, payload, {
      'Content-Type': ct,
      'Authorization': auth,
      'X-TC-Action': action,
      'X-TC-Timestamp': String(ts),
      'X-TC-Version': version,
      'X-TC-Region': region,
    });
    const data = JSON.parse(res);
    const r = data.Response || {};
    if (r.Error) throw new Error('tencentcloud ' + r.Error.Code);
    return (r.TextTranslate && r.TextTranslate.TargetText) || '';
  }

  async function tencentCloudBatch(texts) {
    if (!isConfigured('tencentcloud')) throw new Error('tencentcloud unconfigured');
    const out = [];
    for (const t of texts) {
      out.push(await tencentCloudOne(t));
      await sleep(80);
    }
    return out;
  }

  async function aiBatch(texts) {
    if (!isConfigured('ai')) throw new Error('ai unconfigured');
    const a = creds.ai;
    const base = String(a.baseUrl).replace(/\/+$/, '');
    const url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';
    const body = JSON.stringify({
      model: a.model,
      temperature: 0,
      messages: [
        { role: 'system', content: 'You are a translation engine. Translate each input string into Simplified Chinese. Return ONLY a JSON array of translated strings, same length and order, no explanations.' },
        { role: 'user', content: JSON.stringify(texts) },
      ],
    });
    const res = await gmPostText(url, body, {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + a.apiKey,
    });
    const data = JSON.parse(res);
    const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    const cleaned = content.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    const jsonMatch = /\[[\s\S]*\]/.exec(cleaned);
    const arr = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
    if (!Array.isArray(arr) || arr.length !== texts.length) throw new Error('ai align');
    return arr.map((x) => String(x));
  }

  const PROVIDERS = {
    ai: aiBatch,
    baidu: baiduBatch,
    tencentcloud: tencentCloudBatch,
    googleClient: googleClientBatch,
    google: googleBatch,
    bingWeb: bingWebBatch,
    youdaoMobile: youdaoMobileBatch,
    mymemory: myMemoryBatch,
  };

  const providerState = Object.create(null);

  function providerAvailable(name) {
    if (!isConfigured(name)) return false;
    const st = providerState[name];
    return !st || !st.until || Date.now() > st.until;
  }

  function providerFail(name) {
    const st = providerState[name] || (providerState[name] = { fails: 0, until: 0 });
    st.fails += 1;
    if (st.fails >= 2) {
      st.until = Date.now() + 5 * 60 * 1000;
      st.fails = 0;
    }
  }

  function providerOk(name) {
    const st = providerState[name];
    if (st) st.fails = 0;
  }

  async function translateTexts(texts) {
    for (const name of CFG.providers) {
      const fn = PROVIDERS[name];
      if (!fn || !providerAvailable(name)) continue;
      try {
        const r = await fn(texts);
        if (Array.isArray(r) && r.length === texts.length) {
          providerOk(name);
          return r;
        }
        providerFail(name);
      } catch (e) {
        providerFail(name);
        if (typeof console !== 'undefined' && console.debug) {
          console.debug('[GitHub中文化增强版] 翻译源失败：' + name, e && e.message);
        }
      }
    }
    return null;
  }

  /* ============================================================
   * 7. API 队列与 DOM 扫描
   * ============================================================ */
  const apiQueue = [];
  let apiRunning = false;
  let flushTimer = null;

  function enqueueForApi(units) {
    if (!units || !units.length) return;
    apiQueue.push(units);
    if (flushTimer) return;
    flushTimer = setTimeout(drainQueue, 120);
  }

  async function drainQueue() {
    flushTimer = null;
    if (apiRunning) return;
    apiRunning = true;
    try {
      while (apiQueue.length) {
        await processGroup(apiQueue.shift());
        if (CFG.apiDelay) await sleep(CFG.apiDelay);
      }
    } finally {
      apiRunning = false;
    }
  }

  function chunkUnits(units) {
    const groups = [];
    let cur = [], chars = 0;
    for (const u of units) {
      const len = (unitText(u) || '').trim().length;
      if (cur.length >= CFG.batchItems || (chars + len > CFG.batchChars && cur.length)) {
        groups.push(cur);
        cur = [];
        chars = 0;
      }
      cur.push(u);
      chars += len;
    }
    if (cur.length) groups.push(cur);
    return groups;
  }

  function applyByText(srcNorm, zh) {
    if (typeof document === 'undefined') return false;
    try {
      const cands = document.querySelectorAll('p, div, span, li, td, th, a, button, h1, h2, h3, h4, strong, em, blockquote, label, summary');
      for (const el of cands) {
        if (el.closest('[data-zh-toggle], [data-zh-skip]')) continue;
        if (el.children.length > 0) continue;
        const tn = el.firstChild;
        if (!tn || tn.nodeType !== 3) continue;
        const t = (tn.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (t === srcNorm) {
          applyUnit({ kind: 'text', node: tn }, zh, true);
          processedText.add(tn);
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  async function processGroup(units) {
    const todo = [];
    for (const u of units) {
      const host = unitHostEl(u);
      if (!host || !host.isConnected || isUnitDone(u)) continue;
      const t = (unitText(u) || '').trim();
      if (!t || !isTranslatable(t)) { markUnitDone(u); continue; }
      if (cache.has(t)) { applyUnit(u, cache.get(t), true); markUnitDone(u); continue; }
      if (!/\s/.test(t)) { markUnitDone(u); continue; }
      todo.push(u);
    }
    if (!todo.length || !CFG.online) return;

    for (const group of chunkUnits(todo)) {
      const raw = group.map((u) => (unitText(u) || '').trim());
      const send = raw.map((t) => t.replace(/\s*\n+\s*/g, ' '));
      const results = await translateTexts(send);
      if (results) {
        for (let i = 0; i < group.length; i++) {
          const zh = (results[i] || '').trim();
          if (zh && containsCJK(zh)) {
            cache.set(raw[i], zh);
            zhToEn.set(zh, raw[i]);
            const host = unitHostEl(group[i]);
            if (host && host.isConnected) {
              applyUnit(group[i], zh, true);
            } else if (group[i].kind === 'text') {
              applyByText(raw[i].replace(/\s+/g, ' ').trim(), zh);
            }
          }
          markUnitDone(group[i]);
        }
        saveCache();
      } else {
        for (const u of group) {
          u.__zhFail = (u.__zhFail || 0) + 1;
          if (u.__zhFail >= CFG.maxRetry) markUnitDone(u);
        }
      }
    }
  }

  const observedEls = new WeakSet();
  const io = (typeof window !== 'undefined' && 'IntersectionObserver' in window)
    ? new IntersectionObserver((entries) => {
        const ready = [];
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          io.unobserve(e.target);
          const units = e.target.__zhUnits;
          e.target.__zhUnits = null;
          if (units && units.length) ready.push(...units);
        }
        if (ready.length) enqueueForApi(ready);
      }, { rootMargin: '250px 0px' })
    : null;

  function scheduleUnits(el, units) {
    if (!el || !units.length) return;
    const shortEnough = units.every((u) => (unitText(u) || '').length <= 200);
    if (shortEnough || !io) {
      enqueueForApi(units);
      return;
    }
    if (!observedEls.has(el)) {
      observedEls.add(el);
      el.__zhUnits = units;
      io.observe(el);
    } else {
      enqueueForApi(units);
    }
  }

  function collectTextUnits(scope, pending) {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (processedText.has(node)) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p || shouldSkip(p) || isUserContext(p)) return NodeFilter.FILTER_REJECT;
        if (!(node.nodeValue || '').trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = walker.nextNode())) {
      const text = (n.nodeValue || '').trim();
      if (!text) continue;
      const u = { kind: 'text', node: n };
      const parent = n.parentElement;

      if (!isRepoNameContext(parent)) {
        const hit = dictLookup(text);
        if (hit) { applyUnit(u, hit, false); processedText.add(n); continue; }
        const pat = patternTranslate(text);
        if (pat) { applyUnit(u, pat, false); processedText.add(n); continue; }
      }
      if (!isTranslatable(text)) { processedText.add(n); continue; }
      if (isRepoNameContext(parent)) { processedText.add(n); continue; }
      if (isIdentifierInLink(n) && !dictHasExact(text)) { processedText.add(n); continue; }
      if (cache.has(text)) { applyUnit(u, cache.get(text), true); processedText.add(n); continue; }
      if (parent && parent.tagName === 'OPTION') { processedText.add(n); continue; }
      if (!/\s/.test(text)) { processedText.add(n); continue; }
      if (!CFG.online || !parent) { processedText.add(n); continue; }

      if (!pending.has(parent)) pending.set(parent, []);
      pending.get(parent).push(u);
    }
  }

  function collectAttrUnits(scope, pending) {
    if (!CFG.translateAttributes) return;
    const sel = '[placeholder],[title],[aria-label],[alt]';
    const list = [];
    if (scope.matches && scope.matches(sel)) list.push(scope);
    if (scope.querySelectorAll) {
      const found = scope.querySelectorAll(sel);
      for (let i = 0; i < found.length; i++) list.push(found[i]);
    }
    for (const el of list) {
      if (!el.isConnected || shouldSkipAttr(el) || isUserContext(el)) continue;
      const attrs = TRANSLATE_ATTRS.slice();
      if (VALUE_ATTR_HOSTS.test(el.tagName === 'INPUT' ? (el.type || '') : '')) attrs.push('value');
      for (const attr of attrs) {
        if (!el.hasAttribute(attr)) continue;
        if (el.__zhAttrs && el.__zhAttrs.has(attr)) continue;
        if (attr === 'alt' && el.closest && el.closest('pre,code')) continue;
        const text = (el.getAttribute(attr) || '').trim();
        if (!text || !isTranslatable(text)) continue;
        const u = { kind: 'attr', el, attr };
        if (isIdentifierLike(text)) { markUnitDone(u); continue; }
        const hit = dictLookup(text);
        if (hit) { applyUnit(u, hit, false); markUnitDone(u); continue; }
        const pat = patternTranslate(text);
        if (pat) { applyUnit(u, pat, false); markUnitDone(u); continue; }
        if (cache.has(text)) { applyUnit(u, cache.get(text), true); markUnitDone(u); continue; }
        if (!/\s/.test(text)) { markUnitDone(u); continue; }
        if (!CFG.online) continue;
        if (!pending.has(el)) pending.set(el, []);
        pending.get(el).push(u);
      }
    }
  }

  const shadowObserved = new WeakSet();
  let mo = null;

  function scanShadowTrees(scope) {
    const found = [];
    const walk = (node) => {
      const kids = node.children || [];
      for (let i = 0; i < kids.length; i++) {
        const el = kids[i];
        if (el.shadowRoot) {
          found.push(el.shadowRoot);
          walk(el.shadowRoot);
        }
        walk(el);
      }
    };
    try { walk(scope); } catch (e) {}
    return found;
  }

  function observeShadow(root) {
    if (!mo || !root || shadowObserved.has(root)) return;
    shadowObserved.add(root);
    try {
      mo.observe(root, {
        childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: TRANSLATE_ATTRS.concat(['value']),
      });
    } catch (e) {}
  }

  function scan(root) {
    if (typeof document === 'undefined') return;
    const scope = (root && (root.nodeType === 1 || root.nodeType === 11)) ? root : document.body;
    if (!scope || !scope.isConnected) return;
    const pending = new Map();
    collectTextUnits(scope, pending);
    collectAttrUnits(scope, pending);
    const shadows = scanShadowTrees(scope);
    for (const sr of shadows) {
      observeShadow(sr);
      collectTextUnits(sr, pending);
      collectAttrUnits(sr, pending);
    }
    for (const [el, units] of pending) scheduleUnits(el, units);
  }

  /* ============================================================
   * 8. 动态监听与 SPA 路由同步
   * ============================================================ */
  const dirtyRoots = new Set();
  let dirtyTimer = null;

  function markDirty(el) {
    if (!el || (el.nodeType !== 1 && el.nodeType !== 11) || !el.isConnected) return;
    dirtyRoots.add(el);
    if (dirtyTimer) return;
    dirtyTimer = setTimeout(() => {
      dirtyTimer = null;
      const roots = [...dirtyRoots];
      dirtyRoots.clear();
      for (const r of roots) {
        if (r.isConnected) scan(r);
      }
    }, 100);
  }

  /* ============================================================
   * 9. 就地翻译按钮（README / 关于简介 / Issue·PR 正文，无刷新切换）
   * ============================================================ */
  const TOGGLE_CSS = `
    [data-zh-toggle]{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:4px;
      margin-left:8px;padding:1px 8px;border:1px solid rgba(31,35,40,.15);border-radius:6px;
      font-size:12px;line-height:20px;font-weight:500;color:#57606a;background:rgba(175,184,193,.1);vertical-align:middle;
      transition:background .12s,border-color .12s,color .12s;white-space:nowrap;}
    [data-zh-toggle]:hover{background:rgba(175,184,193,.25);border-color:rgba(31,35,40,.25);color:#24292f;}
    [data-zh-toggle][data-on]{background:#ddf4ff;border-color:#54aeff;color:#0969da;}
    [data-zh-toggle][data-loading]{opacity:.7;cursor:wait;}
    #zh-toast{position:fixed;right:20px;bottom:20px;z-index:2147483647;padding:8px 14px;border-radius:8px;
      font-size:12px;line-height:1.4;color:#fff;background:rgba(31,35,40,.92);box-shadow:0 4px 14px rgba(0,0,0,.22);
      pointer-events:none;transition:opacity .2s;}
    @media (prefers-color-scheme:dark){
      [data-zh-toggle]{color:#adbac7;border-color:rgba(205,217,229,.2);background:rgba(205,217,229,.08);}
      [data-zh-toggle]:hover{background:rgba(205,217,229,.2);color:#cdd9e5;border-color:rgba(205,217,229,.35);}
      [data-zh-toggle][data-on]{background:rgba(56,139,253,.2);border-color:#388bfd;color:#79c0ff;}
      #zh-toast{background:rgba(48,54,61,.95);border:1px solid rgba(240,246,252,.15);}
    }`;

  let toastTimer = null;
  function showToast(msg) {
    if (typeof document === 'undefined' || !document.body) return;
    ensureToggleStyle();
    let el = document.getElementById('zh-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'zh-toast';
      el.setAttribute('data-zh-skip', '');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (el) el.style.opacity = '0';
    }, 2000);
  }

  function ensureToggleStyle() {
    if (document.getElementById('zh-toggle-style')) return;
    const st = document.createElement('style');
    st.id = 'zh-toggle-style';
    st.textContent = TOGGLE_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function makeToggle(kind, label) {
    const on = !!pageState[kind];
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-zh-toggle', kind);
    b.setAttribute('data-zh-skip', '');
    b.title = on ? '点击还原为原文' : '点击翻译为中文';
    if (on) b.setAttribute('data-on', '');
    b.textContent = (on ? '✓ ' : '') + label;
    return b;
  }

  function syncToggleButtons() {
    document.querySelectorAll('[data-zh-toggle]').forEach((b) => {
      const k = b.getAttribute('data-zh-toggle');
      const want = !!pageState[k];
      const baseLabel = b.textContent.replace(/^✓\s*/, '').replace(/\s*…$/, '');
      b.removeAttribute('data-loading');
      b.title = want ? '点击还原为原文' : '点击翻译为中文';
      if (want) {
        b.setAttribute('data-on', '');
        b.textContent = '✓ ' + baseLabel;
      } else {
        b.removeAttribute('data-on');
        b.textContent = baseLabel;
      }
    });
  }

  function restoreNodeText(node) {
    if (nodeOriginalText.has(node)) {
      node.nodeValue = nodeOriginalText.get(node);
      processedText.delete(node);
      onlineTextNodes.delete(node);
      return true;
    }
    const cur = (node.nodeValue || '').trim();
    if (cur && zhToEn.has(cur)) {
      node.nodeValue = (node.nodeValue || '').replace(cur, zhToEn.get(cur));
      processedText.delete(node);
      onlineTextNodes.delete(node);
      return true;
    }
    return false;
  }

  function restoreOnlineTranslations() {
    try {
      for (const node of [...onlineTextNodes]) {
        if (node && node.isConnected) restoreNodeText(node);
        else onlineTextNodes.delete(node);
      }
      for (const el of [...onlineAttrEls]) {
        if (!el || !el.isConnected) { onlineAttrEls.delete(el); continue; }
        const origMap = attrOriginalMap.get(el);
        if (origMap) {
          for (const [attr, origVal] of origMap) {
            el.setAttribute(attr, origVal);
            if (el.__zhAttrs) el.__zhAttrs.delete(attr);
          }
        }
        onlineAttrEls.delete(el);
      }
    } catch (e) {}
  }

  function zoneSelectorFor(kind) {
    if (kind === 'readme') return README_SELECTORS;
    if (kind === 'issue') return ISSUE_SELECTORS;
    return REPO_DESC_SELECTORS;
  }

  function collectZoneNodes(scopes) {
    const items = [];
    for (const scope of scopes) {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const p = node.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          if (p.closest && p.closest('pre, code, kbd, samp, var, script, style, .blob-code, .highlight, [data-zh-toggle], [data-zh-skip]')) {
            return NodeFilter.FILTER_REJECT;
          }
          return (node.nodeValue || '').trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
      let n;
      while ((n = walker.nextNode())) {
        items.push({ node: n, text: (n.nodeValue || '').trim() });
      }
    }
    return items;
  }

  async function translateZone(kind) {
    const scopeSel = zoneSelectorFor(kind);
    const scopes = dedupeScopes([...document.querySelectorAll(scopeSel)]);
    if (!scopes.length) return;

    const on = !!pageState[kind];
    const items = collectZoneNodes(scopes);

    if (!on) {
      for (const it of items) restoreNodeText(it.node);
      scopes.forEach((sc) => sc.removeAttribute('data-zh-done'));
      syncToggleButtons();
      return;
    }

    if (zoneBusy[kind]) return;
    const mySeq = zoneSeq[kind];
    zoneBusy[kind] = true;
    const btn = document.querySelector(`[data-zh-toggle="${kind}"]`);
    if (btn) btn.setAttribute('data-loading', '1');

    try {
      const todo = [];
      for (const it of items) {
        if (!pageState[kind] || zoneSeq[kind] !== mySeq) break;
        const u = { kind: 'text', node: it.node };
        const hit = dictLookup(it.text) || patternTranslate(it.text);
        if (hit) { applyUnit(u, hit, false); processedText.add(it.node); continue; }
        const p = it.node.parentElement;
        const isHeadingOrLabel = p && p.closest && p.closest('h1,h2,h3,h4,h5,h6,strong,b,th') && !p.closest('a') && /^[A-Z][A-Za-z-]+:?$/.test(it.text);
        if (!isTranslatable(it.text) || (!/\s/.test(it.text) && !isHeadingOrLabel)) continue;
        if (cache.has(it.text)) { applyUnit(u, cache.get(it.text), true); processedText.add(it.node); continue; }
        todo.push(it);
      }

      if (todo.length && CFG.online) {
        for (let i = 0; i < todo.length; i += CFG.batchItems) {
          if (!pageState[kind] || zoneSeq[kind] !== mySeq) break;
          const slice = todo.slice(i, i + CFG.batchItems);
          const send = slice.map((it) => it.text.replace(/\s*\n+\s*/g, ' '));
          const res = await translateTexts(send);
          if (!res || !pageState[kind] || zoneSeq[kind] !== mySeq) continue;
          slice.forEach((it, idx) => {
            const zh = (res[idx] || '').trim();
            if (zh && containsCJK(zh)) {
              zhToEn.set(zh, it.text);
              cache.set(it.text, zh);
              if (it.node.isConnected) {
                applyUnit({ kind: 'text', node: it.node }, zh, true);
                processedText.add(it.node);
              } else {
                applyByText(it.text.replace(/\s+/g, ' ').trim(), zh);
              }
            }
          });
          saveCache();
          if (CFG.apiDelay) await sleep(CFG.apiDelay);
        }
      }
      if (pageState[kind] && zoneSeq[kind] === mySeq) {
        scopes.forEach((sc) => sc.setAttribute('data-zh-done', kind));
      }
    } finally {
      zoneBusy[kind] = false;
      syncToggleButtons();
    }
  }

  function onToggleClick(e) {
    const b = e.target && e.target.closest && e.target.closest('[data-zh-toggle]');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const kind = b.getAttribute('data-zh-toggle');
    const next = !pageState[kind];
    pageState[kind] = next;
    zoneSeq[kind] += 1;
    ssSet(kind, next);
    syncToggleButtons();
    translateZone(kind);
  }

  const README_TITLE_RE = /^(README|Readme|readme|自述文件|说明文件|readme\s*文件)$/i;
  function findReadmeNav() {
    const repoFilesNav = document.querySelector('nav[aria-label="Repository files"]');
    if (repoFilesNav) return repoFilesNav;
    const items = document.querySelectorAll('a, li, span');
    for (const el of items) {
      if (el.hasAttribute('data-zh-toggle')) continue;
      if (el.closest('.markdown-body')) continue;
      if (el.closest(ABOUT_SECTION_SEL)) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!README_TITLE_RE.test(t) || t.length > 20) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height === 0 || r.height > 60) continue;
      const nav = el.closest('nav') || el.closest('[class*="UnderlineWrapper"]');
      if (nav) return nav;
    }
    return null;
  }

  function findAboutHeading() {
    const nodes = document.querySelectorAll('h2');
    for (const el of nodes) {
      if (!el.closest(ABOUT_SECTION_SEL)) continue;
      const clone = el.cloneNode(true);
      clone.querySelectorAll('[data-zh-toggle]').forEach((x) => x.remove());
      const own = (clone.textContent || '').replace(/\s+/g, ' ').trim();
      if (own !== '关于' && own !== 'About') continue;
      const r = el.getBoundingClientRect();
      if (r.width > 10 && r.height > 0 && r.height <= 48) return el;
    }
    return null;
  }

  function findIssueHeader() {
    if (!/\/(issues|pull|discussions)\/\d+/.test(location.pathname)) return null;
    const sels = [
      '[data-testid="issue-body"] [class*="activityHeaderWrapper"]',
      '[class*="IssueBodyHeaderContainer"] [class*="activityHeader"]',
      '[data-testid="issue-body"] [class*="IssueBodyHeaderContainer"]',
      '[class*="IssueBodyHeaderContainer"]',
      '[class*="IssueBodyHeader"]',
      '[data-testid="issue-body"] [data-testid="comment-header"]',
      '.timeline-comment-header',
      '[data-testid="comment-header"]',
    ];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function placeToggles() {
    if (typeof document === 'undefined' || !document.body) return;
    refreshPageState();
    ensureToggleStyle();

    document.querySelectorAll('[data-zh-toggle="about"]').forEach((b) => {
      const p = b.parentElement;
      if (!p || p.tagName !== 'H2') { try { b.remove(); } catch (e) {} }
    });

    ['readme', 'about', 'issue'].forEach((k) => {
      if (!pageState[k]) return;
      if (document.querySelector(`[data-zh-done="${k}"]`)) return;
      translateZone(k);
    });

    // 1) README 就地翻译按钮
    if (!document.querySelector('[data-zh-toggle="readme"]') && document.querySelector(README_SELECTORS)) {
      const nav = findReadmeNav();
      if (nav) {
        const b = makeToggle('readme', '翻译 README');
        b.style.marginRight = '8px';
        const headerBox = nav.closest('[class*="Box_3"]') || nav.parentElement;
        const outlineBtn = headerBox ? headerBox.querySelector('button[aria-label="Outline"], button[aria-label="大纲"]') : null;
        if (outlineBtn && outlineBtn.parentElement) {
          outlineBtn.parentElement.insertBefore(b, outlineBtn);
        } else if (headerBox && headerBox !== nav && getComputedStyle(headerBox).display.includes('flex')) {
          b.style.marginLeft = 'auto';
          headerBox.appendChild(b);
        } else {
          b.style.marginLeft = 'auto';
          nav.appendChild(b);
        }
      }
    }

    // 2) Issue / PR / Discussion 正文与评论就地翻译按钮
    if (!document.querySelector('[data-zh-toggle="issue"]') && document.querySelector(ISSUE_SELECTORS)) {
      const head = findIssueHeader();
      if (head && !head.querySelector('[data-zh-toggle]')) {
        const b = makeToggle('issue', '翻译正文');
        b.style.marginLeft = 'auto';
        b.style.marginRight = '8px';
        b.style.alignSelf = 'center';
        const anchor = head.querySelector(
          '.timeline-comment-actions, [data-testid="comment-header-right-side-items"], '
          + '[data-testid="issue-body-header-actions"], [class*="ActionsContainer"], '
          + '[class*="actions" i], [class*="ellipsis"], button[aria-label*="More"], '
          + 'button[aria-label*="更多"], button[aria-label*="Actions"], [data-testid*="more"]'
        );
        if (anchor && anchor.parentElement === head) {
          head.insertBefore(b, anchor);
        } else if (anchor && anchor.parentElement) {
          b.style.marginLeft = 'auto';
          anchor.parentElement.insertBefore(b, anchor);
        } else {
          head.appendChild(b);
        }
      }
    }

    // 3) 关于简介就地翻译按钮
    if (!document.querySelector('[data-zh-toggle="about"]') && document.querySelector(REPO_DESC_SELECTORS)) {
      const h = findAboutHeading();
      if (h) {
        const b = makeToggle('about', '翻译简介');
        b.style.marginLeft = '8px';
        b.style.flexShrink = '0';
        h.appendChild(b);
      }
    }

    syncToggleButtons();
  }

  /* ============================================================
   * 10. 菜单与快捷键
   * ============================================================ */
  function toggleOnlineMode() {
    CFG.online = !CFG.online;
    saveOnline();
    if (!CFG.online) {
      restoreOnlineTranslations();
      showToast('在线翻译已关闭（仅使用本地词表）');
    } else {
      scan(document.body);
      showToast('在线翻译已开启');
    }
  }

  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;

    GM_registerMenuCommand('① 切换在线翻译（开关 / Alt+T）', toggleOnlineMode);
    GM_registerMenuCommand('② 立即重新扫描翻译当前页', () => {
      scan(document.body);
      placeToggles();
      showToast('已重新扫描当前页面');
    });
    GM_registerMenuCommand('③ 清空翻译缓存', () => {
      cache.clear();
      writeStore(CACHE_KEY, '');
      showToast('已清空本地翻译缓存');
    });
    GM_registerMenuCommand('④ 设置百度翻译（APPID / 密钥）', () => {
      const appid = window.prompt('百度翻译 APPID（留空清除）：', (creds.baidu && creds.baidu.appid) || '');
      if (appid === null) return;
      const key = window.prompt('百度翻译密钥（留空清除）：', (creds.baidu && creds.baidu.key) || '');
      if (key === null) return;
      creds.baidu = { appid: appid.trim(), key: key.trim() };
      saveCreds();
      showToast('已保存百度翻译配置');
    });
    GM_registerMenuCommand('⑤ 设置腾讯云机器翻译（SecretId / SecretKey）', () => {
      const sid = window.prompt('腾讯云 SecretId（留空清除）：', (creds.tencentcloud && creds.tencentcloud.secretId) || '');
      if (sid === null) return;
      const skey = window.prompt('腾讯云 SecretKey（留空清除）：', (creds.tencentcloud && creds.tencentcloud.secretKey) || '');
      if (skey === null) return;
      const region = window.prompt('地域 Region（默认 ap-guangzhou）：', (creds.tencentcloud && creds.tencentcloud.region) || 'ap-guangzhou');
      if (region === null) return;
      creds.tencentcloud = { secretId: sid.trim(), secretKey: skey.trim(), region: (region || 'ap-guangzhou').trim() };
      saveCreds();
      showToast('已保存腾讯云翻译配置');
    });
    GM_registerMenuCommand('⑥ 设置 AI 翻译（DeepSeek / 硅基流动 / 智谱 GLM）', () => {
      const base = window.prompt(
        '接口地址 Base URL（DeepSeek：https://api.deepseek.com ；硅基流动：https://api.siliconflow.cn/v1 ；智谱：https://open.bigmodel.cn/api/paas/v4）',
        (creds.ai && creds.ai.baseUrl) || 'https://api.deepseek.com'
      );
      if (base === null) return;
      const key = window.prompt('API Key：', (creds.ai && creds.ai.apiKey) || '');
      if (key === null) return;
      const model = window.prompt('模型名（如 deepseek-chat、Qwen/Qwen2.5-7B-Instruct 或 glm-4-flash）：', (creds.ai && creds.ai.model) || 'deepseek-chat');
      if (model === null) return;
      creds.ai = { baseUrl: base.trim(), apiKey: key.trim(), model: model.trim() };
      saveCreds();
      showToast('已保存 AI 翻译配置');
    });
    GM_registerMenuCommand('⑦ 清空所有自定义翻译密钥', () => {
      creds.baidu = null;
      creds.tencentcloud = null;
      creds.ai = null;
      saveCreds();
      showToast('已清空所有自定义翻译密钥');
    });
  }

  /* ============================================================
   * 11. 搜索输入守护 & 启动流程
   * ============================================================ */
  function installSearchGuard() {
    const lastTyped = new WeakMap();
    function isSearchInput(el) {
      if (!el || el.tagName !== 'INPUT') return false;
      const t = (el.getAttribute('type') || '').toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase();
      const tid = el.getAttribute('data-testid') || '';
      const name = el.getAttribute('name') || '';
      return t === 'search' || role === 'combobox' || role === 'searchbox'
        || /search|query/i.test(tid) || name === 'q';
    }

    document.addEventListener('input', (e) => {
      const el = e.target;
      if (!isSearchInput(el)) return;
      const v = el.value || '';
      if (!/[\u4e00-\u9fff]/.test(v)) lastTyped.set(el, v);
    }, true);

    setInterval(() => {
      document.querySelectorAll('input').forEach((el) => {
        if (!isSearchInput(el)) return;
        const v = el.value || '';
        if (v && /[\u4e00-\u9fff]/.test(v)) {
          const orig = lastTyped.get(el);
          if (typeof orig === 'string' && orig !== v) {
            try {
              el.value = orig;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            } catch (e) {}
          }
        }
      });
    }, 600);
  }

  function applyTitleTranslation() {
    try {
      const next = translateTitleText(document.title);
      if (next && next !== document.title) document.title = next;
    } catch (e) {}
  }

  function handleRouteChange() {
    refreshPageState();
    applyTitleTranslation();
    placeToggles();
    if (document.body) markDirty(document.body);
    [250, 800].forEach((ms) => {
      setTimeout(() => {
        applyTitleTranslation();
        placeToggles();
        if (document.body) scan(document.body);
      }, ms);
    });
  }

  function installSpaHooks() {
    ['turbo:load', 'pjax:end', 'turbo:render', 'turbo:frame-render'].forEach((ev) => {
      document.addEventListener(ev, handleRouteChange, true);
    });
    window.addEventListener('popstate', handleRouteChange);

    for (const method of ['pushState', 'replaceState']) {
      const orig = history[method];
      if (typeof orig !== 'function') continue;
      history[method] = function () {
        const ret = orig.apply(this, arguments);
        setTimeout(handleRouteChange, 50);
        return ret;
      };
    }

    if (document.head && typeof MutationObserver === 'function') {
      new MutationObserver(applyTitleTranslation).observe(document.head, {
        childList: true, characterData: true, subtree: true,
      });
    }
  }

  function startObserver() {
    if (mo || typeof MutationObserver !== 'function' || !document.body) return;
    mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          m.addedNodes.forEach((n) => {
            if (n.nodeType === 1) markDirty(n);
            else if (n.nodeType === 3 && n.parentElement) markDirty(n.parentElement);
          });
        } else if (m.type === 'characterData') {
          if (processedText.has(m.target)) processedText.delete(m.target);
          if (m.target.parentElement) markDirty(m.target.parentElement);
        } else if (m.type === 'attributes') {
          if (m.target.__zhAttrs && m.attributeName) m.target.__zhAttrs.delete(m.attributeName);
          markDirty(m.target);
        }
      }
    });
    mo.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: TRANSLATE_ATTRS.concat(['value']),
    });
  }

  function boot() {
    if (typeof document === 'undefined' || !document.body) return;
    refreshPageState();
    applyTitleTranslation();
    registerMenu();
    startObserver();
    installSpaHooks();
    installSearchGuard();

    document.addEventListener('click', onToggleClick, true);
    document.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 't' || e.key === 'T')) toggleOnlineMode();
    });

    placeToggles();
    scan(document.body);

    [200, 600, 1300, 2500].forEach((ms) => {
      setTimeout(() => {
        placeToggles();
        scan(document.body);
      }, ms);
    });

    let scrollTimer = null;
    window.addEventListener('scroll', () => {
      if (scrollTimer) return;
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        scan(document.body);
      }, 700);
    }, { passive: true });

    setInterval(placeToggles, 1500);
    setInterval(() => {
      if (document.visibilityState === 'visible') scan(document.body);
    }, CFG.fullRescanMs);
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading' || !document.body) {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
    console.log('%c[GitHub中文化增强版] 已加载', 'color:#2ea44f;font-weight:bold');
  }

  return {
    CFG,
    RAW_DICT,
    PATTERN_RULES,
    PROVIDERS,
    REPO_DESC_SELECTORS,
    README_SELECTORS,
    ISSUE_SELECTORS,
    normalizeKey,
    dictLookup,
    dictHasExact,
    cnDate,
    cnDateTime,
    translateRelative,
    patternTranslate,
    translateTitleText,
    repoKey,
    isTranslatable,
    isIdentifierLike,
    shouldSkip,
    shouldSkipAttr,
    dedupeScopes,
    parseYoudaoMobileHtml,
    translateTexts,
    providerState,
    providerAvailable,
    providerFail,
    providerOk,
  };
});
