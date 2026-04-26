// ==UserScript==
// @name         OCR.wdku.net 次数限制解除
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  劫持submit，检测限制时换Session→重新上传→用新ID提交，同步jQuery确保和原站一致
// @author       FlyWind
// @match        https://ocr.wdku.net/*
// @match        https://www.wdku.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    var LOG = '[OCR解锁 v5.0] ';
    var MAX_RETRY = 20;
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

    // ==================== 2. 同步换 Session ====================
    function newSession() {
        document.cookie = 'PHPSESSID=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        document.cookie = 'PHPSESSID=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.wdku.net;';
        document.cookie = 'PHPSESSID=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=ocr.wdku.net;';

        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/?_rs=' + Date.now(), false);
        xhr.withCredentials = true;
        try { xhr.send(); } catch(e) {}

        var m = document.cookie.match(/PHPSESSID=([^;]+)/);
        logMsg('新Session: ' + (m ? m[1] : 'null'));
        return m ? m[1] : null;
    }

    // ==================== 3. 同步重新上传所有文件 ====================
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
                xhr.send(fd);

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
                    logMsg('上传失败: ' + (data.desc || 'unknown'));
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

    // ==================== 4. 同步 POST /index（用 jQuery 确保兼容）====================
    function syncSubmit(postData) {
        var result = null;
        var error = null;

        // 使用 jQuery 同步 ajax，确保参数编码和原站一致
        jQuery.ajax({
            type: 'POST',
            url: '/index',
            dataType: 'json',
            data: postData,
            async: false,  // 同步！
            success: function(data) {
                result = data;
            },
            error: function(xhr, status, err) {
                error = {desc: '网络请求异常: ' + status};
            }
        });

        if (error) return {errno: -1, desc: error.desc};
        return result;
    }

    // ==================== 5. 劫持 submit ====================
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

            // 构造参数
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

            logMsg('提交: ids=' + ids);

            // 显示"正在提交"
            if (typeof submit_set_process === 'function') submit_set_process('正在努力提交中....');

            // 同步提交
            var resp = syncSubmit(postData);

            if (resp.errno === 0) {
                // 成功！
                retryCount = 0;
                logMsg('提交成功！id=' + resp.id);

                if (typeof convid !== 'undefined') convid = resp.id;
                if (typeof convtime !== 'undefined') convtime = resp.time;

                // 调用 check 轮询结果
                if (typeof check === 'function') check(resp.id, resp.time);

                try { $('#uploader').removeClass('in'); $('#convparam').removeClass('in'); } catch(e) {}

                showTip('✅ 提交成功，正在转换中...', '#4CAF50', 5000);

            } else {
                // 失败
                var desc = resp.desc || '未知错误';
                logMsg('提交失败: ' + desc);

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

    // ==================== 6. 自动重试 ====================
    function doAutoRetry(origPostData, paytype) {
        if (retryCount >= MAX_RETRY) {
            showTip('❌ 已达最大重试次数(' + MAX_RETRY + ')', '#f44336');
            if (typeof submit_set_default === 'function') submit_set_default('已达最大重试次数');
            return;
        }

        retryCount++;
        updatePanel();
        showTip('🔄 第' + retryCount + '次绕过限制...<br><small>换Session → 重新上传 → 重新提交</small>', '#FF9800', 15000);

        // Step 1: 换 Session
        var sess = newSession();
        if (!sess) {
            if (typeof submit_set_default === 'function') submit_set_default('换Session失败');
            return;
        }

        // Step 2: 重新上传文件
        var uploadResult = reUploadFiles();
        if (!uploadResult.ok) {
            logMsg('重新上传失败: ' + (uploadResult.reason || 'unknown'));
            showTip('❌ 重新上传失败', '#f44336');
            if (typeof submit_set_default === 'function') submit_set_default('重新上传失败，请手动操作');
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

            if (typeof convid !== 'undefined') convid = resp.id;
            if (typeof convtime !== 'undefined') convtime = resp.time;
            if (typeof check === 'function') check(resp.id, resp.time);

            try { $('#uploader').removeClass('in'); $('#convparam').removeClass('in'); } catch(e) {}

            showTip('✅ 第' + retryCount + '次重试成功，正在转换中...', '#4CAF50', 5000);

        } else {
            var desc = resp.desc || '未知错误';
            logMsg('重试失败: ' + desc);

            if (isLimitMsg(desc) && retryCount < MAX_RETRY) {
                // 继续重试
                doAutoRetry(newPostData, paytype);
            } else {
                if (typeof submit_set_default === 'function') submit_set_default(desc);
                showTip('❌ 重试失败: ' + escHtml(desc), '#f44336');
            }
        }
    }

    // ==================== 7. 控制面板 ====================
    function addPanel() {
        if (document.getElementById('ocr-unlock-panel')) return;

        var style = document.createElement('style');
        style.textContent = '#ocr-unlock-panel button{cursor:pointer;border:none;padding:5px 10px;border-radius:4px;font-size:12px;color:#fff;margin:2px}#ocr-unlock-panel .bg{background:#4CAF50}#ocr-unlock-panel .bo{background:#FF9800}#ocr-unlock-panel .br{background:#9C27B0}#ocr-unlock-panel button:hover{opacity:0.85}';
        document.head.appendChild(style);

        var panel = document.createElement('div');
        panel.id = 'ocr-unlock-panel';
        panel.innerHTML =
            '<div style="position:fixed;bottom:20px;right:20px;z-index:99998;background:rgba(40,40,40,0.95);color:#fff;padding:14px 18px;border-radius:10px;font-size:12px;font-family:-apple-system,Arial,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.4);min-width:240px;">' +
            '<div style="font-weight:bold;margin-bottom:10px;font-size:14px;">🔓 OCR次数解锁 <span style="color:#4CAF50">v5.0</span></div>' +
            '<div style="margin-bottom:8px;color:#aaa;">已绕过: <span id="ocr-retry-count" style="color:#4CAF50;">0</span> 次</div>' +
            '<button class="bo" onclick="window.__ocrNewSess()">🔄 换Session</button> ' +
            '<button class="br" onclick="window.__ocrReset()">↺ 重置</button>' +
            '<div style="margin-top:10px;color:#888;font-size:11px;line-height:1.6;">换Session → 重新上传 → 用新ID提交<br>同步jQuery确保兼容 | 最多' + MAX_RETRY + '次</div>' +
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
    window.__ocrReset = function() {
        retryCount = 0;
        updatePanel();
        showTip('↺ 计数归零', '#9C27B0');
    };

    // ==================== 初始化 ====================
    hookSubmit();
    addPanel();
    showTip('🔓 OCR解锁 v5.0 已启动<br>自动换Session + 重新上传 + 用新ID提交', '#4CAF50', 5000);
    logMsg('脚本启动');

})();
