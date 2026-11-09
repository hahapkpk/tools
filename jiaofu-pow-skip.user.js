// ==UserScript==
// @name         教父.com 安全验证免等待
// @namespace    https://github.com/hahapkpk/tools
// @version      1.0.0
// @description  复用 24 小时有效的 PoW 通过凭据，并在到期前静默续期，登录时不再卡在「正在计算 xx%」页面
// @author       fly_wind
// @match        *://*.xn--wcv59z.com/*
// @match        *://xn--wcv59z.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

/*
 * 原理说明（基于对站点 /res/pow 接口与 pow.core.js 的逆向分析）：
 *
 *   1. 站点用 PoW 反爬：GET /res/pow 返回 {N, x, t}，
 *      浏览器需在 Worker 中执行 t(=400000) 次 y = y*y % N（2048 位大数），
 *      再 POST /res/pow 提交 y，成功后才下发 browser_verified 凭据。
 *   2. 该凭据是 HttpOnly Cookie，有效期 24 小时，同 UA 下可重复使用。
 *   3. 脚本做两件事：
 *      a) 把每次验证成功后下发的凭据值（通过 fetch 钩子读到 Set-Cookie）
 *         存进 localStorage，浏览器 cookie 被清掉时可一键还原 —— 免去重新计算。
 *      b) 凭据接近 24 小时到期时，在后台静默重算一次并换新，使凭证永不过期。
 *
 * 注意：PoW 本身约 4~5 秒纯 CPU 运算，无法被“跳过”；
 *       脚本的作用是让你不再需要重复经历它。
 */

