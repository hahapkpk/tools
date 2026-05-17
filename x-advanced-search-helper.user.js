// ==UserScript==
// @name         X Advanced Search Helper
// @namespace    local.codex
// @version      0.4.0
// @description  Add a floating Chinese advanced-search builder to X explore/search pages.
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
  const BUTTON_ID = `${SCRIPT_ID}-button`;
  const PANEL_ID = `${SCRIPT_ID}-panel`;
  const VERSION = '0.4.0';
  const ICON_URL = 'https://raw.githubusercontent.com/hahapkpk/tools/main/grok.png';
  const POSITION_KEY = `${SCRIPT_ID}:button-position`;
  const DEBUG = false;
  const log = (...args) => DEBUG && console.log(`[${SCRIPT_ID}]`, ...args);

  const SEARCH_INPUT_SELECTOR = [
    'input[data-testid="SearchBox_Search_Input"]',
    'input[aria-label="查询词条"]',
    'input[aria-label="Search query"]',
    'form[role="search"] input[type="text"]',
    'input[placeholder="搜索"]',
    'input[placeholder="Search"]'
  ].join(',');

  const PARAMS = [
    {
      key: 'from',
      label: '指定用户',
      syntax: 'from:用户名',
      help: '只看某个用户发布的帖子',
      input: { type: 'text', placeholder: '用户名，不用输入 @' },
      build: (value) => value ? `from:${value.replace(/^@/, '')}` : ''
    },
    {
      key: 'since',
      label: '起始日期',
      syntax: 'since:2026-05-01',
      help: '只看这个日期之后发布的帖子',
      input: { type: 'date' },
      build: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? `since:${value}` : ''
    },
    {
      key: 'until',
      label: '结束日期',
      syntax: 'until:2026-05-17',
      help: '只看这个日期之前发布的帖子',
      input: { type: 'date' },
      build: (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? `until:${value}` : ''
    },
    {
      key: 'minFaves',
      label: '最低点赞数',
      syntax: 'min_faves:1000',
      help: '点赞数至少达到指定数量',
      input: { type: 'number', min: '1', step: '1', placeholder: '1000' },
      build: (value) => positiveInteger(value) ? `min_faves:${positiveInteger(value)}` : ''
    },
    {
      key: 'minRetweets',
      label: '最低转发数',
      syntax: 'min_retweets:100',
      help: '转发数至少达到指定数量',
      input: { type: 'number', min: '1', step: '1', placeholder: '100' },
      build: (value) => positiveInteger(value) ? `min_retweets:${positiveInteger(value)}` : ''
    },
    {
      key: 'minReplies',
      label: '最低评论数',
      syntax: 'min_replies:50',
      help: '评论数至少达到指定数量',
      input: { type: 'number', min: '1', step: '1', placeholder: '50' },
      build: (value) => positiveInteger(value) ? `min_replies:${positiveInteger(value)}` : ''
    },
    {
      key: 'lang',
      label: '中文帖子',
      syntax: 'lang:zh',
      help: '只看中文内容',
      build: () => 'lang:zh'
    },
    {
      key: 'links',
      label: '带链接',
      syntax: 'filter:links',
      help: '只看包含链接的帖子',
      build: () => 'filter:links'
    },
    {
      key: 'images',
      label: '带图片',
      syntax: 'filter:images',
      help: '只看包含图片的帖子',
      build: () => 'filter:images'
    },
    {
      key: 'videos',
      label: '带视频',
      syntax: 'filter:videos',
      help: '只看包含视频的帖子',
      build: () => 'filter:videos'
    },
    {
      key: 'noReplies',
      label: '排除回复',
      syntax: '-filter:replies',
      help: '排除回复内容，只看更像主帖的结果',
      build: () => '-filter:replies'
    },
    {
      key: 'verified',
      label: '认证用户',
      syntax: 'is:verified',
      help: '只看认证用户发布的帖子',
      build: () => 'is:verified'
    },
    {
      key: 'phrase',
      label: '完整词组',
      syntax: '"完整词组"',
      help: '精确匹配一整段词组',
      input: { type: 'text', placeholder: '完整词组' },
      build: (value) => value ? `"${value.replace(/^"+|"+$/g, '').replace(/"/g, '\\"')}"` : ''
    },
    {
      key: 'or',
      label: '或搜索',
      syntax: 'A OR B',
      help: '两个关键词任意命中一个即可',
      input: { type: 'text', placeholder: 'AI OR ChatGPT' },
      build: (value) => value ? value.replace(/\s*\|\s*/g, ' OR ') : ''
    }
  ];

  function positiveInteger(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : '';
  }

  function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function dateDaysAgo(days) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - days);
    return formatLocalDate(date);
  }

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
    style.dataset.xasVersion = VERSION;
    style.textContent = `
      #${BUTTON_ID} {
        position: fixed;
        right: 22px;
        bottom: 86px;
        width: 52px;
        height: 52px;
        border: 1px solid rgba(113, 118, 123, .5);
        border-radius: 999px;
        background: #000 url("${ICON_URL}") center / 76% 76% no-repeat;
        color: transparent;
        box-shadow: 0 10px 28px rgba(0, 0, 0, .35);
        cursor: grab;
        touch-action: none;
        user-select: none;
        z-index: 10000;
      }
      #${BUTTON_ID}.xas-dragging { cursor: grabbing; }
      #${BUTTON_ID}:hover { filter: brightness(1.08); }
      #${PANEL_ID} {
        position: fixed;
        right: 22px;
        bottom: 144px;
        width: min(560px, calc(100vw - 28px));
        max-height: min(720px, calc(100vh - 172px));
        overflow: auto;
        box-sizing: border-box;
        border: 1px solid rgba(113, 118, 123, .42);
        border-radius: 10px;
        background: rgba(0, 0, 0, .97);
        color: rgb(231, 233, 234);
        padding: 14px;
        font: 14px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 18px 48px rgba(0, 0, 0, .45);
        z-index: 10000;
      }
      #${PANEL_ID}[hidden] { display: none !important; }
      html:not([style*="color-scheme: dark"]) #${PANEL_ID} {
        background: rgba(255, 255, 255, .98);
        color: rgb(15, 20, 25);
      }
      #${PANEL_ID} * { box-sizing: border-box; font: inherit; }
      #${PANEL_ID} .xas-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 12px;
      }
      #${PANEL_ID} .xas-title { font-size: 18px; font-weight: 800; }
      #${PANEL_ID} .xas-close {
        width: 32px;
        height: 32px;
        border-radius: 999px;
        padding: 0;
        font-size: 18px;
      }
      #${PANEL_ID} .xas-base {
        display: grid;
        gap: 6px;
        margin-bottom: 12px;
      }
      #${PANEL_ID} .xas-base-note,
      #${PANEL_ID} .xas-help,
      #${PANEL_ID} .xas-status {
        color: rgb(113, 118, 123);
      }
      #${PANEL_ID} .xas-date-shortcuts {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      #${PANEL_ID} input,
      #${PANEL_ID} textarea {
        width: 100%;
        min-width: 0;
        border: 1px solid rgba(113, 118, 123, .45);
        border-radius: 7px;
        background: transparent;
        color: inherit;
        padding: 8px 9px;
        outline: none;
      }
      #${PANEL_ID} textarea { resize: vertical; min-height: 68px; }
      #${PANEL_ID} input:focus,
      #${PANEL_ID} textarea:focus { border-color: rgb(29, 155, 240); }
      #${PANEL_ID} .xas-list {
        display: grid;
        gap: 8px;
        margin-bottom: 12px;
      }
      #${PANEL_ID} .xas-row {
        display: grid;
        grid-template-columns: 24px minmax(0, 1fr);
        gap: 8px;
        padding: 9px;
        border: 1px solid rgba(113, 118, 123, .25);
        border-radius: 8px;
      }
      #${PANEL_ID} .xas-row input[type="checkbox"] {
        width: 17px;
        height: 17px;
        margin-top: 2px;
      }
      #${PANEL_ID} .xas-row-main {
        display: grid;
        gap: 6px;
      }
      #${PANEL_ID} .xas-row-top {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        justify-content: space-between;
        gap: 6px;
      }
      #${PANEL_ID} .xas-label { font-weight: 700; }
      #${PANEL_ID} .xas-syntax {
        color: rgb(29, 155, 240);
        font-family: Consolas, "SFMono-Regular", Menlo, monospace;
        font-size: 12px;
      }
      #${PANEL_ID} .xas-preview-label {
        display: grid;
        gap: 6px;
        margin-bottom: 12px;
      }
      #${PANEL_ID} .xas-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
      }
      #${PANEL_ID} button {
        border: 1px solid rgba(113, 118, 123, .45);
        border-radius: 999px;
        background: transparent;
        color: inherit;
        padding: 7px 12px;
        cursor: pointer;
        white-space: nowrap;
      }
      #${PANEL_ID} button:hover { border-color: rgb(29, 155, 240); color: rgb(29, 155, 240); }
      #${PANEL_ID} .xas-primary {
        border-color: rgb(29, 155, 240);
        background: rgb(29, 155, 240);
        color: white;
        font-weight: 800;
      }
      #${PANEL_ID} .xas-secondary { margin-left: auto; }
      @media (max-width: 700px) {
        #${BUTTON_ID} { right: 14px; bottom: 72px; }
        #${PANEL_ID} {
          right: 10px;
          left: 10px;
          bottom: 132px;
          width: auto;
          max-height: calc(100vh - 150px);
        }
      }
    `;
  }

  function getSearchInput() {
    return document.querySelector(SEARCH_INPUT_SELECTOR);
  }

  function nativeSetValue(input, value) {
    const proto = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function currentQuery() {
    const fromUrl = new URL(location.href).searchParams.get('q');
    const input = getSearchInput();
    return (fromUrl || input?.value || '').trim();
  }

  function panel() {
    return document.getElementById(PANEL_ID);
  }

  function rowControl(key, suffix) {
    return panel()?.querySelector(`[data-xas-${suffix}="${key}"]`);
  }

  function setStatus(text, isError = false) {
    const status = panel()?.querySelector('.xas-status');
    if (!status) return;
    status.textContent = text || '';
    status.style.color = isError ? 'rgb(244, 33, 46)' : 'rgb(113, 118, 123)';
  }

  function isChecked(key) {
    return !!rowControl(key, 'check')?.checked;
  }

  function inputValue(key) {
    return (rowControl(key, 'value')?.value || '').trim();
  }

  function buildQuery() {
    const root = panel();
    if (!root) return '';
    const parts = [];
    const base = root.querySelector('[data-xas-base]')?.value.trim();
    if (base) parts.push(base);

    for (const param of PARAMS) {
      if (!isChecked(param.key)) continue;
      const token = param.build(inputValue(param.key));
      if (token) parts.push(token);
    }

    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function updatePreview() {
    const root = panel();
    if (!root) return;
    root.querySelector('[data-xas-preview]').value = buildQuery();
  }

  function openPanel() {
    const root = panel();
    if (!root) return;
    root.hidden = false;
    const base = root.querySelector('[data-xas-base]');
    if (!base.value.trim()) base.value = currentQuery();
    updatePreview();
    base.focus();
  }

  function closePanel() {
    const root = panel();
    if (root) root.hidden = true;
  }

  function togglePanel() {
    const root = panel();
    if (!root) return;
    if (root.hidden) openPanel();
    else closePanel();
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function readSavedButtonPosition() {
    try {
      const parsed = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null');
      if (!parsed || typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function setButtonPosition(button, left, top) {
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - button.offsetWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - button.offsetHeight - margin);
    const nextLeft = clamp(left, margin, maxLeft);
    const nextTop = clamp(top, margin, maxTop);
    button.style.left = `${nextLeft}px`;
    button.style.top = `${nextTop}px`;
    button.style.right = 'auto';
    button.style.bottom = 'auto';
    return { left: nextLeft, top: nextTop };
  }

  function saveButtonPosition(button) {
    const rect = button.getBoundingClientRect();
    const pos = setButtonPosition(button, rect.left, rect.top);
    localStorage.setItem(POSITION_KEY, JSON.stringify(pos));
  }

  function restoreButtonPosition(button) {
    const saved = readSavedButtonPosition();
    if (!saved) return;
    requestAnimationFrame(() => setButtonPosition(button, saved.left, saved.top));
  }

  function enableButtonDrag(button) {
    let state = null;

    button.addEventListener('pointerdown', (event) => {
      if (event.button != null && event.button !== 0) return;
      const rect = button.getBoundingClientRect();
      state = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        moved: false
      };
      button.setPointerCapture?.(event.pointerId);
    });

    button.addEventListener('pointermove', (event) => {
      if (!state || event.pointerId !== state.pointerId) return;
      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      if (Math.hypot(dx, dy) > 4) state.moved = true;
      if (!state.moved) return;
      button.classList.add('xas-dragging');
      setButtonPosition(button, state.left + dx, state.top + dy);
    });

    function finishDrag(event) {
      if (!state || event.pointerId !== state.pointerId) return;
      button.releasePointerCapture?.(event.pointerId);
      button.classList.remove('xas-dragging');
      if (state.moved) {
        button.dataset.xasSuppressClick = '1';
        saveButtonPosition(button);
        setTimeout(() => {
          delete button.dataset.xasSuppressClick;
        }, 0);
      }
      state = null;
    }

    button.addEventListener('pointerup', finishDrag);
    button.addEventListener('pointercancel', finishDrag);
    button.addEventListener('click', (event) => {
      if (button.dataset.xasSuppressClick === '1') {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      togglePanel();
    });
  }

  function clearAll() {
    const root = panel();
    root.querySelector('[data-xas-base]').value = '';
    root.querySelectorAll('[data-xas-check]').forEach((input) => {
      input.checked = false;
    });
    root.querySelectorAll('[data-xas-value]').forEach((input) => {
      input.value = '';
    });
    updatePreview();
    setStatus('已清空');
  }

  function readCurrent() {
    const root = panel();
    root.querySelector('[data-xas-base]').value = currentQuery();
    updatePreview();
    setStatus('已读取当前搜索词');
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
      setStatus('请先输入关键词，或勾选至少一个搜索参数', true);
      return;
    }
    applyToInput();
    const url = new URL('/search', location.origin);
    url.searchParams.set('q', query);
    url.searchParams.set('src', 'typed_query');
    if (mode === 'latest') url.searchParams.set('f', 'live');
    location.assign(url.toString());
  }

  function applySinceShortcut(daysAgo) {
    const sinceCheck = rowControl('since', 'check');
    const sinceValue = rowControl('since', 'value');
    const untilCheck = rowControl('until', 'check');
    const untilValue = rowControl('until', 'value');
    if (sinceCheck) sinceCheck.checked = true;
    if (sinceValue) sinceValue.value = dateDaysAgo(daysAgo);
    if (untilCheck) untilCheck.checked = false;
    if (untilValue) untilValue.value = '';
    updatePreview();
    setStatus(daysAgo === 0 ? '已选择今天' : `已选择近 ${daysAgo} 天`);
  }

  function createParamRow(param) {
    const checkbox = el('input', {
      type: 'checkbox',
      'data-xas-check': param.key,
      title: `启用：${param.label}`
    });
    const children = [
      el('div', { className: 'xas-row-top' }, [
        el('span', { className: 'xas-label', text: param.label }),
        el('span', { className: 'xas-syntax', text: param.syntax })
      ]),
      el('div', { className: 'xas-help', text: param.help })
    ];

    if (param.input) {
      children.push(el('input', {
        ...param.input,
        'data-xas-value': param.key
      }));
    }

    if (param.key === 'since') {
      children.push(el('div', { className: 'xas-date-shortcuts' }, [
        el('button', { type: 'button', onclick: () => applySinceShortcut(0) }, '今天'),
        el('button', { type: 'button', onclick: () => applySinceShortcut(7) }, '近一周'),
        el('button', { type: 'button', onclick: () => applySinceShortcut(30) }, '近一月')
      ]));
    }

    return el('div', { className: 'xas-row' }, [
      checkbox,
      el('div', { className: 'xas-row-main' }, children)
    ]);
  }

  function createPanel() {
    const root = el('section', { id: PANEL_ID, hidden: true, 'data-xas-version': VERSION }, [
      el('div', { className: 'xas-head' }, [
        el('div', { className: 'xas-title', text: 'X 高级搜索参数' }),
        el('button', { type: 'button', className: 'xas-close', title: '关闭', onclick: closePanel }, '×')
      ]),
      el('label', { className: 'xas-base' }, [
        el('span', { text: '关键词' }),
        el('input', { type: 'text', 'data-xas-base': true, placeholder: '例如：AI' }),
        el('span', { className: 'xas-base-note', text: '例如：AI 表示帖子里包含 “AI” 关键词。下面勾选的参数会追加到关键词后面。' })
      ]),
      el('div', { className: 'xas-list' }, PARAMS.map(createParamRow)),
      el('label', { className: 'xas-preview-label' }, [
        el('span', { text: '将要执行的搜索命令' }),
        el('textarea', { readonly: true, 'data-xas-preview': true })
      ]),
      el('div', { className: 'xas-actions' }, [
        el('button', { type: 'button', className: 'xas-primary', onclick: () => goSearch('top') }, '确定并刷新'),
        el('button', { type: 'button', onclick: () => goSearch('latest') }, '按最新刷新'),
        el('button', { type: 'button', onclick: applyToInput }, '只填入搜索框'),
        el('button', { type: 'button', onclick: readCurrent }, '读取当前'),
        el('button', { type: 'button', className: 'xas-secondary', onclick: clearAll }, '清空'),
        el('span', { className: 'xas-status', text: '' })
      ])
    ]);

    root.addEventListener('input', updatePreview);
    root.addEventListener('change', updatePreview);
    return root;
  }

  function createButton() {
    const button = el('button', {
      id: BUTTON_ID,
      type: 'button',
      'data-xas-version': VERSION,
      title: '打开 X 高级搜索参数',
      'aria-label': '打开 X 高级搜索参数'
    }, '');
    enableButtonDrag(button);
    restoreButtonPosition(button);
    return button;
  }

  function mount() {
    if (!isTargetRoute()) {
      document.getElementById(BUTTON_ID)?.remove();
      document.getElementById(PANEL_ID)?.remove();
      return;
    }
    addStyles();
    const staleButton = document.getElementById(BUTTON_ID);
    if (staleButton && staleButton.dataset.xasVersion !== VERSION) staleButton.remove();
    const stalePanel = document.getElementById(PANEL_ID);
    if (stalePanel && stalePanel.dataset.xasVersion !== VERSION) stalePanel.remove();
    if (!document.getElementById(BUTTON_ID)) document.body.append(createButton());
    if (!document.getElementById(PANEL_ID)) {
      document.body.append(createPanel());
      log('mounted floating search helper');
    }
    updatePreview();
  }

  window.addEventListener('resize', () => {
    const button = document.getElementById(BUTTON_ID);
    if (button) saveButtonPosition(button);
  });

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

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel()?.hidden) closePanel();
  });

  scheduleMount();
})();
