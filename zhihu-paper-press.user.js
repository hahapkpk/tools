// ==UserScript==
// @name         知乎 · Paper Press 阅读模式
// @namespace    https://github.com/hahapkpk/tools
// @version      2.7.0
// @description  知乎专栏 / 问答页 → 杂志风格沉浸阅读：悬浮目录 · 代码高亮 · 图片灯箱 · 深色模式(可跟随系统) · 阅读进度/位置记忆 · 字号/行距/宽度调节 · 代码复制/折叠 · 键盘快捷键 · 拖拽调宽 · 适配知乎新版布局 · CDN 多镜像兜底
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
      try { return localStorage.getItem('pp_mode') || 'auto'; }
      catch (e) { return 'auto'; }
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
    // [v2.7] 行距（倍数），范围 1.6 ~ 2.2
    get lineHeight() {
      try {
        var v = parseFloat(localStorage.getItem('pp_lineHeight'));
        return isNaN(v) ? 1.85 : v;
      } catch (e) { return 1.85; }
    },
    set lineHeight(v) {
      try { localStorage.setItem('pp_lineHeight', v); } catch (e) {}
    },
    get width() {
      try { return localStorage.getItem('pp_width') || 'standard'; }
      catch (e) { return 'standard'; }
    },
    set width(v) {
      try { localStorage.setItem('pp_width', v); } catch (e) {}
    },
    // [新增] 自定义宽度（像素），拖拽时持久化
    get customWidth() {
      try {
        var v = parseInt(localStorage.getItem('pp_customWidth'));
        return isNaN(v) ? 860 : v;
      } catch (e) { return 860; }
    },
    set customWidth(v) {
      try { localStorage.setItem('pp_customWidth', v); } catch (e) {}
    },
  };

  // ═══════════════════════════════════════════════════════════════
  // 工具函数
  // ═══════════════════════════════════════════════════════════════

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return (ctx || document).querySelectorAll(sel); }
  function on(el, ev, fn, opts) { el.addEventListener(ev, fn, opts); }

  // [v2.7] 解析实际主题模式：'auto' 时跟随系统
  function resolveMode() {
    var m = PREF.mode;
    if (m === 'auto') {
      try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
      catch (e) { return 'light'; }
    }
    return m === 'dark' ? 'dark' : 'light';
  }

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
  // Google Fonts（[v2.7] 多镜像兜底：境外字体服务不稳时切换镜像）
  // ═══════════════════════════════════════════════════════════════

  var FONT_HOSTS = [
    'https://fonts.googleapis.com',
    'https://fonts.loli.net',
    'https://fonts.font.im',
  ];

  function loadFonts() {
    var fonts = [
      'Noto+Serif+SC:wght@400;500;700',
      'Playfair+Display:ital,wght@0,400;0,700;1,400;1,700',
      'Manrope:wght@400;500;600',
      'JetBrains+Mono:wght@400;500',
      'Noto+Sans+SC:wght@400;500;700',
      'Inter:opsz,wght@14..32,400;14..32,500',
    ];
    var path = '/css2?family=' + fonts.join('&family=') + '&display=swap';
    var i = 0;
    function tryNext() {
      if (i >= FONT_HOSTS.length) return; // 全部失败：使用系统字体回退
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = FONT_HOSTS[i++] + path;
      link.onerror = function () { link.remove(); tryNext(); };
      appendToHead(link);
    }
    tryNext();
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
      /* 问题标题卡：与回答同宽居中，收紧上下留白 */
      '.QuestionHeader{position:relative!important;width:100%!important;max-width:860px!important;margin:0 auto 24px!important;box-sizing:border-box!important;background:' + T.surface + '!important;border-radius:4px!important;box-shadow:' + T.cardShadow + '!important;padding:36px 48px!important;border:none!important;}',
      '.QuestionHeader-content{display:block!important;width:100%!important;}',
      '.QuestionHeader-main{width:100%!important;padding:0!important;}',
      '.QuestionHeader-title{font-family:' + FONTS.displayCN + '!important;font-weight:700!important;font-size:1.9rem!important;line-height:1.3!important;color:' + T.text + '!important;letter-spacing:-0.01em!important;margin:0.4em 0 0.5em 0!important;}',
      '.QuestionRichText,.QuestionHeader-detail{font-family:' + FONTS.body + '!important;color:' + T.textMute + '!important;line-height:1.7!important;margin:0!important;}',
      /* 隐藏头部的写回答/操作/统计栏，去掉分割线与多余空白 */
      '.QuestionHeader-footer,.NumberBoard,.QuestionHeaderActions,.QuestionHeader-actions,.QuestionButtonGroup{display:none!important;}',
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
      /* 宽度模式（标题卡与回答同步） */
      '.pp-width-narrow .Question-mainColumn,.pp-width-narrow .QuestionHeader{max-width:620px!important;}',
      '.pp-width-wide .Question-mainColumn,.pp-width-wide .QuestionHeader{max-width:1100px!important;}',
      /* 响应式 */
      '@media (max-width:768px){.Question-mainColumn{padding:24px 16px 80px!important;max-width:100%!important;}.QuestionHeader{padding:24px 18px!important;margin-bottom:16px!important;}.List-item{padding:28px 22px!important;border-radius:2px!important;}.QuestionHeader-title{font-size:1.5rem!important;}}',
      '@media (min-width:769px) and (max-width:1024px){.Question-mainColumn{padding:48px 24px 100px!important;max-width:720px!important;}.QuestionHeader{max-width:720px!important;padding:32px 36px!important;}.List-item{padding:32px 36px!important;}}',
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
      /* [v2.6] 知乎新版布局：列容器由 JS 动态标记 .pp-col，侧栏标记 .pp-side，祖先解除宽度限制 */
      '.pp-uncap{max-width:none!important;width:100%!important;box-sizing:border-box!important;}',
      '.pp-side{display:none!important;}',
      '.Post-Row-Content-left,.pp-col{float:none!important;width:100%!important;max-width:860px!important;margin:0 auto!important;padding:80px 40px 120px!important;box-sizing:border-box!important;transition:max-width 0.3s ease!important;}',
      '.pp-dragging .Post-Row-Content-left,.pp-dragging .pp-col{transition:none!important;}',
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

      /* [v2.7] 代码块语言标签 + 折叠 */
      '.pp-code-lang{position:absolute;top:10px;left:16px;font-family:' + FONTS.mono + ';font-size:11px;color:' + T.textFaint + ';text-transform:uppercase;letter-spacing:0.08em;pointer-events:none;user-select:none;}',
      '.Post-RichTextContainer pre.pp-code-collapsed,.ztext pre.pp-code-collapsed{max-height:300px!important;overflow:hidden!important;}',
      '.Post-RichTextContainer pre.pp-code-collapsed::after,.ztext pre.pp-code-collapsed::after{content:"";position:absolute;left:0;right:0;bottom:0;height:72px;background:linear-gradient(transparent,' + T.surface3 + ');pointer-events:none;}',
      '.pp-code-toggle{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);padding:3px 14px;font-family:' + FONTS.body + ';font-size:12px;background:' + T.surface2 + ';color:' + T.textMute + ';border:1px solid ' + T.rule + ';border-radius:4px;cursor:pointer;z-index:2;transition:all 0.2s;}',
      '.pp-code-toggle:hover{background:' + T.accentSoft + ';color:' + T.accent + ';border-color:' + T.accent + ';}',

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
      '#pp-panel .pp-width-display{font-size:8px;text-align:center;color:' + T.textFaint + ';padding:1px 0 2px;font-family:' + FONTS.mono + ';line-height:1.3;}',

      /* [v2.7] 专注模式：f 键隐藏全部浮动 UI */
      '.pp-focus #pp-panel,.pp-focus #pp-toc,.pp-focus .pp-drag-handle,.pp-focus #pp-progress{display:none!important;}',

      '/* ── 图片灯箱 ── */',
      '#pp-lightbox{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;cursor:zoom-out;opacity:0;pointer-events:none;transition:opacity 0.25s;}',
      '#pp-lightbox.open{opacity:1;pointer-events:auto;}',
      '#pp-lightbox img{max-width:92vw;max-height:92vh;border-radius:4px;box-shadow:0 40px 120px rgba(0,0,0,0.5);cursor:default;}',
      '#pp-lightbox .pp-lb-close{position:fixed;top:20px;right:24px;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;font-size:22px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s;}',
      '#pp-lightbox .pp-lb-close:hover{background:rgba(255,255,255,0.2);}',
      /* [v2.7] 画廊导航按钮与计数 */
      '#pp-lightbox .pp-lb-nav{position:fixed;top:50%;transform:translateY(-50%);width:48px;height:72px;border-radius:8px;background:rgba(255,255,255,0.08);color:#fff;font-size:32px;line-height:1;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s;z-index:2;}',
      '#pp-lightbox .pp-lb-nav:hover{background:rgba(255,255,255,0.2);}',
      '#pp-lightbox .pp-lb-prev{left:24px;}',
      '#pp-lightbox .pp-lb-next{right:24px;}',
      '#pp-lightbox .pp-lb-counter{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:4px 14px;border-radius:12px;background:rgba(255,255,255,0.12);color:#fff;font-size:13px;font-family:' + FONTS.body + ';}',

      '/* ── 悬浮目录 TOC ── */',
      '#pp-toc{position:fixed;left:16px;top:50%;transform:translateY(-50%);z-index:9998;font-family:' + FONTS.body + ';max-width:180px;max-height:80vh;overflow-y:auto;padding:8px 0;border-radius:8px;background:' + T.surface + ';border:1px solid ' + T.rule + ';box-shadow:0 2px 12px rgba(0,0,0,0.06);}',
      '#pp-toc::-webkit-scrollbar{width:4px;}',
      '#pp-toc::-webkit-scrollbar-thumb{background:' + T.rule + ';border-radius:2px;}',
      '#pp-toc a{display:block;padding:4px 14px;font-size:12px;color:' + T.textFaint + ';text-decoration:none!important;border-left:2px solid transparent;transition:all 0.2s;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#pp-toc a:hover,#pp-toc a.active{color:' + T.accent + ';border-left-color:' + T.accent + ';}',
      '#pp-toc a.pp-toc-h2{padding-left:14px;font-weight:500;}',
      '#pp-toc a.pp-toc-h3{padding-left:24px;font-size:11px;}',

      '/* 宽度模式（预设） */',
      '.pp-width-narrow .Post-Row-Content-left,.pp-width-narrow .pp-col{max-width:620px!important;}',
      '.pp-width-wide .Post-Row-Content-left,.pp-width-wide .pp-col{max-width:1100px!important;}',

      // ════════════════════════════════════════════════════════════
      // [新增] 拖拽调宽手柄
      // ════════════════════════════════════════════════════════════
      '.pp-drag-handle{position:fixed;top:50%;transform:translateY(-50%);width:20px;height:160px;z-index:9996;display:flex;align-items:center;justify-content:center;cursor:ew-resize;border-radius:4px;transition:background 0.2s;}',
      '.pp-drag-handle:hover{background:' + T.accentSoft + ';}',
      '.pp-drag-grip{width:4px;height:56px;border-radius:3px;background:' + T.accent + ';opacity:0.55;transition:opacity 0.2s,width 0.2s,box-shadow 0.2s;box-shadow:0 0 0 1px rgba(255,255,255,0.3);}',
      '.pp-drag-handle:hover .pp-drag-grip{opacity:0.95;width:6px;box-shadow:0 0 12px ' + T.accentGlow + ';}',
      '.pp-drag-handle:active .pp-drag-grip{opacity:1;width:6px;}',
      '.pp-dragging,.pp-dragging *{cursor:ew-resize!important;user-select:none!important;-webkit-user-select:none!important;}',
      '.pp-dragging .pp-drag-grip{opacity:1!important;width:6px!important;box-shadow:0 0 16px ' + T.accentGlow + '!important;}',
      // [新增] 首次加载时手柄脉冲动画，吸引注意
      '@keyframes pp-handle-pulse{0%,100%{opacity:0.55;}50%{opacity:0.9;}}',
      '.pp-drag-handle.pp-pulse .pp-drag-grip{animation:pp-handle-pulse 1.5s ease-in-out 3;}',
      '#pp-drag-tooltip{position:fixed;display:none;top:70px;left:50%;transform:translateX(-50%);padding:6px 16px;font-family:' + FONTS.body + ';font-size:13px;font-weight:600;color:#fff;background:' + T.accent + ';border-radius:6px;pointer-events:none;z-index:99999;white-space:nowrap;box-shadow:0 4px 16px ' + T.accentGlow + ';}',
      '#pp-drag-tooltip::after{content:"";position:absolute;bottom:-4px;left:50%;transform:translateX(-50%) rotate(45deg);width:8px;height:8px;background:' + T.accent + ';}',

      '/* ── 响应式 ── */',
      '@media (max-width:768px){',
      '.Post-Row-Content-left,.pp-col{padding:24px 16px 80px!important;max-width:100%!important;}',
      '.Post-Main.Post-NormalMain{padding:32px 20px!important;border-radius:2px!important;}',
      '.Post-Title{line-height:1.35!important;}',
      '.Post-RichTextContainer h2{line-height:1.4!important;}',
      '.Post-RichTextContainer h3{line-height:1.4!important;}',
      '.Post-RichTextContainer pre{padding:16px!important;}',
      '#pp-toc{display:none!important;}',
      '.pp-drag-handle{display:none!important;}', // 移动端隐藏拖拽手柄
      '#pp-panel{position:fixed;top:auto;bottom:16px;right:16px;left:auto;flex-direction:row;justify-content:center;gap:2px;z-index:9997;padding:6px;background:' + T.surface + ';border:1px solid ' + T.rule + ';border-radius:10px;}',
      '#pp-panel button{flex:0;width:44px;height:32px;padding:0;border-radius:6px;font-size:11px;border:none;background:transparent;}',
      '#pp-panel .pp-panel-label{display:none;}',
      '#pp-panel .pp-width-display{display:none;}',
      '}',

      '@media (min-width:769px) and (max-width:1024px){',
      '.Post-Row-Content-left,.pp-col{padding:48px 24px 100px!important;max-width:700px!important;}',
      '.Post-Main.Post-NormalMain{padding:48px 40px!important;}',
      '#pp-toc{max-width:160px;}',
      '}',

      '@media print{',
      'body{background:white!important;}',
      '.Post-Main.Post-NormalMain::before,.Post-Main.Post-NormalMain::after{display:none!important;}',
      '.Post-Main.Post-NormalMain{box-shadow:none!important;background:white!important;}',
      '#pp-progress,#pp-panel,#pp-toc,#pp-lightbox,.pp-drag-handle,#pp-drag-tooltip{display:none!important;}',
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

  // ═══════════════════════════════════════════════════════════════
  // [v2.7] 阅读位置记忆：按文章 ID 记住滚动位置，30 天过期
  // ═══════════════════════════════════════════════════════════════

  var POS_KEY = (function () {
    var m = location.pathname.match(/\/p\/(\d+)/) || location.pathname.match(/\/question\/(\d+)/);
    return m ? 'pp_pos_' + (m[1] || m[2]) : null;
  })();

  function saveScrollPos() {
    if (!POS_KEY) return;
    try { localStorage.setItem(POS_KEY, (window.scrollY || 0) + '|' + Date.now()); } catch (e) {}
  }

  function restoreScrollPos() {
    if (!POS_KEY) return;
    var y = 0;
    try {
      var raw = localStorage.getItem(POS_KEY);
      if (raw) y = parseInt(raw.split('|')[0]) || 0;
    } catch (e) {}
    if (y < 100) return;
    // 等内容渲染到足够高度再跳转
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (document.documentElement.scrollHeight > y + window.innerHeight || tries > 12) {
        clearInterval(timer);
        window.scrollTo({ top: y, behavior: 'auto' });
      }
    }, 300);
  }

  // 清理 30 天前的历史位置记录，避免 localStorage 膨胀
  function pruneScrollPos() {
    try {
      var cutoff = Date.now() - 30 * 24 * 3600 * 1000;
      var dead = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf('pp_pos_') !== 0) continue;
        var ts = parseInt((localStorage.getItem(k) || '').split('|')[1]) || 0;
        if (ts < cutoff) dead.push(k);
      }
      dead.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  }

  function bindScrollPos() {
    var saveDeb = debounce(saveScrollPos, 500);
    on(window, 'scroll', saveDeb, { passive: true });
    on(window, 'beforeunload', saveScrollPos);
    pruneScrollPos();
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
    // [v2.7] 幂等：脚本晚注入（body 已存在）时避免重复面板
    var oldPanel = document.getElementById('pp-panel');
    if (oldPanel) oldPanel.remove();

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
        updateWidthButtons();
      }, wl.title);
      b.className = 'pp-width-btn';
      b.setAttribute('data-width', wl.key);
      panel.appendChild(b);
    });

    // [新增] 宽度数值显示
    var widthDisplay = document.createElement('div');
    widthDisplay.className = 'pp-width-display';
    widthDisplay.id = 'pp-width-display';
    panel.appendChild(widthDisplay);

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

    // [v2.7] 行距调节
    var lhDown = btn('行-', '行距', function () {
      var cur = PREF.lineHeight;
      if (cur > 1.6) { PREF.lineHeight = (Math.round(cur * 10) - 1) / 10; applyLineHeight(); }
    }, '减小行距 ( [ )');
    var lhUp = btn('行+', '行距', function () {
      var cur = PREF.lineHeight;
      if (cur < 2.2) { PREF.lineHeight = (Math.round(cur * 10) + 1) / 10; applyLineHeight(); }
    }, '增大行距 ( ] )');
    panel.appendChild(lhDown);
    panel.appendChild(lhUp);

    var sep2 = document.createElement('div');
    sep2.className = 'pp-sep';
    panel.appendChild(sep2);

    // [v2.7] 主题按钮：单击切换日/夜，双击恢复跟随系统
    var resolved0 = resolveMode();
    var dmBtn = btn(resolved0 === 'dark' ? '☀' : '☾', null, function () {
      var next = resolveMode() === 'light' ? 'dark' : 'light';
      PREF.mode = next;
      applyTheme(next);
    }, '切换日夜间 ( d ) · 双击恢复跟随系统' + (PREF.mode === 'auto' ? '（当前：自动）' : ''));
    on(dmBtn, 'dblclick', function () {
      PREF.mode = 'auto';
      applyTheme(resolveMode());
    });
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

    // 初始化按钮高亮 & 宽度显示
    updateWidthButtons();
    updateWidthDisplay();

    return panel;
  }

  function T(key) {
    var mode = resolveMode();
    return THEMES[mode][key];
  }

  // [新增] 更新宽度按钮高亮状态
  function updateWidthButtons() {
    $$('#pp-panel .pp-width-btn').forEach(function (bb) {
      if (bb.getAttribute('data-width') === PREF.width) {
        bb.style.borderColor = T('accent');
        bb.style.color = T('accent');
      } else {
        bb.style.borderColor = '';
        bb.style.color = '';
      }
    });
    updateWidthDisplay();
  }

  // [新增] 更新宽度数值显示
  function updateWidthDisplay() {
    var el = $('#pp-width-display');
    if (!el) return;
    var w;
    if (PREF.width === 'narrow') w = 620;
    else if (PREF.width === 'wide') w = 1100;
    else if (PREF.width === 'custom') w = PREF.customWidth;
    else w = 860;
    el.textContent = w + 'px';
  }

  // ── 图片灯箱（[v2.7] 画廊模式：多图 ←/→ 切换 + 计数）──
  function buildLightbox() {
    var lb = document.createElement('div');
    lb.id = 'pp-lightbox';
    lb.innerHTML = '<img src="" alt="">' +
      '<button class="pp-lb-close">×</button>' +
      '<button class="pp-lb-nav pp-lb-prev">‹</button>' +
      '<button class="pp-lb-nav pp-lb-next">›</button>' +
      '<div class="pp-lb-counter"></div>';
    document.body.appendChild(lb);

    var img = $('img', lb);
    var closeBtn = $('.pp-lb-close', lb);
    var prevBtn = $('.pp-lb-prev', lb);
    var nextBtn = $('.pp-lb-next', lb);
    var counter = $('.pp-lb-counter', lb);

    var gallery = [];
    var idx = -1;

    function show(i) {
      if (!gallery.length) return;
      idx = (i + gallery.length) % gallery.length;
      img.src = gallery[idx].getAttribute('data-original') || gallery[idx].src;
      counter.textContent = (idx + 1) + ' / ' + gallery.length;
      var multi = gallery.length > 1;
      prevBtn.style.display = multi ? '' : 'none';
      nextBtn.style.display = multi ? '' : 'none';
      counter.style.display = multi ? '' : 'none';
    }

    function open(src, el) {
      // 收集正文内全部图片构成画廊
      gallery = Array.prototype.filter.call($$(SCOPE + ' figure img, ' + SCOPE + ' img'), function (im) {
        var s = im.getAttribute('data-original') || im.src;
        return s && !s.startsWith('data:');
      });
      img.src = src;
      lb.classList.add('open');
      // 修复：加上 pp-lightbox-open 标记，让 cleanupDOM 的守卫真正生效，避免背景漏滚
      document.body.classList.add('pp-lightbox-open');
      document.body.style.overflow = 'hidden';
      var i = el ? gallery.indexOf(el) : -1;
      if (i >= 0) {
        show(i);
      } else {
        gallery = [];
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
        counter.style.display = 'none';
      }
    }
    function close() {
      lb.classList.remove('open');
      document.body.classList.remove('pp-lightbox-open');
      document.body.style.overflow = '';
      img.src = '';
    }
    on(lb, 'click', function (e) { if (e.target === lb) close(); });
    on(closeBtn, 'click', close);
    on(prevBtn, 'click', function (e) { e.stopPropagation(); show(idx - 1); });
    on(nextBtn, 'click', function (e) { e.stopPropagation(); show(idx + 1); });
    on(document, 'keydown', function (e) {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') show(idx - 1);
      else if (e.key === 'ArrowRight') show(idx + 1);
    });

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

  // ── [v2.7] 代码块装饰：语言标签 + 长代码折叠 ──
  var CODE_FOLD_LINES = 14;

  function decorateCodeBlocks() {
    $$(SCOPE + ' pre').forEach(function (pre) {
      if (pre._ppDecorated) return;
      pre._ppDecorated = true;
      var code = pre.querySelector('code');
      if (!code) return;

      // 语言标签（取自 class="language-xxx"）
      var lang = '';
      var cls = code.className || '';
      var m = cls.match(/language-([a-zA-Z0-9+#-]+)/) || cls.match(/lang-([a-zA-Z0-9+#-]+)/);
      if (m) lang = m[1];
      if (lang) {
        var tag = document.createElement('span');
        tag.className = 'pp-code-lang';
        tag.textContent = lang;
        pre.appendChild(tag);
      }

      // 长代码折叠：超过 CODE_FOLD_LINES 行默认收起
      var lines = (code.textContent || '').split('\n').length;
      if (lines > CODE_FOLD_LINES) {
        pre.classList.add('pp-code-collapsed');
        var toggle = document.createElement('button');
        toggle.className = 'pp-code-toggle';
        toggle.textContent = '展开全部 ' + lines + ' 行';
        on(toggle, 'click', function (e) {
          e.stopPropagation();
          var collapsed = pre.classList.toggle('pp-code-collapsed');
          toggle.textContent = collapsed ? ('展开全部 ' + lines + ' 行') : '收起';
        });
        pre.appendChild(toggle);
      }
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
  // [新增] 拖拽调宽手柄
  // ═══════════════════════════════════════════════════════════════

  var _dragHandles = null;
  var MIN_WIDTH = 420;
  var MAX_WIDTH = 1600;

  // ═══════════════════════════════════════════════════════════════
  // [v2.6] 列容器探测：知乎 2026.07 改版后 .Post-Row-Content-left 等旧类名失效，
  // 以文章卡片为锚点向上查找"列容器"（第一个拥有侧栏兄弟的祖先），
  // 动态标记 .pp-col / .pp-side / .pp-uncap，宽度预设与拖拽手柄全部作用于它
  // ═══════════════════════════════════════════════════════════════

  var _ppCol = null;

  // 脚本自身 UI 与非内容元素（避免误隐藏面板/灯箱/手柄/目录）
  // 注意：必须按 class 词元精确判断，不能用子串（"AppHeader" 等包含 "pp-" 子串会误判）
  function isOurUI(el) {
    if (!el || el.nodeType !== 1) return true;
    var tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') return true;
    var id = el.id || '';
    if (id.indexOf('pp-') === 0) return true;
    var cls = el.className;
    if (cls && typeof cls === 'string') {
      var tokens = cls.split(/\s+/);
      for (var i = 0; i < tokens.length; i++) {
        if (tokens[i].indexOf('pp-') === 0) return true;
      }
    }
    return false;
  }

  // 判断兄弟元素是否像侧栏：含知乎侧栏特征文本，或明显比主列窄
  function looksLikeSidebar(sib, colWidth) {
    var text = '';
    try { text = sib.textContent || ''; } catch (e) {}
    if (text.indexOf('关于作者') !== -1 || text.indexOf('大家都在搜') !== -1 ||
        text.indexOf('相关阅读') !== -1 || text.indexOf('推荐阅读') !== -1) return true;
    var w = sib.getBoundingClientRect().width;
    return w > 0 && colWidth > 0 && w < colWidth * 0.75;
  }

  function detectColumn() {
    // 旧版类名优先（向后兼容旧版布局 / 问答页）
    var col = PAGE === 'question'
      ? ($('.Question-mainColumn') || $('.Question-main'))
      : $('.Post-Row-Content-left');

    if (!col) {
      // 新版布局：以文章卡片为锚点，向上找第一个"兄弟像侧栏"的祖先作为列容器
      var anchor = PAGE === 'question'
        ? ($('.QuestionHeader') || $('.List-item'))
        : ($('.Post-Main.Post-NormalMain') || $('.Post-RichTextContainer') || $('.Post-Title'));
      var el = anchor ? anchor.parentElement : null;
      var depth = 0;
      while (el && el !== document.body && el !== document.documentElement && depth < 8) {
        var parent = el.parentElement;
        if (!parent || parent === document.body || parent === document.documentElement) break;
        var colW = el.getBoundingClientRect().width;
        var sidebarSibs = [];
        var kids = parent.children;
        for (var i = 0; i < kids.length; i++) {
          var sib = kids[i];
          if (sib === el) continue;
          // 已被我们标记隐藏的侧栏，直接认定（保证重复探测幂等稳定）
          if (sib.classList && sib.classList.contains('pp-side')) { sidebarSibs.push(sib); continue; }
          if (isOurUI(sib)) continue;
          if (looksLikeSidebar(sib, colW)) sidebarSibs.push(sib);
        }
        if (sidebarSibs.length) {
          col = el;
          sidebarSibs.forEach(function (s) { s.classList.add('pp-side'); });
          break;
        }
        el = parent;
        depth++;
      }
      // 退化策略：没找到明确侧栏时，取第一个"有真实兄弟元素"的祖先作为列（只定列，不隐藏兄弟）
      if (!col && anchor) {
        el = anchor.parentElement;
        depth = 0;
        while (el && el !== document.body && el !== document.documentElement && depth < 8) {
          var p = el.parentElement;
          if (!p || p === document.body || p === document.documentElement) break;
          var realSibs = 0;
          for (var j = 0; j < p.children.length; j++) {
            if (p.children[j] !== el && !isOurUI(p.children[j])) realSibs++;
          }
          if (realSibs > 0) { col = el; break; }
          el = p;
          depth++;
        }
      }
      // 最终退路：直接用文章卡片本身
      if (!col && anchor) col = anchor;
    }

    if (col) {
      col.classList.add('pp-col');
      // 解除祖先宽度限制，避免拖拽到宽档时被外层容器卡住
      var up = col.parentElement;
      var n = 0;
      while (up && up !== document.body && n < 8) {
        up.classList.add('pp-uncap');
        up = up.parentElement;
        n++;
      }
    }

    // 清理过期标记（知乎 SPA 重渲染 / 之前探测路径不同导致的多余 .pp-col）
    $$('.pp-col').forEach(function (el2) {
      if (el2 !== col) el2.classList.remove('pp-col');
    });

    _ppCol = col || null;
    return _ppCol;
  }

  // 获取当前内容主元素（宽度由它决定）
  function getContentEl() {
    if (_ppCol && document.contains(_ppCol)) return _ppCol;
    return detectColumn();
  }

  function buildDragHandles() {
    // 清理旧手柄
    $$('.pp-drag-handle').forEach(function (el) { el.remove(); });
    var oldTip = $('#pp-drag-tooltip');
    if (oldTip) oldTip.remove();

    var leftHandle = document.createElement('div');
    leftHandle.className = 'pp-drag-handle pp-drag-left';
    leftHandle.title = '拖拽调整宽度 · 双击恢复标准 (860px)';
    leftHandle.innerHTML = '<div class="pp-drag-grip"></div>';

    var rightHandle = document.createElement('div');
    rightHandle.className = 'pp-drag-handle pp-drag-right';
    rightHandle.title = '拖拽调整宽度 · 双击恢复标准 (860px)';
    rightHandle.innerHTML = '<div class="pp-drag-grip"></div>';

    var tooltip = document.createElement('div');
    tooltip.id = 'pp-drag-tooltip';
    tooltip.textContent = '860px';

    document.body.appendChild(leftHandle);
    document.body.appendChild(rightHandle);
    document.body.appendChild(tooltip);

    // ── 定位手柄到内容区域左右边缘 ──
    function reposition() {
      var content = getContentEl();
      if (!content) {
        leftHandle.style.display = 'none';
        rightHandle.style.display = 'none';
        return;
      }
      var rect = content.getBoundingClientRect();
      // 内容区域接近全屏宽时隐藏手柄（移动端 / 小窗口）
      if (rect.width < window.innerWidth - 80) {
        leftHandle.style.display = '';
        rightHandle.style.display = '';
        // 手柄居中对齐到内容边缘（handle 宽 20px，偏移 10px 让 grip 正好落在边缘）
        leftHandle.style.left = (rect.left - 10) + 'px';
        rightHandle.style.left = (rect.right - 10) + 'px';
      } else {
        leftHandle.style.display = 'none';
        rightHandle.style.display = 'none';
      }
    }

    // [新增] 首次加载时脉冲动画，吸引注意（仅当 width 不是 custom 时，避免每次拖拽后都动画）
    if (PREF.width !== 'custom') {
      leftHandle.classList.add('pp-pulse');
      rightHandle.classList.add('pp-pulse');
      // 动画结束后移除 class
      setTimeout(function () {
        leftHandle.classList.remove('pp-pulse');
        rightHandle.classList.remove('pp-pulse');
      }, 5000);
    }

    // ── 拖拽逻辑 ──
    // 内容居中 (margin:0 auto)，拖右边缘向右 delta → 宽度 +2*delta（左右对称扩展）
    // 拖左边缘向左 delta(<0) → 宽度 -2*delta = 宽度 + 2*|delta|
    // [v2.7] 同时支持鼠标与触屏
    function startDrag(e, isRight) {
      e.preventDefault();
      e.stopPropagation();

      var isTouch = e.type === 'touchstart';
      var moveEv = isTouch ? 'touchmove' : 'mousemove';
      var endEv = isTouch ? 'touchend' : 'mouseup';
      function pointX(ev) {
        return (ev.touches && ev.touches[0]) ? ev.touches[0].clientX : ev.clientX;
      }

      var content = getContentEl();
      if (!content) return;
      var startWidth = content.getBoundingClientRect().width;
      var startX = pointX(e);

      tooltip.style.display = 'block';
      tooltip.textContent = Math.round(startWidth) + 'px';

      function onMove(ev) {
        if (isTouch && ev.cancelable) ev.preventDefault(); // 阻止页面滚动
        var delta = pointX(ev) - startX;
        // 右手柄：向右拖加宽；左手柄：向左拖加宽
        var newWidth = isRight
          ? startWidth + 2 * delta
          : startWidth - 2 * delta;
        newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth));
        newWidth = Math.round(newWidth);

        // 写入偏好并应用
        PREF.width = 'custom';
        PREF.customWidth = newWidth;
        applyWidth();

        // 实时提示
        tooltip.textContent = newWidth + 'px';

        // 更新按钮状态 & 显示
        updateWidthButtons();
      }

      function onUp() {
        document.removeEventListener(moveEv, onMove);
        document.removeEventListener(endEv, onUp);
        document.body.classList.remove('pp-dragging');
        tooltip.style.display = 'none';
        reposition();
      }

      document.body.classList.add('pp-dragging');
      document.addEventListener(moveEv, onMove, isTouch ? { passive: false } : undefined);
      document.addEventListener(endEv, onUp);
    }

    // ── 双击重置为标准宽度 ──
    function onDblClick(e) {
      e.preventDefault();
      e.stopPropagation();
      PREF.width = 'standard';
      PREF.customWidth = 860;
      applyWidth();
      updateWidthButtons();
      reposition();
    }

    on(leftHandle, 'mousedown', function (e) { startDrag(e, false); });
    on(rightHandle, 'mousedown', function (e) { startDrag(e, true); });
    on(leftHandle, 'touchstart', function (e) { startDrag(e, false); }, { passive: false });
    on(rightHandle, 'touchstart', function (e) { startDrag(e, true); }, { passive: false });
    on(leftHandle, 'dblclick', onDblClick);
    on(rightHandle, 'dblclick', onDblClick);

    // 窗口大小变化时重新定位
    on(window, 'resize', rafThrottle(reposition));

    // 滚动时重新定位（防止滚动条出现/消失导致内容水平偏移）
    on(window, 'scroll', rafThrottle(reposition), { passive: true });

    _dragHandles = { reposition: reposition };
    return _dragHandles;
  }

  // ═══════════════════════════════════════════════════════════════
  // 主题 / 字号 / 宽度 应用
  // ═══════════════════════════════════════════════════════════════

  var currentStyleEl = null;
  var _panelRef = null;
  var _fontSizeOverride = null;
  var _lhOverride = null;

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

  // [v2.7] 行距调节：覆盖正文/列表的行高
  function applyLineHeight() {
    var lh = PREF.lineHeight;
    if (_lhOverride) _lhOverride.remove();
    _lhOverride = document.createElement('style');
    _lhOverride.id = 'pp-lh-override';
    _lhOverride.textContent = [
      '.Post-RichTextContainer,.ztext{line-height:' + lh + '!important;}',
      '.Post-RichTextContainer p,.ztext p{line-height:' + lh + '!important;}',
      '.Post-RichTextContainer li,.ztext li{line-height:' + Math.max(1.4, lh - 0.1).toFixed(2) + '!important;}',
      '.Post-RichTextContainer blockquote,.ztext blockquote{line-height:' + Math.max(1.4, lh - 0.15).toFixed(2) + '!important;}',
    ].join('\n');
    appendToHead(_lhOverride);
  }

  function applyWidth() {
    document.body.classList.remove('pp-width-narrow', 'pp-width-wide');

    // 清除旧的自定义宽度样式
    var customStyle = document.getElementById('pp-width-custom');
    if (customStyle) customStyle.remove();

    if (PREF.width === 'narrow') {
      document.body.classList.add('pp-width-narrow');
    } else if (PREF.width === 'wide') {
      document.body.classList.add('pp-width-wide');
    } else if (PREF.width === 'custom') {
      // [新增] 注入自定义宽度样式
      var w = PREF.customWidth;
      var style = document.createElement('style');
      style.id = 'pp-width-custom';
      if (PAGE === 'question') {
        style.textContent =
          '.Question-mainColumn{max-width:' + w + 'px!important;}' +
          '.QuestionHeader{max-width:' + w + 'px!important;}' +
          '.pp-col{max-width:' + w + 'px!important;}';
      } else {
        style.textContent =
          '.Post-Row-Content-left{max-width:' + w + 'px!important;}' +
          '.pp-col{max-width:' + w + 'px!important;}';
      }
      appendToHead(style);
    }

    // 重新定位拖拽手柄
    if (_dragHandles) _dragHandles.reposition();
  }

  // ═══════════════════════════════════════════════════════════════
  // 代码高亮 (highlight.js)
  // ═══════════════════════════════════════════════════════════════

  var _hljsThemeEl = null;

  // [v2.7] highlight.js 多镜像兜底：主 CDN 失败时依次切换国内镜像，全部失败则静默降级（仅无高亮）
  var HLJS_HOSTS = [
    'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0',
    'https://cdn.staticfile.org/highlight.js/11.9.0',
    'https://lib.baomitu.com/highlight.js/11.9.0',
  ];

  function loadHighlightJS(cb) {
    var isDark = resolveMode() === 'dark';
    var themeFile = isDark ? '/styles/github-dark.min.css' : '/styles/github.min.css';
    var i = 0;
    function tryNext() {
      if (i >= HLJS_HOSTS.length) {
        if (cb) cb();
        return;
      }
      var base = HLJS_HOSTS[i++];
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = base + themeFile;
      appendToHead(link);

      var script = document.createElement('script');
      script.src = base + '/highlight.min.js';
      var settled = false;
      script.onload = function () {
        if (settled) return;
        settled = true;
        applyHighlightTheme(resolveMode());
        if (cb) cb();
      };
      script.onerror = function () {
        if (settled) return;
        settled = true;
        script.remove();
        link.remove();
        tryNext();
      };
      appendToHead(script);
    }
    tryNext();
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
        case '[':
        case '{':
          if (PREF.lineHeight > 1.6) { PREF.lineHeight = (Math.round(PREF.lineHeight * 10) - 1) / 10; applyLineHeight(); }
          break;
        case ']':
        case '}':
          if (PREF.lineHeight < 2.2) { PREF.lineHeight = (Math.round(PREF.lineHeight * 10) + 1) / 10; applyLineHeight(); }
          break;
        case 'f':
        case 'F':
          document.body.classList.toggle('pp-focus');
          break;
        case 'Escape':
          document.body.classList.remove('pp-focus');
          break;
        case 'd':
        case 'D':
          var next = resolveMode() === 'light' ? 'dark' : 'light';
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
    // 前 15 秒：全子树监听（首屏异步渲染密集）
    var obs = new MutationObserver(removeJunk);
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 15000);
    // [v2.7] 之后长期监听 body 直接子节点：知乎延迟弹出的登录墙/遮罩都挂在 body 下，
    // 只在有新增节点时才触发，开销极小
    var obs2 = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].addedNodes.length) { removeJunk(); return; }
      }
    });
    obs2.observe(document.body, { childList: true });
  }

  // ═══════════════════════════════════════════════════════════════
  // 问答页杂项清理：举报 / 大家都在搜 / 相关帮助 / 关于（CSS 已处理主体，此处为动态兵底）
  // ═══════════════════════════════════════════════════════════════

  var JUNK_TEXTS = ['举报', '写回答', '大家都在搜', '相关问题', '相关的帮助', '相关帮助', '关于', '关于知乎', '申请转载', '联系我们', '内容中心'];

  function pruneQuestionJunk() {
    // 隐藏侧栏/页脚/操作栏/头部写回答栏（包含大家都在搜、相关、关于、举报、写回答）
    ['.Question-sideColumn', '.QuestionHeader-side', '.QuestionHeader-footer',
      '.QuestionHeaderActions', '.ContentItem-actions', '.RichContent-actions',
      '.AppFooter', '[class*="Footer"]', '.Pc-word',
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
    decorateCodeBlocks();
    highlightAll();
    bindImages();
    if (PAGE === 'question') pruneQuestionJunk();

    // 重建目录（专栏：新增标题；问答：新加载的回答）
    buildTOC();

    // [v2.6] 重新探测列容器（知乎可能异步渲染/改版）
    detectColumn();

    // 重新定位拖拽手柄（内容可能已加载，宽高变化）
    if (_dragHandles) _dragHandles.reposition();

    if (_dynObserver && _observerTarget) {
      _dynObserver.observe(_observerTarget, { childList: true, subtree: true });
    }
  }

  function observeDynamicContent(attempt) {
    var container = PAGE === 'question'
      ? ($('.Question-mainColumn') || $('.Question-main') || $('.ListShortcut'))
      : $('.Post-RichTextContainer');
    if (!container) {
      // [v2.7] 容器尚未渲染：重试最多 ~10 秒（知乎加载慢时不再静默失效）
      attempt = attempt || 0;
      if (attempt < 20) setTimeout(function () { observeDynamicContent(attempt + 1); }, 500);
      return;
    }
    if (_observerTarget === container && _dynObserver) return; // 已绑定同一容器
    if (_dynObserver) _dynObserver.disconnect();
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

  // [v2.7] 看门狗：SPA 换文（URL 变化）/ observer 目标脱离文档时自动重绑
  var _lastHref = location.href;

  function startWatchdog() {
    setInterval(function () {
      if (location.href !== _lastHref) {
        _lastHref = location.href;
        detectColumn();
        observeDynamicContent();
        processDynamicContent();
        restoreScrollPos();
        if (_dragHandles) _dragHandles.reposition();
        return;
      }
      if (!_observerTarget || !document.contains(_observerTarget)) {
        observeDynamicContent();
      }
    }, 2000);
  }

  function bindImages() {
    $$(SCOPE + ' figure img, ' + SCOPE + ' img').forEach(function (img) {
      if (img._ppBound) return;
      img._ppBound = true;
      on(img, 'click', function () {
        var src = img.getAttribute('data-original') || img.src;
        if (src && !src.startsWith('data:')) {
          lb.open(src, img);
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

    applyTheme(resolveMode());

    // [v2.7] 系统主题变化时，auto 模式下自动跟随
    try {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onMq = function () {
        if (PREF.mode === 'auto') applyTheme(resolveMode());
      };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
      else if (mq.addListener) mq.addListener(onMq);
    } catch (e) {}

    function onReady() {
      cleanupDOM();

      buildProgressBar();
      _panelRef = buildPanel();
      lb = buildLightbox();

      // [新增] 构建拖拽手柄
      buildDragHandles();

      // [v2.6] 立即探测一次列容器并定位手柄
      detectColumn();
      if (_dragHandles) _dragHandles.reposition();

      // 优化：只绑定一次滚动监听，进度条 + TOC 高亮共用
      bindScroll();
      bindKeyboard();
      bindScrollPos(); // [v2.7] 阅读位置记忆
      startWatchdog(); // [v2.7] SPA 换文 / observer 失效自动重绑
      setTimeout(restoreScrollPos, 700); // [v2.7] 恢复上次阅读位置

      // 绑定图片点击 + 问答页杂项清理
      setTimeout(function () {
        detectColumn(); // [v2.6] 延迟再探测一次，确保内容已渲染
        bindImages();
        if (PAGE === 'question') pruneQuestionJunk();
        // 延迟定位手柄，确保内容已渲染
        if (_dragHandles) _dragHandles.reposition();
      }, 400);
      if (PAGE === 'question') {
        setTimeout(pruneQuestionJunk, 1200);
        setTimeout(pruneQuestionJunk, 2500);
      }

      // 代码高亮
      loadHighlightJS(function () {
        addCopyButtons();
        decorateCodeBlocks();
        highlightAll();
        setTimeout(function () { addCopyButtons(); decorateCodeBlocks(); highlightAll(); }, 1000);
      });

      // TOC
      setTimeout(function () {
        buildTOC();
        onScroll(); // 立即刷新一次进度条/目录高亮
      }, 500);

      // 应用偏好
      applyFontSize();
      applyLineHeight();
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
