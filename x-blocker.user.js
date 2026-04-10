// ==UserScript==
// @name         X Blocker - 元素选取屏蔽器
// @namespace    http://tampermonkey.net/
// @version      3.3.2
// @description  可视化选取并屏蔽 X/Twitter 页面上不想要的区域（v3.3.2: 修复 applyTimer 未声明、CSS注入MutationObserver监听目标）
// @author       You
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // ======================== 状态管理 ========================
    const state = {
        pickingMode: false,
        selectedElements: new Map(),
        confirmedRules: [],
        hoveredElement: null,
        hoverOutline: null,
        panelVisible: true
    };

    // ======================== CSS 注入屏蔽系统 (v3.1 新增) ========================
    let blockCSSStyle = null;
    let cssInjectedToDOM = false; // v3.2: 标记是否已插入 DOM，防止重复
    let applyTimer = null; // v3.3.2: 修复 applyTimer 未声明导致严格模式报错

    // 把规则转成 CSS 注入 <head>，元素一出现就被拦截
    function injectBlockCSS() {
        if (blockCSSStyle) {
            // 已存在则更新内容
            blockCSSStyle.textContent = generateBlockCSSText();
            ensureCSSInDOM(); // v3.2: 确保已在 DOM 中
            return;
        }
        blockCSSStyle = document.createElement('style');
        blockCSSStyle.id = 'xb-block-css';
        blockCSSStyle.textContent = generateBlockCSSText();
        ensureCSSInDOM();
    }

    // v3.2: 确保 style 元素已插入 DOM（幂等操作）
    function ensureCSSInDOM() {
        if (cssInjectedToDOM || !blockCSSStyle) return;
        if (document.head) {
            document.head.appendChild(blockCSSStyle);
            cssInjectedToDOM = true;
        } else {
            new MutationObserver((_, obs) => {
                if (document.head && !cssInjectedToDOM) {
                    document.head.appendChild(blockCSSStyle);
                    cssInjectedToDOM = true;
                    obs.disconnect();
                }
            }).observe(document.documentElement || document, { childList: true, subtree: true });
        }
    }

    function generateBlockCSSText() {
        const rules = [];
        for (const rule of state.confirmedRules) {
            if (rule.disabled) continue;
            rules.push(`${rule.selector} { display: none !important; }`);
        }
        return rules.join('\n');
    }

    // 每次 save/delete/toggle 后同步更新 CSS
    function syncBlockCSS() {
        if (blockCSSStyle) {
            blockCSSStyle.textContent = generateBlockCSSText();
            ensureCSSInDOM(); // v3.2: 确保 style 已挂载到 DOM
        }
    }

    // 从存储加载
    function loadRules() {
        state.confirmedRules = GM_getValue('xb_rules', []);
        state.panelVisible = GM_getValue('xb_panel_visible', true);
        // 先注入 CSS（立即生效），再做 JS 兜底
        injectBlockCSS();
        applyAllRules();
    }

    function saveRules() {
        GM_setValue('xb_rules', state.confirmedRules);
        syncBlockCSS();  // v3.1: 立即同步 CSS
    }

    function savePanelVisibility(visible) {
        state.panelVisible = visible;
        GM_setValue('xb_panel_visible', visible);
    }

    // 应用所有已确认的屏蔽规则（支持选择器降级）— JS 兜底层
    function applyAllRules() {
        // 清理旧的 JS 隐藏标记
        document.querySelectorAll('[data-xb-hidden]').forEach(el => {
            el.removeAttribute('data-xb-hidden');
            el.style.removeProperty('display');
        });
        
        state.confirmedRules.forEach(rule => {
            if (rule.disabled) return;
            
            let found = tryApplySelector(rule.selector);
            if (found > 0) return;
            
            const fallbacks = rule.fallbacks || [];
            for (const fb of fallbacks) {
                found = tryApplySelector(fb);
                if (found > 0) {
                    console.log(`[X Blocker] 规则 "${rule.semanticLabel || rule.selector}" 主选择器失效，备选成功: ${fb}`);
                    return;
                }
            }
            
            if (!rule._warned && !rule.stable) {
                rule._warned = true;
                console.warn(`[X Blocker] 规则可能失效: ${rule.selector} — 建议重新选取`);
            }
        });
    }
    
    function tryApplySelector(selector) {
        try {
            const els = document.querySelectorAll(selector);
            els.forEach(el => {
                el.setAttribute('data-xb-hidden', 'true');
                el.style.setProperty('display', 'none', 'important');
            });
            return els.length;
        } catch(e) { return 0; }
    }

    // ======================== CSS 选择器生成 (v3 - 稳定属性优先) ========================
    
    const STABLE_ATTRS = ['data-testid', 'role', 'aria-label', 'data-name', 'href', 'name'];
    
    const X_SEMANTIC_PATTERNS = [
        { test: el => el.closest('[role="navigation"]') || el.getAttribute('role') === 'navigation', label: '导航栏' },
        { test: el => el.querySelector('a[href="/home"]') || el.querySelector('a[href="/explore"]') || el.querySelector('a[href="/notifications"]') || el.querySelector('a[href="/messages"]'), label: '导航链接区' },
        { test: el => el.querySelector('[data-testid="SideNav_NewTweet_Button"]')?.closest('nav')?.contains(el), label: '发推按钮区域' },
        { test: el => {
            const labels = ['趋势', 'Trends', '为你推荐', 'Who to follow', '可能感兴趣的人', '搜索 Twitter', 'Search and explore', 'Premium', '订阅'];
            return Array.from(el.querySelectorAll('*')).some(c => labels.some(l => c.textContent?.trim() === l));
        }, label: '侧边栏模块' },
        { test: el => {
            const footerLinks = ['服务条款', 'Terms', '隐私政策', 'Privacy', 'Cookie', '帮助中心', 'Help Center', '关于', 'About', '状态', 'Status', '广告', 'Ads'];
            return Array.from(el.querySelectorAll('*')).some(c => footerLinks.some(l => c.textContent?.trim().includes(l)));
        }, label: '页脚' },
    ];

    function generateSelector(el) {
        if (el.id && !el.id.startsWith('__')) return { primary: `#${CSS.escape(el.id)}`, stable: true };
        
        const selectors = [];
        
        const stableSelector = tryGenerateStableSelector(el);
        if (stableSelector) selectors.push({ sel: stableSelector, stable: true });
        
        const classSelector = generateClassBasedSelector(el);
        if (classSelector) selectors.push({ sel: classSelector, stable: false });
        
        const nthSelector = generateNthPathSelector(el);
        if (nthSelector) selectors.push({ sel: nthSelector, stable: false });
        
        if (selectors.length === 0) return { primary: el.tagName.toLowerCase(), stable: false, fallbacks: [] };
        
        return {
            primary: selectors[0].sel,
            stable: selectors[0].stable,
            fallbacks: selectors.slice(1).map(s => s.sel),
            semanticLabel: detectSemanticLabel(el)
        };
    }
    
    function tryGenerateStableSelector(el) {
        for (const attr of STABLE_ATTRS) {
            const val = el.getAttribute(attr);
            if (!val) continue;
            
            if (attr === 'data-testid' && val) return `[${attr}="${CSS.escape(val)}"]`;
            if (attr === 'role' && val) return `${el.tagName.toLowerCase()}[${attr}="${CSS.escape(val)}"]`;
            if (attr === 'aria-label' && val.length > 0 && val.length < 100) return `${el.tagName.toLowerCase()}[${attr}="${CSS.escape(val)}"]`;
            if (attr === 'href' && val.startsWith('/')) return `${el.tagName.toLowerCase()}[${attr}^="${val.split('?')[0]}"]`;
        }
        
        const pathWithStable = buildPathWithStableAncestor(el);
        if (pathWithStable) return pathWithStable;
        
        return null;
    }
    
    function buildPathWithStableAncestor(el) {
        let current = el;
        const pathToEl = [];
        let foundStable = null;
        let stablePart = '';
        
        while (current && current !== document.body && pathToEl.length < 5) {
            for (const attr of STABLE_ATTRS) {
                if (attr === 'data-testid' && current.getAttribute(attr)) {
                    foundStable = current;
                    stablePart = `[${attr}="${CSS.escape(current.getAttribute(attr))}"]`;
                    break;
                }
                if (attr === 'role' && current.getAttribute(attr)?.match(/^(navigation|main|complementary|banner|contentinfo)$/i)) {
                    foundStable = current;
                    stablePart = `${current.tagName.toLowerCase()}[${attr}="${current.getAttribute(attr)}"]`;
                    break;
                }
            }
            if (foundStable) break;
            
            const parent = current.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
                let step = current.tagName.toLowerCase();
                if (siblings.length > 1) step += `:nth-child(${indexOfInParent(current)})`;
                pathToEl.unshift(step);
            }
            current = parent;
        }
        
        if (foundStable) {
            const remaining = pathToEl.join(' > ');
            return remaining ? `${stablePart} > ${remaining}` : stablePart;
        }
        
        return null;
    }
    
    function generateClassBasedSelector(el) {
        const path = [];
        let current = el;
        while (current && current !== document.body && path.length < 6) {
            let selector = current.tagName.toLowerCase();
            if (current.className && typeof current.className === 'string') {
                const classes = current.className.trim().split(/\s+/).filter(c => 
                    c.length > 0 && 
                    !c.startsWith('xb-') && 
                    !c.startsWith('css-') &&
                    !c.startsWith('r-') &&
                    c !== 'highlighted'
                );
                if (classes.length > 0) selector += '.' + classes.slice(0, 2).map(c => CSS.escape(c)).join('.');
            }
            const parent = current.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
                if (siblings.length > 1) selector += `:nth-child(${indexOfInParent(current)})`;
            }
            path.unshift(selector);
            current = parent;
        }
        return path.join(' > ');
    }
    
    function generateNthPathSelector(el) {
        const path = [];
        let current = el;
        while (current && current !== document.body && path.length < 8) {
            let selector = current.tagName.toLowerCase();
            const parent = current.parentElement;
            if (parent) selector += `:nth-child(${indexOfInParent(current)})`;
            path.unshift(selector);
            current = parent;
        }
        return path.join(' > ');
    }

    function indexOfInParent(el) {
        let idx = 1;
        let sib = el.previousElementSibling;
        while (sib) { idx++; sib = sib.previousElementSibling; }
        return idx;
    }
    
    function detectSemanticLabel(el) {
        for (const pattern of X_SEMANTIC_PATTERNS) {
            if (pattern.test(el)) return pattern.label;
        }
        return null;
    }

    // ======================== 高亮系统 ========================
    function createHighlightOverlay(el) {
        const rect = el.getBoundingClientRect();
        const overlay = document.createElement('div');
        overlay.className = 'xb-highlight-overlay';
        overlay.style.cssText = `
            position: fixed; top: ${rect.top}px; left: ${rect.left}px;
            width: ${rect.width}px; height: ${rect.height}px;
            background: rgba(255,165,0,0.25); border: 3px solid #ff8c00; border-radius: 8px;
            pointer-events: none; z-index: 2147483646;
            box-shadow: 0 0 20px rgba(255,140,0,0.4); transition: all 0.15s ease;
        `;
        const count = state.selectedElements.size + 1;
        const badge = document.createElement('div');
        badge.className = 'xb-badge';
        badge.textContent = count;
        badge.style.cssText = `
            position:absolute; top:-12px; left:-12px; width:26px; height:26px;
            background:#ff8c00; color:white; border-radius:50%;
            display:flex; align-items:center; justify-content:center;
            font-size:13px; font-weight:bold; box-shadow:0 2px 8px rgba(0,0,0,0.3);
        `;
        overlay.appendChild(badge);

        const removeBtn = document.createElement('div');
        removeBtn.className = 'xb-remove-btn';
        removeBtn.innerHTML = '&times;';
        removeBtn.style.cssText = `
            position:absolute; top:-12px; right:-12px; width:24px; height:24px;
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
            position: fixed; top: ${rect.top-2}px; left: ${rect.left-2}px;
            width: ${rect.width+4}px; height: ${rect.height+4}px;
            border: 2px dashed #00aaff; border-radius: 8px;
            pointer-events: none; z-index: 2147483645;
            background: rgba(0,170,255,0.06); transition: all 0.08s ease;
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
        // 先移除被新元素包含的已选元素（子元素）
        for (const [elem] of state.selectedElements) {
            if (el.contains(elem)) deselectElement(elem);
        }
        // 再检查新元素是否已被已选元素包含（父元素），如果是则不重复选取
        for (const [elem] of state.selectedElements) {
            if (elem.contains(el)) return;
        }
        const selInfo = generateSelector(el);
        const displaySel = selInfo.semanticLabel ? `${selInfo.primary} [${selInfo.semanticLabel}]` : selInfo.primary;
        const highlightEl = createHighlightOverlay(el);
        state.selectedElements.set(el, { 
            primary: selInfo.primary, stable: selInfo.stable,
            fallbacks: selInfo.fallbacks || [], semanticLabel: selInfo.semanticLabel,
            display: displaySel, highlightEl 
        });
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
            if (!state.confirmedRules.find(r => r.selector === data.primary)) {
                state.confirmedRules.push({ 
                    selector: data.primary, fallbacks: data.fallbacks || [],
                    stable: data.stable, semanticLabel: data.semanticLabel, timestamp: Date.now() 
                });
                newCount++;
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
        state.confirmedRules.splice(index, 1); saveRules(); syncBlockCSS(); updateRuleList();
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
        saveRules(); syncBlockCSS(); updateRuleList();
    }

    // v3.3: 导出规则为 JSON 文件
    function exportRules() {
        if (state.confirmedRules.length === 0) { showNotification('⚠️ 没有可导出的规则', 'error'); return; }
        const data = {
            version: '3.3',
            exportedAt: new Date().toISOString(),
            rules: state.confirmedRules.map(r => ({
                selector: r.selector,
                fallbacks: r.fallbacks || [],
                stable: r.stable,
                semanticLabel: r.semanticLabel || null
            }))
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `x-blocker-rules-${Date.now()}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        showNotification(`📤 已导出 ${data.rules.length} 条规则`, 'success');
    }

    // v3.3.1: 从 JSON 文件导入规则（智能识别多种格式）
    function importRules(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target.result;

                // 检测是否误导入了 .user.js 脚本文件
                if (text.includes('==UserScript==') || text.includes('GM_setValue') || text.includes('GM_getValue')) {
                    showNotification(`❌ 这是脚本源码(.user.js)，不是规则JSON\n请先点击「📤导出」生成规则文件`, 'error');
                    return;
                }

                let data;

                // 格式1: 标准导出格式 { version, exportedAt, rules: [...] }
                try {
                    data = JSON.parse(text);
                } catch(parseErr) {
                    showNotification(`❌ 文件不是有效的JSON格式`, 'error');
                    return;
                }

                // 格式2: 纯数组 [{selector,...}, ...]
                if (Array.isArray(data)) {
                    data = { rules: data };
                }

                // 格式3: GM_setValue 原始存储数组（兼容手动备份）
                if (!data.rules) {
                    // 尝试将整个对象作为单条规则的集合
                    if (data.selector) {
                        data = { rules: [data] };
                    } else {
                        showNotification(`❌ 无法识别的文件格式\n需要包含 rules 数组或 selector 字段`, 'error');
                        return;
                    }
                }

                if (!data.rules || !Array.isArray(data.rules)) {
                    showNotification(`❌ 无效格式：缺少 rules 数组`, 'error');
                    return;
                }

                if (data.rules.length === 0) {
                    showNotification(`⚠️ 文件中没有规则`, 'error');
                    return;
                }

                let imported = 0, skipped = 0, invalid = 0;
                for (const r of data.rules) {
                    if (!r.selector || typeof r.selector !== 'string') { invalid++; continue; }
                    if (state.confirmedRules.find(existing => existing.selector === r.selector)) { skipped++; continue; }
                    state.confirmedRules.push({
                        selector: r.selector,
                        fallbacks: Array.isArray(r.fallbacks) ? r.fallbacks : [],
                        stable: !!r.stable,
                        semanticLabel: r.semanticLabel || null,
                        timestamp: Date.now()
                    });
                    imported++;
                }
                saveRules(); syncBlockCSS(); updateRuleList();

                let msg = `📥 已导入 ${imported} 条`;
                if (skipped > 0) msg += `，跳过 ${skipped} 条重复`;
                if (invalid > 0) msg += `，${invalid} 条无效`;
                showNotification(msg, 'success');

                // 同时在控制台输出详细信息
                console.log('[X Blocker] 导入完成:', { imported, skipped, invalid, total: data.rules.length });

            } catch(err) {
                console.error('[X Blocker] 导入异常:', err);
                showNotification(`❌ 导入失败: ${err.message}`, 'error');
            }
        };
        reader.readAsText(file);
    }

    // v3.3: 测试选择器是否匹配到元素
    function testRuleSelector(selector) {
        try {
            const els = document.querySelectorAll(selector);
            if (els.length === 0) return { count: 0, msg: '未匹配到任何元素' };
            // 高亮显示匹配到的元素（3秒后自动消失）
            els.forEach(el => {
                const prevOutline = el.style.outline;
                const prevOutlineOffset = el.style.outlineOffset;
                el.style.outline = '3px solid #00ba7c';
                el.style.outlineOffset = '-2px';
                setTimeout(() => {
                    el.style.outline = prevOutline;
                    el.style.outlineOffset = prevOutlineOffset;
                }, 3000);
            });
            return { count: els.length, msg: `匹配到 ${els.length} 个元素（已高亮3秒）` };
        } catch(err) {
            return { count: -1, msg: `选择器错误: ${err.message}` };
        }
    }

    // ======================== UI 面板 & 浮动按钮 ========================
    let panel = null;
    let floatingBtn = null;
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };

    function createFloatingButton() {
        floatingBtn = document.createElement('div');
        floatingBtn.id = 'xb-floating-btn';
        floatingBtn.innerHTML = '🛡️';
        floatingBtn.title = 'X Blocker - 点击打开面板';
        floatingBtn.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; width: 44px; height: 44px;
            background: linear-gradient(135deg, #1d9bf0, #0d8ecf); color: white; border-radius: 50%;
            display: flex; align-items: center; justify-content: center; font-size: 22px; cursor: pointer;
            z-index: 2147483646; box-shadow: 0 4px 16px rgba(29,155,240,0.4);
            transition: all 0.2s ease; user-select: none;
        `;
        floatingBtn.onmouseenter = () => { floatingBtn.style.transform = 'scale(1.15)'; floatingBtn.style.boxShadow = '0 6px 24px rgba(29,155,240,0.5)'; };
        floatingBtn.onmouseleave = () => { floatingBtn.style.transform = 'scale(1)'; floatingBtn.style.boxShadow = '0 4px 16px rgba(29,155,240,0.4)'; };
        floatingBtn.onclick = () => showPanel();
        document.body.appendChild(floatingBtn);
        
        if (!state.panelVisible) floatingBtn.style.display = 'flex';
        else floatingBtn.style.display = 'none';
    }

    function showPanel() {
        if (panel) {
            panel.style.display = 'flex'; panel.style.opacity = '0';
            panel.style.transform = 'translateY(20px) scale(0.95)';
            requestAnimationFrame(() => {
                panel.style.transition = 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)';
                panel.style.opacity = '1'; panel.style.transform = 'translateY(0) scale(1)';
            });
        }
        if (floatingBtn) floatingBtn.style.display = 'none';
        savePanelVisibility(true); updateToggleState(true);
    }

    function hidePanel() {
        if (panel) {
            panel.style.transition = 'all 0.2s ease-in'; panel.style.opacity = '0';
            panel.style.transform = 'translateY(10px) scale(0.95)';
            setTimeout(() => { panel.style.display = 'none'; panel.style.transition = ''; panel.style.transform = ''; }, 200);
        }
        if (floatingBtn) floatingBtn.style.display = 'none';
        savePanelVisibility(false); updateToggleState(false); exitPickingMode();
    }

    function updateToggleState(visible) {
        const toggleLabel = document.getElementById('xb-toggle-label');
        const toggleSwitch = document.getElementById('xb-toggle-switch');
        if (toggleLabel) toggleLabel.textContent = visible ? '显示面板' : '隐藏面板';
        if (toggleSwitch) toggleSwitch.checked = visible;
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

            <div class="xb-tab-content" id="tab-rules">
                <div class="xb-rules-header">
                    <span>共 <strong id="xb-rule-count">${state.confirmedRules.length}</strong> 条规则</span>
                    <div style="display:flex;gap:4px;">
                        <button class="xb-btn xb-btn-sm xb-btn-preview" id="xb-export-rules">📤 导出</button>
                        <label class="xb-import-label" id="xb-import-label">
                            <input type="file" id="xb-import-file" accept=".json" style="display:none">
                            <span class="xb-btn xb-btn-sm xb-btn-success">📥 导入</span>
                        </label>
                        <button class="xb-btn xb-btn-sm xb-btn-danger" id="xb-clear-all-rules">清空</button>
                    </div>
                </div>
                <div id="xb-rule-list" class="xb-rule-list"></div>
                ${state.confirmedRules.length === 0 ? '<p class="xb-empty">暂无屏蔽规则<br>使用「选取」功能添加</p>' : ''}
            </div>

            <div class="xb-footer">
                <div class="xb-toggle-wrap" id="xb-toggle-container">
                    <label class="xb-tm-switch">
                        <input type="checkbox" id="xb-toggle-switch" checked>
                        <span class="xb-tm-slider"><span class="xb-tm-knob"></span></span>
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

        if (!state.panelVisible) panel.style.display = 'none';
        else updateToggleState(true);

        return panel;
    }

    function bindToggleEvent() {
        const toggleSwitch = document.getElementById('xb-toggle-switch');
        const toggleContainer = document.getElementById('xb-toggle-container');
        if (toggleContainer) {
            toggleContainer.addEventListener('click', () => {
                if (toggleSwitch.checked) hidePanel();
                else showPanel();
            });
        }
    }

    function injectStyles() {
        if (document.getElementById('xb-styles')) return;
        const style = document.createElement('style');
        style.id = 'xb-styles';
        style.textContent = `
            #xb-panel { position: fixed; bottom: 60px; right: 20px; width: 320px; max-height: 540px;
                background: #15202b; border-radius: 16px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08);
                z-index: 2147483647; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 13px; color: #e7e9ea; overflow: hidden; display: flex; flex-direction: column; }
            #xb-drag-handle { display: flex; align-items: center; gap: 8px; padding: 14px 16px 10px; cursor: move; user-select: none; flex-shrink: 0; }
            .xb-title { font-size: 15px; font-weight: 700; color: #fff; }
            .xb-count { font-size: 12px; color: #ff8c00; font-weight: 600; }
            .xb-tabs { display: flex; padding: 0 12px; gap: 6px; border-bottom: 1px solid #38444d; flex-shrink: 0; }
            .xb-tab { flex: 1; padding: 8px 4px; border: none; background: transparent; color: #8899a6;
                font-size: 13px; font-weight: 600; cursor: pointer; border-radius: 8px 8px 0 0; transition: all 0.2s; }
            .xb-tab:hover { color: #1d9bf0; background: rgba(29,155,240,0.08); }
            .xb-tab.active { color: #1d9bf0; border-bottom: 2px solid #1d9bf0; }
            .xb-tab-content { display: none; padding: 14px 16px; overflow-y: auto; flex: 1; min-height: 0; }
            .xb-tab-content.active { display: block; }
            .xb-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px;
                padding: 10px 14px; border: none; border-radius: 9999px; font-size: 13px; font-weight: 700; cursor: pointer;
                transition: all 0.15s; width: 100%; margin-bottom: 8px; }
            .xb-btn-primary { background: linear-gradient(135deg, #1d9bf0, #0d8ecf); color: white; }
            .xb-btn-primary:hover { transform: scale(1.02); box-shadow: 0 4px 16px rgba(29,155,240,0.4); }
            .xb-btn-primary.active { background: linear-gradient(135deg, #ff8c00, #e67a00); animation: pulse 1.5s infinite; }
            .xb-btn-success { background: #00ba7c; color: white; } .xb-btn-success:hover { background: #00a06a; transform: scale(1.02); }
            .xb-btn-danger { background: #f4212e; color: white; } .xb-btn-danger:hover { background: #d41c28; }
            .xb-btn-preview, .xb-btn-cancel { background: #536471; color: white; }
            .xb-btn-preview:hover, .xb-btn-cancel:hover { background: #687b8a; }
            .xb-btn-sm { padding: 5px 10px; font-size: 11px; width: auto; margin-bottom: 0; }
            .xb-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none !important; }
            .xb-action-row { display: flex; gap: 8px; margin-bottom: 8px; }
            .xb-action-row .xb-btn { flex: 1; margin-bottom: 0; }
            @keyframes pulse { 0%,100%{box-shadow:0 0 0 0 rgba(255,140,0,0.5)} 50%{box-shadow:0 0 0 8px rgba(255,140,0,0)} }
            .xb-hint { color: #8899a6; font-size: 12px; line-height: 1.5; text-align: center; margin: 10px 0 14px; }
            .xb-selected-list { max-height: 150px; overflow-y: auto; margin-top: 10px; }
            .xb-selected-item { background: rgba(255,140,0,0.1); border: 1px solid rgba(255,140,0,0.25);
                border-radius: 8px; padding: 8px 10px; margin-bottom: 6px; font-size: 11px;
                word-break: break-all; display: flex; align-items: center; gap: 8px; }
            .xb-selected-item .num { background:#ff8c00; color:white; width:20px; height:20px; border-radius:50%;
                display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:bold; flex-shrink:0; }
            .xb-selected-item .sel-text { flex:1; color:#ffd699; font-family:"SF Mono",Consolas,monospace; font-size:10px; }
            .xb-stable-badge, .xb-unstable-badge { font-size: 11px; flex-shrink: 0; cursor: default; }
            .xb-rules-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; font-size:13px; color:#8899a6; }
            .xb-rule-list { max-height: 260px; overflow-y: auto; }
            .xb-rule-item { background:#192734; border:1px solid #38444d; border-radius:10px; padding:10px 12px; margin-bottom:8px; transition:all 0.2s; }
            .xb-rule-item:hover { border-color:#536471; } .xb-rule-item.disabled { opacity:0.45; }
            .xb-rule-sel { font-family:"SF Mono",Consolas,monospace; font-size:11px; color:#1d9bf0; word-break:break-all; margin-bottom:6px; line-height:1.4; }
            .xb-rule-header { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
            .xb-semantic-label { background:rgba(29,155,240,0.15); color:#1d9bf0; border:1px solid rgba(29,155,240,0.3);
                padding:2px 8px; border-radius:9999px; font-size:10px; font-weight:600; }
            .xb-rule-stable { color:#00ba7c; font-size:11px; font-weight:600; white-space:nowrap; }
            .xb-rule-unstable { color:#e67a00; font-size:11px; font-weight:600; white-space:nowrap; }
            .xb-rule-actions { display:flex; gap:6px; } .xb-rule-actions .xb-btn { padding:4px 10px; font-size:11px; margin-bottom:0; }
            .xb-rule-actions button.flex-1 { flex:1; }
            .xb-import-label { display:flex; cursor:pointer; }
            .xb-import-label .xb-btn { cursor: pointer; }
            .xb-empty { text-align:center; color:#8899a6; padding:30px 0; font-size:13px; line-height:1.6; }
            .xb-hidden { display:none!important; }
            .xb-footer { padding: 12px 16px 14px; border-top: 1px solid #38444d; flex-shrink: 0; }
            .xb-toggle-wrap { display: flex; align-items: center; justify-content: center; gap: 10px; }
            .xb-tm-switch { display: flex !important; align-items: center; gap: 10px; cursor: pointer; user-select: none;
                -webkit-user-select: none; padding: 2px 0; }
            .xb-tm-switch input { display: none; }
            .xb-tm-slider { position: relative; width: 44px; height: 24px; background-color: #536471;
                border-radius: 9999px; transition: background-color 0.25s ease; flex-shrink: 0; }
            .xb-tm-switch input:checked + .xb-tm-slider { background-color: #00ba7c; box-shadow: inset 0 0 0 1px rgba(0,186,124,0.3); }
            .xb-tm-knob { position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; background: #ffffff;
                border-radius: 50%; transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
                box-shadow: 0 1px 3px rgba(0,0,0,0.25); }
            .xb-tm-switch input:checked + .xb-tm-slider .xb-tm-knob { transform: translateX(20px); }
            .xb-toggle-label { font-size: 13px; color: #8899a6; font-weight: 500; transition: color 0.2s; }
            .xb-tm-switch:hover .xb-toggle-label { color: #e7e9ea; }
            .xb-tm-switch:active .xb-tm-knob { width: 22px; }
            #xb-floating-btn { position: fixed; bottom: 20px; right: 20px; z-index: 2147483646; }
            .xb-notification { position: fixed; top: 20px; left: 50%;
                transform: translateX(-50%) translateY(-100px); padding: 12px 24px; border-radius: 9999px;
                font-size: 14px; font-weight: 600; z-index: 2147483647;
                transition: transform 0.35s cubic-bezier(0.68,-0.55,0.265,1.55);
                white-space: nowrap; max-width:90vw; overflow:hidden; text-overflow:ellipsis; }
            .xb-notification.show { transform: translateX(-50%) translateY(0); }
            .xb-notification.success { background:#00ba7c; color:white; }
            .xb-notification.error { background:#f4212e; color:white; }
            .xb-notification.info { background:#1d9bf0; color:white; }
            @media(max-width:400px){ #xb-panel { width:calc(100vw - 20px); right:10px; bottom:10px; } }
        `;
        document.head.appendChild(style);
    }

    function bindDragEvents() {
        const handle = panel.querySelector('#xb-drag-handle');
        handle.addEventListener('mousedown', e => {
            isDragging = true;
            const r = panel.getBoundingClientRect();
            dragOffset.x = e.clientX - r.left; dragOffset.y = e.clientY - r.top;
            panel.style.transition = ''; e.preventDefault();
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
            panel.style.transition = '';
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
            state.confirmedRules = []; saveRules(); syncBlockCSS(); updateRuleList();
            showNotification('🗑️ 已清空所有规则', 'info');
        });
        // v3.3: 导出/导入按钮
        const exportBtn = document.getElementById('xb-export-rules');
        if (exportBtn) exportBtn.addEventListener('click', exportRules);
        const importInput = document.getElementById('xb-import-file');
        const importLabel = document.getElementById('xb-import-label');
        if (importLabel && importInput) {
            importLabel.addEventListener('click', (e) => {
                if (e.target !== importInput) importInput.click();
            });
        }
        if (importInput) importInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) { importRules(e.target.files[0]); e.target.value = ''; }
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
                const stableBadge = data.stable ? '<span class="xb-stable-badge" title="稳定选择器">🔒</span>' : '<span class="xb-unstable-badge" title="不稳定选择器">⚠️</span>';
                item.innerHTML = `<span class="num">${idx++}</span><span class="sel-text">${escapeHtml(data.display || data.primary)}</span>${stableBadge}`;
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
            const stableBadge = rule.stable ? '<span class="xb-rule-stable" title="基于稳定属性">🔒稳定</span>' : '<span class="xb-rule-unstable" title="可能因X.com更新而失效">⚠️不稳定</span>';
            const label = rule.semanticLabel ? `<span class="xb-semantic-label">${escapeHtml(rule.semanticLabel)}</span>` : '';
            
            item.className = 'xb-rule-item' + (rule.disabled ? ' disabled' : '');
            item.innerHTML = `
                <div class="xb-rule-header">
                    <div class="xb-rule-sel">${escapeHtml(rule.selector)}</div>
                    ${label}${stableBadge}
                </div>
                <div class="xb-rule-actions">
                    <button class="xb-btn xb-btn-sm" data-action="test" data-index="${index}" style="background:#536471;color:white;">🔍 测试</button>
                    <button class="xb-btn ${rule.disabled ? 'xb-btn-success' : 'xb-btn-preview'} flex-1" data-action="${rule.disabled?'enable':'disable'}" data-index="${index}">
                        ${rule.disabled ? '▶️ 启用' : '⏸️ 禁用'}
                    </button>
                    <button class="xb-btn xb-btn-danger" data-action="delete" data-index="${index}">🗑️</button>
                </div>`;
            item.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteRule(index));
            item.querySelector('[data-action="disable"],[data-action="enable"]')?.addEventListener('click', e => toggleRuleVisibility(index, e.currentTarget.dataset.action === 'disable'));
            // v3.3: 绑定测试按钮
            item.querySelector('[data-action="test"]')?.addEventListener('click', (e) => {
                const result = testRuleSelector(rule.selector);
                showNotification(`🔍 ${rule.selector.slice(0, 30)}${rule.selector.length > 30 ? '...' : ''} — ${result.msg}`, result.count > 0 ? 'success' : 'error');
            });
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
        let applyTimer = null;

        new MutationObserver(() => {
            if (location.href !== lastUrl) { lastUrl = location.href; scheduleApply(800); }
        }).observe(document, { subtree:true, childList:true });

        new MutationObserver(() => {
            if (!state.pickingMode) scheduleApply(300);
        }).observe(document.body, { subtree: true, childList: true });

        setInterval(() => {
            if (!state.pickingMode && document.visibilityState === 'visible') {
                applyAllRules();
            }
        }, 5000);

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !state.pickingMode) {
                setTimeout(applyAllRules, 500);
            }
        });
    }
    
    function scheduleApply(delay) {
        if (applyTimer) clearTimeout(applyTimer);
        applyTimer = setTimeout(() => { applyAllRules(); applyTimer = null; }, delay);
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

    // ======================== Tampermonkey 菜单命令 ========================
    let menuCommandIds = [];

    function registerMenuCommands() {
        const toggleId = GM_registerMenuCommand('👁️ 显示/隐藏面板', () => {
            if (state.panelVisible) hidePanel(); else showPanel();
        });
        menuCommandIds.push(toggleId);

        const pickId = GM_registerMenuCommand('🎯 选取元素', () => {
            if (!state.panelVisible) showPanel();
            setTimeout(() => { if (!state.pickingMode) togglePickingMode(); }, 300);
        });
        menuCommandIds.push(pickId);

        const rulesId = GM_registerMenuCommand(`📋 屏蔽规则 (${state.confirmedRules.length} 条)`, () => {
            if (!state.panelVisible) showPanel();
            setTimeout(() => switchTab('rules'), 300);
        });
        menuCommandIds.push(rulesId);

        const clearId = GM_registerMenuCommand('🗑️ 清除所有规则', () => {
            if (confirm('确定要清除所有屏蔽规则吗？')) {
                state.confirmedRules.forEach(rule => {
                    try { document.querySelectorAll(rule.selector).forEach(el => { el.removeAttribute('data-xb-hidden'); el.style.removeProperty('display'); }); } catch(e){}
                });
                state.confirmedRules = []; saveRules(); syncBlockCSS(); updateRuleList();
                showNotification('🗑️ 已清空所有屏蔽规则', 'info');
            }
        });
        menuCommandIds.push(clearId);
    }

    function unregisterMenuCommands() {
        menuCommandIds.forEach(id => { try { GM_unregisterMenuCommand(id); } catch(e){} });
        menuCommandIds = [];
    }

    // ======================== 初始化 (v3.2: 阶梯式重试 + CSS注入优化) ========================
    /* eslint-disable-next-line userscripts/no-invalid-metadata */
    function init() {
        loadRules();
        createFloatingButton();
        createPanel();
        observeNavigation();
        registerMenuCommands();
        document.addEventListener('click', onPageClick, true);
        document.addEventListener('mouseover', onMouseOver, true);
        document.addEventListener('keydown', onKeydown, true);

        // v3.1 核心：阶梯式重试，确保 X.com 异步加载的内容也能被及时屏蔽
        const RETRY_DELAYS = [100, 500, 1000, 2000];
        RETRY_DELAYS.forEach(delay => {
            setTimeout(() => {
                if (!state.pickingMode) applyAllRules();
            }, delay);
        });
    }

    // document-start 时 body/head 可能还没 ready，多重保险
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // 用微任务确保 DOM 基本就绪后再初始化
        if (document.body) init();
        else new MutationObserver((_, obs) => {
            if (document.body) { init(); obs.disconnect(); }
        }).observe(document.documentElement, { childList: true });
    }

})();
