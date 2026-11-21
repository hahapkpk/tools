// ==UserScript==
// @name         Economist Unlock 2026 — Next.js body 还原版
// @namespace    https://github.com/seagull-econ-unlock
// @version      1.0.0
// @description  经济学人付费墙解锁：从 #__NEXT_DATA__ 的 props.pageProps.content.body 还原正文，移除 regwall；多级回退取全文。基于对 economist.com 2026-11 页面结构的实测。
// @author       Seagull
// @match        *://*.economist.com/*
// @grant        GM_xmlhttpRequest
// @connect      economist.com
// @connect      r.jina.ai
// @connect      archive.today
// @connect      archive.ph
// @run-at       document_idle
// @license      MIT
// ==/UserScript==

/*
 * 实测结论（2026-11-21，目标文章 Deeper collusion between hostile powers...）：
 *  1) 老脚本（vivek9patel / 449408）依赖 .paywall / content.text —— 已全部失效。
 *  2) 现代页面：全文数据路径 = #__NEXT_DATA__ -> props -> pageProps -> content -> body[]
 *     body 元素形如 {type:"PARAGRAPH", text:"...", textHtml:"<span ...>..."}
 *  3) 未登录 SSR 下 body 只有 1 段（免费预览），walled=true，paywallCheck.shouldDropPaywall=false。
 *  4) 付费墙 DOM 选择器：#tp-regwall / .layout-article-regwall；正文容器：[data-body-id]>div。
 *  5) 服务器按 UA/IP/cookie 决定下发段数，Cloudflare 挡直连 → 故用多级回退。
 *
 * 用法：装 Tampermonkey/Violentmonkey → 新建脚本粘贴 → 打开经济学人文章 →
 *      页面自动还原可用正文；点右下角「取全文」按 Googlebot→Jina→Archive 顺序回退。
 */

