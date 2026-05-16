// ==UserScript==
// @name         夸克网盘保存并重命名
// @namespace    local.codex
// @version      0.1.0
// @description  在夸克网盘分享页面，保存文件夹到网盘后自动重命名为指定名称。
// @match        https://pan.quark.cn/s/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  const SCRIPT_ID = 'quark-save-rename';
  const API = 'https://drive-pc.quark.cn/1/clouddrive';
  const PARAMS = 'pr=ucpro&fr=pc&uc_param_str=';

  // ── UI ──────────────────────────────────────────────────────────────────────

  function injectUI() {
    if (document.getElementById(SCRIPT_ID)) return;

    const bar = document.createElement('div');
    bar.id = SCRIPT_ID;
    bar.style.cssText = [
      'position:fixed', 'bottom:70px', 'right:14px', 'z-index:2147483647',
      'display:flex', 'gap:6px', 'align-items:center',
      'background:rgba(255,255,255,.96)', 'border:1px solid #e2e8f0',
      'border-radius:8px', 'padding:8px 10px',
      'box-shadow:0 4px 16px rgba(15,23,42,.15)',
      'font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'
    ].join(';');

    bar.innerHTML = `
      <span style="color:#64748b;white-space:nowrap">保存后重命名：</span>
      <input id="${SCRIPT_ID}-input" type="text" placeholder="输入正确的文件夹名称"
        style="width:260px;padding:4px 8px;border:1px solid #cbd5e1;border-radius:5px;font:inherit;outline:none">
      <button id="${SCRIPT_ID}-btn"
        style="padding:4px 12px;background:#2563eb;color:#fff;border:0;border-radius:5px;cursor:pointer;font:inherit;white-space:nowrap">
        等待保存…
      </button>
    `;

    document.body.appendChild(bar);

    // Hook the save API response
    hookSaveAPI();
  }

  function setStatus(text, color = '#2563eb') {
    const btn = document.getElementById(`${SCRIPT_ID}-btn`);
    if (btn) { btn.textContent = text; btn.style.background = color; }
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
        const res = await fetch(`${API}/task?${PARAMS}&task_id=${taskId}&retry_index=${i}`);
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
      const res = await fetch(`${API}/file/rename?${PARAMS}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
