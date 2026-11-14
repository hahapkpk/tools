// ==UserScript==
// @name         Telegram Web 广告过滤器
// @namespace    local.telegram.web.adfilter
// @version      1.1.0
// @description  隐藏 Telegram Web 赞助内容，并支持自定义关键词和 CSS 规则
// @match        https://web.telegram.org/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';
  const defaults = { enabled: true, sponsored: true, keywords: '', selectors: '' };
  const marker = 'data-tg-ad-filter-hidden';
  const key = 'tg-ad-filter-settings';
  const official = ['.bubble.is-sponsored', '.pinned-sponsored', '.sponsored-message', '.SponsoredMessage'];
  const messages = '.bubble:not(.is-date), .Message';
  let settings = { ...defaults, ...GM_getValue(key, {}) }, pending;

  const style = document.createElement('style');
  style.textContent = `[${marker}]{display:none !important}`;
  (document.head || document.documentElement).appendChild(style);

  function scan() {
    document.querySelectorAll(`[${marker}]`).forEach(el => el.removeAttribute(marker));
    if (!settings.enabled) return;
    const hide = el => el.setAttribute(marker, '');
    if (settings.sponsored) official.forEach(selector => document.querySelectorAll(selector).forEach(hide));
    const words = String(settings.keywords || '').split('\n').map(s => s.trim().toLocaleLowerCase()).filter(Boolean);
    if (words.length) document.querySelectorAll(messages).forEach(el => {
      const content = (el.innerText || el.textContent || '').toLocaleLowerCase();
      if (words.some(word => content.includes(word))) hide(el);
    });
    String(settings.selectors || '').split('\n').map(s => s.trim()).filter(Boolean).forEach(selector => {
      try { document.querySelectorAll(selector).forEach(hide); } catch (_) { /* Ignore invalid stored selectors. */ }
    });
  }
  function schedule() { clearTimeout(pending); pending = setTimeout(scan, 120); }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  GM_addValueChangeListener(key, (_name, _oldValue, value) => {
    settings = { ...defaults, ...(value || {}) };
    schedule();
  });
  scan();

  function openSettings(suggested = '') {
    if (document.getElementById('tg-ad-filter-settings-host')) return;
    const host = document.createElement('div');
    host.id = 'tg-ad-filter-settings-host';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
      :host{all:initial} .overlay{position:fixed;inset:0;background:#10273888;z-index:2147483647;display:flex;align-items:center;justify-content:center;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#203247}
      .panel{background:#f5f8fb;width:min(420px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;border-radius:16px;box-shadow:0 16px 60px #0004;box-sizing:border-box;padding:20px}
      h1{font-size:18px;margin:0 0 16px} .row{display:flex;align-items:center;justify-content:space-between;background:white;border:1px solid #e4edf4;border-radius:9px;padding:10px 12px;margin:8px 0}
      input{width:18px;height:18px;accent-color:#168ccb} label.field{display:block;font-weight:700;margin:16px 0 6px} small{display:block;color:#718597;font-size:12px;line-height:1.5;margin:4px 0 7px;font-weight:400}
      textarea{box-sizing:border-box;width:100%;height:84px;padding:9px;border:1px solid #cfdee9;border-radius:8px;resize:vertical;font:13px/1.5 sans-serif} .buttons{display:flex;align-items:center;gap:8px;justify-content:flex-end;margin-top:14px} button{border:0;border-radius:8px;padding:9px 15px;cursor:pointer;font-weight:600} .save{background:#168ccb;color:white} .cancel{background:#e4edf4;color:#203247} .error{color:#b33737;margin-right:auto;font-size:12px}
    </style><div class="overlay"><section class="panel" role="dialog" aria-modal="true" aria-labelledby="title"><h1 id="title">Telegram Web 广告过滤器</h1>
      <label class="row">启用过滤<input id="enabled" type="checkbox"></label>
      <label class="row">隐藏已知赞助内容<input id="sponsored" type="checkbox"></label>
      <label class="field" for="keywords">关键词规则<small>每行一个，匹配消息文字时隐藏整条消息；不区分大小写。</small></label><textarea id="keywords" placeholder="例如：推广合作"></textarea>
      <label class="field" for="selectors">CSS 元素规则<small>每行一个 CSS 选择器；匹配的页面元素会被隐藏。手动选择生成的规则可在此修改或删除。</small></label><textarea id="selectors" placeholder="例如：.custom-ad"></textarea>
      <small>规则仅保存在本机。关键词或 CSS 规则可能隐藏正常内容。</small><div class="buttons"><span class="error" role="status"></span><button class="cancel">取消</button><button class="save">保存规则</button></div></section></div>`;
    document.documentElement.appendChild(host);
    const $ = selector => shadow.querySelector(selector);
    $('#enabled').checked = settings.enabled;
    $('#sponsored').checked = settings.sponsored;
    $('#keywords').value = settings.keywords;
    $('#selectors').value = [settings.selectors.trim(), suggested].filter(Boolean).join('\n');
    $('.cancel').addEventListener('click', () => host.remove());
    $('.overlay').addEventListener('click', event => { if (event.target === $('.overlay')) host.remove(); });
    $('.save').addEventListener('click', () => {
      const selectors = $('#selectors').value;
      for (const selector of selectors.split('\n').map(s => s.trim()).filter(Boolean)) {
        try { document.querySelector(selector); } catch (_) { $('.error').textContent = 'CSS 规则无效，请检查'; return; }
      }
      settings = { enabled: $('#enabled').checked, sponsored: $('#sponsored').checked, keywords: $('#keywords').value, selectors };
      GM_setValue(key, settings);
      host.remove();
      schedule();
    });
  }
  function selectorFor(el) {
    const bubble = el.closest('.bubble[data-mid][data-peer-id]');
    if (bubble) return `.bubble[data-peer-id="${CSS.escape(bubble.dataset.peerId)}"][data-mid="${CSS.escape(bubble.dataset.mid)}"]`;
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
      if (node.id && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) {
        parts.unshift('#' + CSS.escape(node.id));
        break;
      }
      const tag = node.localName;
      if (!tag) return '';
      let part = CSS.escape(tag);
      if (node.parentElement) {
        const siblings = [...node.parentElement.children].filter(sibling => sibling.localName === tag);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
    }
    return parts.join(' > ');
  }

  function startPicker() {
    if (document.getElementById('tg-ad-filter-picker')) return;
    const host = document.createElement('div');
    host.id = 'tg-ad-filter-picker';
    const shadow = host.attachShadow({mode: 'open'});
    shadow.innerHTML = `<style>:host{all:initial}.tip{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#183b53;color:white;padding:11px 16px;border-radius:9px;box-shadow:0 4px 20px #0005;font:14px sans-serif;pointer-events:none}.outline{position:fixed;z-index:2147483646;pointer-events:none;box-sizing:border-box;border:3px solid #ff574f;background:#ff574f33;display:none}</style><div class="tip">点击广告以选择整条消息，按 Esc 取消</div><div class="outline"></div>`;
    document.documentElement.appendChild(host);
    const outline = shadow.querySelector('.outline');
    let chosen = null;
    function target(event) {
      const el = event.target;
      if (!(el instanceof Element) || el === host || el === document.documentElement || el === document.body) return null;
      return el.closest('.bubble[data-mid][data-peer-id]') || el;
    }
    function move(event) {
      chosen = target(event);
      if (!chosen) { outline.style.display = 'none'; return; }
      const r = chosen.getBoundingClientRect();
      Object.assign(outline.style, {display:'block',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
    }
    function stop(event) { event.preventDefault(); event.stopImmediatePropagation(); }
    function click(event) {
      stop(event);
      const el = target(event);
      if (!el) return;
      const selector = selectorFor(el);
      cleanup();
      if (selector) openSettings(selector);
    }
    function keydown(event) { if (event.key === 'Escape') { stop(event); cleanup(); } }
    function cleanup() {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerdown', stop, true);
      document.removeEventListener('pointerup', stop, true);
      document.removeEventListener('click', click, true);
      window.removeEventListener('keydown', keydown, true);
      host.remove();
    }
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerdown', stop, true);
    document.addEventListener('pointerup', stop, true);
    document.addEventListener('click', click, true);
    window.addEventListener('keydown', keydown, true);
  }
  GM_registerMenuCommand('设置广告过滤规则', () => openSettings());
  GM_registerMenuCommand('手动选择页面广告', startPicker);
})();
