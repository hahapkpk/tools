// ==UserScript==
// @name         湖北专技继续教育 · 考试助手
// @namespace    local.hubeizj.exam-solver
// @version      2.0.0
// @description  适配「我的考试」与考试页：批量进入考试、按题库自动作答、自动交卷，并把每场答案沉淀进本地题库。
// @author       Flywind
// @match        https://hubeizj.chinamde.cn/me/exams*
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
  const CFG_KEY = 'hbzj_exam_llm_v1';
  const STATE_KEY = 'hbzj_exam_run_v1';
  const HOST_ID = 'hbzj-exam-solver';
  const GAP = 400;

  const EP = {
    detail: '/website/trainExam/subjectDetail',
    answer: '/website/trainExam/answerProcess',
    check: '/website/trainExam/submit/check',
    submit: '/website/trainExam/submitExamination',
    result: '/website/trainExam/examRecordResult',
    recordDetail: '/website/trainExam/examRecordDetail',
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

  // 已实测 100 分的题目，作为初始题库
  const BUILTIN = {
    '十五五规划的实施时间是': '2026年至2030年',
    '中国式现代化具有几个中国特色': '五个',
    '新发展理念中创新发展注重解决什么问题': '发展动力问题',
    '中国式现代化是走和平发展道路的现代化': '正确',
    '高质量发展是全面建设社会主义现代化国家的首要任务': '正确',
    '以下哪项不是ai的发展方向': '传统编程语言优化',
    '以下哪项不是智能体的基本特性': '被动性',
    '卷积神经网络cnn的主要特点不包括以下哪一项': '全连接',
    '智能体具有自主性意味着它可以根据内部状态和感知到的环境信息自主决定和控制自身的状态和行为': '正确',
    '标准rnn能够很好地处理长期依赖问题无需改进': '错误',
  };

  function loadBank() {
    let b = {};
    try { b = JSON.parse(localStorage.getItem(BANK_KEY) || '{}'); } catch (e) { b = {}; }
    return Object.assign({}, BUILTIN, b);
  }
  const saveBank = (b) => {
    const extra = {};
    Object.keys(b).forEach((k) => { if (BUILTIN[k] === undefined) extra[k] = b[k]; });
    try { localStorage.setItem(BANK_KEY, JSON.stringify(extra)); } catch (e) {}
  };

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

  /* ---------------- LLM 兜底（可选，用户自备 OpenAI 兼容接口） ---------------- */

  const loadCfg = () => { try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch (e) { return {}; } };

  async function askLLM(cfg, question, options, type) {
    if (!cfg || !cfg.base || !cfg.key) return null;
    const opts = Object.keys(options).map((k) => `${k}. ${options[k]}`).join('\n');
    const prompt = `你是考试答题器。题型：${type === 2 ? '判断题' : type === 1 ? '多选题' : '单选题'}。\n题目：${question}\n选项：\n${opts}\n\n` +
      (type === 1
        ? '只输出正确选项的内容原文，多个用 || 分隔，不要输出字母、解释或标点。'
        : '只输出正确选项的内容原文，不要输出字母或解释。');
    const resp = await fetch(cfg.base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
      body: JSON.stringify({ model: cfg.model || 'gpt-4o-mini', temperature: 0, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!resp.ok) throw new Error('LLM ' + resp.status);
    const j = await resp.json();
    const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim();
    return text || null;
  }

  function matchOption(text, options) {
    if (!text) return null;
    const t = norm(text);
    const vals = Object.values(options);
    const exact = vals.find((v) => norm(v) === t);
    if (exact) return exact;
    const contains = vals.find((v) => t.includes(norm(v)) || norm(v).includes(t));
    return contains || null;
  }

  /* ---------------- 考试页 ---------------- */

  async function loadPaper() {
    const id = new URLSearchParams(location.search).get('id');
    if (!id) throw new Error('URL 里没有考试 id');
    // 先让服务端确认/创建本场答题记录，避免刚进页面就答题时记录还没初始化（会报「答案不存在」）
    let recordId = null;
    try {
      const st = await api('/website/trainExam/startExamination', { params: { examinationId: id } });
      if (st.code === 200 && st.data && st.data.recordId) recordId = String(st.data.recordId);
    } catch (e) { /* 已交卷等情况忽略，继续用 subjectDetail 的 examId */ }
    const d = await api(EP.detail, { params: { examinationId: id } });
    if (d.code !== 200 || !d.data) throw new Error('试卷读取失败：' + (d.msg || d.code));
    return { recordId: recordId || d.data.examId, paper: d.data };
  }

  async function solve(ui, { autoSubmit = true } = {}) {
    const { recordId, paper } = await loadPaper();
    const bank = loadBank();
    const cfg = loadCfg();
    const subjects = paper.subjectItems || [];
    ui.log(`《${paper.testpaperName}》${subjects.length} 题，题库 ${Object.keys(bank).length} 题${cfg.key ? '，已启用 LLM 兜底' : ''}`);

    let ok = 0;
    const missing = [];
    for (const s of subjects) {
      if (ui.stopped) break;
      const q = String(s.subjectName || '');
      const options = s.optionConfMap || (() => { try { return JSON.parse(s.optionConf); } catch (e) { return {}; } })();
      const label = q.slice(0, 28);
      let answer = bank[norm(q)];

      if (!answer && cfg.key) {
        ui.status('LLM 作答：' + label);
        try { answer = matchOption(await askLLM(cfg, q, options, s.subjectType), options); } catch (e) { ui.log('  LLM 失败：' + e.message); }
      }

      if (!answer) { missing.push(label); ui.log(`  ? ${label}`); continue; }

      let payload = answer;
      if (Number(s.subjectType) === 1) {
        const parts = String(answer).split(/[|｜、,，;；]/).map((x) => x.trim()).filter(Boolean).map((x) => matchOption(x, options) || x);
        payload = parts.join('-&-');
      }

      let r = await api(EP.answer, { method: 'POST', data: { recordId, subjectId: String(s.subjectId), answer: payload } });
      if (r.code === 500) { await sleep(1600); r = await api(EP.answer, { method: 'POST', data: { recordId, subjectId: String(s.subjectId), answer: payload } }); }
      if (r.code === 200) { ok++; ui.log(`  ✓ ${label} → ${payload}`); }
      else { ui.log(`  ✗ ${label}：${r.msg || r.code}`); }
      ui.progress(ok, subjects.length);
      await sleep(GAP);
    }

    ui.log(`作答 ${ok}/${subjects.length}`);
    if (missing.length) {
      ui.status(`已填 ${ok} 题，${missing.length} 题需手动`);
      if (autoSubmit) ui.log('有未命中题目，已暂停交卷（可手动作答后点「交卷并入库」）');
      return { recordId, ok, missing };
    }
    if (!autoSubmit) { ui.status(`已填 ${ok} 题，可交卷`); return { recordId, ok, missing }; }

    return submitAndLearn(ui, recordId);
  }

  async function submitAndLearn(ui, recordIdArg) {
    let recordId = recordIdArg;
    if (!recordId) { const p = await loadPaper(); recordId = p.recordId; }

    const chk = await api(EP.check, { params: { recordId } });
    if (chk.code !== 200) throw new Error('交卷检查失败：' + (chk.msg || chk.code));
    if (chk.data) { ui.status('仍有题目未作答，未交卷'); ui.log('提交检查：还有没答的题'); return null; }

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
      ui.log(`本场答案入库 +${n}，题库共 ${Object.keys(bank).length} 题`);
    } catch (e) { ui.log('入库失败：' + e.message); }
    return r;
  }

  /* ---------------- 考试列表页 ---------------- */

  function scanExams() {
    const el = document.querySelector('#__next') || document.body;
    const key = Object.keys(el).find((k) => k.startsWith('__reactContainer$'));
    if (!key) return [];
    const queue = [el[key]];
    const seen = new Set();
    let found = null;
    while (queue.length && seen.size < 6000) {
      const f = queue.shift();
      if (!f || seen.has(f)) continue;
      seen.add(f);
      let h = f.memoizedState, d = 0;
      while (h && d < 30) {
        const v = h.memoizedState;
        if (Array.isArray(v) && v.length >= 2 && v[0] && typeof v[0] === 'object' && ('examination' in v[0] || 'examinationId' in v[0])) { found = v; break; }
        h = h.next; d++;
      }
      if (found) break;
      if (f.child) queue.push(f.child);
      if (f.sibling) queue.push(f.sibling);
    }
    if (!found) return [];
    return found.map((x) => ({
      examId: String(x.examinationId || (x.examination && x.examination.id) || ''),
      name: (x.examination && x.examination.testName) || x.testName || '',
      status: Number(x.status),
      statusName: x.statusName || '',
    })).filter((x) => x.examId);
  }

  const loadRun = () => { try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{"running":false}'); } catch (e) { return { running: false }; } };
  const saveRun = (r) => { try { localStorage.setItem(STATE_KEY, JSON.stringify(r)); } catch (e) {} };

  async function runAll(ui) {
    const run = loadRun();
    run.running = true;
    run.done = run.done || [];
    saveRun(run);

    const exams = scanExams();
    if (!exams.length) { ui.status('没有读到考试列表，请在「未完成考试」标签下重试'); return; }
    const todo = exams.filter((e) => e.status !== 3 && !run.done.includes(e.examId));
    ui.log(`共 ${exams.length} 场考试，待处理 ${todo.length} 场`);
    if (!todo.length) {
      run.running = false; saveRun(run);
      ui.status('所有考试都已完成');
      return;
    }
    const next = todo[0];
    run.current = next.examId;
    run.currentName = next.name;
    saveRun(run);
    ui.status(`进入《${next.name.slice(0, 20)}》`);
    ui.log(`▶ 进入考试：${next.name}`);
    await sleep(800);
    location.href = `/exam/?id=${next.examId}`;
  }

  /* ---------------- 面板 ---------------- */

  const ui = { status: () => {}, log: () => {}, progress: () => {}, stopped: false };

  function buildPanel(kind) {
    const old = document.getElementById(HOST_ID);
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .card{width:340px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.14);
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
        .log{max-height:150px;overflow:auto;background:#f9fafb;border-top:1px solid #eef2f7;padding:8px 10px;font-size:12px;color:#4b5563}
        .log div{padding:1px 0;word-break:break-all}
        .cfg{display:none;gap:6px;flex-direction:column;margin-top:8px}
        .cfg.on{display:flex}
        .cfg input{width:100%;box-sizing:border-box;border:1px solid #e5e7eb;border-radius:6px;padding:5px 8px;font-size:12px}
        .tip{font-size:11px;color:#9ca3af;margin-top:6px}
      </style>
      <div class="card">
        <div class="hd"><b>湖北专技 · 考试助手</b><span>${kind === 'list' ? '考试列表' : '答题页'}</span></div>
        <div class="bd">
          <div class="st">${kind === 'list' ? '一键跑完所有未完成考试' : '自动作答并按需交卷'}</div>
          <div class="bar"><i></i></div>
          <div class="btns">
            <button class="go">${kind === 'list' ? '一键跑完考试' : '自动作答交卷'}</button>
            ${kind === 'exam' ? '<button class="sub">只作答</button>' : '<button class="sub">停止</button>'}
          </div>
          <div class="btns"><button class="ghost">LLM 兜底设置</button></div>
          <div class="cfg">
            <input class="c-base" placeholder="API 地址，如 https://api.openai.com/v1" />
            <input class="c-key" placeholder="API Key" />
            <input class="c-model" placeholder="模型，默认 gpt-4o-mini" />
          </div>
          <div class="tip">题库命中直接作答；未命中且配置了 LLM 时由模型判断，仍不确定就留空不交卷。</div>
        </div>
        <div class="log"></div>
      </div>`;
    document.body.appendChild(host);

    const $ = (s) => root.querySelector(s);
    const st = $('.st'), bar = $('.bar i'), logBox = $('.log');
    const go = $('.go'), sub = $('.sub'), ghost = $('.ghost'), cfgBox = $('.cfg');

    ui.status = (t) => { st.textContent = t; };
    ui.log = (t) => { const line = document.createElement('div'); line.textContent = t; logBox.appendChild(line); logBox.scrollTop = logBox.scrollHeight; };
    ui.progress = (i, n) => { bar.style.width = Math.min(100, Math.round((i / Math.max(1, n)) * 100)) + '%'; };

    const cfg = loadCfg();
    $('.c-base').value = cfg.base || '';
    $('.c-key').value = cfg.key || '';
    $('.c-model').value = cfg.model || '';
    ghost.addEventListener('click', () => {
      cfgBox.classList.toggle('on');
      if (!cfgBox.classList.contains('on')) {
        localStorage.setItem(CFG_KEY, JSON.stringify({ base: $('.c-base').value.trim(), key: $('.c-key').value.trim(), model: $('.c-model').value.trim() }));
        ui.log('LLM 配置已保存');
      }
    });

    const run = (btn, fn) => {
      btn.disabled = true; ui.stopped = false;
      fn().catch((e) => { ui.log('✗ ' + e.message); ui.status('出错：' + e.message); }).finally(() => { btn.disabled = false; });
    };

    if (kind === 'list') {
      go.addEventListener('click', () => { saveRun({ running: true, done: loadRun().done || [] }); run(go, () => runAll(ui)); });
      sub.addEventListener('click', () => { saveRun({ running: false, done: [] }); ui.status('已停止批量任务'); });
      const r = loadRun();
      if (r.running) { ui.status('继续批量任务…'); setTimeout(() => run(go, () => runAll(ui)), 900); }
    } else {
      go.addEventListener('click', () => run(go, () => solve(ui, { autoSubmit: true })));
      sub.addEventListener('click', () => run(sub, () => solve(ui, { autoSubmit: false })));
      const r = loadRun();
      if (r.running) { ui.status('继续本场考试…'); setTimeout(() => run(go, () => solve(ui, { autoSubmit: true })), 1200); }
    }
  }

  const isList = () => location.pathname.startsWith('/me/exams');
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => buildPanel(isList() ? 'list' : 'exam'));
  else buildPanel(isList() ? 'list' : 'exam');

  window.__hbzjExam = { api, solve, submitAndLearn, scanExams, loadBank, norm, mergeDetailIntoBank };
})();
