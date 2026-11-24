// ==UserScript==
// @name         X Layout Studio
// @namespace    local.codex.x-layout-studio
// @version      0.3.2
// @description  Drag to resize the X timeline column, reclaim the empty right rail, compact the nav, and declutter the timeline.
// @match        https://x.com/*
// @match        https://pro.x.com/*
// @run-at       document-start
// @homepageURL  https://github.com/hahapkpk/tools
// @supportURL   https://github.com/hahapkpk/tools/issues
// @downloadURL  https://cdn.jsdelivr.net/gh/hahapkpk/tools@main/x-layout-studio.user.js
// @updateURL    https://cdn.jsdelivr.net/gh/hahapkpk/tools@main/x-layout-studio.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @license      MIT
// ==/UserScript==

/*
 * LAYOUT ENGINE (reverse-engineered 2026-11 against the XDS frontend).
 *
 * X drives its whole 3-column shell from two CSS custom properties, so this
 * script never moves DOM nodes — it only rewrites those variables:
 *
 *   --x-main-column-width   declared on the outer shell div, consumed by
 *                           main.max-w-(--x-main-column-width) and by the grid
 *                           lg:grid-cols-[var(--x-main-column-width)_...]
 *   --x-sidebar-expanded    0 = icon-only nav (72px), 1 = labelled nav (256px);
 *                           nav width is w-[calc(72px+184px*var(--x-sidebar-expanded))]
 *
 * Shell geometry at 1491x882:
 *   div.max-w-[1024px]  (outer, mx-auto)
 *     div.flex.w-full.grow.justify-center
 *       div.grid.lg:grid-cols-[var(--x-main-column-width)_...]   -> "600px 424px"
 *         main   (600px, max-w-(--x-main-column-width))
 *         aside  (424px, "hidden flex-col lg:flex")  <- EMPTY on the timeline,
 *                                                     i.e. 424px of dead space
 *   div.sticky (nav shell, w-[calc(72px+184px*var)])
 *     nav
 *
 * Because the shell is class-driven Tailwind, selectors here use
 * [class*="..."] fragments instead of exact class lists (X reorders them).
 */

