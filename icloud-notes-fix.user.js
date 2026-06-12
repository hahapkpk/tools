// ==UserScript==
// @name         iCloud 备忘录清单复选框黑色修复
// @namespace    https://github.com/hahapkpk/tools
// @version      1.0.0
// @description  修复 iCloud 备忘录中清单（checklist）勾选框显示为黑色的问题。通过 matchMedia 覆盖强制浅色模式渲染 WebGL canvas，确保复选框颜色正常。
// @author       hahapkpk
// @match        https://www.icloud.com.cn/notes/*
// @match        https://www.icloud.com/notes/*
// @match        https://www.icloud.com.cn/applications/notes3/*
// @match        https://www.icloud.com/applications/notes3/*
// @run-at       document-start
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/icloud-notes-fix.user.js
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/icloud-notes-fix.user.js
// ==/UserScript==

(function() {
    'use strict';

    /**
     * iCloud Notes 在深色模式下使用 WebGL 渲染笔记内容时，
     * 清单（checklist）的复选框会被渲染成黑色方块，导致无法正常显示。
     * 此脚本通过覆盖 matchMedia 强制返回浅色模式，
     * 使 WebGL canvas 使用正确的颜色渲染复选框。
     */

    // ============ 核心修复：matchMedia 覆盖 ============

    const originalMatchMedia = window.matchMedia.bind(window);

    window.matchMedia = function(query) {
        if (query.includes('prefers-color-scheme')) {
            // 强制返回浅色模式 (matches: false = 不是深色模式)
            return createFakeMediaQueryList(query, false);
        }
        return originalMatchMedia(query);
    };

    function createFakeMediaQueryList(media, matches) {
        return {
            matches: matches,
            media: media,
            onchange: null,
            addListener: function() {},
            removeListener: function() {},
            addEventListener: function(type, listener) {},
            removeEventListener: function() {},
            dispatchEvent: function() { return true; }
        };
    }

    // ============ CSS 辅助修复 ============

    function injectStyles() {
        const style = document.createElement('style');
        style.textContent = [
            ':root, body { color-scheme: light !important; }',
            '.notes-document-view, .notes-pad-view { color-scheme: light !important; }',
            '.editor-container, .unparsed-frame-view, .ct-input-manager { color-scheme: light !important; }',
            'cw-checkbox input + label::before { opacity: 1 !important; visibility: visible !important; }',
            'cw-checkbox input:checked + label::before { opacity: 1 !important; }'
        ].join('\n');

        (document.head || document.documentElement).appendChild(style);
    }

    if (document.head) {
        injectStyles();
    } else {
        document.addEventListener('DOMContentLoaded', injectStyles);
    }

    // ============ 主页面：监听并注入 iframe ============

    const isInNotesApp = window.location.href.includes('/applications/notes3/');

    if (!isInNotesApp) {
        function overrideIframeMatchMedia(iframe) {
            try {
                const win = iframe.contentWindow;
                if (!win || win._icloudNotesFixInjected) return;
                win._icloudNotesFixInjected = true;

                const origMM = win.matchMedia.bind(win);
                win.matchMedia = function(query) {
                    if (query.includes('prefers-color-scheme')) {
                        return createFakeMediaQueryList(query, false);
                    }
                    return origMM(query);
                };
            } catch(e) {}
        }

        const existingIframe = document.getElementById('early-child');
        if (existingIframe) {
            overrideIframeMatchMedia(existingIframe);
        }

        function setupObserver() {
            const observer = new MutationObserver(function(mutations) {
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.tagName === 'IFRAME' && node.id === 'early-child') {
                            overrideIframeMatchMedia(node);
                        }
                    }
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }

        if (document.body) {
            setupObserver();
        } else {
            document.addEventListener('DOMContentLoaded', setupObserver);
        }
    }

    console.log('[iCloud Notes Fix] 清单复选框修复已激活 ✓');
})();
