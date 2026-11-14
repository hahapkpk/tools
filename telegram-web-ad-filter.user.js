// ==UserScript==
// @name         Telegram Web 广告过滤器
// @namespace    local.telegram.web.adfilter
// @version      1.0.0
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

  function openSettings() {
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
      <label class="field" for="selectors">CSS 元素规则<small>每行一个 CSS 选择器；匹配的页面元素会被隐藏。</small></label><textarea id="selectors" placeholder="例如：.custom-ad"></textarea>
      <small>规则仅保存在本机。关键词或 CSS 规则可能隐藏正常内容。</small><div class="buttons"><span class="error" role="status"></span><button class="cancel">取消</button><button class="save">保存规则</button></div></section></div>`;
    document.documentElement.appendChild(host);
    const $ = selector => shadow.querySelector(selector);
    $('#enabled').checked = settings.enabled;
    $('#sponsored').checked = settings.sponsored;
    $('#keywords').value = settings.keywords;
    $('#selectors').value = settings.selectors;
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
  GM_registerMenuCommand('设置广告过滤规则', openSettings);
})();
