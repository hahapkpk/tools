// ==UserScript==
// @name         X Advanced Search Helper
// @namespace    local.codex
// @version      0.1.0
// @description  Add a compact advanced-search builder to X explore/search pages.
// @match        https://x.com/explore*
// @match        https://x.com/search*
// @match        https://twitter.com/explore*
// @match        https://twitter.com/search*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_ID = 'x-advanced-search-helper';
  const STYLE_ID = `${SCRIPT_ID}-style`;
  const PANEL_ID = `${SCRIPT_ID}-panel`;
  const DEBUG = false;
  const log = (...args) => DEBUG && console.log(`[${SCRIPT_ID}]`, ...args);

  const SELECTORS = [
    'input[data-testid="SearchBox_Search_Input"]',
    'input[aria-label="查询词条"]',
    'input[aria-label="Search query"]',
    'form[role="search"] input[type="text"]',
    'input[placeholder="搜索"]',
    'input[placeholder="Search"]'
  ].join(',');

  const FILTERS = [
    { key: 'links', label: '链接', value: 'filter:links' },
    { key: 'images', label: '图片', value: 'filter:images' },
    { key: 'videos', label: '视频', value: 'filter:videos' },
    { key: 'noReplies', label: '排除回复', value: '-filter:replies' },
    { key: 'verified', label: '认证用户', value: 'is:verified' }
  ];

  const QUICK_TOKENS = [
    'lang:zh',
    'filter:links',
    'filter:images',
    'filter:videos',
    '-filter:replies',
    'is:verified',
    'min_faves:500',
    'min_retweets:100',
    'min_replies:50'
  ];

  function isTargetRoute() {
    return /^\/(explore|search)/.test(location.pathname);
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === false || value == null) return;
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, value === true ? '' : String(value));
    });
    for (const child of [].concat(children)) {
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function addStyles() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = el('style', { id: STYLE_ID });
      document.head.append(style);
    }
    style.textContent = `
      #${PANEL_ID} {
        box-sizing: border-box;
        position: fixed;
        top: 86px;
        right: max(12px, calc((100vw - 1280px) / 2 + 16px));
        width: min(560px, calc(100vw - 24px));
        max-height: calc(100vh - 110px);
        overflow: auto;
        margin: 0;
        padding: 10px;
        border: 1px solid rgba(113, 118, 123, .42);
        border-radius: 8px;
        background: rgba(0, 0, 0, .96);
        color: rgb(231, 233, 234);
        font: 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 10px 30px rgba(0, 0, 0, .38);
        z-index: 9999;
      }
      html:not([style*="color-scheme: dark"]) #${PANEL_ID} {
        background: rgba(255, 255, 255, .98);
        color: rgb(15, 20, 25);
      }
      #${PANEL_ID} * { box-sizing: border-box; font: inherit; }
      #${PANEL_ID} .xas-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }
      #${PANEL_ID} .xas-title { font-weight: 700; font-size: 14px; }
      #${PANEL_ID} .xas-grid {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 7px;
      }
      #${PANEL_ID} label { display: grid; gap: 3px; min-width: 0; color: rgb(113, 118, 123); }
      #${PANEL_ID} .xas-span-2 { grid-column: span 2; }
      #${PANEL_ID} .xas-span-3 { grid-column: span 3; }
      #${PANEL_ID} .xas-span-6 { grid-column: 1 / -1; }
      #${PANEL_ID} input,
      #${PANEL_ID} select,
      #${PANEL_ID} textarea {
        width: 100%;
        min-width: 0;
        border: 1px solid rgba(113, 118, 123, .45);
        border-radius: 6px;
        background: transparent;
        color: inherit;
        padding: 6px 8px;
        outline: none;
      }
      #${PANEL_ID} textarea { resize: vertical; min-height: 38px; }
      #${PANEL_ID} input:focus,
      #${PANEL_ID} select:focus,
      #${PANEL_ID} textarea:focus { border-color: rgb(29, 155, 240); }
      #${PANEL_ID} .xas-checks,
      #${PANEL_ID} .xas-tokens,
      #${PANEL_ID} .xas-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }
      #${PANEL_ID} .xas-check {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        width: auto;
        color: inherit;
      }
      #${PANEL_ID} .xas-check input { width: auto; }
      #${PANEL_ID} button {
        border: 1px solid rgba(113, 118, 123, .45);
        border-radius: 999px;
        background: transparent;
        color: inherit;
        padding: 5px 10px;
        cursor: pointer;
        white-space: nowrap;
      }
      #${PANEL_ID} button:hover { border-color: rgb(29, 155, 240); color: rgb(29, 155, 240); }
      #${PANEL_ID} .xas-primary {
        border-color: rgb(29, 155, 240);
        background: rgb(29, 155, 240);
        color: white;
        font-weight: 700;
      }
      #${PANEL_ID} .xas-status { color: rgb(113, 118, 123); min-height: 18px; }
      @media (max-width: 700px) {
        #${PANEL_ID} {
          top: 74px;
          left: 10px;
          right: 10px;
          width: auto;
        }
        #${PANEL_ID} .xas-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        #${PANEL_ID} .xas-span-2,
        #${PANEL_ID} .xas-span-3,
        #${PANEL_ID} .xas-span-6 { grid-column: 1 / -1; }
      }
    `;
  }

  function getSearchInput() {
    return document.querySelector(SELECTORS);
  }

  function nativeSetValue(input, value) {
    const proto = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setStatus(text, isError = false) {
    const status = document.querySelector(`#${PANEL_ID} .xas-status`);
    if (!status) return;
    status.textContent = text || '';
    status.style.color = isError ? 'rgb(244, 33, 46)' : 'rgb(113, 118, 123)';
  }

  function field(panel, name) {
    return panel.querySelector(`[data-xas-field="${name}"]`);
  }

  function appendToken(token) {
    const panel = document.getElementById(PANEL_ID);
    const base = field(panel, 'base');
    const current = base.value.trim();
    const parts = new Set(current.split(/\s+/).filter(Boolean));
    if (!parts.has(token)) base.value = current ? `${current} ${token}` : token;
    updatePreview();
  }

  function normalizeDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
  }

  function normalizeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : '';
  }

  function buildQuery() {
    const panel = document.getElementById(PANEL_ID);
    const parts = [];
    const base = field(panel, 'base').value.trim();
    const phrase = field(panel, 'phrase').value.trim().replace(/^"+|"+$/g, '');
    const orText = field(panel, 'or').value.trim();
    const from = field(panel, 'from').value.trim().replace(/^@/, '');
    const since = normalizeDate(field(panel, 'since').value);
    const until = normalizeDate(field(panel, 'until').value);
    const langSelect = field(panel, 'lang').value;
    const langCustom = field(panel, 'langCustom').value.trim().replace(/^lang:/, '');
    const minFaves = normalizeNumber(field(panel, 'minFaves').value);
    const minRetweets = normalizeNumber(field(panel, 'minRetweets').value);
    const minReplies = normalizeNumber(field(panel, 'minReplies').value);

    if (base) parts.push(base);
    if (phrase) parts.push(`"${phrase.replace(/"/g, '\\"')}"`);
    if (orText) parts.push(orText.includes(' OR ') ? orText : orText.replace(/\s*\|\s*/g, ' OR '));
    if (from) parts.push(`from:${from}`);
    if (since) parts.push(`since:${since}`);
    if (until) parts.push(`until:${until}`);
    if (minFaves) parts.push(`min_faves:${minFaves}`);
    if (minRetweets) parts.push(`min_retweets:${minRetweets}`);
    if (minReplies) parts.push(`min_replies:${minReplies}`);
    if (langSelect === 'custom' && langCustom) parts.push(`lang:${langCustom}`);
    else if (langSelect) parts.push(`lang:${langSelect}`);

    for (const item of FILTERS) {
      if (field(panel, item.key).checked) parts.push(item.value);
    }

    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function updatePreview() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const query = buildQuery();
    field(panel, 'preview').value = query;
  }

  function currentQuery() {
    const fromUrl = new URL(location.href).searchParams.get('q');
    const input = getSearchInput();
    return (fromUrl || input?.value || '').trim();
  }

  function readCurrent() {
    const panel = document.getElementById(PANEL_ID);
    field(panel, 'base').value = currentQuery();
    updatePreview();
    setStatus('已读取当前搜索词');
  }

  function clearFields() {
    const panel = document.getElementById(PANEL_ID);
    panel.querySelectorAll('input[type="text"], input[type="number"], input[type="date"]').forEach((input) => {
      input.value = '';
    });
    panel.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = false;
    });
    field(panel, 'lang').value = '';
    updatePreview();
    setStatus('已清空');
  }

  function applyToInput() {
    const input = getSearchInput();
    const query = buildQuery();
    if (!input) {
      setStatus('没有找到 X 搜索框', true);
      return false;
    }
    nativeSetValue(input, query);
    input.focus();
    setStatus('已填入 X 搜索框');
    return true;
  }

  function goSearch(mode = 'top') {
    const query = buildQuery();
    if (!query) {
      setStatus('请先输入关键词或选择参数', true);
      return;
    }
    applyToInput();
    const url = new URL('/search', location.origin);
    url.searchParams.set('q', query);
    url.searchParams.set('src', 'typed_query');
    if (mode === 'latest') url.searchParams.set('f', 'live');
    location.assign(url.toString());
  }

  function createPanel() {
    const panel = el('section', { id: PANEL_ID, 'data-xas-mounted': '1' }, [
      el('div', { className: 'xas-head' }, [
        el('div', { className: 'xas-title', text: '高级搜索' }),
        el('button', { type: 'button', title: '读取当前搜索词', onclick: readCurrent }, '读取当前')
      ]),
      el('div', { className: 'xas-grid' }, [
        el('label', { className: 'xas-span-3' }, [
          '关键词',
          el('input', { type: 'text', 'data-xas-field': 'base', placeholder: 'AI 工具 / from:user / A OR B' })
        ]),
        el('label', { className: 'xas-span-3' }, [
          '完整词组',
          el('input', { type: 'text', 'data-xas-field': 'phrase', placeholder: '完整词组' })
        ]),
        el('label', { className: 'xas-span-2' }, [
          'from',
          el('input', { type: 'text', 'data-xas-field': 'from', placeholder: '用户名' })
        ]),
        el('label', { className: 'xas-span-2' }, [
          'OR',
          el('input', { type: 'text', 'data-xas-field': 'or', placeholder: 'A OR B' })
        ]),
        el('label', { className: 'xas-span-2' }, [
          '语言',
          el('select', { 'data-xas-field': 'lang' }, [
            el('option', { value: '', text: '不限语言' }),
            el('option', { value: 'zh', text: '中文 lang:zh' }),
            el('option', { value: 'en', text: '英文 lang:en' }),
            el('option', { value: 'ja', text: '日文 lang:ja' }),
            el('option', { value: 'custom', text: '自定义' })
          ])
        ]),
        el('label', {}, ['since', el('input', { type: 'date', 'data-xas-field': 'since' })]),
        el('label', {}, ['until', el('input', { type: 'date', 'data-xas-field': 'until' })]),
        el('label', {}, ['min_faves', el('input', { type: 'number', min: '1', step: '1', 'data-xas-field': 'minFaves', placeholder: '500' })]),
        el('label', {}, ['min_retweets', el('input', { type: 'number', min: '1', step: '1', 'data-xas-field': 'minRetweets', placeholder: '100' })]),
        el('label', {}, ['min_replies', el('input', { type: 'number', min: '1', step: '1', 'data-xas-field': 'minReplies', placeholder: '50' })]),
        el('label', {}, ['lang', el('input', { type: 'text', 'data-xas-field': 'langCustom', placeholder: 'zh' })]),
        el('div', { className: 'xas-span-6 xas-checks' }, FILTERS.map((item) => (
          el('label', { className: 'xas-check' }, [
            el('input', { type: 'checkbox', 'data-xas-field': item.key }),
            item.label
          ])
        ))),
        el('div', { className: 'xas-span-6 xas-tokens' }, QUICK_TOKENS.map((token) => (
          el('button', { type: 'button', title: `追加 ${token}`, onclick: () => appendToken(token) }, token)
        ))),
        el('label', { className: 'xas-span-6' }, [
          '预览',
          el('textarea', { readonly: true, 'data-xas-field': 'preview' })
        ]),
        el('div', { className: 'xas-span-6 xas-actions' }, [
          el('button', { type: 'button', className: 'xas-primary', onclick: () => goSearch('top') }, '搜索'),
          el('button', { type: 'button', onclick: () => goSearch('latest') }, '最新'),
          el('button', { type: 'button', onclick: applyToInput }, '只填入搜索框'),
          el('button', { type: 'button', onclick: clearFields }, '清空'),
          el('span', { className: 'xas-status', text: '' })
        ])
      ])
    ]);

    panel.addEventListener('input', updatePreview);
    panel.addEventListener('change', updatePreview);
    return panel;
  }

  function mount() {
    if (!isTargetRoute()) return;
    const input = getSearchInput();
    if (!input) return;
    addStyles();

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = createPanel();
      const query = currentQuery();
      if (query) panel.querySelector('[data-xas-field="base"]').value = query;
      updatePreview();
    }

    const form = input.closest('form');
    const anchor = form || input.parentElement;
    if (anchor && panel.previousElementSibling !== anchor) {
      anchor.insertAdjacentElement('afterend', panel);
      log('mounted after search input');
    }
    updatePreview();
  }

  function scheduleMount() {
    clearTimeout(scheduleMount.timer);
    scheduleMount.timer = setTimeout(mount, 120);
  }

  const observer = new MutationObserver(scheduleMount);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      scheduleMount();
    }
  }, 800);

  scheduleMount();
})();
