// ==UserScript==
// @name         OCR.wdku.net 次数限制解除
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  解除 ocr.wdku.net 免费转换每日3次限制 - 自动换Session重试 + 拦截限制弹窗
// @author       FlyWind
// @match        https://ocr.wdku.net/*
// @match        https://www.wdku.net/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    var LOG_PREFIX = '[OCR解锁 v2.0] ';
    var MAX_RETRY = 5;           // 最多自动重试次数
    var retryCount = 0;          // 当前重试计数
    var pendingSubmit = null;    // 待重试的提交数据

    // ==================== 日志 ====================
    function log(msg) { console.log(LOG_PREFIX + msg); }

    // ==================== 提示气泡 ====================
    function showTip(message, color) {
        var tip = document.getElementById('ocr-unlock-tip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'ocr-unlock-tip';
            tip.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;padding:10px 16px;border-radius:6px;color:#fff;font-size:13px;font-family:Arial,sans-serif;max-width:420px;transition:opacity 0.5s;pointer-events:none;line-height:1.5;';
            document.body.appendChild(tip);
        }
        tip.innerHTML = message;
        tip.style.backgroundColor = color || '#2196F3';
        tip.style.opacity = '1';
        clearTimeout(tip._timer);
        tip._timer = setTimeout(function() { tip.style.opacity = '0'; }, 4000);
    }

    // ==================== 1. 拦截 alert ====================
    var _origAlert = window.alert;
    window.alert = function(m) {
        if (typeof m === 'string' && isLimitMessage(m)) {
            log('拦截弹窗: ' + m);
            showTip('🚫 已拦截限制提示<br><small>' + escHtml(m) + '</small><br>🔄 正在自动换Session重试...', '#FF5722');
            handleLimit();
            return;
        }
        return _origAlert.call(window, m);
    };

    // 判断是否为限制消息
    function isLimitMessage(msg) {
        var kws = ['每日提交上限', '次数', '限制', '付费转换', '登录后', '今日', '已用完', '超出', 'VIP', '会员', '升级'];
        for (var i = 0; i < kws.length; i++) {
            if (msg.indexOf(kws[i]) !== -1) return true;
        }
        return false;
    }

    function escHtml(s) {
        return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ==================== 2. 核心：换 Session ====================
    var isRefreshing = false;

    function refreshSession(callback) {
        if (isRefreshing) return;
        isRefreshing = true;
        log('正在换新 Session...');

        // Step 1: 删除旧 PHPSESSID
        document.cookie = 'PHPSESSID=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        document.cookie = 'PHPSESSID=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.wdku.net;';
        document.cookie = 'PHPSESSID=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=ocr.wdku.net;';

        // Step 2: 请求页面获取新 session
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/?_rs=' + Date.now(), true);
        xhr.withCredentials = true;
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                var newSess = document.cookie.match(/PHPSESSID=([^;]+)/);
                log('新 Session: ' + (newSess ? newSess[1] : 'unknown'));
                isRefreshing = false;
                if (callback) callback(!!newSess);
            }
        };
        xhr.send();
    }

    // 处理限制触发
    function handleLimit() {
        if (retryCount >= MAX_RETRY) {
            showTip('❌ 已达最大重试次数(' + MAX_RETRY + ')，请稍后再试', '#f44336');
            return;
        }
        retryCount++;
        log('第 ' + retryCount + ' 次重试...');

        refreshSession(function(success) {
            if (success) {
                showTip('✅ 第' + retryCount + '次换Session成功<br>🔄 请重新上传文件并提交', '#4CAF50');
                resetSubmitState();
            } else {
                showTip('❌ 换Session失败', '#f44336');
            }
        });
    }

    // 重置提交状态
    function resetSubmitState() {
        try { if (typeof is_submit !== 'undefined') is_submit = 0; } catch(e) {}
        try {
            if (typeof $ === 'function') {
                $('#btn_submit1').removeClass('disabled');
                $('#btn_submit2').removeClass('disabled');
                if (typeof submit_set_default === 'function') {
                    submit_set_default('🔄 Session已刷新，请重新上传文件并提交转换');
                }
            }
        } catch(e) {}
    }

    // ==================== 3. 拦截 jQuery AJAX ====================
    function hookJQuery() {
        if (typeof jQuery === 'undefined' || !jQuery.ajax) {
            setTimeout(hookJQuery, 200);
            return;
        }

        var origAjax = jQuery.ajax;
        jQuery.ajax = function(opts) {
            var url = opts.url || '';

            // 拦截 /index 提交接口
            if (url.indexOf('/index') !== -1) {
                var origSuccess = opts.success;
                var origError = opts.error;

                // 记住提交数据以便重试
                if (opts.data) {
                    pendingSubmit = (typeof opts.data === 'string') ? opts.data : $.param(opts.data);
                }

                opts.success = function(data) {
                    if (typeof data === 'object' && data.errno > 0 && data.desc && isLimitMessage(data.desc)) {
                        log('AJAX 检测到服务端限制: ' + data.desc);
                        showTip('🔄 检测到次数限制，正在自动换Session...<br><small>' + escHtml(data.desc) + '</small>', '#FF5722');
                        handleLimit();
                        return; // 不调用原始 success 回调
                    }
                    // 正常响应，重置重试计数
                    if (typeof data === 'object' && data.errno === 0) {
                        retryCount = 0;
                    }
                    if (origSuccess) return origSuccess.apply(this, arguments);
                };

                opts.error = function() {
                    // 阻止跳转到登录页
                    log('AJAX error 拦截，重置按钮状态');
                    resetSubmitState();
                    if (origError) return origError.apply(this, arguments);
                };
            }

            return origAjax.apply(this, arguments);
        };
        log('jQuery AJAX 拦截已启动');
    }
    hookJQuery();

    // ==================== 4. 拦截原生 XHR ====================
    var origXHROpen = XMLHttpRequest.prototype.open;
    var origXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this.__ocrUrl = url;
        return origXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
        var xhr = this;
        var url = xhr.__ocrUrl || '';

        if (url.indexOf('/index') !== -1) {
            // 记住提交数据
            if (body) pendingSubmit = body;

            var origOnLoad = xhr.onload;
            var origOnReady = xhr.onreadystatechange;

            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4 && xhr.status === 200) {
                    try {
                        var data = JSON.parse(xhr.responseText);
                        if (data.errno > 0 && data.desc && isLimitMessage(data.desc)) {
                            log('XHR 检测到限制: ' + data.desc);
                            handleLimit();
                        }
                    } catch(e) {}
                }
                if (origOnReady) origOnReady.apply(this, arguments);
            };
        }
        return origXHRSend.apply(this, arguments);
    };

    // ==================== 5. 拦截页面跳转（阻止跳登录页）====================
    var origAssign = window.location.assign;
    var origReplace = window.location.replace;

    // 通过 $(window).attr('location', url) 方式的跳转拦截
    function hookLocationChange() {
        if (typeof $ === 'undefined') return;

        // 覆盖 jQuery 的 attr 方法中 location 相关的处理
        var origWindowAttr = $(window).attr;
        // 已通过 AJAX error 回调拦截，此处不额外处理
    }

    // ==================== 6. 清除所有标记 ====================
    function clearAllMarks() {
        try { localStorage.clear(); } catch(e) {}
        try { sessionStorage.clear(); } catch(e) {}
        var cookies = document.cookie.split(';');
        for (var i = 0; i < cookies.length; i++) {
            var name = cookies[i].split('=')[0].trim();
            document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
            document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.wdku.net;';
        }
        log('所有标记已清除');
    }

    // ==================== 7. 控制面板 ====================
    function addPanel() {
        if (document.getElementById('ocr-unlock-panel')) return;

        var style = document.createElement('style');
        style.textContent = '#ocr-unlock-panel button{cursor:pointer;border:none;padding:5px 10px;border-radius:4px;font-size:12px;color:#fff;margin:2px}#ocr-unlock-panel .btn-green{background:#4CAF50}#ocr-unlock-panel .btn-orange{background:#FF9800}#ocr-unlock-panel .btn-red{background:#f44336}#ocr-unlock-panel button:hover{opacity:0.85}';
        document.head.appendChild(style);

        var panel = document.createElement('div');
        panel.id = 'ocr-unlock-panel';
        panel.innerHTML =
            '<div style="position:fixed;bottom:20px;right:20px;z-index:99998;background:rgba(40,40,40,0.95);color:#fff;padding:14px 18px;border-radius:10px;font-size:12px;font-family:-apple-system,Arial,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.4);min-width:220px;">' +
            '<div style="font-weight:bold;margin-bottom:10px;font-size:14px;">🔓 OCR次数解锁 <span style="color:#4CAF50">v2.0</span></div>' +
            '<div style="margin-bottom:8px;color:#aaa;">重试: <span id="ocr-retry-count" style="color:#4CAF50;">0</span>/' + MAX_RETRY + '</div>' +
            '<button class="btn-green" onclick="window.__ocrRefresh()">🔄 换Session</button> ' +
            '<button class="btn-orange" onclick="window.__ocrClear()">🗑️ 清标记</button> ' +
            '<button class="btn-red" onclick="window.__ocrReset()">↺ 重置计数</button>' +
            '<div style="margin-top:10px;color:#888;font-size:11px;line-height:1.6;">自动拦截限制弹窗<br>检测到"每日上限3次"自动换Session<br>支持最多' + MAX_RETRY + '次自动重试</div>' +
            '</div>';
        document.body.appendChild(panel);
    }

    // 暴露全局方法
    window.__ocrRefresh = function() {
        retryCount = 0;
        handleLimit();
    };
    window.__ocrClear = function() {
        clearAllMarks();
        refreshSession(function(ok) {
            showTip(ok ? '✅ 清除成功，Session已刷新' : '❌ 清除失败', ok ? '#4CAF50' : '#f44336');
        });
    };
    window.__ocrReset = function() {
        retryCount = 0;
        document.getElementById('ocr-retry-count').textContent = '0';
        showTip('↺ 重试计数已归零', '#2196F3');
    };

    // ==================== 8. 更新重试计数显示 ====================
    var _origHandleLimit = handleLimit;
    // 覆盖 handleLimit 以更新面板
    handleLimit = function() {
        var el = document.getElementById('ocr-retry-count');
        if (el) el.textContent = retryCount + 1;
        _origHandleLimit();
        el = document.getElementById('ocr-retry-count');
        if (el) el.textContent = retryCount;
    };

    // ==================== 初始化 ====================
    function init() {
        log('脚本已启动 - 每日3次限制自动绕过');

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', addPanel);
        } else {
            addPanel();
        }

        showTip('🔓 OCR解锁 v2.0 已启动<br>自动绕过"每日提交上限3次"限制', '#4CAF50');
    }

    init();
})();
