// ==UserScript==
// @name         OCR.wdku.net 次数限制解除
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  直接劫持submit，检测到限制时自动换Session+重新上传+直接POST后端跳过验证
// @author       FlyWind
// @match        https://ocr.wdku.net/*
// @match        https://www.wdku.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    var LOG = '[OCR解锁 v4.0] ';
    var MAX_RETRY = 20;    // 最大自动重试次数
    var retryCount = 0;

    function log(msg) { console.log(LOG + msg); }

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

    // 判断是否为限制消息
    function isLimitMsg(msg) {
        if (typeof msg !== 'string') return false;
        var kws = ['每日提交上限', '付费转换', '次数', '登录后', '今日', '已用完', '超出', 'VIP', '会员', '升级', '消费返还'];
        for (var i = 0; i < kws.length; i++) {
            if (msg.indexOf(kws[i]) !== -1) return true;
        }
        return false;
    }

    // ==================== 1. 同步换 Session ====================
    function newSession() {
        // 删旧 cookie
        document.cookie = 'PHPSESSID=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        document.cookie = 'PHPSESSID=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.wdku.net;';
        document.cookie = 'PHPSESSID=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=ocr.wdku.net;';

        // 同步请求获取新 session
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/?_rs=' + Date.now(), false);
        xhr.withCredentials = true;
        try { xhr.send(); } catch(e) {}

        var m = document.cookie.match(/PHPSESSID=([^;]+)/);
        var sess = m ? m[1] : null;
        log('新Session: ' + sess);
        return sess;
    }

    // ==================== 2. 同步重新上传所有文件 ====================
    function reUploadFiles() {
        if (typeof uploader === 'undefined' || !uploader.list) return false;

        var tasks = [];
        for (var key in uploader.list) {
            if (uploader.list.hasOwnProperty(key)) {
                var t = uploader.list[key];
                if ((!t.is_delete || t.is_delete !== 1) && t.file) {
                    tasks.push(t);
                }
            }
        }

        if (tasks.length === 0) {
            // 检查是否有扫码上传的文件
            if (typeof qrcode_ids !== 'undefined' && qrcode_ids && qrcode_ids.length > 0) {
                log('检测到扫码上传文件，保持 qrcode_ids: ' + qrcode_ids);
                return true; // 扫码上传的不需要重新上传
            }
            log('没有可重新上传的文件');
            return false;
        }

        log('重新上传 ' + tasks.length + ' 个文件...');

        // 重置计数
        try { count_upload_success = 0; count_total_pages = 0; } catch(e) {}

        var allOk = true;
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
                    try {
                        count_upload_success++;
                        count_total_pages += task.page;
                    } catch(e) {}
                    log('重新上传成功: ' + task.name + ' → ' + data.data.id);
                } else {
                    log('重新上传失败: ' + (data.desc || 'unknown'));
                    allOk = false;
                }
            } catch(e) {
                log('重新上传异常: ' + e);
                allOk = false;
            }
        }

        // 更新 UI
        try {
            $('#label_success_count').html(count_upload_success);
            $('#label_totalpage').html(count_total_pages);
        } catch(e) {}

        return allOk;
    }

    // ==================== 3. 直接 POST /index 提交（跳过前端验证）====================
    function directSubmit(postData, onSuccess, onFail) {
        var paramStr = '';
        for (var k in postData) {
            if (postData.hasOwnProperty(k)) {
                if (paramStr) paramStr += '&';
                paramStr += encodeURIComponent(k) + '=' + encodeURIComponent(postData[k]);
            }
        }

        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/index', false); // 同步
        xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
        try { xhr.send(paramStr); } catch(e) { onFail(e); return; }

        try {
            var data = JSON.parse(xhr.responseText);
            if (data.errno === 0) {
                onSuccess(data);
            } else {
                onFail(data);
            }
        } catch(e) {
            onFail({desc: '解析响应失败: ' + e});
        }
    }

    // ==================== 4. 劫持 submit 函数 ====================
    function hookSubmit() {
        if (typeof submit === 'undefined' || typeof get_param === 'undefined') {
            setTimeout(hookSubmit, 300);
            return;
        }

        var _origSubmit = window.submit;

        window.submit = function(paytype) {
            // 前端防重
            if (typeof is_submit !== 'undefined' && is_submit === 1) return false;

            // 检查文件
            if (typeof checkfiles === 'function' && !checkfiles()) {
                _origAlert('请先上传文档或等待文档上传完成');
                return false;
            }

            // 构造参数
            var param;
            try { param = get_param(); } catch(e) {
                log('get_param 异常: ' + e);
                return _origSubmit.call(window, paytype);
            }
            if (param === false) return false;

            var ids, ts;
            try {
                ids = glob_ids().join(',') || (typeof qrcode_ids !== 'undefined' ? qrcode_ids : '');
                ts = glob_ts().join(',') || (typeof qrcode_ts !== 'undefined' ? qrcode_ts : '');
            } catch(e) {
                log('glob_ids/ts 异常: ' + e);
                return _origSubmit.call(window, paytype);
            }

            var postData = Object.assign({
                ids: ids,
                ts: ts,
                paytype: paytype
            }, param);

            log('提交参数: ' + JSON.stringify(postData));

            // 显示"正在提交"状态
            if (typeof submit_set_process === 'function') submit_set_process('正在努力提交中....');

            // 同步 POST /index
            directSubmit(postData, function(data) {
                // 成功！
                retryCount = 0;
                log('提交成功！convid=' + data.id + ' convtime=' + data.time);

                if (typeof convid !== 'undefined') convid = data.id;
                if (typeof convtime !== 'undefined') convtime = data.time;

                // 调用 check 开始轮询结果
                if (typeof check === 'function') {
                    check(data.id, data.time);
                }

                try {
                    $('#uploader').removeClass('in');
                    $('#convparam').removeClass('in');
                } catch(e) {}

                showTip('✅ 提交成功，正在转换中...', '#4CAF50', 5000);

            }, function(err) {
                // 失败
                var desc = err.desc || '未知错误';
                log('提交失败: ' + desc);

                if (isLimitMsg(desc)) {
                    // 检测到限制 → 自动重试
                    if (retryCount < MAX_RETRY) {
                        retryCount++;
                        showTip('🔄 第' + retryCount + '次自动绕过限制...<br><small>' + escHtml(desc) + '</small>', '#FF9800', 8000);
                        doAutoRetry(postData, paytype);
                    } else {
                        showTip('❌ 已达最大重试次数(' + MAX_RETRY + ')', '#f44336');
                        if (typeof submit_set_default === 'function') submit_set_default(desc);
                    }
                } else {
                    // 非限制错误，恢复状态
                    if (typeof submit_set_default === 'function') submit_set_default(desc);
                    showTip('❌ 提交失败: ' + escHtml(desc), '#f44336');
                }
            });
        };

        log('submit 函数已劫持');
    }

    // ==================== 5. 自动重试：换Session → 重新上传 → 直接提交 ====================
    function doAutoRetry(origPostData, paytype) {
        // Step 1: 换 Session
        var sess = newSession();
        if (!sess) {
            showTip('❌ 换Session失败', '#f44336');
            if (typeof submit_set_default === 'function') submit_set_default('换Session失败');
            return;
        }

        // Step 2: 重新上传文件
        var uploadOk = reUploadFiles();
        if (!uploadOk) {
            showTip('⚠️ 文件重新上传失败，尝试用原始参数提交...', '#FF9800');
            // 即使重新上传失败，也尝试用原参数提交（可能新session本身就是新用户）
        }

        // Step 3: 重新构造提交参数（用新上传的文件 ID）
        var newIds, newTs;
        try {
            newIds = glob_ids().join(',') || (typeof qrcode_ids !== 'undefined' ? qrcode_ids : '');
            newTs = glob_ts().join(',') || (typeof qrcode_ts !== 'undefined' ? qrcode_ts : '');
        } catch(e) {
            newIds = origPostData.ids;
            newTs = origPostData.ts;
        }

        var newPostData = Object.assign({}, origPostData, {
            ids: newIds,
            ts: newTs
        });

        log('重试提交参数: ids=' + newIds + ' ts=' + newTs);

        // Step 4: 同步 POST /index
        directSubmit(newPostData, function(data) {
            retryCount = 0;
            log('重试提交成功！convid=' + data.id);

            if (typeof convid !== 'undefined') convid = data.id;
            if (typeof convtime !== 'undefined') convtime = data.time;

            if (typeof check === 'function') check(data.id, data.time);

            try {
                $('#uploader').removeClass('in');
                $('#convparam').removeClass('in');
            } catch(e) {}

            showTip('✅ 第' + retryCount + '次重试成功，正在转换中...', '#4CAF50', 5000);

        }, function(err) {
            var desc = err.desc || '未知错误';
            log('重试提交失败: ' + desc);

            if (isLimitMsg(desc) && retryCount < MAX_RETRY) {
                // 继续重试
                retryCount++;
                showTip('🔄 第' + retryCount + '次重试...', '#FF9800', 8000);
                doAutoRetry(newPostData, paytype);
            } else {
                if (typeof submit_set_default === 'function') submit_set_default(desc);
                showTip('❌ 重试失败: ' + escHtml(desc), '#f44336');
            }
        });
    }

    function escHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ==================== 6. 拦截 alert 弹窗 ====================
    var _origAlert = window.alert;
    window.alert = function(m) {
        if (typeof m === 'string' && isLimitMsg(m)) {
            log('拦截弹窗: ' + m);
            return; // 静默吞掉
        }
        return _origAlert.call(window, m);
    };

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
            '<div style="font-weight:bold;margin-bottom:10px;font-size:14px;">🔓 OCR次数解锁 <span style="color:#4CAF50">v4.0</span></div>' +
            '<div style="margin-bottom:8px;color:#aaa;">已绕过: <span id="ocr-retry-count" style="color:#4CAF50;">0</span> 次</div>' +
            '<button class="bo" onclick="window.__ocrNewSess()">🔄 换Session</button> ' +
            '<button class="br" onclick="window.__ocrReset()">↺ 重置计数</button>' +
            '<div style="margin-top:10px;color:#888;font-size:11px;line-height:1.6;">直接劫持submit → 同步POST后端<br>检测限制 → 换Session → 重新上传 → 重提交<br>全程自动，最多' + MAX_RETRY + '次</div>' +
            '</div>';
        document.body.appendChild(panel);
    }

    window.__ocrNewSess = function() {
        var s = newSession();
        showTip(s ? '✅ 新Session: ' + s.substring(0,8) + '...' : '❌ 换Session失败', s ? '#4CAF50' : '#f44336');
    };
    window.__ocrReset = function() {
        retryCount = 0;
        var el = document.getElementById('ocr-retry-count');
        if (el) el.textContent = '0';
        showTip('↺ 计数已归零', '#9C27B0');
    };

    // 更新面板计数
    var _origDoAutoRetry = doAutoRetry;
    doAutoRetry = function(origPostData, paytype) {
        var el = document.getElementById('ocr-retry-count');
        if (el) el.textContent = retryCount;
        _origDoAutoRetry(origPostData, paytype);
    };

    // ==================== 初始化 ====================
    hookSubmit();
    addPanel();
    showTip('🔓 OCR解锁 v4.0 已启动<br>直接劫持submit，自动绕过次数限制', '#4CAF50', 5000);
    log('脚本已启动 - 劫持submit + 同步后端提交');

})();
