// ==UserScript==
// @name         知乎 · Paper Press 阅读模式
// @namespace    https://github.com/hahapkpk/tools
// @version      2.2.0
// @description  知乎专栏 → 杂志风格沉浸阅读：悬浮目录 · 代码高亮 · 图片灯箱 · 深色模式 · 阅读进度 · 字号/宽度调节 · 代码复制
// @author       hahapkpk
// @match        https://zhuanlan.zhihu.com/p/*
// @grant        GM_addStyle
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/zhihu-paper-press.user.js
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/zhihu-paper-press.user.js
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

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
  function on(el, ev, fn) { el.addEventListener(ev, fn); }

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
      '#pp-panel{position:fixed;right:16px;top:140px;z-index:9997;display:flex;flex-direction:column;gap:6px;font-family:' + FONTS.body + ';}',
      '#pp-panel button{display:block;width:52px;padding:8px 4px;border:1px solid ' + T.rule + ';background:' + T.surface2 + ';color:' + T.textMute + ';cursor:pointer;font-size:13px;font-weight:500;text-align:center;border-radius:6px;transition:all 0.2s;line-height:1.3;font-family:' + FONTS.body + ';}',
      '#pp-panel button:hover{background:' + T.accentSoft + ';color:' + T.accent + ';border-color:' + T.accent + ';}',
      '#pp-panel .pp-panel-label{font-size:10px;display:block;color:' + T.textFaint + ';margin-top:1px;}',
      '#pp-panel button:hover .pp-panel-label{color:' + T.accent + ';}',

      '/* ── 图片灯箱 ── */',
      '#pp-lightbox{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;cursor:zoom-out;opacity:0;pointer-events:none;transition:opacity 0.25s;}',
      '#pp-lightbox.open{opacity:1;pointer-events:auto;}',
      '#pp-lightbox img{max-width:92vw;max-height:92vh;border-radius:4px;box-shadow:0 40px 120px rgba(0,0,0,0.5);}',
      '#pp-lightbox .pp-lb-close{position:fixed;top:20px;right:24px;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,0.1);color:#fff;font-size:22px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s;}',
      '#pp-lightbox .pp-lb-close:hover{background:rgba(255,255,255,0.2);}',

      '/* ── 悬浮目录 TOC ── */',
      '#pp-toc{position:fixed;right:16px;top:50%;transform:translateY(-50%);z-index:9998;font-family:' + FONTS.body + ';max-width:180px;}',
      '#pp-toc a{display:block;padding:3px 12px;font-size:12px;color:' + T.textFaint + ';text-decoration:none!important;border-left:2px solid transparent;transition:all 0.2s;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#pp-toc a:hover,#pp-toc a.active{color:' + T.accent + ';border-left-color:' + T.accent + ';}',
      '#pp-toc a.pp-toc-h2{padding-left:12px;font-weight:500;}',
      '#pp-toc a.pp-toc-h3{padding-left:22px;font-size:11px;}',

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
      '#pp-panel{position:fixed;top:auto;bottom:0;left:0;right:0;flex-direction:row;justify-content:center;gap:2px;z-index:9997;background:' + T.surface2 + ';padding:6px 8px;border-top:1px solid ' + T.rule + ';}',
      '#pp-panel button{flex:1;max-width:80px;padding:6px 2px;border-radius:4px;font-size:11px;border:none;background:transparent;}',
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

    return css.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════
  // UI 组件构建
  // ═══════════════════════════════════════════════════════════════

  // ── 阅读进度条 ──
  function buildProgressBar() {
    var bar = document.createElement('div');
    bar.id = 'pp-progress';
    document.body.appendChild(bar);
    on(window, 'scroll', function () {
      var scrollTop = window.scrollY || document.documentElement.scrollTop;
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      var pct = docHeight > 0 ? Math.min(100, (scrollTop / docHeight) * 100) : 0;
      bar.style.width = pct + '%';
    });
  }

  // ── 侧边按钮面板 ──
  function buildPanel() {
    var panel = document.createElement('div');
    panel.id = 'pp-panel';

    function btn(text, sub, onClick) {
      var b = document.createElement('button');
      b.textContent = text;
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
      { key: 'narrow', text: '窄栏', sub: '620' },
      { key: 'standard', text: '标准', sub: '860' },
      { key: 'wide', text: '宽栏', sub: '1100' },
    ];

    widthLabels.forEach(function (wl) {
      var b = btn(wl.text, wl.sub, function () {
        PREF.width = wl.key;
        applyWidth();
        $$('#pp-panel .pp-width-btn').forEach(function (bb) { bb.style.borderColor = ''; bb.style.color = ''; });
        b.style.borderColor = T('accent');
        b.style.color = T('accent');
      });
      b.className = 'pp-width-btn';
      if (PREF.width === wl.key) {
        b.style.borderColor = T('accent');
        b.style.color = T('accent');
      }
      panel.appendChild(b);
    });

    var sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:' + T('rule') + ';margin:4px 0;';
    panel.appendChild(sep);

    var fsDown = btn('A-', '缩小', function () {
      var cur = PREF.fontSize;
      if (cur > 14) { PREF.fontSize = cur - 2; applyFontSize(); }
    });
    var fsUp = btn('A+', '放大', function () {
      var cur = PREF.fontSize;
      if (cur < 24) { PREF.fontSize = cur + 2; applyFontSize(); }
    });
    panel.appendChild(fsDown);
    panel.appendChild(fsUp);

    var sep2 = document.createElement('div');
    sep2.style.cssText = 'height:1px;background:' + T('rule') + ';margin:4px 0;';
    panel.appendChild(sep2);

    var dmBtn = btn(PREF.mode === 'dark' ? '日间' : '夜间', PREF.mode === 'dark' ? '☀' : '☾', function () {
      var next = PREF.mode === 'light' ? 'dark' : 'light';
      PREF.mode = next;
      dmBtn.childNodes[0].textContent = (next === 'dark' ? '日间' : '夜间');
      dmBtn.querySelector('.pp-panel-label').textContent = (next === 'dark' ? '☀' : '☾');
      applyTheme(next);
    });
    panel.appendChild(dmBtn);

    var topBtn = btn('↑ 顶部', null, function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
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
      document.body.style.overflow = 'hidden';
    }
    function close() {
      lb.classList.remove('open');
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
    $$('.Post-RichTextContainer pre').forEach(function (pre) {
      if ($('.pp-copy-btn', pre)) return;
      var code = pre.querySelector('code');
      if (!code) return;

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

    var headings = $$('.Post-RichTextContainer h2, .Post-RichTextContainer h3');
    if (headings.length < 2) { toc.style.display = 'none'; document.body.appendChild(toc); return; }

    headings.forEach(function (h) {
      var id = 'pp-' + Math.random().toString(36).slice(2, 8);
      h.id = id;
      var a = document.createElement('a');
      a.href = '#' + id;
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

    var tocLinks = $$('#pp-toc a');
    on(window, 'scroll', function () {
      var active = null;
      headings.forEach(function (h) {
        var rect = h.getBoundingClientRect();
        if (rect.top <= 120) active = h.id;
      });
      tocLinks.forEach(function (a) {
        a.classList.toggle('active', a.getAttribute('href') === '#' + active);
      });
    });
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

    applyHighlightTheme(mode);
    rebuildPanel();
  }

  // 修复：字号调节需要同时影响标题和列表
  function applyFontSize() {
    var fs = PREF.fontSize;
    var ratio = fs / 16;
    var article = $('.Post-RichTextContainer');
    if (article) {
      article.style.fontSize = (ratio * 1.1).toFixed(2) + 'rem';
    }

    if (_fontSizeOverride) _fontSizeOverride.remove();
    _fontSizeOverride = document.createElement('style');
    _fontSizeOverride.id = 'pp-fontsize-override';
    _fontSizeOverride.textContent = [
      '.Post-Title{font-size:' + (ratio * 2.6).toFixed(2) + 'rem!important;}',
      '.Post-RichTextContainer h2{font-size:' + (ratio * 1.65).toFixed(2) + 'rem!important;}',
      '.Post-RichTextContainer h3{font-size:' + (ratio * 1.35).toFixed(2) + 'rem!important;}',
      '.Post-RichTextContainer h4,.Post-RichTextContainer h5,.Post-RichTextContainer h6{font-size:' + (ratio * 1.15).toFixed(2) + 'rem!important;}',
      '.Post-RichTextContainer li{font-size:' + (ratio * 1.05).toFixed(2) + 'rem!important;}',
      '.Post-RichTextContainer blockquote{font-size:' + (ratio * 1.15).toFixed(2) + 'rem!important;}',
      '.Post-RichTextContainer pre code{font-size:' + (ratio * 0.9).toFixed(2) + 'rem!important;}',
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

  function highlightAll() {
    if (window.hljs) {
      $$('.Post-RichTextContainer pre code').forEach(function (block) {
        window.hljs.highlightElement(block);
      });
    }
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
      if (!document.body.classList.contains('pp-lightbox-open')) {
        document.body.style.overflow = 'auto';
      }
    }

    var title = document.title;
    var cleaned = title.replace(/\s*-\s*知乎$/, '').replace(/\s*-\s*知乎专栏$/, '');
    if (cleaned !== title) document.title = cleaned;

    removeJunk();
    var obs = new MutationObserver(removeJunk);
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { obs.disconnect(); }, 15000);
  }

  // ═══════════════════════════════════════════════════════════════
  // 修复：用 MutationObserver 持续监听动态内容
  // ═══════════════════════════════════════════════════════════════

  function observeDynamicContent() {
    var container = $('.Post-RichTextContainer');
    if (!container) return;

    var observer = new MutationObserver(function (mutations) {
      var hasNewContent = false;
      mutations.forEach(function (m) {
        if (m.type === 'childList' && m.addedNodes.length > 0) hasNewContent = true;
      });
      if (hasNewContent) {
        addCopyButtons();
        highlightAll();
        bindImages();
        var headings = $$('.Post-RichTextContainer h2, .Post-RichTextContainer h3');
        var tocLinks = $$('#pp-toc a');
        if (headings.length !== tocLinks.length) {
          buildTOC();
        }
      }
    });

    observer.observe(container, { childList: true, subtree: true });
  }

  function bindImages() {
    $$('.Post-RichTextContainer figure img, .Post-RichTextContainer img').forEach(function (img) {
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

  var lb;

  function init() {
    loadFonts();

    var mode = PREF.mode;
    applyTheme(mode);

    function onReady() {
      cleanupDOM();

      buildProgressBar();
      _panelRef = buildPanel();
      lb = buildLightbox();

      setTimeout(function () {
        bindImages();
      }, 400);

      loadHighlightJS(function () {
        addCopyButtons();
        highlightAll();
        setTimeout(function () { addCopyButtons(); highlightAll(); }, 1000);
      });

      setTimeout(buildTOC, 500);

      applyFontSize();
      applyWidth();

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