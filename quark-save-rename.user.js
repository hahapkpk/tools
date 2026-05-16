// ==UserScript==
// @name         夸克网盘保存并重命名
// @namespace    local.codex
// @version      0.3.0
// @description  在夸克网盘分享页面，保存文件夹到网盘后自动重命名为指定名称。
// @match        https://pan.quark.cn/s/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_ID = 'quark-save-rename';
  const API_TASK = 'https://drive-pc.quark.cn/1/clouddrive';
  const API_FILE = 'https://drive-h.quark.cn/1/clouddrive';
  const PARAMS = 'pr=ucpro&fr=pc&uc_param_str=';

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
      this._method = method;
      return origOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (body) {
      if (/sharepage\/save/.test(this._url)) {
        this.addEventListener('load', function () {
          try {
            const res = JSON.parse(this.responseText);
            const taskId = res?.data?.task_id;
            if (taskId) onSaveTaskCreated(taskId);
          } catch (_) {}
        });
      }
      return origSend.call(this, body);
    };

    // Also hook fetch
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input?.url || '';
      const p = origFetch.call(this, input, init);
      if (/sharepage\/save/.test(url)) {
        p.then(res => res.clone().json().then(data => {
          const taskId = data?.data?.task_id;
          if (taskId) onSaveTaskCreated(taskId);
        }).catch(() => {})).catch(() => {});
      }
      return p;
    };
  }

  // ── After save: poll task → get fid → rename ─────────────────────────────────

  async function onSaveTaskCreated(taskId) {
    const newName = document.getElementById(`${SCRIPT_ID}-input`)?.value?.trim();
    if (!newName) return; // No rename needed if input is empty

    setStatus('保存中…', '#0f766e');

    const fid = await pollTask(taskId);
    if (!fid) { setStatus('获取 fid 失败', '#b91c1c'); return; }

    setStatus('重命名中…', '#7c3aed');
    const ok = await renameFile(fid, newName);
    setStatus(ok ? `✓ 已重命名` : '重命名失败', ok ? '#047857' : '#b91c1c');
  }

  async function pollTask(taskId, retries = 15) {
    for (let i = 0; i < retries; i++) {
      await sleep(800);
      try {
        const res = await fetch(`${API_TASK}/task?${PARAMS}&task_id=${taskId}&retry_index=${i}`);
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
