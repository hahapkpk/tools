// ==UserScript==
// @name         夸克网盘保存并重命名
// @namespace    local.codex
// @version      0.8.3
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

  // ── 网盘列表页：接收重命名指令 + 回收站入口 ──────────────────────────────────
  if (location.pathname.startsWith('/list')) {
    CHANNEL.onmessage = async (e) => {
      const { fid, name } = e.data || {};
      if (!fid || !name) return;
      try {
        const res = await fetch(`https://drive-pc.quark.cn/1/clouddrive/file/rename?${PARAMS}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ fid, file_name: name })
        });
        const d = await res.json();
        console.log('[quark-rename] result:', d.code, d.message);
      } catch (err) { console.error('[quark-rename] error:', err); }
    };

    // Inject recycle bin button into sidebar
    function injectRecycleBtn() {
      if (document.getElementById('quark-recycle-btn')) return;
      const menu = document.querySelector('.ant-menu');
      if (!menu) return;

      const btn = document.createElement('li');
      btn.id = 'quark-recycle-btn';
      btn.style.cssText = 'padding:0 16px;height:40px;line-height:40px;cursor:pointer;color:#595959;font-size:14px;display:flex;align-items:center;gap:8px;';
      btn.innerHTML = `<span>🗑️</span><span>回收站</span>`;
      btn.onclick = () => showRecyclePanel();
      menu.appendChild(btn);
    }

    async function showRecyclePanel() {
      let panel = document.getElementById('quark-recycle-panel');
      if (panel) { panel.remove(); return; }

      panel = document.createElement('div');
      panel.id = 'quark-recycle-panel';
      panel.style.cssText = 'position:fixed;top:60px;left:200px;width:500px;max-height:70vh;overflow:auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.15);z-index:9999;font:13px/1.5 -apple-system,sans-serif;';
      panel.innerHTML = `
        <div style="padding:12px 16px;border-bottom:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center">
          <strong>回收站</strong>
          <div style="display:flex;gap:8px">
            <button id="qr-del-sel" style="padding:4px 12px;background:#ef4444;color:#fff;border:0;border-radius:5px;cursor:pointer;display:none">彻底删除</button>
            <button id="qr-restore-sel" style="padding:4px 12px;background:#2563eb;color:#fff;border:0;border-radius:5px;cursor:pointer;display:none">还原选中</button>
            <button id="qr-refresh" style="padding:4px 10px;background:#f1f5f9;border:0;border-radius:5px;cursor:pointer">↻</button>
            <button id="qr-close" style="padding:4px 10px;background:#f1f5f9;border:0;border-radius:5px;cursor:pointer">✕</button>
          </div>
        </div>
        <div id="qr-list" style="padding:8px 16px;color:#64748b">加载中…</div>`;
      document.body.appendChild(panel);

      panel.querySelector('#qr-close').onclick = () => panel.remove();
      panel.querySelector('#qr-refresh').onclick = () => loadRecycleList(panel);
      panel.querySelector('#qr-restore-sel').onclick = () => {
        const checked = [...panel.querySelectorAll('.qr-cb:checked')].map(cb => cb.dataset.fid);
        if (checked.length) restoreRecycleFiles(panel, checked);
      };
      panel.querySelector('#qr-del-sel').onclick = () => {
        const checked = [...panel.querySelectorAll('.qr-cb:checked')].map(cb => cb.dataset.recordId);
        if (checked.length) deleteRecycleFiles(panel, checked);
      };

      await loadRecycleList(panel);
    }

    async function loadRecycleList(panel) {
      const listEl = panel.querySelector('#qr-list');
      try {
        const res = await fetch(`https://drive-pc.quark.cn/1/clouddrive/file/deep_recycle/list?${PARAMS}&_page=1&_size=100&_fetch_total=1&_t=${Date.now()}`, { credentials: 'include' });
        const d = await res.json();
        const files = d.data?.list || [];
        const total = d.data?.deep_recycle_stat?.deep_recycle_count || files.length;
        if (!files.length) { listEl.textContent = '回收站为空'; return; }

        listEl.innerHTML = `
          <div style="margin-bottom:8px;color:#94a3b8;display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="qr-all"> <label for="qr-all">全选（共 ${total} 个）</label>
          </div>` +
          files.map(f => `
            <div style="padding:6px 0;border-bottom:1px solid #f8fafc;display:flex;align-items:center;gap:8px">
              <input type="checkbox" class="qr-cb" data-fid="${f.fid}" data-record-id="${f.record_id}">
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.file_name}</span>
              <span style="color:#94a3b8;white-space:nowrap;font-size:12px">${new Date(f.updated_at || Date.now()).toLocaleDateString()}</span>
            </div>`).join('');

        // Full-select checkbox
        panel.querySelector('#qr-all').onchange = (e) => {
          panel.querySelectorAll('.qr-cb').forEach(cb => cb.checked = e.target.checked);
          updateRestoreBtn(panel);
        };
        panel.querySelectorAll('.qr-cb').forEach(cb => cb.onchange = () => updateRestoreBtn(panel));
      } catch (e) { listEl.textContent = '加载失败'; }
    }

    function updateRestoreBtn(panel) {
      const count = panel.querySelectorAll('.qr-cb:checked').length;
      const btn = panel.querySelector('#qr-restore-sel');
      const delBtn = panel.querySelector('#qr-del-sel');
      btn.style.display = count ? 'block' : 'none';
      btn.textContent = `还原选中 (${count})`;
      delBtn.style.display = count ? 'block' : 'none';
      delBtn.textContent = `彻底删除 (${count})`;
    }

    async function deleteRecycleFiles(panel, recordIds) {
      if (!confirm(`确定要彻底删除选中的 ${recordIds.length} 个文件吗？此操作不可恢复！`)) return;
      const listEl = panel.querySelector('#qr-list');
      listEl.textContent = '删除中…';
      try {
        const r = await fetch(`https://drive-pc.quark.cn/1/clouddrive/file/recycle/remove?${PARAMS}`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ select_mode: 2, record_list: recordIds })
        }).then(r => r.json());
        if (r.code === 0) {
          listEl.textContent = `已彻底删除 ${recordIds.length} 个文件，3秒后刷新…`;
          setTimeout(() => loadRecycleList(panel), 3000);
        } else {
          listEl.textContent = `删除失败: ${r.message}`;
        }
      } catch (e) { listEl.textContent = '操作失败: ' + e.message; }
    }

    async function restoreRecycleFiles(panel, fids) {
      if (!confirm(`确定要还原选中的 ${fids.length} 个文件吗？`)) return;
      const listEl = panel.querySelector('#qr-list');
      listEl.textContent = '还原中…';
      try {
        const r = await fetch(`https://drive-pc.quark.cn/1/clouddrive/file/recycle/recover?${PARAMS}`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fids, select_mode: 1 })
        }).then(r => r.json());
        if (r.code === 0) {
          listEl.textContent = `已还原 ${fids.length} 个文件`;
          setTimeout(() => loadRecycleList(panel), 1500);
        } else {
          listEl.textContent = `还原失败: ${r.message}`;
        }
      } catch (e) { listEl.textContent = '操作失败: ' + e.message; }
    }

    // Wait for sidebar to render
    const ob = new MutationObserver(() => { if (document.querySelector('.ant-menu')) { injectRecycleBtn(); } });
    ob.observe(document.body, { childList: true, subtree: true });
    setTimeout(injectRecycleBtn, 2000);

    return;
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

    const savedTitle = getSourceTitle() ? cleanMovieName(getSourceTitle()) : '';

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
    const newName = cleanMovieName(rawName);

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

  function cleanMovieName(raw) {
    // Extract year
    const yearMatch = raw.match(/[\(\（](\d{4})[\)\）]/);
    const year = yearMatch ? yearMatch[1] : '';

    // If title is wrapped in 【】, extract it first
    const bracketTitle = raw.match(/^[^【\[（(a-zA-Z\u4e00-\u9fff]*【([^】]+)】/);
    let name = bracketTitle ? bracketTitle[1] : raw;

    name = name
      .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}]/gu, '')
      .replace(/[🔥✅⭐★☆▶️🎬🎥💎🌟✨🎞️📽️]/g, '')
      .replace(/【[^】]*】/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/（[^）]*）/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[\/\\:*?"<>|]/g, '')
      .replace(/[ˍ˜~·•]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (year) name = `${name} (${year})`.replace(/\s+/g, ' ').trim();
    return name.slice(0, 100);
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
