// ==UserScript==
// @name         夸克网盘链接预检（移动版）
// @namespace    local.codex
// @version      0.6.6
// @description  扫描当前页面的夸克网盘分享链接，手动批量预检是否有效、是否需要提取码或是否疑似失效。适配 iPhone 手机浏览器（Teak 等）：底部抽屉面板、触控友好、GM API 缺失时自动降级。
// @match        *://xn--wcv59z.com/*
// @match        *://*.xn--wcv59z.com/*
// @match        *://wdku.net/*
// @match        *://*.wdku.net/*
// @match        *://qmp4.com/*
// @match        *://*.qmp4.com/*
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/quark-link-precheck.mobile.user.js
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/quark-link-precheck.mobile.user.js
// @connect      drive-h.quark.cn
// @connect      pan.quark.cn
// @connect      raw.githubusercontent.com
// @connect      *
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// ==/UserScript==

(function () {
  'use strict';

  // 本地兜底白名单。GitHub 白名单文件不可用时，脚本会回退到这里。
  const LOCAL_FALLBACK_WHITELIST = [
    'https://www.xn--wcv59z.com/',
    'https://www.qmp4.com/'
  ];
  const REMOTE_WHITELIST_URL = 'https://raw.githubusercontent.com/hahapkpk/tools/main/quark-link-precheck.whitelist.json';

  const SCRIPT_ID = 'codex-quark-link-precheck-mobile';
  const LS_PREFIX = `${SCRIPT_ID}:`;
  const CACHE_PREFIX = `${SCRIPT_ID}:cache:`;
  const CACHE_TTL = 6 * 60 * 60 * 1000;
  const WHITELIST_CACHE_KEY = `${SCRIPT_ID}:remote-whitelist-cache`;
  const WHITELIST_CACHE_TTL = 30 * 60 * 1000;
  let CONCURRENCY = 6;
  let CHECK_INTERVAL = 200;
  let AUTO_START_WHITELIST = LOCAL_FALLBACK_WHITELIST.slice();
  let whitelistSource = 'local';
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

  // --- 移动端兼容层：GM API 缺失时自动降级 ---

  async function storageGet(key, defaultValue) {
    try {
      if (typeof GM_getValue === 'function') {
        const value = GM_getValue(key, defaultValue);
        if (value !== undefined && value !== null) return value;
        return defaultValue;
      }
    } catch (_) {}
    try {
      if (typeof GM !== 'undefined' && GM && typeof GM.getValue === 'function') {
        const value = await GM.getValue(key, defaultValue);
        if (value !== undefined && value !== null) return value;
        return defaultValue;
      }
    } catch (_) {}
    try {
      const raw = localStorage.getItem(LS_PREFIX + key);
      return raw === null ? defaultValue : JSON.parse(raw);
    } catch (_) {
      return defaultValue;
    }
  }

  async function storageSet(key, value) {
    let stored = false;
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
        stored = true;
      }
    } catch (_) {}
    if (stored) return;
    try {
      if (typeof GM !== 'undefined' && GM && typeof GM.setValue === 'function') {
        await GM.setValue(key, value);
        stored = true;
      }
    } catch (_) {}
    if (stored) return;
    try {
      localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    } catch (_) {
      // Ignore storage errors.
    }
  }

  async function storageDelete(key) {
    let deleted = false;
    try {
      if (typeof GM_deleteValue === 'function') {
        GM_deleteValue(key);
        deleted = true;
      }
    } catch (_) {}
    if (deleted) return;
    try {
      if (typeof GM !== 'undefined' && GM && typeof GM.deleteValue === 'function') {
        await GM.deleteValue(key);
        deleted = true;
      }
    } catch (_) {}
    if (deleted) return;
    try {
      localStorage.removeItem(LS_PREFIX + key);
    } catch (_) {
      // Ignore storage errors.
    }
  }

  function registerMenu(title, handler) {
    try {
      if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand(title, handler);
      } else if (typeof GM !== 'undefined' && GM && typeof GM.registerMenuCommand === 'function') {
        GM.registerMenuCommand(title, handler);
      }
    } catch (_) {
      // 没有菜单能力的引擎（多数手机浏览器）直接跳过，功能都在面板按钮里。
    }
  }

  function httpRequest(options) {
    const gmXhr = typeof GM_xmlhttpRequest === 'function'
      ? GM_xmlhttpRequest
      : (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest : null);
    if (gmXhr) return gmRequest(gmXhr, options);
    return fetchRequest(options);
  }

  function gmRequest(gmXhr, options) {
    return new Promise((resolve, reject) => {
      gmXhr({
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

  // 兜底：夸克接口不允许跨域，此路径主要用于拉取 GitHub 白名单；
  // 若脚本管理器没有提供 GM_xmlhttpRequest，夸克检测会失败并提示。
  async function fetchRequest(options) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), options.timeout || 20000) : null;
    try {
      const resp = await fetch(options.url, {
        method: options.method || 'GET',
        headers: Object.assign({ 'Accept': 'application/json, text/plain, */*' }, options.headers || {}),
        body: options.data || undefined,
        signal: controller ? controller.signal : undefined
      });
      const text = await resp.text();
      return {
        status: resp.status,
        body: safeJson(text) || text,
        text,
        finalUrl: resp.url || options.url
      };
    } catch (err) {
      throw new Error(err && err.name === 'AbortError' ? '请求超时' : '网络请求失败');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function safeJson(text) {
    if (!text || typeof text !== 'string') return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  // --- Whitelist helpers ---

  function normalizeWhitelist(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter(function (pattern) { return typeof pattern === 'string'; })
      .map(function (pattern) { return pattern.trim(); })
      .filter(Boolean);
  }

  async function saveWhitelistCache(list) {
    try {
      await storageSet(WHITELIST_CACHE_KEY, {
        time: Date.now(),
        list: normalizeWhitelist(list)
      });
    } catch (_) {
      // Ignore storage errors.
    }
  }

  async function readWhitelistCache() {
    const cached = await storageGet(WHITELIST_CACHE_KEY, null);
    if (!cached || typeof cached !== 'object') return null;
    const list = normalizeWhitelist(cached.list);
    const time = Number(cached.time || 0);
    if (!time) return null;
    return { time, list };
  }

  function applyWhitelist(list, source) {
    AUTO_START_WHITELIST = normalizeWhitelist(list);
    whitelistSource = source;
  }

  async function restoreWhitelistFromCache() {
    const cached = await readWhitelistCache();
    if (!cached) {
      applyWhitelist(LOCAL_FALLBACK_WHITELIST, 'local');
      return false;
    }
    applyWhitelist(cached.list, 'remote-cache');
    return Date.now() - cached.time <= WHITELIST_CACHE_TTL;
  }

  async function loadRemoteWhitelist(force) {
    const cached = await readWhitelistCache();
    if (!force && cached && Date.now() - cached.time <= WHITELIST_CACHE_TTL) {
      applyWhitelist(cached.list, 'remote-cache');
      return true;
    }

    try {
      const response = await httpRequest({
        url: REMOTE_WHITELIST_URL,
        responseType: 'text',
        headers: { 'Accept': 'application/json, text/plain, */*' }
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error('HTTP ' + response.status);
      }
      const parsed = safeJson(response.text);
      if (!Array.isArray(parsed)) {
        throw new Error('白名单 JSON 不是数组');
      }
      const nextList = normalizeWhitelist(parsed);
      applyWhitelist(nextList, 'remote-live');
      await saveWhitelistCache(nextList);
      return true;
    } catch (err) {
      if (cached) {
        applyWhitelist(cached.list, 'remote-cache');
      } else {
        applyWhitelist(LOCAL_FALLBACK_WHITELIST, 'local');
      }
      log('load remote whitelist failed', err);
      return false;
    }
  }

  // 手机站点常在 www/m/裸域之间切换，匹配时把前缀归一化后再比较。
  function patternMatchesPage(pattern) {
    const p = String(pattern).trim();
    if (!p) return false;
    try {
      const u = new URL(p.includes('://') ? p : 'https://' + p);
      const host = u.hostname.replace(/^www\./i, '');
      const pageHost = location.hostname.replace(/^(www|m|mobile)\./i, '');
      if (host !== pageHost && !pageHost.endsWith('.' + host)) return false;
      const path = u.pathname.replace(/\/+$/, '');
      return path === '' || location.pathname.startsWith(path);
    } catch (_) {
      return location.href.indexOf(p) !== -1;
    }
  }

  function isInWhitelist() {
    if (!AUTO_START_WHITELIST.length) return false;
    return AUTO_START_WHITELIST.some(patternMatchesPage);
  }

  // --- Activation logic ---

  function shouldActivate() {
    // 白名单非空时：仅白名单内的 URL 激活
    if (AUTO_START_WHITELIST.length > 0) {
      return isInWhitelist();
    }

    // 白名单为空时：沿用原有自动检测逻辑
    const host = location.hostname;
    const text = document.body?.innerText || '';
    return /xn--wcv59z\.com$/i.test(host) ||
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
      'margin-left:4px',
      'padding:2px 7px',
      'border-radius:999px',
      'font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      `color:${state.color}`,
      `background:${state.bg}`,
      'vertical-align:middle',
      'white-space:nowrap'
    ].join(';');
  }

  let renderTimer = null;
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      // 设置面板展开时跳过重建，避免正在输入的配置值被整块重渲染冲掉。
      if (!settingsVisible) renderPanel();
    }, 150);
  }

  function updateItem(item, status, message, extra = {}) {
    Object.assign(item, extra, { status, message: message || '' });
    for (const badge of document.querySelectorAll(`.${SCRIPT_ID}-badge[data-quark-id="${cssEscape(item.id)}"]`)) {
      paintBadge(badge, status);
      badge.title = message || '';
    }
    scheduleRender();
  }

  function cacheKey(id, passcode) {
    return `${CACHE_PREFIX}${id}:${passcode || '-'}`;
  }

  async function readCache(item) {
    try {
      const cached = await storageGet(cacheKey(item.id, item.passcode), null);
      if (!cached || Date.now() - cached.time > CACHE_TTL) return null;
      return cached.result;
    } catch (_) {
      return null;
    }
  }

  const CACHEABLE_STATUS = new Set(['ok', 'partial', 'invalid', 'passcode']);

  async function writeCache(item, result) {
    // 只缓存终态结果；unknown/error 多为限流等瞬时异常，缓存会把它们钉死到 TTL 过期。
    if (!result || !CACHEABLE_STATUS.has(result.status)) return;
    try {
      await storageSet(cacheKey(item.id, item.passcode), { time: Date.now(), result });
    } catch (_) {
      // Ignore storage errors.
    }
  }

  function classifyTokenResponse(body) {
    const message = String(body?.message || body?.code || '');
    if (!body) return { status: 'unknown', message: '空响应' };
    if (message.includes('需要提取码') || message.includes('提取码错误') || message.includes('PASS_CODE')) {
      return {
        status: 'passcode',
        message: message.includes('提取码错误')
          ? '分享存在，但页面识别到的提取码不正确'
          : '分享存在，但需要提取码'
      };
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

  function isHttpOk(resp) {
    return resp.status >= 200 && resp.status < 300;
  }

  async function checkOne(item, force = false) {
    if (!force) {
      const cached = await readCache(item);
      if (cached) {
        updateItem(item, cached.status, `${cached.message}（缓存）`, cached);
        return cached;
      }
    }

    updateItem(item, 'checking', '正在请求夸克分享 token');

    const tokenResp = await httpRequest({
      method: 'POST',
      url: 'https://drive-h.quark.cn/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ pwd_id: item.id, passcode: item.passcode || '' })
    });

    // 夸克接口对“分享不存在/已失效/提取码错误”返回 HTTP 404，
    // 业务结果在响应体里，必须先分类响应体，无法识别时才按服务错误抛出。
    const tokenResult = classifyTokenResponse(tokenResp.body);
    if (!isHttpOk(tokenResp) && tokenResult.status !== 'invalid' && tokenResult.status !== 'passcode') {
      throw new Error(`HTTP ${tokenResp.status}`);
    }
    if (tokenResult.status !== 'token') {
      await writeCache(item, tokenResult);
      updateItem(item, tokenResult.status, tokenResult.message, tokenResult);
      return tokenResult;
    }

    updateItem(item, 'checking', '已拿到 token，正在读取分享详情');
    const stoken = encodeURIComponent(tokenResult.stoken);
    const detailResp = await httpRequest({
      url: `https://drive-h.quark.cn/1/clouddrive/share/sharepage/detail?pwd_id=${encodeURIComponent(item.id)}&stoken=${stoken}&_fetch_share=1`
    });

    const detailResult = classifyDetailResponse(detailResp.body);
    if (!isHttpOk(detailResp) && detailResult.status !== 'invalid') {
      throw new Error(`HTTP ${detailResp.status}`);
    }
    await writeCache(item, detailResult);
    updateItem(item, detailResult.status, detailResult.message, detailResult);
    return detailResult;
  }

  async function runChecks(force = false) {
    if (checking) return;
    checking = true;
    try {
      hasRunChecks = true;
      collectLinks();
      renderPanel();

      const queue = links.filter((item) => force || item.status === 'idle' || item.status === 'unknown' || item.status === 'error');
      let index = 0;

      async function worker() {
        while (index < queue.length) {
          const item = queue[index++];
          try {
            await checkOne(item, force);
          } catch (err) {
            updateItem(item, 'error', err.message || '检测失败');
          }
          await sleep(CHECK_INTERVAL);
        }
      }

      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    } finally {
      checking = false;
      panelVisible = false;
      renderPanel();
    }
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
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        padding: 0 10px 10px;
        padding: 0 10px calc(10px + env(safe-area-inset-bottom));
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #0f172a;
        pointer-events: none;
      }
      #${SCRIPT_ID} button {
        appearance: none;
        border: 0;
        cursor: pointer;
        font: inherit;
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }
      #${SCRIPT_ID} .pill {
        pointer-events: auto;
        align-self: flex-end;
        background: #2563eb;
        color: #fff;
        border-radius: 999px;
        padding: 11px 16px;
        font-size: 13px;
        font-weight: 600;
        min-height: 38px;
        box-shadow: 0 6px 18px rgba(37, 99, 235, .35);
        white-space: nowrap;
      }
      #${SCRIPT_ID} .sheet {
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        background: #fff;
        border-radius: 14px;
        box-shadow: 0 -10px 40px rgba(15, 23, 42, .25);
        max-height: 60vh;
        max-height: 60dvh;
        overflow: hidden;
      }
      #${SCRIPT_ID} .sheet-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 14px 8px;
      }
      #${SCRIPT_ID} .sheet-head strong { flex: 1; font-size: 15px; }
      #${SCRIPT_ID} .sheet-head .state {
        color: #64748b;
        font-size: 12px;
      }
      #${SCRIPT_ID} .icon-btn {
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background: #f1f5f9;
        color: #0f172a;
        font-size: 15px;
        line-height: 1;
      }
      #${SCRIPT_ID} .list {
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        padding: 0 14px;
        margin-bottom: 8px;
      }
      #${SCRIPT_ID} .row {
        display: grid;
        grid-template-columns: 76px minmax(0, 1fr);
        gap: 10px;
        padding: 10px 0;
        border-top: 1px solid #e2e8f0;
      }
      #${SCRIPT_ID} .row:first-child { border-top: 0; }
      #${SCRIPT_ID} .url {
        color: #334155;
        word-break: break-all;
        font-size: 13px;
      }
      #${SCRIPT_ID} .msg {
        color: #64748b;
        font-size: 12px;
        margin-top: 3px;
      }
      #${SCRIPT_ID} .status {
        justify-self: start;
        align-self: start;
        border-radius: 999px;
        padding: 3px 8px;
        font-size: 12px;
        white-space: nowrap;
      }
      #${SCRIPT_ID} .empty {
        color: #64748b;
        padding: 18px 0;
        text-align: center;
      }
      #${SCRIPT_ID} .settings {
        margin: 0 14px 10px;
        padding: 10px;
        background: #f8fafc;
        border-radius: 10px;
        border: 1px solid #e2e8f0;
      }
      #${SCRIPT_ID} .settings-meta {
        color: #475569;
        font-size: 12px;
        margin-bottom: 8px;
      }
      #${SCRIPT_ID} .settings-grid {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 8px 10px;
        align-items: center;
        font-size: 13px;
      }
      #${SCRIPT_ID} input[type="number"] {
        padding: 4px 8px;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        font: inherit;
        /* iOS 上小于 16px 的输入框聚焦时会自动放大页面 */
        font-size: 16px;
        width: 90px;
        height: 36px;
      }
      #${SCRIPT_ID} .foot {
        display: flex;
        gap: 8px;
        padding: 0 14px 14px;
      }
      #${SCRIPT_ID} .foot button {
        flex: 1;
        border-radius: 10px;
        padding: 11px 12px;
        min-height: 40px;
        font-size: 14px;
      }
      #${SCRIPT_ID} .foot .primary {
        background: #2563eb;
        color: #fff;
      }
      #${SCRIPT_ID} .foot .secondary {
        background: #fff;
        color: #0f172a;
        border: 1px solid rgba(15, 23, 42, .14);
      }
      #${SCRIPT_ID} .mini-btn {
        background: #2563eb;
        color: #fff;
        border-radius: 8px;
        padding: 9px 12px;
        min-height: 36px;
        font-size: 13px;
        margin-top: 8px;
      }
      #${SCRIPT_ID} .ghost-btn {
        background: #fff;
        color: #b91c1c;
        border: 1px solid #fecaca;
        border-radius: 8px;
        padding: 9px 12px;
        min-height: 36px;
        font-size: 13px;
        margin-top: 8px;
        width: 100%;
      }
    `;
    document.documentElement.appendChild(style);
    return root;
  }

  function statusHtml(status) {
    const state = STATE[status] || STATE.unknown;
    return `<span class="status" style="color:${state.color};background:${state.bg}">${state.text}</span>`;
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
        <div class="sheet">
          <div class="sheet-head">
            <strong>夸克链接预检${AUTO_START_WHITELIST.length ? ' 🔒' : ''}</strong>
            <span class="state">${checking ? '检测中…' : '空闲'}</span>
            <button class="icon-btn" data-action="settings" aria-label="设置">⚙</button>
            <button class="icon-btn" data-action="close" aria-label="收起">✕</button>
          </div>
          <div class="list">
            ${settingsVisible ? `
              <div class="settings">
                <div class="settings-meta">
                  ${AUTO_START_WHITELIST.length
                    ? `白名单已启用，共 ${AUTO_START_WHITELIST.length} 条。来源：${whitelistSource === 'remote-live' ? 'GitHub 实时' : whitelistSource === 'remote-cache' ? 'GitHub 缓存' : '本地兜底'}。`
                    : '白名单为空，当前使用页面内容自动识别模式。'}
                </div>
                <div class="settings-grid">
                  <label>并发线程数</label>
                  <input data-setting="concurrency" type="number" inputmode="numeric" min="1" max="20" value="${CONCURRENCY}">
                  <label>检测间隔(ms)</label>
                  <input data-setting="interval" type="number" inputmode="numeric" min="0" max="2000" value="${CHECK_INTERVAL}">
                </div>
                <button class="mini-btn" data-action="save-settings">保存设置</button>
                <button class="ghost-btn" data-action="clear-cache">清除本页缓存</button>
              </div>
            ` : ''}
            ${notice ? `<div style="margin-bottom:8px;color:#b45309;background:#fef3c7;border-radius:8px;padding:8px;font-size:13px">${escapeHtml(notice)}</div>` : ''}
            ${total ? rows : '<div class="empty">当前页面没有识别到夸克网盘链接。</div>'}
          </div>
          <div class="foot">
            <button class="primary" data-action="scan">${checking ? '检测中…' : '开始检测'}</button>
            <button class="secondary" data-action="force">全部重检</button>
          </div>
        </div>
      ` : ''}
      ${panelVisible ? '' : `<button class="pill" data-action="toggle">${escapeHtml(summary)}</button>`}
    `;

    root.querySelector('[data-action="toggle"]')?.addEventListener('click', () => {
      panelVisible = true;
      renderPanel();
    });

    root.querySelector('[data-action="close"]')?.addEventListener('click', () => {
      panelVisible = false;
      renderPanel();
    });

    root.querySelector('[data-action="scan"]')?.addEventListener('click', () => {
      runChecks(false);
    });

    root.querySelector('[data-action="force"]')?.addEventListener('click', () => {
      runChecks(true);
    });

    root.querySelector('[data-action="settings"]')?.addEventListener('click', () => {
      settingsVisible = !settingsVisible;
      renderPanel();
    });

    root.querySelector('[data-action="save-settings"]')?.addEventListener('click', async () => {
      const c = Number(root.querySelector('[data-setting="concurrency"]')?.value);
      const i = Number(root.querySelector('[data-setting="interval"]')?.value);
      if (c >= 1 && c <= 20) { CONCURRENCY = c; await storageSet('concurrency', c); }
      if (i >= 0 && i <= 2000) { CHECK_INTERVAL = i; await storageSet('interval', i); }
      settingsVisible = false;
      renderPanel();
    });

    root.querySelector('[data-action="clear-cache"]')?.addEventListener('click', () => {
      clearCache();
    });
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
    return Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  async function clearCache() {
    for (const item of collectLinks()) {
      await storageDelete(cacheKey(item.id, item.passcode));
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
    renderPanel();
    log('links', links);

    // 手机页面 DOM 变化频繁，防抖 300ms 再扫描，降低 CPU 占用。
    let scanTimer = null;
    const observer = new MutationObserver(() => {
      if (checking || scanTimer) return;
      scanTimer = setTimeout(() => {
        scanTimer = null;
        if (checking) return;
        const before = links.length;
        autoSelectQuarkTab();
        collectLinks();
        if (links.length !== before) renderPanel();
      }, 300);
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

  async function init() {
    if (document.documentElement.getAttribute('data-' + SCRIPT_ID)) return;

    CONCURRENCY = Number(await storageGet('concurrency', 6));
    if (!Number.isFinite(CONCURRENCY) || CONCURRENCY < 1) CONCURRENCY = 6;
    CHECK_INTERVAL = Number(await storageGet('interval', 200));
    if (!Number.isFinite(CHECK_INTERVAL) || CHECK_INTERVAL < 0) CHECK_INTERVAL = 200;

    // 面板按钮已覆盖全部功能，菜单命令仅在有能力的引擎上注册。
    registerMenu('夸克链接预检：重新检测', () => runChecks(true));
    registerMenu('夸克链接预检：清除本页缓存', clearCache);

    const cacheFresh = await restoreWhitelistFromCache();
    if (!cacheFresh) {
      await loadRemoteWhitelist(false);
    }

    if (!shouldActivate()) {
      log('not in auto-start whitelist', location.href);
      // 页面内容（或 SPA 路由）稍后才出现夸克链接时，观察 10 秒内是否转为可激活。
      waitForActivation();
      return;
    }

    activate();
  }

  init();
})();
