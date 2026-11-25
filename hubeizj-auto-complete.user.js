// ==UserScript==
// @name         湖北专技继续教育 · 一键学习（后台模式）
// @namespace    local.hubeizj.auto-complete
// @version      3.1.0
// @description  个人中心/我的课程页一键后台刷课 + 一键后台考试：纯接口，不跳转任何页面，面板实时显示课程与考试进度，自动评价、自动交卷并把答案沉淀进题库。
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
  const BANK_KEY = 'hbzj_exam_bank_v1';
  const GAP = 5300;        // 课件两次上报间隔（<5s 触发 1103 上报过频）
  const EVAL_GAP = 900;
  const EXAM_GAP = 420;

  const EP = {
    courses: '/website/courseCourse/getBuyCourseRecordByIds',
    info: '/website/courseCourse/getLearnInfo',
    video: '/website/courseCourse/getVideo',
    save: '/website/courseCourse/saveLeaningRecord',
    evaluate: '/website/courseCourse/saveEvaluate',
    archives: '/website/user/center/learningArchives',
    examList: '/website/user/center/examRecordList',
    examStart: '/website/trainExam/startExamination',
    examPaper: '/website/trainExam/subjectDetail',
    examAnswer: '/website/trainExam/answerProcess',
    examCheck: '/website/trainExam/submit/check',
    examSubmit: '/website/trainExam/submitExamination',
    examResult: '/website/trainExam/examRecordResult',
    examDetail: '/website/trainExam/examRecordDetail',
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

  const X = {
    running: false,
    stop: false,
    guess: false,
    list: [],
    current: '',
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

  /* ---------------- 工具 ---------------- */

  function log(msg) {
    const t = new Date().toTimeString().slice(0, 8);
    S.logs.unshift(`${t} ${msg}`);
    S.logs = S.logs.slice(0, 60);
    render();
  }

  function setStatus(t) { S.status = t; render(); }
  function setXStatus(t) { X.status = t; render(); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  /* ---------------- 题库 ---------------- */

  const norm = (s) => String(s || '')
    .replace(/\s+/g, '')
    .replace(/[“”"'‘’「」『』《》]/g, '')
    .replace(/[，。、；：？！,.;:?!（）()【】\[\]]/g, '')
    .toLowerCase();

  const BUILTIN = {
    '十五五规划的实施时间是': '2026年至2030年',
    '中国式现代化具有几个中国特色': '五个',
    '新发展理念中创新发展注重解决什么问题': '发展动力问题',
    '中国式现代化是走和平发展道路的现代化': '正确',
    '高质量发展是全面建设社会主义现代化国家的首要任务': '正确',
    '在有监督学习中数据分成哪两部分': '训练集和测试集',
    '哪种方法不属于知识表示': '回归分析',
    '无特定信息的固定步骤搜索': '盲目搜索',
    '机器学习是ai子集但非所有ai都是ml': '正确',
    '一阶谓词逻辑能表示不确定知识': '错误',
    '日本房地产泡沫破灭后企业资产负债表变化': '明显恶化',
    '美国佛州房地产泡沫破裂根本原因': '房价涨得太高太快',
    '哪年政府工作报告提坚持在发展中化债': '2025年',
    '次贷危机暴露美国金融监管体系问题': '正确',
    '2026年政府工作报告地方债表述': '正确',
    '正确政绩观最终靠什么落地': '求真务实、真抓实干',
    '正确政绩观理论内核': '功成不必在我，功成必定有我',
    '2026年学习教育核心总要求': '立党为公、为民造福、科学决策、真抓实干',
    '调查研究"五求"是实干本领要求': '正确',
    '政绩为谁而树是首要核心问题': '正确',
    '我国已成为多少国家地区主要贸易伙伴': '150',
    '从市场开放看今天': '所有领域都实行开放，且制造业领域完全开放',
    '数字交付贸易包括': '数据贸易',
    '外资在中国经济中作用增大': '正确',
    '经济全球化是双刃剑': '正确',
    '新格局下威胁全球网络空间安全首要挑战': '地缘政治驱动的网络冲突风险',
    '政务数据共享与隐私保护平衡核心方法': '精准适配原则',
    '不属于ai驱动网络攻击防御核心原则': '单一技术防御原则',
    '新修订网络安全法引入从轻减轻不予处罚': '正确',
    '新修订网络安全法新增人工智能专章': '正确',
    '多模态大模型新能源发电预测误差降到': '0.05',
    'ai智能体区别于聊天机器人核心特征': '具备自主决策、自主执行、持续进化的能力',
    'ai研发阶段伦理审查重点不包括': '留存完整的ai操作日志以实现问题追溯',
    'aigc可借技术缺陷逃避内容合规责任': '错误',
    '算法偏见产生原因': '正确',
    '我国建立了从农田到餐桌的全程追溯体系农产品监测合格率稳定在以上': '0.97',
    '我国粮食损耗率为': '0.164',
    '按照巩固提升口粮主攻玉米大豆兼顾薯类杂粮的思路重在集成配套主攻单产': '玉米',
    '耕地是粮食生产的命根子': '正确',
    '鸡蛋奶等畜禽产品由粮食转化而来一般45公斤粮食转化为1公斤畜禽产品': '正确',
    '我国要发展新质生产力做强国内大循环': '因地制宜',
    '我国消费市场有效需求不足与无关': '货物供给的便利性不足',
    '中华人民共和国国民经济和社会发展第十五个五年规划纲要的实施保障机制的根本保证是': '党的集中领导',
    '我国要实施就业优先战略确保居民增收与教育健康水平稳步提升共享发展成果': '正确',
    '地方政府要以学促行以谋定策以干克难以稳致远': '正确',
  };

  function loadBank() {
    let b = {};
    try { b = JSON.parse(localStorage.getItem(BANK_KEY) || '{}'); } catch (e) { b = {}; }
    return Object.assign({}, BUILTIN, b);
  }
  function saveBank(b) {
    const extra = {};
    Object.keys(b).forEach((k) => { if (BUILTIN[k] === undefined) extra[k] = b[k]; });
    try { localStorage.setItem(BANK_KEY, JSON.stringify(extra)); } catch (e) { /* ignore */ }
  }
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
  function matchOption(text, options) {
    if (!text) return null;
    const t = norm(text);
    const vals = Object.values(options || {});
    const exact = vals.find((v) => norm(v) === t);
    if (exact) return exact;
    return vals.find((v) => t.includes(norm(v)) || norm(v).includes(t)) || null;
  }

  /* ---------------- 课程（后台） ---------------- */

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

  /* ---------------- 考试（后台） ---------------- */

  function examName(x) {
    const e = x.examination || {};
    return String(e.testName || e.examinationName || e.name || e.title || '').trim() || `考试 ${String(x.examinationId).slice(-4)}`;
  }

  async function loadExams() {
    setXStatus('读取考试列表…');
    const r = await api(EP.examList, { params: { pageNum: 1, pageSize: 50 } });
    const d = r.data;
    const rows = Array.isArray(d) ? d : (d && (d.rows || d.list || d.records)) || [];
    X.list = rows
      .filter((x) => Number(x.status) !== 2)
      .map((x) => ({
        eid: String(x.examinationId),
        status: Number(x.status),
        name: examName(x),
        score: x.score,
        state: Number(x.status) === 0 ? '未参加' : '进行中',
        surplus: x.examinationSurplusNum,
      }));
    setXStatus(X.list.length ? `待考 ${X.list.length} 场` : '没有待考考试');
    render();
  }

  async function solveExam(ex) {
    const bank = loadBank();
    let recordId = null;
    try {
      const st = await api(EP.examStart, { params: { examinationId: ex.eid } });
      if (st.code === 200 && st.data && st.data.recordId) recordId = String(st.data.recordId);
    } catch (e) { /* 已交卷等情况忽略 */ }
    const d = await api(EP.examPaper, { params: { examinationId: ex.eid } });
    if (d.code !== 200 || !d.data) throw new Error('试卷读取失败 ' + (d.msg || d.code));
    const paper = d.data;
    recordId = recordId || String(paper.examId);
    if (paper.testpaperName) ex.name = String(paper.testpaperName).replace(/\s+/g, ' ').slice(0, 24);
    const subjects = paper.subjectItems || [];
    ex.state = '作答中';
    log(`▶ 考试《${ex.name}》${subjects.length} 题`);
    render();

    let ok = 0;
    const missing = [];
    for (const s of subjects) {
      if (X.stop) break;
      let options = s.optionConfMap;
      if (!options) { try { options = JSON.parse(s.optionConf); } catch (e) { options = {}; } }
      const q = String(s.subjectName || '');
      const label = q.slice(0, 22);
      let answer = bank[norm(q)];
      if (!answer && X.guess) {
        const vals = Object.values(options || {});
        answer = vals[0] || (Number(s.subjectType) === 2 ? '正确' : null);
      }
      if (!answer) { missing.push(label); log(`  ? 未命中：${label}`); continue; }
      let payload = answer;
      if (Number(s.subjectType) === 1) {
        const parts = String(answer).split(/[|｜、,，;；]|-&-/).map((x) => x.trim()).filter(Boolean).map((x) => matchOption(x, options) || x);
        payload = parts.join('-&-');
      }
      let r = await api(EP.examAnswer, { method: 'POST', data: { recordId, subjectId: String(s.subjectId), answer: payload } });
      if (r.code === 500) { await sleep(1600); r = await api(EP.examAnswer, { method: 'POST', data: { recordId, subjectId: String(s.subjectId), answer: payload } }); }
      if (r.code === 200) { ok += 1; } else { log(`  ✗ ${label}：${r.msg || r.code}`); }
      X.current = `${ex.name} · ${ok}/${subjects.length}`;
      render();
      await sleep(EXAM_GAP);
    }

    if (X.stop) { ex.state = '已停止'; return null; }
    if (missing.length) {
      ex.state = `缺 ${missing.length} 题`;
      log(`《${ex.name}》有 ${missing.length} 题未命中题库，未交卷（可勾选「随机补答」重试）`);
      return null;
    }

    const chk = await api(EP.examCheck, { params: { recordId } });
    if (chk.code !== 200) throw new Error('交卷检查失败：' + (chk.msg || chk.code));
    if (chk.data) { ex.state = '仍有未答'; log(`《${ex.name}》还有未答题，未交卷`); return null; }

    const sub = await api(EP.examSubmit, { params: { recordId } });
    if (sub.code !== 200) throw new Error('交卷失败：' + (sub.msg || sub.code));
    await sleep(1200);
    const res = await api(EP.examResult, { params: { recordId } });
    const r = (res && res.data) || {};
    ex.score = r.score;
    ex.state = `已交卷 ${r.score ?? '?'} 分`;
    log(`✓ 《${ex.name}》${r.score ?? '?'} 分（${r.rightNum ?? '?'}/${r.subjectNum ?? '?'}）`);
    try {
      const det = await api(EP.examDetail, { params: { recordId } });
      const added = mergeDetailIntoBank(bank, det.data);
      saveBank(bank);
      log(`  答案入库 +${added}，题库 ${Object.keys(bank).length} 题`);
    } catch (e) { /* ignore */ }
    render();
    return r;
  }

  async function runExams() {
    if (X.running) return;
    X.running = true;
    X.stop = false;
    render();
    try {
      await loadExams();
      if (!X.list.length) { setXStatus('没有待考考试'); return; }
      for (const ex of X.list) {
        if (X.stop) break;
        X.current = ex.name;
        render();
        try {
          const r = await solveExam(ex);
          // 不及格（<60）自动重考一次：刚才交卷已把标准答案入库，重考基本满分
          if (r && Number(r.score) < 60 && !X.stop) {
            log(`《${ex.name}》${r.score} 分不及格，题库已更新，自动重考一次…`);
            const again = { eid: ex.eid, status: 1, name: ex.name, score: 0, state: '重考中', surplus: ex.surplus };
            const r2 = await solveExam(again);
            if (r2) { ex.score = r2.score; ex.state = `重考 ${r2.score ?? '?'} 分`; }
          }
        } catch (e) { ex.state = '失败'; log(`✗ 《${ex.name}》${e.message}`); }
        render();
        await sleep(800);
      }
      setXStatus(X.stop ? '已停止' : '考试处理完毕');
    } finally {
      X.running = false;
      X.current = '';
      render();
    }
  }

  /* ---------------- 面板 ---------------- */

  const css = `
    #${HOST_ID}{position:fixed;right:18px;bottom:18px;width:452px;z-index:2147483000;font:13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2430;
      background:#fff;border:1px solid rgba(24,84,182,.18);border-radius:12px;box-shadow:0 12px 36px rgba(16,42,86,.22);overflow:hidden}
    #${HOST_ID} .hd{display:flex;align-items:center;gap:8px;padding:10px 12px;background:linear-gradient(135deg,#1a5fbe,#2f8bf0);color:#fff;cursor:move;user-select:none}
    #${HOST_ID} .hd b{font-size:13px;font-weight:600;flex:1}
    #${HOST_ID} .hd .dot{width:8px;height:8px;border-radius:50%;background:#8ef2b1;box-shadow:0 0 0 3px rgba(142,242,177,.25)}
    #${HOST_ID} .hd button{background:rgba(255,255,255,.18);border:0;color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:12px}
    #${HOST_ID} .bd{padding:10px 12px 12px;max-height:min(76vh,660px);overflow:auto}
    #${HOST_ID} .row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
    #${HOST_ID} .bar{height:8px;border-radius:5px;background:#e8eef8;overflow:hidden;flex:1}
    #${HOST_ID} .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#2f8bf0,#22c07a);transition:width .3s}
    #${HOST_ID} .pct{font-variant-numeric:tabular-nums;color:#1a5fbe;font-weight:600;min-width:42px;text-align:right}
    #${HOST_ID} .cur{color:#65707f;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:18px}
    #${HOST_ID} .list{margin:6px 0 8px;border-top:1px dashed #e2e8f2;max-height:200px;overflow:auto}
    #${HOST_ID} .item{display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px dashed #eef2f8;font-size:12px}
    #${HOST_ID} .item .n{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    #${HOST_ID} .item .s{color:#65707f;font-variant-numeric:tabular-nums;white-space:nowrap}
    #${HOST_ID} .item.done .s{color:#22a06b}
    #${HOST_ID} .item.run .s{color:#2f8bf0;font-weight:600}
    #${HOST_ID} .sec{display:flex;align-items:center;gap:8px;margin:10px 0 6px;padding-top:8px;border-top:1px solid #e8eef8;font-size:12px;color:#31527f;font-weight:600}
    #${HOST_ID} .sec .tag{margin-left:auto;font-weight:400;color:#8b95a6}
    #${HOST_ID} .ctl{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    #${HOST_ID} .btn{border:0;border-radius:8px;padding:7px 14px;font-size:13px;cursor:pointer;font-weight:600}
    #${HOST_ID} .btn.go{background:linear-gradient(135deg,#1a5fbe,#2f8bf0);color:#fff}
    #${HOST_ID} .btn.exam{background:linear-gradient(135deg,#0f7a5a,#22c07a);color:#fff}
    #${HOST_ID} .btn.stop{background:#ffe9e9;color:#c0392b}
    #${HOST_ID} .btn.ghost{background:#eef3fb;color:#31527f}
    #${HOST_ID} .btn:disabled{opacity:.45;cursor:not-allowed}
    #${HOST_ID} label{display:flex;align-items:center;gap:5px;color:#65707f;font-size:12px;cursor:pointer}
    #${HOST_ID} .logs{margin-top:8px;border-top:1px dashed #e2e8f2;padding-top:6px;font-size:11.5px;color:#7b8595;max-height:120px;overflow:auto;font-family:Consolas,monospace}
    #${HOST_ID}.fold .bd{display:none}
  `;

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
        <div class="sec">考试 <span class="tag" data-xtag></span></div>
        <div class="cur" data-xcur></div>
        <div class="list" data-xlist></div>
        <div class="ctl">
          <button class="btn exam" data-xgo>一键后台考试</button>
          <button class="btn stop" data-xstop disabled>停止</button>
          <label><input type="checkbox" data-guess> 未命中随机补答</label>
        </div>
        <div class="logs" data-logs></div>
      </div>`;
    document.body.appendChild(box);

    box.querySelector('[data-fold]').onclick = () => box.classList.toggle('fold');
    box.querySelector('[data-go]').onclick = () => { run().catch((e) => { log('异常：' + e.message); S.running = false; render(); }); };
    box.querySelector('[data-stop]').onclick = () => { S.stop = true; setStatus('正在停止…'); };
    box.querySelector('[data-rescan]').onclick = () => { scan().catch((e) => log('读取失败：' + e.message)); };
    box.querySelector('[data-auto]').onchange = (ev) => { S.autoEval = ev.target.checked; };
    box.querySelector('[data-xgo]').onclick = () => { runExams().catch((e) => { log('考试异常：' + e.message); X.running = false; render(); }); };
    box.querySelector('[data-xstop]').onclick = () => { X.stop = true; setXStatus('正在停止…'); };
    box.querySelector('[data-guess]').onchange = (ev) => { X.guess = ev.target.checked; };

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

    box.querySelector('[data-xtag]').textContent = X.status;
    box.querySelector('[data-xcur]').textContent = X.running ? (X.current || X.status) : '';
    const xl = box.querySelector('[data-xlist]');
    xl.innerHTML = X.list.map((x) => {
      const cls = /已交卷/.test(x.state) ? 'done' : (/作答中/.test(x.state) ? 'run' : '');
      return `<div class="item ${cls}"><span class="n" title="${escapeHtml(x.name)}">${escapeHtml(x.name)}</span><span class="s">${x.score ? x.score + '分' : ''}</span><span class="s">${escapeHtml(x.state)}</span></div>`;
    }).join('') || '<div class="item"><span class="n">暂无待考考试</span></div>';

    box.querySelector('[data-go]').disabled = S.running;
    box.querySelector('[data-stop]').disabled = !S.running;
    box.querySelector('[data-xgo]').disabled = X.running || S.running;
    box.querySelector('[data-xstop]').disabled = !X.running;
    box.querySelector('[data-logs]').innerHTML = S.logs.slice(0, 14).map((l) => `<div>${escapeHtml(l)}</div>`).join('');
  }

  /* ---------------- 启动 ---------------- */

  async function boot() {
    if (location.pathname.indexOf('/me/') !== 0) return;
    mount();
    scan().catch((e) => log('读取失败：' + e.message));
    loadExams().catch((e) => { setXStatus('考试列表读取失败'); });
  }

  window.__hbzj = { S, X, run, scan, runExams, loadExams, solveExam, api, log, render };

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
