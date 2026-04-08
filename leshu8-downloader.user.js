// ==UserScript==
// @name         乐书网书籍下载器 (leshu8 Downloader)
// @namespace    https://github.com/hahapkpk/tools
// @version      1.2.0
// @description  在 leshu8.com 书籍阅读页添加「下载 HTML / PDF」按钮，导出带原站排版的完整书籍
// @author       hahapkpk
// @match        https://leshu8.com/book-chapter*
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/leshu8-downloader.user.js
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/leshu8-downloader.user.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ─── 常量 ────────────────────────────────────────────────────────────────
  const REQUEST_DELAY_MS = 400;
  const MAX_RETRIES = 3;

  // ─── 工具 ────────────────────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function getBookId() {
    return new URLSearchParams(location.search).get('bookId');
  }

  // 从 Nuxt SSR state 中用 bookId 精确定位书名
  function getBookTitle(bookId) {
    try {
      for (const s of document.querySelectorAll('script')) {
        const m = s.textContent.match(new RegExp(`"${bookId}","([^"]{2,60})"`));
        if (m) return m[1];
      }
    } catch (_) {}
    return document.title.replace(/\s*[-–|].*$/, '').trim() || '书籍';
  }

  // 动态获取原站 CSS URL（hash 版本号会随部署变化）
  function getSiteCssUrl() {
    for (const sheet of document.styleSheets) {
      if (sheet.href?.includes('leshu8.com')) return sheet.href;
    }
    return '';
  }

  // ─── 解锁 & 认证 ─────────────────────────────────────────────────────────
  async function ensureUnlocked(bookId, ui) {
    const app = useNuxtApp();
    if (await app.$hasResourceAccessKey('ebook', bookId)) return;
    ui.setStatus('本书未解锁，正在自动解锁...\n（每日免费限额由平台控制）');
    await app.$resourceUnlock('ebook', bookId, '');
    await sleep(500);
    if (!await app.$hasResourceAccessKey('ebook', bookId)) {
      throw new Error('解锁失败，可能已超出每日免费次数\n请在网页上手动解锁后重试');
    }
  }

  async function getHeaders(bookId) {
    const app = useNuxtApp();
    const token = localStorage.getItem('token');
    if (!token) throw new Error('未登录，请先登录账号');
    const [dsac, cid] = await Promise.all([
      app.$getRequestAccessKey('ebook', bookId),
      app.$getClientId(),
    ]);
    if (!dsac) throw new Error('获取访问密钥失败，请刷新页面后重试');
    return { authorization: `Bearer ${token}`, dsac, cid };
  }

  // ─── 章节获取 ─────────────────────────────────────────────────────────────
  async function fetchChapter(bookId, page, headers, retries = 0) {
    const res = await fetch(
      `/api/public/ebook/${bookId}/chapter?page=${page}`,
      { headers }
    );
    if (res.status === 400) {
      const body = await res.json();
      if (body.message === '无数据') return null;
      if (retries < MAX_RETRIES) { await sleep(800); return fetchChapter(bookId, page, headers, retries + 1); }
      return null;
    }
    if (!res.ok) {
      if (retries < MAX_RETRIES) { await sleep(800); return fetchChapter(bookId, page, headers, retries + 1); }
      return null;
    }
    return res.json();
  }

  async function fetchAllChapters(bookId, ui, title) {
    const chapters = [];
    let page = 1;
    while (true) {
      const headers = await getHeaders(bookId); // 每章刷新 dsac 防过期
      ui.setStatus(`《${title}》\n正在下载第 ${page} 章...`);
      const data = await fetchChapter(bookId, page, headers);
      if (!data) break;
      chapters.push({ page, content: data.content || '' });
      page++;
      await sleep(REQUEST_DELAY_MS);
    }
    return chapters;
  }

  // ─── 输出：HTML ───────────────────────────────────────────────────────────
  function buildHtml(title, chapters) {
    const css = `
      * { box-sizing: border-box; }
      body {
        max-width: 700px; margin: 60px auto; padding: 0 24px;
        font-family: "Source Han Serif CN", "Noto Serif CJK SC", "思源宋体", Georgia, serif;
        font-size: 17px; line-height: 1.9; color: #2c2c2c; background: #fdfaf5;
      }
      #book-cover {
        text-align: center; padding: 80px 0 60px;
        border-bottom: 2px solid #d4c9b0; margin-bottom: 60px;
      }
      #book-cover h1 { font-size: 2.2em; margin: 0 0 12px; }
      #book-cover p  { color: #888; font-size: 0.9em; }
      h1 { font-size: 1.8em; margin: 2.5em 0 0.6em; }
      h2 { font-size: 1.35em; margin: 2em 0 0.6em; padding-bottom: 0.3em; border-bottom: 1px solid #e0d8cc; }
      p.normaltext  { text-indent: 2em; margin: 0.5em 0; }
      p.yinwen      { margin: 1em 2.5em; color: #555; font-style: italic; border-left: 3px solid #d4c9b0; padding-left: 1em; }
      p.yingwen2    { text-align: center; font-size: 0.85em; color: #aaa; letter-spacing: 0.1em; margin: 4px 0; }
      p.information { font-size: 0.88em; color: #777; margin: 4px 0; }
      .underline    { text-decoration: underline; }
      .bqbt2        { font-size: 1.6em; text-align: center; margin: 1em 0 0.3em; }
      .chapter-sep  { border: none; border-top: 1px solid #ddd; margin: 4em 0; }
      @media print  { body { background: white; } }
    `;
    const body = chapters
      .map((c, i) => (i > 0 ? '<hr class="chapter-sep">' : '') + '\n' + c.content)
      .join('\n');
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>${css}</style>
</head>
<body>
  <div id="book-cover">
    <h1>${title}</h1>
    <p>共 ${chapters.length} 章 · 由 leshu8-downloader 导出</p>
  </div>
  ${body}
</body>
</html>`;
  }

  function triggerDownload(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── 输出：PDF（原站排版，弹出打印对话框）────────────────────────────────
  function openPrintWindow(title, chapters, cssUrl) {
    const body = chapters.map(c => c.content).join('\n<div style="page-break-after:avoid;margin:3em 0;border-top:1px solid #ccc"></div>\n');

    // 控制打印区域样式，覆盖原站的响应式/交互样式
    const printOverride = `
      @media print {
        @page { margin: 20mm 18mm; }
        body  { background: white !important; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
      body {
        max-width: 700px; margin: 40px auto; padding: 0 20px;
        font-size: 16px; line-height: 1.85;
      }
      #leshu8-print-cover {
        text-align: center; padding: 60px 0 40px;
        border-bottom: 2px solid #d4c9b0; margin-bottom: 50px;
        page-break-after: always;
      }
      #leshu8-print-cover h1 { font-size: 2em; margin: 0 0 10px; }
      #leshu8-print-cover p  { color: #888; font-size: 0.9em; }
    `;

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  ${cssUrl ? `<link rel="stylesheet" href="${cssUrl}">` : ''}
  <style>${printOverride}</style>
</head>
<body>
  <div id="leshu8-print-cover">
    <h1>${title}</h1>
    <p>共 ${chapters.length} 章 · 由 leshu8-downloader 导出</p>
  </div>
  <div class="reader-article">
    ${body}
  </div>
  <script>
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 800);
    });
  <\/script>
</body>
</html>`;

    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      alert('弹出窗口被拦截，请允许本站弹窗后重试');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  // ─── UI ──────────────────────────────────────────────────────────────────
  function createUI() {
    // 容器
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      position: 'fixed', bottom: '80px', right: '24px',
      zIndex: '9999', display: 'flex', flexDirection: 'column', gap: '8px',
    });

    function makeBtn(text, bg) {
      const b = document.createElement('button');
      b.textContent = text;
      Object.assign(b.style, {
        padding: '9px 16px', background: bg, color: '#fff',
        border: 'none', borderRadius: '8px', fontSize: '13px',
        fontWeight: 'bold', cursor: 'pointer',
        boxShadow: '0 4px 12px rgba(0,0,0,0.28)', transition: 'opacity 0.15s',
        whiteSpace: 'nowrap',
      });
      b.addEventListener('mouseenter', () => (b.style.opacity = '0.82'));
      b.addEventListener('mouseleave', () => (b.style.opacity = '1'));
      return b;
    }

    const btnHtml = makeBtn('⬇ 下载 HTML', '#5a3e28');
    const btnPdf  = makeBtn('🖨 打印 / PDF', '#2c4a6e');

    const toast = document.createElement('div');
    Object.assign(toast.style, {
      padding: '10px 14px', background: 'rgba(30,30,30,0.92)', color: '#fff',
      borderRadius: '8px', fontSize: '12px', lineHeight: '1.65',
      maxWidth: '210px', display: 'none', whiteSpace: 'pre-line',
    });

    wrap.appendChild(toast);
    wrap.appendChild(btnHtml);
    wrap.appendChild(btnPdf);
    document.body.appendChild(wrap);

    return {
      btnHtml, btnPdf,
      setStatus(msg) { toast.style.display = 'block'; toast.textContent = msg; },
      hide()         { toast.style.display = 'none'; },
      setLoading(flag) {
        [btnHtml, btnPdf].forEach(b => (b.disabled = flag));
      },
    };
  }

  // ─── 主流程 ───────────────────────────────────────────────────────────────
  async function run(ui, mode) {
    const bookId = getBookId();
    if (!bookId) { alert('无法获取 bookId，请确认当前页面是书籍阅读页'); return; }

    if (!localStorage.getItem('token')) { alert('未登录，请先登录账号'); return; }

    ui.setLoading(true);

    try {
      const title = getBookTitle(bookId);
      ui.setStatus(`《${title}》\n正在初始化...`);

      await ensureUnlocked(bookId, ui);

      const chapters = await fetchAllChapters(bookId, ui, title);

      if (chapters.length === 0) {
        throw new Error('未获取到任何章节\n请确认已购买或有阅读权限');
      }

      ui.setStatus(`共 ${chapters.length} 章，正在生成...`);

      if (mode === 'html') {
        triggerDownload(buildHtml(title, chapters), `${title}.html`, 'text/html;charset=utf-8');
        ui.setStatus(`✅ HTML 下载完成\n共 ${chapters.length} 章`);
      } else {
        openPrintWindow(title, chapters, getSiteCssUrl());
        ui.setStatus(`✅ 已打开打印窗口\n选择「另存为 PDF」即可`);
      }

      setTimeout(() => ui.hide(), 5000);
    } catch (err) {
      ui.setStatus(`❌ 出错：\n${err.message}`);
      console.error('[leshu8-downloader]', err);
    } finally {
      ui.setLoading(false);
    }
  }

  // ─── 初始化 ───────────────────────────────────────────────────────────────
  function init() {
    if (typeof useNuxtApp !== 'function') { setTimeout(init, 500); return; }
    const ui = createUI();
    ui.btnHtml.addEventListener('click', () => run(ui, 'html'));
    ui.btnPdf.addEventListener('click',  () => run(ui, 'pdf'));
  }

  setTimeout(init, 1500);
})();
