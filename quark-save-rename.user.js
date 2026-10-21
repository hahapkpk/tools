// ==UserScript==
// @name         夸克网盘保存并重命名
// @namespace    local.codex
// @version      0.9.0
// @description  在夸克网盘分享页面保存文件夹到网盘后自动重命名为指定名称；并在网盘列表页提供回收站管理面板。
// @author       hahapkpk
// @license      MIT
// @match        https://pan.quark.cn/s/*
// @match        https://pan.quark.cn/list*
// @run-at       document-start
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/quark-save-rename.user.js
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/quark-save-rename.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;

  const SCRIPT_ID = 'quark-save-rename';
  const CHANNEL = new BroadcastChannel('quark-save-rename');
  const PARAMS = 'pr=ucpro&fr=pc&uc_param_str=';
  const API = 'https://drive-pc.quark.cn/1/clouddrive';

  // ── 网盘列表页：接收重命名指令 + 回收站入口 ──────────────────────────────────
  if (location.pathname.startsWith('/list')) {
    CHANNEL.onmessage = async (e) => {
      const data = e.data || {};
      const fids = Array.isArray(data.fids) ? data.fids : (data.fid ? [data.fid] : []);
      if (!fids.length || !data.name) return;
      for (const fid of fids) {
        try {
          const res = await fetch(`${API}/file/rename?${PARAMS}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ fid, file_name: data.name })
          });
          const d = await res.json();
          console.log('[quark-rename]', fid, d.code, d.message);
        } catch (err) { console.error('[quark-rename] error:', err); }
      }
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
      listEl.textContent = '加载中…';
      // Reset buttons
      panel.querySelector('#qr-del-sel').style.display = 'none';
      panel.querySelector('#qr-restore-sel').style.display = 'none';
      try {
        const res = await fetch(`${API}/file/deep_recycle/list?${PARAMS}&_page=1&_size=100&fetch_pdir_file_name=1&sort=move_recycle_at:desc&_t=${Date.now()}`, { credentials: 'include' });
        const d = await res.json();
        const files = d.data?.list || [];
        if (!files.length) { listEl.textContent = '回收站为空'; return; }

        // 接口没返回 deep_recycle_stat，这里以实际取到的条数为准
        const label = files.length >= 100 ? '全选（本页 100 条）' : `全选（共 ${files.length} 个）`;
        listEl.innerHTML = `
          <div style="margin-bottom:8px;color:#94a3b8;display:flex;align-items:center;gap:8px">
            <input type="checkbox" id="qr-all"> <label for="qr-all">${escapeHtml(label)}</label>
          </div>` +
          files.map(f => `
            <div style="padding:6px 0;border-bottom:1px solid #f8fafc;display:flex;align-items:center;gap:8px">
              <input type="checkbox" class="qr-cb" data-fid="${escapeHtml(f.fid)}" data-record-id="${escapeHtml(f.record_id)}">
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.file_name)}</span>
              <span style="color:#94a3b8;white-space:nowrap;font-size:12px">${new Date(f.updated_at || Date.now()).toLocaleDateString()}</span>
            </div>`).join('');

        const allCb = panel.querySelector('#qr-all');
        if (allCb) allCb.onchange = (e) => {
          panel.querySelectorAll('.qr-cb').forEach(cb => cb.checked = e.target.checked);
          updateRestoreBtn(panel);
        };
        panel.querySelectorAll('.qr-cb').forEach(cb => cb.onchange = () => updateRestoreBtn(panel));
      } catch (e) { listEl.textContent = '加载失败: ' + e.message; }
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

    function removeRows(panel, recordIds) {
      recordIds.forEach(rid => {
        const cb = panel.querySelector(`.qr-cb[data-record-id="${cssEscape(rid)}"]`);
        if (cb) cb.closest('div').remove();
      });
      const left = panel.querySelectorAll('.qr-cb').length;
      const totalEl = panel.querySelector('#qr-all')?.parentElement;
      if (totalEl) {
        const label = totalEl.querySelector('label');
        if (label) label.textContent = `全选（共 ${left} 个）`;
      }
      if (!left) {
        const listEl = panel.querySelector('#qr-list');
        if (listEl) listEl.textContent = '回收站为空';
      }
      updateRestoreBtn(panel);
    }

    async function deleteRecycleFiles(panel, recordIds) {
      if (!confirm(`确定要彻底删除选中的 ${recordIds.length} 个文件吗？此操作不可恢复！`)) return;
      const btn = panel.querySelector('#qr-del-sel');
      const oldText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '删除中…';
      try {
        const r = await fetch(`${API}/file/recycle/remove?${PARAMS}`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ select_mode: 2, record_list: recordIds })
        }).then(r => r.json());
        if (r.code === 0) {
          // API 有缓存延迟，直接从 DOM 摘掉已删除的行
          removeRows(panel, recordIds);
        } else {
          alert(`删除失败: ${r.message}`);
        }
      } catch (e) { alert('操作失败: ' + e.message); }
      finally { btn.disabled = false; btn.textContent = oldText; }
    }

    async function restoreRecycleFiles(panel, fids) {
      if (!confirm(`确定要还原选中的 ${fids.length} 个文件吗？`)) return;
      const btn = panel.querySelector('#qr-restore-sel');
      const oldText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '还原中…';
      try {
        const r = await fetch(`${API}/file/recycle/recover?${PARAMS}`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fids, select_mode: 1 })
        }).then(r => r.json());
        if (r.code === 0) {
          const recordIds = fids.map(fid => {
            const cb = panel.querySelector(`.qr-cb[data-fid="${cssEscape(fid)}"]`);
            return cb ? cb.dataset.recordId : null;
          }).filter(Boolean);
          removeRows(panel, recordIds);
          setTimeout(() => loadRecycleList(panel), 1200);
        } else {
          alert(`还原失败: ${r.message}`);
        }
      } catch (e) { alert('操作失败: ' + e.message); }
      finally { btn.disabled = false; btn.textContent = oldText; }
    }

    function cssEscape(value) {
      if (window.CSS && window.CSS.escape) return window.CSS.escape(String(value));
      return String(value).replace(/["\\]/g, '\\$&');
    }

    function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[ch]));
    }

    // Wait for sidebar to render
    const ob = new MutationObserver(() => { if (document.querySelector('.ant-menu')) injectRecycleBtn(); });
    ob.observe(document.body, { childList: true, subtree: true });
    setTimeout(injectRecycleBtn, 2000);

    return;
  }

  // ── 分享页：Hook 保存接口（document-start，必须在站点代码之前） ───────────────

  hookSaveAPI();

  // ── UI ──────────────────────────────────────────────────────────────────────

  function getSourceTitle() {
    // Read title from URL hash: #/list/share?_title=xxx
    const m = location.hash.match(/_title=([^&]+)/);
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch (_) { return ''; }
  }

  function buildBar(value) {
    const bar = document.createElement('div');
    bar.id = SCRIPT_ID;
    bar.style.cssText = [
      'display:inline-flex', 'gap:6px', 'align-items:center',
      'font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'margin-left:12px', 'vertical-align:middle'
    ].join(';');

    const input = document.createElement('input');
    input.id = `${SCRIPT_ID}-input`;
    input.type = 'text';
    input.placeholder = '保存后重命名（可选）';
    input.value = value;
    input.style.cssText = 'width:280px;padding:4px 8px;border:1px solid #cbd5e1;border-radius:5px;font:inherit;outline:none;height:32px;box-sizing:border-box';

    const status = document.createElement('span');
    status.id = `${SCRIPT_ID}-status`;
    status.style.cssText = 'color:#64748b;font-size:12px;white-space:nowrap';

    bar.appendChild(input);
    bar.appendChild(status);
    return bar;
  }

  /**
   * 只往真正的分享信息区里插；插不进去就返回 false 交给重试。
   * 旧实现只要页面上出现任意 <button> 就注入，header 还没渲染时会掉进浮动兜底并永久停在那里。
   */
  function injectUI() {
    if (document.getElementById(SCRIPT_ID)) return true;

    const target = document.querySelector('.share-info-wrap, [class*="share-info-wrap"]');
    if (!target) return false;

    const rawTitle = getSourceTitle();
    if (rawTitle) console.debug('[quark-save-rename] _title =', rawTitle);

    const cleaned = rawTitle ? cleanMovieName(rawTitle) : '';
    if (rawTitle && !cleaned) {
      console.warn('[quark-save-rename] 标题清洗后为空，请手动填写：', JSON.stringify(rawTitle));
    }

    const bar = buildBar(cleaned);
    target.style.display = 'flex';
    target.style.alignItems = 'center';
    target.appendChild(bar);
    return true;
  }

  function injectFloatingBar() {
    if (document.getElementById(SCRIPT_ID)) return;
    const bar = buildBar('');
    bar.style.cssText += ';position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(255,255,255,.96);border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;box-shadow:0 4px 16px rgba(15,23,42,.15)';
    (document.body || document.documentElement).appendChild(bar);
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
      this._qsrUrl = url;
      return origOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (body) {
      if (/sharepage\/save/.test(String(this._qsrUrl || ''))) {
        this.addEventListener('load', function () {
          try {
            const d = JSON.parse(this.responseText);
            if (d?.data?.task_id) onSaveTaskCreated(d.data.task_id);
          } catch (_) {}
        });
      }
      return origSend.call(this, body);
    };

    // 初始的 fetch 也要包一层：旧实现只包装「页面重新赋值」后的 fetch，
    // 站点一直用原生 fetch 时钩子根本不会生效。
    const origFetch = window.fetch;
    const wrap = (fn) => {
      if (typeof fn !== 'function' || fn.__qsrWrapped) return fn;
      const wrapped = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const p = fn.call(this, input, init);
        if (/sharepage\/save/.test(url)) {
          p.then(r => r.clone().json()
            .then(d => { if (d?.data?.task_id) onSaveTaskCreated(d.data.task_id); })
            .catch(() => {})).catch(() => {});
        }
        return p;
      };
      wrapped.__qsrWrapped = true;
      return wrapped;
    };

    let _fetch = wrap(origFetch);
    try {
      Object.defineProperty(window, 'fetch', {
        get() { return _fetch; },
        set(fn) { _fetch = wrap(fn); },
        configurable: true
      });
    } catch (_) {
      window.fetch = _fetch;
    }
  }

  // ── After save: poll task → get fid → rename ─────────────────────────────────

  async function onSaveTaskCreated(taskId) {
    const input = document.getElementById(`${SCRIPT_ID}-input`);
    const rawName = input?.value?.trim();
    if (!rawName) { setStatus('未填写新名称，跳过重命名', '#64748b'); return; }

    const newName = cleanMovieName(rawName);
    if (!newName) {
      setStatus('名称清洗后为空，已跳过（请手动填写）', '#b91c1c');
      return;
    }
    if (input && newName !== rawName) input.value = newName;

    setStatus('保存中…', '#0f766e');
    const fids = await pollTask(taskId);
    if (!fids.length) { setStatus('获取 fid 失败', '#b91c1c'); return; }

    setStatus(`重命名中… (${fids.length})`, '#7c3aed');

    let ok = 0;
    let lastError = '';
    let networkFail = false;

    for (const fid of fids) {
      const r = await renameOne(fid, newName);
      if (r.ok) ok++;
      else { lastError = r.message || lastError; networkFail = networkFail || r.network; }
    }

    if (ok === fids.length) {
      setStatus(fids.length > 1 ? `✓ 已重命名 ${ok} 项` : '✓ 已重命名', '#047857');
    } else if (ok > 0) {
      setStatus(`部分成功 ${ok}/${fids.length}`, '#b45309');
    } else if (networkFail) {
      // 直连被拦（跨域/网络）时，交给已打开的网盘列表页兜底
      CHANNEL.postMessage({ fids, name: newName });
      setStatus(`直连失败，已转交网盘页重试：${lastError}`, '#b45309');
    } else {
      setStatus(`失败：${lastError || '未知错误'}`, '#b91c1c');
    }
  }

  async function pollTask(taskId, retries = 25) {
    for (let i = 0; i < retries; i++) {
      await sleep(800);
      try {
        const res = await fetch(`${API}/task?${PARAMS}&task_id=${encodeURIComponent(taskId)}&retry_index=${i}`, { credentials: 'include' });
        const data = await res.json();
        const status = data?.data?.status;
        // status 2 = done；一次保存多个条目时逐个处理，不再只取第一个
        if (status === 2) {
          const list = data?.data?.save_as?.save_as_top_fids;
          return Array.isArray(list) ? list.filter(Boolean) : [];
        }
        if (typeof status === 'number' && status > 2) return [];
      } catch (_) {}
    }
    return [];
  }

  async function renameOne(fid, name, attempts = 3) {
    let lastError = '';
    for (let i = 0; i < attempts; i++) {
      // 任务刚完成时文件可能还没落盘，第一次多等一会儿
      await sleep(i === 0 ? 1500 : 1200);
      try {
        const res = await fetch(`${API}/file/rename?${PARAMS}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fid, file_name: name })
        });
        const d = await res.json();
        if (d.code === 0) return { ok: true };
        // 业务错误（重名、非法字符等）重试没有意义
        return { ok: false, message: d.message || `code ${d.code}`, network: false };
      } catch (err) {
        lastError = err?.message || String(err);
      }
    }
    return { ok: false, message: lastError, network: true };
  }

  function cleanMovieName(raw) {
    const src = String(raw || '').trim();
    if (!src) return '';

    // 年份：优先括号内的 19xx/20xx，其次空格/点分隔的独立年份
    const ym = src.match(/[（(]\s*((?:19|20)\d{2})\s*[)）]/) ||
               src.match(/(?:^|[\s._-])((?:19|20)\d{2})(?=[\s._-]|$)/);
    const year = ym ? ym[1] : '';

    // 只剥离标签，绝不把【】里的内容当片名（旧实现会因此把真名整段丢掉）
    const name = src
      .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{FE0F}\u{200D}]/gu, ' ')
      .replace(/【[^】]*】/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/（[^）]*）/g, ' ')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[\/\\:*?"<>|]/g, ' ')
      .replace(/[ˍ˜~·•]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // 剥完连一个字都没有：宁可留空让用户手填，也不要只留一个 (年份)
    if (!name || !/[\p{L}\p{N}]/u.test(name)) return '';

    const out = year && !name.includes(year) ? `${name} (${year})` : name;
    return out.replace(/\s+/g, ' ').trim().slice(0, 100);
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Init ─────────────────────────────────────────────────────────────────────

  function init() {
    let tries = 0;
    const tick = () => {
      if (injectUI()) return;
      // 等分享信息区渲染，最多 10 秒；仍然没有才退回浮动条
      if (++tries > 20) { injectFloatingBar(); return; }
      setTimeout(tick, 500);
    };
    tick();
  }

  init();
})();
