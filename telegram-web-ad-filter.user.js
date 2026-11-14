// ==UserScript==
// @name         Telegram Web 广告过滤器
// @namespace    local.telegram.web.adfilter
// @version      1.3.0
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
  const defaults = { enabled: true, sponsored: true, channelAds: true, keywords: '', domains: '', selectors: '' };
  const marker = 'data-tg-ad-filter-hidden';
  const key = 'tg-ad-filter-settings';
  const official = ['.bubble.is-sponsored', '.pinned-sponsored', '.sponsored-message', '.SponsoredMessage'];
  const messages = '.bubble:not(.is-date), .Message';
  let settings = { ...defaults, ...GM_getValue(key, {}) }, pending;

  const style = document.createElement('style');
  style.textContent = `[${marker}]{display:none !important}`;
  (document.head || document.documentElement).appendChild(style);

  // Publisher-created advertisements are ordinary channel posts, not sponsored bubbles.
  // Require multiple independent signals; there is no reliable universal ad flag.
  function looksPromotional(el) {
    const text = (el.innerText || el.textContent || '').toLocaleLowerCase().replace(/\s+/g, ' ');
    const gambling = /博彩|百家乐|真人(?:视讯|娱乐|盘口)|体育投注|线上娱乐平台|赌(?:场|博)|彩票(?:平台|网站)|返水|打码|爆庄|彩金/.test(text);
    const incentives = /注册送|注册即送|新人注册|新用户|新会员|首存|存款.*送|体验金|包赔|返水|彩金|返佣|福利|奖励|爆奖|提款|出款/.test(text);
    const promotion = /官网|官方网址|注册链接|注册网址|官方客服|客服|品牌|平台|玩家|代理|信誉|担保|全网|实力|娱乐|爆奖/.test(text);
    const money = /(?:\d[\d,.]*\s*(?:万|亿)?\s*(?:u|usdt|元|%)|\d+\s*%)/i.test(text);
    return (gambling && (incentives || promotion || money)) || (incentives && promotion && money);
  }
  function matchesDomain(el, domains) {
    const text = (el.innerText || el.textContent || '').toLowerCase();
    const hosts = [...el.querySelectorAll('a[href]')].map(a => {
      try { const url = new URL(a.href, location.href); return /^https?:$/.test(url.protocol) ? url.hostname.toLowerCase() : ''; } catch (_) { return ''; }
    });
    return domains.some(domain => {
      const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return hosts.some(host => host === domain || host.endsWith('.' + domain)) || new RegExp('(^|[^a-z0-9.-])' + escaped + '(?![a-z0-9.-])', 'i').test(text);
    });
  }
  function scan() {
    document.querySelectorAll(`[${marker}]`).forEach(el => el.removeAttribute(marker));
    if (!settings.enabled) return;
    const hide = el => el.setAttribute(marker, '');
    if (settings.sponsored) official.forEach(selector => document.querySelectorAll(selector).forEach(hide));
    const domains = String(settings.domains || '').split('\n').map(s => s.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0]).filter(Boolean);
    document.querySelectorAll('.bubble.channel-post:not(.is-sponsored), .pinned-message').forEach(el => {
      if ((settings.channelAds && looksPromotional(el)) || (domains.length && matchesDomain(el, domains))) hide(el);
    });
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
      <label class="row">识别频道推广和置顶广告<input id="channelAds" type="checkbox"></label>
      <small>按文本特征组合判断，可能误伤；关闭后可只用关键词、域名或手动规则。</small>
      <label class="field" for="keywords">关键词规则<small>每行一个，匹配消息文字时隐藏整条消息；不区分大小写。</small></label><textarea id="keywords" placeholder="例如：推广合作"></textarea>
      <label class="field" for="domains">广告域名规则<small>每行一个域名，匹配频道消息和置顶栏中的链接或文字；包含子域名。</small></label><textarea id="domains" placeholder="例如：example.com"></textarea>
      <label class="field" for="selectors">CSS 元素规则<small>每行一个 CSS 选择器；匹配的页面元素会被隐藏。手动选择生成的规则可在此修改或删除。</small></label><textarea id="selectors" placeholder="例如：.custom-ad"></textarea>
      <small>规则仅保存在本机。关键词或 CSS 规则可能隐藏正常内容。</small><div class="buttons"><span class="error" role="status"></span><button class="cancel">取消</button><button class="save">保存规则</button></div></section></div>`;
    document.documentElement.appendChild(host);
    const $ = selector => shadow.querySelector(selector);
    $('#enabled').checked = settings.enabled;
    $('#sponsored').checked = settings.sponsored;
    $('#channelAds').checked = settings.channelAds;
    $('#domains').value = settings.domains;
    $('#keywords').value = settings.keywords;
    $('#selectors').value = [settings.selectors.trim(), suggested].filter(Boolean).join('\n');
    $('.cancel').addEventListener('click', () => host.remove());
    $('.overlay').addEventListener('click', event => { if (event.target === $('.overlay')) host.remove(); });
    $('.save').addEventListener('click', () => {
      const selectors = $('#selectors').value;
      for (const selector of selectors.split('\n').map(s => s.trim()).filter(Boolean)) {
        try { document.querySelector(selector); } catch (_) { $('.error').textContent = 'CSS 规则无效，请检查'; return; }
      }
      settings = { enabled: $('#enabled').checked, sponsored: $('#sponsored').checked, channelAds: $('#channelAds').checked, keywords: $('#keywords').value, domains: $('#domains').value, selectors };
      GM_setValue(key, settings);
      host.remove();
      schedule();
    });
  }
  function selectorFor(el, exact = false) {
    const bubble = !exact && el.closest('.bubble[data-mid][data-peer-id]');
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

  // Candidate review follows the X Element Blocker approach: stable attributes,
  // visible match counts, and explicit warning for wide or structural rules.
  function showCandidates(el) {
    const host = document.createElement('div');
    host.id = 'tg-ad-filter-candidates';
    const shadow = host.attachShadow({mode:'open'});
    shadow.innerHTML = `<style>:host{all:initial}.veil{position:fixed;inset:0;z-index:2147483647;background:#10273888;display:flex;align-items:center;justify-content:center;font:14px -apple-system,BlinkMacSystemFont,sans-serif;color:#203247}.box{width:min(560px,calc(100vw - 32px));max-height:85vh;overflow:auto;padding:20px;background:#f7fafc;border-radius:14px;box-sizing:border-box}h2{font-size:18px;margin:0 0 8px}p{color:#60788b;font-size:12px;line-height:1.5}label{display:block;background:white;border:1px solid #dde8ef;border-radius:8px;margin:8px 0;padding:10px;cursor:pointer}label.selected{border-color:#168ccb}code{display:block;word-break:break-all;font:11px/1.4 monospace;margin:5px 0 0;color:#536b7e}.warning{color:#b65c15}.actions{text-align:right;margin-top:14px}button{padding:9px 14px;margin-left:8px;border:0;border-radius:8px;cursor:pointer}.next{background:#168ccb;color:white}.outline{position:fixed;z-index:2147483646;pointer-events:none;border:3px solid #f06450;background:#ff574f33;box-sizing:border-box}</style><div class="veil"><section class="box" role="dialog" aria-modal="true"><h2>选择屏蔽范围</h2><p>先选择候选规则，再检查并保存。消息规则只屏蔽当前帖子；多处命中可能影响其他内容。</p><div class="list"></div><p class="warning">结构路径依赖页面布局，刷新或切换频道后可能失效或误匹配。</p><div class="actions"><button class="cancel">取消</button><button class="next">继续</button></div></section></div><div class="previews"></div>`;
    document.documentElement.appendChild(host);
    const candidates = [];
    function add(label, selector, structural = false) {
      if (!selector || candidates.some(c => c.selector === selector)) return;
      try {
        const matches = [...document.querySelectorAll(selector)];
        if (!matches.length) return;
        candidates.push({label, selector, structural, matches});
      } catch (_) {}
    }
    const bubble = el.closest('.bubble[data-mid][data-peer-id]');
    if (bubble) add('整条消息（当前频道和消息）', selectorFor(bubble));
    if (el.id) add('元素 ID', '#' + CSS.escape(el.id));
    for (const attr of ['data-testid','aria-label']) {
      const value = el.getAttribute(attr);
      if (value && value.length < 120) add(attr, `${CSS.escape(el.localName)}[${attr}="${CSS.escape(value)}"]`);
    }
    const link = el.closest('a[href]');
    if (link && link.getAttribute('href').length < 160) add('相同链接元素', `a[href="${CSS.escape(link.getAttribute('href'))}"]`);
    add('当前元素（结构路径）', selectorFor(el, true), true);
    if (!candidates.length) { host.remove(); return; }
    const list = shadow.querySelector('.list');
    const previews = shadow.querySelector('.previews');
    let selected = 0;
    function select(i) {
      selected = i;
      list.querySelectorAll('label').forEach((label, index) => label.classList.toggle('selected', index === i));
      previews.replaceChildren();
      candidates[i].matches.slice(0, 20).forEach(node => {
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const outline = document.createElement('div'); outline.className = 'outline';
        Object.assign(outline.style, {left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
        previews.append(outline);
      });
    }
    candidates.forEach((candidate, i) => {
      const label = document.createElement('label');
      const input = document.createElement('input'); input.type='radio'; input.name='candidate'; input.checked=i===0;
      const title = document.createElement('span');
      title.textContent = ` ${candidate.label} · 当前匹配 ${candidate.matches.length} 处${candidate.matches.length > 1 ? ' · 可能误伤' : ''}${candidate.structural ? ' · 结构规则' : ''}`;
      const code = document.createElement('code'); code.textContent = candidate.selector;
      label.append(input,title,code); label.addEventListener('click',()=>select(i)); list.append(label);
    });
    function cleanup(){window.removeEventListener('keydown', onKey, true);host.remove();}
    function onKey(event){if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cleanup();}}
    window.addEventListener('keydown', onKey, true);
    shadow.querySelector('.cancel').addEventListener('click', cleanup);
    shadow.querySelector('.next').addEventListener('click', () => {
      const candidate = candidates[selected]; cleanup(); openSettings(candidate.selector);
    });
    select(0);
  }

  function startPicker() {
    if (document.getElementById('tg-ad-filter-picker')) return;
    const host = document.createElement('div');
    host.id = 'tg-ad-filter-picker';
    const shadow = host.attachShadow({mode: 'open'});
    shadow.innerHTML = `<style>:host{all:initial}.tip{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#183b53;color:white;padding:11px 16px;border-radius:9px;box-shadow:0 4px 20px #0005;font:14px sans-serif;pointer-events:none}.outline{position:fixed;z-index:2147483646;pointer-events:none;box-sizing:border-box;border:3px solid #ff574f;background:#ff574f33;display:none}</style><div class="tip">点击广告后选择屏蔽范围，按 Esc 取消</div><div class="outline"></div>`;
    document.documentElement.appendChild(host);
    const outline = shadow.querySelector('.outline');
    let chosen = null;
    function target(event) {
      const el = event.target;
      if (!(el instanceof Element) || el === host || el === document.documentElement || el === document.body) return null;
      return el;
    }
    function move(event) {
      chosen = target(event);
      if (!chosen) { outline.style.display = 'none'; return; }
      const r = (chosen.closest('.bubble[data-mid][data-peer-id]') || chosen).getBoundingClientRect();
      Object.assign(outline.style, {display:'block',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});
    }
    function stop(event) { event.preventDefault(); event.stopImmediatePropagation(); }
    function click(event) {
      stop(event);
      const el = target(event);
      if (!el) return;
      cleanup();
      showCandidates(el);
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
