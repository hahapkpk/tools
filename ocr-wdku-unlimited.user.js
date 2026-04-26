// ==UserScript==
// @name         OCR.wdku.net 次数限制解除
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  解除 ocr.wdku.net 免费转换每日3次限制 - 自动换Session + 自动重新上传 + 自动重新提交
// @author       FlyWind
// @match        https://ocr.wdku.net/*
// @match        https://www.wdku.net/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    var LOG = '[OCR解锁 v3.0] ';
    var MAX_RETRY = 10;
    var retryCount = 0;
    var isAutoRetrying = false; // 标记正在自动重试中，防止循环

    function log(msg) { console.log(LOG + msg); }

    // ==================== 提示气泡 ====================
    function showTip(message, color, duration) {
        var tip = document.getElementById('ocr-unlock-tip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'ocr-unlock-tip';
            tip.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;padding:12px 18px;border-radius:8px;color:#fff;font-size:13px;font-family:-apple-system,Arial,sans-serif;max-width:440px;transition:opacity 0.5s;pointer-events:none;line-height:1.6;box-shadow:0 2px 12px rgba(0,0,0,0.3);';
            document.body.appendChild(tip);
        }
        tip.innerHTML = message;
        tip.style.backgroundColor = color || '#2196F3';
        tip.style.opacity = '1';
        clearTimeout(tip._timer);
        tip._timer = setTimeout(function() { tip.style.opacity = '0'; }, duration || 4000);
    }

    function escHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ==================== 1. 拦截 alert ====================
    var _origAlert = window.alert;
    window.alert = function(m) {
        if (typeof m === 'string' && isLimitMsg(m)) {
            log('拦截弹窗: ' + m);
            // 不显示弹窗，直接触发自动重试
            return;
        }
        return _origAlert.call(window, m);
    };

    function isLimitMsg(msg) {
        var kws = ['每日提交上限', '次数', '付费转换', '登录后', '今日', '已用完', '超出', 'VIP', '会员', '升级', '消费返还'];
        for (var i = 0; i < kws.length; i++) {
            if (msg.indexOf(kws[i]) !== -1) return true;
        }
        return false;
    }

    // ==================== 2. 换 Session（同步方式确保立即生效）====================
    function refreshSession(callback) {
        log('正在换新 Session...');

        // 删除旧 PHPSESSID
        document.cookie = 'PHPSESSID=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        document.cookie = 'PHPSESSID=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.wdku.net;';
        document.cookie = 'PHPSESSID=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=ocr.wdku.net;';

        // 同步请求获取新 session（确保 cookie 立即可用）
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/?_rs=' + Date.now(), false); // 同步
            xhr.withCredentials = true;
            xhr.send();
        } catch(e) {
            log('同步请求失败，尝试异步: ' + e);
            // 降级为异步
            var xhr2 = new XMLHttpRequest();
            xhr2.open('GET', '/?_rs=' + Date.now(), true);
            xhr2.withCredentials = true;
            xhr2.onreadystatechange = function() {
                if (xhr2.readyState === 4) {
                    var m = document.cookie.match(/PHPSESSID=([^;]+)/);
                    log('异步新 Session: ' + (m ? m[1] : 'null'));
                    if (callback) callback(!!(m && m[1]));
                }
            };
            xhr2.send();
            return;
        }

        var m = document.cookie.match(/PHPSESSID=([^;]+)/);
        var newSess = m ? m[1] : null;
        log('新 Session: ' + newSess);
        if (callback) callback(!!newSess);
    }

    // ==================== 3. 重新上传所有文件（同步逐个上传）====================
    function reUploadAllFiles(callback) {
        if (typeof uploader === 'undefined' || !uploader.list) {
            log('uploader 不可用');
            callback(false, 'no_uploader');
            return;
        }

        // 收集需要重新上传的 task
        var tasks = [];
        for (var key in uploader.list) {
            if (uploader.list.hasOwnProperty(key)) {
                var task = uploader.list[key];
                if ((!task.is_delete || task.is_delete !== 1) && task.file) {
                    tasks.push(task);
                }
            }
        }

        if (tasks.length === 0) {
            log('没有可重新上传的文件');
            callback(false, 'no_files');
            return;
        }

        log('开始重新上传 ' + tasks.length + ' 个文件...');
        showTip('🔄 正在重新上传 ' + tasks.length + ' 个文件到新Session...', '#FF9800', 15000);

        // 重置上传计数
        try { count_upload_success = 0; count_total_pages = 0; } catch(e) {}

        var allSuccess = true;
        var uploadUrl = '/upload?convtype=ocr';

        // 逐个同步上传，确保顺序正确
        for (var i = 0; i < tasks.length; i++) {
            var task = tasks[i];
            try {
                var formData = new FormData();
                formData.append('user', 'default');
                formData.append('name', task.name + '_' + Date.now());
                formData.append('from', 'reupload');
                formData.append('file', task.file);

                var xhr = new XMLHttpRequest();
                xhr.open('POST', uploadUrl, false); // 同步上传
                xhr.send(formData);

                var data = JSON.parse(xhr.responseText);
                if (data.errno === 0 && data.data && data.data.id) {
                    task.uploadid = data.data.id;
                    task.uploadtime = data.data.time;
                    task.page = parseInt(data.data.page) || 1;
                    try {
                        count_upload_success++;
                        count_total_pages += task.page;
                    } catch(e) {}
                    log('文件重新上传成功: ' + task.name + ' -> ' + data.data.id);

                    // 更新 UI
                    try {
                        var fileEl = document.getElementById('file_' + task.id);
                        if (fileEl) {
                            fileEl.querySelector('.file-status').textContent = '上传成功';
                            fileEl.querySelector('.file-status').className = 'label label-success file-status';
                            fileEl.querySelector('.file-page').textContent = task.page + '页';
                        }
                    } catch(e) {}
                } else {
                    log('文件上传失败: ' + (data.desc || 'unknown'));
                    allSuccess = false;
                }
            } catch(e) {
                log('文件上传异常: ' + e);
                allSuccess = false;
            }
        }

        // 更新 UI 计数
        try {
            $('#label_success_count').html(count_upload_success);
            $('#label_totalpage').html(count_total_pages);
        } catch(e) {}

        log('所有文件重新上传完成, 成功: ' + (allSuccess ? '是' : '否'));
        callback(allSuccess);
    }

    // ==================== 4. 自动重试：换Session → 重新上传 → 自动提交 ====================
    function autoRetry() {
        if (isAutoRetrying) {
            log('正在自动重试中，跳过');
            return;
        }
        if (retryCount >= MAX_RETRY) {
            showTip('❌ 已达最大重试次数(' + MAX_RETRY + ')，请稍后再试', '#f44336');
            resetSubmitState('已达最大重试次数');
            return;
        }

        isAutoRetrying = true;
        retryCount++;
        updateRetryDisplay();

        showTip('🔄 第' + retryCount + '次自动重试<br>① 换Session中...', '#FF9800', 15000);

        // Step 1: 换 Session
        refreshSession(function(sessionOk) {
            if (!sessionOk) {
                showTip('❌ 换Session失败', '#f44336');
                isAutoRetrying = false;
                resetSubmitState('换Session失败');
                return;
            }

            showTip('🔄 第' + retryCount + '次自动重试<br>② 重新上传文件中...', '#FF9800', 15000);

            // Step 2: 重新上传所有文件
            reUploadAllFiles(function(uploadOk, reason) {
                if (!uploadOk) {
                    if (reason === 'no_files') {
                        showTip('⚠️ 无法自动重新上传（可能为扫码上传）<br>请手动重新上传文件后提交', '#FF9800');
                    } else {
                        showTip('❌ 文件重新上传失败，请手动重新上传', '#f44336');
                    }
                    isAutoRetrying = false;
                    resetSubmitState('重新上传失败，请手动操作');
                    return;
                }

                showTip('🔄 第' + retryCount + '次自动重试<br>③ 自动提交中...', '#2196F3', 15000);

                // Step 3: 自动提交
                setTimeout(function() {
                    isAutoRetrying = false; // 允许下次重试
                    log('自动调用 submit(free)');
                    try {
                        submit('free');
                    } catch(e) {
                        log('自动提交失败: ' + e);
                        showTip('❌ 自动提交出错: ' + e, '#f44336');
                        resetSubmitState('自动提交出错');
                    }
                }, 500); // 稍等一下确保 UI 更新完成
            });
        });
    }

    // ==================== 5. 重置提交状态 ====================
    function resetSubmitState(msg) {
        try { if (typeof is_submit !== 'undefined') is_submit = 0; } catch(e) {}
        try {
            if (typeof $ === 'function') {
                $('#btn_submit1').removeClass('disabled');
                $('#btn_submit2').removeClass('disabled');
            }
        } catch(e) {}
        try {
            if (typeof submit_set_default === 'function') {
                submit_set_default(msg || '请重新上传文件并提交转换');
            }
        } catch(e) {}
    }

    // ==================== 6. 拦截 jQuery AJAX ====================
    function hookJQuery() {
        if (typeof jQuery === 'undefined' || !jQuery.ajax) {
            setTimeout(hookJQuery, 200);
            return;
        }

        var origAjax = jQuery.ajax;
        jQuery.ajax = function(opts) {
            var url = opts.url || '';

            // 只拦截 /index 提交接口
            if (url.indexOf('/index') !== -1) {
                var origSuccess = opts.success;
                var origError = opts.error;

                opts.success = function(data) {
                    // 检测到限制
                    if (typeof data === 'object' && data.errno > 0 && data.desc && isLimitMsg(data.desc)) {
                        log('AJAX 检测到限制: ' + data.desc);

                        // 如果是自动重试中仍然被限制，继续重试
                        if (retryCount < MAX_RETRY) {
                            autoRetry();
                        } else {
                            showTip('❌ 已达最大重试次数', '#f44336');
                            resetSubmitState(data.desc);
                        }
                        return; // 不调用原始 success
                    }

                    // 正常响应，重置重试计数
                    if (typeof data === 'object' && data.errno === 0) {
                        retryCount = 0;
                        updateRetryDisplay();
                        log('提交成功，重试计数归零');
                    }

                    if (origSuccess) return origSuccess.apply(this, arguments);
                };

                opts.error = function() {
                    log('AJAX error，重置状态');
                    resetSubmitState('');
                    if (origError) return origError.apply(this, arguments);
                };
            }

            return origAjax.apply(this, arguments);
        };
        log('jQuery AJAX 拦截已启动');
    }
    hookJQuery();

    // ==================== 7. 控制面板 ====================
    function addPanel() {
        if (document.getElementById('ocr-unlock-panel')) return;

        var style = document.createElement('style');
        style.textContent = '#ocr-unlock-panel button{cursor:pointer;border:none;padding:5px 10px;border-radius:4px;font-size:12px;color:#fff;margin:2px}#ocr-unlock-panel .bg{background:#4CAF50}#ocr-unlock-panel .bo{background:#FF9800}#ocr-unlock-panel .br{background:#f44336}#ocr-unlock-panel button:hover{opacity:0.85}';
        document.head.appendChild(style);

        var panel = document.createElement('div');
        panel.id = 'ocr-unlock-panel';
        panel.innerHTML =
            '<div style="position:fixed;bottom:20px;right:20px;z-index:99998;background:rgba(40,40,40,0.95);color:#fff;padding:14px 18px;border-radius:10px;font-size:12px;font-family:-apple-system,Arial,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.4);min-width:240px;">' +
            '<div style="font-weight:bold;margin-bottom:10px;font-size:14px;">🔓 OCR次数解锁 <span style="color:#4CAF50">v3.0</span></div>' +
            '<div style="margin-bottom:8px;color:#aaa;">自动重试: <span id="ocr-retry-count" style="color:#4CAF50;">0</span>/' + MAX_RETRY + '</div>' +
            '<button class="bo" onclick="window.__ocrRetry()">🔄 手动重试</button> ' +
            '<button class="bg" onclick="window.__ocrReset()">↺ 重置计数</button>' +
            '<div style="margin-top:10px;color:#888;font-size:11px;line-height:1.6;">自动换Session → 重新上传 → 自动提交<br>无需手动操作</div>' +
            '</div>';
        document.body.appendChild(panel);
    }

    function updateRetryDisplay() {
        var el = document.getElementById('ocr-retry-count');
        if (el) el.textContent = retryCount;
    }

    window.__ocrRetry = function() {
        retryCount = 0;
        autoRetry();
    };
    window.__ocrReset = function() {
        retryCount = 0;
        updateRetryDisplay();
        showTip('↺ 重试计数已归零', '#2196F3');
    };

    // ==================== 初始化 ====================
    function init() {
        log('脚本已启动 - 自动换Session+重新上传+自动提交');

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', addPanel);
        } else {
            addPanel();
        }

        showTip('🔓 OCR解锁 v3.0 已启动<br>用完3次后自动换Session重试，无需手动操作', '#4CAF50', 5000);
    }

    init();
})();
