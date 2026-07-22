// ==UserScript==
// @name         知乎 · Paper Press 阅读模式
// @namespace    https://github.com/hahapkpk/tools
// @version      2.4.0
// @description  知乎专栏 / 问答页 → 杂志风格沉浸阅读：悬浮目录 · 代码高亮 · 图片灯箱 · 深色模式 · 阅读进度 · 字号/宽度调节 · 代码复制 · 键盘快捷键
// @author       hahapkpk
// @match        https://zhuanlan.zhihu.com/p/*
// @match        https://www.zhihu.com/question/*
// @grant        GM_addStyle
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/zhihu-paper-press.user.js
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/zhihu-paper-press.user.js
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // 页面类型识别（专栏 / 问答页），非目标页面直接退出
  // ═══════════════════════════════════════════════════════════════

  var PAGE = (function () {
    var h = location.href;
    if (/^https?:\/\/zhuanlan\.zhihu\.com\/p\//.test(h)) return 'column';
    if (/^https?:\/\/www\.zhihu\.com\/question\//.test(h)) return 'question';
    return 'other';
  })();
  if (PAGE === 'other') return;

  // 内容容器与标题选择器随页面类型切换
  var SCOPE = PAGE === 'question' ? '.ztext' : '.Post-RichTextContainer';
  var TITLE_SEL = PAGE === 'question' ? '.QuestionHeader-title' : '.Post-Title';

  // ═══════════════════════════════════════════════════════════════
  // 设计令牌
  // ═══════════════════════════════════════════════════════════════

  var THEMES = {
    light: {
      shell: '#d8cfb8',
      surface: '#efe7d6',
      surface2: '#f5f0e5',
      surface3: '#ece4d2',
      text: '#1a1714',
      text2: '#2c2823',
      textMute: '#6b685e',
      textFaint: '#98948a',
      rule: '#d4ccba',
      accent: '#ff4a2b',
      accentSoft: 'rgba(255, 74, 43, 0.10)',
      accentGlow: 'rgba(255, 74, 43, 0.30)',
      cardShadow: '0 1px 0 #d4ccba, 0 24px 60px rgba(40,30,15,0.12)',
      grain: true,
      vignette: 'none',
    },
    dark: {
      shell: '#0d0b09',
      surface: '#1a1714',
      surface2: '#231f1a',
      surface3: '#2c2823',
      text: '#f5f0e5',
      text2: '#ece4d2',
      textMute: '#7a7972',
      textFaint: '#4a443e',
      rule: '#2f2a25',
      accent: '#ff4a2b',
      accentSoft: 'rgba(255, 74, 43, 0.14)',
      accentGlow: 'rgba(255, 74, 43, 0.55)',
      cardShadow: '0 1px 0 #2f2a25, 0 24px 60px rgba(0,0,0,0.3)',
      grain: false,
      vignette: 'radial-gradient(circle at 50% 60%, transparent 0%, rgba(0,0,0,0.45) 100%)',
    }
  };

  var FONTS = {
    displayCN: '"Noto Serif SC", "Source Han Serif SC", "SimSun", serif',
    displayEN: '"Playfair Display", "Instrument Serif", Georgia, serif',
    body: '"Manrope", "Inter", "Noto Sans SC", "PingFang SC", sans-serif',
    mono: '"JetBrains Mono", "SF Mono", "Consolas", monospace',
  };

  var PAPER_GRAIN = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280">' +
    '<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" stitchTiles="stitch"/></filter>' +
    '<rect width="100%" height="100%" filter="url(#n)" opacity="0.12"/></svg>'
  );

  // ═══════════════════════════════════════════════════════════════
  // 用户偏好（修复：无痕模式下 localStorage 可能抛异常）
  // ═══════════════════════════════════════════════════════════════

  var PREF = {
    get mode() {
      try { return localStorage.getItem('pp_mode') || 'light'; }
      catch (e) { return 'light'; }
    },
    set mode(v) {
      try { localStorage.setItem('pp_mode', v); } catch (e) {}
    },
    get fontSize() {
      try {
        var v = parseInt(localStorage.getItem('pp_fontSize'));
        return isNaN(v) ? 18 : v;
      } catch (e) { return 18; }
    },
    set fontSize(v) {
      try { localStorage.setItem('pp_fontSize', v); } catch (e) {}
    },
    get width() {
      try { return localStorage.getItem('pp_width') || 'standard'; }
      catch (e) { return 'standard'; }
    },
    set width(v) {
      try { localStorage.setItem('pp_width', v); } catch (e) {}
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // 工具函数
  // ═══════════════════════════════════════════════════════════════

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return (ctx || document).querySelectorAll(sel); }
  function on(el, ev, fn, opts) { el.addEventListener(ev, fn, opts); }

  // 优化：用 rAF 节流高频事件（滚动），避免每次 scroll 都同步执行布局读写
  function rafThrottle(fn) {
    var scheduled = false;
    return function () {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        fn();
      });
    };
  }

  // 优化：防抖，用于聚合知乎的异步渲染批次
  function debounce(fn, wait) {
    var timer = null;
    return function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fn, wait);
    };
  }

  // 修复：document-start 时 document.head 可能为 null
  function appendToHead(el) {
    if (document.head) {
      document.head.appendChild(el);
    } else {
      var obs = new MutationObserver(function () {
        if (document.head) {
          obs.disconnect();
          document.head.appendChild(el);
        }
      });
      obs.observe(document.documentElement, { childList: true });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Google Fonts
  // ═══════════════════════════════════════════════════════════════

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
    appendToHead(link);
  }

  // ═══════════════════════════════════════════════════════════════
  // CSS 构建
  // ═══════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════
  // 问答页专属样式（选择器仅命中问答页，不影响专栏页）
  // ═══════════════════════════════════════════════════════════════

  function QUESTION_CSS(T) {
    var grain = T.grain
      ? '.QuestionHeader::before,.List-item::before{content:"";position:absolute;inset:0;z-index:0;background-image:url(' + PAPER_GRAIN + ');background-size:280px 280px;mix-blend-mode:multiply;opacity:0.28;pointer-events:none;border-radius:inherit}.QuestionHeader>*,.List-item>*{position:relative;z-index:1;}'
      : '';
    return [
      '/* ══ 知乎问答页 ══ */',
      /* 布局：隐藏右侧栏，主列居中成版心 */
      '.Question-main{display:block!important;max-width:none!important;padding:0!important;background:transparent!important;}',
      '.Question-mainColumn{width:100%!important;max-width:860px!important;margin:0 auto!important;padding:72px 40px 120px!important;box-sizing:border-box!important;float:none!important;transition:max-width 0.3s ease!important;}',
      '.Question-sideColumn,.QuestionHeader-side,.QuestionHeaderActions,.QuestionRelatedCard{display:none!important;}',
      /* 问题标题卡 */
      '.QuestionHeader{position:relative!important;background:' + T.surface + '!important;border-radius:4px!important;box-shadow:' + T.cardShadow + '!important;padding:48px 56px!important;margin-bottom:24px!important;border:none!important;}',
      '.QuestionHeader-content,.QuestionHeader-main{display:block!important;width:100%!important;}',
      '.QuestionHeader-title{font-family:' + FONTS.displayCN + '!important;font-weight:700!important;font-size:2rem!important;line-height:1.35!important;color:' + T.text + '!important;letter-spacing:-0.01em!important;margin:0 0 16px 0!important;}',
      '.QuestionRichText,.QuestionHeader-detail{font-family:' + FONTS.body + '!important;color:' + T.textMute + '!important;line-height:1.7!important;}',
      '.QuestionHeader-footer,.NumberBoard{background:transparent!important;border-top:1px solid ' + T.rule + '!important;margin-top:16px!important;padding-top:12px!important;}',
      /* 回答列表标题栏 */
      '.List-header,.Card.ListShortcut,.QuestionAnswers-answers{background:transparent!important;box-shadow:none!important;border:none!important;}',
      '.List-headerText,.List-headerText span{font-family:' + FONTS.body + '!important;color:' + T.textMute + '!important;font-size:0.9rem!important;}',
      /* 单条回答卡片 */
      '.List-item{position:relative!important;background:' + T.surface + '!important;border-radius:4px!important;box-shadow:' + T.cardShadow + '!important;padding:40px 48px!important;margin-bottom:24px!important;border:none!important;overflow:hidden!important;}',
      '.AnswerItem,.ContentItem,.AnswerCard,.RichContent,.RichContent-inner{background:transparent!important;box-shadow:none!important;border:none!important;}',
      grain,
      /* 作者信息 */
      '.List-item .AuthorInfo{margin-bottom:18px!important;padding-bottom:0!important;}',
      '.List-item .AuthorInfo-avatar{width:40px!important;height:40px!important;border-radius:50%!important;border:2px solid ' + T.rule + '!important;}',
      '.List-item .AuthorInfo-name,.List-item .AuthorInfo-name a{font-family:' + FONTS.body + '!important;font-weight:600!important;font-size:0.95rem!important;color:' + T.text + '!important;}',
      '.List-item .AuthorInfo-detail,.List-item .AuthorInfo-badgeText{font-family:' + FONTS.body + '!important;font-size:0.8rem!important;color:' + T.textMute + '!important;}',
      /* 回答正文 .ztext */
      '.ztext{font-family:' + FONTS.body + '!important;line-height:1.85!important;color:' + T.text2 + '!important;}',
      '.ztext p{font-family:' + FONTS.body + '!important;line-height:1.85!important;color:' + T.text2 + '!important;margin:0 0 1.4em 0!important;text-align:justify!important;}',
      '.ztext h2{font-family:' + FONTS.displayCN + '!important;font-weight:700!important;line-height:1.4!important;color:' + T.text + '!important;margin:2em 0 0.7em 0!important;padding-top:8px!important;border-top:1px solid ' + T.rule + '!important;}',
      '.ztext h3{font-family:' + FONTS.displayCN + '!important;font-weight:600!important;line-height:1.4!important;color:' + T.text + '!important;margin:1.6em 0 0.5em 0!important;}',
      '.ztext h4,.ztext h5,.ztext h6{font-family:' + FONTS.body + '!important;font-weight:600!important;color:' + T.text + '!important;margin:1.3em 0 0.4em 0!important;}',
      '.ztext ul,.ztext ol{padding-left:1.5em!important;margin:0 0 1.4em 0!important;}',
      '.ztext li{font-family:' + FONTS.body + '!important;line-height:1.75!important;color:' + T.text2 + '!important;margin-bottom:0.4em!important;}',
      '.ztext li::marker{color:' + T.accent + '!important;}',
      '.ztext a{color:' + T.accent + '!important;text-decoration:none!important;border-bottom:1px solid ' + T.accentSoft + '!important;transition:border-color 0.3s ease!important;}',
      '.ztext a:hover{border-bottom-color:' + T.accent + '!important;background:' + T.accentSoft + '!important;}',
      '.ztext code:not(pre code){font-family:' + FONTS.mono + '!important;font-size:0.88em!important;background:' + T.surface3 + '!important;color:' + T.accent + '!important;padding:2px 7px!important;border-radius:3px!important;border:1px solid ' + T.rule + '!important;}',
      '.ztext pre{position:relative!important;background:' + T.surface3 + '!important;border:1px solid ' + T.rule + '!important;border-radius:4px!important;padding:24px 28px!important;margin:1.6em 0!important;overflow-x:auto!important;box-shadow:0 1px 0 ' + T.rule + '!important;}',
      '.ztext pre code{font-family:' + FONTS.mono + '!important;line-height:1.7!important;background:transparent!important;color:' + T.text2 + '!important;padding:0!important;border:none!important;white-space:pre!important;}',
      '.ztext pre:hover .pp-copy-btn{opacity:1;}',
      '.ztext blockquote{font-family:' + FONTS.displayEN + '!important;font-style:italic!important;line-height:1.7!important;color:' + T.textMute + '!important;border-left:3px solid ' + T.accent + '!important;padding:12px 0 12px 24px!important;margin:1.6em 0!important;background:' + T.surface2 + '!important;border-radius:0 4px 4px 0!important;}',
      '.ztext figure{margin:1.6em auto!important;max-width:100%!important;cursor:zoom-in!important;}',
      '.ztext figure img,.ztext img{max-width:100%!important;height:auto!important;border-radius:4px!important;box-shadow:0 1px 0 ' + T.rule + ',0 8px 24px rgba(40,30,15,0.08)!important;cursor:zoom-in!important;}',
      '.ztext figure figcaption{font-family:' + FONTS.body + '!important;font-size:0.85rem!important;color:' + T.textFaint + '!important;text-align:center!important;margin-top:10px!important;}',
      '.ztext hr{border:none!important;border-top:1px solid ' + T.rule + '!important;margin:2em 0!important;}',
      '.ztext strong{font-weight:600!important;color:' + T.text + '!important;}',
      '.ztext em{font-family:' + FONTS.displayEN + '!important;font-style:italic!important;}',
      /* 隐藏杂项：举报 / 操作栏 / 页脚 / 大家都在搜 / 相关 / 关于 */
      '.ContentItem-actions,.RichContent-actions,.QuestionAnswers-answerButton,.AnswerAdd{display:none!important;}',
      '[class*="Footer"],.AppFooter,.Pc-word,.Pc-feedOpr{display:none!important;}',
      /* 宽度模式 */
      '.pp-width-narrow .Question-mainColumn{max-width:620px!important;}',
      '.pp-width-wide .Question-mainColumn{max-width:1100px!important;}',
      /* 响应式 */
      '@media (max-width:768px){.Question-mainColumn{padding:24px 16px 80px!important;max-width:100%!important;}.QuestionHeader{padding:28px 22px!important;}.List-item{padding:28px 22px!important;border-radius:2px!important;}.QuestionHeader-title{font-size:1.5rem!important;}}',
      '@media (min-width:769px) and (max-width:1024px){.Question-mainColumn{padding:48px 24px 100px!important;max-width:720px!important;}.QuestionHeader{padding:40px 36px!important;}.List-item{padding:32px 36px!important;}}',
    ].join('\n');
  }

  function buildCSS(mode) {
    var T = THEMES[mode];
    var grainCSS = T.grain
      ? '.Post-Main.Post-NormalMain::before{content:"";position:absolute;inset:0;z-index:0;background-image:url(' + PAPER_GRAIN + ');background-size:280px 280px;mix-blend-mode:multiply;opacity:0.30;pointer-events:none;border-radius:inherit}'
      : '.Post-Main.Post-NormalMain::before{display:none}';

    var vignetteCSS = T.vignette !== 'none'
      ? '.Post-Main.Post-NormalMain::after{content:"";position:absolute;inset:0;z-index:0;background:' + T.vignette + ';pointer-events:none;border-radius:inherit}'
      : '.Post-Main.Post-NormalMain::after{display:none}';

    var css = [
      '/* ── 基础 ── */',
      'body{background:' + T.shell + '!important;overflow-x:hidden;}',

      '/* ── 隐藏 ── */',
      '.AppHeader,header.AppHeader,[class*="AppHeader"],',
      '.Sticky,[class*="Sticky"],.Sticky--holder,.RichContent-actions,',
      '.Post-Row-Content-right,',
      '.Catalog,.Catalog-content,.Catalog-Title,.isCatalogV2,',
      '[class*="ColumnPageHeader"],[class*="PageHeader"],',
      '.Post-content>div:first-child,',
      '[class*="css-fnjj4z"],[class*="css-19jsr79"],[class*="css-moxmo5"],',
      '[class*="Comments"],[class*="Recommended"],',
      '[class*="FloatingButton"],[class*="BackToTop"],',
      '[class*="signFlow"],[class*="SignFlow"],',
      '[class*="Modal"],[class*="modal"],[class*="overlay"],[class*="mask"],',
      '[class*="ad-"],[class*="ecommerce"],',
      '.SearchBar,[class*="Notification"],[class*="profileMenu"],',
      '[class*="Creator"],.FollowButton,.LoadingBar,',
      '.Post-actions,[class*="VoteButton"],[class*="ArticleActions"]',
      '{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;}',

      '/* ── 主容器 ── */',
      '.App-main{max-width:none!important;padding:0!important;background:transparent!important;}',
      '.Post-content{background:transparent!important;padding:0!important;max-width:none!important;}',
      '.Post-Row-Content{display:block!important;max-width:none!important;}',
      '.Post-Row-Content-left{float:none!important;width:100%!important;max-width:860px!important;margin:0 auto!important;padding:80px 40px 120px!important;box-sizing:border-box!important;transition:max-width 0.3s ease!important;}',
      '.Post-Row-Content-left-article{width:100%!important;}',

      '/* ── 文章卡片 ── */',
      '.Post-Main.Post-NormalMain{position:relative!important;background:' + T.surface + '!important;border-radius:4px!important;box-shadow:' + T.cardShadow + '!important;padding:64px 72px!important;box-sizing:border-box!important;max-width:none!important;}',
      '.Post-Main.Post-NormalMain>*{position:relative;z-index:1;}',
      grainCSS,
      vignetteCSS,

      '/* ── 标题 ── */',
      '.Post-Header{margin-bottom:32px!important;padding-bottom:28px!important;border-bottom:1px solid ' + T.rule + '!important;}',
      '.Post-Title{font-family:' + FONTS.displayCN + '!important;font-weight:700!important;line-height:1.35!important;color:' + T.text + '!important;letter-spacing:-0.01em!important;margin:0 0 20px 0!important;word-break:break-word!important;}',

      '/* ── 作者 ── */',
      '.Post-Author{display:flex!important;align-items:center!important;gap:12px!important;}',
      '.AuthorInfo-avatar{width:40px!important;height:40px!important;border-radius:50%!important;border:2px solid ' + T.rule + '!important;}',
      '.AuthorInfo-name{font-family:' + FONTS.body + '!important;font-weight:600!important;font-size:0.95rem!important;color:' + T.text + '!important;}',
      '.AuthorInfo-detail,.AuthorInfo-badgeText{font-family:' + FONTS.body + '!important;font-size:0.8rem!important;color:' + T.textMute + '!important;}',

      '/* ── 正文 ── */',
      '.Post-RichTextContainer{font-family:' + FONTS.body + '!important;line-height:1.85!important;color:' + T.text2 + '!important;}',
      '.Post-RichTextContainer p{font-family:' + FONTS.body + '!important;line-height:1.85!important;color:' + T.text2 + '!important;margin:0 0 1.5em 0!important;text-align:justify!important;}',
      '.Post-RichTextContainer h2{font-family:' + FONTS.displayCN + '!important;font-weight:700!important;line-height:1.4!important;color:' + T.text + '!important;margin:2.5em 0 0.8em 0!important;padding-top:8px!important;border-top:1px solid ' + T.rule + '!important;}',
      '.Post-RichTextContainer h3{font-family:' + FONTS.displayCN + '!important;font-weight:600!important;line-height:1.4!important;color:' + T.text + '!important;margin:2em 0 0.6em 0!important;}',
      '.Post-RichTextContainer h4,.Post-RichTextContainer h5,.Post-RichTextContainer h6{font-family:' + FONTS.body + '!important;font-weight:600!important;color:' + T.text + '!important;margin:1.5em 0 0.5em 0!important;}',
      '.Post-RichTextContainer ul,.Post-RichTextContainer ol{padding-left:1.5em!important;margin:0 0 1.5em 0!important;}',
      '.Post-RichTextContainer li{font-family:' + FONTS.body + '!important;line-height:1.75!important;color:' + T.text2 + '!important;margin-bottom:0.4em!important;}',
      '.Post-RichTextContainer li::marker{color:' + T.accent + '!important;}',
      '.Post-RichTextContainer a{color:' + T.accent + '!important;text-decoration:none!important;border-bottom:1px solid ' + T.accentSoft + '!important;transition:border-color 0.3s ease!important;}',
      '.Post-RichTextContainer a:hover{border-bottom-color:' + T.accent + '!important;background:' + T.accentSoft + '!important;}',

      '/* 行内代码 */',
      '.Post-RichTextContainer code:not(pre code){font-family:' + FONTS.mono + '!important;font-size:0.88em!important;background:' + T.surface3 + '!important;color:' + T.accent + '!important;padding:2px 7px!important;border-radius:3px!important;border:1px solid ' + T.rule + '!important;}',

      '/* 代码块 */',
      '.Post-RichTextContainer pre{position:relative!important;background:' + T.surface3 + '!important;border:1px solid ' + T.rule + '!important;border-radius:4px!important;padding:24px 28px!important;margin:1.8em 0!important;overflow-x:auto!important;box-shadow:0 1px 0 ' + T.rule + '!important;}',
      '.Post-RichTextContainer pre code{font-family:' + FONTS.mono + '!important;line-height:1.7!important;background:transparent!important;color:' + T.text2 + '!important;padding:0!important;border:none!important;white-space:pre!important;}',
      '.pp-copy-btn{position:absolute;top:10px;right:14px;padding:4px 12px;font-family:' + FONTS.body + ';font-size:12px;background:' + T.surface2 + ';color:' + T.textMute + ';border:1px solid ' + T.rule + ';border-radius:4px;cursor:pointer;opacity:0;transition:opacity 0.2s;}',
      '.Post-RichTextContainer pre:hover .pp-copy-btn{opacity:1;}',
      '.pp-copy-btn:hover{background:' + T.accentSoft + ';color:' + T.accent + ';border-color:' + T.accent + ';}',
      '.pp-copy-btn.copied{background:' + T.accent + ';color:#fff;border-color:' + T.accent + ';}',

      '/* 引用块 */',
      '.Post-RichTextContainer blockquote{font-family:' + FONTS.displayEN + '!important;font-style:italic!important;line-height:1.7!important;color:' + T.textMute + '!important;border-left:3px solid ' + T.accent + '!important;padding:12px 0 12px 24px!important;margin:2em 0!important;background:' + T.surface2 + '!important;border-radius:0 4px 4px 0!important;}',

      '/* 图片 */',
      '.Post-RichTextContainer figure{margin:2em auto!important;max-width:100%!important;cursor:zoom-in!important;}',
      '.Post-RichTextContainer figure img,.Post-RichTextContainer img{max-width:100%!important;height:auto!important;border-radius:4px!important;box-shadow:0 1px 0 ' + T.rule + ',0 8px 24px rgba(40,30,15,0.08)!important;}',
      '.Post-RichTextContainer figure figcaption{font-family:' + FONTS.body + '!important;font-size:0.85rem!important;color:' + T.textFaint + '!important;text-align:center!important;margin-top:10px!important;}',

      '.Post-RichTextContainer hr{border:none!important;border-top:1px solid ' + T.rule + '!important;margin:3em 0!important;}',
      '.Post-RichTextContainer strong{font-weight:600!important;color:' + T.text + '!important;}',
      '.Post-RichTextContainer em{font-family:' + FONTS.displayEN + '!important;font-style:italic!important;}',

      '.Post-Main>div:last-child{margin-top:48px!important;padding-top:28px!important;border-top:1px solid ' + T.rule + '!important;text-align:center!important;}',

      '::selection{background:' + T.accentSoft + '!important;color:' + T.text + '!important;}',

      '::-webkit-scrollbar{width:8px;}',
      '::-webkit-scrollbar-track{background:' + T.surface + ';}',
      '::-webkit-scrollbar-thumb{background:' + T.rule + ';border-radius:4px;}',
      '::-webkit-scrollbar-thumb:hover{background:' + T.textFaint + ';}',

      '/* ── 阅读进度条 ── */',
      '#pp-progress{position:fixed;top:0;left:0;height:3px;background:' + T.accent + ';z-index:99999;transition:width 0.1s linear;border-radius:0 2px 2px 0;}',

      '/* ── 侧边按钮面板 ── */',
      '#pp-panel{position:fixed;right:16px;top:50%;transform:translateY(-50%);z-index:9997;display:flex;flex-direction:column;gap:3px;font-family:' + FONTS.body + ';padding:6px;background:' + T.surface + ';border:1px solid ' + T.rule + ';border-radius:10px;box-shadow:0 2px 12px rgba(0,0,0,0.06);}',
      '#pp-panel button{display:block;width:40px;height:32px;padding:0 2px;border:1px solid transparent;background:transparent;color:' + T.textMute + ';cursor:pointer;font-size:11px;font-weight:500;text-align:center;border-radius:6px;transition:all 0.2s;line-height:1.2;font-family:' + FONTS.body + ';}',
      '#pp-panel button:hover{background:' + T.accentSoft + ';color:' + T.accent + ';border-color:' + T.accent + ';}',
      '#pp-panel .pp-panel-label{font-size:8px;display:block;color:' + T.textFaint + ';margin-top:1px;}',
      '#pp-panel button:hover .pp-panel-label{color:' + T.accent + ';}',
      '#pp-panel .pp-sep{height:1px;background:' + T.rule + ';margin:2px 0;}',

      '/* ── 图片灯箱 ── */',
      '#pp-lightbox{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;cursor:zoom-out;opacity:0;pointer-events:none;transition:opacity 0.25s;}',
      '#pp-lightbox.open{opacity:1;pointer-events:auto;}',
      '#pp-lightbox img{max-width:92vw;max-height:92vh;border-radius:4px;box-shadow:0 40px 120px rgba(0,0,0,0.5);}',
      '#pp-lightbox .pp-lb-close{position:fixed;top:20px;right:24px;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;font-size:22px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s;}',
      '#pp-lightbox .pp-lb-close:hover{background:rgba(255,255,255,0.2);}',

      '/* ── 悬浮目录 TOC ── */',
      '#pp-toc{position:fixed;left:16px;top:50%;transform:translateY(-50%);z-index:9998;font-family:' + FONTS.body + ';max-width:180px;max-height:80vh;overflow-y:auto;padding:8px 0;border-radius:8px;background:' + T.surface + ';border:1px solid ' + T.rule + ';box-shadow:0 2px 12px rgba(0,0,0,0.06);}',
      '#pp-toc::-webkit-scrollbar{width:4px;}',
      '#pp-toc::-webkit-scrollbar-thumb{background:' + T.rule + ';border-radius:2px;}',
      '#pp-toc a{display:block;padding:4px 14px;font-size:12px;color:' + T.textFaint + ';text-decoration:none!important;border-left:2px solid transparent;transition:all 0.2s;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#pp-toc a:hover,#pp-toc a.active{color:' + T.accent + ';border-left-color:' + T.accent + ';}',
      '#pp-toc a.pp-toc-h2{padding-left:14px;font-weight:500;}',
      '#pp-toc a.pp-toc-h3{padding-left:24px;font-size:11px;}',

      '/* 宽度模式 */',
      '.pp-width-narrow .Post-Row-Content-left{max-width:620px!important;}',
      '.pp-width-wide .Post-Row-Content-left{max-width:1100px!important;}',

      '/* ── 响应式 ── */',
      '@media (max-width:768px){',
      '.Post-Row-Content-left{padding:24px 16px 80px!important;max-width:100%!important;}',
      '.Post-Main.Post-NormalMain{padding:32px 20px!important;border-radius:2px!important;}',
      '.Post-Title{line-height:1.35!important;}',
      '.Post-RichTextContainer h2{line-height:1.4!important;}',
      '.Post-RichTextContainer h3{line-height:1.4!important;}',
      '.Post-RichTextContainer pre{padding:16px!important;}',
      '#pp-toc{display:none!important;}',
      '#pp-panel{position:fixed;top:auto;bottom:16px;right:16px;left:auto;flex-direction:row;justify-content:center;gap:2px;z-index:9997;padding:6px;background:' + T.surface + ';border:1px solid ' + T.rule + ';border-radius:10px;}',
      '#pp-panel button{flex:0;width:44px;height:32px;padding:0;border-radius:6px;font-size:11px;border:none;background:transparent;}',
      '#pp-panel .pp-panel-label{display:none;}',
      '}',

      '@media (min-width:769px) and (max-width:1024px){',
      '.Post-Row-Content-left{padding:48px 24px 100px!important;max-width:700px!important;}',
      '.Post-Main.Post-NormalMain{padding:48px 40px!important;}',
      '#pp-toc{max-width:160px;}',
      '}',

      '@media print{',
      'body{background:white!important;}',
      '.Post-Main.Post-NormalMain::before,.Post-Main.Post-NormalMain::after{display:none!important;}',
      '.Post-Main.Post-NormalMain{box-shadow:none!important;background:white!important;}',
      '#pp-progress,#pp-panel,#pp-toc,#pp-lightbox{display:none!important;}',
      '}',
    ];

    // 问答页追加专属样式（仅在问答页注入）
    if (PAGE === 'question') css.push(QUESTION_CSS(T));

    return css.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════
  // UI 组件构建
  // ═══════════════════════════════════════════════════════════════

  // 优化：进度条 + TOC 高亮共用一个 rAF 节流的滚动处理器，避免重复监听与抖动
  var _progressBar = null;
  var _tocHeadings = [];
  var _tocLinks = [];
  var _scrollBound = false;

  var onScroll = rafThrottle(function () {
    // 阅读进度
    if (_progressBar) {
      var scrollTop = window.scrollY || document.documentElement.scrollTop;
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      var pct = docHeight > 0 ? Math.min(100, (scrollTop / docHeight) * 100) : 0;
      _progressBar.style.width = pct + '%';
    }
    // 目录当前项高亮
    if (_tocLinks.length) {
      var active = null;
      for (var i = 0; i < _tocHeadings.length; i++) {
        if (_tocHeadings[i].getBoundingClientRect().top <= 120) active = _tocHeadings[i].id;
      }
      for (var j = 0; j < _tocLinks.length; j++) {
        _tocLinks[j].classList.toggle('active', _tocLinks[j].getAttribute('href') === '#' + active);
      }
    }
  });

  function bindScroll() {
    if (_scrollBound) return;
    _scrollBound = true;
    on(window, 'scroll', onScroll, { passive: true });
  }

  // ── 阅读进度条 ──
  function buildProgressBar() {
    var bar = document.createElement('div');
    bar.id = 'pp-progress';
    document.body.appendChild(bar);
    _progressBar = bar;
  }

  // ── 侧边按钮面板 ──
  function buildPanel() {
    var panel = document.createElement('div');
    panel.id = 'pp-panel';

    function btn(text, sub, onClick, title) {
      var b = document.createElement('button');
      b.textContent = text;
      if (title) b.title = title;
      if (sub) {
        var label = document.createElement('span');
        label.className = 'pp-panel-label';
        label.textContent = sub;
        b.appendChild(label);
      }
      on(b, 'click', onClick);
      return b;
    }

    var widthLabels = [
      { key: 'narrow', text: '窄', sub: '620', title: '窄栏 (620px)' },
      { key: 'standard', text: '标', sub: '860', title: '标准 (860px)' },
      { key: 'wide', text: '宽', sub: '1100', title: '宽栏 (1100px)' },
    ];

    widthLabels.forEach(function (wl) {
      var b = btn(wl.text, wl.sub, function () {
        PREF.width = wl.key;
        applyWidth();
        $$('#pp-panel .pp-width-btn').forEach(function (bb) { bb.style.borderColor = ''; bb.style.color = ''; });
        b.style.borderColor = T('accent');
        b.style.color = T('accent');
      }, wl.title);
      b.className = 'pp-width-btn';
      if (PREF.width === wl.key) {
        b.style.borderColor = T('accent');
        b.style.color = T('accent');
      }
      panel.appendChild(b);
    });

    var sep = document.createElement('div');
    sep.className = 'pp-sep';
    panel.appendChild(sep);

    var fsDown = btn('A-', '缩小', function () {
      var cur = PREF.fontSize;
      if (cur > 14) { PREF.fontSize = cur - 2; applyFontSize(); }
    }, '缩小字号 ( - )');
    var fsUp = btn('A+', '放大', function () {
      var cur = PREF.fontSize;
      if (cur < 24) { PREF.fontSize = cur + 2; applyFontSize(); }
    }, '放大字号 ( + )');
    panel.appendChild(fsDown);
    panel.appendChild(fsUp);

    var sep2 = document.createElement('div');
    sep2.className = 'pp-sep';
    panel.appendChild(sep2);

    var dmBtn = btn(PREF.mode === 'dark' ? '☀' : '☾', null, function () {
      var next = PREF.mode === 'light' ? 'dark' : 'light';
      PREF.mode = next;
      applyTheme(next);
    }, PREF.mode === 'dark' ? '切换日间模式 ( d )' : '切换夜间模式 ( d )');
    panel.appendChild(dmBtn);

    var sep3 = document.createElement('div');
    sep3.className = 'pp-sep';
    panel.appendChild(sep3);

    var topBtn = btn('▲', null, function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, '回到顶部');
    panel.appendChild(topBtn);

    document.body.appendChild(panel);
    panel._dmBtn = dmBtn;
    return panel;
  }

  function T(key) {
    var mode = PREF.mode;
    return THEMES[mode][key];
  }

  // ── 图片灯箱 ──
  function buildLightbox() {
    var lb = document.createElement('div');
    lb.id = 'pp-lightbox';
    lb.innerHTML = '<img src="" alt=""><button class="pp-lb-close">×</button>';
    document.body.appendChild(lb);

    var img = $('img', lb);
    var closeBtn = $('.pp-lb-close', lb);

    function open(src) {
      img.src = src;
      lb.classList.add('open');
      // 修复：加上 pp-lightbox-open 标记，让 cleanupDOM 的守卫真正生效，避免背景漏滚
      document.body.classList.add('pp-lightbox-open');
      document.body.style.overflow = 'hidden';
    }
    function close() {
      lb.classList.remove('open');
      document.body.classList.remove('pp-lightbox-open');
      document.body.style.overflow = '';
      img.src = '';
    }
    on(lb, 'click', function (e) { if (e.target !== img) close(); });
    on(closeBtn, 'click', close);
    on(document, 'keydown', function (e) { if (e.key === 'Escape') close(); });

    return { open: open, close: close };
  }

  // ── 代码块复制按钮 ──
  // 修复：只复制 code 标签内容，避免把按钮文字也复制进去
  function addCopyButtons() {
    $$(SCOPE + ' pre').forEach(function (pre) {
      if ($('.pp-copy-btn', pre)) return;
      var code = pre.querySelector('code');
      if (!code) return; // 没有 code 标签就不加按钮

      var btn = document.createElement('button');
      btn.className = 'pp-copy-btn';
      btn.textContent = '复制';
      on(btn, 'click', function (e) {
        e.stopPropagation();
        navigator.clipboard.writeText(code.textContent || '').then(function () {
          btn.textContent = '已复制';
          btn.classList.add('copied');
          setTimeout(function () { btn.textContent = '复制'; btn.classList.remove('copied'); }, 2000);
        }).catch(function () {
          btn.textContent = '失败';
          setTimeout(function () { btn.textContent = '复制'; }, 1500);
        });
      });
      pre.appendChild(btn);
    });
  }

  // ── 悬浮目录 TOC ──
  function buildTOC() {
    var existing = $('#pp-toc');
    if (existing) existing.remove();

    var toc = document.createElement('nav');
    toc.id = 'pp-toc';

    // 问答页：以「各回答作者」作为目录条目
    if (PAGE === 'question') {
      buildQuestionTOC(toc);
      return;
    }

    var headings = $$('.Post-RichTextContainer h2, .Post-RichTextContainer h3');
    if (headings.length < 2) {
      toc.style.display = 'none';
      document.body.appendChild(toc);
      _tocHeadings = [];
      _tocLinks = [];
      return;
    }

    headings.forEach(function (h) {
      // 优化：已有 id 就复用，避免每次重建 TOC 都刷新锚点
      if (!h.id) h.id = 'pp-' + Math.random().toString(36).slice(2, 8);
      var a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = h.textContent.trim();
      a.className = h.tagName === 'H3' ? 'pp-toc-h3' : 'pp-toc-h2';
      a.title = a.textContent;
      on(a, 'click', function (e) {
        e.preventDefault();
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      toc.appendChild(a);
    });

    document.body.appendChild(toc);

    // 优化：把当前标题/链接存入模块级状态，交给统一的 onScroll 处理，不再重复绑定监听器
    _tocHeadings = Array.prototype.slice.call(headings);
    _tocLinks = Array.prototype.slice.call($$('#pp-toc a'));
  }

  // 问答页目录：每条回答一个锚点，标注作者名
  function buildQuestionTOC(toc) {
    var items = $$('.Question-mainColumn .List-item, .Question-main .List-item');
    if (items.length < 2) {
      toc.style.display = 'none';
      document.body.appendChild(toc);
      _tocHeadings = [];
      _tocLinks = [];
      return;
    }

    var heads = [];
    Array.prototype.forEach.call(items, function (item, idx) {
      if (!item.id) item.id = 'pp-ans-' + idx;
      var nameEl = item.querySelector('.AuthorInfo-name');
      var name = nameEl ? nameEl.textContent.trim() : '';
      var a = document.createElement('a');
      a.href = '#' + item.id;
      a.textContent = name || ('回答 ' + (idx + 1));
      a.className = 'pp-toc-h2';
      a.title = a.textContent;
      on(a, 'click', function (e) {
        e.preventDefault();
        item.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      toc.appendChild(a);
      heads.push(item);
    });

    document.body.appendChild(toc);
    _tocHeadings = heads;
    _tocLinks = Array.prototype.slice.call($$('#pp-toc a'));
  }

  // ═══════════════════════════════════════════════════════════════
  // 主题 / 字号 / 宽度 应用
  // ═══════════════════════════════════════════════════════════════

  var currentStyleEl = null;
  var _panelRef = null;
  var _fontSizeOverride = null;

  function rebuildPanel() {
    if (_panelRef) {
      _panelRef.remove();
      _panelRef = null;
    }
    if (document.body) {
      _panelRef = buildPanel();
    }
  }

  function applyTheme(mode) {
    if (currentStyleEl) currentStyleEl.remove();
    var style = document.createElement('style');
    style.id = 'pp-theme-style';
    style.textContent = buildCSS(mode);
    appendToHead(style);
    currentStyleEl = style;

    var T = THEMES[mode];
    if (document.body) {
      document.body.style.background = T.shell;
    }

    // 修复：暗色模式下切换代码高亮配色
    applyHighlightTheme(mode);

    rebuildPanel();
  }

  // 修复：字号调节需要同时影响标题和列表，而不仅仅是正文段落
  function applyFontSize() {
    var fs = PREF.fontSize;
    var ratio = fs / 16;
    $$(SCOPE).forEach(function (article) {
      article.style.fontSize = (ratio * 1.1).toFixed(2) + 'rem';
    });

    // 动态覆盖标题/列表的字号，让它们随用户设置一起缩放
    if (_fontSizeOverride) _fontSizeOverride.remove();
    _fontSizeOverride = document.createElement('style');
    _fontSizeOverride.id = 'pp-fontsize-override';
    _fontSizeOverride.textContent = [
      '.Post-Title{font-size:' + (ratio * 2.6).toFixed(2) + 'rem!important;}',
      '.QuestionHeader-title{font-size:' + (ratio * 1.9).toFixed(2) + 'rem!important;}',
      '.Post-RichTextContainer h2,.ztext h2{font-size:' + (ratio * 1.65).toFixed(2) + 'rem!important;}',
      '.Post-RichTextContainer h3,.ztext h3{font-size:' + (ratio * 1.35).toFixed(2) + 'rem!important;}',
      '.Post-RichTextContainer h4,.Post-RichTextContainer h5,.Post-RichTextContainer h6,.ztext h4,.ztext h5,.ztext h6{font-size:' + (ratio * 1.15).toFixed(2) + 'rem!important;}',
      '.Post-RichTextContainer li,.ztext li{font-size:' + (ratio * 1.05).toFixed(2) + 'rem!important;}',
      '.Post-RichTextContainer blockquote,.ztext blockquote{font-size:' + (ratio * 1.15).toFixed(2) + 'rem!important;}',
      '.Post-RichTextContainer pre code,.ztext pre code{font-size:' + (ratio * 0.9).toFixed(2) + 'rem!important;}',
    ].join('\n');
    appendToHead(_fontSizeOverride);
  }

  function applyWidth() {
    document.body.classList.remove('pp-width-narrow', 'pp-width-wide');
    if (PREF.width === 'narrow') document.body.classList.add('pp-width-narrow');
    if (PREF.width === 'wide') document.body.classList.add('pp-width-wide');
  }

  // ═══════════════════════════════════════════════════════════════
  // 代码高亮 (highlight.js)
  // ═══════════════════════════════════════════════════════════════

  var _hljsThemeEl = null;

  function loadHighlightJS(cb) {
    // 根据当前模式加载对应的高亮主题
    var isDark = PREF.mode === 'dark';
    var themeUrl = isDark
      ? 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css'
      : 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = themeUrl;
    appendToHead(link);

    var script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js';
    script.onload = function () {
      applyHighlightTheme(PREF.mode);
      if (cb) cb();
    };
    appendToHead(script);
  }

  // 修复：暗色模式下覆盖 hljs 颜色以适配我们的主题
  function applyHighlightTheme(mode) {
    if (_hljsThemeEl) _hljsThemeEl.remove();
    _hljsThemeEl = document.createElement('style');
    _hljsThemeEl.id = 'pp-hljs-override';

    if (mode === 'dark') {
      _hljsThemeEl.textContent = [
        '.hljs{background:transparent!important;color:inherit!important;padding:0!important;}',
        '.hljs-keyword,.hljs-selector-tag,.hljs-type{color:#ff7b72;}',
        '.hljs-string,.hljs-addition{color:#a5d6ff;}',
        '.hljs-comment,.hljs-quote{color:#8b949e;font-style:italic;}',
        '.hljs-number,.hljs-literal{color:#79c0ff;}',
        '.hljs-built_in,.hljs-builtin-name{color:#d2a8ff;}',
        '.hljs-attr,.hljs-attribute{color:#79c0ff;}',
        '.hljs-title,.hljs-section{color:#d2a8ff;}',
        '.hljs-meta{color:#79c0ff;}',
        '.hljs-function .hljs-title{color:#d2a8ff;}',
      ].join('\n');
    } else {
      _hljsThemeEl.textContent = [
        '.hljs{background:transparent!important;color:inherit!important;padding:0!important;}',
        '.hljs-keyword,.hljs-selector-tag,.hljs-type{color:#d73a49;}',
        '.hljs-string,.hljs-addition{color:#0a6e3a;}',
        '.hljs-comment,.hljs-quote{color:#6a737d;font-style:italic;}',
        '.hljs-number,.hljs-literal{color:#005cc5;}',
        '.hljs-built_in,.hljs-builtin-name{color:#6f42c1;}',
        '.hljs-attr,.hljs-attribute{color:#005cc5;}',
        '.hljs-title,.hljs-section{color:#6f42c1;}',
        '.hljs-meta{color:#005cc5;}',
        '.hljs-function .hljs-title{color:#6f42c1;}',
      ].join('\n');
    }
    appendToHead(_hljsThemeEl);
  }

  // 优化：跳过已高亮的代码块，避免重复高亮与 hljs 的 "已高亮" 警告
  function highlightAll() {
    if (!window.hljs) return;
    $$(SCOPE + ' pre code').forEach(function (block) {
      if (block.dataset.ppHighlighted === '1') return;
      try { window.hljs.highlightElement(block); } catch (e) {}
      block.dataset.ppHighlighted = '1';
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 键盘快捷键
  // ═══════════════════════════════════════════════════════════════

  function bindKeyboard() {
    on(document, 'keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      var tag = (t && t.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (t && t.isContentEditable)) return;

      switch (e.key) {
        case '-':
        case '_':
          if (PREF.fontSize > 14) { PREF.fontSize = PREF.fontSize - 2; applyFontSize(); }
          break;
        case '=':
        case '+':
          if (PREF.fontSize < 24) { PREF.fontSize = PREF.fontSize + 2; applyFontSize(); }
          break;
        case 'd':
        case 'D':
          var next = PREF.mode === 'light' ? 'dark' : 'light';
          PREF.mode = next;
          applyTheme(next);
          break;
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // DOM 清理
  // ═══════════════════════════════════════════════════════════════

  function cleanupDOM() {
    function removeJunk() {
      var sels = [
        '[class*="Modal"]','[class*="modal"]','[class*="overlay"]',
        '[class*="mask"]','[class*="signFlow"]','[class*="SignFlow"]',
        '[class*="login"]',
      ];
      sels.forEach(function (sel) {
        $$(sel).forEach(function (el) { el.remove(); });
      });
      $$('.Sticky--holder').forEach(function (el) { el.remove(); });
      // 修复：只在灯箱未打开时才恢复滚动
      if (!document.body.classList.contains('pp-lightbox-open')) {
        document.body.style.overflow = 'auto';
      }
    }

    // 修复：标题清理只移除知乎后缀，不盲目删除括号前缀
    var title = document.title;
    var cleaned = title.replace(/\s*-\s*知乎$/, '').replace(/\s*-\s*知乎专栏$/, '');
    if (cleaned !== title) document.title = cleaned;

    removeJunk();
    var obs = new MutationObserver(removeJunk);
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 15000);
  }

  // ═══════════════════════════════════════════════════════════════
  // 问答页杂项清理：举报 / 大家都在搜 / 相关帮助 / 关于（CSS 已处理主体，此处为动态兵底）
  // ═══════════════════════════════════════════════════════════════

  var JUNK_TEXTS = ['举报', '大家都在搜', '相关问题', '相关的帮助', '相关帮助', '关于', '关于知乎', '申请转载', '联系我们', '内容中心'];

  function pruneQuestionJunk() {
    // 隐藏侧栏/页脚/操作栏（包含大家都在搜、相关、关于、举报）
    ['.Question-sideColumn', '.QuestionHeader-side', '.ContentItem-actions',
      '.RichContent-actions', '.AppFooter', '[class*="Footer"]', '.Pc-word',
      '.QuestionAnswers-answerButton', '.AnswerAdd'].forEach(function (sel) {
      $$(sel).forEach(function (el) { el.style.display = 'none'; });
    });
    // 文本兵底：清除仍残留的小按钮/菜单项（举报/关于 等）
    $$('.Question-main button, .Question-main [role="menuitem"], .Question-main .Menu span').forEach(function (el) {
      var t = (el.textContent || '').trim();
      if (!t || t.length > 8) return;
      for (var i = 0; i < JUNK_TEXTS.length; i++) {
        if (t === JUNK_TEXTS[i]) { el.style.display = 'none'; return; }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 修复：用 MutationObserver 持续监听动态内容，替代 setTimeout 猜测
  // ═══════════════════════════════════════════════════════════════

  var _dynObserver = null;
  var _observerTarget = null;

  // 优化：处理期间先断开自身监听，避免我们自己的 DOM 写入再次触发 observer 造成重复处理
  function processDynamicContent() {
    if (_dynObserver) _dynObserver.disconnect();

    addCopyButtons();
    highlightAll();
    bindImages();
    if (PAGE === 'question') pruneQuestionJunk();

    // 重建目录（专栏：新增标题；问答：新加载的回答）
    buildTOC();

    if (_dynObserver && _observerTarget) {
      _dynObserver.observe(_observerTarget, { childList: true, subtree: true });
    }
  }

  function observeDynamicContent() {
    var container = PAGE === 'question'
      ? ($('.Question-mainColumn') || $('.Question-main') || $('.ListShortcut'))
      : $('.Post-RichTextContainer');
    if (!container) return;
    _observerTarget = container;

    // 优化：防抖聚合知乎的连续异步渲染，减少无谓的多次处理
    var schedule = debounce(processDynamicContent, 250);

    _dynObserver = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].type === 'childList' && mutations[i].addedNodes.length > 0) {
          schedule();
          return;
        }
      }
    });

    _dynObserver.observe(container, { childList: true, subtree: true });
  }

  function bindImages() {
    $$(SCOPE + ' figure img, ' + SCOPE + ' img').forEach(function (img) {
      if (img._ppBound) return;
      img._ppBound = true;
      on(img, 'click', function () {
        var src = img.getAttribute('data-original') || img.src;
        if (src && !src.startsWith('data:')) {
          lb.open(src);
        }
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 入口
  // ═══════════════════════════════════════════════════════════════

  var lb; // 灯箱实例，需要在 bindImages 中使用

  function init() {
    loadFonts();

    var mode = PREF.mode;
    applyTheme(mode);

    function onReady() {
      cleanupDOM();

      buildProgressBar();
      _panelRef = buildPanel();
      lb = buildLightbox();

      // 优化：只绑定一次滚动监听，进度条 + TOC 高亮共用
      bindScroll();
      bindKeyboard();

      // 绑定图片点击 + 问答页杂项清理
      setTimeout(function () {
        bindImages();
        if (PAGE === 'question') pruneQuestionJunk();
      }, 400);
      if (PAGE === 'question') {
        setTimeout(pruneQuestionJunk, 1200);
        setTimeout(pruneQuestionJunk, 2500);
      }

      // 代码高亮
      loadHighlightJS(function () {
        addCopyButtons();
        highlightAll();
        setTimeout(function () { addCopyButtons(); highlightAll(); }, 1000);
      });

      // TOC
      setTimeout(function () {
        buildTOC();
        onScroll(); // 立即刷新一次进度条/目录高亮
      }, 500);

      // 应用偏好
      applyFontSize();
      applyWidth();

      // 修复：持续监听知乎的异步渲染
      observeDynamicContent();
    }

    if (document.readyState === 'loading') {
      on(document, 'DOMContentLoaded', onReady);
    } else {
      onReady();
    }
  }

  init();
})();
