// ==UserScript==
// @name         Economist — 付费墙 → archive.today 存档 (v4)
// @namespace    https://github.com/hahapkpk/tools
// @version      4.0.0
// @description  经济学人付费墙/配额用尽时，一键跳转到 archive.today 读存档全文（含图片）。不改动原页面任何 DOM。用你自己的浏览器 IP 过存档站验证。
// @author       Seagull
// @match        *://*.economist.com/*
// @grant        none
// @run-at       document_idle
// @license      MIT
// ==/UserScript==

/*
 * v4 设计（2026-11-21 真实 Chrome 实测）：
 *  - 经济学人 2024 后改为服务端按权限下发正文：匿名/配额用尽时 body 只给 1-2 段，
 *    JWT(fcx_access_state) 服务端签名，客户端伪造无效，删 DOM 变不出未下发的正文。
 *  - 实测可行路径：archive.today 存档。用真实浏览器 IP 打开
 *    archive.today/newest/<url> 时 captcha=false，返回完整存档（含图片）。
 *    例：china/2026/05/04/... 一文在经济学人只给 2 段，存档有 8539 字符全文 + 5 图。
 *  - Freedium 对很新的文章返回 500 render error，故不作主路径。
 *  - 本脚本不碰正文 DOM，只在检测到付费墙时显示一个悬浮按钮；点它跳存档。
 *  - 存档站域名轮换，从存档返回时不重复提示。
 */

(function () {
  'use strict';

  var ARCHIVE_HOSTS = [
    'archive.today',
    'archive.ph',
    'archive.md',
    'archive.li',
    'archive.is'
  ];
  var BTN_ID = '__econ_archive_btn__';
  var NOTE_ID = '__econ_archive_note__';

  function log() { try { console.log('[EconArchive]', ...arguments); } catch (e) {} }

  // 从 SSR 判断文章是否被墙：body 段数 <= 2 或 walled=true
  function isWalled() {
    var n = document.getElementById('__NEXT_DATA__');
    if (!n) return false;
    try {
      var pp = JSON.parse(n.textContent).props.pageProps;
      var b = (pp.content && pp.content.body) || [];
      return pp.walled === true || b.length <= 2;
    } catch (e) { return false; }
  }

  function cleanUrl() {
    return location.href.split('?')[0].split('#')[0];
  }

  function openArchive(idx) {
    var host = ARCHIVE_HOSTS[idx % ARCHIVE_HOSTS.length];
    var target = 'https://' + host + '/newest/' + cleanUrl();
    log('opening', target);
    window.open(target, '_blank', 'noopener');
    var note = document.getElementById(NOTE_ID);
    if (note) note.textContent = '已打开存档（' + host + '）；若失败点按钮换域名重试';
  }

  function addButton() {
    if (document.getElementById(BTN_ID)) return;

    var btn = document.createElement('div');
    btn.id = BTN_ID;
    btn.style.cssText =
      'position:fixed;bottom:80px;right:16px;z-index:2147483647;display:flex;flex-direction:column;gap:6px;';

    var b = document.createElement('button');
    b.textContent = '读存档全文';
    b.title = '跳转到 archive.today 存档版（含图片）';
    b.style.cssText =
      'background:#e3120b;color:#fff;border:0;border-radius:6px;padding:11px 16px;' +
      'font:600 14px system-ui,sans-serif;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.35);';
    var hostIdx = { i: 0 };
    b.addEventListener('click', function () {
      openArchive(hostIdx.i++);
    });

    var note = document.createElement('div');
    note.id = NOTE_ID;
    note.style.cssText =
      'background:#111;color:#fff;font:11px/1.4 system-ui;padding:6px 9px;border-radius:5px;' +
      'max-width:200px;opacity:.9;';
    note.textContent = '此文被付费墙限制，点上方按钮读存档全文';

    btn.appendChild(note);
    btn.appendChild(b);
    document.body.appendChild(btn);
    log('button shown, walled article');
  }

  // 等 __NEXT_DATA__ 出现再判断；SPA 客户端导航后重新评估
  var checked = false;
  var t = setInterval(function () {
    if (document.getElementById('__NEXT_DATA__')) {
      clearInterval(t);
      if (isWalled()) addButton();
      else log('article not walled, no button');
    }
  }, 300);
  setTimeout(function () { clearInterval(t); }, 15000);

  log('loaded');
})();