(() => {
  'use strict';

  const SCRIPT_ID = 'xls';
  const DEBUG = false;
  const log = (...a) => DEBUG && console.log(`[${SCRIPT_ID}]`, ...a);

  // Single instance only. Two copies (e.g. a Tampermonkey install plus a manual
  // injection) would each rewrite the same <style> element from their own
  // settings, so toggles would visibly flap.
  if (document.documentElement.dataset.xlsBooted === '1') return;
  document.documentElement.dataset.xlsBooted = '1';

  const DEFAULTS = {
    mainWidth: 700,     // px, user-draggable
    railHidden: false,  // collapse the empty right rail
    compactNav: false,  // 72px icon-only nav
    hideTabs: false,    // hide the 为你推荐 / 正在关注 header row
    hideViews: false,   // hide view counters in the action bar
    noBorders: false,   // remove the column separators
    hidePromo: false,   // hide promoted posts
    panelOpen: false,
    fabTop: 50,         // % down the viewport; the button is draggable
    hideRules: [],      // [{ selector, label }] from the element picker
  };

  const MIN_W = 360;
  const MAX_W = 1600;

  // ---- storage (GM_* with a localStorage fallback so it also runs unmanaged) --
  const store = {
    read() {
      try {
        if (typeof GM_getValue === 'function') {
          const raw = GM_getValue('xls-settings', '');
          return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
        }
        const raw = localStorage.getItem('xls-settings');
        return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
      } catch (_) {
        return { ...DEFAULTS };
      }
    },
    write(obj) {
      const raw = JSON.stringify(obj);
      try {
        if (typeof GM_setValue === 'function') return GM_setValue('xls-settings', raw);
        localStorage.setItem('xls-settings', raw);
      } catch (_) {}
    },
  };

  let settings = store.read();

  // ---- shell helpers --------------------------------------------------------
  // X flips accounts between two frontends: the XDS/Tailwind shell (CSS vars +
  // grid) and the older React-Native-Web shell (atomic classes + fixed widths).
  // Every rule below therefore covers BOTH; only one set matches at a time.
  const SEL = {
    // XDS
    mainXds: 'main[class*="max-w-(--x-main-column-width)"]',
    grid: 'div[class*="lg:grid-cols-[var(--x-main-column-width)"]',
    navShell: 'div[class*="w-[calc(72px"]',
    asideXds: 'aside[class*="lg:flex"]',
    tabHeaderXds: 'div[class*="border-b-[0.5px]"]:has([role="tablist"])',
    // legacy RNW
    mainRwn: 'div[data-testid="primaryColumn"]',
    asideRwn: 'div[data-testid="sidebarColumn"]',
    banner: 'header[role="banner"]',
    // shared
    tablist: '[role="tablist"]',
    viewCount: 'a[aria-label="查看次数"], a[aria-label="View post analytics"], a[href$="/analytics"]',
  };

  /** The element whose width the user drags. XDS main, else legacy primaryColumn. */
  const getMain = () => document.querySelector(SEL.mainXds) || document.querySelector(SEL.mainRwn);
  const getGrid = () => document.querySelector(SEL.grid);

  /** Usable width for the main column: from its left edge to the viewport edge. */
  function availableWidth() {
    const main = getMain();
    if (!main) return MAX_W;
    const left = main.getBoundingClientRect().left;
    return Math.max(MIN_W, Math.min(MAX_W, Math.round(window.innerWidth - left - 24)));
  }

  function clampWidth(px) {
    const avail = availableWidth();
    return Math.max(MIN_W, Math.min(Math.round(px), avail));
  }

  // ---- CSS ------------------------------------------------------------------
  // Everything static lives in BASE_CSS. Toggle rules are generated per change in
  // buildCss() and written straight into the <style> text, because X rewrites
  // <html>'s className on re-render and would wipe any state classes we set.
  const BASE_CSS = `

/* --- main column width ----------------------------------------------------- */
@media (min-width: 1024px) {
  /* XDS shell: variables + grid track */
  ${SEL.mainXds} {
    max-width: var(--xvl-main) !important;
    position: relative;
  }
  ${SEL.grid} {
    grid-template-columns: var(--xvl-main) minmax(0, 1fr) !important;
  }
  /* let the shell grow past its default 1024px cap */
  div:has(> ${SEL.grid}), div:has(> div > ${SEL.grid}) {
    max-width: none !important;
  }
  /* belt and braces: if X stops honouring the variable on this wrapper */
  div[class*="max-w-[var(--x-timeline-max-width"] {
    max-width: var(--xvl-main) !important;
  }

  /* legacy RNW shell: fixed max-width on the column and on its content wrapper
     (r-1ye8kvj is the atomic class RNW emits for max-width:600px) */
  ${SEL.mainRwn} {
    max-width: var(--xvl-main) !important;
    width: var(--xvl-main) !important;
    position: relative;
  }
  ${SEL.mainRwn} div[class*="r-1ye8kvj"] {
    max-width: none !important;
  }
}

/* --- resize handle -------------------------------------------------------- */
.${SCRIPT_ID}-handle {
  position: absolute;
  top: 0;
  right: -2px;
  width: 5px;
  height: 100%;
  z-index: 40;
  cursor: col-resize;
  background: transparent;
  touch-action: none;
}
.${SCRIPT_ID}-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 1px;
  background: transparent;
  transition: background 140ms ease, box-shadow 140ms ease;
}
.${SCRIPT_ID}-handle:hover::after,
.${SCRIPT_ID}-handle.${SCRIPT_ID}-dragging::after {
  background: rgb(29, 155, 240);
  box-shadow: 0 0 8px rgba(29, 155, 240, .75);
}
body.${SCRIPT_ID}-resizing { cursor: col-resize !important; user-select: none !important; }

/* --- element picker ------------------------------------------------------- */
.${SCRIPT_ID}-pickbox {
  position: fixed;
  z-index: 2147483646;
  pointer-events: none;
  border: 2px solid rgb(29, 155, 240);
  background: rgba(29, 155, 240, .12);
  border-radius: 4px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, .28);
  display: none;
}
.${SCRIPT_ID}-pickbox.${SCRIPT_ID}-on { display: block; }
.${SCRIPT_ID}-picktip {
  position: fixed;
  z-index: 2147483647;
  pointer-events: none;
  display: none;
  max-width: 420px;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, .92);
  color: #e7e9ea;
  font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.${SCRIPT_ID}-picktip.${SCRIPT_ID}-on { display: block; }
body.${SCRIPT_ID}-picking, body.${SCRIPT_ID}-picking * { cursor: crosshair !important; }
.${SCRIPT_ID}-danger { border-color: rgba(244, 33, 46, .5) !important; color: #f4212e !important; }
.${SCRIPT_ID}-danger:hover { background: rgba(244, 33, 46, .85) !important; color: #fff !important; border-color: transparent !important; }

/* --- floating panel ------------------------------------------------------- */
.${SCRIPT_ID}-fab {
  position: fixed;
  right: 14px;
  top: var(--xls-fab-top, 50%);
  transform: translateY(-50%);
  z-index: 2147483647;
  width: 38px;
  height: 38px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, .14);
  background: rgba(0, 0, 0, .78);
  color: #e7e9ea;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  pointer-events: auto !important;
  backdrop-filter: blur(12px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, .35);
  transition: background 140ms ease, transform 140ms ease;
}
.${SCRIPT_ID}-fab:hover { background: rgba(29, 155, 240, .9); transform: translateY(-50%) scale(1.06); }
.${SCRIPT_ID}-fab svg { width: 19px; height: 19px; fill: currentColor; }

.${SCRIPT_ID}-panel {
  position: fixed;
  right: 60px;
  top: var(--xls-fab-top, 50%);
  transform: translateY(-50%) translateX(8px);
  z-index: 2147483647;
  width: 268px;
  padding: 14px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, .13);
  background: rgba(0, 0, 0, .9);
  color: #e7e9ea;
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  backdrop-filter: blur(16px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, .5);
  opacity: 0;
  pointer-events: none;
  transition: opacity 140ms ease, transform 140ms ease;
}
.${SCRIPT_ID}-panel.${SCRIPT_ID}-open {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(-50%) translateX(0);
}
.${SCRIPT_ID}-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
  font-size: 13px;
  margin-bottom: 10px;
  letter-spacing: .2px;
}
.${SCRIPT_ID}-wrow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.${SCRIPT_ID}-wval {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: #1d9bf0;
  min-width: 52px;
  text-align: right;
}
.${SCRIPT_ID}-panel input[type="range"] {
  width: 100%;
  accent-color: #1d9bf0;
  margin: 2px 0 10px;
}
.${SCRIPT_ID}-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 0;
  cursor: pointer;
  user-select: none;
}
.${SCRIPT_ID}-row:hover { color: #fff; }
.${SCRIPT_ID}-row span { flex: 1; }
.${SCRIPT_ID}-switch {
  position: relative;
  width: 34px;
  height: 19px;
  border-radius: 999px;
  background: rgba(255, 255, 255, .2);
  transition: background 140ms ease;
  flex: none;
}
.${SCRIPT_ID}-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #fff;
  transition: transform 140ms ease;
}
.${SCRIPT_ID}-row.${SCRIPT_ID}-on .${SCRIPT_ID}-switch { background: #1d9bf0; }
.${SCRIPT_ID}-row.${SCRIPT_ID}-on .${SCRIPT_ID}-switch::after { transform: translateX(15px); }
.${SCRIPT_ID}-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, .1);
}
.${SCRIPT_ID}-btn {
  flex: 1;
  padding: 7px 8px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, .16);
  background: rgba(255, 255, 255, .06);
  color: #e7e9ea;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: background 140ms ease;
}
.${SCRIPT_ID}-btn:hover { background: rgba(29, 155, 240, .85); border-color: transparent; }
.${SCRIPT_ID}-hint {
  margin-top: 8px;
  font-size: 11px;
  color: rgba(255, 255, 255, .45);
  line-height: 1.4;
}
`;

  let styleEl = null;

  function ensureStyleEl() {
    if (styleEl && styleEl.isConnected) return styleEl;
    styleEl = document.getElementById(`${SCRIPT_ID}-style`);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = `${SCRIPT_ID}-style`;
      (document.head || document.documentElement).appendChild(styleEl);
    }
    return styleEl;
  }

  /** Full stylesheet as a function of the current settings (no state classes). */
  function buildCss() {
    // Apply the stored width clamped to what this viewport allows, but keep the
    // raw preference in storage: a narrow window must not permanently shrink a
    // width the user chose on a wide monitor.
    const w = `${clampWidth(settings.mainWidth)}px`;
    const out = [
      `:root { --xvl-main: ${w}; --x-timeline-max-width: ${w}; --xls-fab-top: ${Number(settings.fabTop) || 50}%; }`,
      BASE_CSS,
    ];

    if (settings.railHidden) {
      out.push(`
${SEL.grid} { grid-template-columns: minmax(0, 1fr) 0px !important; }
${SEL.asideXds}, ${SEL.asideRwn} { display: none !important; }
${SEL.mainXds} { margin-left: auto !important; margin-right: auto !important; }
`);
    }

    if (settings.compactNav) {
      out.push(`
/* XDS: use X's own collapse switch. --x-sidebar-expanded drives both the nav
   width (72px + 184px * var) and the link width, and X hides labels itself at
   that width. */
${SEL.navShell} { --x-sidebar-expanded: 0 !important; width: 72px !important; }
/* RNW banner is a fixed 275px; shrink it. Labels are hidden via
   [data-xls-navlabel] below, never by class — that is what blanked the icons. */
${SEL.banner} { width: 88px !important; }
${SEL.banner} nav a, ${SEL.banner} nav button {
  width: 48px !important;
  justify-content: center !important;
}
`);
    }

    // Label hiding works for both shells: the flag is set by applyCompactNav(),
    // which only ever marks elements that hold text and contain no <svg>.
    out.push('[data-xls-navlabel="1"] { display: none !important; }');

    if (settings.hideTabs) {
      out.push(`
${SEL.tabHeaderXds} { display: none !important; }
${SEL.tablist} { display: none !important; }
div[data-testid="primaryColumn"] div:has(> [role="tablist"]) {
  height: 0 !important; min-height: 0 !important; padding: 0 !important;
  margin: 0 !important; overflow: hidden !important; border: 0 !important;
}
`);
    }

    if (settings.hideViews) out.push(`${SEL.viewCount} { display: none !important; }`);

    if (settings.noBorders) {
      out.push(`
main[class*="border-normal"], ${SEL.asideXds}, ${SEL.mainRwn},
div[class*="border-b-[0.5px]"] {
  border-color: transparent !important;
}
`);
    }

    if (settings.hidePromo) out.push('[data-xvl-promo="1"] { display: none !important; }');

    // Selector-based hide rules from the built-in element picker.
    const rules = Array.isArray(settings.hideRules) ? settings.hideRules : [];
    for (const rule of rules) {
      if (!rule || !rule.selector) continue;
      out.push(`${rule.selector} { display: none !important; }`);
    }

    return out.join('\n');
  }

  function renderStyles() {
    ensureStyleEl().textContent = buildCss();
  }

  // ---- apply state ----------------------------------------------------------
  /**
   * X has TWO width variables and both must move together:
   *   --x-main-column-width    the column shell (grid track + main max-width)
   *   --x-timeline-max-width   the content wrapper inside main
   *                            (div.max-w-[var(--x-timeline-max-width,600px)])
   * Widening only the first leaves the timeline stuck at 600px, centred in a
   * wide empty column.
   */
  function applyWidth(px) {
    settings.mainWidth = px;
    dirty = true;
    renderStyles();
    syncPanel();
  }

  function applySettings() {
    renderStyles();
    syncPanel();
  }

  let dirty = false;

  function save() {
    store.write(settings);
    dirty = false;
  }

  // Only flush when something actually changed. An unconditional save here lets
  // a stale tab (or the page you are navigating away from) overwrite settings
  // that were just written elsewhere.
  window.addEventListener('pagehide', () => { try { if (dirty) save(); } catch (_) {} });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirty) { try { save(); } catch (_) {} }
  });

  function setSetting(key, value) {
    settings[key] = value;
    if (key === 'mainWidth') settings.mainWidth = clampWidth(value);
    dirty = true;
    applySettings();
    save();
  }

  // ---- resize handle --------------------------------------------------------
  function ensureHandle() {
    const main = getMain();
    if (!main) return;
    // Rebuild unconditionally: a handle left in the column by another copy would
    // look identical but its listeners would drive that copy's settings.
    main.querySelectorAll(`:scope > .${SCRIPT_ID}-handle`).forEach((h) => h.remove());
    const handle = document.createElement('div');
    handle.className = `${SCRIPT_ID}-handle`;
    handle.title = '拖动调整时间线宽度（双击重置）';

    let startX = 0;
    let startW = 0;
    let dragging = false;
    let saveTimer = 0;

    // Persist on a short debounce during the drag, so a lost pointerup (release
    // outside the window, shell re-render mid-drag) can never lose the width.
    const saveSoon = () => {
      if (saveTimer) return;
      saveTimer = window.setTimeout(() => { saveTimer = 0; save(); }, 120);
    };

    const onMove = (e) => {
      if (!dragging) return;
      const next = clampWidth(startW + (e.clientX - startX));
      if (next === settings.mainWidth) return;
      applyWidth(next);
      saveSoon();
    };

    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      handle.classList.remove(`${SCRIPT_ID}-dragging`);
      document.body.classList.remove(`${SCRIPT_ID}-resizing`);
      if (saveTimer) { window.clearTimeout(saveTimer); saveTimer = 0; }
      save();
    };

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      startW = getMain()?.getBoundingClientRect().width || settings.mainWidth;
      // Window-level listeners: the handle is only 5px wide, so a normal drag
      // leaves it within a few frames.
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('pointercancel', onUp, true);
      handle.classList.add(`${SCRIPT_ID}-dragging`);
      document.body.classList.add(`${SCRIPT_ID}-resizing`);
      e.preventDefault();
      e.stopPropagation();
    });

    handle.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setSetting('mainWidth', DEFAULTS.mainWidth);
    });

    main.appendChild(handle);
  }

  // ---- panel ----------------------------------------------------------------
  let panelEl = null;
  let fabEl = null;

  const ROWS = [
    ['railHidden', '隐藏右侧栏（空栏回收）'],
    ['compactNav', '紧凑导航（仅图标）'],
    ['hideTabs', '隐藏「为你推荐 / 正在关注」'],
    ['hideViews', '隐藏浏览数'],
    ['noBorders', '去除分栏边框'],
    ['hidePromo', '隐藏推广内容'],
  ];

  function buildPanel() {
    if (panelEl && panelEl.isConnected) return;
    // A panel present at boot time cannot belong to this instance (we build ours
    // below), so it is an orphan from a dead/previous copy: drop it and rebuild,
    // otherwise the stale panel would render numbers we no longer control.
    const orphan = document.querySelector(`.${SCRIPT_ID}-panel`);
    if (orphan) {
      orphan.remove();
      document.querySelector(`.${SCRIPT_ID}-fab`)?.remove();
    }

    fabEl = document.createElement('button');
    fabEl.className = `${SCRIPT_ID}-fab`;
    fabEl.type = 'button';
    fabEl.title = 'X Layout Studio';
    fabEl.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h10v2H4v-2z"/></svg>';

    panelEl = document.createElement('div');
    panelEl.className = `${SCRIPT_ID}-panel`;
    panelEl.innerHTML = `
      <div class="${SCRIPT_ID}-title">
        <span>X Layout Studio</span>
        <span class="${SCRIPT_ID}-wval" data-wval>700px</span>
      </div>
      <input type="range" min="${MIN_W}" max="1600" step="10" data-range>
      <div data-rows></div>
      <div class="${SCRIPT_ID}-actions">
        <button type="button" class="${SCRIPT_ID}-btn" data-preset="wide">全宽模式</button>
        <button type="button" class="${SCRIPT_ID}-btn" data-reset>重置</button>
      </div>
      <div class="${SCRIPT_ID}-actions" style="border-top:0;padding-top:0;margin-top:8px">
        <button type="button" class="${SCRIPT_ID}-btn" data-pick>选取隐藏</button>
        <button type="button" class="${SCRIPT_ID}-btn ${SCRIPT_ID}-danger" data-clear>清除隐藏 (<span data-rulecount>0</span>)</button>
      </div>
      <div class="${SCRIPT_ID}-hint">拖动时间线右边缘可自由调宽，双击边缘恢复默认。点「选取隐藏」后移动到要隐藏的元素上单击；Esc 取消。悬浮按钮可上下拖动。</div>
    `;

    const rowsHost = panelEl.querySelector('[data-rows]');
    for (const [key, label] of ROWS) {
      const row = document.createElement('div');
      row.className = `${SCRIPT_ID}-row`;
      row.dataset.key = key;
      row.innerHTML = `<span>${label}</span><i class="${SCRIPT_ID}-switch"></i>`;
      row.addEventListener('click', () => setSetting(key, !settings[key]));
      rowsHost.appendChild(row);
    }

    const range = panelEl.querySelector('[data-range]');
    range.addEventListener('input', () => {
      settings.mainWidth = clampWidth(Number(range.value));
      applyWidth(settings.mainWidth);
      syncPanel();
    });
    range.addEventListener('change', () => save());

    panelEl.querySelector('[data-preset="wide"]').addEventListener('click', () => {
      settings.railHidden = true;
      settings.compactNav = true;
      settings.mainWidth = clampWidth(availableWidth());
      applySettings();
      save();
    });

    panelEl.querySelector('[data-reset]').addEventListener('click', () => {
      settings = { ...DEFAULTS, panelOpen: settings.panelOpen };
      applySettings();
      save();
    });

    panelEl.querySelector('[data-pick]').addEventListener('click', () => startPicking());
    panelEl.querySelector('[data-clear]').addEventListener('click', () => clearHideRules());

    // The button is draggable: it may sit on top of another extension's launcher,
    // and moving it is the only way out of that overlap. A drag suppresses the
    // click so the panel does not pop open when you finish repositioning.
    let fabMoved = false;
    fabEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const startY = e.clientY;
      const startCenter = fabEl.getBoundingClientRect().top + fabEl.offsetHeight / 2;
      let moved = false;
      const move = (ev) => {
        const dy = ev.clientY - startY;
        if (Math.abs(dy) > 4) moved = true;
        if (!moved) return;
        const pct = ((startCenter + dy) / window.innerHeight) * 100;
        settings.fabTop = Math.round(Math.min(96, Math.max(4, pct)) * 10) / 10;
        renderStyles();
      };
      const up = () => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        if (moved) { fabMoved = true; save(); }
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
    });

    fabEl.addEventListener('click', () => {
      if (fabMoved) { fabMoved = false; return; }
      // Self-heal: if the panel was removed from the DOM (shell re-render, another
      // copy's cleanup) rebuild it and open it, instead of toggling a dead handle.
      if (!panelEl || !panelEl.isConnected) {
        settings.panelOpen = true;
        buildPanel();
        applySettings();
        save();
        return;
      }
      settings.panelOpen = !settings.panelOpen;
      applySettings();
      save();
    });

    // Fallbacks in case the button is ever covered by X's own overlay.
    fabEl.addEventListener('dblclick', (e) => {
      e.preventDefault();
      settings.panelOpen = true;
      applySettings();
      save();
    });

    document.body.appendChild(fabEl);
    document.body.appendChild(panelEl);
    // Explicit sync: do not rely on the mutation observer happening to re-boot.
    syncPanel();
  }

  // Bound once for the whole instance: buildPanel() can rebuild the DOM, and a
  // per-build listener would register duplicates that cancel each other out.
  function bindHotkey() {
    if (bindHotkey.done) return;
    bindHotkey.done = true;
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && (e.key === 'X' || e.key === 'x')) {
        e.preventDefault();
        if (!panelEl || !panelEl.isConnected) buildPanel();
        settings.panelOpen = !settings.panelOpen;
        applySettings();
        save();
      }
    });
  }

  function syncPanel() {
    if (!panelEl) return;
    const val = panelEl.querySelector('[data-wval]');
    const range = panelEl.querySelector('[data-range]');
    if (val) val.textContent = `${settings.mainWidth}px`;
    if (range && Number(range.value) !== settings.mainWidth) range.value = String(settings.mainWidth);
    const count = panelEl.querySelector('[data-rulecount]');
    if (count) count.textContent = String((Array.isArray(settings.hideRules) ? settings.hideRules : []).length);
    panelEl.classList.toggle(`${SCRIPT_ID}-open`, !!settings.panelOpen);
    for (const row of panelEl.querySelectorAll(`.${SCRIPT_ID}-row`)) {
      row.classList.toggle(`${SCRIPT_ID}-on`, !!settings[row.dataset.key]);
    }
  }

  // ---- compact nav ------------------------------------------------------------
  /**
   * Hiding nav labels by class name is what blanked the icons earlier: the class
   * we targeted also wrapped the icon container. Instead, flag only the
   * outermost element inside each nav item that holds text and contains no
   * <svg>, so the icon can never be caught by it.
   */
  function applyCompactNav() {
    const navs = document.querySelectorAll('nav, header[role="banner"] nav');
    for (const nav of navs) {
      for (const item of nav.querySelectorAll('a, button')) {
        let label = null;
        for (const el of item.querySelectorAll('*')) {
          if (el.querySelector('svg')) continue;
          if (!(el.textContent || '').trim()) continue;
          label = el;
          break;
        }
        if (!label) continue;
        if (settings.compactNav) {
          if (label.dataset.xlsNavlabel !== '1') label.setAttribute('data-xls-navlabel', '1');
        } else if (label.hasAttribute('data-xls-navlabel')) {
          label.removeAttribute('data-xls-navlabel');
        }
      }
    }
  }

  // ---- element picker --------------------------------------------------------
  // Built in so hiding arbitrary chunks of X does not depend on a third-party
  // script. Pick an element, it becomes a stored CSS rule.
  let pickBox = null;
  let pickTip = null;
  let picking = false;
  let pickTarget = null;

  function selectorFor(el) {
    if (!el || el === document.body || el === document.documentElement) return '';
    if (el.id) return `#${CSS.escape(el.id)}`;
    const tid = el.getAttribute('data-testid');
    if (tid) return `[data-testid="${tid.replace(/"/g, '')}"]`;
    const aria = (el.getAttribute('aria-label') || '').trim();
    if (aria && aria.length <= 40) return `${el.tagName.toLowerCase()}[aria-label="${aria.replace(/"/g, '')}"]`;
    // Fall back to a structural path. X re-renders constantly, so keep it short.
    const parts = [];
    let cur = el;
    for (let depth = 0; cur && cur !== document.body && depth < 5; depth++) {
      let part = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) part += `:nth-child(${[...parent.children].indexOf(cur) + 1})`;
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  }

  function ensurePickUi() {
    if (!pickBox) {
      pickBox = document.createElement('div');
      pickBox.className = `${SCRIPT_ID}-pickbox`;
      document.body.appendChild(pickBox);
    }
    if (!pickTip) {
      pickTip = document.createElement('div');
      pickTip.className = `${SCRIPT_ID}-picktip`;
      document.body.appendChild(pickTip);
    }
  }

  function hidePickUi() {
    pickTarget = null;
    pickBox?.classList.remove(`${SCRIPT_ID}-on`);
    pickTip?.classList.remove(`${SCRIPT_ID}-on`);
  }

  function startPicking() {
    ensurePickUi();
    picking = true;
    document.body.classList.add(`${SCRIPT_ID}-picking`);
    if (panelEl) panelEl.classList.remove(`${SCRIPT_ID}-open`);
    if (fabEl) fabEl.style.opacity = '.25';
  }

  function stopPicking() {
    picking = false;
    document.body.classList.remove(`${SCRIPT_ID}-picking`);
    if (fabEl) fabEl.style.opacity = '';
    hidePickUi();
  }

  function addHideRule(selector, label) {
    if (!selector) return;
    const rules = Array.isArray(settings.hideRules) ? settings.hideRules.slice() : [];
    if (!rules.some((r) => r.selector === selector)) rules.push({ selector, label: label || selector });
    settings.hideRules = rules;
    dirty = true;
    applySettings();
    save();
  }

  function clearHideRules() {
    settings.hideRules = [];
    dirty = true;
    applySettings();
    save();
  }

  function bindPicker() {
    if (bindPicker.done) return;
    bindPicker.done = true;

    document.addEventListener('mousemove', (e) => {
      if (!picking) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el.closest?.(`.${SCRIPT_ID}-panel, .${SCRIPT_ID}-fab, .${SCRIPT_ID}-pickbox, .${SCRIPT_ID}-picktip`)) {
        hidePickUi();
        return;
      }
      pickTarget = el;
      const r = el.getBoundingClientRect();
      pickBox.style.left = `${r.left}px`;
      pickBox.style.top = `${r.top}px`;
      pickBox.style.width = `${r.width}px`;
      pickBox.style.height = `${r.height}px`;
      pickBox.classList.add(`${SCRIPT_ID}-on`);
      const sel = selectorFor(el);
      pickTip.textContent = sel || '(该元素不能选取)';
      pickTip.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - 430))}px`;
      pickTip.style.top = `${Math.max(4, r.top - 26)}px`;
      pickTip.classList.add(`${SCRIPT_ID}-on`);
    }, true);

    document.addEventListener('click', (e) => {
      if (!picking) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.target.closest?.(`.${SCRIPT_ID}-panel, .${SCRIPT_ID}-fab`)) return;
      const el = pickTarget || e.target;
      const sel = selectorFor(el);
      if (sel) addHideRule(sel, (el.getAttribute('aria-label') || el.tagName.toLowerCase()).slice(0, 40));
      stopPicking();
      window.setTimeout(() => { if (settings.panelOpen) applySettings(); }, 0);
    }, true);

    document.addEventListener('keydown', (e) => {
      if (picking && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        stopPicking();
      }
    }, true);
  }

  // ---- promoted-post tagging ------------------------------------------------
  // X labels ads with a small element, e.g. "来自 nordace.com 的广告",
  // "Promoted by Acme", "Sponsored". The domain may itself be a nested link, so
  // match on any element whose ENTIRE text is the label (the anchors make it
  // unambiguous), instead of requiring a childless leaf node.
  const AD_LABEL = /^(?:来自\s*\S.*?\s*的广告|Promoted(?:\s+by\s+.+)?|Sponsored(?:\s+by\s+.+)?|广告|推广|赞助|Ad)$/i;

  /** Nearest timeline cell for an element: a post, else the virtualised row. */
  function adCellOf(el) {
    const article = el.closest('article');
    if (article) return article;
    const cell = el.closest('div[class*="outline-focus"]');
    if (!cell) return null;
    // Safety net: never hide something larger than a single post. If X ever
    // reshapes the shell so the fallback matches a page-level container, this
    // refuses instead of blanking the timeline.
    const rect = cell.getBoundingClientRect();
    if (rect.height > 3000 || rect.width > 1600) return null;
    return cell;
  }

  function isAdCell(cell) {
    for (const el of cell.querySelectorAll('div, span, a')) {
      const text = (el.textContent || '').trim();
      if (!text || text.length > 60) continue;
      if (AD_LABEL.test(text)) return true;
    }
    return false;
  }

  function tagPromoted() {
    if (!settings.hidePromo) return;
    // Only look at label-sized elements, then walk up to the cell that owns them.
    for (const el of document.querySelectorAll('div, span, a')) {
      const text = (el.textContent || '').trim();
      if (!text || text.length > 60 || !AD_LABEL.test(text)) continue;
      const cell = adCellOf(el);
      if (!cell || cell.dataset.xvlPromo) continue;
      if (isAdCell(cell)) cell.dataset.xvlPromo = '1';
    }
  }

  // ---- bootstrap ------------------------------------------------------------
  let bootTimer = 0;

  function boot() {
    renderStyles();
    applySettings();
    buildPanel();
    bindHotkey();
    bindPicker();
    ensureHandle();
    applyCompactNav();
    tagPromoted();
  }

  function scheduleBoot() {
    if (bootTimer) return;
    bootTimer = window.setTimeout(() => {
      bootTimer = 0;
      boot();
    }, 150);
  }

  function watch() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches?.('main, article') || node.querySelector?.('main, article')) {
            scheduleBoot();
            return;
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // The shell is re-created on client-side navigation, so re-attach the handle.
    let lastMain = null;
    window.setInterval(() => {
      const main = getMain();
      if (main !== lastMain) {
        lastMain = main;
        scheduleBoot();
      }
      tagPromoted(); // new ads stream in while scrolling
      applyCompactNav(); // React re-creates nav items on re-render
    }, 1000);

    window.addEventListener('resize', () => {
      // keep the width legal when the window shrinks
      if (settings.mainWidth > availableWidth()) {
        settings.mainWidth = clampWidth(settings.mainWidth);
        applySettings();
        save();
      }
    });
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('打开 X Layout Studio 面板', () => {
      settings.panelOpen = !settings.panelOpen;
      applySettings();
      save();
    });
    GM_registerMenuCommand('重置布局设置', () => {
      settings = { ...DEFAULTS };
      applySettings();
      save();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      boot();
      watch();
    }, { once: true });
  } else {
    boot();
    watch();
  }
})();
