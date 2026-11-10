// ==UserScript==
// @name         知乎 · Paper Press 阅读模式
// @namespace    https://github.com/hahapkpk/tools
// @version      3.0.0
// @description  知乎专栏 / 问答沉浸阅读：现代 · 浅色 · 古风 · 暗黑四套主题，悬浮目录、代码高亮、图片灯箱、位置记忆、字号行距宽度调节
// @author       hahapkpk
// @match        https://zhuanlan.zhihu.com/p/*
// @match        https://www.zhihu.com/question/*
// @grant        GM_getValue
// @grant        GM_setValue
// @noframes
// @license      MIT
// @homepageURL  https://github.com/hahapkpk/tools
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/zhihu-paper-press.user.js
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/zhihu-paper-press.user.js
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════
     0 · 工具
     ══════════════════════════════════════════════════════════════ */

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const on = (el, ev, fn, opt) => el.addEventListener(ev, fn, opt);

  function rafThrottle(fn) {
    let queued = false;
    return function (...args) {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        fn.apply(this, args);
      });
    };
  }

  function debounce(fn, wait) {
    let timer = null;
    return function (...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(this, args);
      }, wait);
    };
  }

  // document-start 时 head 可能还不存在
  function appendToHead(el) {
    if (el.parentNode) return;
    if (document.head) {
      document.head.appendChild(el);
      return;
    }
    const obs = new MutationObserver(() => {
      if (document.head) {
        obs.disconnect();
        document.head.appendChild(el);
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  /* ══════════════════════════════════════════════════════════════
     1 · 设置存储（GM 跨域共享，回退 localStorage）
     ══════════════════════════════════════════════════════════════ */

  const HAS_GM = (() => {
    try {
      return typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
    } catch (e) {
      return false;
    }
  })();

  const STORE = {
    get(key, fallback) {
      try {
        const raw = HAS_GM ? GM_getValue(key) : localStorage.getItem('pp_' + key);
        if (raw === undefined || raw === null) return fallback;
        const val = HAS_GM ? raw : JSON.parse(raw);
        return val === undefined || val === null ? fallback : val;
      } catch (e) {
        return fallback;
      }
    },
    set(key, val) {
      try {
        if (HAS_GM) GM_setValue(key, val);
        else localStorage.setItem('pp_' + key, JSON.stringify(val));
      } catch (e) {}
    }
  };

  // 内存中的唯一副本：热路径只读对象属性，不再触发同步存储读取
  const S = {
    theme: STORE.get('theme', 'auto'),
    width: STORE.get('width', 'standard'),
    customWidth: clamp(+STORE.get('customWidth', 860) || 860, 420, 1600),
    fontSize: clamp(+STORE.get('fontSize', 18) || 18, 14, 24),
    lineHeight: clamp(+STORE.get('lineHeight', 1.85) || 1.85, 1.5, 2.3)
  };

  const save = (key) => STORE.set(key, S[key]);

  /* ══════════════════════════════════════════════════════════════
     2 · 主题
     ══════════════════════════════════════════════════════════════ */

  const GRAIN = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220">' +
    '<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"/></filter>' +
    '<rect width="100%" height="100%" filter="url(#n)" opacity="0.55"/></svg>'
  );

  const HL_LIGHT = `
    .hljs{background:transparent!important;color:inherit!important;padding:0!important;}
    .hljs-keyword,.hljs-selector-tag,.hljs-type{color:#a626a4;}
    .hljs-string,.hljs-addition{color:#0a7d55;}
    .hljs-comment,.hljs-quote{color:#9aa2ad;font-style:italic;}
    .hljs-number,.hljs-literal{color:#1f6feb;}
    .hljs-title,.hljs-section,.hljs-built_in{color:#6f42c1;}
    .hljs-attr,.hljs-attribute,.hljs-variable{color:#b45309;}
    .hljs-meta{color:#5b6472;}
  `;

  const HL_DARK = `
    .hljs{background:transparent!important;color:inherit!important;padding:0!important;}
    .hljs-keyword,.hljs-selector-tag,.hljs-type{color:#ff8fa3;}
    .hljs-string,.hljs-addition{color:#8fd6a8;}
    .hljs-comment,.hljs-quote{color:#6f7681;font-style:italic;}
    .hljs-number,.hljs-literal{color:#82b1ff;}
    .hljs-title,.hljs-section,.hljs-built_in{color:#d2a8ff;}
    .hljs-attr,.hljs-attribute,.hljs-variable{color:#ffb86c;}
    .hljs-meta{color:#9aa2ad;}
  `;

  const THEMES = {
    modern: {
      label: '现代',
      vars: {
        shell: '#f1f3f7', surface: '#ffffff', surface2: '#f6f8fb', surface3: '#f0f3f8',
        text: '#0d1117', text2: '#262c36', mute: '#5b6472', faint: '#98a2b3', rule: '#e4e8ee',
        accent: '#2f6bff', 'accent-soft': 'rgba(47,107,255,.09)', 'accent-glow': 'rgba(47,107,255,.28)',
        r: '12px', letter: '-0.011em', 'title-weight': '700',
        shadow: '0 1px 2px rgba(16,24,40,.04), 0 16px 40px rgba(16,24,40,.07)',
        'font-display': 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif',
        'font-body': 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif',
        'font-mono': '"SF Mono", Consolas, "JetBrains Mono", monospace'
      },
      extras: HL_LIGHT
    },

    paper: {
      label: '浅色',
      vars: {
        shell: '#e8e1d2', surface: '#fcf8ef', surface2: '#f4eddd', surface3: '#efe7d5',
        text: '#1b1712', text2: '#2f2a22', mute: '#6d6558', faint: '#a29a8a', rule: '#ddd2bc',
        accent: '#c0442e', 'accent-soft': 'rgba(192,68,46,.10)', 'accent-glow': 'rgba(192,68,46,.25)',
        r: '6px', letter: '0', 'title-weight': '700',
        shadow: '0 1px 0 #ddd2bc, 0 18px 46px rgba(60,45,25,.10)',
        'font-display': '"Songti SC", "STSong", "SimSun", "Noto Serif SC", serif',
        'font-body': 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
        'font-mono': '"SF Mono", Consolas, monospace'
      },
      extras: `
        .Post-Main.Post-NormalMain::before,.QuestionHeader::before,.List-item::before{
          content:"";position:absolute;inset:0;z-index:0;pointer-events:none;border-radius:inherit;
          background-image:url(${GRAIN});background-size:220px 220px;mix-blend-mode:multiply;opacity:.16;
        }
      ` + HL_LIGHT
    },

    classic: {
      label: '古风',
      vars: {
        shell: '#ddd2b6', surface: '#f7f0dc', surface2: '#efe5ca', surface3: '#e9dec0',
        text: '#241d13', text2: '#382d1e', mute: '#6b5c45', faint: '#9b8c72', rule: '#cdbc98',
        accent: '#9c2b21', 'accent-soft': 'rgba(156,43,33,.10)', 'accent-glow': 'rgba(156,43,33,.28)',
        r: '2px', letter: '0.02em', 'title-weight': '700',
        shadow: '0 1px 0 #cdbc98, 0 14px 34px rgba(70,55,30,.12)',
        'font-display': '"Songti SC", "STSong", "SimSun", "Noto Serif SC", serif',
        'font-body': '"Songti SC", "STSong", "SimSun", serif',
        'font-mono': '"Courier New", Consolas, monospace'
      },
      extras: `
        /* 内框双线 */
        .Post-Main.Post-NormalMain::before,.QuestionHeader::before,.List-item::before{
          content:"";position:absolute;inset:9px;z-index:0;pointer-events:none;
          border:1px solid var(--pp-rule);border-radius:1px;
        }
        /* 标题居中 + 朱砂短线 */
        .Post-RichTextContainer h2,.ztext h2{text-align:center!important;padding-bottom:.55em!important;}
        .Post-RichTextContainer h2::after,.ztext h2::after{
          left:50%;transform:translateX(-50%);width:34px;height:2px;border-radius:0;
        }
        /* 首字下沉 */
        .Post-RichTextContainer>p:first-of-type::first-letter,
        .ztext>p:first-of-type::first-letter{
          float:left;font-size:3.1em;line-height:.86;padding:.08em .14em 0 0;
          color:var(--pp-accent);font-weight:700;
        }
        /* 标题与作者居中，页眉改用短线收束 */
        .Post-Title,.QuestionHeader-title{text-align:center!important;}
        .Post-Header{
          border-bottom:none!important;padding-bottom:0!important;text-align:center!important;
        }
        .Post-Header::after{
          content:"";display:block;width:56px;height:1px;background:var(--pp-rule);margin:22px auto 0;
        }
        .Post-Author{justify-content:center!important;}
        /* 直角边处理 */
        .Post-RichTextContainer blockquote,.ztext blockquote{
          border-left-width:2px!important;border-radius:0!important;background:var(--pp-surface2)!important;
        }
        .Post-RichTextContainer img,.ztext img{border-radius:0!important;}
        .Post-RichTextContainer pre,.ztext pre{border-radius:0!important;}
      ` + HL_LIGHT
    },

    dark: {
      label: '暗黑',
      vars: {
        shell: '#0a0a0b', surface: '#151619', surface2: '#1c1e22', surface3: '#22252a',
        text: '#eae8e4', text2: '#d3d0ca', mute: '#8b8b90', faint: '#5c5c63', rule: '#2a2d33',
        accent: '#ff6b4a', 'accent-soft': 'rgba(255,107,74,.14)', 'accent-glow': 'rgba(255,107,74,.35)',
        r: '12px', letter: '0', 'title-weight': '700',
        shadow: '0 1px 0 #2a2d33, 0 20px 50px rgba(0,0,0,.5)',
        'font-display': '"Songti SC", "STSong", "SimSun", serif',
        'font-body': 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
        'font-mono': '"SF Mono", Consolas, monospace'
      },
      extras: `
        .Post-Main.Post-NormalMain::after,.QuestionHeader::after,.List-item::after{
          content:"";position:absolute;inset:0;z-index:0;pointer-events:none;border-radius:inherit;
          background:radial-gradient(120% 90% at 50% 0%, rgba(255,255,255,.035), transparent 62%);
        }
        /* 夜间图片降亮，避免刺眼 */
        .Post-RichTextContainer img,.ztext img{filter:brightness(.86) contrast(1.02);}
        .Post-RichTextContainer img:hover,.ztext img:hover{filter:none;}
      ` + HL_DARK
    }
  };

  const THEME_ORDER = ['modern', 'paper', 'classic', 'dark'];

  const resolveTheme = () => {
    if (S.theme !== 'auto' && THEMES[S.theme]) return S.theme;
    try {
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'paper';
    } catch (e) {
      return 'paper';
    }
  };

  /* ══════════════════════════════════════════════════════════════
     3 · 页面上下文（每次导航重算，SPA 换文安全）
     ══════════════════════════════════════════════════════════════ */

  const CTX = { page: null, scope: '', href: '', key: null };

  function detectPage() {
    const p = location.pathname;
    if (/^\/p\/\d+/.test(p)) return 'column';
    if (/^\/question\/\d+/.test(p)) return 'question';
    // 兜底：按 DOM 判断（镜像站 / 测试夹具）
    if ($('.Post-Main, .Post-RichTextContainer')) return 'column';
    if ($('.QuestionHeader, .Question-main')) return 'question';
    return null;
  }

  function positionKey() {
    const p = location.pathname;
    let m;
    if ((m = p.match(/\/answer\/(\d+)/))) return 'pos_a_' + m[1];
    if ((m = p.match(/\/p\/(\d+)/))) return 'pos_p_' + m[1];
    if ((m = p.match(/\/question\/(\d+)/))) return 'pos_q_' + m[1];
    return null;
  }

  function refreshContext(force) {
    if (!force && CTX.href === location.href && CTX.page) return CTX;
    const page = detectPage();
    CTX.page = page;
    CTX.scope = page === 'question' ? '.ztext' : '.Post-RichTextContainer';
    CTX.href = location.href;
    CTX.key = positionKey();
    return CTX;
  }

  /* ══════════════════════════════════════════════════════════════
     4 · 样式（结构只建一次，换主题只换 CSS 变量）
     ══════════════════════════════════════════════════════════════ */

  const BASE_CSS = `
    /* ── 变量默认值 ── */
    :root{--pp-fs:18px;--pp-lh:1.85;--pp-w:860px;--pp-r:10px;--pp-letter:0;--pp-title-weight:700;}

    html{background:var(--pp-shell)!important;}
    body{
      background:var(--pp-shell)!important;color:var(--pp-text);
      font-family:var(--pp-font-body);-webkit-font-smoothing:antialiased;
    }

    /* ── 隐藏站点外壳 ── */
    .AppHeader,[class*="AppHeader"],.Sticky,.Sticky--holder,.LoadingBar,
    .Post-Row-Content-right,.Post-SideActions,.Post-Sub,.Post-topicsAndReviewer,.Post-actions,
    .Question-sideColumn,.QuestionHeader-side,.QuestionHeader-footer,.QuestionHeaderActions,
    .QuestionAnswers-answerButton,.AnswerAdd,.ContentItem-actions,.RichContent-actions,
    .Comments-container,.Recommendations-Main,.AppFooter,.Footer,.Pc-word,.Pc-feedOpr,
    .Catalog,.Catalog-content,.Catalog-Title,
    [data-za-module="AdItem"],[class*="Advertisement"]{display:none!important;}

    /* ── 专栏页布局 ── */
    .App-main{max-width:none!important;padding:0!important;background:transparent!important;}
    .Post-content{max-width:none!important;padding:0!important;background:transparent!important;}
    .Post-Row-Content{display:block!important;max-width:none!important;}
    .Post-Row-Content-left,.pp-col{
      float:none!important;width:100%!important;max-width:var(--pp-w)!important;
      margin:0 auto!important;padding:64px 32px 110px!important;
      box-sizing:border-box!important;transition:max-width .26s ease!important;
    }
    .pp-dragging .Post-Row-Content-left,.pp-dragging .pp-col{transition:none!important;}
    .pp-uncap{max-width:none!important;width:100%!important;box-sizing:border-box!important;}
    .pp-side{display:none!important;}

    /* ── 问答页布局 ── */
    .Question-main{display:block!important;max-width:none!important;padding:0!important;background:transparent!important;}
    .Question-mainColumn{
      width:100%!important;max-width:var(--pp-w)!important;margin:0 auto!important;
      padding:64px 32px 110px!important;box-sizing:border-box!important;float:none!important;
      transition:max-width .26s ease!important;
    }
    .QuestionHeader-content,.QuestionHeader-main{display:block!important;width:100%!important;padding:0!important;}
    .QuestionRichText,.QuestionHeader-detail{
      font-family:var(--pp-font-body)!important;color:var(--pp-mute)!important;line-height:1.75!important;
    }

    /* ── 卡片 ── */
    .Post-Main.Post-NormalMain,.QuestionHeader,.List-item{
      position:relative!important;background:var(--pp-surface)!important;
      border-radius:var(--pp-r)!important;box-shadow:var(--pp-shadow)!important;
      box-sizing:border-box!important;overflow:hidden!important;
    }
    .Post-Main.Post-NormalMain{padding:60px 64px!important;max-width:none!important;}
    .Post-Main.Post-NormalMain>*{position:relative;z-index:1;}
    .QuestionHeader{
      padding:34px 44px!important;margin:0 auto 18px!important;
      width:100%!important;max-width:var(--pp-w)!important;
    }
    .QuestionHeader>*{position:relative;z-index:1;}
    .List-item{
      padding:34px 44px!important;margin-bottom:18px!important;
      max-width:var(--pp-w)!important;
    }
    .List-item>*{position:relative;z-index:1;}
    .AnswerItem,.ContentItem,.AnswerCard,.RichContent,.RichContent-inner{
      background:transparent!important;box-shadow:none!important;border:none!important;
    }

    /* ── 标题 ── */
    .Post-Title{
      font-family:var(--pp-font-display)!important;font-size:calc(var(--pp-fs) * 2.05)!important;
      line-height:1.28!important;font-weight:var(--pp-title-weight)!important;
      color:var(--pp-text)!important;letter-spacing:var(--pp-letter)!important;
      margin:0 0 18px!important;word-break:break-word!important;
    }
    .QuestionHeader-title{
      font-family:var(--pp-font-display)!important;font-size:calc(var(--pp-fs) * 1.72)!important;
      line-height:1.32!important;font-weight:var(--pp-title-weight)!important;
      color:var(--pp-text)!important;letter-spacing:var(--pp-letter)!important;
      margin:.2em 0 .5em!important;
    }
    .Post-Header{
      padding-bottom:20px!important;margin-bottom:32px!important;
      border-bottom:1px solid var(--pp-rule)!important;
    }

    /* ── 作者 ── */
    .Post-Author{display:flex!important;align-items:center!important;gap:10px!important;}
    .AuthorInfo-avatar{
      width:36px!important;height:36px!important;border-radius:50%!important;
      border:1px solid var(--pp-rule)!important;
    }
    .AuthorInfo-name,.AuthorInfo-name a{
      font-family:var(--pp-font-body)!important;font-weight:600!important;
      font-size:14px!important;color:var(--pp-text)!important;
    }
    .AuthorInfo-detail,.AuthorInfo-badgeText{font-size:12px!important;color:var(--pp-mute)!important;}
    .List-item .AuthorInfo{margin-bottom:14px!important;padding-bottom:0!important;}

    /* ── 正文 ── */
    .Post-RichTextContainer,.ztext{
      font-family:var(--pp-font-body)!important;color:var(--pp-text2)!important;
      font-size:var(--pp-fs)!important;
    }
    .Post-RichTextContainer p,.ztext p{
      font-size:var(--pp-fs)!important;line-height:var(--pp-lh)!important;
      color:var(--pp-text2)!important;margin:0 0 1.3em!important;
      text-align:justify!important;letter-spacing:var(--pp-letter)!important;
    }
    .Post-RichTextContainer h2,.ztext h2{
      position:relative!important;font-family:var(--pp-font-display)!important;
      font-size:calc(var(--pp-fs) * 1.42)!important;line-height:1.42!important;
      font-weight:700!important;color:var(--pp-text)!important;
      letter-spacing:var(--pp-letter)!important;margin:2.1em 0 .9em!important;
      padding-bottom:.42em!important;scroll-margin-top:24px;
    }
    .Post-RichTextContainer h2::after,.ztext h2::after{
      content:"";position:absolute;left:0;bottom:0;width:42px;height:2px;
      border-radius:2px;background:var(--pp-accent);
    }
    .Post-RichTextContainer h3,.ztext h3{
      font-family:var(--pp-font-display)!important;font-size:calc(var(--pp-fs) * 1.2)!important;
      line-height:1.45!important;font-weight:600!important;color:var(--pp-text)!important;
      letter-spacing:var(--pp-letter)!important;margin:1.8em 0 .6em!important;scroll-margin-top:24px;
    }
    .Post-RichTextContainer h4,.Post-RichTextContainer h5,.Post-RichTextContainer h6,
    .ztext h4,.ztext h5,.ztext h6{
      font-family:var(--pp-font-body)!important;font-size:calc(var(--pp-fs) * 1.05)!important;
      font-weight:600!important;color:var(--pp-text)!important;margin:1.4em 0 .5em!important;
    }
    .Post-RichTextContainer ul,.Post-RichTextContainer ol,
    .ztext ul,.ztext ol{padding-left:1.4em!important;margin:0 0 1.3em!important;}
    .Post-RichTextContainer li,.ztext li{
      font-size:var(--pp-fs)!important;line-height:calc(var(--pp-lh) - .1)!important;
      color:var(--pp-text2)!important;margin-bottom:.35em!important;
    }
    .Post-RichTextContainer li::marker,.ztext li::marker{color:var(--pp-accent);}
    .Post-RichTextContainer a,.ztext a{
      color:var(--pp-accent)!important;text-decoration:none!important;
      border-bottom:1px solid var(--pp-accent-soft)!important;
      transition:border-color .2s,background .2s!important;
    }
    .Post-RichTextContainer a:hover,.ztext a:hover{
      border-bottom-color:var(--pp-accent)!important;background:var(--pp-accent-soft)!important;
    }

    /* 行内代码 */
    .Post-RichTextContainer code:not(pre code),.ztext code:not(pre code){
      font-family:var(--pp-font-mono)!important;font-size:.86em!important;
      background:var(--pp-surface3)!important;color:var(--pp-accent)!important;
      padding:1px 6px!important;border-radius:4px!important;border:1px solid var(--pp-rule)!important;
    }

    /* 代码块 */
    .Post-RichTextContainer pre,.ztext pre{
      position:relative!important;background:var(--pp-surface3)!important;
      border:1px solid var(--pp-rule)!important;border-radius:calc(var(--pp-r) - 2px)!important;
      padding:28px 22px 22px!important;margin:1.6em 0!important;overflow:auto!important;
      font-size:calc(var(--pp-fs) * .86)!important;line-height:1.7!important;
    }
    .Post-RichTextContainer pre code,.ztext pre code{
      font-family:var(--pp-font-mono)!important;background:transparent!important;
      color:var(--pp-text2)!important;padding:0!important;border:none!important;
      white-space:pre!important;font-size:1em!important;line-height:inherit!important;
    }

    /* 引用 */
    .Post-RichTextContainer blockquote,.ztext blockquote{
      font-family:var(--pp-font-display)!important;font-style:italic!important;
      font-size:calc(var(--pp-fs) * 1.02)!important;line-height:var(--pp-lh)!important;
      color:var(--pp-mute)!important;background:var(--pp-surface2)!important;
      border-left:3px solid var(--pp-accent)!important;border-radius:0 6px 6px 0!important;
      padding:14px 22px!important;margin:1.7em 0!important;
    }

    /* 图片 */
    .Post-RichTextContainer figure,.ztext figure{margin:1.9em auto!important;max-width:100%!important;}
    .Post-RichTextContainer img,.ztext img{
      max-width:100%!important;height:auto!important;
      border-radius:calc(var(--pp-r) - 2px)!important;
      box-shadow:0 1px 0 var(--pp-rule),0 10px 30px rgba(0,0,0,.08)!important;
      cursor:zoom-in!important;
    }
    .Post-RichTextContainer figcaption,.ztext figcaption{
      font-size:calc(var(--pp-fs) * .78)!important;color:var(--pp-faint)!important;
      text-align:center!important;margin-top:10px!important;line-height:1.6!important;
    }

    /* 杂项 */
    .Post-RichTextContainer hr,.ztext hr{
      border:none!important;border-top:1px solid var(--pp-rule)!important;margin:2.6em 0!important;
    }
    .Post-RichTextContainer strong,.ztext strong{font-weight:600!important;color:var(--pp-text)!important;}
    .Post-RichTextContainer em,.ztext em{font-family:var(--pp-font-display)!important;font-style:italic!important;}
    .Post-RichTextContainer table,.ztext table{
      width:100%!important;border-collapse:collapse!important;margin:1.6em 0!important;
      font-size:calc(var(--pp-fs) * .88)!important;
    }
    .Post-RichTextContainer th,.Post-RichTextContainer td,
    .ztext th,.ztext td{border:1px solid var(--pp-rule)!important;padding:8px 12px!important;text-align:left!important;}
    .Post-RichTextContainer th,.ztext th{
      background:var(--pp-surface2)!important;font-weight:600!important;color:var(--pp-text)!important;
    }
    .Post-RichTextContainer sup,.ztext sup{font-size:.72em!important;}
    ::selection{background:var(--pp-accent-soft)!important;color:var(--pp-text)!important;}

    ::-webkit-scrollbar{width:10px;height:10px;}
    ::-webkit-scrollbar-track{background:transparent;}
    ::-webkit-scrollbar-thumb{background:var(--pp-rule);border-radius:6px;border:2px solid var(--pp-shell);}
    ::-webkit-scrollbar-thumb:hover{background:var(--pp-faint);}

    /* ── 进度条 ── */
    #pp-progress{
      position:fixed;top:0;left:0;height:2px;width:0;background:var(--pp-accent);
      z-index:2147483000;transition:width .09s linear;pointer-events:none;
    }

    /* ── 侧栏面板 ── */
    #pp-panel{
      position:fixed;right:14px;top:50%;transform:translateY(-50%);z-index:2147483001;
      display:flex;flex-direction:column;gap:3px;padding:5px;border-radius:14px;
      background:var(--pp-surface);border:1px solid var(--pp-rule);
      box-shadow:0 8px 28px rgba(0,0,0,.14);font-family:var(--pp-font-body);
      user-select:none;
    }
    #pp-panel button{
      width:38px;height:34px;padding:0;display:flex;align-items:center;justify-content:center;
      border:none;background:transparent;color:var(--pp-mute);cursor:pointer;
      border-radius:9px;font-family:inherit;font-size:15px;line-height:1;
      transition:background .16s,color .16s;
    }
    #pp-panel button:hover{background:var(--pp-accent-soft);color:var(--pp-accent);}
    #pp-panel .pp-i-sm{font-size:12px;font-weight:600;letter-spacing:-.02em;}
    #pp-panel .pp-hr{height:1px;background:var(--pp-rule);margin:2px 4px;}

    /* ── 浮层 ── */
    .pp-pop{
      position:fixed;z-index:2147483002;display:none;min-width:198px;padding:12px;
      border-radius:12px;background:var(--pp-surface);border:1px solid var(--pp-rule);
      box-shadow:0 16px 44px rgba(0,0,0,.2);
      font-family:var(--pp-font-body);color:var(--pp-text2);
    }
    .pp-pop.on{display:block;}
    .pp-pop-h{
      font-size:11px;letter-spacing:.08em;text-transform:uppercase;
      color:var(--pp-faint);margin:0 0 9px 2px;
    }
    .pp-chips{display:flex;flex-wrap:wrap;gap:6px;}
    .pp-chips button{
      padding:6px 10px;font-size:12px;line-height:1;border-radius:8px;
      border:1px solid var(--pp-rule);background:transparent;color:var(--pp-text2);
      cursor:pointer;font-family:inherit;transition:border-color .15s,color .15s,background .15s;
    }
    .pp-chips button:hover{border-color:var(--pp-accent);color:var(--pp-accent);}
    .pp-chips button.on{
      border-color:var(--pp-accent);color:var(--pp-accent);background:var(--pp-accent-soft);
    }
    .pp-row{display:flex;align-items:center;gap:8px;margin:9px 0;font-size:12px;color:var(--pp-mute);}
    .pp-row>span{width:26px;flex:none;}
    .pp-row input[type=range]{flex:1;height:3px;accent-color:var(--pp-accent);cursor:pointer;}
    .pp-row>b{
      width:36px;text-align:right;font-weight:600;color:var(--pp-text2);
      font-variant-numeric:tabular-nums;
    }
    .pp-wv{
      font-size:11px;color:var(--pp-faint);margin-top:8px;text-align:right;
      font-variant-numeric:tabular-nums;
    }

    /* ── 目录 ── */
    #pp-toc{
      position:fixed;left:14px;top:50%;transform:translateY(-50%);z-index:2147483000;
      max-width:196px;max-height:74vh;overflow-y:auto;padding:8px 4px;border-radius:12px;
      background:var(--pp-surface);border:1px solid var(--pp-rule);
      box-shadow:0 8px 28px rgba(0,0,0,.1);font-family:var(--pp-font-body);
    }
    #pp-toc::-webkit-scrollbar{width:4px;}
    #pp-toc::-webkit-scrollbar-thumb{border:none;background:var(--pp-rule);}
    #pp-toc a{
      display:block;padding:5px 12px;font-size:12px;line-height:1.5;color:var(--pp-faint);
      text-decoration:none!important;border-left:2px solid transparent;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      transition:color .16s,border-color .16s;
    }
    #pp-toc a:hover{color:var(--pp-text2);}
    #pp-toc a.on{color:var(--pp-accent);border-left-color:var(--pp-accent);}
    #pp-toc a.pp-h3{padding-left:24px;font-size:11.5px;}
    .pp-tight #pp-toc{display:none!important;}

    /* ── 灯箱 ── */
    #pp-lb{
      position:fixed;inset:0;z-index:2147483003;background:rgba(6,6,8,.92);
      display:flex;align-items:center;justify-content:center;
      opacity:0;pointer-events:none;transition:opacity .22s;
    }
    #pp-lb.on{opacity:1;pointer-events:auto;}
    #pp-lb img{
      max-width:92vw;max-height:88vh;border-radius:6px;
      box-shadow:0 30px 90px rgba(0,0,0,.6);cursor:default;
    }
    #pp-lb button{
      position:fixed;border:none;background:rgba(255,255,255,.1);color:#fff;
      cursor:pointer;display:flex;align-items:center;justify-content:center;
      transition:background .18s;
    }
    #pp-lb button:hover{background:rgba(255,255,255,.22);}
    #pp-lb .pp-lb-x{top:18px;right:20px;width:40px;height:40px;border-radius:50%;font-size:20px;}
    #pp-lb .pp-lb-nav{top:50%;transform:translateY(-50%);width:44px;height:68px;border-radius:10px;font-size:26px;}
    #pp-lb .pp-prev{left:18px;}
    #pp-lb .pp-next{right:18px;}
    #pp-lb .pp-count{
      position:fixed;bottom:22px;left:50%;transform:translateX(-50%);
      padding:4px 14px;border-radius:20px;background:rgba(255,255,255,.12);
      color:#fff;font-size:12px;font-family:var(--pp-font-body);
    }

    /* ── 拖拽手柄 ── */
    .pp-drag{
      position:fixed;top:50%;transform:translateY(-50%);width:18px;height:150px;
      z-index:2147482999;display:flex;align-items:center;justify-content:center;
      cursor:ew-resize;border-radius:6px;transition:background .18s;
    }
    .pp-drag:hover{background:var(--pp-accent-soft);}
    .pp-drag .pp-grip{
      width:3px;height:52px;border-radius:2px;background:var(--pp-accent);
      opacity:.42;transition:opacity .18s,width .18s;
    }
    .pp-drag:hover .pp-grip{opacity:1;width:5px;}
    .pp-dragging,.pp-dragging *{cursor:ew-resize!important;user-select:none!important;-webkit-user-select:none!important;}
    .pp-dragging .pp-grip{opacity:1!important;width:5px!important;}
    #pp-tip{
      position:fixed;top:64px;left:50%;transform:translateX(-50%);display:none;
      padding:6px 15px;border-radius:8px;background:var(--pp-accent);color:#fff;
      font-family:var(--pp-font-body);font-size:13px;font-weight:600;
      box-shadow:0 6px 20px var(--pp-accent-glow);pointer-events:none;
      z-index:2147483004;font-variant-numeric:tabular-nums;
    }

    /* ── 代码块按钮 ── */
    .pp-copy{
      position:absolute;top:8px;right:10px;z-index:2;padding:4px 10px;
      font-family:var(--pp-font-body);font-size:11px;background:var(--pp-surface2);
      color:var(--pp-mute);border:1px solid var(--pp-rule);border-radius:6px;
      cursor:pointer;opacity:0;transition:opacity .18s,color .18s,border-color .18s;
    }
    pre:hover .pp-copy,.pp-copy.ok{opacity:1;}
    .pp-copy:hover,.pp-copy.ok{color:var(--pp-accent);border-color:var(--pp-accent);}
    .pp-lang{
      position:absolute;top:9px;left:14px;font-family:var(--pp-font-mono);
      font-size:10px;letter-spacing:.1em;text-transform:uppercase;
      color:var(--pp-faint);pointer-events:none;user-select:none;
    }
    pre.pp-fold{max-height:320px!important;overflow:hidden!important;}
    pre.pp-fold::after{
      content:"";position:absolute;left:0;right:0;bottom:0;height:76px;
      background:linear-gradient(transparent,var(--pp-surface3));pointer-events:none;
    }
    .pp-more{
      position:absolute;bottom:10px;left:50%;transform:translateX(-50%);z-index:2;
      padding:3px 14px;font-family:var(--pp-font-body);font-size:11px;
      background:var(--pp-surface2);color:var(--pp-mute);border:1px solid var(--pp-rule);
      border-radius:6px;cursor:pointer;transition:color .18s,border-color .18s;
    }
    .pp-more:hover{color:var(--pp-accent);border-color:var(--pp-accent);}

    /* ── 专注模式 ── */
    .pp-focus #pp-panel,.pp-focus #pp-toc,.pp-focus #pp-progress,
    .pp-focus .pp-drag,.pp-focus .pp-pop,.pp-focus #pp-tip{display:none!important;}

    /* ── 响应式 ── */
    @media (max-width:820px){
      .Post-Row-Content-left,.pp-col,.Question-mainColumn{
        padding:20px 14px 90px!important;max-width:100%!important;
      }
      .Post-Main.Post-NormalMain{padding:28px 20px!important;}
      .QuestionHeader,.List-item{padding:24px 20px!important;max-width:100%!important;}
      #pp-toc,.pp-drag{display:none!important;}
      #pp-panel{top:auto;bottom:16px;right:50%;transform:translateX(50%);flex-direction:row;}
      .pp-pop{
        left:50%!important;transform:translateX(-50%);
        bottom:78px;top:auto!important;min-width:236px;
      }
    }

    @media print{
      #pp-panel,#pp-toc,#pp-progress,#pp-lb,.pp-drag,.pp-pop,#pp-tip{display:none!important;}
      html,body{background:#fff!important;}
      .Post-Main.Post-NormalMain,.QuestionHeader,.List-item{
        box-shadow:none!important;background:#fff!important;
      }
      .Post-Row-Content-left,.pp-col,.Question-mainColumn{
        padding:0!important;max-width:100%!important;
      }
    }
  `;

  let baseStyleEl = null;
  let themeStyleEl = null;

  function injectBaseCSS() {
    if (baseStyleEl) return;
    baseStyleEl = document.createElement('style');
    baseStyleEl.id = 'pp-base';
    baseStyleEl.textContent = BASE_CSS;
    appendToHead(baseStyleEl);
  }

  function applyTheme() {
    const id = resolveTheme();
    const theme = THEMES[id];
    const vars = Object.keys(theme.vars).map((k) => `--pp-${k}:${theme.vars[k]};`).join('');
    const css = `:root{${vars}}\n${theme.extras}`;

    if (!themeStyleEl) {
      themeStyleEl = document.createElement('style');
      themeStyleEl.id = 'pp-theme';
      appendToHead(themeStyleEl);
    }
    if (themeStyleEl.textContent !== css) themeStyleEl.textContent = css;

    document.documentElement.setAttribute('data-pp-theme', id);
    syncThemeChips();
  }

  /* ══════════════════════════════════════════════════════════════
     5 · 字号 / 行距 / 宽度（全部走 CSS 变量）
     ══════════════════════════════════════════════════════════════ */

  function applySizes() {
    const root = document.documentElement.style;
    root.setProperty('--pp-fs', S.fontSize + 'px');
    root.setProperty('--pp-lh', String(S.lineHeight));
    syncTypeUI();
  }

  function widthPx() {
    if (S.width === 'narrow') return 620;
    if (S.width === 'wide') return 1100;
    if (S.width === 'custom') return S.customWidth;
    return 860;
  }

  function applyWidth() {
    document.documentElement.style.setProperty('--pp-w', widthPx() + 'px');
    syncWidthChips();
    updateLayoutClasses();
    positionHandles();
  }

  /* ══════════════════════════════════════════════════════════════
     6 · 目录（增量重建 + IntersectionObserver 高亮）
     ══════════════════════════════════════════════════════════════ */

  let tocEl = null;
  let tocSig = '';
  let tocItems = [];
  let tocObserver = null;
  let activeSet = new Set();

  function collectHeadings() {
    if (!CTX.page) return [];
    if (CTX.page === 'question') {
      return $$('.Question-mainColumn .List-item, .Question-main .List-item');
    }
    return $$(CTX.scope + ' h2, ' + CTX.scope + ' h3');
  }

  function syncTOC() {
    if (!tocEl) return;
    const items = collectHeadings();

    let sig = String(items.length);
    for (let i = 0; i < items.length; i++) {
      if (!items[i].id) items[i].id = 'pp-h' + i + '-' + Math.random().toString(36).slice(2, 6);
      sig += ',' + items[i].id;
    }
    if (sig === tocSig) return;
    tocSig = sig;
    renderTOC(items);
  }

  function renderTOC(items) {
    tocEl.textContent = '';
    if (items.length < 2) {
      tocEl.style.display = 'none';
      tocItems = [];
      if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
      return;
    }
    tocEl.style.display = '';

    items.forEach((el, i) => {
      const a = document.createElement('a');
      a.href = '#' + el.id;
      a.className = el.tagName === 'H3' ? 'pp-h3' : 'pp-h2';
      const nameEl = CTX.page === 'question' ? $('.AuthorInfo-name', el) : null;
      const label = CTX.page === 'question'
        ? (nameEl ? nameEl.textContent.trim() : '')
        : (el.textContent || '').trim();
      a.textContent = label || '第 ' + (i + 1) + ' 节';
      a.title = a.textContent;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        markActive(el);
      });
      tocEl.appendChild(a);
    });

    observeTOC(items);
    updateLayoutClasses();
  }

  function observeTOC(items) {
    tocItems = items;
    if (tocObserver) { tocObserver.disconnect(); tocObserver = null; }
    if (!window.IntersectionObserver) return;

    activeSet = new Set();
    tocObserver = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) activeSet.add(en.target);
        else activeSet.delete(en.target);
      });
      let best = null;
      for (let i = 0; i < tocItems.length; i++) {
        if (activeSet.has(tocItems[i])) best = tocItems[i];
      }
      // 没有标题落在观察带里（长段落中段 / 已滚到底）时保留上一次高亮，
      // 只有回到顶部才清空，否则目录会频繁闪烁
      if (best) markActive(best);
      else if ((window.scrollY || 0) < 80) markActive(null);
    }, { rootMargin: '-60px 0px -76% 0px', threshold: 0 });

    items.forEach((el) => tocObserver.observe(el));
  }

  function markActive(el) {
    if (!tocEl) return;
    const target = el ? '#' + el.id : '';
    $$('a', tocEl).forEach((a) => {
      a.classList.toggle('on', a.getAttribute('href') === target);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     7 · 阅读进度 & 位置记忆
     ══════════════════════════════════════════════════════════════ */

  let progressEl = null;
  let restoreTimer = null;
  let restoring = false;

  const onScroll = rafThrottle(() => {
    if (progressEl) {
      const top = window.scrollY || document.documentElement.scrollTop || 0;
      const total = document.documentElement.scrollHeight - window.innerHeight;
      progressEl.style.width = (total > 0 ? clamp(top / total * 100, 0, 100) : 0) + '%';
    }
    // 无 IntersectionObserver 时的目录高亮兜底
    if (!window.IntersectionObserver && tocItems.length) {
      let active = null;
      for (let i = 0; i < tocItems.length; i++) {
        if (tocItems[i].getBoundingClientRect().top <= 100) active = tocItems[i];
      }
      markActive(active);
    }
  });

  function savePos() {
    if (restoring || !CTX.key) return;
    const y = Math.round(window.scrollY || 0);
    if (y < 80) return;
    STORE.set(CTX.key, y + '|' + Date.now());
    touchPosIndex(CTX.key);
  }

  function touchPosIndex(key) {
    let index = STORE.get('posIndex', []);
    if (!Array.isArray(index)) index = [];
    const cutoff = Date.now() - 30 * 864e5;
    index = index.filter((it) => it && it.t > cutoff && it.k !== key);
    index.push({ k: key, t: Date.now() });
    if (index.length > 200) index = index.slice(-200);
    STORE.set('posIndex', index);
  }

  function cancelRestore() {
    if (restoreTimer) { clearInterval(restoreTimer); restoreTimer = null; }
    restoring = false;
  }

  function restorePos() {
    if (!CTX.key) return;
    const raw = STORE.get(CTX.key, '');
    const y = parseInt(String(raw).split('|')[0], 10);
    if (!y || y < 120) return;

    cancelRestore();
    restoring = true;

    let lastH = -1;
    let stable = 0;
    let tries = 0;

    restoreTimer = setInterval(() => {
      tries++;
      const h = document.documentElement.scrollHeight;
      if (Math.abs(h - lastH) < 12) stable++; else stable = 0;
      lastH = h;

      const enough = h > y + window.innerHeight * 0.75;
      if ((stable >= 2 && enough) || tries >= 40) {
        clearInterval(restoreTimer);
        restoreTimer = null;
        const target = enough ? y : Math.max(0, Math.min(y, h - window.innerHeight));
        window.scrollTo(0, target);
        setTimeout(() => { restoring = false; }, 160);
      }
    }, 150);
  }

  /* ══════════════════════════════════════════════════════════════
     8 · 图片灯箱
     ══════════════════════════════════════════════════════════════ */

  let lbEl = null, lbImg = null, lbCount = null, lbPrev = null, lbNext = null;
  let lbList = [], lbIdx = 0, lbOpen = false, prevBodyOverflow = '';

  function buildLightbox() {
    const d = document.createElement('div');
    d.id = 'pp-lb';
    d.innerHTML =
      '<img alt="">' +
      '<button class="pp-lb-x" type="button" title="关闭 (Esc)">×</button>' +
      '<button class="pp-lb-nav pp-prev" type="button" title="上一张 (←)">‹</button>' +
      '<button class="pp-lb-nav pp-next" type="button" title="下一张 (→)">›</button>' +
      '<div class="pp-count"></div>';
    document.body.appendChild(d);

    lbEl = d;
    lbImg = $('img', d);
    lbCount = $('.pp-count', d);
    lbPrev = $('.pp-prev', d);
    lbNext = $('.pp-next', d);

    d.addEventListener('click', (e) => { if (e.target === d) closeLightbox(); });
    $('.pp-lb-x', d).addEventListener('click', closeLightbox);
    lbPrev.addEventListener('click', (e) => { e.stopPropagation(); stepLightbox(-1); });
    lbNext.addEventListener('click', (e) => { e.stopPropagation(); stepLightbox(1); });
  }

  function imgSrc(img) {
    const s = img.getAttribute('data-original') || img.getAttribute('data-actualsrc') ||
      img.getAttribute('data-src') || img.currentSrc || img.src || '';
    return s.indexOf('data:') === 0 ? '' : s;
  }

  // 知乎 _b 为约 1080px 大图，_r 为原图；失败时自动回退
  function hiRes(src) {
    if (src.indexOf('zhimg.com') === -1) return src;
    const up = src.replace(/_b\.(jpg|jpeg|png|webp|gif)$/i, '_r.$1');
    return up === src ? src : up;
  }

  function openLightbox(img) {
    const list = [];
    const seen = Object.create(null);
    $$(CTX.scope + ' img').forEach((node) => {
      const s = imgSrc(node);
      if (!s || seen[s]) return;
      seen[s] = 1;
      list.push({ el: node, src: s });
    });

    lbList = list;
    const found = list.findIndex((it) => it.el === img);
    lbIdx = found < 0 ? 0 : found;
    lbOpen = true;

    const multi = list.length > 1;
    lbPrev.style.display = multi ? '' : 'none';
    lbNext.style.display = multi ? '' : 'none';
    lbCount.style.display = multi ? '' : 'none';

    prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    lbEl.classList.add('on');
    paintLightbox();
  }

  function paintLightbox() {
    if (!lbList.length) return;
    const item = lbList[lbIdx];
    lbImg.onerror = function () {
      this.onerror = null;
      this.src = item.src;
    };
    lbImg.src = hiRes(item.src);
    lbCount.textContent = (lbIdx + 1) + ' / ' + lbList.length;
  }

  function stepLightbox(delta) {
    if (!lbList.length) return;
    lbIdx = (lbIdx + delta + lbList.length) % lbList.length;
    paintLightbox();
  }

  function closeLightbox() {
    if (!lbOpen) return;
    lbOpen = false;
    lbEl.classList.remove('on');
    document.body.style.overflow = prevBodyOverflow;
    setTimeout(() => { if (!lbOpen) lbImg.removeAttribute('src'); }, 240);
  }

  function bindImages() {
    if (!CTX.page) return;
    $$(CTX.scope + ' img').forEach((img) => {
      if (img._ppBound) return;
      img._ppBound = true;
      // 捕获阶段抢在知乎自己的看图器之前拦下事件
      img.addEventListener('click', (e) => {
        if (!imgSrc(img)) return;
        e.preventDefault();
        e.stopPropagation();
        openLightbox(img);
      }, true);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     9 · 代码块
     ══════════════════════════════════════════════════════════════ */

  const FOLD_LINES = 16;
  const HL_HOSTS = [
    'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0',
    'https://cdn.staticfile.org/highlight.js/11.9.0',
    'https://lib.baomitu.com/highlight.js/11.9.0'
  ];

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  function addCopyButtons() {
    if (!CTX.page) return;
    $$(CTX.scope + ' pre').forEach((pre) => {
      if (pre._ppCopy) return;
      const code = pre.querySelector('code');
      if (!code) return;
      pre._ppCopy = true;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pp-copy';
      btn.textContent = '复制';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        copyText(code.textContent || '').then((ok) => {
          btn.textContent = ok ? '已复制' : '失败';
          btn.classList.toggle('ok', ok);
          setTimeout(() => {
            btn.textContent = '复制';
            btn.classList.remove('ok');
          }, 1600);
        });
      });
      pre.appendChild(btn);
    });
  }

  function decorateCode() {
    if (!CTX.page) return;
    $$(CTX.scope + ' pre').forEach((pre) => {
      if (pre._ppDeco) return;
      pre._ppDeco = true;
      const code = pre.querySelector('code');
      if (!code) return;

      const cls = code.className || '';
      const m = cls.match(/language-([\w+#.-]+)/i) || cls.match(/lang-([\w+#.-]+)/i);
      if (m) {
        const tag = document.createElement('span');
        tag.className = 'pp-lang';
        tag.textContent = m[1];
        pre.appendChild(tag);
      }

      const lines = (code.textContent || '').split('\n').length;
      if (lines > FOLD_LINES) {
        pre.classList.add('pp-fold');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pp-more';
        btn.textContent = '展开 ' + lines + ' 行';
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const folded = pre.classList.toggle('pp-fold');
          btn.textContent = folded ? '展开 ' + lines + ' 行' : '收起';
        });
        pre.appendChild(btn);
      }
    });
  }

  function highlightAll() {
    if (!CTX.page || !window.hljs) return;
    $$(CTX.scope + ' pre code').forEach((block) => {
      if (block.dataset.ppHl === '1') return;
      block.dataset.ppHl = '1';
      try {
        window.hljs.highlightElement(block);
      } catch (e) {}
    });
  }

  function loadHighlight() {
    let i = 0;
    (function next() {
      if (i >= HL_HOSTS.length) return;
      const script = document.createElement('script');
      script.src = HL_HOSTS[i++] + '/highlight.min.js';

      let settled = false;
      // cdnjs 在国内多为挂起而非报错，必须有超时兜底
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        script.remove();
        next();
      }, 5000);

      script.onload = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        highlightAll();
      };
      script.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.remove();
        next();
      };
      appendToHead(script);
    })();
  }

  /* ══════════════════════════════════════════════════════════════
     10 · 列容器探测 & 拖拽调宽
     ══════════════════════════════════════════════════════════════ */

  const MIN_W = 420;
  const MAX_W = 1600;

  let colEl = null;
  let handles = null;
  let drag = null;
  let tipEl = null;

  const isOurUI = (el) => {
    if (!el || el.nodeType !== 1) return true;
    if (el.id && el.id.indexOf('pp-') === 0) return true;
    const cls = el.className;
    if (typeof cls === 'string') {
      return cls.split(/\s+/).some((t) => t.indexOf('pp-') === 0);
    }
    return false;
  };

  const isCardLike = (el) =>
    el.classList.contains('Post-Main') ||
    el.classList.contains('Post-NormalMain') ||
    el.classList.contains('QuestionHeader') ||
    el.classList.contains('List-item');

  function looksLikeSidebar(sib, colW) {
    const rect = sib.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    if (colW > 0 && rect.width > colW * 0.9) return false;
    if ($('.Question-sideColumn, .AuthorInfo, .RecommendList, .RelatedReadings, .SideBar, .Catalog', sib)) {
      return true;
    }
    return colW > 0 && rect.width < colW * 0.7;
  }

  function findColumnAncestor(anchor) {
    let el = anchor.parentElement;
    let depth = 0;
    while (el && el !== document.body && el !== document.documentElement && depth < 7) {
      const parent = el.parentElement;
      if (!parent || parent === document.body || parent === document.documentElement) break;

      const colW = el.getBoundingClientRect().width;
      let hit = false;
      Array.from(parent.children).forEach((sib) => {
        if (sib === el || sib.nodeType !== 1 || isOurUI(sib)) return;
        if (looksLikeSidebar(sib, colW)) {
          hit = true;
          sib.classList.add('pp-side');
        }
      });
      if (hit) return el;

      el = parent;
      depth++;
    }
    return null;
  }

  function detectColumn() {
    refreshContext();

    let col = null;
    if (CTX.page === 'question') {
      col = $('.Question-mainColumn') || $('.Question-main');
    } else if (CTX.page === 'column') {
      col = $('.Post-Row-Content-left');
    }

    if (!col && CTX.page) {
      const anchor = CTX.page === 'question'
        ? ($('.QuestionHeader') || $('.List-item'))
        : ($('.Post-Main.Post-NormalMain') || $('.Post-RichTextContainer') || $('.Post-Title'));
      if (anchor) col = findColumnAncestor(anchor);
    }

    // 退化到卡片本身会造成双层内边距，宁可不出手柄
    if (col && isCardLike(col)) col = null;

    $$('.pp-col').forEach((el) => { if (el !== col) el.classList.remove('pp-col'); });

    if (col) {
      col.classList.add('pp-col');
      let up = col.parentElement;
      let n = 0;
      while (up && up !== document.body && n < 6) {
        up.classList.add('pp-uncap');
        up = up.parentElement;
        n++;
      }
    }

    colEl = col;
    return col;
  }

  function getColumn() {
    if (colEl && document.contains(colEl)) return colEl;
    return detectColumn();
  }

  function buildHandles() {
    if (handles) {
      handles.left.remove();
      handles.right.remove();
    }
    const left = document.createElement('div');
    const right = document.createElement('div');
    left.className = 'pp-drag pp-drag-l';
    right.className = 'pp-drag pp-drag-r';
    left.title = right.title = '拖动调整宽度 · 双击恢复标准';
    left.innerHTML = '<div class="pp-grip"></div>';
    right.innerHTML = '<div class="pp-grip"></div>';

    document.body.appendChild(left);
    document.body.appendChild(right);
    handles = { left, right };

    left.addEventListener('pointerdown', (e) => startDrag(e, false));
    right.addEventListener('pointerdown', (e) => startDrag(e, true));
    left.addEventListener('dblclick', resetWidth);
    right.addEventListener('dblclick', resetWidth);

    positionHandles();
  }

  function positionHandles() {
    if (!handles) return;
    const col = getColumn();
    if (!col || window.innerWidth <= 820) {
      handles.left.style.display = 'none';
      handles.right.style.display = 'none';
      return;
    }
    const rect = col.getBoundingClientRect();
    if (rect.width >= window.innerWidth - 48) {
      handles.left.style.display = 'none';
      handles.right.style.display = 'none';
      return;
    }
    handles.left.style.display = '';
    handles.right.style.display = '';
    handles.left.style.left = (rect.left - 9) + 'px';
    handles.right.style.left = (rect.right - 9) + 'px';
  }

  function showTip(w) {
    if (!tipEl) return;
    tipEl.textContent = w + 'px';
    tipEl.style.display = 'block';
  }

  function hideTip() {
    if (tipEl) tipEl.style.display = 'none';
  }

  function startDrag(e, isRight) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const col = getColumn();
    if (!col) return;

    e.preventDefault();
    const w0 = col.getBoundingClientRect().width;
    drag = { right: isRight, x0: e.clientX, w0, w: Math.round(w0) };

    document.body.classList.add('pp-dragging');
    showTip(drag.w);

    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  }

  const onDragMove = rafThrottle((e) => {
    if (!drag) return;
    const delta = e.clientX - drag.x0;
    const raw = drag.right ? drag.w0 + 2 * delta : drag.w0 - 2 * delta;
    const w = Math.round(clamp(raw, MIN_W, MAX_W));
    if (w === drag.w) return;
    drag.w = w;
    document.documentElement.style.setProperty('--pp-w', w + 'px');
    showTip(w);
    positionHandles();
  });

  function endDrag() {
    if (!drag) return;
    const w = drag.w;
    drag = null;

    document.body.classList.remove('pp-dragging');
    hideTip();
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);

    S.width = 'custom';
    S.customWidth = w;
    save('width');
    save('customWidth');
    syncWidthChips();
    updateLayoutClasses();
    positionHandles();
  }

  function resetWidth(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    S.width = 'standard';
    S.customWidth = 860;
    save('width');
    save('customWidth');
    applyWidth();
  }

  function updateLayoutClasses() {
    const col = colEl;
    if (!col || !document.body) return;
    const rect = col.getBoundingClientRect();
    const free = (window.innerWidth - rect.width) / 2;
    document.body.classList.toggle('pp-tight', free < 208);
  }

  /* ══════════════════════════════════════════════════════════════
     11 · 动态内容
     ══════════════════════════════════════════════════════════════ */

  let contentObserver = null;
  let contentTarget = null;
  let observeRetry = null;

  function pruneQuestion() {
    ['.Question-sideColumn', '.QuestionHeader-side', '.QuestionHeader-footer',
      '.QuestionHeaderActions', '.ContentItem-actions', '.RichContent-actions',
      '.QuestionAnswers-answerButton', '.AnswerAdd'].forEach((sel) => {
      $$(sel).forEach((el) => { el.style.display = 'none'; });
    });
  }

  // 只隐藏不删除 —— 物理删除知乎 React 节点会让它后续渲染报错
  const OVERLAY_SEL = '[role="dialog"], .Modal, .Modal-wrapper, [class*="Modal-"], ' +
    '[class*="signFlow"], [class*="LoginModal"], [class*="Drawer"]';

  function hideOverlays() {
    $$(OVERLAY_SEL).forEach((el) => {
      if (isOurUI(el)) return;
      if (el.style.display !== 'none') el.style.display = 'none';
    });
  }

  function cleanTitle() {
    const t = document.title;
    const c = t.replace(/\s*-\s*知乎专栏$/, '').replace(/\s*-\s*知乎$/, '');
    if (c !== t) document.title = c;
  }

  function processContent() {
    refreshContext();
    try {
      addCopyButtons();
      decorateCode();
      highlightAll();
      bindImages();
      if (CTX.page === 'question') pruneQuestion();
      syncTOC();
      detectColumn();
      positionHandles();
      updateLayoutClasses();
    } catch (e) {
      /* 站点结构变动时静默降级，避免中断后续渲染 */
    } finally {
      observeContent();
    }
  }

  const scheduleProcess = debounce(processContent, 220);

  function observeContent() {
    refreshContext();
    let target = null;
    if (CTX.page === 'question') {
      target = $('.Question-mainColumn') || $('.Question-main') || $('.ListShortcut');
    } else if (CTX.page === 'column') {
      target = $(CTX.scope) || $('.Post-Main');
    }
    if (!target) {
      if (!observeRetry) {
        observeRetry = setTimeout(() => {
          observeRetry = null;
          observeContent();
        }, 500);
      }
      return;
    }
    if (contentTarget === target && contentObserver) return;

    if (contentObserver) contentObserver.disconnect();
    contentTarget = target;
    contentObserver = new MutationObserver((muts) => {
      for (let i = 0; i < muts.length; i++) {
        if (muts[i].addedNodes && muts[i].addedNodes.length) {
          scheduleProcess();
          return;
        }
      }
    });
    contentObserver.observe(target, { childList: true, subtree: true });
  }

  /* ══════════════════════════════════════════════════════════════
     12 · 界面
     ══════════════════════════════════════════════════════════════ */

  let panelEl = null;
  let popTheme = null;
  let popType = null;

  function buildChrome() {
    progressEl = document.createElement('div');
    progressEl.id = 'pp-progress';
    document.body.appendChild(progressEl);

    tocEl = document.createElement('nav');
    tocEl.id = 'pp-toc';
    tocEl.style.display = 'none';
    document.body.appendChild(tocEl);

    panelEl = document.createElement('div');
    panelEl.id = 'pp-panel';
    panelEl.innerHTML =
      '<button type="button" data-act="theme" title="切换主题 (T)"><span class="pp-i">◐</span></button>' +
      '<button type="button" data-act="type" title="字号 / 行距 / 宽度"><span class="pp-i pp-i-sm">Aa</span></button>' +
      '<div class="pp-hr"></div>' +
      '<button type="button" data-act="top" title="回到顶部 (Home)"><span class="pp-i">↑</span></button>' +
      '<button type="button" data-act="focus" title="专注模式 (F)"><span class="pp-i">◉</span></button>';
    document.body.appendChild(panelEl);

    popTheme = document.createElement('div');
    popTheme.className = 'pp-pop';
    popTheme.id = 'pp-pop-theme';
    popTheme.innerHTML =
      '<div class="pp-pop-h">主题</div><div class="pp-chips">' +
      THEME_ORDER.map((id) => `<button type="button" data-theme="${id}">${THEMES[id].label}</button>`).join('') +
      '<button type="button" data-theme="auto">跟随系统</button></div>';
    document.body.appendChild(popTheme);

    popType = document.createElement('div');
    popType.className = 'pp-pop';
    popType.id = 'pp-pop-type';
    popType.innerHTML =
      '<div class="pp-pop-h">排版</div>' +
      '<label class="pp-row"><span>字号</span><input type="range" id="pp-fs" min="14" max="24" step="1"><b id="pp-fs-v"></b></label>' +
      '<label class="pp-row"><span>行距</span><input type="range" id="pp-lh" min="1.5" max="2.3" step="0.05"><b id="pp-lh-v"></b></label>' +
      '<div class="pp-chips" id="pp-w-chips" style="margin-top:10px">' +
      '<button type="button" data-w="narrow">窄 620</button>' +
      '<button type="button" data-w="standard">标准 860</button>' +
      '<button type="button" data-w="wide">宽 1100</button></div>' +
      '<div class="pp-wv" id="pp-w-v"></div>';
    document.body.appendChild(popType);

    tipEl = document.createElement('div');
    tipEl.id = 'pp-tip';
    document.body.appendChild(tipEl);

    bindChrome();
    syncTypeUI();
    syncWidthChips();
    syncThemeChips();
  }

  function bindChrome() {
    const actions = {
      theme: () => togglePop(popTheme, $('[data-act="theme"]', panelEl)),
      type: () => togglePop(popType, $('[data-act="type"]', panelEl)),
      top: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
      focus: () => document.body.classList.toggle('pp-focus')
    };
    panelEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const fn = actions[btn.getAttribute('data-act')];
      if (fn) fn();
    });

    popTheme.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-theme]');
      if (!btn) return;
      S.theme = btn.getAttribute('data-theme');
      save('theme');
      applyTheme();
      closePops();
    });

    const fsInput = $('#pp-fs', popType);
    const lhInput = $('#pp-lh', popType);
    fsInput.addEventListener('input', () => {
      S.fontSize = clamp(+fsInput.value, 14, 24);
      save('fontSize');
      applySizes();
    });
    lhInput.addEventListener('input', () => {
      S.lineHeight = clamp(+lhInput.value, 1.5, 2.3);
      save('lineHeight');
      applySizes();
    });

    $('#pp-w-chips', popType).addEventListener('click', (e) => {
      const btn = e.target.closest('[data-w]');
      if (!btn) return;
      S.width = btn.getAttribute('data-w');
      save('width');
      applyWidth();
    });

    on(document, 'click', (e) => {
      if (e.target.closest('.pp-pop') || e.target.closest('#pp-panel')) return;
      closePops();
    }, true);
  }

  function togglePop(pop, btn) {
    if (pop.classList.contains('on')) {
      pop.classList.remove('on');
      return;
    }
    closePops();
    pop.classList.add('on');
    const r = btn.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    const top = clamp(r.top + r.height / 2 - pr.height / 2, 12, window.innerHeight - pr.height - 12);
    let left = r.left - pr.width - 10;
    if (left < 12) left = r.right + 10;
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
  }

  function closePops() {
    [popTheme, popType].forEach((p) => { if (p) p.classList.remove('on'); });
  }

  function syncThemeChips() {
    if (!popTheme) return;
    $$('[data-theme]', popTheme).forEach((b) => {
      b.classList.toggle('on', b.getAttribute('data-theme') === S.theme);
    });
  }

  function syncTypeUI() {
    if (!popType) return;
    $('#pp-fs', popType).value = S.fontSize;
    $('#pp-lh', popType).value = S.lineHeight;
    $('#pp-fs-v', popType).textContent = S.fontSize;
    $('#pp-lh-v', popType).textContent = S.lineHeight.toFixed(2);
  }

  function syncWidthChips() {
    if (!popType) return;
    $$('[data-w]', popType).forEach((b) => {
      b.classList.toggle('on', b.getAttribute('data-w') === S.width);
    });
    const el = $('#pp-w-v', popType);
    if (el) el.textContent = widthPx() + 'px';
  }

  /* ══════════════════════════════════════════════════════════════
     13 · 键盘
     ══════════════════════════════════════════════════════════════ */

  function bindKeyboard() {
    on(document, 'keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      const tag = ((t && t.tagName) || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) return;

      if (lbOpen) {
        if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); stepLightbox(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); stepLightbox(1); }
        return;
      }

      switch (e.key) {
        case '-':
        case '_':
          S.fontSize = clamp(S.fontSize - 1, 14, 24); save('fontSize'); applySizes(); break;
        case '=':
        case '+':
          S.fontSize = clamp(S.fontSize + 1, 14, 24); save('fontSize'); applySizes(); break;
        case '[':
        case '{':
          S.lineHeight = clamp(Math.round((S.lineHeight - 0.05) * 100) / 100, 1.5, 2.3);
          save('lineHeight'); applySizes(); break;
        case ']':
        case '}':
          S.lineHeight = clamp(Math.round((S.lineHeight + 0.05) * 100) / 100, 1.5, 2.3);
          save('lineHeight'); applySizes(); break;
        case 't':
        case 'T': {
          const idx = THEME_ORDER.indexOf(resolveTheme());
          S.theme = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
          save('theme');
          applyTheme();
          break;
        }
        case 'f':
        case 'F':
          document.body.classList.toggle('pp-focus');
          break;
        case 'Escape':
          document.body.classList.remove('pp-focus');
          closePops();
          break;
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════
     14 · 启动
     ══════════════════════════════════════════════════════════════ */

  let lastHref = location.href;

  function watchNavigation() {
    setInterval(() => {
      // 换文检测必须无条件执行：后台标签页里也可能发生 SPA 跳转，
      // 一旦跳过，等用户切回来时正文已经是一篇没有被处理过的文章
      if (location.href !== lastHref) {
        lastHref = location.href;
        refreshContext(true);
        tocSig = '';
        colEl = null;
        $$('.pp-col').forEach((el) => el.classList.remove('pp-col'));
        $$('.pp-uncap').forEach((el) => el.classList.remove('pp-uncap'));
        $$('.pp-side').forEach((el) => el.classList.remove('pp-side'));
        if (!CTX.page) return;
        detectColumn();
        processContent();
        observeContent();
        applyWidth();
        cleanTitle();
        setTimeout(restorePos, 400);
        return;
      }

      if (document.hidden) return;
      if (!contentTarget || !document.contains(contentTarget)) observeContent();
    }, 1000);
  }

  function watchBody() {
    const check = debounce(() => {
      hideOverlays();
      cleanTitle();
    }, 300);
    new MutationObserver(check).observe(document.body, { childList: true });
  }

  function bindGlobal() {
    on(window, 'scroll', onScroll, { passive: true });
    on(window, 'scroll', debounce(savePos, 600), { passive: true });
    on(window, 'pagehide', savePos);
    on(window, 'beforeunload', savePos);
    on(window, 'wheel', cancelRestore, { passive: true });
    on(window, 'touchstart', cancelRestore, { passive: true });
    on(window, 'resize', rafThrottle(() => {
      positionHandles();
      updateLayoutClasses();
      closePops();
    }));

    try {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => { if (S.theme === 'auto') applyTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    } catch (e) {}

    bindKeyboard();
  }

  function start() {
    if (!document.body) {
      setTimeout(start, 60);
      return;
    }

    buildChrome();
    buildLightbox();
    buildHandles();

    detectColumn();
    applyWidth();
    processContent();
    observeContent();
    bindGlobal();
    watchBody();
    watchNavigation();

    hideOverlays();
    cleanTitle();
    setTimeout(restorePos, 500);
    loadHighlight();
  }

  function boot() {
    refreshContext();
    injectBaseCSS();
    applyTheme();
    applySizes();

    if (document.readyState === 'loading') {
      on(document, 'DOMContentLoaded', start);
    } else {
      start();
    }
  }

  boot();
})();
