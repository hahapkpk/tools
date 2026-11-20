// ==UserScript==
// @name         湖北专技继续教育 · 一键学习
// @namespace    local.hubeizj.auto-complete
// @version      2.1.0
// @description  在「我的课程」页一键完成全部未完成课程：自动逐课件提交学习进度并锁定 100%，自动跳转下一门课。
// @author       Flywind
// @match        https://hubeizj.chinamde.cn/me/courses*
// @match        https://hubeizj.chinamde.cn/play/*
// @run-at       document-idle
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/hubeizj-auto-complete.user.js
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/hubeizj-auto-complete.user.js
// ==/UserScript==

(() => {
  'use strict';

  /* ======================= 常量 ======================= */

  const HMAC_KEY = '1ut189dff111d4fb6hangchengf7b6';
  const APP_KEY = 'hangcheng.websites';
  const GAP = 5200;                       // 两次进度上报的最小间隔，低于 5s 服务器会返回 1103
  const RETRY_WAITS = [8000, 14000, 22000];
  const STATE_KEY = 'hbzj_auto_complete_v3';
  const HOST_ID = 'hbzj-auto-complete';

  const EP = {
    learnInfo: '/website/courseCourse/getLearnInfo',
    video: '/website/courseCourse/getVideo',
    save: '/website/courseCourse/saveLeaningRecord',
  };

  /* ======================= 工具 ======================= */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const enc = new TextEncoder();

  async function hmacSha1(msg) {
    const key = await crypto.subtle.importKey('raw', enc.encode(HMAC_KEY), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  // 与站点 axios 拦截器一致的签名串：key 升序、k=v&、数组 JSON
  function canon(obj) {
    return Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== null && obj[k] !== undefined)
      .map((k) => `${k}=${Array.isArray(obj[k]) ? JSON.stringify(obj[k]) : obj[k]}&`)
      .join('');
  }

  function authToken() {
    const m = document.cookie.match(/(?:^|; )Authorization=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function api(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const token = authToken();
    if (!token) throw new Error('未检测到登录状态，请重新登录');
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
    try { return JSON.parse(text); } catch (e) { throw new Error(`接口返回异常(${resp.status})`); }
  }

  /* ======================= 状态 ======================= */

  const ui = { status: () => {}, log: () => {}, progress: () => {} };

  const S = Object.assign({ running: false, done: {}, current: '', log: [] }, (() => {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch (e) { return {}; }
  })());

  const saveState = () => { try { localStorage.setItem(STATE_KEY, JSON.stringify(S)); } catch (e) {} };

  function pushLog(t) {
    S.log.push(t);
    if (S.log.length > 100) S.log.shift();
    saveState();
    ui.log(t);
  }

  /* ======================= 进度引擎 ======================= */

  const flatLessons = (list) => {
    const out = [];
    (list || []).forEach((ch) => (ch.children || []).forEach((c) => out.push({ id: c.id, p: String(c.percentName || '') })));
    return out;
  };

  async function saveProgress(courseId, lessonId, second, duration) {
    const data = { courseId, classHourId: String(lessonId), second: String(second), duration: String(duration), remoteType: 'pc' };
    let r = await api(EP.save, { method: 'POST', data });
    if (r.code !== 200 && r.code !== 4022) {
      for (const wait of RETRY_WAITS) {
        await sleep(wait);
        r = await api(EP.save, { method: 'POST', data });
        if (r.code === 200 || r.code === 4022) break;
      }
    }
    return r;
  }

  async function completeLesson(courseId, lesson) {
    const gv = await api(EP.video, { params: { hourId: lesson.id, courseId } });
    if (gv.code !== 200 || !gv.data) throw new Error(`读取课件失败 ${gv.msg || gv.code}`);
    const hourCount = Number(gv.data.hourCount) || 0;
    const current = Number(gv.data.second) || 0;
    if (hourCount && current >= hourCount) return { ok: true, skipped: true };

    const target = current + 20;   // 先按 20 秒的正常节奏上报，避开倍速校验
    const first = await saveProgress(courseId, lesson.id, target, hourCount || target);
    if (first.code === 4022) return { ok: true };
    await sleep(GAP);
    // 同一秒数 + 相同 duration 再结算一次；平台按 second/duration 记百分比，直接 100%
    const second = await saveProgress(courseId, lesson.id, target, target);
    if (second.code === 4022) return { ok: true };
    if (second.code !== 200) return { ok: false, code: second.code, msg: second.msg };
    return { ok: true, percent: second.data };
  }

  async function completeCourse(courseId, year) {
    let info = null;
    for (let i = 0; i < 12; i++) {
      try { info = await api(EP.learnInfo, { params: { courseId, year } }); } catch (e) { info = null; }
      if (info && info.code === 200 && Array.isArray(info.data) && info.data.length) break;
      await sleep(1200);
    }
    if (!info || info.code !== 200) throw new Error(`课程信息读取失败 ${info && info.msg}`);

    const lessons = flatLessons(info.data);
    const todo = lessons.filter((l) => l.p !== '100');
    pushLog(`共 ${lessons.length} 个课件，待完成 ${todo.length} 个`);
    ui.progress(0, todo.length);

    let done = 0;
    for (const lesson of todo) {
      if (!S.running) break;
      ui.status(`正在完成课件 ${done + 1}/${todo.length}`);
      const r = await completeLesson(courseId, lesson);
      if (r.ok) { done++; pushLog(`  ✓ 课件 ${lesson.id}${r.skipped ? ' 已完成' : ' → 100%'}`); }
      else pushLog(`  ✗ 课件 ${lesson.id} ${r.code || ''} ${r.msg || ''}`);
      ui.progress(done, todo.length);
      await sleep(GAP);
    }

    const after = await api(EP.learnInfo, { params: { courseId, year } });
    const pct = (after.data || []).map((c) => c.percentName).join(' / ');
    pushLog(`本课程完成度：${pct || '未知'}`);
    return pct;
  }

  /* ======================= 课程列表（DOM 驱动） ======================= */

  function cards() {
    return [...document.querySelectorAll('[class*="Course_course_item__"]')].map((el) => {
      const titleEl = el.querySelector('[class*="Course_courser_title__"]');
      const title = (titleEl || el).innerText.replace(/\s+/g, ' ').trim();
      const m = el.innerText.match(/进度[:：]\s*(\d+(?:\.\d+)?)\s*%/);
      const btn = [...el.querySelectorAll('button')].find((b) => /学习|评价|继续/.test(b.textContent));
      return {
        el,
        title,
        percent: m ? Number(m[1]) : (el.innerText.includes('已完成') ? 100 : 0),
        button: btn || null,
      };
    });
  }

  function pickNext() {
    const list = cards().filter((c) => c.button && c.percent < 100);
    const fresh = list.filter((c) => !S.done[c.title]);
    return fresh[0] || list[0] || null;
  }

  async function nextCourse() {
    await sleep(1200);
    if (!S.running) return;
    const next = pickNext();
    if (!next) {
      S.running = false;
      saveState();
      ui.status('全部课程已完成');
      pushLog('没有待完成课程了');
      return;
    }
    S.current = next.title;
    saveState();
    ui.status(`打开《${next.title}》`);
    pushLog(`▶ 打开课程《${next.title}》（${next.percent}%）`);
    next.button.click();
  }

  /* ======================= 播放页 ======================= */

  function route() {
    const p = location.pathname;
    const q = new URLSearchParams(location.search);
    return { kind: p.startsWith('/play') ? 'play' : 'list', courseId: q.get('courseId'), year: q.get('year') || '2026' };
  }

  async function runPlay(courseId, year) {
    const v = document.querySelector('video');
    if (v) { try { v.muted = true; v.pause(); } catch (e) {} }
    ui.status('正在读取课程结构…');
    try {
      let pct = await completeCourse(courseId, year);
      const all100 = !pct || pct.split(' / ').every((x) => x === '100');
      if (!all100) {
        pushLog('有课件未到 100%，3 秒后补刷一次');
        await sleep(3000);
        pct = await completeCourse(courseId, year);
      }
      if (S.current) S.done[S.current] = 1;
      saveState();
      if (S.running) {
        ui.status('本课程完成，返回课程列表…');
        await sleep(1500);
        location.href = '/me/courses/';
      } else {
        ui.status('本课程已完成');
      }
    } catch (e) {
      pushLog('✗ 出错：' + e.message);
      ui.status('出错：' + e.message);
      S.running = false;
      saveState();
    }
  }

  /* ======================= 面板 ======================= */

  function buildPanel(kind) {
    const old = document.getElementById(HOST_ID);
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .card{width:342px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.14);
          font:13px/1.55 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#111827;overflow:hidden}
        .hd{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:linear-gradient(135deg,#0f766e,#0d9488);color:#fff}
        .hd b{font-size:14px;letter-spacing:.3px}
        .hd span{opacity:.85;font-size:12px}
        .bd{padding:12px 14px}
        .st{color:#374151;margin-bottom:8px;min-height:18px}
        .bar{height:6px;background:#eef2f7;border-radius:99px;overflow:hidden;margin-bottom:10px}
        .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#14b8a6,#0ea5e9);transition:width .3s}
        .btns{display:flex;gap:8px}
        button{flex:1;border:0;border-radius:8px;padding:8px 0;font-size:13px;cursor:pointer}
        .go{background:#0d9488;color:#fff}
        .go:disabled{background:#9ca3af;cursor:not-allowed}
        .stop{background:#f3f4f6;color:#374151}
        .log{max-height:168px;overflow:auto;background:#f9fafb;border-top:1px solid #eef2f7;padding:8px 10px;font-size:12px;color:#4b5563}
        .log div{padding:1px 0;word-break:break-all}
        .tip{font-size:11px;color:#9ca3af;margin-top:8px}
      </style>
      <div class="card">
        <div class="hd"><b>湖北专技 · 一键学习</b><span>${kind === 'play' ? '播放页' : '课程列表'}</span></div>
        <div class="bd">
          <div class="st">${kind === 'play' ? '点击按钮秒完本课程' : '点击开始，自动完成全部未完成课程'}</div>
          <div class="bar"><i></i></div>
          <div class="btns">
            <button class="go">${kind === 'play' ? '秒完本课程' : '一键学习'}</button>
            <button class="stop">停止</button>
          </div>
          <div class="tip">运行中请勿关闭页面；若提示“其他课程”，请关闭其它播放页后重试。</div>
        </div>
        <div class="log"></div>
      </div>`;
    document.body.appendChild(host);

    const $ = (sel) => root.querySelector(sel);
    const st = $('.st');
    const bar = $('.bar i');
    const logBox = $('.log');
    const go = $('.go');
    const stop = $('.stop');

    ui.status = (t) => { st.textContent = t; };
    ui.log = (t) => {
      const line = document.createElement('div');
      line.textContent = t;
      logBox.appendChild(line);
      logBox.scrollTop = logBox.scrollHeight;
    };
    ui.progress = (i, n) => { bar.style.width = Math.min(100, Math.round((i / Math.max(1, n)) * 100)) + '%'; };

    S.log.slice(-10).forEach((t) => ui.log(t));

    go.addEventListener('click', () => {
      S.running = true;
      S.log = [];
      saveState();
      logBox.innerHTML = '';
      ui.status('启动中…');
      if (kind === 'play') {
        const r = route();
        if (!r.courseId) { ui.status('URL 中没有 courseId'); return; }
        runPlay(r.courseId, r.year);
      } else {
        nextCourse();
      }
    });

    stop.addEventListener('click', () => {
      S.running = false;
      saveState();
      ui.status('已停止');
    });

    if (S.running) {
      if (kind === 'play') {
        const r = route();
        if (r.courseId) { ui.status('继续上次任务…'); setTimeout(() => runPlay(r.courseId, r.year), 800); }
      } else {
        ui.status('继续上次任务…');
        setTimeout(nextCourse, 900);
      }
    }
  }

  /* ======================= 启动 & 路由监听 ======================= */

  let lastKey = null;

  function boot() {
    if (!document.body) return;
    const r = route();
    const key = r.kind + ':' + (r.courseId || '');
    if (key === lastKey) return;
    lastKey = key;
    buildPanel(r.kind);
  }

  const rawPush = history.pushState;
  history.pushState = function () { const r = rawPush.apply(this, arguments); setTimeout(boot, 80); return r; };
  const rawReplace = history.replaceState;
  history.replaceState = function () { const r = rawReplace.apply(this, arguments); setTimeout(boot, 80); return r; };
  window.addEventListener('popstate', () => setTimeout(boot, 80));
  setInterval(() => { const r = route(); if (r.kind + ':' + (r.courseId || '') !== lastKey) boot(); }, 1000);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.__hbzj = { api, S, cards, nextCourse, runPlay, completeCourse, route, saveState };
})();
