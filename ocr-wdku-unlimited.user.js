// ==UserScript==
// @name         OCR.wdku.net 次数限制解除
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  解除 ocr.wdku.net 免费转换次数限制 - 自动刷新Session + 拦截限制弹窗 + AJAX响应拦截
// @author       FlyWind
// @match        https://ocr.wdku.net/*
// @match        https://www.wdku.net/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // ==================== 1. 拦截 alert 弹窗 ====================
    var _origAlert = window.alert;
    window.alert = function(m) {
        if (typeof m === 'string') {
            var keywords = ['次数', '限制', '付费', '登录后', '今日', '已用完', '超出', 'VIP', '会员', '充值', '升级'];
            for (var i = 0; i < keywords.length; i++) {
                if (m.indexOf(keywords[i]) !== -1) {
                    console.log('[OCR解锁] 拦截弹窗: ' + m);
                    showTip('🚫 已拦截限制提示: ' + m, '#FF9800');
                    // 触发自动刷新 session
                    refreshSession();
                    return;
                }
            }
        }
        return _origAlert.call(window, m);
    };

    // ==================== 2. 刷新 Session ====================
    var _refreshing = false;

    function refreshSession() {
        if (_refreshing) return;
        _refreshing = true;
        console.log('[OCR解锁] 正在刷新 PHPSESSID...');

        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/?_refresh=' + Date.now(), true);
        xhr.withCredentials = true;
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                _refreshing = false;
                console.log('[OCR解锁] Session 刷新完成: ' + document.cookie);
                // 重置提交状态
                try { if (typeof is_submit !== 'undefined') is_submit = 0; } catch(e) {}
                try {
                    if (typeof $ === 'function') {
                        $('#btn_submit1').removeClass('disabled');
                        $('#btn_submit2').removeClass('disabled');
                    }
                } catch(e) {}
                showTip('✅ Session 已刷新，请重新上传并提交', '#4CAF50');
            }
        };
        xhr.send();
    }

    // 暴露到全局方便控制面板调用
    window.__refreshOCRSession = refreshSession;

    // ==================== 3. 清除限制标记 ====================
    function clearMarks() {
        try { localStorage.clear(); } catch(e) {}
        try { sessionStorage.clear(); } catch(e) {}
        var cookies = document.cookie.split(';');
        for (var i = 0; i < cookies.length; i++) {
            var name = cookies[i].split('=')[0].trim();
            if (name !== 'PHPSESSID') {
                document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.wdku.net;';
            }
        }
        showTip('✅ 限制标记已清除', '#4CAF50');
        console.log('[OCR解锁] 限制标记已清除');
    }
    window.__clearOCRMarks = clearMarks;

    // ==================== 4. 拦截 jQuery AJAX ====================
    function hookJQuery() {
        if (typeof jQuery === 'undefined' || !jQuery.ajax) {
            setTimeout(hookJQuery, 200);
            return;
        }
        var origAjax = jQuery.ajax;
        jQuery.ajax = function(opts) {
            var url = opts.url || '';
            var origSuccess = opts.success;
            var origError = opts.error;

            // 拦截提交接口的成功回调
            if (origSuccess && (url.indexOf('/index') !== -1 || url.indexOf('conv') !== -1)) {
                opts.success = function(data) {
                    if (typeof data === 'object' && data.errno > 0 && data.desc) {
                        var desc = data.desc;
                        var kws = ['次数', '限制', '付费', '登录', '今日', '已用完', '超出'];
                        for (var i = 0; i < kws.length; i++) {
                            if (desc.indexOf(kws[i]) !== -1) {
                                console.log('[OCR解锁] 服务端限制: ' + desc);
                                refreshSession();
                                break;
                            }
                        }
                    }
                    return origSuccess.apply(this, arguments);
                };
            }

            // 拦截错误回调，阻止跳转登录页
            if (origError && url.indexOf('/index') !== -1) {
                opts.error = function() {
                    var result = origError.apply(this, arguments);
                    try { if (typeof is_submit !== 'undefined') is_submit = 0; } catch(e) {}
                    try {
                        if (typeof $ === 'function') {
                            $('#btn_submit1').removeClass('disabled');
                            $('#btn_submit2').removeClass('disabled');
                        }
                    } catch(e) {}
                    return result;
                };
            }

            return origAjax.apply(this, arguments);
        };
        console.log('[OCR解锁] jQuery AJAX 拦截已启动');
    }
    hookJQuery();

    // ==================== 5. 拦截 XHR ====================
    var origXHROpen = XMLHttpRequest.prototype.open;
    var origXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this.__ocrUrl = url;
        return origXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        var xhr = this;
        var url = xhr.__ocrUrl || '';

        if (url.indexOf('/index') !== -1 || url.indexOf('conv') !== -1) {
            var origOnLoad = xhr.onload;
            xhr.onload = function() {
                try {
                    var data = JSON.parse(xhr.responseText);
                    if (data.errno > 0 && data.desc) {
                        var desc = data.desc;
                        var kws = ['次数', '限制', '付费', '登录', '今日', '已用完', '超出'];
                        for (var i = 0; i < kws.length; i++) {
                            if (desc.indexOf(kws[i]) !== -1) {
                                console.log('[OCR解锁] XHR检测到限制: ' + desc);
                                refreshSession();
                                break;
                            }
                        }
                    }
                } catch(e) {}
                if (origOnLoad) origOnLoad.apply(this, arguments);
            };
        }
        return origXHRSend.apply(this, arguments);
    };

    // ==================== 6. 提示工具 ====================
    function showTip(message, color) {
        var tip = document.getElementById('ocr-unlock-tip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'ocr-unlock-tip';
            tip.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;padding:10px 16px;border-radius:6px;color:#fff;font-size:13px;font-family:Arial,sans-serif;max-width:400px;transition:opacity 0.5s;pointer-events:none;';
            document.body.appendChild(tip);
        }
        tip.textContent = message;
        tip.style.backgroundColor = color || '#2196F3';
        tip.style.opacity = '1';
        setTimeout(function() { tip.style.opacity = '0'; }, 3500);
    }

    // ==================== 7. 控制面板 ====================
    function addPanel() {
        if (document.getElementById('ocr-unlock-panel')) return;
        var panel = document.createElement('div');
        panel.id = 'ocr-unlock-panel';
        panel.innerHTML = '<div style="position:fixed;bottom:20px;right:20px;z-index:99998;background:rgba(51,51,51,0.95);color:#fff;padding:12px 16px;border-radius:8px;font-size:12px;font-family:Arial,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,0.3);">' +
            '<div style="font-weight:bold;margin-bottom:8px;color:#4CAF50;">🔓 OCR次数解锁 v1.1</div>' +
            '<button onclick="window.__refreshOCRSession()" style="background:#4CAF50;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;margin-right:6px;font-size:12px;">🔄 刷新Session</button>' +
            '<button onclick="window.__clearOCRMarks()" style="background:#FF9800;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;">🗑️ 清除标记</button>' +
            '<div style="margin-top:8px;color:#aaa;font-size:11px;">自动拦截限制弹窗 | 自动刷新Session | AJAX拦截</div>' +
            '</div>';
        document.body.appendChild(panel);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addPanel);
    } else {
        addPanel();
    }

    console.log('[OCR解锁] 油猴脚本已启动');
})();
