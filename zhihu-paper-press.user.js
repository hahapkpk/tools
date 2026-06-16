// ==UserScript==
// @name         知乎 · Paper Press 阅读模式
// @namespace    https://github.com/hahapkpk/tools
// @version      1.0.0
// @description  将知乎专栏文章转换为 Editorial Paper 风格的沉浸式阅读体验 — 暖色奶油底 + 热橙强调色 + 纸纹质感
// @author       hahapkpk
// @match        https://zhuanlan.zhihu.com/p/*
// @match        https://www.zhihu.com/question/*
// @downloadURL https://raw.githubusercontent.com/hahapkpk/tools/main/zhihu-paper-press.user.js
// @updateURL   https://raw.githubusercontent.com/hahapkpk/tools/main/zhihu-paper-press.user.js
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ─── Paper-Press 设计令牌 (基于 garden-skills web-video-presentation themes/paper-press) ───
  const TOKENS = {
    shell:       '#d8cfb8',
    surface:     '#efe7d6',
    surface2:    '#f5f0e5',
    surface3:    '#ece4d2',
    text:        '#1a1714',
    text2:       '#2c2823',
    textMute:    '#6b685e',
    textFaint:   '#98948a',
    rule:        '#d4ccba',
    accent:      '#ff4a2b',
    accentSoft:  'rgba(255, 74, 43, 0.10)',
    accentGlow:  'rgba(255, 74, 43, 0.30)',

    fontDisplayCN: '"Noto Serif SC", "Source Han Serif SC", "SimSun", serif',
    fontDisplayEN: '"Playfair Display", "Instrument Serif", Georgia, "Times New Roman", serif',
    fontBody:      '"Manrope", "Inter", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
    fontMono:      '"JetBrains Mono", "SF Mono", "Fira Code", "Consolas", monospace',

    durBase:     '700ms',
    durSlow:     '1100ms',
    durCinematic:'1600ms',

    rCard:       '4px',
  };

  // ─── 纸纹 SVG data URI ───
  const PAPER_GRAIN = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280">' +
    '<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="3" seed="4"/>' +
    '<feColorMatrix values="0 0 0 0 0.6 0 0 0 0 0.55 0 0 0 0 0.45 0 0 0 0.18 0"/></filter>' +
    '<rect width="100%" height="100%" filter="url(#n)"/></svg>'
  );

  // ─── 加载 Google Fonts ───
  function loadFonts() {
    var fonts = [
      'Noto+Serif+SC:wght@400;500;700',
      'Playfair+Display:ital,wght@0,400;0,700;1,400;1,700',
      'Manrope:wght@400;500;600',
      'JetBrains+Mono:wght@400;500',
      'Noto+Sans+SC:wght@400;500;700',
      'Inter:opsz,wght@14..32,400;14..32,500',
    ];
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + fonts.join('&family=') + '&display=swap';
    document.head.appendChild(link);
  }

  // ─── 构建并注入 CSS ───
  function buildCSS() {
    var T = TOKENS;
    return [
      /* ── 基础重置 ── */
      'body.PostIndex-body, body { background-color:' + T.shell + ' !important; overflow-x:hidden; }',

      /* ── 隐藏不需要的元素 ── */
      /* 顶部导航 */
      '.AppHeader, header.AppHeader, [class*="AppHeader"],',
      /* 粘性元素 */
      '.Sticky, [class*="Sticky"], .Sticky--holder, .RichContent-actions,',
      /* 右侧栏 */
      '.Post-Row-Content-right,',
      /* 文章目录 */
      '.Catalog, .Catalog-content, .Catalog-Title, .isCatalogV2,',
      /* 专栏页头 */
      '[class*="ColumnPageHeader"], [class*="PageHeader"],',
      /* 装饰 / 空白元素 */
      '.Post-content > div:first-child,',
      '[class*="css-fnjj4z"], [class*="css-19jsr79"], [class*="css-moxmo5"],',
      /* 评论区 */
      '[class*="Comments"],',
      /* 推荐阅读 */
      '[class*="Recommended"],',
      /* 悬浮按钮 */
      '[class*="FloatingButton"], [class*="BackToTop"],',
      /* 登录弹窗 / 遮罩 */
      '[class*="signFlow"], [class*="SignFlow"],',
      '[class*="Modal"], [class*="modal"],',
      '[class*="overlay"], [class*="mask"],',
      /* 广告 */
      '[class*="ad-"], [class*="ecommerce"],',
      /* 搜索 / 通知 / 创作中心 */
      '.SearchBar,',
      '[class*="Notification"], [class*="profileMenu"],',
      '[class*="Creator"],',
      /* 关注按钮 */
      '.FollowButton,',
      /* 加载条 */
      '.LoadingBar,',
      /* 文章底部操作栏 */
      '.Post-actions, [class*="VoteButton"], [class*="ArticleActions"]',
      '{ display:none !important; visibility:hidden !important; opacity:0 !important; pointer-events:none !important; }',

      /* ── 主容器 ── */
      '.App-main { max-width:none !important; padding:0 !important; background:transparent !important; }',
      '.Post-content { background:transparent !important; padding:0 !important; max-width:none !important; }',
      '.Post-Row-Content { display:block !important; max-width:none !important; }',
      '.Post-Row-Content-left { float:none !important; width:100% !important; max-width:860px !important; margin:0 auto !important; padding:80px 32px 120px !important; box-sizing:border-box !important; }',
      '.Post-Row-Content-left-article { width:100% !important; }',

      /* ── 纸纹效果 + 文章卡片 ── */
      '.Post-Main.Post-NormalMain { position:relative !important; background:' + T.surface + ' !important; border-radius:' + T.rCard + ' !important; box-shadow:0 1px 0 ' + T.rule + ',0 24px 60px rgba(40,30,15,0.12) !important; padding:64px 72px !important; box-sizing:border-box !important; max-width:none !important; }',
      '.Post-Main.Post-NormalMain::before { content:""; position:absolute; inset:0; z-index:0; background-image:url(' + PAPER_GRAIN + '); background-size:280px 280px; mix-blend-mode:multiply; opacity:0.30; pointer-events:none; border-radius:inherit; }',
      '.Post-Main.Post-NormalMain > * { position:relative; z-index:1; }',

      /* ── 标题 ── */
      '.Post-Header { margin-bottom:32px !important; padding-bottom:28px !important; border-bottom:1px solid ' + T.rule + ' !important; }',
      '.Post-Title { font-family:' + T.fontDisplayCN + ' !important; font-weight:700 !important; font-size:2.6rem !important; line-height:1.35 !important; color:' + T.text + ' !important; letter-spacing:-0.01em !important; margin:0 0 20px 0 !important; word-break:break-word !important; }',

      /* ── 作者信息 ── */
      '.Post-Author { display:flex !important; align-items:center !important; gap:12px !important; }',
      '.AuthorInfo-avatar { width:40px !important; height:40px !important; border-radius:50% !important; border:2px solid ' + T.rule + ' !important; }',
      '.AuthorInfo-name { font-family:' + T.fontBody + ' !important; font-weight:600 !important; font-size:0.95rem !important; color:' + T.text + ' !important; }',
      '.AuthorInfo-detail, .AuthorInfo-badgeText { font-family:' + T.fontBody + ' !important; font-size:0.8rem !important; color:' + T.textMute + ' !important; }',

      /* ── 正文 ── */
      '.Post-RichTextContainer { font-family:' + T.fontBody + ' !important; font-size:1.1rem !important; line-height:1.85 !important; color:' + T.text2 + ' !important; }',
      '.Post-RichTextContainer p { font-family:' + T.fontBody + ' !important; font-size:1.1rem !important; line-height:1.85 !important; color:' + T.text2 + ' !important; margin:0 0 1.5em 0 !important; text-align:justify !important; }',
      '.Post-RichTextContainer h2 { font-family:' + T.fontDisplayCN + ' !important; font-weight:700 !important; font-size:1.65rem !important; line-height:1.4 !important; color:' + T.text + ' !important; margin:2.5em 0 0.8em 0 !important; padding-top:8px !important; border-top:1px solid ' + T.rule + ' !important; }',
      '.Post-RichTextContainer h3 { font-family:' + T.fontDisplayCN + ' !important; font-weight:600 !important; font-size:1.35rem !important; line-height:1.4 !important; color:' + T.text + ' !important; margin:2em 0 0.6em 0 !important; }',
      '.Post-RichTextContainer h4, .Post-RichTextContainer h5, .Post-RichTextContainer h6 { font-family:' + T.fontBody + ' !important; font-weight:600 !important; font-size:1.15rem !important; color:' + T.text + ' !important; margin:1.5em 0 0.5em 0 !important; }',

      '.Post-RichTextContainer ul, .Post-RichTextContainer ol { padding-left:1.5em !important; margin:0 0 1.5em 0 !important; }',
      '.Post-RichTextContainer li { font-family:' + T.fontBody + ' !important; font-size:1.05rem !important; line-height:1.75 !important; color:' + T.text2 + ' !important; margin-bottom:0.4em !important; }',
      '.Post-RichTextContainer li::marker { color:' + T.accent + ' !important; }',

      '.Post-RichTextContainer a { color:' + T.accent + ' !important; text-decoration:none !important; border-bottom:1px solid ' + T.accentSoft + ' !important; transition:border-color ' + T.durBase + ' ease !important; }',
      '.Post-RichTextContainer a:hover { border-bottom-color:' + T.accent + ' !important; background:' + T.accentSoft + ' !important; }',

      /* 行内代码 */
      '.Post-RichTextContainer code:not(pre code) { font-family:' + T.fontMono + ' !important; font-size:0.88em !important; background:' + T.surface3 + ' !important; color:' + T.accent + ' !important; padding:2px 7px !important; border-radius:3px !important; border:1px solid ' + T.rule + ' !important; }',

      /* 代码块 */
      '.Post-RichTextContainer pre { background:' + T.surface3 + ' !important; border:1px solid ' + T.rule + ' !important; border-radius:' + T.rCard + ' !important; padding:24px 28px !important; margin:1.8em 0 !important; overflow-x:auto !important; box-shadow:0 1px 0 ' + T.rule + ' !important; }',
      '.Post-RichTextContainer pre code { font-family:' + T.fontMono + ' !important; font-size:0.9rem !important; line-height:1.7 !important; background:transparent !important; color:' + T.text2 + ' !important; padding:0 !important; border:none !important; white-space:pre !important; }',

      /* 引用块 */
      '.Post-RichTextContainer blockquote { font-family:' + T.fontDisplayEN + ' !important; font-style:italic !important; font-size:1.15rem !important; line-height:1.7 !important; color:' + T.textMute + ' !important; border-left:3px solid ' + T.accent + ' !important; padding:12px 0 12px 24px !important; margin:2em 0 !important; background:' + T.surface2 + ' !important; border-radius:0 ' + T.rCard + ' ' + T.rCard + ' 0 !important; }',

      /* 图片 */
      '.Post-RichTextContainer figure { margin:2em auto !important; max-width:100% !important; }',
      '.Post-RichTextContainer figure img, .Post-RichTextContainer img { max-width:100% !important; height:auto !important; border-radius:' + T.rCard + ' !important; box-shadow:0 1px 0 ' + T.rule + ',0 8px 24px rgba(40,30,15,0.08) !important; }',
      '.Post-RichTextContainer figure figcaption { font-family:' + T.fontBody + ' !important; font-size:0.85rem !important; color:' + T.textFaint + ' !important; text-align:center !important; margin-top:10px !important; }',

      /* 分割线 */
      '.Post-RichTextContainer hr { border:none !important; border-top:1px solid ' + T.rule + ' !important; margin:3em 0 !important; }',

      '.Post-RichTextContainer strong { font-weight:600 !important; color:' + T.text + ' !important; }',
      '.Post-RichTextContainer em { font-family:' + T.fontDisplayEN + ' !important; font-style:italic !important; }',

      /* 底部操作栏 */
      '.Post-Main > div:last-child { margin-top:48px !important; padding-top:28px !important; border-top:1px solid ' + T.rule + ' !important; text-align:center !important; }',

      /* 选择文本 */
      '::selection { background:' + T.accentSoft + ' !important; color:' + T.text + ' !important; }',

      /* 滚动条 */
      '::-webkit-scrollbar { width:8px; }',
      '::-webkit-scrollbar-track { background:' + T.surface + '; }',
      '::-webkit-scrollbar-thumb { background:' + T.rule + '; border-radius:4px; }',
      '::-webkit-scrollbar-thumb:hover { background:' + T.textFaint + '; }',

      /* ── 响应式：移动端 ── */
      '@media (max-width:768px) {',
      '.Post-Row-Content-left { padding:24px 16px 80px !important; max-width:100% !important; }',
      '.Post-Main.Post-NormalMain { padding:32px 20px !important; border-radius:2px !important; }',
      '.Post-Title { font-size:1.65rem !important; }',
      '.Post-RichTextContainer { font-size:1rem !important; }',
      '.Post-RichTextContainer p { font-size:1rem !important; text-align:left !important; }',
      '.Post-RichTextContainer h2 { font-size:1.35rem !important; }',
      '.Post-RichTextContainer h3 { font-size:1.15rem !important; }',
      '.Post-RichTextContainer pre { padding:16px !important; }',
      '}',

      /* ── 响应式：平板 ── */
      '@media (min-width:769px) and (max-width:1024px) {',
      '.Post-Row-Content-left { padding:48px 24px 100px !important; max-width:700px !important; }',
      '.Post-Main.Post-NormalMain { padding:48px 40px !important; }',
      '.Post-Title { font-size:2.2rem !important; }',
      '}',

      /* 打印 */
      '@media print {',
      'body { background:white !important; }',
      '.Post-Main.Post-NormalMain::before { display:none !important; }',
      '.Post-Main.Post-NormalMain { box-shadow:none !important; background:white !important; }',
      '}',
    ].join('\n');
  }

  // ─── 清理 DOM（移除弹窗、遮罩等） ───
  function cleanupDOM() {
    var selectors = [
      '[class*="Modal"]',
      '[class*="modal"]',
      '[class*="overlay"]',
      '[class*="mask"]',
      '[class*="signFlow"]',
      '[class*="SignFlow"]',
      '[class*="login"]',
    ];

    function removeJunk() {
      selectors.forEach(function (sel) {
        var els = document.querySelectorAll(sel);
        for (var i = 0; i < els.length; i++) {
          els[i].remove();
        }
      });
      // 移除残留的 Sticky--holder 占位 div
      var holders = document.querySelectorAll('.Sticky--holder');
      for (var j = 0; j < holders.length; j++) {
        holders[j].remove();
      }
      document.body.style.overflow = 'auto';
    }

    // 清理页面标题（去掉通知数量）
    function cleanTitle() {
      var title = document.title;
      // 匹配知乎标题格式: "(数字 封私信 / 数字 条消息) 标题 - 知乎"
      var cleaned = title.replace(/^\([^)]*\)\s*/, '');
      cleaned = cleaned.replace(/\s*-\s*知乎$/, '');
      if (cleaned !== title) {
        document.title = cleaned;
      }
    }
    cleanTitle();

    // 首次清理
    removeJunk();

    // 监听后续出现的弹窗
    var observer = new MutationObserver(function () {
      removeJunk();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { observer.disconnect(); }, 15000);
  }

  // ─── 入口 ───
  function init() {
    loadFonts();

    var style = document.createElement('style');
    style.textContent = buildCSS();
    // 插入到 head 最前面，确保高优先级
    if (document.head) {
      document.head.insertBefore(style, document.head.firstChild);
    } else {
      document.addEventListener('DOMContentLoaded', function () {
        document.head.insertBefore(style, document.head.firstChild);
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', cleanupDOM);
    } else {
      cleanupDOM();
    }
  }

  init();
})();
