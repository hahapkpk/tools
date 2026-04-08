// ==UserScript==
// @name         X Blocker - 元素选取屏蔽器
// @namespace    http://tampermonkey.net/
// @version      2.2.0
// @description  可视化选取并屏蔽 X/Twitter 页面上不想要的区域（支持多项选择+预览确认）
// @author       You
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ======================== 状态管理 ========================
    const state = {
        pickingMode: false,
        selectedElements: new Map(), // element -> {selector, highlightEl}
        confirmedRules: [],
        hoveredElement: null,
        hoverOutline: null,
        panelVisible: true // 面板可见状态
    };

    // 从存储加载
    function loadRules() {
        state.confirmedRules = GM_getValue('xb_rules', []);
        state.panelVisible = GM_getValue('xb_panel_visible', true);
        applyAllRules();
    }

    function saveRules() {
        GM_setValue('xb_rules', state.confirmedRules);
    }

    function savePanelVisibility(visible) {
        state.panelVisible = visible;
        GM_setValue('xb_panel_visible', visible);
    }

    // 应用所有已确认的屏蔽规则
    function applyAllRules() {
        document.querySelectorAll('[data-xb-hidden]').forEach(el => {
            el.removeAttribute('data-xb-hidden');
            el.style.removeProperty('display');
        });
        state.confirmedRules.forEach(rule => {
            if (rule.disabled) return;
            try {
                document.querySelectorAll(rule.selector).forEach(el => {
                    el.setAttribute('data-xb-hidden', 'true');
                    el.style.setProperty('display', 'none', 'important');
                });
            } catch(e) {}
        });
    }

    // ======================== CSS 选择器生成 ========================
    function generateSelector(el) {
        if (el.id) return `#${CSS.escape(el.id)}`;
        const path = [];
        let current = el;
        while (current && current !== document.body) {
            let selector = current.tagName.toLowerCase();
            if (current.id) { selector = `#${CSS.escape(current.id)}`; path.unshift(selector); break; }
            if (current.className && typeof current.className === 'string') {
                const classes = current.className.trim().split(/\s+/).filter(c => c.length > 0 && !c.startsWith('xb-') && c !== 'highlighted');
                if (classes.length > 0) selector += '.' + classes.slice(0, 2).map(c => CSS.escape(c)).join('.');
            }
            const parent = current.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
                if (siblings.length > 1) selector += `:nth-child(${siblings.indexOf(current) + 1})`;
            }
            path.unshift(selector);
            current = parent;
            if (path.length >= 5) break;
        }
        return path.join(' > ');
    }

    function shortenSelector(selector) {
        const parts = selector.split(' > ');
        if (parts.length <= 2) return selector;
        for (let start = 0; start < parts.length - 1; start++) {
            const shortSelector = parts.slice(start).join(' > ');
            try { if (document.querySelectorAll(shortSelector).length === 1) return shortSelector; }
            catch(e) { break; }
        }
        return selector;
    }

    // ======================== 高亮系统 ========================
    function createHighlightOverlay(el) {
        const rect = el.getBoundingClientRect();
        const overlay = document.createElement('div');
        overlay.className = 'xb-highlight-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: ${rect.top}px; left: ${rect.left}px;
            width: ${rect.width}px; height: ${rect.height}px;
            background: rgba(255,165,0,0.25);
            border: 3px solid #ff8c00;
            border-radius: 8px;
            pointer-events: none;
            z-index: 2147483646;
            box-shadow: 0 0 20px rgba(255,140,0,0.4);
            transition: all 0.15s ease;
        `;
        const count = state.selectedElements.size + 1;
        const badge = document.createElement('div');
        badge.className = 'xb-badge';
        badge.textContent = count;
        badge.style.cssText = `
            position:absolute; top:-12px; left:-12px;
            width:26px; height:26px;
            background:#ff8c00; color:white; border-radius:50%;
            display:flex; align-items:center; justify-content:center;
            font-size:13px; font-weight:bold;
            box-shadow:0 2px 8px rgba(0,0,0,0.3);
        `;
        overlay.appendChild(badge);

        const removeBtn = document.createElement('div');
        removeBtn.className = 'xb-remove-btn';
        removeBtn.innerHTML = '&times;';
        removeBtn.style.cssText = `
            position:absolute; top:-12px; right:-12px;
            width:24px; height:24px;
            background:#e74c3c; color:white; border-radius:50%;
            display:flex; align-items:center; justify-content:center;
            font-size:16px; font-weight:bold; cursor:pointer;
            box-shadow:0 2px 8px rgba(0,0,0,0.3); pointer-events:auto;
        `;
        removeBtn.onclick = (e) => { e.stopPropagation(); deselectElement(el); };
        overlay.appendChild(removeBtn);

        document.body.appendChild(overlay);
        return overlay;
    }

    function createHoverOutline(el) {
        removeHoverOutline();
        const rect = el.getBoundingClientRect();
        const outline = document.createElement('div');
        outline.className = 'xb-hover-outline';
        outline.style.cssText = `
            position: fixed;
            top: ${rect.top-2}px; left: ${rect.left-2}px;
            width: ${rect.width+4}px; height: ${rect.height+4}px;
            border: 2px dashed #00aaff; border-radius: 8px;
            pointer-events: none; z-index: 2147483645;
            background: rgba(0,170,255,0.06);
            transition: all 0.08s ease;
        `;
        document.body.appendChild(outline);
        state.hoverOutline = outline;
        state.hoveredElement = el;
    }

    function removeHoverOutline() {
        if (state.hoverOutline) { state.hoverOutline.remove(); state.hoverOutline = null; }
        state.hoveredElement = null;
    }

    // ======================== 选择/取消选择 ========================
    function selectElement(el) {
        if (state.selectedElements.has(el)) return;
        for (const [elem] of state.selectedElements) { if (el.contains(elem)) deselectElement(elem); }
        for (const [elem] of state.selectedElements) { if (elem.contains(el)) deselectElement(elem); }
        const selector = shortenSelector(generateSelector(el));
        const highlightEl = createHighlightOverlay(el);
        state.selectedElements.set(el, { selector, highlightEl });
        updateSelectionUI();
    }

    function deselectElement(el) {
        const data = state.selectedElements.get(el);
        if (data) { if (data.highlightEl) data.highlightEl.remove(); state.selectedElements.delete(el); reindexBadges(); updateSelectionUI(); }
    }

    function clearAllSelection() {
        for (const [, data] of state.selectedElements) { if (data.highlightEl) data.highlightEl.remove(); }
        state.selectedElements.clear(); updateSelectionUI();
    }

    function reindexBadges() {
        let idx = 1;
        for (const [, data] of state.selectedElements) { const b = data.highlightEl?.querySelector('.xb-badge'); if (b) b.textContent = idx++; }
    }

    // ======================== 预览 & 确认 ========================
    function previewSelected() {
        if (state.selectedElements.size === 0) return;
        for (const [el] of state.selectedElements) el.style.setProperty('display', 'none', 'important');
    }

    function cancelPreview() {
        for (const [el] of state.selectedElements) { if (!el.hasAttribute('data-xb-hidden')) el.style.removeProperty('display'); }
    }

    function confirmSave() {
        let newCount = 0;
        for (const [el, data] of state.selectedElements) {
            if (!state.confirmedRules.find(r => r.selector === data.selector)) {
                state.confirmedRules.push({ selector: data.selector, timestamp: Date.now() }); newCount++;
            }
            el.setAttribute('data-xb-hidden', 'true');
            if (data.highlightEl) data.highlightEl.remove();
        }
        saveRules(); clearAllSelection(); updateRuleList();
        showNotification(`✅ 已保存 ${newCount} 条屏蔽规则`, 'success');
    }

    // ======================== 规则管理 ========================
    function deleteRule(index) {
        const rule = state.confirmedRules[index]; if (!rule) return;
        try { document.querySelectorAll(rule.selector).forEach(el => { el.removeAttribute('data-xb-hidden'); el.style.removeProperty('display'); }); } catch(e) {}
        state.confirmedRules.splice(index, 1); saveRules(); updateRuleList();
    }

    function toggleRuleVisibility(index, disabled) {
        const rule = state.confirmedRules[index]; if (!rule) return;
        rule.disabled = disabled;
        try {
            document.querySelectorAll(rule.selector).forEach(el => {
                if (disabled) { el.removeAttribute('data-xb-hidden'); el.style.removeProperty('display'); }
                else { el.setAttribute('data-xb-hidden', 'true'); el.style.setProperty('display', 'none', 'important'); }
            });
        } catch(e) {}
        saveRules(); updateRuleList();
    }

    // ======================== UI 面板 & 浮动按钮 ========================
    let panel = null;
    let floatingBtn = null;
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };

    // 创建浮动按钮（面板隐藏时显示）
    function createFloatingButton() {
        floatingBtn = document.createElement('div');
        floatingBtn.id = 'xb-floating-btn';
        floatingBtn.innerHTML = '🛡️';
        floatingBtn.title = 'X Blocker - 点击打开面板';
        floatingBtn.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 44px;
            height: 44px;
            background: linear-gradient(135deg, #1d9bf0, #0d8ecf);
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            cursor: pointer;
            z-index: 2147483646;
            box-shadow: 0 4px 16px rgba(29,155,240,0.4);
            transition: all 0.2s ease;
            user-select: none;
        `;
        floatingBtn.onmouseenter = () => { floatingBtn.style.transform = 'scale(1.15)'; floatingBtn.style.boxShadow = '0 6px 24px rgba(29,155,240,0.5)'; };
        floatingBtn.onmouseleave = () => { floatingBtn.style.transform = 'scale(1)'; floatingBtn.style.boxShadow = '0 4px 16px rgba(29,155,240,0.4)'; };
        floatingBtn.onclick = () => showPanel();
        document.body.appendChild(floatingBtn);
        
        // 初始状态：如果面板应该隐藏
        if (!state.panelVisible) {
            floatingBtn.style.display = 'flex';
        } else {
            floatingBtn.style.display = 'none';
        }
    }

    // 显示面板，隐藏浮动按钮
    function showPanel() {
        if (panel) {
            panel.style.display = 'flex';
            panel.style.opacity = '0';
            panel.style.transform = 'translateY(20px) scale(0.95)';
            requestAnimationFrame(() => {
                panel.style.transition = 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)';
                panel.style.opacity = '1';
                panel.style.transform = 'translateY(0) scale(1)';
            });
        }
        if (floatingBtn) floatingBtn.style.display = 'none';
        savePanelVisibility(true);
        updateToggleState(true);
    }

    // 隐藏面板，显示浮动按钮
    function hidePanel() {
        if (panel) {
            panel.style.transition = 'all 0.2s ease-in';
            panel.style.opacity = '0';
            panel.style.transform = 'translateY(10px) scale(0.95)';
            setTimeout(() => {
                panel.style.display = 'none';
                panel.style.transition = '';
                panel.style.transform = '';
            }, 200);
        }
        if (floatingBtn) floatingBtn.style.display = 'flex';
        savePanelVisibility(false);
        updateToggleState(false);
        exitPickingMode();
    }

    // 更新底部切换按钮状态
    function updateToggleState(visible) {
        const toggleLabel = document.getElementById('xb-toggle-label');
        const toggleSwitch = document.getElementById('xb-toggle-switch');
        if (toggleLabel) toggleLabel.textContent = visible ? '显示面板' : '隐藏面板';
        if (toggleSwitch) { toggleSwitch.checked = visible; }
    }

    function createPanel() {
        panel = document.createElement('div');
        panel.id = 'xb-panel';
        panel.innerHTML = `
            <div id="xb-drag-handle" style="cursor: move; user-select: none;">
                <span class="xb-title">🛡️ 屏蔽选取器</span>
                <span class="xb-count" id="xb-count">(0)</span>
            </div>

            <div class="xb-tabs">
                <button class="xb-tab active" data-tab="pick">🎯 选取</button>
                <button class="xb-tab" data-tab="rules">📋 规则 (${state.confirmedRules.length})</button>
            </div>

            <!-- 选取模式 -->
            <div class="xb-tab-content active" id="tab-pick">
                <button id="xb-toggle-pick" class="xb-btn xb-btn-primary">🎯 开始选取元素</button>
                <p class="xb-hint">点击按钮后，在页面上点击要屏蔽的区域<br>支持多选，全部选完后预览并确认保存</p>

                <div id="xb-selection-actions" class="xb-hidden">
                    <div class="xb-action-row">
                        <button class="xb-btn xb-btn-preview" id="xb-preview">👁️ 预览效果</button>
                        <button class="xb-btn xb-btn-cancel" id="xb-cancel-preview">↩️ 取消预览</button>
                    </div>
                    <div class="xb-action-row">
                        <button class="xb-btn xb-btn-danger" id="xb-clear">🗑️ 清空重选</button>
                        <button class="xb-btn xb-btn-success" id="xb-confirm">💾 确认保存</button>
                    </div>
                </div>

                <div id="xb-selected-list" class="xb-selected-list"></div>
            </div>

            <!-- 规则列表 -->
            <div class="xb-tab-content" id="tab-rules">
                <div class="xb-rules-header">
                    <span>共 <strong id="xb-rule-count">${state.confirmedRules.length}</strong> 条规则</span>
                    <button class="xb-btn xb-btn-sm xb-btn-danger" id="xb-clear-all-rules">清空全部</button>
                </div>
                <div id="xb-rule-list" class="xb-rule-list"></div>
                ${state.confirmedRules.length === 0 ? '<p class="xb-empty">暂无屏蔽规则<br>使用「选取」功能添加</p>' : ''}
            </div>

            <!-- 底部：显示/隐藏切换开关 (Tampermonkey 风格) -->
            <div class="xb-footer">
                <div class="xb-toggle-wrap" id="xb-toggle-container">
                    <label class="xb-tm-switch">
                        <input type="checkbox" id="xb-toggle-switch" checked>
                        <span class="xb-tm-slider">
                            <span class="xb-tm-knob"></span>
                        </span>
                        <span class="xb-toggle-label" id="xb-toggle-label">显示面板</span>
                    </label>
                </div>
            </div>
        `;

        injectStyles();
        document.body.appendChild(panel);
        bindDragEvents();

        panel.querySelectorAll('.xb-tab').forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
        bindButtonEvents();
        bindToggleEvent();
        updateRuleList();

        // 根据保存的状态决定初始可见性
        if (!state.panelVisible) {
            panel.style.display = 'none';
        } else {
            updateToggleState(true);
        }

        return panel;
    }

    // 绑定显示/隐藏切换事件
    function bindToggleEvent() {
        const toggleSwitch = document.getElementById('xb-toggle-switch');
        const toggleContainer = document.getElementById('xb-toggle-container');

        if (toggleContainer) {
            toggleContainer.addEventListener('click', () => {
                const isCurrentlyOn = toggleSwitch.checked;
                if (isCurrentlyOn) {
                    hidePanel();
                } else {
                    showPanel();
                }
            });
        }
    }

    function injectStyles() {
        if (document.getElementById('xb-styles')) return;
        const style = document.createElement('style');
        style.id = 'xb-styles';
        style.textContent = `
            /* ===== 主面板 ===== */
            #xb-panel {
                position: fixed;
                bottom: 60px; right: 20px;
                width: 320px;
                max-height: 540px;
                background: #15202b;
                border-radius: 16px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08);
                z-index: 2147483647;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 13px;
                color: #e7e9ea;
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }

            /* ===== 拖拽头 ===== */
            #xb-drag-handle {
                display: flex; align-items: center; gap: 8px;
                padding: 14px 16px 10px; cursor: move; user-select: none; flex-shrink: 0;
            }
            .xb-title { font-size: 15px; font-weight: 700; color: #fff; }
            .xb-count { font-size: 12px; color: #ff8c00; font-weight: 600; }

            /* ===== Tabs ===== */
            .xb-tabs {
                display: flex; padding: 0 12px; gap: 6px;
                border-bottom: 1px solid #38444d; flex-shrink: 0;
            }
            .xb-tab {
                flex: 1; padding: 8px 4px; border: none; background: transparent;
                color: #8899a6; font-size: 13px; font-weight: 600; cursor: pointer;
                border-radius: 8px 8px 0 0; transition: all 0.2s;
            }
            .xb-tab:hover { color: #1d9bf0; background: rgba(29,155,240,0.08); }
            .xb-tab.active { color: #1d9bf0; border-bottom: 2px solid #1d9bf0; }

            /* ===== Tab 内容 ===== */
            .xb-tab-content { display: none; padding: 14px 16px; overflow-y: auto; flex: 1; min-height: 0; }
            .xb-tab-content.active { display: block; }

            /* ===== 按钮 ===== */
            .xb-btn {
                display: inline-flex; align-items: center; justify-content: center; gap: 4px;
                padding: 10px 14px; border: none; border-radius: 9999px;
                font-size: 13px; font-weight: 700; cursor: pointer;
                transition: all 0.15s; width: 100%; margin-bottom: 8px;
            }
            .xb-btn-primary { background: linear-gradient(135deg, #1d9bf0, #0d8ecf); color: white; }
            .xb-btn-primary:hover { transform: scale(1.02); box-shadow: 0 4px 16px rgba(29,155,240,0.4); }
            .xb-btn-primary.active { background: linear-gradient(135deg, #ff8c00, #e67a00); animation: pulse 1.5s infinite; }
            .xb-btn-success { background: #00ba7c; color: white; }
            .xb-btn-success:hover { background: #00a06a; transform: scale(1.02); }
            .xb-btn-danger { background: #f4212e; color: white; }
            .xb-btn-danger:hover { background: #d41c28; }
            .xb-btn-preview, .xb-btn-cancel { background: #536471; color: white; }
            .xb-btn-preview:hover, .xb-btn-cancel:hover { background: #687b8a; }
            .xb-btn-sm { padding: 5px 10px; font-size: 11px; width: auto; margin-bottom: 0; }
            .xb-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none !important; }

            .xb-action-row { display: flex; gap: 8px; margin-bottom: 8px; }
            .xb-action-row .xb-btn { flex: 1; margin-bottom: 0; }

            @keyframes pulse { 0%,100%{box-shadow:0 0 0 0 rgba(255,140,0,0.5)} 50%{box-shadow:0 0 0 8px rgba(255,140,0,0)} }

            .xb-hint { color: #8899a6; font-size: 12px; line-height: 1.5; text-align: center; margin: 10px 0 14px; }

            /* ===== 已选列表 ===== */
            .xb-selected-list { max-height: 150px; overflow-y: auto; margin-top: 10px; }
            .xb-selected-item {
                background: rgba(255,140,0,0.1); border: 1px solid rgba(255,140,0,0.25);
                border-radius: 8px; padding: 8px 10px; margin-bottom: 6px;
                font-size: 11px; word-break: break-all; display: flex; align-items: center; gap: 8px;
            }
            .xb-selected-item .num {
                background:#ff8c00; color:white; width:20px; height:20px; border-radius:50%;
                display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:bold; flex-shrink:0;
            }
            .xb-selected-item .sel-text { flex:1; color:#ffd699; font-family:"SF Mono",Consolas,monospace; font-size:10px; }

            /* ===== 规则列表 ===== */
            .xb-rules-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; font-size:13px; color:#8899a6; }
            .xb-rule-list { max-height: 260px; overflow-y: auto; }
            .xb-rule-item { background:#192734; border:1px solid #38444d; border-radius:10px; padding:10px 12px; margin-bottom:8px; transition:all 0.2s; }
            .xb-rule-item:hover { border-color:#536471; }
            .xb-rule-item.disabled { opacity:0.45; }
            .xb-rule-sel { font-family:"SF Mono",Consolas,monospace; font-size:11px; color:#1d9bf0; word-break:break-all; margin-bottom:6px; line-height:1.4; }
            .xb-rule-actions { display:flex; gap:6px; }
            .xb-rule-actions .xb-btn { padding:4px 10px; font-size:11px; margin-bottom:0; }
            .xb-rule-actions button.flex-1 { flex:1; }
            .xb-empty { text-align:center; color:#8899a6; padding:30px 0; font-size:13px; line-height:1.6; }
            .xb-hidden { display:none!important; }

            /* ===== 底部切换区域 (Tampermonkey 风格) ===== */
            .xb-footer {
                padding: 12px 16px 14px;
                border-top: 1px solid #38444d;
                flex-shrink: 0;
            }
            .xb-toggle-wrap {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
            }
            
            /* TM 风格开关容器 */
            .xb-tm-switch {
                display: flex !important;
                align-items: center;
                gap: 10px;
                cursor: pointer;
                user-select: none;
                -webkit-user-select: none;
                padding: 2px 0;
            }
            .xb-tm-switch input { display: none; }

            /* 圆角胶囊轨道 */
            .xb-tm-slider {
                position: relative;
                width: 44px;
                height: 24px;
                background-color: #536471;
                border-radius: 9999px;
                transition: background-color 0.25s ease;
                flex-shrink: 0;
            }

            /* 启用状态：绿色背景 */
            .xb-tm-switch input:checked + .xb-tm-slider {
                background-color: #00ba7c;
                box-shadow: inset 0 0 0 1px rgba(0,186,124,0.3);
            }

            /* 圆形滑块 */
            .xb-tm-knob {
                position: absolute;
                top: 2px;
                left: 2px;
                width: 20px;
                height: 20px;
                background: #ffffff;
                border-radius: 50%;
                transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
                box-shadow: 0 1px 3px rgba(0,0,0,0.25);
            }

            /* 启用状态：滑块滑到右边 */
            .xb-tm-switch input:checked + .xb-tm-slider .xb-tm-knob {
                transform: translateX(20px);
            }

            /* 标签文字 */
            .xb-toggle-label {
                font-size: 13px;
                color: #8899a6;
                font-weight: 500;
                transition: color 0.2s;
            }
            .xb-tm-switch:hover .xb-toggle-label { color: #e7e9ea; }
            .xb-tm-switch:active .xb-tm-knob { width: 22px; }

            /* ===== 浮动按钮 ===== */
            #xb-floating-btn {
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 2147483646;
            }

            /* ===== 通知 ===== */
            .xb-notification {
                position: fixed;
                top: 20px; left: 50%;
                transform: translateX(-50%) translateY(-100px);
                padding: 12px 24px; border-radius: 9999px;
                font-size: 14px; font-weight: 600;
                z-index: 2147483647;
                transition: transform 0.35s cubic-bezier(0.68,-0.55,0.265,1.55);
                white-space: nowrap; max-width:90vw; overflow:hidden; text-overflow:ellipsis;
            }
            .xb-notification.show { transform: translateX(-50%) translateY(0); }
            .xb-notification.success { background:#00ba7c; color:white; }
            .xb-notification.error { background:#f4212e; color:white; }
            .xb-notification.info { background:#1d9bf0; color:white; }

            @media(max-width:400px){
                #xb-panel { width:calc(100vw - 20px); right:10px; bottom:10px; }
            }
        `;
        document.head.appendChild(style);
    }

    // 拖拽功能
    function bindDragEvents() {
        const handle = panel.querySelector('#xb-drag-handle');
        handle.addEventListener('mousedown', e => {
            isDragging = true;
            const r = panel.getBoundingClientRect();
            dragOffset.x = e.clientX - r.left;
            dragOffset.y = e.clientY - r.top;
            panel.style.transition = 'none';
            e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if (!isDragging) return;
            let l = e.clientX - dragOffset.x, t = e.clientY - dragOffset.y;
            l = Math.max(0, Math.min(l, window.innerWidth - panel.offsetWidth));
            t = Math.max(0, Math.min(t, window.innerHeight - panel.offsetHeight));
            panel.style.right = 'auto'; panel.style.bottom = 'auto';
            panel.style.left = l + 'px'; panel.style.top = t + 'px';
        });
        document.addEventListener('mouseup', () => { isDragging = false; if (panel) panel.style.transition = ''; });

        handle.addEventListener('touchstart', e => {
            isDragging = true;
            const touch = e.touches[0], r = panel.getBoundingClientRect();
            dragOffset.x = touch.clientX - r.left; dragOffset.y = touch.clientY - r.top;
            panel.style.transition = 'none';
        }, { passive:true });
        document.addEventListener('touchmove', e => {
            if (!isDragging) return;
            const touch = e.touches[0];
            let l = touch.clientX - dragOffset.x, t = touch.clientY - dragOffset.y;
            l = Math.max(0, Math.min(l, window.innerWidth - panel.offsetWidth));
            t = Math.max(0, Math.min(t, window.innerHeight - panel.offsetHeight));
            panel.style.right = 'auto'; panel.style.bottom = 'auto';
            panel.style.left = l + 'px'; panel.style.top = t + 'px';
        }, { passive:true });
        document.addEventListener('touchend', () => { isDragging = false; if (panel) panel.style.transition = ''; });
    }

    function switchTab(tabId) {
        panel.querySelectorAll('.xb-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
        panel.querySelectorAll('.xb-tab-content').forEach(c => c.classList.toggle('active', c.id === `tab-${tabId}`));
        if (tabId === 'rules') updateRuleList();
    }

    function bindButtonEvents() {
        document.getElementById('xb-toggle-pick').addEventListener('click', togglePickingMode);
        document.getElementById('xb-preview').addEventListener('click', () => { previewSelected(); showNotification('👁️ 预览模式 — 选中的元素已隐藏', 'info'); });
        document.getElementById('xb-cancel-preview').addEventListener('click', () => { cancelPreview(); showNotification('↩️ 已取消预览', 'info'); });
        document.getElementById('xb-clear').addEventListener('click', () => { cancelPreview(); clearAllSelection(); });
        document.getElementById('xb-confirm').addEventListener('click', confirmSave);
        document.getElementById('xb-clear-all-rules').addEventListener('click', () => {
            if (!confirm('确定要清除所有屏蔽规则吗？')) return;
            state.confirmedRules.forEach(rule => { try { document.querySelectorAll(rule.selector).forEach(el => { el.removeAttribute('data-xb-hidden'); el.style.removeProperty('display'); }); } catch(e){} });
            state.confirmedRules = []; saveRules(); updateRuleList();
            showNotification('🗑️ 已清空所有规则', 'info');
        });
    }

    function updateSelectionUI() {
        const btn = document.getElementById('xb-toggle-pick');
        const actions = document.getElementById('xb-selection-actions');
        const list = document.getElementById('xb-selected-list');
        const countEl = document.getElementById('xb-count');
        const count = state.selectedElements.size;
        countEl.textContent = `(${count})`;
        if (btn) {
            if (state.pickingMode) { btn.textContent = '❌ 取消选取'; btn.classList.add('active'); }
            else { btn.textContent = '🎯 开始选取元素'; btn.classList.remove('active'); }
        }
        if (actions) { if (count > 0) actions.classList.remove('xb-hidden'); else { actions.classList.add('xb-hidden'); cancelPreview(); } }
        if (list) {
            list.innerHTML = '';
            let idx = 1;
            for (const [el, data] of state.selectedElements) {
                const item = document.createElement('div');
                item.className = 'xb-selected-item';
                item.innerHTML = `<span class="num">${idx++}</span><span class="sel-text">${data.selector}</span>`;
                item.addEventListener('mouseenter', () => { el.scrollIntoView({ behavior:'smooth', block:'center' }); const h=data.highlightEl; if(h) h.style.boxShadow='0 0 0 4px #fff, 0 0 30px rgba(255,140,0,0.8)'; });
                item.addEventListener('mouseleave', () => { const h=data.highlightEl; if(h) h.style.boxShadow='0 0 20px rgba(255,140,0,0.4)'; });
                list.appendChild(item);
            }
        }
    }

    function updateRuleList() {
        const container = document.getElementById('xb-rule-list');
        const countEl = document.getElementById('xb-rule-count');
        const rulesHeaderCount = panel?.querySelector('.xb-tab[data-tab="rules"]');
        if (container) container.innerHTML = '';
        if (countEl) countEl.textContent = state.confirmedRules.length;
        if (rulesHeaderCount) rulesHeaderCount.textContent = `📋 规则 (${state.confirmedRules.length})`;
        if (!container) return;
        if (state.confirmedRules.length === 0) { container.innerHTML = '<p class="xb-empty">暂无屏蔽规则<br>使用「选取」功能添加</p>'; return; }
        state.confirmedRules.forEach((rule, index) => {
            const item = document.createElement('div');
            item.className = 'xb-rule-item' + (rule.disabled ? ' disabled' : '');
            item.innerHTML = `
                <div class="xb-rule-sel">${escapeHtml(rule.selector)}</div>
                <div class="xb-rule-actions">
                    <button class="xb-btn ${rule.disabled ? 'xb-btn-success' : 'xb-btn-preview'} flex-1" data-action="${rule.disabled?'enable':'disable'}" data-index="${index}">
                        ${rule.disabled ? '▶️ 启用' : '⏸️ 禁用'}
                    </button>
                    <button class="xb-btn xb-btn-danger" data-action="delete" data-index="${index}">🗑️ 删除</button>
                </div>`;
            item.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteRule(index));
            item.querySelector('[data-action="disable"],[data-action="enable"]')?.addEventListener('click', e => toggleRuleVisibility(index, e.currentTarget.dataset.action === 'disable'));
            container.appendChild(item);
        });
    }

    // ======================== 选取模式控制 ========================
    function togglePickingMode() {
        state.pickingMode = !state.pickingMode;
        if (state.pickingMode) { document.body.classList.add('xb-picking-mode'); showNotification('🎯 选取模式开启 — 点击页面元素进行选择（按 ESC 退出）', 'info'); }
        else exitPickingMode();
        updateSelectionUI();
    }

    function exitPickingMode() {
        state.pickingMode = false;
        document.body.classList.remove('xb-picking-mode');
        removeHoverOutline();
        const btn = document.getElementById('xb-toggle-pick');
        if (btn) { btn.textContent = '🎯 开始选取元素'; btn.classList.remove('active'); }
    }

    // ======================== 页面事件监听 ========================
    function onPageClick(e) {
        if (!state.pickingMode) return;
        if (panel && panel.contains(e.target)) return;
        if (e.target.closest('.xb-highlight-overlay')) return;
        if (e.target.closest('.xb-remove-btn')) return;
        if (floatingBtn && floatingBtn.contains(e.target)) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        const target = e.target;
        if (target && target !== document.body && target !== document.documentElement) { selectElement(target); showNotification(`✅ 已选取第 ${state.selectedElements.size} 个元素`, 'success'); }
        return false;
    }

    function onMouseOver(e) {
        if (!state.pickingMode || !panel) return;
        if (panel?.contains(e.target)) return;
        if (e.target.closest('.xb-highlight-overlay')) return;
        if (floatingBtn && floatingBtn.contains(e.target)) return;
        const target = e.target;
        if (target && target !== document.body && target !== document.documentElement) createHoverOutline(target);
    }

    function onKeydown(e) {
        if (e.key === 'Escape' && state.pickingMode) { exitPickingMode(); updateSelectionUI(); showNotification('❌ 已退出选取模式', 'info'); }
    }

    function observeNavigation() {
        let lastUrl = location.href;
        new MutationObserver(() => { if (location.href !== lastUrl) { lastUrl = location.href; setTimeout(applyAllRules, 500); } }).observe(document, { subtree:true, childList:true });
        new MutationObserver(() => { if (!state.pickingMode) applyAllRules(); }).observe(document.body, { subtree:true, childList:true });
    }

    // ======================== 工具函数 ========================
    function escapeHtml(str) { const d=document.createElement('div'); d.textContent=str; return d.innerHTML; }

    function formatTime(ts) {
        if (!ts) return '';
        const diff=Date.now()-ts, mins=Math.floor(diff/60000);
        if(mins<1)return'刚刚';
        if(mins<60)return mins+'分钟前';
        const hours=Math.floor(mins/60);
        if(hours<24)return hours+'小时前';
        return Math.floor(hours/24)+'天前';
    }

    let notificationTimer=null;
    function showNotification(msg,type='info'){
        let n=document.getElementById('xb-notification');
        if(!n){n=document.createElement('div'); n.id='xb-notification'; document.body.appendChild(n);}
        n.className=`xb-notification ${type}`; n.textContent=msg; n.offsetHeight; n.classList.add('show');
        clearTimeout(notificationTimer);
        notificationTimer=setTimeout(()=>n.classList.remove('show'),2200);
    }

    // ======================== 初始化 ========================
    function init() {
        loadRules();
        createFloatingButton();
        createPanel();
        observeNavigation();
        document.addEventListener('click', onPageClick, true);
        document.addEventListener('mouseover', onMouseOver, true);
        document.addEventListener('keydown', onKeydown, true);
        showNotification('🛡️ X 屏蔽选取器已就绪', 'success');
    }

    if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
    else init();

})();