(function () {
  'use strict';

  var CFG = {
    wallSelectors: [
      '#tp-regwall',
      '.layout-article-regwall',
      '.paywall',
      '.subscription-benefits',
      '[class*="regwall"]'
    ],
    hostSelectors: [
      '[data-body-id] > div',
      '#content',
      'article .article__body',
      '.article-body',
      'main article',
      'main'
    ],
    googlebotUA:
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    statusId: '__econ_unlock_status__'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function log() {
    try { console.log('[EconomistUnlock]', ...arguments); } catch (e) {}
  }

  /* ---------- 1. 干掉付费墙 DOM，恢复滚动 ---------- */
  // 轻量版：只删选择器命中的墙，供 MutationObserver 高频调用
  function killWallLight() {
    CFG.wallSelectors.forEach(function (sel) {
      try {
        document.querySelectorAll(sel).forEach(function (el) { el.remove(); });
      } catch (e) {}
    });
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
  }

  // 重量版：额外扫全页遮罩/模糊层，只在初始化时调用一次
  function killWall() {
    killWallLight();
    try {
      document.querySelectorAll('body *').forEach(function (el) {
        var st = getComputedStyle(el);
        if ((st.position === 'fixed' || st.position === 'absolute') &&
            parseFloat(st.zIndex) > 100 &&
            (st.backdropFilter !== 'none' || st.filter.indexOf('blur') >= 0)) {
          el.style.display = 'none';
        }
      });
    } catch (e) {}
  }

  /* ---------- 2. 解析 __NEXT_DATA__ ---------- */
  function parseNextData(html) {
    try {
      var m = html.match(
        /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
      );
      if (!m) return null;
      var d = JSON.parse(m[1]);
      var pp = d && d.props && d.props.pageProps;
      if (!pp) return null;
      var content = pp.content || {};
      // 现代路径 body[]，兼容老路径 text[]（2023 版脚本用的）
      var body = Array.isArray(content.body)
        ? content.body
        : (Array.isArray(content.text) ? content.text : null);
      return {
        body: body,
        walled: pp.walled,
        dropPaywall: pp.paywallCheck && pp.paywallCheck.shouldDropPaywall,
        content: content
      };
    } catch (e) {
      log('parseNextData failed', e);
      return null;
    }
  }

  /* ---------- 3. body[] -> HTML ---------- */
  function blocksToHtml(body) {
    if (!Array.isArray(body)) return '';
    return body.map(function (b) {
      var t = b && b.type;
      var txt = b && (b.textHtml || b.text || '');
      switch (t) {
        case 'PARAGRAPH':
          return '<p class="article__body-text">' + txt + '</p>';
        case 'HEADING':
        case 'HEADING_2':
        case 'H2':
          return '<h2>' + esc(b.text || '') + '</h2>';
        case 'PULL_QUOTE':
        case 'QUOTE':
          return '<blockquote>' + txt + '</blockquote>';
        case 'IMAGE':
        case 'FIGURE':
          var src = b.src || (b.image && b.image.url) || (b.attribs && b.attribs.src);
          return src
            ? '<figure class="article__body-text-image"><img src="' + esc(src) + '" alt="' + esc(b.caption || '') + '"></figure>'
            : '';
        default:
          // 未知 type：若有 text 仍尝试渲染，避免漏段
          return b && b.text
            ? '<p class="article__body-text">' + esc(b.text) + '</p>'
            : '';
      }
    }).join('\n');
  }

  function findHost() {
    for (var i = 0; i < CFG.hostSelectors.length; i++) {
      var el = document.querySelector(CFG.hostSelectors[i]);
      if (el) return el;
    }
    return null;
  }

  /* ---------- 4. 注入正文 ---------- */
  function inject(body, source) {
    var html = blocksToHtml(body);
    if (!html) { log('empty body for', source); return false; }
    var host = findHost();
    if (!host) { log('no host container'); return false; }

    killWall();
    host.innerHTML = html;
    setStatus('已还原 ' + body.length + ' 段 · 来源: ' + source, 'ok');
    log('injected', body.length, 'blocks from', source);
    return true;
  }

  /* ---------- 5. 状态条 ---------- */
  function setStatus(msg, kind) {
    var el = document.getElementById(CFG.statusId);
    if (!el) {
      el = document.createElement('div');
      el.id = CFG.statusId;
      el.style.cssText =
        'position:fixed;bottom:16px;left:16px;z-index:2147483647;' +
        'font:12px/1.5 system-ui,sans-serif;padding:8px 12px;border-radius:6px;' +
        'background:#111;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.35);' +
        'max-width:420px;';
      document.body.appendChild(el);
    }
    el.style.background = kind === 'err' ? '#7a1f1f' : (kind === 'ok' ? '#14532d' : '#111');
    el.textContent = '[EconomistUnlock] ' + msg;
  }

  /* ---------- 6. 多级回退取全文 ---------- */
  function tryGooglebot(done) {
    setStatus('尝试 Googlebot UA 直连取全文…', 'wait');
    GM_xmlhttpRequest({
      method: 'GET',
      url: location.href,
      headers: {
        'User-Agent': CFG.googlebotUA,
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 20000,
      onload: function (r) {
        var d = parseNextData(r.responseText);
        if (d && d.body && d.body.length > 1) {
          if (inject(d.body, 'Googlebot UA')) { done && done(true); return; }
        }
        log('googlebot route: body length =', d && d.body ? d.body.length : 'n/a');
        done && done(false);
      },
      onerror: function (e) {
        log('googlebot route error', e);
        done && done(false);
      }
    });
  }

  function tryJina(done) {
    setStatus('尝试 Jina Reader 代理取全文…', 'wait');
    var target = 'https://r.jina.ai/' + location.href;
    GM_xmlhttpRequest({
      method: 'GET',
      url: target,
      headers: { 'X-Return-Format': 'markdown' },
      timeout: 30000,
      onload: function (r) {
        var text = (r.responseText || '').trim();
        if (text.length > 1200 && text.indexOf('Subscribe') === -1) {
          // Jina 返回 markdown：按空行切段，塞进正文容器
          var host = findHost();
          if (host) {
            killWall();
            var paras = text.split(/\n{2,}/).filter(function (p) {
              return p.trim() && !/^\[|^\!|^##/m.test(p);
            }).map(function (p) {
              return '<p class="article__body-text">' + esc(p.trim()) + '</p>';
            }).join('\n');
            host.innerHTML = paras;
            setStatus('已还原 · 来源: Jina Reader（' + paras.length + ' 段）', 'ok');
            done && done(true);
            return;
          }
        }
        log('jina route: unusable, len', text.length);
        done && done(false);
      },
      onerror: function (e) {
        log('jina route error', e);
        done && done(false);
      }
    });
  }

  function openArchive() {
    var clean = location.href.split('?')[0].split('#')[0];
    window.open('https://archive.today/newest/' + encodeURIComponent(clean), '_blank');
    setStatus('已在新标签打开 archive.today 存档查询', 'ok');
  }

  function fetchFull() {
    tryGooglebot(function (ok) {
      if (ok) return;
      tryJina(function (ok2) {
        if (!ok2) {
          setStatus('自动路由失败，点此手动查 archive.today', 'err');
          openArchive();
        }
      });
    });
  }

  /* ---------- 7. 悬浮按钮 ---------- */
  function addButton() {
    if (document.getElementById('__econ_unlock_btn__')) return;
    var b = document.createElement('button');
    b.id = '__econ_unlock_btn__';
    b.textContent = '取全文';
    b.title = '多级回退：Googlebot UA → Jina → archive.today';
    b.style.cssText =
      'position:fixed;bottom:70px;right:16px;z-index:2147483647;' +
      'background:#e3120b;color:#fff;border:0;border-radius:6px;' +
      'padding:10px 14px;font:600 13px system-ui,sans-serif;cursor:pointer;' +
      'box-shadow:0 3px 12px rgba(0,0,0,.3);';
    b.addEventListener('click', fetchFull);
    document.body.appendChild(b);
  }

  /* ---------- 8. 启动：先还原本地可用正文，再挂按钮 ---------- */
  function boot() {
    var node = document.getElementById('__NEXT_DATA__');
    if (!node) { log('no __NEXT_DATA__ yet'); return false; }
    var d = parseNextData(node.textContent);
    if (!d || !d.body) { log('no body in NEXT_DATA'); return false; }
    killWall();
    inject(d.body, 'SSR __NEXT_DATA__');
    addButton();
    return true;
  }

  // 页面是 Next.js 客户端导航，轮询直到 __NEXT_DATA__ 出现；并监听 DOM 变化反复杀墙
  var bootTimer = setInterval(function () {
    if (boot()) clearInterval(bootTimer);
  }, 200);

  var wallObserver = new MutationObserver(function () { killWallLight(); });
  wallObserver.observe(document.documentElement, { childList: true, subtree: true });

  setTimeout(function () { clearInterval(bootTimer); killWall(); addButton(); }, 15000);

  log('loaded');
})();