(function () {
  'use strict';

  if (!/(^|\.)xn--wcv59z\.com$/i.test(location.hostname)) return;

  /* ================= 配置 ================= */
  const TOKEN_KEY = 'jf_pow_token';        // localStorage: {v: 凭据值, t: 下发时间戳}
  const HEAL_KEY  = 'jf_pow_heal_at';      // sessionStorage: 防还原死循环
  const RENEW_KEY = 'jf_pow_renew_at';     // sessionStorage: 防续期风暴
  const COOKIE    = 'browser_verified';
  const GATE_TITLE = '浏览器安全验证';
  const TTL       = 86400 * 1000;          // 服务端凭据有效期 24h
  const RENEW_AT  = 20 * 3600 * 1000;      // 满 20h 就在后台换新
  const DEBUG     = false;

  const log = (...a) => { if (DEBUG) console.log('[POW]', ...a); };
  const ss = {
    get(k) { try { return Number(sessionStorage.getItem(k) || 0); } catch (e) { return 0; } },
    set(k, v) { try { sessionStorage.setItem(k, String(v)); } catch (e) {} },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) {} }
  };

  /* ================= 凭据存取 ================= */
  const store = {
    read() {
      try {
        const o = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
        return o && o.v && o.t ? o : null;
      } catch (e) { return null; }
    },
    write(v) {
      try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ v: v, t: Date.now() })); log('凭据已保存', v); } catch (e) {}
    },
    drop() {
      try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    }
  };

  /* ================= 钩住 fetch，抓取服务端下发的凭据 =================
     Set-Cookie 是 HttpOnly，document.cookie 读不到，
     但对同源响应用 fetch 的 getSetCookie() 可以读到。 */
  const nativeFetch = window.fetch;
  function sniffSetCookie(res) {
    try {
      if (!res || !res.headers) return;
      const list = typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : [];
      for (let i = 0; i < list.length; i++) {
        const m = new RegExp('^' + COOKIE + '=([^;]+)', 'i').exec(list[i]);
        if (m && m[1] && m[1] !== 'deleted' && m[1] !== 'null') {
          store.write(m[1]);
          ss.set(HEAL_KEY, 0);
        }
      }
    } catch (e) {}
  }
  if (typeof nativeFetch === 'function') {
    window.fetch = function () {
      const p = nativeFetch.apply(this, arguments);
      if (p && typeof p.then === 'function') {
        p.then(sniffSetCookie, function () {});
      }
      return p;
    };
  }

  /* ================= 求解器（后台续期用） ================= */
  function solveInWorker(ch) {
    return new Promise(function (resolve) {
      let url = null, w = null, timer = null;
      const cleanup = function () {
        if (timer) clearTimeout(timer);
        try { if (w) w.terminate(); } catch (e) {}
        try { if (url) URL.revokeObjectURL(url); } catch (e) {}
      };
      const src =
        'self.onmessage=function(e){var d=e.data;try{' +
        'var N=BigInt("0x"+d.N),y=BigInt("0x"+d.x),t=d.t|0,i=0;' +
        'var chunk=Math.max(2048,Math.floor(t/16));' +
        'var step=function(){var end=Math.min(t,i+chunk);' +
        'for(;i<end;i++){y=(y*y)%N;}' +
        'if(i<t){setTimeout(step,0);}else{self.postMessage({y:y.toString(16)});self.close();}' +
        '};step();}catch(err){self.postMessage({error:String(err)});}};';
      try {
        url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
        w = new Worker(url);
      } catch (e) { cleanup(); return resolve(null); }
      timer = setTimeout(function () { cleanup(); resolve(null); }, 90000);
      w.onmessage = function (e) {
        const d = e.data || {};
        if (d.error) { cleanup(); resolve(null); }
        else if (d.y) { cleanup(); resolve(d.y); }
      };
      w.onerror = function () { cleanup(); resolve(null); };
      w.postMessage({ N: ch.N, x: ch.x, t: ch.t });
    });
  }

  async function solveOnMain(ch) {
    const N = BigInt('0x' + ch.N);
    let y = BigInt('0x' + ch.x);
    const t = ch.t | 0;
    const chunk = Math.max(2048, Math.floor(t / 16));
    for (let i = 0; i < t; i += chunk) {
      const end = Math.min(t, i + chunk);
      for (let j = i; j < end; j++) y = (y * y) % N;
      await new Promise(function (r) { setTimeout(r, 0); });
    }
    return y.toString(16);
  }

  /* ================= 静默续期 ================= */
  let renewing = false;
  async function renew() {
    if (renewing) return;
    renewing = true;
    try {
      const r1 = await fetch('/res/pow', { credentials: 'same-origin' });
      if (!r1.ok) return;
      const ch = await r1.json();
      if (!ch || !ch.N || !ch.x) return;
      log('开始续期计算, t=' + ch.t);
      let y = await solveInWorker(ch);
      if (!y) y = await solveOnMain(ch);
      if (!y) return;
      await fetch('/res/pow', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'y=' + encodeURIComponent(y)
      });
      log('续期请求已提交');
    } catch (e) {
      log('续期失败', e);
    } finally {
      renewing = false;
    }
  }

  function maybeRenew() {
    const st = store.read();
    if (st && Date.now() - st.t < RENEW_AT) return;   // 凭据还新鲜，不必续期
    const now = Date.now();
    if (now - ss.get(RENEW_KEY) < 10 * 60 * 1000) return;  // 10 分钟内只试一次
    ss.set(RENEW_KEY, now);
    const idle = window.requestIdleCallback || function (cb) {
      return setTimeout(function () { cb({ timeRemaining: function () { return 50; } }); }, 2500);
    };
    idle(function () { setTimeout(renew, 800); });
  }

  /* ================= 验证页拦截：用已存凭据瞬间放行 ================= */
  function tryHeal() {
    const st = store.read();
    if (!st) return false;
    const age = Date.now() - st.t;
    if (age < 0 || age > TTL - 60000) return false;     // 已过期，救不回来
    if (Date.now() - ss.get(HEAL_KEY) < 15000) return false; // 刚还原过又被拦，说明凭据失效
    ss.set(HEAL_KEY, Date.now());
    document.cookie = COOKIE + '=' + st.v + '; path=/; max-age=' +
      Math.floor((TTL - age) / 1000) + '; SameSite=Lax';
    log('命中本地凭据，直接放行');
    location.replace(location.href);
    return true;
  }

  function onGatePage() {
    if (tryHeal()) return;
    // 本地凭据无效：清掉，交给站点自带的求解流程正常走一遍
    if (store.read()) store.drop();
    ss.del(HEAL_KEY);
    log('无可用凭据，交由站点自行计算');
  }

  function isGatePage() {
    if (document.title === GATE_TITLE) return true;
    return !!document.querySelector('script[src*="powSolve"]');
  }

  /* ================= 启动 ================= */
  let settled = false;
  let mo = null;

  function stopObserve() {
    if (mo) { try { mo.disconnect(); } catch (e) {} mo = null; }
  }

  // 早判断：标题一出现就能定论（验证页的 <title> 在 head 里，来得最早）
  function decide() {
    if (settled) return;
    const t = document.title;
    if (!t) return;
    settled = true;
    stopObserve();
    if (t === GATE_TITLE) onGatePage();
    else maybeRenew();
  }

  // 兜底判断：DOM 就绪后仍无标题，则用脚本特征再确认一次
  function forceDecide() {
    if (settled) return;
    settled = true;
    stopObserve();
    if (isGatePage()) onGatePage();
    else maybeRenew();
  }

  mo = new MutationObserver(function () {
    if (document.title) decide();
  });
  try { mo.observe(document, { childList: true, subtree: true }); } catch (e) {}

  decide();
  if (!settled) {
    document.addEventListener('DOMContentLoaded', forceDecide, true);
    setTimeout(forceDecide, 3000);
  }
})();
