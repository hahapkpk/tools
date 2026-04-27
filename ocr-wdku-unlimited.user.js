// ==UserScript==
// @name         OCR.wdku.net 次数限制解除
// @namespace    http://tampermonkey.net/
// @version      8.0
// @description  自动切换Tesseract.js本地OCR(无限制)+docx/txt/pdf输出;IP受限时自动接管
// @author       FlyWind
// @match        https://ocr.wdku.net/*
// @match        https://www.wdku.net/*
// @require      https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js
// @require      https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.min.js
// @grant        GM_xmlhttpRequest
// @connect      api.ocr.space
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    var LOG = '[OCR解锁 v8.0] ';
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

        var tessLang = 'chi_sim+eng';
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
            return result.data;
        } catch(e) {
            logMsg('Tesseract 错误: ' + e);
            throw e;
        }
    }

    // ==================== 3. DOCX 导出 ====================
    function exportToDocx(text, filename) {
        if (typeof docx === 'undefined') {
            logMsg('docx 库未加载，回退 txt 下载');
            downloadText(text, filename.replace('.docx', '.txt'));
            return;
        }

        try {
            var paragraphs = text.split('\n').map(function(line) {
                return new docx.Paragraph({
                    children: [new docx.TextRun({ text: line, font: 'Microsoft YaHei', size: 24 })]
                });
            });

            var doc = new docx.Document({
                sections: [{
                    properties: {},
                    children: paragraphs
                }]
            });

            docx.Packer.toBlob(doc).then(function(blob) {
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);
                showTip('✅ DOCX 已下载: ' + filename, '#4CAF50', 3000);
            });
        } catch(e) {
            logMsg('DOCX 导出失败: ' + e);
            downloadText(text, filename.replace('.docx', '.txt'));
        }
    }

    // ==================== 4. TXT 导出 ====================
    function downloadText(text, filename) {
        var blob = new Blob([text], {type: 'text/plain;charset=utf-8'});
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        showTip('✅ TXT 已下载: ' + filename, '#4CAF50', 3000);
    }

    // ==================== 5. PDF 导出（简化版，用浏览器打印） ====================
    function exportToPDF(text, filename) {
        var win = window.open('', '_blank');
        win.document.write('<html><head><title>' + escHtml(filename) + '</title>');
        win.document.write('<style>body{font-family:"Microsoft YaHei",Arial,sans-serif;font-size:14px;line-height:1.8;padding:40px;white-space:pre-wrap;}</style>');
        win.document.write('</head><body>' + escHtml(text) + '</body></html>');
        win.document.close();
        setTimeout(function() { win.print(); }, 500);
        showTip('✅ PDF 打印窗口已打开', '#4CAF50', 3000);
    }

    // ==================== 6. 显示 OCR 结果面板（增强版） ====================
    function showOCRResult(text, source, confidence) {
        var old = document.getElementById('ocr-result-panel');
        if (old) old.remove();
        var oldOv = document.getElementById('ocr-overlay');
        if (oldOv) oldOv.remove();

        var overlay = document.createElement('div');
        overlay.id = 'ocr-overlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:99999;';

        var panel = document.createElement('div');
        panel.id = 'ocr-result-panel';
        panel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100000;width:85%;max-width:800px;max-height:85vh;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.3);display:flex;flex-direction:column;font-family:-apple-system,Arial,sans-serif;';

        var confLabel = confidence ? (' · 置信度 ' + confidence.toFixed(1) + '%') : '';

        panel.innerHTML =
            '<div style="padding:16px 20px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;">' +
            '<div style="font-size:16px;font-weight:bold;color:#333;">📄 OCR识别结果 <span style="font-size:12px;color:#888;">(' + escHtml(source) + confLabel + ')</span></div>' +
            '<div style="display:flex;gap:6px;">' +
            '<button id="ocr-copy-btn" style="padding:6px 12px;border:none;border-radius:4px;background:#4CAF50;color:#fff;cursor:pointer;font-size:12px;">📋 复制</button>' +
            '<button id="ocr-txt-btn" style="padding:6px 12px;border:none;border-radius:4px;background:#2196F3;color:#fff;cursor:pointer;font-size:12px;">📝 TXT</button>' +
            '<button id="ocr-docx-btn" style="padding:6px 12px;border:none;border-radius:4px;background:#FF9800;color:#fff;cursor:pointer;font-size:12px;">📄 Word</button>' +
            '<button id="ocr-pdf-btn" style="padding:6px 12px;border:none;border-radius:4px;background:#9C27B0;color:#fff;cursor:pointer;font-size:12px;">📕 PDF</button>' +
            '<button id="ocr-close-btn" style="padding:6px 12px;border:none;border-radius:4px;background:#f44336;color:#fff;cursor:pointer;font-size:12px;">✕</button>' +
            '</div></div>' +
            '<div style="padding:20px;overflow-y:auto;flex:1;">' +
            '<pre id="ocr-result-text" style="white-space:pre-wrap;word-break:break-all;font-size:14px;line-height:1.8;color:#333;margin:0;">' + escHtml(text) + '</pre>' +
            '</div>';

        overlay.onclick = function() { panel.remove(); overlay.remove(); };
        document.body.appendChild(overlay);
        document.body.appendChild(panel);

        var textContent = text;
        var baseName = 'ocr_result_' + Date.now();

        document.getElementById('ocr-close-btn').onclick = function() { panel.remove(); overlay.remove(); };
        document.getElementById('ocr-copy-btn').onclick = function() {
            navigator.clipboard.writeText(textContent).then(function() { showTip('✅ 已复制', '#4CAF50', 2000); });
        };
        document.getElementById('ocr-txt-btn').onclick = function() { downloadText(textContent, baseName + '.txt'); };
        document.getElementById('ocr-docx-btn').onclick = function() { exportToDocx(textContent, baseName + '.docx'); };
        document.getElementById('ocr-pdf-btn').onclick = function() { exportToPDF(textContent, baseName + '.pdf'); };
    }

    // ==================== 7. 用 Tesseract.js 处理所有已上传文件 ====================
    async function processWithTesseract() {
        showTip('🔄 切换到 Tesseract.js 本地引擎...', '#FF9800', 15000);

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

        // 获取当前选择的语言
        var lang = 'chi_sim+eng';
        var langRadios = document.querySelectorAll('input[name="lang"]');
        var hasChinese = false, hasEnglish = false;
        langRadios.forEach(function(r) { if (r.checked) { if (r.value === '1') hasChinese = true; if (r.value === '2') hasEnglish = true; } });
        if (hasChinese && hasEnglish) lang = 'chi_sim+eng';
        else if (hasChinese) lang = 'chi_sim';
        else if (hasEnglish) lang = 'eng';

        // 获取选择的输出格式
        var saveformat = 'txt';
        var formatRadios = document.querySelectorAll('input[name="saveformat"]');
        formatRadios.forEach(function(r) { if (r.checked) saveformat = r.value; });

        var allText = [];
        var totalConf = 0;

        for (var i = 0; i < files.length; i++) {
            try {
                showTip('🔄 识别: ' + escHtml(files[i].name) + ' (' + (i+1) + '/' + files.length + ')', '#2196F3', 30000);
                var data = await tesseractOCR(files[i].file, lang === 'chi_sim+eng' ? '1,2' : (lang === 'chi_sim' ? '1' : '2'));
                allText.push('=== ' + files[i].name + ' ===\n' + data.text);
                totalConf += data.confidence;
            } catch(e) {
                allText.push('=== ' + files[i].name + ' ===\n[识别失败: ' + e.message + ']');
            }
        }

        var avgConf = files.length > 0 ? totalConf / files.length : 0;
        var fullText = allText.join('\n\n');

        showOCRResult(fullText, 'Tesseract.js 本地引擎', avgConf);

        // 根据选择的格式自动导出
        var baseName = 'ocr_result_' + Date.now();
        if (saveformat === 'docx' || saveformat === 'word') {
            exportToDocx(fullText, baseName + '.docx');
        } else if (saveformat === 'txt') {
            downloadText(fullText, baseName + '.txt');
        } else if (saveformat === 'pdf') {
            exportToPDF(fullText, baseName + '.pdf');
        }

        showTip('✅ Tesseract.js 识别完成！已按 ' + saveformat + ' 格式导出', '#4CAF50', 3000);
    }

    // ==================== 8. Hook request_load_base ====================
    function hookRequestLoadBase() {
        var timer = setInterval(function() {
            if (typeof jQuery === 'undefined' || typeof request_load_base === 'undefined') return;
            clearInterval(timer);

            var _origRequestLoadBase = window.request_load_base;

            window.request_load_base = function(url, post_data, callback_success, callback_error) {
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
                            if (label) { label.textContent = 'Tesseract.js (本地·无限)'; label.style.color = '#FF9800'; }

                            showTip('⚠️ IP限制已触发，自动切换Tesseract.js本地引擎', '#FF9800', 5000);

                            // 自动用 Tesseract 识别
                            processWithTesseract();
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

    // ==================== 9. Hook submit 修正 paytype ====================
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

    // ==================== 10. 控制面板 ====================
    function addPanel() {
        var checkPanel = setInterval(function() {
            if (!document.body) return;
            clearInterval(checkPanel);
            if (document.getElementById('ocr-unlock-panel')) return;

            var style = document.createElement('style');
            style.textContent = '#ocr-unlock-panel button{cursor:pointer;border:none;padding:6px 12px;border-radius:4px;font-size:12px;color:#fff;margin:2px}#ocr-unlock-panel .bg{background:#4CAF50}#ocr-unlock-panel .bo{background:#FF9800}#ocr-unlock-panel .br{background:#9C27B0}#ocr-unlock-panel .bd{background:#2196F3}#ocr-unlock-panel .bw{background:#FF9800}#ocr-unlock-panel button:hover{opacity:0.85}';
            document.head.appendChild(style);

            var panel = document.createElement('div');
            panel.id = 'ocr-unlock-panel';
            panel.innerHTML =
                '<div style="position:fixed;bottom:20px;right:20px;z-index:99998;background:rgba(40,40,40,0.95);color:#fff;padding:14px 18px;border-radius:10px;font-size:12px;font-family:-apple-system,Arial,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.4);min-width:320px;">' +
                '<div style="font-weight:bold;margin-bottom:10px;font-size:14px;">🔓 OCR次数解锁 <span style="color:#4CAF50">v8.0</span></div>' +
                '<div style="margin-bottom:8px;color:#aaa;">主引擎: <span id="ocr-engine-label" style="color:#4CAF50;">wdku (10次/日/IP)</span></div>' +
                '<div style="margin-bottom:8px;">' +
                '<button class="bo" onclick="window.__ocrTesseract()">🧠 Tesseract本地识别</button> ' +
                '<button class="bw" onclick="window.__ocrTesseractDocx()">📄 Tesseract→Word</button> ' +
                '</div>' +
                '<div style="margin-bottom:8px;">' +
                '<button class="br" onclick="window.__ocrReset()">↺ 重置状态</button> ' +
                '<span id="ocr-tess-status" style="font-size:11px;color:#888;">Tesseract: 检测中...</span>' +
                '</div>' +
                '<div style="margin-top:8px;color:#888;font-size:11px;line-height:1.6;">v8.0: paytype=free(10次) + Tesseract.js(无限)<br>✨ 新增: Word/PDF导出 | IP限制自动切换</div>' +
                '</div>';
            document.body.appendChild(panel);
        }, 500);
    }

    window.__ocrTesseract = function() { processWithTesseract(); };
    window.__ocrTesseractDocx = async function() {
        if (typeof uploader === 'undefined' || !uploader.list) {
            showTip('❌ 未检测到上传文件', '#f44336');
            return;
        }
        var files = [];
        for (var key in uploader.list) {
            if (uploader.list.hasOwnProperty(key)) {
                var t = uploader.list[key];
                if ((!t.is_delete || t.is_delete !== 1) && t.file) files.push(t);
            }
        }
        if (files.length === 0) { showTip('❌ 请先上传文件', '#f44336'); return; }

        var allText = [];
        for (var i = 0; i < files.length; i++) {
            try {
                showTip('🔄 识别: ' + escHtml(files[i].name), '#2196F3', 30000);
                var data = await tesseractOCR(files[i].file, '1,2');
                allText.push(data.text);
            } catch(e) {
                allText.push('[识别失败: ' + e.message + ']');
            }
        }
        var fullText = allText.join('\n\n');
        showOCRResult(fullText, 'Tesseract.js → Word', 0);
        exportToDocx(fullText, 'ocr_result_' + Date.now() + '.docx');
    };
    window.__ocrReset = function() {
        limitDetected = false;
        var label = document.getElementById('ocr-engine-label');
        if (label) { label.textContent = 'wdku (10次/日/IP)'; label.style.color = '#4CAF50'; }
        showTip('↺ 状态重置', '#9C27B0');
    };

    // ==================== 初始化 ====================
    hookRequestLoadBase();
    hookSubmit();
    addPanel();

    // 检查 Tesseract.js 和 docx 库加载
    var tessCheck = setInterval(function() {
        if (typeof Tesseract !== 'undefined') {
            clearInterval(tessCheck);
            tesseractReady = true;
            logMsg('Tesseract.js 已加载');
            var s = document.getElementById('ocr-tess-status');
            if (s) s.textContent = 'Tesseract: ✅ 就绪';
        }
    }, 1000);

    var docxCheck = setInterval(function() {
        if (typeof docx !== 'undefined') {
            clearInterval(docxCheck);
            logMsg('docx 库已加载');
            var s = document.getElementById('ocr-tess-status');
            if (s) s.textContent = 'Tesseract: ✅ 就绪 | Word: ✅ 就绪';
        }
    }, 1000);

    setTimeout(function() {
        if (!tesseractReady) {
            logMsg('⚠️ Tesseract.js 未加载');
            var s = document.getElementById('ocr-tess-status');
            if (s) { s.textContent = 'Tesseract: ❌ 未加载'; s.style.color = '#f44336'; }
        }
    }, 8000);

    setTimeout(function() {
        showTip('🔓 OCR解锁 v8.0 已启动<br>paytype=free(10次) + Tesseract.js本地引擎(无限)<br>✨ 支持 Word/PDF 导出', '#4CAF50', 5000);
    }, 1000);

    logMsg('脚本启动');

})();
