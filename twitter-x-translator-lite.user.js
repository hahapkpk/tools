// ==UserScript==
// @name         my Twitter X Translator Lite
// @namespace    http://tampermonkey.net/
// @version      20.4
// @description  Support Twitter/X and Discord real-time translation, user notes and VIP marking, with customizable translation font size and color, one-click local backup and restore.
// @author       fl
// @license      MIT
// @match        https://twitter.com/*
// @match        https://x.com/*
// @match        https://pro.twitter.com/*
// @match        https://pro.x.com/*
// @match        https://discord.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=twitter.com
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @connect      translate.googleapis.com
// @connect      api.deepseek.com
// ==/UserScript==

(function() {
    'use strict';

    console.log("🚀 启动...");

    // ================= 1. 配置与存储 =================
    const DEFAULT_UI = {
        transColor: '#00E676',
        transFontSize: '14px',
        noteColor: '#1D9BF0',
        noteFontSize: '11px',
        vipColor: '#F3BA2F',
        translator: 'google',
        fallbackTranslator: 'deepseek',
        deepseekApiBase: 'https://api.deepseek.com',
        deepseekModel: 'deepseek-v4-flash',
        deepseekApiKey: '',
        transStyle: 'classic',
        deepseekLayout: 'plain'
    };

    const THEME_PRESETS = {
        twitter: {
            name: 'Twitter风格',
            transColor: '#1d9bf0',
            bgColor: '#192734',
            textColor: '#e7e9ea'
        },
        blue: {
            name: '柔和蓝调',
            transColor: '#4a9eff',
            bgColor: '#1a1f2e',
            textColor: '#a8d5ff'
        },
        warm: {
            name: '暖色调',
            transColor: '#ff9f43',
            bgColor: '#1e1a16',
            textColor: '#ffd89b'
        },
        purple: {
            name: '紫罗兰',
            transColor: '#9b59b6',
            bgColor: '#1a1625',
            textColor: '#d4b5e8'
        },
        cyan: {
            name: '青色系',
            transColor: '#26c6da',
            bgColor: '#0d1b1e',
            textColor: '#b2ebf2'
        },
        gray: {
            name: '经典灰白',
            transColor: '#8e8e93',
            bgColor: '#1c1c1e',
            textColor: '#e5e5ea'
        }
    };

    const INITIAL_VIP_MAP = {};
    const TRANSLATION_STYLES = {
        classic: '默认醒目',
        native: '贴近原文',
        subtle: '轻量提示',
        compact: '紧凑模式'
    };
    const DEEPSEEK_LAYOUTS = {
        plain: '普通译文',
        sentence: '逐句分段',
        readable: '易读段落',
        highlights: '重点标记'
    };

    const safeParse = (raw, fallback) => {
        try {
            return JSON.parse(raw);
        } catch (err) {
            console.warn('[LingGe] Stored data is invalid, falling back to defaults:', err);
            return fallback;
        }
    };

    const sanitizeColor = (value, fallback) => /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : fallback;
    const sanitizeFontSize = (value, fallback) => /^(?:1[0-9]|2[0-9]|30)px$/.test(value || '') ? value : fallback;
    const sanitizeChoice = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
    const sanitizeEndpoint = (value, fallback) => {
        try {
            const url = new URL(value || fallback);
            if (url.protocol !== 'https:') return fallback;
            return url.origin + url.pathname.replace(/\/$/, '');
        } catch (err) {
            return fallback;
        }
    };
    const escapeAttr = (value) => String(value || '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[ch]);

    const normalizeConfig = (cfg = {}) => {
        const merged = { ...DEFAULT_UI, ...cfg };
        return {
            ...merged,
            transColor: sanitizeColor(merged.transColor, DEFAULT_UI.transColor),
            transBgColor: sanitizeColor(merged.transBgColor, '#0b0b0b'),
            transTextColor: sanitizeColor(merged.transTextColor, merged.transColor || DEFAULT_UI.transColor),
            transFontSize: sanitizeFontSize(merged.transFontSize, DEFAULT_UI.transFontSize),
            noteColor: sanitizeColor(merged.noteColor, DEFAULT_UI.noteColor),
            noteFontSize: sanitizeFontSize(merged.noteFontSize, DEFAULT_UI.noteFontSize),
            vipColor: sanitizeColor(merged.vipColor, DEFAULT_UI.vipColor),
            translator: sanitizeChoice(merged.translator, ['google', 'deepseek'], DEFAULT_UI.translator),
            fallbackTranslator: sanitizeChoice(merged.fallbackTranslator, ['none', 'google', 'deepseek'], DEFAULT_UI.fallbackTranslator),
            deepseekApiBase: sanitizeEndpoint(merged.deepseekApiBase, DEFAULT_UI.deepseekApiBase),
            deepseekModel: String(merged.deepseekModel || DEFAULT_UI.deepseekModel).trim() || DEFAULT_UI.deepseekModel,
            deepseekApiKey: String(merged.deepseekApiKey || '').trim(),
            transStyle: sanitizeChoice(merged.transStyle, Object.keys(TRANSLATION_STYLES), DEFAULT_UI.transStyle),
            deepseekLayout: sanitizeChoice(merged.deepseekLayout, Object.keys(DEEPSEEK_LAYOUTS), DEFAULT_UI.deepseekLayout)
        };
    };

    function extractTwitterHandle(href) {
        try {
            const url = new URL(href, location.origin);
            const handle = url.pathname.split('/').filter(Boolean)[0];
            if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null;
            return handle.toLowerCase();
        } catch (err) {
            return null;
        }
    }

    const Storage = {
        getConfig: () => normalizeConfig(safeParse(GM_getValue('ling_config', '{}'), {})),
        setConfig: (cfg) => {
            GM_setValue('ling_config', JSON.stringify(normalizeConfig(cfg)));
            updateStyles();
        },
        getNotes: () => safeParse(GM_getValue('ling_user_notes', '{}'), {}),
        setNotes: (notes) => GM_setValue('ling_user_notes', JSON.stringify(notes)),
        addNote: (handle, note) => {
            const notes = Storage.getNotes();
            const h = handle.toLowerCase();
            if (note && note.trim()) notes[h] = note.trim();
            else delete notes[h];
            Storage.setNotes(notes);
        },
        getNote: (handle) => Storage.getNotes()[handle.toLowerCase()] || null,
        getVips: () => {
            let vips = safeParse(GM_getValue('ling_vips', 'null'), null);
            if (!vips) {
                vips = JSON.parse(JSON.stringify(INITIAL_VIP_MAP));
                GM_setValue('ling_vips', JSON.stringify(vips));
                return vips;
            }
            let isDirty = false;
            for (const [handle, info] of Object.entries(INITIAL_VIP_MAP)) {
                if (!vips[handle.toLowerCase()]) {
                    vips[handle.toLowerCase()] = info;
                    isDirty = true;
                }
            }
            if (isDirty) GM_setValue('ling_vips', JSON.stringify(vips));
            return vips;
        },
        setVips: (vips) => GM_setValue('ling_vips', JSON.stringify(vips)),
        getVipInfo: (handle) => Storage.getVips()[handle.toLowerCase()] || null,
        addVip: (handle, label) => {
            const vips = Storage.getVips();
            vips[handle.toLowerCase()] = [label, '#F3BA2F', '#000'];
            Storage.setVips(vips);
        },
        removeVip: (handle) => {
            const vips = Storage.getVips();
            delete vips[handle.toLowerCase()];
            Storage.setVips(vips);
        },
        export: () => {
            const config = { ...Storage.getConfig(), deepseekApiKey: '' };
            const data = { ver: "20.4", ts: new Date().getTime(), notes: Storage.getNotes(), vips: Storage.getVips(), config };
            const blob = new Blob([JSON.stringify(data)], {type: 'text/plain'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url;
            a.download = `LingGe_Config_${new Date().toISOString().slice(0,10)}.txt`;
            a.click();
            URL.revokeObjectURL(url);
        },
        import: () => {
            const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,.txt';
            input.onchange = (e) => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    try {
                        const raw = safeParse(ev.target.result, null);
                        if (!raw || typeof raw !== 'object') throw new Error('Invalid backup file');
                        if(raw.notes) Storage.setNotes(raw.notes);
                        if(raw.vips) Storage.setVips(raw.vips);
                        if(raw.config) Storage.setConfig(raw.config);
                        alert("✅ 配置已恢复！"); location.reload();
                    } catch (err) { alert('❌ 文件格式错误'); }
                };
                reader.readAsText(e.target.files[0]);
            };
            input.click();
        }
    };

    // ================= 2. 动态样式系统 =================
    function updateStyles() {
        const cfg = Storage.getConfig();
        const oldStyle = document.getElementById('ling-style'); if (oldStyle) oldStyle.remove();

        const css = `
            .ling-trans-box { margin-top: 6px; padding: 8px 10px; background: ${cfg.transBgColor || '#0b0b0b'}; border-left: 3px solid ${cfg.transColor}; border-radius: 4px; color: ${cfg.transTextColor || cfg.transColor}; font-size: ${cfg.transFontSize}; line-height: 1.5; font-family: "Consolas", monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
            .ling-trans-box.native { padding: 2px 0 0 0; background: transparent; border-left: 0; border-radius: 0; color: ${cfg.transTextColor || '#8b98a5'}; font-size: inherit; line-height: inherit; font-family: inherit; opacity: 0.92; }
            .ling-trans-box.native::before { content: "译文"; display: inline-block; margin-right: 6px; color: ${cfg.transColor}; font-size: 11px; font-weight: 700; }
            .ling-trans-box.subtle { padding: 6px 0 0 10px; background: transparent; border-left: 2px solid ${cfg.transColor}; border-radius: 0; color: ${cfg.transTextColor || '#8b98a5'}; font-family: inherit; opacity: 0.9; }
            .ling-trans-box.compact { display: inline-block; margin-top: 4px; padding: 3px 6px; background: rgba(29,155,240,0.08); border-left: 0; border-radius: 4px; color: ${cfg.transTextColor || cfg.transColor}; font-size: 13px; line-height: 1.35; font-family: inherit; }
            .ling-discord-box { margin-top: 4px; padding: 4px 8px; opacity: 0.9; background: rgba(0,0,0,0.5); border-left: 2px solid ${cfg.transColor}; }
            .ling-discord-box.native, .ling-discord-box.subtle { background: transparent; }
            .ling-vip-tweet { border: 2px solid ${cfg.vipColor} !important; background: rgba(243, 186, 47, 0.05) !important; border-radius: 8px !important; }
            .ling-identity-badge { font-weight: 900; font-size: 10px; padding: 2px 5px; border-radius: 3px; margin-left: 5px; vertical-align: middle; display: inline-block; box-shadow: 0 1px 2px rgba(0,0,0,0.5); color: #000; background: ${cfg.vipColor}; }
            .ling-user-note { background-color: ${cfg.noteColor}; color: #fff; font-size: ${cfg.noteFontSize}; padding: 2px 6px; border-radius: 4px; margin-left: 5px; vertical-align: middle; display: inline-block; cursor: pointer; max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: bold; }
            .ling-action-btn { cursor: pointer; margin-left: 6px; font-size: 14px; vertical-align: middle; display: inline-block; opacity: 0.4; transition: 0.2s; filter: grayscale(100%); }
            .ling-action-btn:hover { opacity: 1; filter: grayscale(0%); transform: scale(1.2); }
            .ling-action-btn.active { opacity: 1; filter: grayscale(0%); text-shadow: 0 0 8px gold; }
            .ling-dashboard { position: fixed; top: 15%; right: 20px; background: #111; border: 1px solid ${cfg.vipColor}; border-radius: 12px; padding: 15px; z-index: 2147483647; box-shadow: 0 10px 30px rgba(0,0,0,0.8); min-width: 220px; display: none; }
            .ling-dashboard.active { display: block; animation: ling-fade 0.2s; }
            @keyframes ling-fade { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
            .ling-dash-link { display: flex; align-items: center; color: #fff; text-decoration: none; padding: 10px; background: #222; margin-bottom: 8px; border-radius: 6px; font-size: 13px; transition: 0.2s; font-weight: bold; }
            .ling-dash-link:hover { background: #333; color: ${cfg.vipColor}; transform: translateX(5px); }
            .ling-dash-btn-row { display: flex; justify-content: space-between; gap: 5px; margin-top: 5px; }
            .ling-mini-btn { flex: 1; background: #333; border: 1px solid #444; color: #ccc; padding: 5px; border-radius: 4px; font-size: 11px; cursor: pointer; text-align: center; }
            .ling-mini-btn:hover { background: #444; color: #fff; }
            #ling-settings-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 2147483647; display: flex; justify-content: center; align-items: center; }
            #ling-settings-box { background: #16181c; border: 1px solid #333; border-radius: 12px; padding: 20px; width: 300px; max-height: 88vh; overflow: auto; color: #fff; font-family: sans-serif; }
            .ling-row { margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; }
            .ling-row input, .ling-row select { background: #222; border: 1px solid #444; color: #fff; padding: 3px; border-radius: 4px; }
            .ling-btn { background: #00E676; color: #000; border: none; padding: 8px; border-radius: 5px; width: 100%; font-weight: bold; cursor: pointer; margin-top: 10px; }
            .ling-theme-btn { padding: 10px; border-radius: 8px; cursor: pointer; transition: all 0.2s; text-align: center; }
            .ling-theme-btn:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.5); opacity: 0.9; }
        `;

        const node = document.createElement('style'); node.id = 'ling-style'; node.innerHTML = css; document.head.appendChild(node);
    }

    // ================= 3. 核心功能: 翻译 =================
    function gmRequest(options) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                timeout: 15000,
                ...options,
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) resolve(res);
                    else reject(new Error(`HTTP ${res.status}`));
                },
                onerror: () => reject(new Error('Network error')),
                ontimeout: () => reject(new Error('Request timeout'))
            });
        });
    }

    async function translateWithGoogle(text) {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(text.slice(0, 4500))}`;
        const res = await gmRequest({ method: "GET", url });
        const data = JSON.parse(res.responseText);
        let transResult = "";
        if (data && data[0]) data[0].forEach(i => { if(i[0]) transResult += i[0]; });
        return transResult.trim();
    }

    async function translateWithDeepSeek(text, cfg) {
        if (!cfg.deepseekApiKey) throw new Error('DeepSeek API Key is empty');
        const base = cfg.deepseekApiBase.replace(/\/$/, '');
        const apiUrl = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
        const layoutPrompts = {
            plain: "输出自然、准确的简体中文译文。保留原文换行、语气、链接和 @用户名。只输出译文，不要解释。",
            sentence: "输出自然、准确的简体中文译文。按原文语义逐句分段：短文保持紧凑，长文每 1-2 句空一行；保留列表符号、编号、链接和 @用户名。只输出译文，不要解释。",
            readable: "输出适合快速阅读的简体中文译文。保留原意和语气，把长句拆成清楚段落；原文有列表时保留列表；不要添加原文没有的新观点。只输出译文，不要解释。",
            highlights: "输出简体中文译文，并在适合时用 Markdown 做轻量重点标记：重要句子可用 **加粗**，列表保留为短要点。不要添加总结标题，除非原文本身有标题。只输出译文，不要解释。"
        };
        const layoutPrompt = layoutPrompts[cfg.deepseekLayout] || layoutPrompts.plain;
        const res = await gmRequest({
            method: "POST",
            url: apiUrl,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${cfg.deepseekApiKey}`
            },
            data: JSON.stringify({
                model: cfg.deepseekModel,
                temperature: 0.2,
                messages: [
                    {
                        role: "system",
                        content: `你是专业翻译引擎。${layoutPrompt}`
                    },
                    { role: "user", content: text.slice(0, 6000) }
                ]
            })
        });
        const data = JSON.parse(res.responseText);
        return (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').trim();
    }

    async function translateText(text) {
        const cfg = Storage.getConfig();
        const providers = [cfg.translator];
        if (cfg.fallbackTranslator !== 'none' && cfg.fallbackTranslator !== cfg.translator) {
            providers.push(cfg.fallbackTranslator);
        }

        let lastError = null;
        for (const provider of providers) {
            try {
                if (provider === 'deepseek') return await translateWithDeepSeek(text, cfg);
                return await translateWithGoogle(text);
            } catch (err) {
                lastError = err;
                console.warn(`[LingGe] ${provider} translation failed:`, err);
            }
        }
        throw lastError || new Error('No translation provider available');
    }

    function splitSentences(text) {
        const normalized = text
            .replace(/\r\n/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n+/g, '\n')
            .trim();
        if (!normalized) return [];

        return normalized
            .split('\n')
            .flatMap(line => line.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [line])
            .map(part => part.trim())
            .filter(Boolean);
    }

    function formatTranslatedText(text, cfg) {
        if (cfg.deepseekLayout === 'plain') return text.trim();

        const sentences = splitSentences(text);
        if (sentences.length <= 1) return text.trim();

        if (cfg.deepseekLayout === 'sentence') {
            return sentences.join('\n\n');
        }

        if (cfg.deepseekLayout === 'readable') {
            const paragraphs = [];
            for (let i = 0; i < sentences.length; i += 2) {
                paragraphs.push(sentences.slice(i, i + 2).join(' '));
            }
            return paragraphs.join('\n\n');
        }

        if (cfg.deepseekLayout === 'highlights') {
            return sentences.map((sentence, index) => index === 0 ? `重点：${sentence}` : `- ${sentence}`).join('\n');
        }

        return text.trim();
    }

    function processContent(element, text, platform) {
        const sourceText = (text || '').trim();
        if (!sourceText || element.dataset.lingPending === "true") return;
        if (sourceText.length < 10) return;
        if (element.dataset.lingProcessed === "true" && element.dataset.lingText === sourceText) return;

        let needTrans = false;
        if (platform === 'twitter' || platform === 'discord') {
            const cnChars = sourceText.match(/[\u4e00-\u9fa5]/g) || [];
            const isForeign = !cnChars.length || cnChars.length / sourceText.length < 0.3;
            if (isForeign) needTrans = true;
        }

        if (needTrans) {
            element.dataset.lingPending = "true";
            translateText(sourceText)
                .then(transResult => {
                    if (transResult) {
                        renderBox(element, transResult, platform);
                        element.dataset.lingProcessed = "true";
                        element.dataset.lingText = sourceText;
                    }
                })
                .catch(err => console.error('Translation error:', err))
                .finally(() => { delete element.dataset.lingPending; });
        } else {
            element.dataset.lingProcessed = "true";
            element.dataset.lingText = sourceText;
        }
    }

    function renderBox(element, transText, platform) {
        if (!transText) return;
        const cfg = Storage.getConfig();
        const container = document.createElement('div');
        container.className = platform === 'discord' ? `ling-trans-box ling-discord-box ${cfg.transStyle}` : `ling-trans-box ${cfg.transStyle}`;
        container.textContent = formatTranslatedText(transText, cfg);

        if (platform === 'twitter') {
            const oldBox = element.parentNode.querySelector(':scope > .ling-trans-box');
            if (oldBox) oldBox.remove();
            element.parentNode.appendChild(container);
        } else {
            const oldBox = element.querySelector(':scope > .ling-trans-box');
            if (oldBox) oldBox.remove();
            element.appendChild(container);
        }
    }

    // ================= 4. 用户标记功能 =================
    function refreshUserUI(handle, container) {
        const note = Storage.getNote(handle);
        let noteSpan = container.querySelector('.ling-user-note');
        if (note) {
            if (!noteSpan) {
                noteSpan = document.createElement('span');
                noteSpan.className = 'ling-user-note';
                const toolbar = container.querySelector('.ling-toolbar');
                if (toolbar) container.insertBefore(noteSpan, toolbar);
                else container.appendChild(noteSpan);
            }
            noteSpan.innerText = note;
            noteSpan.onclick = (e) => { e.preventDefault(); e.stopPropagation(); editNote(handle, container); };
        } else if (noteSpan) noteSpan.remove();

        const vipInfo = Storage.getVipInfo(handle);
        let vipBadge = container.querySelector('.ling-identity-badge');
        const article = container.closest('article');

        if (vipInfo) {
            if (article) article.classList.add('ling-vip-tweet');
            if (!vipBadge) {
                vipBadge = document.createElement('span');
                vipBadge.className = 'ling-identity-badge';
                container.appendChild(vipBadge);
            }
            vipBadge.innerText = vipInfo[0];
            const starBtn = container.querySelector('.ling-star-btn');
            if (starBtn) starBtn.classList.add('active');
        } else {
            if (article) article.classList.remove('ling-vip-tweet');
            if (vipBadge) vipBadge.remove();
            const starBtn = container.querySelector('.ling-star-btn');
            if (starBtn) starBtn.classList.remove('active');
        }
    }

    function editNote(handle, container) {
        const old = Storage.getNote(handle) || "";
        const val = prompt(`📝 备注 @${handle}:`, old);
        if (val !== null) { Storage.addNote(handle, val); refreshUserUI(handle, container); }
    }

    function toggleVip(handle, container) {
        const info = Storage.getVipInfo(handle);
        if (info) {
            if (confirm(`⚠️ 取消 @${handle} 的重点关注？`)) {
                Storage.removeVip(handle);
                refreshUserUI(handle, container);
            }
        } else {
            const label = prompt(`🔥 设为重点关注 @${handle}\n输入标签 (如: 顶级VC):`, "重点关注");
            if (label) {
                Storage.addVip(handle, label);
                refreshUserUI(handle, container);
            }
        }
    }

    function processUser(article) {
        let handle = null, container = null;
        const links = article.querySelectorAll('a[href*="/"]');
        for (let link of links) {
            const h = link.getAttribute('href');
            if (h && !h.includes('/status/') && !h.includes('/hashtag/')) {
                const userNameDiv = article.querySelector('div[data-testid="User-Name"]');
                if (userNameDiv && userNameDiv.contains(link)) {
                    handle = extractTwitterHandle(h);
                    if (!handle) continue;
                    container = link.querySelector('div[dir="ltr"]') || link.parentNode;
                    break;
                }
            }
        }
        if (handle && container) {
            if (article.dataset.lingUserProcessed === "true" && article.dataset.lingHandle === handle) {
                refreshUserUI(handle, container);
                return;
            }
            article.dataset.lingUserProcessed = "true";
            article.dataset.lingHandle = handle;
            let toolbar = container.querySelector('.ling-toolbar');
            if (!toolbar) {
                toolbar = document.createElement('span');
                toolbar.className = 'ling-toolbar';
                toolbar.style.whiteSpace = "nowrap";
                const pen = document.createElement('span');
                pen.className = 'ling-action-btn'; pen.innerHTML = '✏️';
                const star = document.createElement('span');
                star.className = 'ling-action-btn ling-star-btn'; star.innerHTML = '⭐';
                toolbar.appendChild(pen);
                toolbar.appendChild(star);
                container.appendChild(toolbar);
            }
            const pen = toolbar.querySelector('.ling-action-btn:not(.ling-star-btn)');
            const star = toolbar.querySelector('.ling-star-btn');
            if (pen) pen.onclick = (e) => { e.preventDefault(); e.stopPropagation(); editNote(handle, container); };
            if (star) star.onclick = (e) => { e.preventDefault(); e.stopPropagation(); toggleVip(handle, container); };
            refreshUserUI(handle, container);
        }
    }

    // ================= 5. 控制台 & 设置 =================
    function toggleDashboard() {
        let dashboard = document.querySelector('.ling-dashboard');
        if (!dashboard) {
            initDashboard();
            dashboard = document.querySelector('.ling-dashboard');
        }
        if (dashboard.style.display === 'none' || !dashboard.style.display) {
            dashboard.style.display = 'block';
            dashboard.classList.add('active');
        } else {
            dashboard.style.display = 'none';
        }
    }

    function handleMenuCommand() {
        toggleDashboard();
    }

    function initDashboard() {
        const div = document.createElement('div');
        div.className = 'ling-dashboard';
        div.innerHTML = `
            <div style="color:#F3BA2F;font-weight:bold;margin-bottom:10px;display:flex;justify-content:space-between;border-bottom:1px solid #333;padding-bottom:5px;">
                <span>🦅 工具箱</span><span style="cursor:pointer;" id="ling-close-dash">✕</span>
            </div>

            <div class="ling-dash-btn-row">
                <div class="ling-mini-btn" id="ling-btn-set">⚙️ 设置</div>
                <div class="ling-mini-btn" id="ling-btn-bk">📤 备份</div>
                <div class="ling-mini-btn" id="ling-btn-rs">📥 恢复</div>
            </div>

            <div style="margin-top:8px;font-size:10px;color:#666;text-align:center;">V20.4 Lite</div>
        `;
        document.body.appendChild(div);

        document.getElementById('ling-close-dash').onclick = () => { div.style.display = 'none'; };
        document.getElementById('ling-btn-set').onclick = openSettings;
        document.getElementById('ling-btn-bk').onclick = Storage.export;
        document.getElementById('ling-btn-rs').onclick = Storage.import;
    }

    function applyTheme(themeKey) {
        const theme = THEME_PRESETS[themeKey];
        if (!theme) return;
        Storage.setConfig({
            transColor: theme.transColor,
            transBgColor: theme.bgColor,
            transTextColor: theme.textColor,
            transFontSize: Storage.getConfig().transFontSize || '14px',
            noteColor: '#1D9BF0',
            vipColor: Storage.getConfig().vipColor || '#F3BA2F',
            translator: Storage.getConfig().translator,
            fallbackTranslator: Storage.getConfig().fallbackTranslator,
            deepseekApiBase: Storage.getConfig().deepseekApiBase,
            deepseekModel: Storage.getConfig().deepseekModel,
            deepseekApiKey: Storage.getConfig().deepseekApiKey,
            transStyle: Storage.getConfig().transStyle,
            deepseekLayout: Storage.getConfig().deepseekLayout
        });
    }

    function openSettings() {
        if (document.getElementById('ling-settings-overlay')) return;
        const cfg = Storage.getConfig();
        const div = document.createElement('div'); div.id = 'ling-settings-overlay';

        let themesHTML = '';
        for (const [key, theme] of Object.entries(THEME_PRESETS)) {
            themesHTML += `
                <div class="ling-theme-btn" data-theme="${key}" style="background:${theme.bgColor};border:2px solid ${theme.transColor};">
                    <div style="color:${theme.textColor};font-size:11px;font-weight:bold;">${theme.name}</div>
                    <div style="display:flex;gap:3px;margin-top:4px;">
                        <div style="width:20px;height:8px;background:${theme.transColor};border-radius:2px;"></div>
                        <div style="width:20px;height:8px;background:${theme.textColor};border-radius:2px;"></div>
                    </div>
                </div>
            `;
        }

        let transStyleHTML = '';
        for (const [key, label] of Object.entries(TRANSLATION_STYLES)) {
            transStyleHTML += `<option value="${key}" ${cfg.transStyle === key ? 'selected' : ''}>${label}</option>`;
        }

        let deepseekLayoutHTML = '';
        for (const [key, label] of Object.entries(DEEPSEEK_LAYOUTS)) {
            deepseekLayoutHTML += `<option value="${key}" ${cfg.deepseekLayout === key ? 'selected' : ''}>${label}</option>`;
        }

        div.innerHTML = `
            <div id="ling-settings-box" style="max-width:400px;width:90%;">
                <h3 style="margin-top:0;color:#F3BA2F;border-bottom:1px solid #333;padding-bottom:10px;">⚙️ 终端设置</h3>

                <div style="margin-bottom:15px;">
                    <label style="display:block;margin-bottom:8px;color:#ccc;font-size:12px;">🎨 预设主题</label>
                    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
                        ${themesHTML}
                    </div>
                </div>

                <div style="border-top:1px dashed #333;margin:15px 0;padding-top:15px;">
                    <label style="display:block;margin-bottom:8px;color:#ccc;font-size:12px;">🎯 自定义配置</label>
                    <div class="ling-row"><label>显示样式</label><select id="c-style" style="width:120px;">${transStyleHTML}</select></div>
                    <div class="ling-row"><label>翻译字号</label><input type="text" id="c-ts" value="${escapeAttr(cfg.transFontSize)}" style="width:60px;"></div>
                    <div class="ling-row"><label>VIP框色</label><input type="color" id="c-vc" value="${cfg.vipColor}"></div>
                </div>

                <div style="border-top:1px dashed #333;margin:15px 0;padding-top:15px;">
                    <label style="display:block;margin-bottom:8px;color:#ccc;font-size:12px;">🌐 翻译服务</label>
                    <div class="ling-row"><label>主接口</label><select id="c-translator" style="width:120px;">
                        <option value="google" ${cfg.translator === 'google' ? 'selected' : ''}>Google 免费</option>
                        <option value="deepseek" ${cfg.translator === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
                    </select></div>
                    <div class="ling-row"><label>备用接口</label><select id="c-fallback" style="width:120px;">
                        <option value="deepseek" ${cfg.fallbackTranslator === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
                        <option value="google" ${cfg.fallbackTranslator === 'google' ? 'selected' : ''}>Google 免费</option>
                        <option value="none" ${cfg.fallbackTranslator === 'none' ? 'selected' : ''}>不启用</option>
                    </select></div>
                    <div class="ling-row"><label>DeepSeek API</label><input type="text" id="c-ds-base" value="${escapeAttr(cfg.deepseekApiBase)}" style="width:190px;"></div>
                    <div class="ling-row"><label>模型</label><input type="text" id="c-ds-model" value="${escapeAttr(cfg.deepseekModel)}" style="width:190px;"></div>
                    <div class="ling-row"><label>排版风格</label><select id="c-ds-layout" style="width:190px;">${deepseekLayoutHTML}</select></div>
                    <div class="ling-row"><label>API Key</label><input type="password" id="c-ds-key" value="${escapeAttr(cfg.deepseekApiKey)}" style="width:190px;" autocomplete="off"></div>
                </div>

                <button class="ling-btn" id="ling-save">保存自定义配置</button>
                <button class="ling-btn" id="ling-close" style="background:#333;color:#fff;margin-top:10px">关闭面板</button>
            </div>
        `;
        document.body.appendChild(div);

        // 主题按钮点击事件
        document.querySelectorAll('.ling-theme-btn').forEach(btn => {
            btn.onclick = () => {
                const themeKey = btn.getAttribute('data-theme');
                applyTheme(themeKey);
                div.remove();
            };
        });

        document.getElementById('ling-close').onclick = () => div.remove();
        document.getElementById('ling-save').onclick = () => {
            const currentCfg = Storage.getConfig();
            Storage.setConfig({
                ...currentCfg,
                translator: document.getElementById('c-translator').value,
                fallbackTranslator: document.getElementById('c-fallback').value,
                deepseekApiBase: document.getElementById('c-ds-base').value,
                deepseekModel: document.getElementById('c-ds-model').value,
                deepseekLayout: document.getElementById('c-ds-layout').value,
                deepseekApiKey: document.getElementById('c-ds-key').value,
                transStyle: document.getElementById('c-style').value,
                transFontSize: document.getElementById('c-ts').value,
                vipColor: document.getElementById('c-vc').value
            });
            div.remove();
        };
    }

    // ================= 6. 初始化 =================
    GM_registerMenuCommand("🦅 打开/关闭工具箱", handleMenuCommand);

    updateStyles();

    const isTwitterHost = () => location.host.includes('twitter.com') || location.host.includes('x.com');
    const isDiscordHost = () => location.host.includes('discord.com');

    function collectMatches(root, selector) {
        const nodes = [];
        if (root.matches && root.matches(selector)) nodes.push(root);
        if (root.querySelectorAll) nodes.push(...root.querySelectorAll(selector));
        return nodes;
    }

    function scanTwitter(root = document) {
        collectMatches(root, 'div[data-testid="tweetText"]').forEach(t => processContent(t, t.innerText, 'twitter'));
        collectMatches(root, 'article').forEach(processUser);
    }

    function scanDiscord(root = document) {
        collectMatches(root, 'div[id^="message-content"]').forEach(msg => processContent(msg, msg.innerText, 'discord'));
    }

    const observer = new MutationObserver((ms) => {
        ms.forEach(m => m.addedNodes.forEach(n => {
            if (n.nodeType === 1) {
                if (isTwitterHost()) scanTwitter(n);
                else if (isDiscordHost()) scanDiscord(n);
            }
        }));
    });

    const start = () => {
        if(document.body) {
            if (isTwitterHost()) scanTwitter();
            else if (isDiscordHost()) scanDiscord();
            observer.observe(document.body, {childList: true, subtree: true});
        } else setTimeout(start, 500);
    };
    start();

})();
