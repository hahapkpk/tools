// ==UserScript==
// @name         湖北专技继续教育 · 考试助手
// @namespace    local.hubeizj.exam-solver
// @version      1.1.0
// @description  考试页自动作答：从已交卷考试建立题库，按题干匹配填答；一键交卷并把本场答案入库。
// @author       Flywind
// @match        https://hubeizj.chinamde.cn/exam/*
// @run-at       document-idle
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/hubeizj-exam-solver.user.js
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/hubeizj-exam-solver.user.js
// ==/UserScript==

(() => {
  'use strict';

  const HMAC_KEY = '1ut189dff111d4fb6hangchengf7b6';
  const APP_KEY = 'hangcheng.websites';
  const BANK_KEY = 'hbzj_exam_bank_v1';
  const HOST_ID = 'hbzj-exam-solver';
  const GAP = 350;

  const EP = {
    detail: '/website/trainExam/subjectDetail',
    answer: '/website/trainExam/answerProcess',
    check: '/website/trainExam/submit/check',
    submit: '/website/trainExam/submitExamination',
    result: '/website/trainExam/examRecordResult',
    recordDetail: '/website/trainExam/examRecordDetail',
    recordList: '/website/user/center/examRecordList',
  };

  /* ---------------- 基础 ---------------- */

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
    const headers = { appkey: APP_KEY, Authorization: 'Bearer ' + token };
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
    try { return JSON.parse(text); } catch (e) { throw new Error(`接口异常(${resp.status})`); }
  }

  /* ---------------- 题库 ---------------- */

  const norm = (s) => String(s || '')
    .replace(/\s+/g, '')
    .replace(/[“”"'‘’「」『』《》]/g, '')
    .replace(/[，。、；：？！,.;:?!（）()【】\[\]]/g, '')
    .toLowerCase();

  function loadBank() {
    try { return JSON.parse(localStorage.getItem(BANK_KEY) || '{}'); } catch (e) { return {}; }
  }
  const saveBank = (b) => { try { localStorage.setItem(BANK_KEY, JSON.stringify(b)); } catch (e) {} };

  function mergeDetailIntoBank(bank, detail) {
    let subj = detail && detail.subject;
    if (typeof subj === 'string') { try { subj = JSON.parse(subj); } catch (e) { subj = []; } }
    if (!Array.isArray(subj)) return 0;
    let n = 0;
    subj.forEach((s) => {
      const q = norm(s.questContent || '');
      if (q && s.answer) { bank[q] = String(s.answer); n++; }
    });
    return n;
  }

  /* ---------------- 流程 ---------------- */

  async function loadPaper() {
    const examinationId = new URLSearchParams(location.search).get('id');
    if (!examinationId) throw new Error('URL 里没有考试 id');
    const d = await api(EP.detail, { params: { examinationId } });
    if (d.code !== 200 || !d.data) throw new Error('试卷读取失败：' + (d.msg || d.code));
    return { recordId: d.data.examId, paper: d.data };
  }

  async function answerKnown(ui) {
    const { recordId, paper } = await loadPaper();
    const bank = loadBank();
    const bankSize = Object.keys(bank).length;
    ui.log(`试卷《${paper.testpaperName}》${paper.subjectItems.length} 题，题库 ${bankSize} 题`);
    if (!bankSize) ui.log('题库是空的：本次先手动作答，交卷后会自动入库');

    let ok = 0;
    const missing = [];
    for (const s of paper.subjectItems) {
      if (ui.stopped) break;
      const q = norm(s.subjectName || s.questContent || '');
      const a = bank[q];
      const label = String(s.subjectName || '').slice(0, 26);
      if (!a) { missing.push(label); ui.log(`  ? ${label}`); continue; }
      const r = await api(EP.answer, { method: 'POST', data: { recordId, subjectId: String(s.subjectId), answer: a } });
      if (r.code === 200) { ok++; ui.log(`  ✓ ${label} → ${a}`); }
      else ui.log(`  ✗ ${label}：${r.msg || r.code}`);
      ui.progress(ok, paper.subjectItems.length);
      await sleep(GAP);
    }
    if (missing.length) {
      ui.status(`已填 ${ok} 题，还有 ${missing.length} 题需手动`);
      ui.log(`未命中 ${missing.length} 题，请在页面上手动作答，然后点「交卷并入库」`);
    } else {
      ui.status(`已填 ${ok} 题，可以交卷`);
    }
    return { recordId, ok, missing };
  }

  async function submitAndLearn(ui) {
    const { recordId } = await loadPaper();
    const chk = await api(EP.check, { params: { recordId } });
    if (chk.code !== 200) throw new Error('交卷检查失败：' + (chk.msg || chk.code));
    if (chk.data) { ui.status('还有题目未作答，交卷已取消'); ui.log('提交检查：仍有未作答题目'); return; }

    ui.status('交卷中…');
    const sub = await api(EP.submit, { params: { recordId } });
    if (sub.code !== 200) throw new Error('交卷失败：' + (sub.msg || sub.code));
    await sleep(1200);

    const res = await api(EP.result, { params: { recordId } });
    const r = (res && res.data) || {};
    ui.status(`已交卷：${r.score ?? '?'} 分（${r.rightNum ?? '?'}/${r.subjectNum ?? '?'}）`);
    ui.log(`成绩：${r.score} 分，正确率 ${r.rightPercent || ''}`);

    try {
      const det = await api(EP.recordDetail, { params: { recordId } });
      const bank = loadBank();
      const n = mergeDetailIntoBank(bank, det.data);
      saveBank(bank);
      ui.log(`本场答案已入库（+${n} 题，题库共 ${Object.keys(bank).length} 题）`);
    } catch (e) { ui.log('入库失败：' + e.message); }
    return r;
  }

  async function harvestHistory(ui) {
    const bank = loadBank();
    const list = await api(EP.recordList, { params: { pageNum: 1, pageSize: 50 } });
    const rows = (list.data && (list.data.rows || list.data.records)) || (Array.isArray(list.data) ? list.data : []);
    let added = 0;
    for (const r of rows) {
      const rid = r.examinationId || r.id;
      if (!rid) continue;
      try {
        const d = await api(EP.recordDetail, { params: { recordId: rid } });
        added += mergeDetailIntoBank(bank, d.data);
      } catch (e) { /* 未参加的考试没有解析，忽略 */ }
      await sleep(GAP);
    }
    saveBank(bank);
    ui.log(`历史题库合并完成（+${added}，共 ${Object.keys(bank).length} 题）`);
  }

  /* ---------------- 面板 ---------------- */

  const ui = { status: () => {}, log: () => {}, progress: () => {}, stopped: false };

  function buildPanel() {
    const old = document.getElementById(HOST_ID);
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .card{width:330px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.14);
          font:13px/1.55 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#111827;overflow:hidden}
        .hd{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:linear-gradient(135deg,#7c3aed,#6366f1);color:#fff}
        .hd b{font-size:14px}.hd span{opacity:.85;font-size:12px}
        .bd{padding:12px 14px}
        .st{color:#374151;margin-bottom:8px;min-height:18px}
        .bar{height:6px;background:#eef2f7;border-radius:99px;overflow:hidden;margin-bottom:10px}
        .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#8b5cf6,#6366f1);transition:width .3s}
        .btns{display:flex;gap:8px;margin-bottom:8px}
        button{flex:1;border:0;border-radius:8px;padding:8px 0;font-size:13px;cursor:pointer}
        .go{background:#6366f1;color:#fff}.go:disabled{background:#9ca3af}
        .sub{background:#0d9488;color:#fff}.sub:disabled{background:#9ca3af}
        .ghost{background:#f3f4f6;color:#374151}
        .log{max-height:168px;overflow:auto;background:#f9fafb;border-top:1px solid #eef2f7;padding:8px 10px;font-size:12px;color:#4b5563}
        .log div{padding:1px 0;word-break:break-all}
        .tip{font-size:11px;color:#9ca3af;margin-top:6px}
      </style>
      <div class="card">
        <div class="hd"><b>湖北专技 · 考试助手</b><span>自动作答</span></div>
        <div class="bd">
          <div class="st">题库来自已交卷的考试；没命中的题请手动作答</div>
          <div class="bar"><i></i></div>
          <div class="btns">
            <button class="go">自动作答</button>
            <button class="sub">交卷并入库</button>
          </div>
          <div class="btns"><button class="ghost">合并历史题库</button></div>
          <div class="tip">交卷前会调用平台自己的未作答检查，有漏题不会提交。</div>
        </div>
        <div class="log"></div>
      </div>`;
    document.body.appendChild(host);

    const $ = (s) => root.querySelector(s);
    const st = $('.st'), bar = $('.bar i'), logBox = $('.log');
    const go = $('.go'), sub = $('.sub'), ghost = $('.ghost');

    ui.status = (t) => { st.textContent = t; };
    ui.log = (t) => { const line = document.createElement('div'); line.textContent = t; logBox.appendChild(line); logBox.scrollTop = logBox.scrollHeight; };
    ui.progress = (i, n) => { bar.style.width = Math.min(100, Math.round((i / Math.max(1, n)) * 100)) + '%'; };

    const run = (btn, fn) => {
      btn.disabled = true;
      ui.stopped = false;
      fn().catch((e) => { ui.log('✗ ' + e.message); ui.status('出错：' + e.message); })
        .finally(() => { btn.disabled = false; });
    };
    go.addEventListener('click', () => run(go, () => answerKnown(ui)));
    sub.addEventListener('click', () => run(sub, () => submitAndLearn(ui)));
    ghost.addEventListener('click', () => run(ghost, () => harvestHistory(ui)));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPanel);
  else buildPanel();

  window.__hbzjExam = { api, answerKnown, submitAndLearn, harvestHistory, loadBank, norm, mergeDetailIntoBank };
})();
