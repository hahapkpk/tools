// ==UserScript==
// @name         OCR.wdku.net 次数限制解除
// @namespace    http://tampermonkey.net/
// @version      7.1
// @description  paytype=free(10次/日) + IP限制时自动切换Tesseract.js本地OCR(无限制)
// @author       FlyWind
// @match        https://ocr.wdku.net/*
// @match        https://www.wdku.net/*
// @require      https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js
// @grant        GM_xmlhttpRequest
// @connect      api.ocr.space
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    var LOG = '[OCR解锁 v7.1] ';
    var _origAlert = window.alert;
    var limitDetected = false;
    var tesseractReady = false;

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
        var kws = ['每日提交上限', '付费转换', '今日', '已用完', '超出'];
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

    // ==================== 2. Tesseract.js 本地 OCR ====================
    async function tesseractOCR(file, lang) {
        logMsg('Tesseract.js 开始识别: ' + file.name);

        // lang 映射：网站用数字(1=中文,2=英文)，Tesseract 用 eng/chi_sim
        var tessLang = 'chi_sim+eng';  // 默认中英文
        if (lang === '1') tessLang = 'chi_sim';
        else if (lang === '2') tessLang = 'eng';

        try {
            var result = await Tesseract.recognize(file, tessLang, {
                logger: function(m) {
                    if (m.status === 'recognizing text') {
                        var pct = Math.round((m.progress || 0) * 100);
                        showTip('🔍 Tesseract 识别中... ' + pct + '%', '#2196F3', 30000);
                    }
                }
            });
            return result.data.text;
        } catch(e) {
            logMsg('Tesseract 错误: ' + e);
            throw e;
        }
    }

    // ==================== 3. OCR.space 备用 API ====================
    function ocrSpaceRecognize(file, lang) {
        return new Promise(function(resolve, reject) {
            var fd = new FormData();
            fd.append('file', file);
            fd.append('language', lang === '1' ? 'chs' : (lang === '2' ? 'eng' : 'chs'));
            fd.append('isOverlayRequired', 'false');
            fd.append('OCREngine', '2');

            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: 'https://api.ocr.space/parse/image',
                    data: fd,
                    responseType: 'json',
                    onload: function(resp) {
                        try {
                            var data = typeof resp.response === 'string' ? JSON.parse(resp.response) : resp.response;
                            if (data.ParsedResults && data.ParsedResults.length > 0) {
                                resolve(data.ParsedResults.map(function(r) { return r.ParsedText || ''; }).join('\n\n'));
                            } else {
                                reject(new Error('OCR.space 无结果: ' + (data.ErrorMessage || 'unknown')));
                            }
                        } catch(e) {
                            reject(new Error('OCR.space 解析失败: ' + e));
                        }
                    },
                    onerror: function(err) { reject(new Error('OCR.space 请求失败')); }
                });
            } else {
                reject(new Error('GM_xmlhttpRequest 不可用'));
            }
        });
    }

    // ==================== 4. 显示 OCR 结果面板 ====================
    function showOCRResult(text, source) {
        var old = document.getElementById('ocr-result-panel');
        if (old) old.remove();
        var oldOv = document.getElementById('ocr-overlay');
        if (oldOv) oldOv.remove();

        var overlay = document.createElement('div');
        overlay.id = 'ocr-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:99999;';

        var panel = document.createElement('div');
        panel.id = 'ocr-result-panel';
        panel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100000;width:85%;max-width:750px;max-height:80vh;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.3);display:flex;flex-direction:column;font-family:-apple-system,Arial,sans-serif;';

        panel.innerHTML =
            '<div style="padding:16px 20px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;">' +
            '<div style="font-size:16px;font-weight:bold;color:#333;">📄 OCR识别结果 <span style="font-size:12px;color:#888;">(' + escHtml(source) + ')</span></div>' +
            '<div>' +
            '<button id="ocr-copy-btn" style="padding:6px 14px;border:none;border-radius:4px;background:#4CAF50;color:#fff;cursor:pointer;font-size:13px;margin-right:6px;">📋 复制</button>' +
            '<button id="ocr-dl-btn" style="padding:6px 14px;border:none;border-radius:4px;background:#2196F3;color:#fff;cursor:pointer;font-size:13px;margin-right:6px;">💾 下载TXT</button>' +
            '<button id="ocr-close-btn" style="padding:6px 14px;border:none;border-radius:4px;background:#f44336;color:#fff;cursor:pointer;font-size:13px;">✕ 关闭</button>' +
            '</div></div>' +
            '<div style="padding:20px;overflow-y:auto;flex:1;">' +
            '<pre id="ocr-result-text" style="white-space:pre-wrap;word-break:break-all;font-size:14px;line-height:1.8;color:#333;margin:0;">' + escHtml(text) + '</pre>' +
            '</div>';

        overlay.onclick = function() { panel.remove(); overlay.remove(); };
        document.body.appendChild(overlay);
        document.body.appendChild(panel);

        document.getElementById('ocr-close-btn').onclick = function() {
            panel.remove(); overlay.remove();
        };

        document.getElementById('ocr-copy-btn').onclick = function() {
            var textEl = document.getElementById('ocr-result-text');
            navigator.clipboard.writeText(textEl.textContent).then(function() {
                showTip('✅ 已复制到剪贴板', '#4CAF50', 2000);
            });
        };

        document.getElementById('ocr-dl-btn').onclick = function() {
            var textEl = document.getElementById('ocr-result-text');
            var blob = new Blob([textEl.textContent], {type: 'text/plain;charset=utf-8'});
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'ocr_result_' + Date.now() + '.txt';
            a.click();
            URL.revokeObjectURL(url);
            showTip('✅ 已下载', '#4CAF50', 2000);
        };
    }

    // ==================== 5. 用备用引擎处理所有已上传文件 ====================
    async function processWithBackupEngine(engine) {
        showTip('🔄 切换到' + (engine === 'tesseract' ? 'Tesseract.js 本地引擎' : 'OCR.space 云端引擎') + '...', '#FF9800', 15000);

        if (typeof uploader === 'undefined' || !uploader.list) {
            showTip('❌ 未检测到上传文件', '#f44336');
            return;
        }

        var files = [];
        for (var key in uploader.list) {
            if (uploader.list.hasOwnProperty(key)) {
                var t = uploader.list[key];
                if ((!t.is_delete || t.is_delete !== 1) && t.file) {
                    files.push(t);
                }
            }
        }

        if (files.length === 0) {
            showTip('❌ 没有可识别的文件，请先上传', '#f44336');
            return;
        }

        var allText = [];
        var sourceName = engine === 'tesseract' ? 'Tesseract.js 本地引擎' : 'OCR.space 云端引擎';

        for (var i = 0; i < files.length; i++) {
            try {
                showTip('🔄 识别: ' + escHtml(files[i].name) + ' (' + (i+1) + '/' + files.length + ')', '#2196F3', 30000);

                var text;
                if (engine === 'tesseract') {
                    text = await tesseractOCR(files[i].file);
                } else {
                    text = await ocrSpaceRecognize(files[i].file);
                }

                allText.push('=== ' + files[i].name + ' ===\n' + text);
            } catch(e) {
                allText.push('=== ' + files[i].name + ' ===\n[识别失败: ' + e.message + ']');
            }
        }

        showOCRResult(allText.join('\n\n'), sourceName);
        showTip('✅ ' + sourceName + '识别完成！', '#4CAF50', 3000);
    }

    // ==================== 6. Hook request_load_base ====================
    function hookRequestLoadBase() {
        var timer = setInterval(function() {
            if (typeof jQuery === 'undefined' || typeof request_load_base === 'undefined') return;
            clearInterval(timer);

            var _origRequestLoadBase = window.request_load_base;

            window.request_load_base = function(url, post_data, callback_success, callback_error) {
                // 修正 paytype 参数
                if (url === '/index' && post_data) {
                    if (post_data.paytype === '0' || !post_data.paytype) {
                        post_data.paytype = 'free';
                        logMsg('修正 paytype: → free');
                    }

                    var origError = callback_error || '';

                    callback_error = function(data) {
                        if (data && data.desc && isLimitMsg(data.desc)) {
                            logMsg('IP限制: ' + data.desc);
                            limitDetected = true;

                            var label = document.getElementById('ocr-engine-label');
                            if (label) { label.textContent = 'Tesseract.js (本地)'; label.style.color = '#FF9800'; }

                            showTip('⚠️ 本站已达IP限制，自动切换Tesseract.js本地引擎', '#FF9800', 5000);
                            processWithBackupEngine('tesseract');
                            return;
                        }
                        if (typeof origError === 'function') {
                            origError(data);
                        } else {
                            _origAlert(data.desc);
                        }
                    };
                }

                return _origRequestLoadBase.call(window, url, post_data, callback_success, callback_error);
            };

            logMsg('request_load_base 已 Hook');
        }, 200);
    }

    // ==================== 7. Hook submit 修正 paytype ====================
    function hookSubmit() {
        var timer = setInterval(function() {
            if (typeof submit === 'undefined' || typeof get_param === 'undefined') return;
            clearInterval(timer);

            var _origSubmit = window.submit;

            window.submit = function(paytype) {
                logMsg('submit 被调用, paytype=' + paytype + ' → free');
                return _origSubmit.call(window, 'free');
            };

            logMsg('submit 已 Hook (paytype → free)');
        }, 200);
    }

    // ==================== 8. 控制面板 ====================
    function addPanel() {
        var checkPanel = setInterval(function() {
            if (!document.body) return;
            clearInterval(checkPanel);
            if (document.getElementById('ocr-unlock-panel')) return;

            var style = document.createElement('style');
            style.textContent = '#ocr-unlock-panel button{cursor:pointer;border:none;padding:5px 10px;border-radius:4px;font-size:12px;color:#fff;margin:2px}#ocr-unlock-panel .bg{background:#4CAF50}#ocr-unlock-panel .bo{background:#FF9800}#ocr-unlock-panel .br{background:#9C27B0}#ocr-unlock-panel .bd{background:#2196F3}#ocr-unlock-panel button:hover{opacity:0.85}';
            document.head.appendChild(style);

            var panel = document.createElement('div');
            panel.id = 'ocr-unlock-panel';
            panel.innerHTML =
                '<div style="position:fixed;bottom:20px;right:20px;z-index:99998;background:rgba(40,40,40,0.95);color:#fff;padding:14px 18px;border-radius:10px;font-size:12px;font-family:-apple-system,Arial,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.4);min-width:300px;">' +
                '<div style="font-weight:bold;margin-bottom:10px;font-size:14px;">🔓 OCR次数解锁 <span style="color:#4CAF50">v7.1</span></div>' +
                '<div style="margin-bottom:8px;color:#aaa;">主引擎: <span id="ocr-engine-label" style="color:#4CAF50;">wdku (10次/日/IP)</span></div>' +
                '<div style="margin-bottom:8px;">' +
                '<button class="bo" onclick="window.__ocrTesseract()">🧠 Tesseract本地识别</button> ' +
                '<button class="bd" onclick="window.__ocrOcrSpace()">☁️ OCR.space云端</button> ' +
                '<button class="br" onclick="window.__ocrReset()">↺</button>' +
                '</div>' +
                '<div style="margin-top:8px;color:#888;font-size:11px;line-height:1.6;">v7.1: paytype=free(10次) + 本地Tesseract.js(无限)<br>IP限制时自动切本地引擎 | 无需联网</div>' +
                '</div>';
            document.body.appendChild(panel);
        }, 500);
    }

    window.__ocrTesseract = function() {
        processWithBackupEngine('tesseract');
    };

    window.__ocrOcrSpace = function() {
        processWithBackupEngine('ocrspace');
    };

    window.__ocrReset = function() {
        limitDetected = false;
        showTip('↺ 状态重置', '#9C27B0');
    };

    // ==================== 初始化 ====================
    hookRequestLoadBase();
    hookSubmit();
    addPanel();

    // 检查 Tesseract.js 是否加载成功
    var tessCheck = setInterval(function() {
        if (typeof Tesseract !== 'undefined') {
            clearInterval(tessCheck);
            tesseractReady = true;
            logMsg('Tesseract.js 已加载');
        }
    }, 1000);

    // 5 秒后如果还没加载就警告
    setTimeout(function() {
        if (!tesseractReady) {
            logMsg('⚠️ Tesseract.js 未加载，本地OCR不可用');
        }
    }, 5000);

    setTimeout(function() {
        showTip('🔓 OCR解锁 v7.1 已启动<br>paytype=free(10次) + Tesseract.js本地引擎(无限)', '#4CAF50', 5000);
    }, 1000);

    logMsg('脚本启动');

})();
