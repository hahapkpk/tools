// ==UserScript==
// @name         湖北专技继续教育 · 一键学习（后台模式）
// @namespace    local.hubeizj.auto-complete
// @version      3.0.0
// @description  个人中心/我的课程页一键后台把课程刷到 100%：纯接口上报，不再跳转播放页，面板实时显示课程与课件进度，可选自动提交课程评价。
// @author       Flywind
// @match        https://hubeizj.chinamde.cn/me/*
// @run-at       document-idle
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/hubeizj-auto-complete.user.js
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/hubeizj-auto-complete.user.js
// ==/UserScript==

(() => {
  'use strict';

  const HMAC_KEY = '1ut189dff111d4fb6hangchengf7b6';
  const APP_KEY = 'hangcheng.websites';
  const HOST_ID = 'hbzj-auto-complete';
  const GAP = 5300;      // 两次上报间隔（<5s 会触发 1103 上报过频）
  const EVAL_GAP = 900;

  const EP = {
    courses: '/website/courseCourse/getBuyCourseRecordByIds',
    info: '/website/courseCourse/getLearnInfo',
    video: '/website/courseCourse/getVideo',
    save: '/website/courseCourse/saveLeaningRecord',
    evaluate: '/website/courseCourse/saveEvaluate',
    archives: '/website/user/center/learningArchives',
  };

  const S = {
    running: false,
    stop: false,
    autoEval: true,
    year: String(new Date().getFullYear()),
    list: [],
    logs: [],
    current: '',
    archives: null,
    status: '就绪',
  };

  /* ---------------- 接口层 ---------------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const enc = new TextEncoder();

  async function hmacSha1(msg) {
    const key = await crypto.subtle.importKey('raw', enc.encode(HMAC_KEY), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function canon(obj) {
    return Object.keys(obj).sort().filter((k) => obj[k] !== null && obj[k] !== undefined)
      .map((k) => `${k}=${Array.isArray(obj[k]) ? JSON.stringify(obj[k]) : obj[k]}&`).join('');
  }

  function authToken() {
    const m = document.cookie.match(/(?:^|; )Authorization=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function api(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const token = authToken();
    if (!token) throw new Error('未登录');
    const headers = { appkey: APP_KEY, Authorization: 'Bearer ' + token, appName: 'Chrome' };
    let url = `${location.origin}/api${path}`;
    let body;
    if (method === 'GET') {
      const params = opts.params || {};
      headers.signature = await hmacSha1(canon(params));
      const qs = new URLSearchParams(params).toString();
      if (qs) url += '?' + qs;
    } else {
      body = JSON.stringify(opts.data || {});
      headers['Content-Type'] = 'application/json';
      headers.signature = await hmacSha1(canon(opts.data || {}));
    }
    const resp = await fetch(url, { method, headers, body, credentials: 'include' });
    const text = await resp.text();
    let json;
    try { json = JSON.parse(text); } catch (e) { throw new Error(`接口异常(${resp.status})`); }
    if (json && json.code === 401) throw new Error('登录已失效，请刷新页面');
    return json;
  }

  /* ---------------- 业务层 ---------------- */

  function log(msg) {
    const t = new Date().toTimeString().slice(0, 8);
    S.logs.unshift(`${t} ${msg}`);
    S.logs = S.logs.slice(0, 40);
    render();
  }

  function setStatus(t) { S.status = t; render(); }

  async function fetchCourses() {
    const r = await api(EP.courses, { method: 'POST', data: { year: '2024', isfinish: '', pageNum: 1, pageSize: 100, courseTypeId: 13967 } });
    const rows = (r && r.rows) || [];
    if (rows.length && rows[0].year) S.year = String(rows[0].year);
    return rows;
  }

  async function fetchLessons(courseId) {
    const r = await api(EP.info, { params: { courseId, year: S.year } });
    const ls = [];
    (r.data || []).forEach((ch) => (ch.children || []).forEach((x) => ls.push({ id: x.id, p: String(x.percentName || '') })));
    return ls;
  }

  async function loadArchives() {
    try {
      const a = await api(EP.archives, { params: { year: S.year } });
      S.archives = a.data || null;
    } catch (e) { /* ignore */ }
  }

  async function scan() {
    if (S.running) return;
    setStatus('正在读取课程列表…');
    const rows = await fetchCourses();
    S.list = rows.map((r) => ({
      id: r.id,
      name: String(r.courseName || '').replace(/\s+/g, ' '),
      short: String(r.courseName || '').slice(0, 16),
      hc: Number(r.hourCount) || 0,
      pct: parseFloat(String(r.percentName || '0')) || 0,
      ev: Number(r.isEvaluate) || 0,
      lessons: null,
      totalN: 0,
      doneN: 0,
      state: '待处理',
    }));
    render();
    for (const c of S.list) {
      try {
        c.lessons = await fetchLessons(c.id);
        c.totalN = c.lessons.length;
        c.doneN = c.lessons.filter((l) => l.p === '100').length;
        c.pct = c.totalN ? Math.round((c.doneN / c.totalN) * 100) : c.pct;
        c.state = c.doneN === c.totalN ? (c.ev ? '已完成' : '待评价') : '未完成';
      } catch (e) {
        c.state = '读取失败';
      }
      render();
    }
    await loadArchives();
    const left = S.list.filter((c) => c.doneN < c.totalN).length;
    setStatus(left ? `就绪：${left} 门课未学完` : '就绪：全部课程已学完');
    log(`读取完成：${S.list.length} 门课程，${left} 门未学完`);
  }

  async function save(courseId, hourId, sec, dur) {
    return api(EP.save, {
      method: 'POST',
      data: { courseId: String(courseId), classHourId: String(hourId), second: String(sec), duration: String(dur), remoteType: 'pc' },
    });
  }

  async function learnLesson(c, L) {
    let hc = 0, cur = 0;
    for (let i = 0; i < 3; i++) {
      try {
        const gv = await api(EP.video, { params: { hourId: L.id, courseId: c.id } });
        hc = Number(gv.data && gv.data.hourCount) || 0;
        cur = Number(gv.data && gv.data.second) || 0;
        break;
      } catch (e) { await sleep(1500); }
    }
    if (hc && cur >= hc) return { ok: true, skip: true };
    const target = cur + 20;
    let r1, r2;
    try { r1 = await save(c.id, L.id, target, hc || target); } catch (e) { r1 = { code: -1, msg: String(e) }; }
    if (r1.code === 4022) return { ok: true, skip: true };
    await sleep(GAP);
    try { r2 = await save(c.id, L.id, target, target); } catch (e) { r2 = { code: -1, msg: String(e) }; }
    if (r2.code === 200 || r2.code === 4022) return { ok: true };
    if (r2.code === 1103) { await sleep(9000); return { ok: false, retry: true, msg: '1103 上报过频' }; }
    if (r2.code === 601) { await sleep(2500); return { ok: false, retry: true, msg: '601 倍速异常' }; }
    return { ok: false, msg: `${r2.code} ${r2.msg || ''}` };
  }

  async function evaluate(c) {
    try {
      const r = await api(EP.evaluate, {
        method: 'POST',
        data: {
          courseId: String(c.id), teacherScore: 0, teacherComment: '', score: 5, comment: '',
          organizationScore: 0, organizationComment: '', studyScore: 0, studyComment: '',
          schoolScore: 0, schoolComment: '', trainingScore: 0, trainingComment: '',
        },
      });
      await sleep(EVAL_GAP);
      if (r.code === 200) { c.ev = 1; log(`✓ 已评价：${c.short}`); return true; }
      log(`✗ 评价失败：${c.short} ${r.code} ${r.msg || ''}`);
      return false;
    } catch (e) { log(`✗ 评价异常：${c.short}`); return false; }
  }

  async function run() {
    if (S.running) return;
    if (!S.list.length) await scan();
    S.running = true;
    S.stop = false;
    render();
    setStatus('后台学习中…');
    let fails = 0;
    for (const c of S.list) {
      if (S.stop) break;
      if (!c.lessons) {
        try {
          c.lessons = await fetchLessons(c.id);
          c.totalN = c.lessons.length;
          c.doneN = c.lessons.filter((l) => l.p === '100').length;
        } catch (e) { continue; }
      }
      const todo = c.lessons.filter((l) => l.p !== '100');
      if (todo.length) {
        c.state = '学习中';
        log(`▶ ${c.short}（${todo.length} 个课件待学）`);
        for (const L of todo) {
          if (S.stop) break;
          S.current = `${c.short} · 课件 ${c.doneN + 1}/${c.totalN}`;
          render();
          let res = await learnLesson(c, L);
          if (!res.ok && res.retry) res = await learnLesson(c, L);
          if (res.ok) {
            L.p = '100';
            c.doneN += 1;
            c.pct = c.totalN ? Math.round((c.doneN / c.totalN) * 100) : c.pct;
            fails = 0;
            log(`✓ ${c.short} 课件 ${c.doneN}/${c.totalN}`);
          } else {
            fails += 1;
            log(`✗ ${c.short} 课件失败：${res.msg || '未知'}`);
            if (fails >= 5) { log('连续失败过多，已停止'); S.stop = true; break; }
          }
          render();
        }
      }
      // 处理完用服务端数据校准，避免面板虚报
      try {
        const fresh = await fetchLessons(c.id);
        c.lessons = fresh;
        c.totalN = fresh.length;
        c.doneN = fresh.filter((l) => l.p === '100').length;
        c.pct = c.totalN ? Math.round((c.doneN / c.totalN) * 100) : c.pct;
      } catch (e) { /* ignore */ }
      if (c.doneN === c.totalN) {
        c.pct = 100;
        c.state = S.autoEval && !c.ev ? '待评价' : '已完成';
        if (S.autoEval && !c.ev) {
          S.current = `${c.short} · 提交评价`;
          render();
          if (await evaluate(c)) c.state = '已完成';
        }
      }
      render();
    }
    await loadArchives();
    S.running = false;
    S.current = '';
    setStatus(S.stop ? '已停止' : '全部完成');
    log(S.stop ? '已手动停止' : '全部课程处理完毕');
    render();
  }

  /* ---------------- 面板 ---------------- */

  const css = `
    #${HOST_ID}{position:fixed;right:18px;bottom:18px;width:430px;z-index:2147483000;font:13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2430;
      background:#fff;border:1px solid rgba(24,84,182,.18);border-radius:12px;box-shadow:0 12px 36px rgba(16,42,86,.22);overflow:hidden}
    #${HOST_ID} .hd{display:flex;align-items:center;gap:8px;padding:10px 12px;background:linear-gradient(135deg,#1a5fbe,#2f8bf0);color:#fff;cursor:move;user-select:none}
    #${HOST_ID} .hd b{font-size:13px;font-weight:600;flex:1}
    #${HOST_ID} .hd .dot{width:8px;height:8px;border-radius:50%;background:#8ef2b1;box-shadow:0 0 0 3px rgba(142,242,177,.25)}
    #${HOST_ID} .hd button{background:rgba(255,255,255,.18);border:0;color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:12px}
    #${HOST_ID} .bd{padding:10px 12px 12px;max-height:min(70vh,560px);overflow:auto}
    #${HOST_ID} .row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
    #${HOST_ID} .bar{height:8px;border-radius:5px;background:#e8eef8;overflow:hidden;flex:1}
    #${HOST_ID} .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#2f8bf0,#22c07a);transition:width .3s}
    #${HOST_ID} .pct{font-variant-numeric:tabular-nums;color:#1a5fbe;font-weight:600;min-width:42px;text-align:right}
    #${HOST_ID} .cur{color:#65707f;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:18px}
    #${HOST_ID} .list{margin:6px 0 8px;border-top:1px dashed #e2e8f2;max-height:230px;overflow:auto}
    #${HOST_ID} .item{display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px dashed #eef2f8;font-size:12px}
    #${HOST_ID} .item .n{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    #${HOST_ID} .item .s{color:#65707f;font-variant-numeric:tabular-nums;white-space:nowrap}
    #${HOST_ID} .item.done .s{color:#22a06b}
    #${HOST_ID} .item.run .s{color:#2f8bf0;font-weight:600}
    #${HOST_ID} .ctl{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    #${HOST_ID} .btn{border:0;border-radius:8px;padding:7px 14px;font-size:13px;cursor:pointer;font-weight:600}
    #${HOST_ID} .btn.go{background:linear-gradient(135deg,#1a5fbe,#2f8bf0);color:#fff}
    #${HOST_ID} .btn.stop{background:#ffe9e9;color:#c0392b}
    #${HOST_ID} .btn.ghost{background:#eef3fb;color:#31527f}
    #${HOST_ID} .btn:disabled{opacity:.45;cursor:not-allowed}
    #${HOST_ID} label{display:flex;align-items:center;gap:5px;color:#65707f;font-size:12px;cursor:pointer}
    #${HOST_ID} .logs{margin-top:8px;border-top:1px dashed #e2e8f2;padding-top:6px;font-size:11.5px;color:#7b8595;max-height:110px;overflow:auto;font-family:Consolas,monospace}
    #${HOST_ID}.fold .bd{display:none}
  `;

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function mount() {
    if (document.getElementById(HOST_ID)) return;
    const st = document.createElement('style');
    st.textContent = css;
    document.documentElement.appendChild(st);
    const box = document.createElement('div');
    box.id = HOST_ID;
    box.innerHTML = `
      <div class="hd"><span class="dot"></span><b>一键学习 · 后台版（湖北专技）</b><button data-fold>收起</button></div>
      <div class="bd">
        <div class="row"><span class="pct" data-pct>0%</span><div class="bar"><i data-bar></i></div></div>
        <div class="cur" data-cur></div>
        <div class="list" data-list></div>
        <div class="ctl">
          <button class="btn go" data-go>一键后台学完</button>
          <button class="btn stop" data-stop disabled>停止</button>
          <button class="btn ghost" data-rescan>刷新</button>
          <label><input type="checkbox" data-auto checked> 自动评价</label>
        </div>
        <div class="logs" data-logs></div>
      </div>`;
    document.body.appendChild(box);

    box.querySelector('[data-fold]').onclick = () => box.classList.toggle('fold');
    box.querySelector('[data-go]').onclick = () => { run().catch((e) => { log('异常：' + e.message); S.running = false; render(); }); };
    box.querySelector('[data-stop]').onclick = () => { S.stop = true; setStatus('正在停止…'); };
    box.querySelector('[data-rescan]').onclick = () => { scan().catch((e) => log('读取失败：' + e.message)); };
    box.querySelector('[data-auto]').onchange = (ev) => { S.autoEval = ev.target.checked; };

    const hd = box.querySelector('.hd');
    let drag = null;
    hd.addEventListener('mousedown', (e) => { if (e.target.tagName === 'BUTTON') return; drag = { x: e.clientX, y: e.clientY, r: box.getBoundingClientRect() }; });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      box.style.left = Math.max(4, drag.r.left + e.clientX - drag.x) + 'px';
      box.style.top = Math.max(4, drag.r.top + e.clientY - drag.y) + 'px';
      box.style.right = 'auto'; box.style.bottom = 'auto';
    });
    window.addEventListener('mouseup', () => { drag = null; });
    render();
  }

  function render() {
    const box = document.getElementById(HOST_ID);
    if (!box) return;
    const totalN = S.list.reduce((a, c) => a + (c.totalN || 0), 0);
    const doneN = S.list.reduce((a, c) => a + (c.doneN || 0), 0);
    const pct = totalN ? Math.round((doneN / totalN) * 100) : 0;
    box.querySelector('[data-pct]').textContent = pct + '%';
    box.querySelector('[data-bar]').style.width = pct + '%';
    box.querySelector('[data-cur]').textContent = S.running ? (S.current || S.status) : S.status;

    const list = box.querySelector('[data-list]');
    list.innerHTML = S.list.map((c) => {
      const p = c.totalN ? Math.round((c.doneN / c.totalN) * 100) : (c.pct || 0);
      const cls = p >= 100 ? 'done' : (c.state === '学习中' ? 'run' : '');
      return `<div class="item ${cls}"><span class="n" title="${escapeHtml(c.name)}">${escapeHtml(c.short)}</span><span class="s">${p}%</span><span class="s">${c.doneN}/${c.totalN || '?'}</span><span class="s">${escapeHtml(c.state)}</span></div>`;
    }).join('') || '<div class="item"><span class="n">暂无课程，点「刷新」</span></div>';

    const arch = S.archives;
    if (arch && arch.classHourInfoList && arch.classHourInfoList.length) {
      const h = arch.classHourInfoList.map((x) => `${x.courseType} ${x.completedCourseHourCount}/${x.courseHourCount || '-'}`).join(' ｜ ');
      list.insertAdjacentHTML('beforeend', `<div class="item"><span class="n" style="color:#65707f">本年学时：${escapeHtml(h)}</span></div>`);
    }

    box.querySelector('[data-go]').disabled = S.running;
    box.querySelector('[data-stop]').disabled = !S.running;
    box.querySelector('[data-logs]').innerHTML = S.logs.slice(0, 12).map((l) => `<div>${escapeHtml(l)}</div>`).join('');
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    if (location.pathname.indexOf('/me/') !== 0) return;
    mount();
    scan().catch((e) => log('读取失败：' + e.message));
  }

  window.__hbzj = { S, run, scan, api, log, render };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  let last = location.pathname;
  setInterval(() => {
    if (location.pathname !== last) {
      last = location.pathname;
      if (location.pathname.indexOf('/me/') === 0) setTimeout(boot, 800);
    }
  }, 1200);
})();
