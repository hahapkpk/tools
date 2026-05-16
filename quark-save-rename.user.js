// ==UserScript==
// @name         夸克网盘保存并重命名
// @namespace    local.codex
// @version      0.5.1
// @description  在夸克网盘分享页面，保存文件夹到网盘后自动重命名为指定名称。
// @match        https://pan.quark.cn/s/*
// @match        https://pan.quark.cn/list*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;

  const SCRIPT_ID = 'quark-save-rename';
  const CHANNEL = new BroadcastChannel('quark-save-rename');
  const PARAMS = 'pr=ucpro&fr=pc&uc_param_str=';

  // ── 网盘列表页：接收重命名指令 ───────────────────────────────────────────────
  if (location.pathname.startsWith('/list')) {
    CHANNEL.onmessage = async (e) => {
      const { fid, name } = e.data || {};
      if (!fid || !name) return;
      console.log('[quark-rename] renaming', fid, '->', name);
      try {
        const res = await fetch(`https://drive-pc.quark.cn/1/clouddrive/file/rename?${PARAMS}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ fid, file_name: name })
        });
        const d = await res.json();
        console.log('[quark-rename] result:', d.code, d.message);
      } catch (err) {
        console.error('[quark-rename] error:', err);
      }
    };
    return; // 列表页只监听，不注入 UI
  }
  const API_TASK = 'https://drive-pc.quark.cn/1/clouddrive';
  const API_FILE = 'https://drive-h.quark.cn/1/clouddrive';

  // ── Hook fetch/XHR immediately (document-start) ──────────────────────────────

  hookSaveAPI();

  // ── UI ──────────────────────────────────────────────────────────────────────

  function getSourceTitle() {
    // Read title from URL hash: #/list/share?_title=xxx
    const m = location.hash.match(/_title=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function injectUI() {
    if (document.getElementById(SCRIPT_ID)) return;

    const savedTitle = getSourceTitle();

    const bar = document.createElement('div');
    bar.id = SCRIPT_ID;
    bar.style.cssText = [
      'display:inline-flex', 'gap:6px', 'align-items:center',
      'font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'margin-left:12px', 'vertical-align:middle'
    ].join(';');

    bar.innerHTML = `
      <input id="${SCRIPT_ID}-input" type="text" placeholder="保存后重命名（可选）"
        value="${savedTitle.replace(/"/g, '&quot;')}"
        style="width:280px;padding:4px 8px;border:1px solid #cbd5e1;border-radius:5px;font:inherit;outline:none;height:32px;box-sizing:border-box">
      <span id="${SCRIPT_ID}-status" style="color:#64748b;font-size:12px;white-space:nowrap"></span>
    `;

    // Insert into the share-info-wrap area (top header, red box position)
    const insertTarget = document.querySelector('.share-info-wrap, [class*="share-info-wrap"]');
    if (insertTarget) {
      insertTarget.style.display = 'flex';
      insertTarget.style.alignItems = 'center';
      insertTarget.appendChild(bar);
    } else {
      // Fallback: fixed position
      bar.style.cssText += ';position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(255,255,255,.96);border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;box-shadow:0 4px 16px rgba(15,23,42,.15)';
      document.body.appendChild(bar);
    }
  }

  function setStatus(text, color = '#64748b') {
    const el = document.getElementById(`${SCRIPT_ID}-status`);
    if (el) { el.textContent = text; el.style.color = color; }
  }

  // ── API hook ─────────────────────────────────────────────────────────────────

  function hookSaveAPI() {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this._url = url;
      return origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (body) {
      if (/sharepage\/save/.test(this._url)) {
        this.addEventListener('load', function () {
          try { const d = JSON.parse(this.responseText); if (d?.data?.task_id) onSaveTaskCreated(d.data.task_id); } catch (_) {}
        });
      }
      return origSend.call(this, body);
    };

    // Use defineProperty so page JS can't overwrite our hook
    let _fetch = window.fetch;
    Object.defineProperty(window, 'fetch', {
      get() { return _fetch; },
      set(fn) {
        const wrapped = function (input, init) {
          const url = typeof input === 'string' ? input : input?.url || '';
          const p = fn.call(this, input, init);
          if (/sharepage\/save/.test(url)) {
            p.then(r => r.clone().json().then(d => { if (d?.data?.task_id) onSaveTaskCreated(d.data.task_id); }).catch(() => {})).catch(() => {});
          }
          return p;
        };
        _fetch = wrapped;
      },
      configurable: true
    });
  }

  // ── After save: poll task → get fid → rename ─────────────────────────────────

  async function onSaveTaskCreated(taskId) {
    const rawName = document.getElementById(`${SCRIPT_ID}-input`)?.value?.trim();
    if (!rawName) return;
    // Remove characters not allowed in filenames
    const newName = rawName.replace(/[\/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 255);

    setStatus('保存中…', '#0f766e');

    const fid = await pollTask(taskId);
    if (!fid) { setStatus('获取 fid 失败', '#b91c1c'); return; }

    setStatus('重命名中…', '#7c3aed');
    // Post message to any open list page, or open one
    CHANNEL.postMessage({ fid, name: newName });
    // Also try direct rename after a short delay (in case list page is already open)
    setTimeout(async () => {
      try {
        const res = await fetch(`https://drive-pc.quark.cn/1/clouddrive/file/rename?${PARAMS}`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fid, file_name: newName })
        });
        const d = await res.json();
        setStatus(d.code === 0 ? '✓ 已重命名' : `失败: ${d.message}`, d.code === 0 ? '#047857' : '#b91c1c');
      } catch (e) { setStatus('重命名失败', '#b91c1c'); }
    }, 500);
  }

  async function pollTask(taskId, retries = 15) {
    for (let i = 0; i < retries; i++) {
      await sleep(800);
      try {
        const res = await fetch(`${API_TASK}/task?${PARAMS}&task_id=${taskId}&retry_index=${i}`, { credentials: 'include' });
        const data = await res.json();
        const status = data?.data?.status;
        // status 2 = done; grab fid from save_as list
        if (status === 2) {
          const list = data?.data?.save_as?.save_as_top_fids;
          return list?.[0] || null;
        }
        if (status > 2) return null; // failed
      } catch (_) {}
    }
    return null;
  }

  async function renameFile(fid, newName) {
    try {
      const res = await fetch(`${API_FILE}/file/rename?${PARAMS}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ fid, file_name: newName })
      });
      const data = await res.json();
      return data?.code === 0;
    } catch (_) {
      return false;
    }
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Init ─────────────────────────────────────────────────────────────────────

  function init() {
    // Wait for page to render save button
    const ob = new MutationObserver(() => {
      if (document.querySelector('.share-btns, [class*="save-btn"], button')) {
        ob.disconnect();
        injectUI();
      }
    });
    ob.observe(document.body || document.documentElement, { childList: true, subtree: true });
    // Also try immediately
    setTimeout(injectUI, 2000);
  }

  init();
})();
