// ==UserScript==
// @name         夸克网盘链接预检
// @namespace    local.codex
// @version      0.6.1
// @description  扫描当前页面的夸克网盘分享链接，手动批量预检是否有效、是否需要提取码或是否疑似失效。支持 URL 白名单：白名单为空时自动检测，白名单非空时仅匹配的页面激活。
// @match        *://*/*
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/quark-link-precheck.user.js
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/quark-link-precheck.user.js
// @connect      drive-h.quark.cn
// @connect      pan.quark.cn
// @connect      *
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  // ========== 早期白名单检查 ==========
  // 白名单非空且当前页面不匹配时，脚本直接退出（仅注册菜单命令），不做任何 DOM 操作。
  var _wl_early = [];
  try {
    _wl_early = JSON.parse(GM_getValue('whitelist', '[]'));
    if (!Array.isArray(_wl_early)) _wl_early = [];
  } catch (_) {}

  if (_wl_early.length > 0) {
    var _href = location.href;
    var _matched = _wl_early.some(function (p) { return _href.indexOf(p) !== -1; });
    if (!_matched) {
      // 仅注册白名单管理菜单，然后退出
      GM_registerMenuCommand('夸克预检：添加当前页到白名单', function () {
        var wl = [];
        try { wl = JSON.parse(GM_getValue('whitelist', '[]')); } catch (_) {}
        if (!Array.isArray(wl)) wl = [];
        if (wl.indexOf(location.href) === -1) {
          wl.push(location.href);
          GM_setValue('whitelist', JSON.stringify(wl));
          location.reload();
        }
      });
      GM_registerMenuCommand('夸克预检：清空白名单', function () {
        GM_setValue('whitelist', '[]');
        location.reload();
      });
      return;
    }
  }
  // ========== 早期检查结束 ==========

  const SCRIPT_ID = 'codex-quark-link-precheck';
  const CACHE_PREFIX = `${SCRIPT_ID}:cache:`;
  const CACHE_TTL = 6 * 60 * 60 * 1000;
  let CONCURRENCY = Number(GM_getValue('concurrency', 6));
  let CHECK_INTERVAL = Number(GM_getValue('interval', 200));
  let WHITELIST = _wl_early;
  const DEBUG = false;

  const QUARK_LINK_RE = /https?:\/\/pan\.quark\.cn\/s\/([A-Za-z0-9_-]{6,})(?:[/?#][^\s"'<>]*)?/gi;
  const NETDISK_TAB_RE = /(百度网盘|夸克网盘|迅雷网盘|UC网盘|123网盘|阿里网盘|天翼网盘|移动云盘|115网盘)/;

  if (window.top !== window.self) return;

  const STATE = {
    idle: { text: '未检测', color: '#64748b', bg: '#f1f5f9' },
    checking: { text: '检测中', color: '#1d4ed8', bg: '#dbeafe' },
    ok: { text: '可用', color: '#047857', bg: '#d1fae5' },
    partial: { text: '部分违规', color: '#b45309', bg: '#fef3c7' },
    passcode: { text: '需提取码', color: '#7c3aed', bg: '#ede9fe' },
    invalid: { text: '失效', color: '#b91c1c', bg: '#fee2e2' },
    unknown: { text: '未知', color: '#475569', bg: '#e2e8f0' },
    error: { text: '检测失败', color: '#be123c', bg: '#ffe4e6' }
  };

  const log = (...args) => DEBUG && console.log(`[${SCRIPT_ID}]`, ...args);

  let links = [];
  let panelVisible = false;
  let settingsVisible = false;
  let checking = false;
  let activationObserver = null;
  let hasRunChecks = false;

  // --- Whitelist helpers ---

  function parseWhitelist() {
    try {
      const raw = GM_getValue('whitelist', '[]');
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter(function (s) { return typeof s === 'string' && s.trim(); }) : [];
    } catch (_) {
      return [];
    }
  }

  function saveWhitelist() {
    GM_setValue('whitelist', JSON.stringify(WHITELIST));
  }

  function isInWhitelist() {
    if (!WHITELIST.length) return false;
    var href = location.href;
    return WHITELIST.some(function (pattern) {
      return href.indexOf(pattern) !== -1;
    });
  }

  function addToWhitelist(pattern) {
    var p = String(pattern).trim();
    if (!p) return false;
    if (WHITELIST.indexOf(p) !== -1) return false;
    WHITELIST.push(p);
    saveWhitelist();
    return true;
  }

  function removeFromWhitelist(pattern) {
    var before = WHITELIST.length;
    WHITELIST = WHITELIST.filter(function (item) { return item !== pattern; });
    if (WHITELIST.length !== before) {
      saveWhitelist();
      return true;
    }
    return false;
  }

  function clearWhitelist() {
    if (!WHITELIST.length) return false;
    WHITELIST = [];
    saveWhitelist();
    return true;
  }

  // --- Activation logic ---

  function shouldActivate() {
    // 白名单非空时：仅白名单内的 URL 激活
    if (WHITELIST.length > 0) {
      return isInWhitelist();
    }

    // 白名单为空时：沿用原有自动检测逻辑
    const href = location.href;
    const host = location.hostname;
    const text = document.body?.innerText || '';
    return /xn--wcv59z\.com$/i.test(host) ||
      /教父\.com$/i.test(host) ||
      /pan\.quark\.cn\/s\//i.test(document.documentElement.innerHTML) ||
      /夸克网盘|网盘下载/.test(text);
  }

  function normalizeUrl(raw) {
    try {
      const url = new URL(raw, location.href);
      const match = url.href.match(/https?:\/\/pan\.quark\.cn\/s\/([A-Za-z0-9_-]{6,})/i);
      return match ? `https://pan.quark.cn/s/${match[1]}` : '';
    } catch (_) {
      const match = String(raw).match(/https?:\/\/pan\.quark\.cn\/s\/([A-Za-z0-9_-]{6,})/i);
      return match ? `https://pan.quark.cn/s/${match[1]}` : '';
    }
  }

  function extractId(url) {
    return (url.match(/pan\.quark\.cn\/s\/([A-Za-z0-9_-]{6,})/i) || [])[1] || '';
  }

  function nearbyText(anchor) {
    const host = anchor.closest('li, .item, .card, .download, .down, .resource, p, div, tr, article, main') || anchor.parentElement || anchor;
    return [anchor.href, anchor.textContent, host.textContent].filter(Boolean).join(' ');
  }

  function findPasscode(text) {
    const urlPwd = String(text).match(/[?&](?:pwd|password|passcode|code)=([A-Za-z0-9]{4,8})/i);
    if (urlPwd) return urlPwd[1];

    const cnPwd = String(text).match(/(?:提取码|访问码|密[码碼]|code|pwd)\s*[：:\s]\s*([A-Za-z0-9]{4,8})/i);
    return cnPwd ? cnPwd[1] : '';
  }

  function addDirectLink(byId, url, options = {}) {
    const normalized = normalizeUrl(url);
    const id = extractId(normalized);
    if (!id) return null;

    const existing = byId.get(id);
    if (existing) {
      if (options.anchor && !existing.anchors.includes(options.anchor)) {
        existing.anchors.push(options.anchor);
      }
      if (!existing.passcode && options.passcode) {
        existing.passcode = options.passcode;
      }
      return existing;
    }

    const item = {
      id,
      url: normalized,
      passcode: options.passcode || '',
      anchors: options.anchor ? [options.anchor] : [],
      status: 'idle',
      message: options.message || ''
    };
    byId.set(id, item);
    return item;
  }

  function collectLinks() {
    const byId = new Map(links.map((item) => [item.id, item]));

    for (const anchor of document.querySelectorAll('a[href], area[href]')) {
      const raw = `${anchor.href || ''} ${anchor.getAttribute('href') || ''} ${anchor.textContent || ''}`;
      for (const match of raw.matchAll(QUARK_LINK_RE)) {
        addDirectLink(byId, match[0], {
          anchor,
          passcode: findPasscode(nearbyText(anchor))
        });
      }
    }

    const pageText = document.body?.innerText || '';
    for (const match of pageText.matchAll(QUARK_LINK_RE)) {
      const start = Math.max(0, match.index - 80);
      const end = Math.min(pageText.length, match.index + match[0].length + 80);
      addDirectLink(byId, match[0], {
        passcode: findPasscode(pageText.slice(start, end)),
        message: '文本链接'
      });
    }

    for (const el of document.querySelectorAll('[href], [data-url], [data-href], [data-link], [data-clipboard-text], [onclick], script')) {
      const attrText = el.tagName === 'SCRIPT'
        ? el.textContent || ''
        : Array.from(el.attributes || []).map((attr) => attr.value).join(' ');
      for (const match of attrText.matchAll(QUARK_LINK_RE)) {
        addDirectLink(byId, match[0], {
          anchor: el.matches?.('a[href]') ? el : null,
          passcode: findPasscode(`${attrText} ${el.textContent || ''}`),
          message: '隐藏链接'
        });
      }
    }

    links = Array.from(byId.values());
    links.forEach(addBadge);
    return links;
  }

  function addBadge(item) {
    for (const anchor of item.anchors) {
      if (anchor.getAttribute('data-' + SCRIPT_ID)) continue;
      anchor.setAttribute('data-' + SCRIPT_ID, item.id);
      const badge = document.createElement('span');
      badge.className = `${SCRIPT_ID}-badge`;
      badge.dataset.quarkId = item.id;
      badge.textContent = STATE.idle.text;
      anchor.insertAdjacentElement('afterend', badge);
      paintBadge(badge, 'idle');
    }
  }

  function paintBadge(badge, status) {
    const state = STATE[status] || STATE.unknown;
    badge.textContent = state.text;
    badge.style.cssText = [
      'display:inline-flex',
      'align-items:center',
      'margin-left:6px',
      'padding:2px 6px',
      'border-radius:999px',
      'font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      `color:${state.color}`,
      `background:${state.bg}`,
      'vertical-align:middle',
      'white-space:nowrap'
    ].join(';');
  }

  function updateItem(item, status, message, extra = {}) {
    Object.assign(item, extra, { status, message: message || '' });
    for (const badge of document.querySelectorAll(`.${SCRIPT_ID}-badge[data-quark-id="${cssEscape(item.id)}"]`)) {
      paintBadge(badge, status);
      badge.title = message || '';
    }
    renderPanel();
  }

  function cacheKey(id, passcode) {
    return `${CACHE_PREFIX}${id}:${passcode || '-'}`;
  }

  async function readCache(item) {
    try {
      const cached = await GM_getValue(cacheKey(item.id, item.passcode), null);
      if (!cached || Date.now() - cached.time > CACHE_TTL) return null;
      return cached.result;
    } catch (_) {
      return null;
    }
  }

  async function writeCache(item, result) {
    try {
      await GM_setValue(cacheKey(item.id, item.passcode), { time: Date.now(), result });
    } catch (_) {
      // Ignore storage errors.
    }
  }

  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || 'GET',
        url: options.url,
        data: options.data,
        timeout: options.timeout || 20000,
        responseType: options.responseType || 'json',
        headers: Object.assign({
          'Accept': 'application/json, text/plain, */*'
        }, options.headers || {}),
        onload: (response) => {
          const body = response.response || safeJson(response.responseText) || response.responseText;
          resolve({
            status: response.status,
            body,
            text: response.responseText || '',
            finalUrl: response.finalUrl || options.url
          });
        },
        ontimeout: () => reject(new Error('请求超时')),
        onerror: () => reject(new Error('网络请求失败'))
      });
    });
  }

  function safeJson(text) {
    if (!text || typeof text !== 'string') return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  function classifyTokenResponse(body) {
    const message = String(body?.message || body?.code || '');
    if (!body) return { status: 'unknown', message: '空响应' };
    if (message.includes('需要提取码') || message.includes('PASS_CODE')) {
      return { status: 'passcode', message: '分享存在，但需要提取码' };
    }
    if (message.toLowerCase().includes('ok') && body?.data?.stoken) {
      return { status: 'token', stoken: body.data.stoken, title: body.data.title || '' };
    }
    if (/不存在|失效|取消|删除|EXPIRED|NOT_FOUND|SENSITIVE/i.test(JSON.stringify(body))) {
      return { status: 'invalid', message: message || '分享失效或不可访问' };
    }
    return { status: 'unknown', message: message || '无法判断 token 响应' };
  }

  function classifyDetailResponse(body) {
    const share = body?.data?.share;
    if (!body || !share) {
      if (/不存在|失效|取消|删除|EXPIRED|NOT_FOUND|SENSITIVE/i.test(JSON.stringify(body || {}))) {
        return { status: 'invalid', message: '分享失效或不可访问' };
      }
      return { status: 'unknown', message: body?.message || '无法读取分享详情' };
    }

    const title = share.title || share.first_file?.file_name || '';
    const fileNum = Number(share.file_num || 0);
    const status = Number(share.status || 0);
    const partial = Boolean(share.partial_violation);

    if (partial && status === 1) {
      return {
        status: 'partial',
        message: title ? `部分文件可能违规：${title}` : '分享可访问，但部分文件可能违规',
        title,
        fileNum
      };
    }

    if (status === 1 || status === 3) {
      return {
        status: partial ? 'partial' : 'ok',
        message: title ? `${title}${fileNum ? `，${fileNum} 个文件` : ''}` : '分享可访问',
        title,
        fileNum
      };
    }

    if (status > 1) {
      return { status: 'invalid', message: title ? `分享状态异常：${title}` : '分享失效或不可访问', title, fileNum };
    }

    return { status: 'unknown', message: title ? `未知分享状态：${title}` : '未知分享状态', title, fileNum };
  }

  async function checkOne(item) {
    const cached = await readCache(item);
    if (cached) {
      updateItem(item, cached.status, `${cached.message}（缓存）`, cached);
      return cached;
    }

    updateItem(item, 'checking', '正在请求夸克分享 token');

    const tokenResp = await gmRequest({
      method: 'POST',
      url: 'https://drive-h.quark.cn/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ pwd_id: item.id, passcode: item.passcode || '' })
    });

    if (tokenResp.status < 200 || tokenResp.status >= 300) {
      throw new Error(`HTTP ${tokenResp.status}`);
    }

    const tokenResult = classifyTokenResponse(tokenResp.body);
    if (tokenResult.status !== 'token') {
      await writeCache(item, tokenResult);
      updateItem(item, tokenResult.status, tokenResult.message, tokenResult);
      return tokenResult;
    }

    updateItem(item, 'checking', '已拿到 token，正在读取分享详情');
    const stoken = encodeURIComponent(tokenResult.stoken);
    const detailResp = await gmRequest({
      url: `https://drive-h.quark.cn/1/clouddrive/share/sharepage/detail?pwd_id=${encodeURIComponent(item.id)}&stoken=${stoken}&_fetch_share=1`
    });

    if (detailResp.status < 200 || detailResp.status >= 300) {
      throw new Error(`HTTP ${detailResp.status}`);
    }

    const detailResult = classifyDetailResponse(detailResp.body);
    await writeCache(item, detailResult);
    updateItem(item, detailResult.status, detailResult.message, detailResult);
    return detailResult;
  }

  async function runChecks(force = false) {
    if (checking) return;
    checking = true;
    hasRunChecks = true;
    collectLinks();
    renderPanel();

    const queue = links.filter((item) => force || item.status === 'idle' || item.status === 'unknown' || item.status === 'error');
    let index = 0;

    async function worker() {
      while (index < queue.length) {
        const item = queue[index++];
        try {
          await checkOne(item);
        } catch (err) {
          updateItem(item, 'error', err.message || '检测失败');
        }
        await sleep(CHECK_INTERVAL);
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    checking = false;
    panelVisible = false;
    renderPanel();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function ensureRoot() {
    let root = document.getElementById(SCRIPT_ID);
    if (root) return root;

    root = document.createElement('div');
    root.id = SCRIPT_ID;
    document.documentElement.appendChild(root);

    const style = document.createElement('style');
    style.textContent = `
      #${SCRIPT_ID} {
        position: fixed;
        right: 14px;
        bottom: 14px;
        z-index: 2147483647;
        font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #0f172a;
      }
      #${SCRIPT_ID} button {
        appearance: none;
        border: 1px solid rgba(15, 23, 42, .12);
        background: #2563eb;
        color: #fff;
        border-radius: 7px;
        padding: 7px 10px;
        cursor: pointer;
        font: inherit;
      }
      #${SCRIPT_ID} button.secondary {
        background: #fff;
        color: #0f172a;
      }
      #${SCRIPT_ID} button.danger {
        background: #fff;
        color: #b91c1c;
        border-color: #fecaca;
      }
      #${SCRIPT_ID} .box {
        width: min(440px, calc(100vw - 28px));
        max-height: min(520px, calc(100vh - 96px));
        overflow: auto;
        margin-bottom: 8px;
        padding: 12px;
        border: 1px solid rgba(15, 23, 42, .14);
        border-radius: 8px;
        background: rgba(255,255,255,.96);
        box-shadow: 0 18px 48px rgba(15, 23, 42, .22);
      }
      #${SCRIPT_ID} .row {
        display: grid;
        grid-template-columns: 66px minmax(0, 1fr);
        gap: 8px;
        padding: 8px 0;
        border-top: 1px solid #e2e8f0;
      }
      #${SCRIPT_ID} .row:first-child { border-top: 0; }
      #${SCRIPT_ID} .url {
        color: #334155;
        word-break: break-all;
        font-size: 12px;
      }
      #${SCRIPT_ID} .msg {
        color: #64748b;
        font-size: 12px;
        margin-top: 2px;
      }
      #${SCRIPT_ID} .status {
        justify-self: start;
        align-self: start;
        border-radius: 999px;
        padding: 2px 7px;
        font-size: 12px;
        white-space: nowrap;
      }
      #${SCRIPT_ID} .bar {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      #${SCRIPT_ID} .wl-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 0;
        font-size: 12px;
        word-break: break-all;
      }
      #${SCRIPT_ID} .wl-item code {
        flex: 1;
        min-width: 0;
        background: #f1f5f9;
        padding: 2px 6px;
        border-radius: 4px;
        color: #334155;
      }
      #${SCRIPT_ID} input[type="text"] {
        padding: 4px 8px;
        border: 1px solid #cbd5e1;
        border-radius: 5px;
        font: inherit;
        font-size: 12px;
      }
      #${SCRIPT_ID} input[type="number"] {
        padding: 2px 6px;
        border: 1px solid #cbd5e1;
        border-radius: 4px;
        font: inherit;
        font-size: 12px;
      }
    `;
    document.documentElement.appendChild(style);
    return root;
  }

  function statusHtml(status) {
    const state = STATE[status] || STATE.unknown;
    return `<span class="status" style="color:${state.color};background:${state.bg}">${state.text}</span>`;
  }

  function renderWhitelistUI() {
    var items = WHITELIST.map(function (p) {
      return '<div class="wl-item">' +
        '<code>' + escapeHtml(p) + '</code>' +
        '<button class="secondary danger" data-action="wl-remove" data-pattern="' + escapeAttr(p) + '" style="padding:1px 6px;font-size:11px">✕</button>' +
        '</div>';
    }).join('');

    return '' +
      '<div style="margin-bottom:10px;padding:10px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0">' +
        '<div style="font-size:12px;font-weight:600;margin-bottom:6px;color:#0f172a">🎯 URL 白名单</div>' +
        '<div style="font-size:11px;color:#64748b;margin-bottom:6px">设置后，脚本<b>仅</b>对匹配的页面生效。留空则自动检测夸克链接。</div>' +
        (WHITELIST.length ? '<div style="margin-bottom:6px;max-height:120px;overflow:auto">' + items + '</div>' : '<div style="color:#94a3b8;font-size:11px;margin-bottom:6px">白名单为空，使用自动检测模式</div>') +
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
          '<input type="text" data-setting="wl-input" placeholder="输入网址或域名关键词" style="flex:1;min-width:140px">' +
          '<button data-action="wl-add" style="padding:4px 10px;font-size:12px">添加</button>' +
          '<button class="secondary" data-action="wl-add-current" style="padding:4px 10px;font-size:12px">添加当前页</button>' +
          (WHITELIST.length ? '<button class="secondary danger" data-action="wl-clear" style="padding:4px 10px;font-size:12px">清空</button>' : '') +
        '</div>' +
      '</div>';
  }

  function bindWhitelistEvents(root) {
    root.querySelector('[data-action="wl-add"]')?.addEventListener('click', function () {
      var input = root.querySelector('[data-setting="wl-input"]');
      var val = input?.value?.trim();
      if (!val) return;
      if (addToWhitelist(val)) {
        input.value = '';
        renderPanel();
      }
    });

    root.querySelector('[data-action="wl-add-current"]')?.addEventListener('click', function () {
      if (addToWhitelist(location.href)) {
        renderPanel();
      }
    });

    root.querySelector('[data-action="wl-clear"]')?.addEventListener('click', function () {
      if (clearWhitelist()) {
        renderPanel();
      }
    });

    root.querySelectorAll('[data-action="wl-remove"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (removeFromWhitelist(btn.dataset.pattern)) {
          renderPanel();
        }
      });
    });
  }

  function renderPanel(notice = '') {
    const root = ensureRoot();
    const total = links.length;
    const counts = links.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});

    const done = total - (counts.idle || 0) - (counts.checking || 0);
    const summary = checking
      ? `检测中 ${done}/${total || 0}`
      : hasRunChecks
        ? `夸克预检 ${counts.ok || 0}/${total || 0}`
        : `检测夸克链接${total ? ` ${total}` : ''}`;
    const rows = links.map((item) => `
      <div class="row">
        ${statusHtml(item.status)}
        <div>
          <a class="url" href="${escapeAttr(item.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(item.url)}</a>
          ${item.passcode ? `<div class="msg">提取码：${escapeHtml(item.passcode)}</div>` : ''}
          ${item.message ? `<div class="msg">${escapeHtml(item.message)}</div>` : ''}
        </div>
      </div>
    `).join('');

    root.innerHTML = `
      ${panelVisible ? `
        <div class="box">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px">
            <strong>夸克链接预检${WHITELIST.length ? ' 🔒' : ''}</strong>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="color:#64748b;font-size:12px">${checking ? '检测中...' : '空闲'}</span>
              <button class="secondary" data-action="settings" style="padding:2px 7px;font-size:12px">⚙</button>
            </div>
          </div>
          ${settingsVisible ? `
            ${renderWhitelistUI()}
            <div style="margin-bottom:10px;padding:10px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0">
              <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center;font-size:12px">
                <label>并发线程数</label>
                <input data-setting="concurrency" type="number" min="1" max="20" value="${CONCURRENCY}" style="width:60px">
                <label>检测间隔(ms)</label>
                <input data-setting="interval" type="number" min="0" max="2000" value="${CHECK_INTERVAL}" style="width:60px">
              </div>
              <button data-action="save-settings" style="margin-top:8px;padding:3px 10px;font-size:12px;background:#2563eb;color:#fff;border:0;border-radius:5px;cursor:pointer">保存</button>
            </div>
          ` : ''}
          ${notice ? `<div style="margin-bottom:8px;color:#b45309;background:#fef3c7;border-radius:6px;padding:7px">${escapeHtml(notice)}</div>` : ''}
          ${total ? rows : '<div style="color:#64748b">当前页面没有识别到夸克网盘链接。</div>'}
        </div>
      ` : ''}
      <div class="bar">
        ${panelVisible ? '<button class="secondary" data-action="toggle">收起</button>' : '<button class="secondary" data-action="toggle">展开</button>'}
        <button data-action="scan">${escapeHtml(summary)}</button>
      </div>
    `;

    root.querySelector('[data-action="toggle"]')?.addEventListener('click', () => {
      panelVisible = !panelVisible;
      renderPanel();
    });

    root.querySelector('[data-action="scan"]')?.addEventListener('click', () => {
      runChecks(false);
    });

    root.querySelector('[data-action="settings"]')?.addEventListener('click', () => {
      settingsVisible = !settingsVisible;
      renderPanel();
    });

    root.querySelector('[data-action="save-settings"]')?.addEventListener('click', () => {
      const c = Number(root.querySelector('[data-setting="concurrency"]')?.value);
      const i = Number(root.querySelector('[data-setting="interval"]')?.value);
      if (c >= 1 && c <= 20) { CONCURRENCY = c; GM_setValue('concurrency', c); }
      if (i >= 0 && i <= 2000) { CHECK_INTERVAL = i; GM_setValue('interval', i); }
      settingsVisible = false;
      renderPanel();
    });

    bindWhitelistEvents(root);
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
    return Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function insertInlineButton() {
    if (document.getElementById(`${SCRIPT_ID}-inline`)) return;
    if (!document.body) return;

    const textNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const el = walker.currentNode;
      const text = el.textContent?.trim();
      if ((text === '网盘下载' || text === '夸克网盘') && isVisible(el)) {
        textNodes.push(el);
      }
    }

    const target = textNodes[0] || document.querySelector('main, body');
    if (!target) return;

    const btn = document.createElement('button');
    btn.id = `${SCRIPT_ID}-inline`;
    btn.type = 'button';
    btn.textContent = '检测夸克链接';
    btn.style.cssText = [
      'appearance:none',
      'border:0',
      'background:#2563eb',
      'color:#fff',
      'border-radius:7px',
      'padding:8px 12px',
      'margin:8px 0 8px 10px',
      'cursor:pointer',
      'font:14px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'vertical-align:middle',
      'box-shadow:0 2px 8px rgba(37,99,235,.22)'
    ].join(';');
    btn.addEventListener('click', () => runChecks(false));

    if (/^(H1|H2|H3|H4|DIV|SECTION)$/i.test(target.tagName)) {
      target.insertAdjacentElement('afterend', btn);
    } else {
      target.appendChild(btn);
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  async function clearCache() {
    for (const item of collectLinks()) {
      await GM_deleteValue(cacheKey(item.id, item.passcode));
    }
    links.forEach((item) => updateItem(item, 'idle', ''));
    renderPanel();
  }

  function waitForActivation() {
    if (activationObserver) return;
    if (!document.body && !document.documentElement) return;

    activationObserver = new MutationObserver(() => {
      if (!shouldActivate()) return;
      activationObserver.disconnect();
      activationObserver = null;
      activate();
    });
    activationObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
      if (!activationObserver) return;
      activationObserver.disconnect();
      activationObserver = null;
    }, 10000);
  }

  function isActiveTab(el) {
    return /\b(active|on|current|selected)\b/i.test(String(el.className || '')) ||
      el.getAttribute('aria-selected') === 'true';
  }

  function findQuarkTab() {
    const candidates = Array.from(document.querySelectorAll('li, button, a, [role="tab"], [data-tab], [data-target]'));
    return candidates.find((el) => {
      const text = el.textContent?.trim().replace(/\s+/g, '') || '';
      if (!/^夸克网盘/.test(text)) return false;
      const groupText = el.parentElement?.textContent || '';
      return NETDISK_TAB_RE.test(groupText);
    }) || null;
  }

  function hasMultipleNetdiskTabs(tab) {
    const groupText = tab?.parentElement?.textContent || '';
    const matched = groupText.match(new RegExp(NETDISK_TAB_RE.source, 'g')) || [];
    return new Set(matched).size > 1;
  }

  function autoSelectQuarkTab() {
    const tab = findQuarkTab();
    if (!tab || !hasMultipleNetdiskTabs(tab) || !isVisible(tab) || isActiveTab(tab)) {
      return false;
    }
    tab.click();
    log('selected quark tab', tab.textContent?.trim());
    return true;
  }

  function activate() {
    document.documentElement.setAttribute('data-' + SCRIPT_ID, '1');

    if (!autoSelectQuarkTab()) {
      const tabOb = new MutationObserver((_, ob) => { if (autoSelectQuarkTab()) ob.disconnect(); });
      tabOb.observe(document.body || document.documentElement, { childList: true, subtree: true });
      setTimeout(() => tabOb.disconnect(), 8000);
    }

    collectLinks();
    insertInlineButton();
    renderPanel();
    log('links', links);

    const observer = new MutationObserver(() => {
      if (checking) return;
      const before = links.length;
      autoSelectQuarkTab();
      collectLinks();
      insertInlineButton();
      if (links.length !== before) renderPanel();
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href*="pan.quark.cn/s/"]');
      if (!a) return;
      try {
        const linkText = a.textContent.trim().replace(/\s+/g, ' ');
        const url = new URL(a.href);
        url.hash = '/list/share?_title=' + encodeURIComponent(linkText);
        a.href = url.toString();
      } catch (_) {}
    }, true);
  }

  function init() {
    if (document.documentElement.getAttribute('data-' + SCRIPT_ID)) return;

    // 始终注册菜单命令，确保白名单模式下也能管理白名单
    GM_registerMenuCommand('夸克链接预检：重新检测', () => runChecks(true));
    GM_registerMenuCommand('夸克链接预检：清除本页缓存', clearCache);
    GM_registerMenuCommand('夸克链接预检：添加当前页到白名单', () => {
      if (addToWhitelist(location.href)) {
        location.reload();
      }
    });
    GM_registerMenuCommand('夸克链接预检：清空白名单并刷新', () => {
      if (clearWhitelist()) {
        location.reload();
      }
    });

    if (!shouldActivate()) {
      waitForActivation();
      log('waiting for quark links', location.href);
      return;
    }

    activate();
  }

  init();
})();
