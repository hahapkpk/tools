// ==UserScript==
// @name         OCR.wdku.net 次数限制解除
// @namespace    http://tampermonkey.net/
// @version      6.0
// @description  清除所有Cookie变匿名→换Session→重新上传→用新ID提交，增加诊断和IP限制检测
// @author       FlyWind
// @match        https://ocr.wdku.net/*
// @match        https://www.wdku.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    var LOG = '[OCR解锁 v6.0] ';
    var MAX_RETRY = 10;
    var RETRY_DELAY = 800;  // 重试间隔 ms
    var retryCount = 0;
    var _origAlert = window.alert;

    function logMsg(msg) { console.log(LOG + msg); }

    function escHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ==================== 提示气泡 ====================
    function showTip(msg, color, ms) {
        var el = document.getElementById('ocr-unlock-tip');
        if (!el) {
            el = document.createElement('div');
            el.id = 'ocr-unlock-tip';
            el.style.cssText = 'position:fixed;top:10px;right:10px;z-index:99999;padding:12px 18px;border-radius:8px;color:#fff;font-size:13px;font-family:-apple-system,Arial,sans-serif;max-width:460px;line-height:1.6;box-shadow:0 2px 12px rgba(0,0,0,0.3);transition:opacity 0.5s;pointer-events:none;';
            document.body.appendChild(el);
        }
        el.innerHTML = msg;
        el.style.backgroundColor = color || '#2196F3';
        el.style.opacity = '1';
        clearTimeout(el._t);
        el._t = setTimeout(function() { el.style.opacity = '0'; }, ms || 4000);
    }

    function isLimitMsg(msg) {
        if (typeof msg !== 'string') return false;
        var kws = ['每日提交上限', '付费转换', '次数', '登录后', '今日', '已用完', '超出', 'VIP', '会员', '升级', '消费返还'];
        for (var i = 0; i < kws.length; i++) {
            if (msg.indexOf(kws[i]) !== -1) return true;
        }
        return false;
    }

    // ==================== 1. 拦截 alert ====================
    window.alert = function(m) {
        if (typeof m === 'string' && isLimitMsg(m)) {
            logMsg('拦截弹窗: ' + m);
            return;
        }
        return _origAlert.call(window, m);
    };

    // ==================== 2. 清除所有 Cookie ====================
    function clearAllCookies() {
        var cookies = document.cookie.split(';');
        var cleared = [];
        for (var i = 0; i < cookies.length; i++) {
            var name = cookies[i].split('=')[0].trim();
            if (!name) continue;
            // 尝试多个 path 和 domain 组合
            var domains = ['', '; domain=.wdku.net', '; domain=ocr.wdku.net', '; domain=www.wdku.net'];
            var paths = ['; path=/', ''];
            for (var d = 0; d < domains.length; d++) {
                for (var p = 0; p < paths.length; p++) {
                    document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC' + paths[p] + domains[d] + ';';
                }
            }
            cleared.push(name);
        }
        logMsg('已清除所有Cookies: [' + cleared.join(', ') + ']');
        logMsg('清除后Cookie: "' + document.cookie + '"');
    }

    // ==================== 3. 清除本地存储 ====================
    function clearAllStorage() {
        try { localStorage.clear(); logMsg('localStorage 已清除'); } catch(e) {}
        try { sessionStorage.clear(); logMsg('sessionStorage 已清除'); } catch(e) {}
    }

    // ==================== 4. 换 Session（完全匿名）====================
    function newSession() {
        // Step 1: 清除所有追踪信息
        clearAllCookies();
        clearAllStorage();

        // Step 2: 请求新 Session
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/?_rs=' + Date.now(), false);
        xhr.withCredentials = true;
        try { xhr.send(); } catch(e) { logMsg('获取新Session异常: ' + e); }

        // Step 3: 验证新 Session
        var m = document.cookie.match(/PHPSESSID=([^;]+)/);
        var newSess = m ? m[1] : null;
        logMsg('新Session: ' + (newSess ? newSess.substring(0, 12) + '...' : 'null'));
        logMsg('当前Cookies: ' + document.cookie);

        // Step 4: 检查是否还是登录状态
        var isLogin = typeof is_login !== 'undefined' ? is_login : 'unknown';
        logMsg('is_login 状态: ' + isLogin);

        return newSess;
    }

    // ==================== 5. 同步重新上传所有文件 ====================
    function reUploadFiles() {
        if (typeof uploader === 'undefined' || !uploader.list) return {ok: false, reason: 'no_uploader'};

        var tasks = [];
        for (var key in uploader.list) {
            if (uploader.list.hasOwnProperty(key)) {
                var t = uploader.list[key];
                if ((!t.is_delete || t.is_delete !== 1) && t.file) {
                    tasks.push(t);
                }
            }
        }

        // 扫码上传的情况
        if (tasks.length === 0 && typeof qrcode_ids !== 'undefined' && qrcode_ids && qrcode_ids.length > 0) {
            return {ok: true, ids: qrcode_ids, ts: qrcode_ts};
        }

        if (tasks.length === 0) return {ok: false, reason: 'no_files'};

        logMsg('重新上传 ' + tasks.length + ' 个文件...');
        showTip('🔄 重新上传 ' + tasks.length + ' 个文件中...', '#FF9800', 15000);

        try { count_upload_success = 0; count_total_pages = 0; } catch(e) {}

        var allOk = true;
        var newIds = [];
        var newTs = [];

        for (var i = 0; i < tasks.length; i++) {
            var task = tasks[i];
            try {
                var fd = new FormData();
                fd.append('user', 'default');
                fd.append('name', task.name + '_' + Date.now());
                fd.append('from', 'reupload');
                fd.append('file', task.file);

                var xhr = new XMLHttpRequest();
                xhr.open('POST', '/upload?convtype=ocr', false);
                xhr.withCredentials = true;
                xhr.send(fd);

                logMsg('上传响应: ' + xhr.responseText.substring(0, 200));
                var data = JSON.parse(xhr.responseText);
                if (data.errno === 0 && data.data && data.data.id) {
                    task.uploadid = data.data.id;
                    task.uploadtime = data.data.time;
                    task.page = parseInt(data.data.page) || 1;
                    newIds.push(data.data.id);
                    newTs.push(data.data.time);
                    try { count_upload_success++; count_total_pages += task.page; } catch(e) {}
                    logMsg('上传成功: ' + task.name + ' → ' + data.data.id);
                } else {
                    logMsg('上传失败: ' + (data.desc || data.errmsg || JSON.stringify(data)));
                    allOk = false;
                }
            } catch(e) {
                logMsg('上传异常: ' + e);
                allOk = false;
            }
        }

        try {
            $('#label_success_count').html(count_upload_success);
            $('#label_totalpage').html(count_total_pages);
        } catch(e) {}

        return {ok: allOk, ids: newIds.join(','), ts: newTs.join(',')};
    }

    // ==================== 6. 同步 POST /index（用 jQuery 确保兼容）====================
    function syncSubmit(postData) {
        var result = null;
        var error = null;

        logMsg('提交参数: ' + JSON.stringify(postData));

        jQuery.ajax({
            type: 'POST',
            url: '/index',
            dataType: 'json',
            data: postData,
            async: false,
            success: function(data) {
                result = data;
                logMsg('提交响应: ' + JSON.stringify(data).substring(0, 300));
            },
            error: function(xhr, status, err) {
                error = {desc: '网络请求异常: ' + status};
                logMsg('提交异常: ' + status + ' ' + err);
            }
        });

        if (error) return {errno: -1, desc: error.desc};
        return result;
    }

    // ==================== 7. 劫持 submit ====================
    function hookSubmit() {
        if (typeof submit === 'undefined' || typeof get_param === 'undefined') {
            setTimeout(hookSubmit, 300);
            return;
        }

        var _origSubmit = window.submit;

        window.submit = function(paytype) {
            if (typeof is_submit !== 'undefined' && is_submit === 1) return false;
            if (typeof checkfiles === 'function' && !checkfiles()) {
                _origAlert('请先上传文档或等待文档上传完成');
                return false;
            }

            var param;
            try { param = get_param(); } catch(e) {
                logMsg('get_param异常，回退原函数');
                return _origSubmit.call(window, paytype);
            }
            if (param === false) return false;

            var ids, ts;
            try {
                ids = glob_ids().join(',') || (typeof qrcode_ids !== 'undefined' ? qrcode_ids : '');
                ts = glob_ts().join(',') || (typeof qrcode_ts !== 'undefined' ? qrcode_ts : '');
            } catch(e) {
                return _origSubmit.call(window, paytype);
            }

            var postData = Object.assign({
                ids: ids,
                ts: ts,
                paytype: paytype
            }, param);

            logMsg('首次提交: ids=' + ids);

            if (typeof submit_set_process === 'function') submit_set_process('正在努力提交中....');

            var resp = syncSubmit(postData);

            if (resp.errno === 0) {
                retryCount = 0;
                logMsg('提交成功！id=' + resp.id);
                handleSuccess(resp);
            } else {
                var desc = resp.desc || '未知错误';
                logMsg('提交失败: ' + desc);
                logMsg('完整响应: ' + JSON.stringify(resp));

                if (isLimitMsg(desc)) {
                    doAutoRetry(postData, paytype);
                } else {
                    if (typeof submit_set_default === 'function') submit_set_default(desc);
                    showTip('❌ ' + escHtml(desc), '#f44336');
                }
            }
        };

        logMsg('submit 已劫持');
    }

    // ==================== 8. 处理成功 ====================
    function handleSuccess(resp) {
        if (typeof convid !== 'undefined') convid = resp.id;
        if (typeof convtime !== 'undefined') convtime = resp.time;
        if (typeof check === 'function') check(resp.id, resp.time);
        try { $('#uploader').removeClass('in'); $('#convparam').removeClass('in'); } catch(e) {}
        showTip('✅ 提交成功，正在转换中...', '#4CAF50', 5000);
    }

    // ==================== 9. 自动重试（带延迟）====================
    function doAutoRetry(origPostData, paytype) {
        if (retryCount >= MAX_RETRY) {
            showTip('❌ 已达最大重试次数(' + MAX_RETRY + ')<br><small>可能被IP限制，建议：<br>1. 刷新页面重试<br>2. 更换网络/使用VPN<br>3. 稍后再试</small>', '#f44336', 15000);
            if (typeof submit_set_default === 'function') submit_set_default('已达最大重试次数，可能被IP限制');
            return;
        }

        retryCount++;
        updatePanel();
        showTip('🔄 第' + retryCount + '/' + MAX_RETRY + '次绕过限制...<br><small>清Cookie → 换Session → 重新上传 → 提交</small>', '#FF9800', 15000);

        // 延迟执行，避免快速连续请求
        setTimeout(function() {
            // Step 1: 换 Session（会清除所有Cookie和Storage）
            var sess = newSession();
            if (!sess) {
                showTip('❌ 换Session失败', '#f44336');
                if (typeof submit_set_default === 'function') submit_set_default('换Session失败');
                return;
            }

            // Step 2: 重新上传文件
            var uploadResult = reUploadFiles();
            if (!uploadResult.ok) {
                logMsg('重新上传失败: ' + (uploadResult.reason || 'unknown'));
                showTip('❌ 重新上传失败: ' + escHtml(uploadResult.reason || ''), '#f44336');
                if (typeof submit_set_default === 'function') submit_set_default('重新上传失败');
                return;
            }

            // Step 3: 用新的 ids 和 ts 重新构造提交参数
            var newPostData = Object.assign({}, origPostData);
            if (uploadResult.ids) newPostData.ids = uploadResult.ids;
            if (uploadResult.ts) newPostData.ts = uploadResult.ts;

            logMsg('重试提交: ids=' + newPostData.ids + ' ts=' + newPostData.ts);

            // Step 4: 同步提交
            var resp = syncSubmit(newPostData);

            if (resp.errno === 0) {
                retryCount = 0;
                logMsg('重试成功！id=' + resp.id);
                handleSuccess(resp);
                showTip('✅ 第' + retryCount + '次重试成功，正在转换中...', '#4CAF50', 5000);
            } else {
                var desc = resp.desc || '未知错误';
                logMsg('重试失败(' + retryCount + '/' + MAX_RETRY + '): ' + desc);
                logMsg('完整响应: ' + JSON.stringify(resp));

                if (isLimitMsg(desc) && retryCount < MAX_RETRY) {
                    // 继续重试（递归，但带延迟）
                    doAutoRetry(newPostData, paytype);
                } else {
                    if (typeof submit_set_default === 'function') submit_set_default(desc);
                    showTip('❌ 重试失败: ' + escHtml(desc) + '<br><small>如持续失败可能被IP限制，建议更换网络或稍后再试</small>', '#f44336', 10000);
                }
            }
        }, RETRY_DELAY);
    }

    // ==================== 10. 控制面板 ====================
    function addPanel() {
        if (document.getElementById('ocr-unlock-panel')) return;

        var style = document.createElement('style');
        style.textContent = '#ocr-unlock-panel button{cursor:pointer;border:none;padding:5px 10px;border-radius:4px;font-size:12px;color:#fff;margin:2px}#ocr-unlock-panel .bg{background:#4CAF50}#ocr-unlock-panel .bo{background:#FF9800}#ocr-unlock-panel .br{background:#9C27B0}#ocr-unlock-panel .bd{background:#2196F3}#ocr-unlock-panel button:hover{opacity:0.85}';
        document.head.appendChild(style);

        var panel = document.createElement('div');
        panel.id = 'ocr-unlock-panel';
        panel.innerHTML =
            '<div style="position:fixed;bottom:20px;right:20px;z-index:99998;background:rgba(40,40,40,0.95);color:#fff;padding:14px 18px;border-radius:10px;font-size:12px;font-family:-apple-system,Arial,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.4);min-width:260px;">' +
            '<div style="font-weight:bold;margin-bottom:10px;font-size:14px;">🔓 OCR次数解锁 <span style="color:#4CAF50">v6.0</span></div>' +
            '<div style="margin-bottom:8px;color:#aaa;">已绕过: <span id="ocr-retry-count" style="color:#4CAF50;">0</span> 次 | 重试上限: ' + MAX_RETRY + '</div>' +
            '<div style="margin-bottom:8px;">' +
            '<button class="bo" onclick="window.__ocrNewSess()">🔄 换Session</button> ' +
            '<button class="bd" onclick="window.__ocrDiag()">🔍 诊断</button> ' +
            '<button class="br" onclick="window.__ocrReset()">↺ 重置</button>' +
            '</div>' +
            '<div id="ocr-diag-info" style="display:none;margin-top:8px;padding:8px;background:rgba(0,0,0,0.3);border-radius:4px;font-size:11px;color:#ccc;max-height:150px;overflow-y:auto;word-break:break-all;"></div>' +
            '<div style="margin-top:8px;color:#888;font-size:11px;line-height:1.6;">v6.0: 清除全部Cookie变匿名 + 延迟重试<br>如持续失败可能被IP限制，需换网络</div>' +
            '</div>';
        document.body.appendChild(panel);
    }

    function updatePanel() {
        var el = document.getElementById('ocr-retry-count');
        if (el) el.textContent = retryCount;
    }

    window.__ocrNewSess = function() {
        var s = newSession();
        showTip(s ? '✅ 新Session: ' + s.substring(0,8) + '...' : '❌ 失败', s ? '#4CAF50' : '#f44336');
    };

    window.__ocrDiag = function() {
        var info = document.getElementById('ocr-diag-info');
        if (!info) return;
        var visible = info.style.display !== 'none';
        if (visible) {
            info.style.display = 'none';
            return;
        }

        var html = '<b>=== 诊断信息 ===</b><br>';
        html += 'Cookies: ' + escHtml(document.cookie || '(空)') + '<br>';
        html += 'is_login: ' + (typeof is_login !== 'undefined' ? is_login : 'undefined') + '<br>';
        html += 'retryCount: ' + retryCount + '<br>';

        // 检查 PHPSESSID
        var pm = document.cookie.match(/PHPSESSID=([^;]+)/);
        html += 'PHPSESSID: ' + (pm ? pm[1].substring(0,12) + '...' : '无') + '<br>';

        // 检查是否有登录相关Cookie
        var loginCookies = document.cookie.split(';').filter(function(c) {
            var n = c.split('=')[0].trim().toLowerCase();
            return n.indexOf('user') !== -1 || n.indexOf('login') !== -1 || n.indexOf('token') !== -1 || n.indexOf('auth') !== -1;
        });
        html += '登录相关Cookie: ' + (loginCookies.length > 0 ? escHtml(loginCookies.join('; ')) : '(无)') + '<br>';

        // 检查 uploader 状态
        var fileCount = 0;
        if (typeof uploader !== 'undefined' && uploader.list) {
            for (var k in uploader.list) {
                if (uploader.list.hasOwnProperty(k) && (!uploader.list[k].is_delete || uploader.list[k].is_delete !== 1)) {
                    fileCount++;
                }
            }
        }
        html += '待上传文件数: ' + fileCount + '<br>';

        // localStorage
        try {
            var lsKeys = Object.keys(localStorage);
            html += 'localStorage项: ' + lsKeys.length + (lsKeys.length > 0 ? ' [' + lsKeys.join(',') + ']' : '') + '<br>';
        } catch(e) { html += 'localStorage: 无法访问<br>'; }

        info.innerHTML = html;
        info.style.display = 'block';
    };

    window.__ocrReset = function() {
        retryCount = 0;
        updatePanel();
        showTip('↺ 计数归零', '#9C27B0');
    };

    // ==================== 初始化 ====================
    hookSubmit();
    addPanel();
    showTip('🔓 OCR解锁 v6.0 已启动<br>清除全部Cookie变匿名 + 延迟重试 | 点🔍诊断', '#4CAF50', 5000);
    logMsg('脚本启动');

})();
