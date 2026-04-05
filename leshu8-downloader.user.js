// ==UserScript==
// @name         乐书网书籍下载器 (leshu8 Downloader)
// @namespace    https://github.com/hahapkpk/tools
// @version      1.1.0
// @description  在 leshu8.com 书籍阅读页添加「下载本书」按钮，将整本书导出为带样式的 HTML 文件
// @author       hahapkpk
// @match        https://leshu8.com/book-chapter*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ─── 常量 ────────────────────────────────────────────────────────────────
  const REQUEST_DELAY_MS = 400;   // 请求间隔，避免触发限流
  const MAX_RETRIES = 3;          // 单页最大重试次数

  // ─── 工具函数 ──────────────────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function getBookId() {
    const params = new URLSearchParams(location.search);
    return params.get('bookId');
  }

  // 检查并自动解锁（每日限额由服务端控制，无需 Turnstile token）
  async function ensureUnlocked(bookId, ui) {
    const app = useNuxtApp();
    const hasKey = await app.$hasResourceAccessKey('ebook', bookId);
    if (hasKey) return;
    ui.setStatus('本书未解锁，正在自动解锁\n（每日免费解锁限额由平台控制）');
    await app.$resourceUnlock('ebook', bookId, '');
    // 等待 resource_ac 写入
    await sleep(500);
    const confirmed = await app.$hasResourceAccessKey('ebook', bookId);
    if (!confirmed) throw new Error('解锁失败，可能已超出每日免费解锁次数\n请在网页上手动解锁后再试');
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

  async function fetchChapter(bookId, page, headers, retries = 0) {
    const res = await fetch(
      `/api/public/ebook/${bookId}/chapter?page=${page}`,
      { headers }
    );
    if (res.status === 400) {
      const body = await res.json();
      if (body.message === '无数据') return null; // 超出总页数
      if (retries < MAX_RETRIES) {
        await sleep(800);
        return fetchChapter(bookId, page, headers, retries + 1);
      }
      return null;
    }
    if (!res.ok) {
      if (retries < MAX_RETRIES) {
        await sleep(800);
        return fetchChapter(bookId, page, headers, retries + 1);
      }
      return null;
    }
    return res.json();
  }

  async function getBookTitle() {
    try {
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const m = s.textContent.match(/"title":"([^"]{2,50})"/);
        if (m) return m[1];
      }
    } catch (_) {}
    return document.title.replace(' - 乐书', '').trim() || '书籍';
  }

  // ─── HTML 组装 ────────────────────────────────────────────────────────────
  function buildHtml(title, chapters) {
    const style = `
      * { box-sizing: border-box; }
      body {
        max-width: 700px; margin: 60px auto; padding: 0 24px;
        font-family: "Source Han Serif CN", "Noto Serif CJK SC", "思源宋体", Georgia, serif;
        font-size: 17px; line-height: 1.9; color: #2c2c2c; background: #fdfaf5;
      }
      #book-cover { text-align: center; padding: 80px 0 60px; border-bottom: 2px solid #d4c9b0; margin-bottom: 60px; }
      #book-cover h1 { font-size: 2.2em; margin: 0 0 12px; }
      #book-cover p { color: #888; font-size: 0.95em; }
      h1 { font-size: 1.8em; margin: 2.5em 0 0.6em; }
      h2 { font-size: 1.35em; margin: 2em 0 0.6em; padding-bottom: 0.3em; border-bottom: 1px solid #e0d8cc; }
      p.normaltext { text-indent: 2em; margin: 0.5em 0; }
      p.yinwen { margin: 1em 2.5em; color: #555; font-style: italic; border-left: 3px solid #d4c9b0; padding-left: 1em; }
      p.yingwen2 { text-align: center; font-size: 0.85em; color: #aaa; letter-spacing: 0.1em; margin: 4px 0; }
      p.information { font-size: 0.88em; color: #777; margin: 4px 0; }
      .underline { text-decoration: underline; }
      .chapter-sep { border: none; border-top: 1px solid #ddd; margin: 4em 0; }
      @media print { body { background: white; } }
    `;

    const coverHtml = `
      <div id="book-cover">
        <h1>${title}</h1>
        <p>共 ${chapters.length} 章 · 由 leshu8-downloader 导出</p>
      </div>
    `;

    const bodyChapters = chapters
      .map((c, i) => {
        const sep = i > 0 ? '<hr class="chapter-sep">' : '';
        return `${sep}\n${c.content}`;
      })
      .join('\n');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>${style}</style>
</head>
<body>
  ${coverHtml}
  ${bodyChapters}
</body>
</html>`;
  }

  // ─── UI ───────────────────────────────────────────────────────────────────
  function createUI() {
    const btn = document.createElement('button');
    btn.id = 'leshu8-dl-btn';
    btn.textContent = '⬇ 下载本书';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '80px',
      right: '24px',
      zIndex: '9999',
      padding: '10px 18px',
      background: '#5a3e28',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: 'bold',
      cursor: 'pointer',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      transition: 'opacity 0.2s',
    });
    btn.addEventListener('mouseenter', () => (btn.style.opacity = '0.85'));
    btn.addEventListener('mouseleave', () => (btn.style.opacity = '1'));

    const toast = document.createElement('div');
    toast.id = 'leshu8-dl-toast';
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '140px',
      right: '24px',
      zIndex: '9999',
      padding: '10px 16px',
      background: 'rgba(40,40,40,0.92)',
      color: '#fff',
      borderRadius: '8px',
      fontSize: '13px',
      lineHeight: '1.6',
      maxWidth: '220px',
      display: 'none',
      whiteSpace: 'pre-line',
    });

    document.body.appendChild(btn);
    document.body.appendChild(toast);

    return {
      btn,
      setStatus(msg) {
        toast.style.display = 'block';
        toast.textContent = msg;
      },
      hide() {
        toast.style.display = 'none';
      },
    };
  }

  // ─── 主流程 ───────────────────────────────────────────────────────────────
  async function download(ui) {
    const bookId = getBookId();
    if (!bookId) {
      alert('无法获取 bookId，请确认当前页面是书籍阅读页');
      return;
    }

    ui.btn.disabled = true;
    ui.btn.textContent = '下载中...';

    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('未登录，请先登录账号');

      const title = await getBookTitle();
      ui.setStatus(`《${title}》\n正在初始化...`);

      // 检查登录 & 自动解锁
      await ensureUnlocked(bookId, ui);

      const chapters = [];
      let page = 1;

      while (true) {
        // dsac 含时间戳，每次重新生成防过期
        const freshHeaders = await getHeaders(bookId);
        ui.setStatus(`《${title}》\n正在下载第 ${page} 章...`);

        const data = await fetchChapter(bookId, page, freshHeaders);
        if (!data) break; // 无数据 = 已到末页

        chapters.push({ page, content: data.content || '' });
        page++;
        await sleep(REQUEST_DELAY_MS);
      }

      if (chapters.length === 0) {
        throw new Error('未获取到任何章节\n请确认已购买或有阅读权限');
      }

      ui.setStatus(`共 ${chapters.length} 章，正在生成文件...`);

      const html = buildHtml(title, chapters);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      ui.setStatus(`✅ 下载完成\n共 ${chapters.length} 章`);
      ui.btn.textContent = '✅ 下载完成';
      setTimeout(() => ui.hide(), 4000);
    } catch (err) {
      ui.setStatus(`❌ 出错：\n${err.message}`);
      ui.btn.disabled = false;
      ui.btn.textContent = '⬇ 下载本书';
      console.error('[leshu8-downloader]', err);
    }
  }

  // ─── 初始化 ───────────────────────────────────────────────────────────────
  function init() {
    // 等待 Nuxt app 就绪（useNuxtApp 由 Nuxt 全局注入）
    if (typeof useNuxtApp !== 'function') {
      setTimeout(init, 500);
      return;
    }
    const ui = createUI();
    ui.btn.addEventListener('click', () => download(ui));
  }

  // 稍微延迟，确保 Nuxt hydration 完成
  setTimeout(init, 1500);
})();
