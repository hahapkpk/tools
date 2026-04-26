// ==UserScript==
// @name         X Element Blocker
// @namespace    https://github.com/hahapkpk/tools
// @version      1.4.0
// @description  在 X.com 上通过点选元素来屏蔽不想要的区域，类似 uBlock 的自定义屏蔽功能
// @author       hahapkpk
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── 常量 ───────────────────────────────────────────────────────────────────
  const STORAGE_KEY = 'x_element_blocker_rules';
  const PANEL_VISIBLE_KEY = 'x_element_blocker_panel_visible';
  const PAUSED_KEY = 'x_element_blocker_paused';
  const DEBUG_KEY = 'x_element_blocker_debug';

  // ─── 状态 ───────────────────────────────────────────────────────────────────
  let rules = normalizeRules(GM_getValue(STORAGE_KEY, []));
  GM_setValue(STORAGE_KEY, rules);
  let panelVisible = false; // 默认隐藏
  let paused = GM_getValue(PAUSED_KEY, false);
  let debugMode = GM_getValue(DEBUG_KEY, false);
  let pickMode = false;
  let pendingSelectors = []; // 待确认的选择器列表
  let highlightedEl = null;
  let selectedEls = []; // 多选暂存

  function normalizeRules(saved) {
    const now = new Date().toISOString();
    if (!Array.isArray(saved)) return [];
    return saved
      .map(item => {
        if (typeof item === 'string') {
          return {
            selector: item,
            enabled: true,
            createdAt: now,
            updatedAt: now
          };
        }
        if (item && typeof item.selector === 'string') {
          return {
            selector: item.selector,
            enabled: item.enabled !== false,
            createdAt: item.createdAt || now,
            updatedAt: item.updatedAt || item.createdAt || now
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  function saveRules() {
    GM_setValue(STORAGE_KEY, rules);
  }

  function createRule(selector) {
    const now = new Date().toISOString();
    return {
      selector,
      enabled: true,
      createdAt: now,
      updatedAt: now
    };
  }

  function formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function getSelector(rule) {
    return typeof rule === 'string' ? rule : rule.selector;
  }

  // ─── 样式 ───────────────────────────────────────────────────────────────────
  GM_addStyle(`
    #xeb-panel {
      position: fixed;
      top: 80px;
      right: 20px;
      width: 340px;
      background: #15202b;
      color: #e7e9ea;
      border: 1px solid #38444d;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      user-select: none;
    }
    #xeb-panel.xeb-hidden { display: none !important; }
    #xeb-toggle-fab.xeb-hidden { display: none !important; }
    #xeb-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px 10px;
      border-bottom: 1px solid #38444d;
      cursor: move;
      border-radius: 12px 12px 0 0;
    }
    #xeb-header span { font-weight: 700; font-size: 14px; }
    #xeb-close {
      cursor: pointer;
      opacity: 0.6;
      font-size: 18px;
      line-height: 1;
      padding: 0 2px;
    }
    #xeb-close:hover { opacity: 1; }
    #xeb-body { padding: 12px 14px; }
    #xeb-control-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-bottom: 8px;
    }
    #xeb-pick-btn {
      width: 100%;
      padding: 8px;
      background: #1d9bf0;
      color: #fff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 10px;
      transition: background 0.15s;
    }
    #xeb-control-row #xeb-pick-btn { grid-column: 1 / -1; margin-bottom: 0; }
    #xeb-pick-btn:hover { background: #1a8cd8; }
    #xeb-pick-btn.active { background: #f4212e; }
    #xeb-pick-btn.active:hover { background: #d91c27; }
    #xeb-pause-btn, #xeb-debug-btn {
      padding: 7px 8px;
      background: #38444d;
      color: #e7e9ea;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
    }
    #xeb-pause-btn.active { background: #f4212e; color: #fff; }
    #xeb-debug-btn.active { background: #00ba7c; color: #fff; }
    #xeb-pause-btn:hover, #xeb-debug-btn:hover { filter: brightness(1.12); }
    #xeb-pending-list {
      max-height: 120px;
      overflow-y: auto;
      margin-bottom: 8px;
    }
    .xeb-pending-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 6px;
      background: #1e2d3d;
      border-radius: 6px;
      margin-bottom: 4px;
      font-size: 11px;
      word-break: break-all;
    }
    .xeb-pending-item .xeb-del {
      cursor: pointer;
      color: #f4212e;
      flex-shrink: 0;
      font-size: 14px;
      line-height: 1;
    }
    .xeb-pending-item .xeb-del:hover { opacity: 0.7; }
    .xeb-pending-item code {
      flex: 1;
      color: #7ec8e3;
      font-family: monospace;
    }
    #xeb-preview-btn, #xeb-save-btn, #xeb-cancel-btn {
      padding: 6px 12px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
    }
    #xeb-preview-btn { background: #536471; color: #fff; }
    #xeb-preview-btn:hover { background: #6e7f8d; }
    #xeb-save-btn { background: #00ba7c; color: #fff; }
    #xeb-save-btn:hover { background: #00a36c; }
    #xeb-cancel-btn { background: #38444d; color: #e7e9ea; }
    #xeb-cancel-btn:hover { background: #4a5568; }
    #xeb-action-row {
      display: flex;
      gap: 6px;
      margin-bottom: 10px;
    }
    #xeb-divider {
      border: none;
      border-top: 1px solid #38444d;
      margin: 8px 0;
    }
    #xeb-rules-title {
      font-size: 11px;
      color: #8899a6;
      margin-bottom: 6px;
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }
    #xeb-rules-list {
      max-height: 160px;
      overflow-y: auto;
    }
    .xeb-rule-item {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 4px 6px;
      border-radius: 6px;
      margin-bottom: 3px;
    }
    .xeb-rule-item.disabled { opacity: 0.55; }
    .xeb-rule-item:hover { background: #1e2d3d; }
    .xeb-rule-main {
      flex: 1;
      min-width: 0;
    }
    .xeb-rule-item code {
      font-size: 11px;
      color: #7ec8e3;
      font-family: monospace;
      word-break: break-all;
    }
    .xeb-rule-meta {
      margin-top: 3px;
      color: #8899a6;
      font-size: 10px;
      line-height: 1.35;
    }
    .xeb-rule-hit { color: #00ba7c; }
    .xeb-rule-actions {
      display: flex;
      gap: 4px;
      flex-shrink: 0;
    }
    .xeb-rule-toggle, .xeb-rule-del {
      border: none;
      background: transparent;
      cursor: pointer;
      color: #e7e9ea;
      font-size: 12px;
      line-height: 1;
      padding: 3px;
      border-radius: 4px;
    }
    .xeb-rule-toggle:hover, .xeb-rule-del:hover { background: #38444d; }
    .xeb-rule-toggle.off { color: #8899a6; }
    .xeb-rule-del { color: #f4212e; font-size: 14px; }
    #xeb-empty { color: #536471; font-size: 12px; text-align: center; padding: 8px 0; }
    #xeb-io-row {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }
    #xeb-export-btn, #xeb-import-btn {
      flex: 1;
      padding: 6px 0;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
    }
    #xeb-export-btn { background: #38444d; color: #e7e9ea; }
    #xeb-export-btn:hover { background: #4a5568; }
    #xeb-import-btn { background: #38444d; color: #e7e9ea; }
    #xeb-import-btn:hover { background: #4a5568; }

    /* 选取模式高亮 */
    .xeb-hover-highlight {
      outline: 2px dashed #1d9bf0 !important;
      outline-offset: 2px !important;
      cursor: crosshair !important;
    }
    .xeb-selected-highlight {
      outline: 2px solid #00ba7c !important;
      outline-offset: 2px !important;
    }
    /* 预览隐藏 */
    .xeb-preview-hidden {
      opacity: 0.15 !important;
      pointer-events: none !important;
    }
    .xeb-debug-match {
      outline: 2px solid #ffad1f !important;
      outline-offset: 2px !important;
      background: rgba(255, 173, 31, 0.12) !important;
    }

    /* 底部开关按钮 */
    #xeb-toggle-fab {
      position: fixed;
      bottom: 24px;
      right: 20px;
      width: 44px;
      height: 44px;
      background: #1d9bf0;
      color: #fff;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      z-index: 999998;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      transition: background 0.15s, transform 0.15s;
    }
    #xeb-toggle-fab:hover { background: #1a8cd8; transform: scale(1.08); }
    #xeb-toggle-fab.panel-on { background: #536471; }
  `);

  // ─── 生成稳定 CSS 选择器 ─────────────────────────────────────────────────────
  // X.com 会动态更换 class，所以优先用结构路径 + 稳定属性
  function getStableSelector(el) {
    // 优先用 data-testid（X.com 大量使用且相对稳定）
    if (el.dataset && el.dataset.testid) {
      return `[data-testid="${el.dataset.testid}"]`;
    }
    // aria-label
    if (el.getAttribute('aria-label')) {
      const tag = el.tagName.toLowerCase();
      const label = el.getAttribute('aria-label').replace(/"/g, '\\"');
      return `${tag}[aria-label="${label}"]`;
    }
    // role + 结构路径
    return buildStructuralSelector(el);
  }

  function buildStructuralSelector(el) {
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur !== document.body && depth < 5) {
      let seg = cur.tagName.toLowerCase();
      // 优先 data-testid
      if (cur.dataset && cur.dataset.testid) {
        parts.unshift(`[data-testid="${cur.dataset.testid}"]`);
        break;
      }
      // nth-of-type 定位
      const siblings = cur.parentElement
        ? Array.from(cur.parentElement.children).filter(c => c.tagName === cur.tagName)
        : [];
      if (siblings.length > 1) {
        const idx = siblings.indexOf(cur) + 1;
        seg += `:nth-of-type(${idx})`;
      }
      parts.unshift(seg);
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  // ─── 应用规则（隐藏元素）────────────────────────────────────────────────────
  function applyRules() {
    restoreHiddenElements();
    clearDebugMarks();
    if (paused) {
      if (panelVisible) renderRules();
      return;
    }
    rules.forEach((rule, index) => {
      if (!rule.enabled) return;
      const selector = getSelector(rule);
      try {
        document.querySelectorAll(selector).forEach(el => {
          if (el.closest('#xeb-panel') || el.closest('#xeb-toggle-fab')) return;
          if (debugMode) {
            if (!el.dataset.xebDebugRule) {
              el.dataset.xebHadTitle = el.hasAttribute('title') ? '1' : '0';
              el.dataset.xebOldTitle = el.getAttribute('title') || '';
            }
            el.classList.add('xeb-debug-match');
            el.dataset.xebDebugRule = String(index + 1);
            el.title = `[X Element Blocker #${index + 1}] ${selector}`;
          } else {
            hideElement(el);
          }
        });
      } catch (e) { /* 无效选择器跳过 */ }
    });
    if (panelVisible) renderRules();
  }

  function restoreHiddenElements() {
    document.querySelectorAll('[data-xeb-hidden="1"]').forEach(el => {
      el.style.display = el.dataset.xebOldDisplay || '';
      delete el.dataset.xebHidden;
      delete el.dataset.xebOldDisplay;
    });
  }

  function clearDebugMarks() {
    document.querySelectorAll('.xeb-debug-match').forEach(el => {
      el.classList.remove('xeb-debug-match');
      delete el.dataset.xebDebugRule;
      if (el.dataset.xebHadTitle === '1') {
        el.setAttribute('title', el.dataset.xebOldTitle || '');
      } else {
        el.removeAttribute('title');
      }
      delete el.dataset.xebHadTitle;
      delete el.dataset.xebOldTitle;
    });
  }

  function hideElement(el) {
    if (!el.dataset.xebHidden) {
      el.dataset.xebOldDisplay = el.style.display || '';
      el.dataset.xebHidden = '1';
    }
    el.style.setProperty('display', 'none', 'important');
  }

  function countMatches(selector) {
    try {
      return Array.from(document.querySelectorAll(selector))
        .filter(el => !el.closest('#xeb-panel') && !el.closest('#xeb-toggle-fab')).length;
    } catch (e) {
      return 0;
    }
  }

  // MutationObserver 监听 DOM 变化（懒加载 / 动态内容）
  const observer = new MutationObserver(() => applyRules());
  observer.observe(document.body, { childList: true, subtree: true });

  // ─── 面板 UI ─────────────────────────────────────────────────────────────────
  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'xeb-panel';
    panel.className = 'xeb-hidden';
    panel.innerHTML = `
      <div id="xeb-header">
        <span>🚫 Element Blocker</span>
        <span id="xeb-close">×</span>
      </div>
      <div id="xeb-body">
        <div id="xeb-control-row">
          <button id="xeb-pick-btn">🖱 点击选取元素</button>
          <button id="xeb-pause-btn" title="临时恢复所有被屏蔽内容">暂停屏蔽</button>
          <button id="xeb-debug-btn" title="高亮命中的元素，方便排查误屏蔽">调试</button>
        </div>
        <div id="xeb-pending-list"></div>
        <div id="xeb-action-row" style="display:none">
          <button id="xeb-preview-btn">预览</button>
          <button id="xeb-save-btn">确认保存</button>
          <button id="xeb-cancel-btn">取消</button>
        </div>
        <hr id="xeb-divider">
        <div id="xeb-rules-title"><span>已保存规则</span><span id="xeb-status"></span></div>
        <div id="xeb-rules-list"></div>
        <div id="xeb-io-row">
          <button id="xeb-export-btn">导出</button>
          <button id="xeb-import-btn">导入</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    // FAB 开关
    const fab = document.createElement('button');
    fab.id = 'xeb-toggle-fab';
    fab.title = '显示/隐藏 Element Blocker';
    fab.textContent = '🚫';
    document.body.appendChild(fab);

    bindEvents(panel, fab);
    renderRules();
    return panel;
  }

  function renderPending() {
    const list = document.getElementById('xeb-pending-list');
    const row = document.getElementById('xeb-action-row');
    if (!list) return;
    list.innerHTML = '';
    pendingSelectors.forEach((sel, i) => {
      const item = document.createElement('div');
      item.className = 'xeb-pending-item';
      item.innerHTML = `<code>${escHtml(sel)}</code><span class="xeb-del" data-i="${i}">×</span>`;
      list.appendChild(item);
    });
    if (row) row.style.display = pendingSelectors.length ? 'flex' : 'none';
  }

  function renderRules() {
    const list = document.getElementById('xeb-rules-list');
    const status = document.getElementById('xeb-status');
    if (!list) return;
    if (status) {
      const enabledCount = rules.filter(rule => rule.enabled).length;
      status.textContent = paused ? '已暂停' : `${enabledCount}/${rules.length} 启用`;
    }
    syncControlButtons();
    list.innerHTML = '';
    if (rules.length === 0) {
      list.innerHTML = '<div id="xeb-empty">暂无规则</div>';
      return;
    }
    rules.forEach((rule, i) => {
      const sel = getSelector(rule);
      const item = document.createElement('div');
      item.className = `xeb-rule-item${rule.enabled ? '' : ' disabled'}`;
      const hitCount = countMatches(sel);
      item.innerHTML = `
        <div class="xeb-rule-main">
          <code>${escHtml(sel)}</code>
          <div class="xeb-rule-meta">
            添加：${escHtml(formatDate(rule.createdAt))}
            <span class="xeb-rule-hit">命中 ${hitCount}</span>
          </div>
        </div>
        <div class="xeb-rule-actions">
          <button class="xeb-rule-toggle${rule.enabled ? '' : ' off'}" data-i="${i}" title="${rule.enabled ? '禁用此规则' : '启用此规则'}">${rule.enabled ? '✓' : '○'}</button>
          <button class="xeb-rule-del" data-i="${i}" title="删除此规则">×</button>
        </div>
      `;
      list.appendChild(item);
    });
  }

  function syncControlButtons() {
    const pauseBtn = document.getElementById('xeb-pause-btn');
    const debugBtn = document.getElementById('xeb-debug-btn');
    if (pauseBtn) {
      pauseBtn.textContent = paused ? '恢复屏蔽' : '暂停屏蔽';
      pauseBtn.classList.toggle('active', paused);
    }
    if (debugBtn) {
      debugBtn.textContent = debugMode ? '退出调试' : '调试';
      debugBtn.classList.toggle('active', debugMode);
    }
  }

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── 事件绑定 ────────────────────────────────────────────────────────────────
  function bindEvents(panel, fab) {
    // 拖动
    makeDraggable(panel, document.getElementById('xeb-header'));

    // 关闭按钮
    document.getElementById('xeb-close').addEventListener('click', () => togglePanel(false));

    // FAB
    fab.addEventListener('click', () => togglePanel(!panelVisible));

    document.getElementById('xeb-pause-btn').addEventListener('click', () => {
      setPaused(!paused);
    });

    document.getElementById('xeb-debug-btn').addEventListener('click', () => {
      setDebugMode(!debugMode);
    });

    // 选取按钮
    document.getElementById('xeb-pick-btn').addEventListener('click', () => {
      pickMode = !pickMode;
      const btn = document.getElementById('xeb-pick-btn');
      if (pickMode) {
        btn.textContent = '⏹ 停止选取';
        btn.classList.add('active');
        document.body.style.cursor = 'crosshair';
      } else {
        stopPickMode();
      }
    });

    // 预览
    document.getElementById('xeb-preview-btn').addEventListener('click', () => {
      clearPreview();
      pendingSelectors.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(el => {
            if (!el.closest('#xeb-panel') && !el.closest('#xeb-toggle-fab')) {
              el.classList.add('xeb-preview-hidden');
            }
          });
        } catch (e) {}
      });
    });

    // 确认保存
    document.getElementById('xeb-save-btn').addEventListener('click', () => {
      clearPreview();
      pendingSelectors.forEach(sel => {
        if (!rules.some(rule => getSelector(rule) === sel)) rules.push(createRule(sel));
      });
      saveRules();
      pendingSelectors = [];
      clearSelectedHighlights();
      renderPending();
      renderRules();
      applyRules();
    });

    // 取消
    document.getElementById('xeb-cancel-btn').addEventListener('click', () => {
      clearPreview();
      pendingSelectors = [];
      clearSelectedHighlights();
      renderPending();
    });

    // 删除 pending
    document.getElementById('xeb-pending-list').addEventListener('click', e => {
      const del = e.target.closest('.xeb-del');
      if (del) {
        const i = parseInt(del.dataset.i);
        pendingSelectors.splice(i, 1);
        renderPending();
      }
    });

    // 启用、禁用、删除已保存规则
    document.getElementById('xeb-rules-list').addEventListener('click', e => {
      const toggle = e.target.closest('.xeb-rule-toggle');
      if (toggle) {
        const i = parseInt(toggle.dataset.i);
        if (rules[i]) {
          rules[i].enabled = !rules[i].enabled;
          rules[i].updatedAt = new Date().toISOString();
          saveRules();
          applyRules();
        }
        return;
      }
      const del = e.target.closest('.xeb-rule-del');
      if (del) {
        const i = parseInt(del.dataset.i);
        rules.splice(i, 1);
        saveRules();
        renderRules();
        applyRules();
      }
    });

    // 导出规则
    document.getElementById('xeb-export-btn').addEventListener('click', () => {
      const json = JSON.stringify(rules, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'x-element-blocker-rules.json';
      a.click();
      URL.revokeObjectURL(url);
    });

    // 导入规则
    document.getElementById('xeb-import-btn').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', () => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          try {
            const imported = JSON.parse(ev.target.result);
            if (!Array.isArray(imported)) throw new Error('格式错误');
            normalizeRules(imported).forEach(rule => {
              if (!rules.some(item => getSelector(item) === rule.selector)) rules.push(rule);
            });
            saveRules();
            renderRules();
            applyRules();
            alert(`已导入 ${imported.length} 条规则`);
          } catch (e) {
            alert('导入失败：' + e.message);
          }
        };
        reader.readAsText(file);
      });
      input.click();
    });

    // 全局鼠标事件（选取模式）
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('click', onPickClick, true);
  }

  // ─── 选取模式鼠标事件 ────────────────────────────────────────────────────────
  function onMouseOver(e) {
    if (!pickMode) return;
    const el = e.target;
    if (el.closest('#xeb-panel') || el.closest('#xeb-toggle-fab')) return;
    if (highlightedEl && highlightedEl !== el) {
      highlightedEl.classList.remove('xeb-hover-highlight');
    }
    highlightedEl = el;
    el.classList.add('xeb-hover-highlight');
  }

  function onMouseOut(e) {
    if (!pickMode) return;
    const el = e.target;
    if (el !== highlightedEl) return;
    el.classList.remove('xeb-hover-highlight');
    highlightedEl = null;
  }

  function onPickClick(e) {
    if (!pickMode) return;
    const el = e.target;
    if (el.closest('#xeb-panel') || el.closest('#xeb-toggle-fab')) return;
    e.preventDefault();
    e.stopPropagation();

    const sel = getStableSelector(el);
    el.classList.remove('xeb-hover-highlight');
    el.classList.add('xeb-selected-highlight');
    selectedEls.push(el);

    if (!pendingSelectors.includes(sel)) {
      pendingSelectors.push(sel);
      renderPending();
    }
  }

  function stopPickMode() {
    pickMode = false;
    const btn = document.getElementById('xeb-pick-btn');
    if (btn) {
      btn.textContent = '🖱 点击选取元素';
      btn.classList.remove('active');
    }
    document.body.style.cursor = '';
    if (highlightedEl) {
      highlightedEl.classList.remove('xeb-hover-highlight');
      highlightedEl = null;
    }
  }

  function clearSelectedHighlights() {
    selectedEls.forEach(el => el.classList.remove('xeb-selected-highlight'));
    selectedEls = [];
  }

  function clearPreview() {
    document.querySelectorAll('.xeb-preview-hidden').forEach(el => {
      el.classList.remove('xeb-preview-hidden');
    });
  }

  function setPaused(value) {
    paused = value;
    GM_setValue(PAUSED_KEY, paused);
    applyRules();
  }

  function setDebugMode(value) {
    debugMode = value;
    GM_setValue(DEBUG_KEY, debugMode);
    applyRules();
  }

  // ─── 面板显隐 ────────────────────────────────────────────────────────────────
  function togglePanel(show) {
    panelVisible = show;
    const panel = document.getElementById('xeb-panel');
    const fab = document.getElementById('xeb-toggle-fab');
    if (!panel) return;
    if (panelVisible) {
      panel.classList.remove('xeb-hidden');
      fab && fab.classList.remove('xeb-hidden');
      fab && fab.classList.add('panel-on');
      renderRules();
    } else {
      panel.classList.add('xeb-hidden');
      fab && fab.classList.add('xeb-hidden');
      if (pickMode) stopPickMode();
      clearPreview();
    }
  }

  // ─── 拖动 ────────────────────────────────────────────────────────────────────
  function makeDraggable(panel, handle) {
    let startX, startY, startLeft, startTop;
    handle.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      document.addEventListener('mousemove', onDrag);
      document.addEventListener('mouseup', onDragEnd);
      e.preventDefault();
    });
    function onDrag(e) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.left = (startLeft + dx) + 'px';
      panel.style.top = (startTop + dy) + 'px';
      panel.style.right = 'auto';
    }
    function onDragEnd() {
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup', onDragEnd);
    }
  }

  // ─── 油猴菜单命令 ────────────────────────────────────────────────────────────
  GM_registerMenuCommand('显示/隐藏 Element Blocker', () => {
    togglePanel(!panelVisible);
  });
  GM_registerMenuCommand('暂停/恢复屏蔽', () => {
    setPaused(!paused);
  });
  GM_registerMenuCommand('开启/关闭调试高亮', () => {
    setDebugMode(!debugMode);
  });

  // ─── 初始化 ──────────────────────────────────────────────────────────────────
  function init() {
    buildPanel();
    applyRules();
    // 默认隐藏，不打扰用户
    togglePanel(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
