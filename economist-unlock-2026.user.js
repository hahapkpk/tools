// ==UserScript==
// @name         Economist — 付费墙自动跳存档全文 (v5)
// @namespace    https://github.com/hahapkpk/tools
// @version      5.0.0
// @description  打开被付费墙限制的经济学人文章后，自动跳转到 archive.today 存档全文（含图片）。可配置延迟/关闭自动跳。不改动原页面 DOM。
// @author       Seagull
// @match        *://*.economist.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document_idle
// @license      MIT
// ==/UserScript==

/*
 * v5 = v4 + 自动跳转（用户要"打开页面自动显示全文"）。
 * 实测（2026-11-21，真实 Chrome + 用户 IP）：
 *  - 被墙文章 SSR bodyLen<=2 / walled=true；免费账号配额用尽即此状态。
 *  - archive.today/newest/<url> 会由浏览器自动跟随重定向到带日期戳的存档
 *    (archive.ph/<14位日期>/<url>)，该页含完整正文+图片，用户 IP 过 CAPTCHA。
 *  - 直接 fetch newest 中转页只有 11KB JS 壳；带日期戳的 URL 才是 785KB 全文。
 *    因此用 location.replace 让浏览器跟随重定向最稳，不做纯 fetch 注入。
 *  - 存档页在 archive.* 域名，不会再次触发本脚本（@match 仅 economist.com）。
 *
 * 行为：检测到被墙 → 显示倒计时提示 → 到点自动跳存档 → 可点"留在本页"取消。
 * 配置：脚本顶部 CONFIG.delay 改延迟秒数；设为 -1 关闭自动跳（退回手动按钮）。
 * 防打扰：同一次会话里用户点过"留在本页"的文章不再自动跳。
 */

(function () {
  'use strict';

  var CONFIG = {
    delay: 3,          // 自动跳转倒计时（秒）。-1 = 关闭自动跳，只显示手动按钮
    hosts: ['archive.today', 'archive.ph', 'archive.md', 'archive.li', 'archive.is']
  };

  var BTN_ID = '__econ_auto_archive__';
  var STAY_KEY = 'econ_stay_';

  function log() { try { console.log('[EconAutoArchive]', ...arguments); } catch (e) {} }

  function isWalled() {
    var n = document.getElementById('__NEXT_DATA__');
    if (!n) return false;
    try {
      var pp = JSON.parse(n.textContent).props.pageProps;
      var b = (pp.content && pp.content.body) || [];
      return pp.walled === true || b.length <= 2;
    } catch (e) { return false; }
  }

  function cleanUrl() { return location.href.split('?')[0].split('#')[0]; }

  function articleKey() {
    try { return STAY_KEY + location.pathname; } catch (e) { return STAY_KEY + cleanUrl(); }
  }

  function stayed() {
    try { return GM_getValue(articleKey(), false) === true; } catch (e) {
      try { return sessionStorage.getItem(articleKey()) === '1'; } catch (e2) { return false; }
    }
  }

  function markStay() {
    try { GM_setValue(articleKey(), true); } catch (e) {
      try { sessionStorage.setItem(articleKey(), '1'); } catch (e2) {}
    }
  }

  function goArchive() {
    var target = 'https://' + CONFIG.hosts[0] + '/newest/' + cleanUrl();
    log('auto redirect ->', target);
    location.replace(target);
  }

  function showOverlay() {
    if (document.getElementById(BTN_ID)) return;
    var box = document.createElement('div');
    box.id = BTN_ID;
    box.style.cssText =
      'position:fixed;bottom:20px;right:20px;z-index:2147483647;' +
      'font:13px/1.5 system-ui,sans-serif;background:#111;color:#fff;' +
      'padding:14px 16px;border-radius:8px;box-shadow:0 4px 18px rgba(0,0,0,.4);' +
      'max-width:300px;';

    var title = document.createElement('div');
    title.textContent = '此文被付费墙限制';
    title.style.cssText = 'font-weight:700;margin-bottom:6px;';

    var msg = document.createElement('div');
    msg.style.cssText = 'font-size:12px;opacity:.85;margin-bottom:10px;';

    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;';

    var now = document.createElement('button');
    now.textContent = '立即读存档';
    now.style.cssText =
      'background:#e3120b;color:#fff;border:0;border-radius:5px;padding:7px 11px;' +
      'font:600 12px system-ui;cursor:pointer;';
    now.addEventListener('click', function () { goArchive(); });

    var stay = document.createElement('button');
    stay.textContent = '留在本页';
    stay.style.cssText =
      'background:#333;color:#fff;border:0;border-radius:5px;padding:7px 11px;' +
      'font:600 12px system-ui;cursor:pointer;';
    stay.addEventListener('click', function () { markStay(); box.remove(); });

    row.appendChild(now);
    row.appendChild(stay);
    box.appendChild(title);
    box.appendChild(msg);
    box.appendChild(row);
    document.body.appendChild(box);

    if (CONFIG.delay < 0) {
      msg.textContent = '点「立即读存档」看完整全文（含图片）';
      return;
    }

    var left = CONFIG.delay;
    msg.textContent = left + ' 秒后自动跳转存档全文…';
    var timer = setInterval(function () {
      left--;
      if (!document.getElementById(BTN_ID)) { clearInterval(timer); return; }
      if (left <= 0) { clearInterval(timer); goArchive(); }
      else msg.textContent = left + ' 秒后自动跳转存档全文…（点「留在本页」取消）';
    }, 1000);
  }

  // 等 SSR 数据出现再判断；SPA 导航后重新跑
  var checked = false;
  var t = setInterval(function () {
    if (document.getElementById('__NEXT_DATA__')) {
      clearInterval(t);
      if (!checked && isWalled() && !stayed()) {
        checked = true;
        log('walled article, scheduling auto-redirect');
        showOverlay();
      } else {
        log('not walled or user chose stay, no redirect');
      }
    }
  }, 300);
  setTimeout(function () { clearInterval(t); }, 15000);

  log('loaded, delay=', CONFIG.delay);
})();
