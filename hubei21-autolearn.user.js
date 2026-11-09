// ==UserScript==
// @name         湖北21世纪学习平台 - 自动刷课
// @namespace    https://github.com/hahapkpk/tools
// @version      2.0.0
// @description  自动完成 hubei21.com 学习平台的所有课程视频学习进度（支持普通课程和水课程，带分页、断点续刷、失败重试、可中断）
// @author       Flywind
// @match        https://www.hubei21.com/*
// @match        https://hubei21.com/*
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/hubei21-autolearn.user.js
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/hubei21-autolearn.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ==========================================================================
   * 2.0.0 相比 1.1.1 的改动（逐条对应原脚本问题）
   *  1. 请求层：加超时 + AbortController，可随时中断在途请求，不会卡死。
   *  2. 请求层：校验 HTTP 状态，JSON 解析失败给出可读信息，401/403 直接判定"需重新登录"，
   *     不再抛 "Unexpected token '<'" 这种看不懂的错。
   *  3. 失败重试：单节课失败重试 N 次（线性退避），仍失败则跳过继续刷后面的，
   *     不再"一节课挂掉整轮作废"。
   *  4. 水课程分页：按页拉取并去重，直到没有新数据为止（原来写死 page:1）。
   *  5. 数据合并：{...lesson, ...detail} 会覆盖 id/status/time，改为显式映射，
   *     并把上报用的 detailId 在合并前固定下来。
   *  6. 断点续刷：读取已有的 ratio/time，从当前进度往后上报，不重复、不回退。
   *  7. 离开页面 / 切换课程自动停止，面板被移除也不会在 finally 里 TypeError。
   *  8. 可配置：每节上报步数、上报间隔、课间间隔，存 localStorage，面板内可改。
   *  9. 面板可拖动 / 最小化 / 关闭，日志有上限，不会越刷越卡。
   * 10. 去掉 20×500ms 的轮询和满屏 console.log，改用 MutationObserver + 静默兜底。
   * 11. 时长只认"视频时长"语义的字段，不再拿 study_detail 里的已学时长冒充视频长度。
   * 12. 刷完回读一次详情做校验，避免"接口返回成功但其实没记上"的假成功。
   * 13. code 类型归一化（"200" 也算成功）；业务层 5xx 会重试；缺 id 的课时跳过并告警。
   * ========================================================================== */

  // ==================== 配置 ====================

  const CONFIG_KEY = 'hubei21_autolearn_config';
  const POS_KEY = 'hubei21_autolearn_panel_pos';

  const DEFAULT_CONFIG = {
    apiBase: 'https://api.hubei21.com/api',
    requestTimeoutMs: 15000, // 单次请求超时
    maxRetries: 3, // 单节课最多尝试次数（含首次）
    retryBaseDelayMs: 1200, // 重试退避基数：第 n 次重试等 n*base
    steps: 2, // 每节课上报几次（2 = 50%/100%）
    stepIntervalMs: 2000, // 同一节课两次上报之间的间隔
    lessonGapMs: 3000, // 两节课之间的间隔
    defaultDurationSec: 1800, // 取不到视频时长时的兜底秒数
    maxPages: 50, // 水课程最多翻页数（防死循环）
    maxLogLines: 200, // 日志最多保留行数
    verifyAfterRun: true, // 刷完回读一次详情，核对是否真的都完成了
    debug: false,
  };

  const CONFIG = loadConfig();

  function loadConfig() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') || {};
    } catch {
      saved = {};
    }
    const cfg = { ...DEFAULT_CONFIG };
    // 只接受白名单字段，避免 localStorage 里塞进奇怪的东西
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      // apiBase 不允许被持久化覆盖：否则同源其它脚本写一下配置就能把 token 发到任意地址
      if (key === 'apiBase') continue;
      if (saved[key] !== undefined && saved[key] !== null) {
        const def = DEFAULT_CONFIG[key];
        cfg[key] = typeof def === 'number' ? Number(saved[key]) : saved[key];
        if (typeof def === 'number' && !Number.isFinite(cfg[key])) cfg[key] = def;
      }
    }
    // 上报间隔留个下限，防止把配置改成 0 后瞬间打出几百个请求
    cfg.stepIntervalMs = clamp(cfg.stepIntervalMs, 300, 60000);
    return cfg;
  }

  function saveConfig(patch) {
    Object.assign(CONFIG, patch);
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(CONFIG));
    } catch (e) {
      /* 隐私模式等写不进去，忽略 */
    }
  }

  function log(...args) {
    if (CONFIG.debug) console.log('[自动刷课]', ...args);
  }

  // ==================== 错误类型 ====================

  /** 用户主动停止 / 页面切换导致的中断 */
  class StopError extends Error {
    constructor() {
      super('已停止');
      this.name = 'StopError';
    }
  }

  /** 致命错误：继续跑也没意义（未登录、无权限），整轮中止 */
  class FatalError extends Error {
    constructor(message) {
      super(message);
      this.name = 'FatalError';
    }
  }

  /**
   * 接口错误。retryable 决定要不要重试：
   *  - 网络抖动 / 超时 / 5xx / 429 / 响应不是 JSON → 值得重试
   *  - code !== 200 的业务错误（如"已学完"、参数不合法）→ 重试也没用，跳过这节继续
   */
  class ApiError extends Error {
    constructor(message, { retryable = false, status = 0 } = {}) {
      super(message);
      this.name = 'ApiError';
      this.retryable = retryable;
      this.status = status;
    }
  }

  // ==================== 基础工具 ====================

  function toNumber(value, fallback = NaN) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value.trim());
      return Number.isFinite(n) ? n : fallback;
    }
    return fallback;
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /** 可被 run.abort() 立刻唤醒的 sleep（原来是死等，停止要等 2~3 秒） */
  function sleep(ms, run) {
    if (!(ms > 0)) return Promise.resolve();
    if (!run || !run.signal) return new Promise((r) => setTimeout(r, ms));
    if (run.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        run.signal.removeEventListener('abort', done);
        resolve();
      }
      run.signal.addEventListener('abort', done, { once: true });
    });
  }

  /**
   * 解析时长：支持 1800 / "1800" / "30:00" / "1:30:00"
   * 注意：0 视为"没拿到"，返回 null（与原脚本一致）
   */
  function parseDurationSeconds(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) && value > 0 ? value : null;
    }
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      const n = parseFloat(trimmed);
      return n > 0 ? n : null;
    }

    const parts = trimmed.split(':');
    if (parts.length !== 2 && parts.length !== 3) return null;
    const nums = parts.map((p) => Number.parseInt(p, 10));
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;

    const seconds = parts.length === 2 ? nums[0] * 60 + nums[1] : nums[0] * 3600 + nums[1] * 60 + nums[2];
    return seconds > 0 ? seconds : null;
  }

  function pickDurationSec(...values) {
    for (const v of values) {
      const s = parseDurationSeconds(v);
      if (s) return s;
    }
    return null;
  }

  /** 从 study_detail 里读已有进度百分比（字段名各接口不统一，多试几个） */
  function pickRatio(detail) {
    if (!detail || typeof detail !== 'object') return 0;
    const keys = ['ratio', 'progress', 'rate', 'percent', 'percentage', 'study_ratio', 'study_rate', 'schedule'];
    for (const key of keys) {
      const n = toNumber(detail[key]);
      if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
    }
    return 0;
  }

  function pickStudiedTimeSec(detail) {
    if (!detail || typeof detail !== 'object') return 0;
    for (const key of ['time', 'study_time', 'studied_time']) {
      const n = toNumber(detail[key]);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return 0;
  }

  // ==================== 登录态 ====================

  function getToken() {
    // 主 key 是 token；其余为兼容写法，值里若带 "Bearer " 前缀会去掉
    const keys = ['token', 'Token', 'access_token', 'accessToken', 'Authorization'];
    for (const key of keys) {
      let value = null;
      try {
        value = localStorage.getItem(key);
      } catch {
        value = null;
      }
      if (!value || value === 'null' || value === 'undefined') continue;
      const trimmed = value.trim();
      // 只有 Authorization 才可能是 "Bearer xxx" 形式；token 字段必须原样透传，
      // 擅自剥前缀会把本来能用的登录态变成 401
      return key === 'Authorization' ? trimmed.replace(/^Bearer\s+/i, '') : trimmed;
    }
    return null;
  }

  // ==================== 请求层 ====================

  function createRun() {
    const controller = new AbortController();
    return {
      controller,
      signal: controller.signal,
      get aborted() {
        return controller.signal.aborted;
      },
      failures: [],
      successCount: 0,
    };
  }

  /**
   * 统一请求：超时、中断、状态码、JSON 解析、code 判定，全部收敛到这里。
   * @param {string} path
   * @param {{method?: string, body?: any, run?: object, onRetry?: Function}} options
   */
  async function apiRequest(path, options = {}) {
    const { method = 'GET', body, run, onRetry } = options;

    const token = getToken();
    if (!token) throw new FatalError('未检测到登录状态（localStorage 里没有 token），请先登录再刷新页面');

    const url = CONFIG.apiBase + path;
    const headers = { token };
    const init = { method, headers, cache: 'no-store', credentials: 'omit' };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const controller = new AbortController();
    init.signal = controller.signal;

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CONFIG.requestTimeoutMs);

    const onAbort = () => controller.abort();
    if (run && run.signal) run.signal.addEventListener('abort', onAbort, { once: true });

    try {
      const resp = await fetch(url, init);

      if (resp.status === 401 || resp.status === 403) {
        throw new FatalError(`登录状态已失效（HTTP ${resp.status}），请重新登录后刷新页面`);
      }

      const text = await resp.text();
      if (!resp.ok) {
        const retryable = resp.status >= 500 || resp.status === 429 || resp.status === 408;
        throw new ApiError(`HTTP ${resp.status} ${text.slice(0, 80)}`, { retryable, status: resp.status });
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        // 常见于网关返回 HTML 错误页，重试一次往往就好了
        throw new ApiError(`响应不是 JSON：${text.slice(0, 80) || '(空响应)'}`, { retryable: true });
      }

      // 服务端可能返回数字 200，也可能返回字符串 "200"
      const code = toNumber(data && data.code);
      if (code !== 200) {
        const msg = (data && (data.msg || data.message)) || `code=${data && data.code}`;
        if (code === 401 || code === 403) throw new FatalError(`登录状态已失效：${msg}，请重新登录`);
        // HTTP 200 + code 500 这类"业务层 5xx"很常见，值得重试；参数类错误重试无意义
        const retryable = code >= 500 || code === 429 || code === 408;
        throw new ApiError(String(msg), { retryable });
      }
      return data;
    } catch (err) {
      if (err instanceof StopError) throw err;
      // 用户主动停止优先于任何错误分类：停止瞬间收到的 401/业务错误不该被当成真失败
      if (run && run.aborted) throw new StopError();
      if (err instanceof FatalError || err instanceof ApiError) throw err;
      if (timedOut) throw new ApiError(`请求超时（${CONFIG.requestTimeoutMs}ms）`, { retryable: true });
      throw new ApiError(`网络错误：${(err && err.message) || err}`, { retryable: true });
    } finally {
      clearTimeout(timer);
      if (run && run.signal) run.signal.removeEventListener('abort', onAbort);
    }
  }

  /** 带重试的请求：致命错误直接抛，其余按次数退避重试 */
  async function apiRequestWithRetry(path, options, run) {
    const attempts = Math.max(1, Math.floor(CONFIG.maxRetries));
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (run && run.aborted) throw new StopError();
      try {
        return await apiRequest(path, { ...options, run });
      } catch (err) {
        if (err instanceof FatalError || err instanceof StopError) throw err;
        // 业务错误重试无意义，直接抛给上层跳过这节课
        if (err instanceof ApiError && !err.retryable) throw err;
        lastError = err;
        if (attempt >= attempts) break;
        const delay = CONFIG.retryBaseDelayMs * attempt;
        if (options && typeof options.onRetry === 'function') {
          options.onRetry({ attempt, attempts, delay, error: err });
        }
        await sleep(delay, run);
      }
    }
    throw lastError;
  }

  // ==================== 页面上下文 ====================

  function detectContext() {
    const hash = location.hash || '';
    const water = /\/waterCourse\//.test(hash);
    const courseMatch = hash.match(/\/course\/(\d+)/);
    const waterMatch = hash.match(/\/waterCourse\/(\d+)/);
    const yearMatch = hash.match(/year=(\d+)/);

    return {
      water,
      courseId: water ? (waterMatch ? Number(waterMatch[1]) : null) : courseMatch ? Number(courseMatch[1]) : null,
      year: yearMatch ? yearMatch[1] : String(new Date().getFullYear()),
      yearGuessed: !yearMatch, // 猜的年份要提示用户，补学往年课程时很容易刷错年度
      supported: Boolean(waterMatch || courseMatch),
      key: `${water ? 'water' : 'course'}:${water ? (waterMatch ? waterMatch[1] : '') : courseMatch ? courseMatch[1] : ''}`,
    };
  }

  // ==================== 数据获取与归一化 ====================

  /**
   * 关键点：上报用的 detailId 必须在合并前取原始 id。
   * 原脚本 {...lesson, ...detail} 之后 lesson.id 可能被 detail.id 覆盖，
   * 一旦两个 id 语义不同（plan_detail_id vs detail.id），就会刷错课时。
   */
  function normalizeLesson(raw, detail) {
    const source = raw || {};
    // 上报 id 必须在合并前固定：合并后 source.id 可能被 detail.id 覆盖
    const detailId = toNumber(source.id ?? source.video_detail_id ?? source.detail_id);
    const merged = { ...source, ...(detail || {}) };

    // 只认"视频时长"语义的字段。detail 里的 time / study_time 是"已学时长"，
    // 拿它当视频长度会让上报的 time 只有真实值的一半（ratio 报 100% 但时长不足）
    const realDuration = pickDurationSec(
      source.duration,
      source.video_duration,
      source.video_time,
      source.length,
      source.time,
      merged.duration,
      merged.video_duration,
      merged.video_time,
      merged.length
    );

    return {
      detailId,
      title: String(source.title || source.name || source.video_name || merged.title || `课时 ${detailId}`),
      done: toNumber(merged.status) === 1,
      durationSec: realDuration || CONFIG.defaultDurationSec,
      durationFallback: !realDuration,
      startRatio: pickRatio(detail),
      startTimeSec: pickStudiedTimeSec(detail),
    };
  }

  /** 水课程：按页拉，去重，直到没有新数据（原脚本写死 page:1，会漏课） */
  async function fetchWaterPayload(courseId, run, onRetry) {
    const all = [];
    const seen = new Set();
    const studyDetail = {};
    let meta = {};
    let detail = {};
    let truncated = true; // 只有正常翻到底才置 false

    for (let page = 1; page <= CONFIG.maxPages; page++) {
      const data = await apiRequestWithRetry('/water_plan_detail', { method: 'POST', body: { water_plan_id: courseId, page }, onRetry }, run);
      const rawPayload = data && data.data;
      // 兼容两种返回结构：data 直接是数组，或 data 是 {data:[], study_detail, detail}
      const payload = Array.isArray(rawPayload) ? { data: rawPayload } : rawPayload || {};

      if (page === 1) {
        meta = payload;
        detail = payload.detail || {};
      }
      Object.assign(studyDetail, payload.study_detail || {});

      const chunk = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.list) ? payload.list : [];

      let added = 0;
      for (const item of chunk) {
        const id = toNumber(item && (item.id ?? item.water_plan_detail_id ?? item.detail_id));
        if (!Number.isFinite(id) || seen.has(id)) continue;
        seen.add(id);
        all.push(item);
        added++;
      }

      if (added === 0) {
        truncated = false; // 没有新数据，说明翻到底了
        break;
      }

      const lastPage = toNumber(payload.last_page ?? payload.total_page ?? payload.pages);
      if (Number.isFinite(lastPage) && page >= lastPage) {
        truncated = false;
        break;
      }

      const total = toNumber(payload.total ?? payload.count);
      if (Number.isFinite(total) && all.length >= total) {
        truncated = false;
        break;
      }
    }

    let gotStudyTime = 0;
    for (const item of all) {
      const d = studyDetail[item.id] || studyDetail[String(item.id)];
      if (toNumber(d && d.status) === 1 || toNumber(item.status) === 1) {
        gotStudyTime += toNumber((d && d.time) ?? item.study_time ?? item.time, 0);
      }
    }

    return {
      list: all,
      studyDetail,
      totalStudyTime: toNumber(detail.study_time, 0),
      gotStudyTime: round2(gotStudyTime),
      meta,
      truncated,
    };
  }

  async function fetchCoursePayload(courseId, year, run, onRetry) {
    const path = `/video_detail?video_id=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}`;
    const data = await apiRequestWithRetry(path, { onRetry }, run);
    const payload = (data && data.data) || {};
    return {
      list: Array.isArray(payload.list) ? payload.list : Array.isArray(payload.data) ? payload.data : [],
      studyDetail: payload.study_detail || {},
      totalStudyTime: payload.total_studytime,
      gotStudyTime: payload.get_studytime,
      meta: payload,
    };
  }

  /** 刷完回读一次，核对服务端是否真的都记为完成了 */
  async function verifyRemaining(ctx, run, onRetry) {
    const payload = ctx.water
      ? await fetchWaterPayload(ctx.courseId, run, onRetry)
      : await fetchCoursePayload(ctx.courseId, ctx.year, run, onRetry);

    const remaining = [];
    for (const raw of payload.list) {
      const detail = payload.studyDetail[raw.id] || payload.studyDetail[String(raw.id)] || {};
      const status = toNumber(detail.status ?? raw.status);
      if (status !== 1) {
        remaining.push(String((raw && (raw.title || raw.name || raw.video_name)) || `#${raw && raw.id}`));
      }
    }
    return remaining;
  }

  // ==================== 上报 ====================

  /** 从当前进度往后排步，绝不回退、绝不重复上报 */
  function buildStepRatios(startRatio) {
    const steps = clamp(Math.floor(CONFIG.steps) || 1, 1, 20);
    const start = clamp(Number(startRatio) || 0, 0, 99.99);
    const ratios = [];

    for (let i = 1; i <= steps; i++) {
      const ratio = round2((100 * i) / steps);
      if (ratio > start + 0.01) ratios.push(ratio);
    }
    if (!ratios.length) ratios.push(100);
    if (ratios[ratios.length - 1] < 100) ratios.push(100);
    return ratios;
  }

  function buildStudyBody(ctx, lesson, ratio) {
    // ratio 保持与原脚本一致的字符串格式（"50.00"），避免服务端做类型校验时翻车
    const ratioText = ratio.toFixed(2);
    // startTimeSec 来自服务端，可能是毫秒/时间戳等脏数据；超出视频时长的一律当无效值丢弃，
    // 否则会把天文数字当学时提交上去
    const rawStart = lesson.startTimeSec || 0;
    const startTime = rawStart > 0 && rawStart <= lesson.durationSec ? rawStart : 0;
    const time = round2(Math.max(startTime, (lesson.durationSec * ratio) / 100));

    if (ctx.water) {
      return {
        water_plan_id: ctx.courseId,
        water_plan_detail_id: lesson.detailId,
        ratio: ratioText,
        time,
      };
    }
    return {
      video_id: ctx.courseId,
      video_detail_id: lesson.detailId,
      ratio: ratioText,
      time,
      year: ctx.year,
    };
  }

  async function studyOneLesson(ctx, lesson, run, hooks) {
    const endpoint = ctx.water ? '/video_detail_study_water' : '/video_detail_study';
    const ratios = buildStepRatios(lesson.startRatio);

    for (let i = 0; i < ratios.length; i++) {
      if (run.aborted) throw new StopError();

      const body = buildStudyBody(ctx, lesson, ratios[i]);
      await apiRequestWithRetry(
        endpoint,
        {
          method: 'POST',
          body,
          onRetry: (info) => hooks.onRetry && hooks.onRetry(lesson, info),
        },
        run
      );

      if (hooks.onStep) hooks.onStep(i + 1, ratios.length, ratios[i]);

      if (i < ratios.length - 1) await sleep(CONFIG.stepIntervalMs, run);
    }
  }

  // ==================== UI ====================

  const PANEL_ID = 'h21al-panel';
  const STYLE_ID = 'h21al-style';

  const STYLES = `
  #${PANEL_ID} {
    position: fixed !important; top: 80px; right: 20px; z-index: 2147483000 !important;
    width: 348px; box-sizing: border-box; background: #fff; color: #333;
    border: 2px solid #c0392b; border-radius: 10px; padding: 0;
    box-shadow: 0 6px 24px rgba(0,0,0,.18); font-family: 'Microsoft YaHei', system-ui, sans-serif;
    font-size: 13px; line-height: 1.5; text-align: left;
  }
  #${PANEL_ID} * { box-sizing: border-box; }
  #${PANEL_ID} .h21al-head {
    display: flex; align-items: center; gap: 6px; cursor: move; user-select: none;
    padding: 10px 12px; border-bottom: 1px solid #f0f0f0; background: #fdf6f5;
    border-radius: 8px 8px 0 0;
  }
  #${PANEL_ID} .h21al-title { font-size: 15px; font-weight: 700; color: #c0392b; }
  #${PANEL_ID} .h21al-tag {
    font-size: 11px; color: #888; background: #fff; border: 1px solid #eee;
    border-radius: 10px; padding: 0 7px; line-height: 17px;
  }
  #${PANEL_ID} .h21al-spacer { flex: 1; }
  #${PANEL_ID} .h21al-icon {
    width: 20px; height: 20px; line-height: 18px; text-align: center; cursor: pointer;
    border: 1px solid transparent; border-radius: 4px; background: transparent;
    color: #999; font-size: 14px; padding: 0;
  }
  #${PANEL_ID} .h21al-icon:hover { background: #f2f2f2; color: #c0392b; }
  #${PANEL_ID} .h21al-body { padding: 10px 12px 12px; }
  #${PANEL_ID} .h21al-status { color: #555; margin-bottom: 8px; min-height: 20px; word-break: break-all; }
  #${PANEL_ID} .h21al-bar { height: 18px; background: #eee; border-radius: 6px; overflow: hidden; margin-bottom: 8px; }
  #${PANEL_ID} .h21al-bar > div {
    height: 100%; width: 0%; background: linear-gradient(90deg,#e74c3c,#c0392b); color: #fff;
    font-size: 11px; line-height: 18px; text-align: center; transition: width .3s;
  }
  #${PANEL_ID} .h21al-cfg { display: flex; gap: 8px; margin-bottom: 8px; }
  #${PANEL_ID} .h21al-cfg label { flex: 1; font-size: 11px; color: #888; display: flex; flex-direction: column; gap: 2px; }
  #${PANEL_ID} .h21al-cfg input {
    width: 100%; font-size: 12px; padding: 3px 5px; border: 1px solid #ddd;
    border-radius: 4px; color: #333; background: #fff;
  }
  #${PANEL_ID} .h21al-log {
    max-height: 160px; overflow-y: auto; font-size: 11px; color: #777;
    border-top: 1px solid #f0f0f0; padding-top: 6px; margin-bottom: 8px;
    font-family: Consolas, Menlo, monospace; word-break: break-all;
  }
  #${PANEL_ID} .h21al-log .err { color: #c0392b; }
  #${PANEL_ID} .h21al-log .ok { color: #27ae60; }
  #${PANEL_ID} .h21al-btns { display: flex; gap: 8px; }
  #${PANEL_ID} .h21al-btn {
    flex: 1; border: none; border-radius: 6px; padding: 8px 0; font-size: 13px;
    cursor: pointer; color: #fff; background: #c0392b;
  }
  #${PANEL_ID} .h21al-btn:disabled { opacity: .55; cursor: not-allowed; }
  #${PANEL_ID} .h21al-btn.gray { background: #95a5a6; }
  #${PANEL_ID} .h21al-summary { margin-top: 8px; font-size: 12px; color: #555; word-break: break-all; }
  #${PANEL_ID}.h21al-min .h21al-body { display: none; }
  #${PANEL_ID}.h21al-min .h21al-head { border-bottom: none; border-radius: 8px; }
  `;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    (document.head || document.documentElement).appendChild(style);
  }

  function el(id) {
    return document.getElementById(id);
  }

  function createPanel(ctx) {
    injectStyles();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    // 关键布局内联兜底：万一站点 CSP 拦掉 <style> 或 head 被重渲染，面板至少还能浮起来
    panel.style.cssText = 'position:fixed;top:80px;right:20px;z-index:2147483000;width:348px;box-sizing:border-box;';
    panel.innerHTML = `
      <div class="h21al-head" id="h21al-drag">
        <span class="h21al-title">自动刷课助手</span>
        <span class="h21al-tag" id="h21al-mode"></span>
        <span class="h21al-spacer"></span>
        <button class="h21al-icon" id="h21al-min" title="最小化">—</button>
        <button class="h21al-icon" id="h21al-close" title="关闭面板">×</button>
      </div>
      <div class="h21al-body">
        <div class="h21al-status" id="h21al-status">等待开始…</div>
        <div class="h21al-bar"><div id="h21al-bar-fill">0%</div></div>
        <div class="h21al-cfg">
          <label>每节步数<input id="h21al-cfg-steps" type="number" min="1" max="20" step="1"></label>
          <label>上报间隔(ms)<input id="h21al-cfg-interval" type="number" min="0" max="60000" step="500"></label>
          <label>课间间隔(ms)<input id="h21al-cfg-gap" type="number" min="0" max="60000" step="500"></label>
        </div>
        <div class="h21al-log" id="h21al-log"></div>
        <div class="h21al-btns">
          <button class="h21al-btn" id="h21al-start">开始刷课</button>
          <button class="h21al-btn gray" id="h21al-stop" style="display:none">停止</button>
        </div>
        <div class="h21al-summary" id="h21al-summary"></div>
      </div>
    `;
    document.body.appendChild(panel);

    restorePanelPosition(panel);
    enableDrag(panel, el('h21al-drag'));

    el('h21al-min').addEventListener('click', () => panel.classList.toggle('h21al-min'));
    el('h21al-close').addEventListener('click', () => {
      panelClosedByUser = true;
      stopAutoLearn();
      panel.remove();
      const style = el(STYLE_ID);
      if (style) style.remove();
    });
    // 直接绑在按钮上，不依赖事件冒泡（站点可能 stopPropagation）
    el('h21al-start').addEventListener('click', () => startAutoLearn());
    el('h21al-stop').addEventListener('click', () => stopAutoLearn());

    // 配置项回填 + 即时保存
    const cfgSteps = el('h21al-cfg-steps');
    const cfgInterval = el('h21al-cfg-interval');
    const cfgGap = el('h21al-cfg-gap');
    cfgSteps.value = String(CONFIG.steps);
    cfgInterval.value = String(CONFIG.stepIntervalMs);
    cfgGap.value = String(CONFIG.lessonGapMs);

    const bind = (input, key, min, max) => {
      input.addEventListener('change', () => {
        const n = toNumber(input.value);
        if (!Number.isFinite(n)) {
          input.value = String(CONFIG[key]);
          return;
        }
        const v = clamp(n, min, max);
        input.value = String(v);
        saveConfig({ [key]: v });
        log('config', key, v);
      });
    };
    bind(cfgSteps, 'steps', 1, 20);
    bind(cfgInterval, 'stepIntervalMs', 0, 60000);
    bind(cfgGap, 'lessonGapMs', 0, 60000);

    updateModeTag(ctx);

    // 面板被站点重渲染冲掉后重建：任务还在跑的话，按钮状态要跟着恢复
    if (activeRun) {
      ui.running(true);
      ui.status('任务运行中…');
    }
    return panel;
  }

  function updateModeTag(ctx) {
    const tag = el('h21al-mode');
    if (tag) tag.textContent = ctx.water ? '水课程' : '普通课程';
  }

  function restorePanelPosition(panel) {
    let pos = null;
    try {
      pos = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    } catch {
      pos = null;
    }
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      panel.style.left = `${clamp(pos.left, 0, window.innerWidth - 80)}px`;
      panel.style.top = `${clamp(pos.top, 0, window.innerHeight - 40)}px`;
      panel.style.right = 'auto';
    }
  }

  // 拖拽状态放在模块级，window 上的监听只绑一次，面板重建也不会累积监听器
  let dragState = null;
  let dragBound = false;

  function enableDrag(panel, handle) {
    if (!handle) return;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      dragState = { panel, startX: e.clientX, startY: e.clientY, originLeft: rect.left, originTop: rect.top };
      panel.style.right = 'auto';
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      e.preventDefault();
    });

    if (dragBound) return;
    dragBound = true;

    window.addEventListener('mousemove', (e) => {
      if (!dragState) return;
      const { panel: target, startX, startY, originLeft, originTop } = dragState;
      target.style.left = `${clamp(originLeft + (e.clientX - startX), 0, window.innerWidth - target.offsetWidth)}px`;
      target.style.top = `${clamp(originTop + (e.clientY - startY), 0, window.innerHeight - 30)}px`;
    });

    window.addEventListener('mouseup', () => {
      if (!dragState) return;
      const { panel: target } = dragState;
      dragState = null;
      try {
        localStorage.setItem(POS_KEY, JSON.stringify({ left: target.offsetLeft, top: target.offsetTop }));
      } catch {
        /* ignore */
      }
    });
  }

  // 所有 DOM 操作都做空值保护：面板被移除 / 被站点清空时不再抛 TypeError
  const ui = {
    status(text) {
      const node = el('h21al-status');
      if (node) node.textContent = text;
    },
    progress(percent) {
      const bar = el('h21al-bar-fill');
      if (!bar) return;
      const p = clamp(Math.round(percent), 0, 100);
      bar.style.width = `${p}%`;
      bar.textContent = `${p}%`;
    },
    log(text, level) {
      const box = el('h21al-log');
      if (!box) return;
      const line = document.createElement('div');
      if (level) line.className = level;
      line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
      box.appendChild(line);
      while (box.childElementCount > CONFIG.maxLogLines) box.removeChild(box.firstElementChild);
      box.scrollTop = box.scrollHeight;
    },
    summary(text) {
      const node = el('h21al-summary');
      if (node) node.textContent = text;
    },
    running(isRunning) {
      const start = el('h21al-start');
      const stop = el('h21al-stop');
      if (start) {
        start.style.display = isRunning ? 'none' : 'block';
        start.disabled = isRunning;
      }
      if (stop) stop.style.display = isRunning ? 'block' : 'none';
    },
  };

  // ==================== 主流程 ====================

  let activeRun = null;
  // 用户点了 × 关闭后不要再被 MutationObserver 自动弹回来
  let panelClosedByUser = false;

  function stopAutoLearn() {
    if (!activeRun) return;
    activeRun.controller.abort();
    ui.status('正在停止…');
  }

  async function startAutoLearn() {
    if (activeRun) return; // 防重复启动

    const ctx = detectContext();
    if (!ctx.supported || !ctx.courseId) {
      ui.status('请先打开一个课程页面（普通课程或水课程）');
      return;
    }
    if (!getToken()) {
      ui.status('未检测到登录状态，请先登录');
      return;
    }

    const run = createRun();
    activeRun = run;
    ui.running(true);
    ui.summary('');
    updateModeTag(ctx);

    try {
      ui.status('获取课程信息…');
      ui.log(`${ctx.water ? '水课程' : '课程'} ID: ${ctx.courseId}${ctx.water ? '' : `, 年份: ${ctx.year}`}`);
      if (!ctx.water && ctx.yearGuessed) {
        ui.log(`⚠ URL 里没有 year 参数，已按 ${ctx.year} 处理；补学往年课程时请从课程列表重新进入`, 'err');
      }

      const onRetry = (info) => {
        ui.log(`请求失败（${info.error.message}），${info.delay}ms 后重试 ${info.attempt}/${info.attempts - 1}`, 'err');
      };

      const payload = ctx.water
        ? await fetchWaterPayload(ctx.courseId, run, onRetry)
        : await fetchCoursePayload(ctx.courseId, ctx.year, run, onRetry);

      const lessons = [];
      for (const raw of payload.list) {
        const detail = payload.studyDetail[raw.id] || payload.studyDetail[String(raw.id)] || {};
        const lesson = normalizeLesson(raw, detail);
        // 没有有效 id 就没法上报，宁可跳过并告警，也不要往接口塞 null
        if (!Number.isFinite(lesson.detailId)) {
          ui.log(`跳过: 课时缺少有效 id（${lesson.title}）`, 'err');
          continue;
        }
        lessons.push(lesson);
      }

      if (payload.truncated) {
        ui.log(`⚠ 水课程已翻到最大页数 ${CONFIG.maxPages}，后面可能还有课时没加载到`, 'err');
      }

      if (!lessons.length) {
        ui.status('没有取到任何课时，可能课程数据为空或接口结构变了');
        ui.log('课时列表为空', 'err');
        return;
      }

      const todo = lessons.filter((lesson) => !lesson.done);
      const skipped = lessons.length - todo.length;

      ui.log(`共 ${lessons.length} 节，已完成 ${skipped} 节，待完成 ${todo.length} 节`);
      if (Number.isFinite(toNumber(payload.gotStudyTime))) {
        ui.log(`已获学时: ${payload.gotStudyTime}/${payload.totalStudyTime ?? '?'}`);
      }

      if (!todo.length) {
        ui.status('所有课程已完成！');
        ui.summary(`共 ${lessons.length} 节，全部已完成`);
        ui.progress(100);
        return;
      }

      for (let i = 0; i < todo.length; i++) {
        if (run.aborted) throw new StopError();

        const lesson = todo[i];
        const base = (i / todo.length) * 100;

        ui.status(`正在学习 (${i + 1}/${todo.length}): ${lesson.title}`);
        ui.progress(base);
        ui.log(`开始: ${lesson.title}${lesson.durationFallback ? '（未取到时长，按兜底时长上报）' : ''}`);

        try {
          await studyOneLesson(ctx, lesson, run, {
            onRetry: (l, info) => ui.log(`  ${l.title} 上报失败（${info.error.message}），第 ${info.attempt} 次重试`, 'err'),
            onStep: (step, total) => ui.progress(base + (step / total) * (100 / todo.length)),
          });
          run.successCount++;
          ui.log(`完成: ${lesson.title}`, 'ok');
        } catch (err) {
          if (err instanceof StopError || err instanceof FatalError) throw err;
          // 单节课失败不中断整轮，记下来继续刷下一节
          run.failures.push({ title: lesson.title, message: err.message });
          ui.log(`失败: ${lesson.title} —— ${err.message}`, 'err');
        }

        ui.progress(((i + 1) / todo.length) * 100);

        if (i < todo.length - 1 && !run.aborted) {
          await sleep(CONFIG.lessonGapMs, run);
        }
      }

      if (run.aborted) throw new StopError();

      // 回读校验：接口 code=200 不等于服务端真记上了，最后核一遍再下结论
      let verifyNote = '';
      if (CONFIG.verifyAfterRun) {
        ui.status('回读校验中…');
        try {
          // 服务端未必强一致，立刻回读容易误报"仍有未完成"，等一拍再查
          await sleep(1500, run);
          const remaining = await verifyRemaining(ctx, run, onRetry);
          if (remaining.length) {
            verifyNote = `，回读仍有 ${remaining.length} 节未完成`;
            ui.log(`⚠ 回读仍有 ${remaining.length} 节未完成：${remaining.slice(0, 6).join('、')}`, 'err');
          } else {
            ui.log('回读确认：全部已完成', 'ok');
          }
        } catch (err) {
          if (err instanceof StopError) throw err;
          // 校验失败不影响已经提交的进度，只是不给"全部完成"的结论
          ui.log(`回读校验失败（已提交的进度不受影响）：${err.message}`, 'err');
          verifyNote = '，回读校验失败';
        }
      }

      if (!run.failures.length) ui.progress(100);
      if (run.failures.length) {
        ui.status(`完成，但有 ${run.failures.length} 节失败`);
        ui.log(`失败 ${run.failures.length} 节，可再点一次「开始刷课」补刷（已完成的会自动跳过）`, 'err');
        ui.summary(`成功 ${run.successCount} 节 · 失败 ${run.failures.length} 节：${run.failures.map((f) => f.title).join('、')}${verifyNote}`);
      } else {
        ui.status(verifyNote ? '完成，但回读结果与预期不一致' : '全部课程学习完成！');
        ui.summary(`成功 ${run.successCount} 节 · 跳过已完成 ${skipped} 节${verifyNote}`);
        ui.log('所有课程已刷完，可以去考试了', 'ok');
      }
    } catch (err) {
      if (err instanceof StopError) {
        ui.status('已停止');
        ui.log('用户手动停止');
      } else {
        ui.status(`出错: ${err.message}`);
        ui.log(`错误: ${err.message}`, 'err');
        if (!(err instanceof FatalError)) console.error('[自动刷课]', err);
      }
    } finally {
      activeRun = null;
      ui.running(false);
    }
  }

  // ==================== 初始化 ====================

  function ensurePanel() {
    if (panelClosedByUser) return;
    const ctx = detectContext();
    if (!ctx.supported) {
      removePanel();
      return;
    }
    if (!el(PANEL_ID)) createPanel(ctx);
    else updateModeTag(ctx);
  }

  function removePanel() {
    // 面板没了就停掉后台任务，否则会继续在看不见的地方上报
    stopAutoLearn();
    const panel = el(PANEL_ID);
    if (panel) panel.remove();
    const style = el(STYLE_ID);
    if (style) style.remove();
  }

  let lastContextKey = null;

  function syncWithRoute() {
    const ctx = detectContext();
    if (!ctx.supported) {
      if (el(PANEL_ID)) removePanel();
      lastContextKey = null;
      // 经过一次非课程页（比如课程列表）就解除"用户已关闭"状态，
      // 否则用户关一次面板、点一下列表，本会话就再也见不到面板了
      panelClosedByUser = false;
      return;
    }
    // 切换到了另一门课：先停掉正在跑的任务，再更新面板
    if (lastContextKey !== null && lastContextKey !== ctx.key) {
      stopAutoLearn();
      panelClosedByUser = false;
      ui.status('已切换课程，等待开始…');
      ui.progress(0);
      ui.summary('');
    }
    lastContextKey = ctx.key;
    ensurePanel();
  }

  function init() {
    log('init, hash:', location.hash);
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', init, { once: true });
      return;
    }
    window.addEventListener('hashchange', syncWithRoute);    syncWithRoute();
    // SPA 有时不走 hashchange（用 pushState / 重渲染），MutationObserver 兜底
    const observer = new MutationObserver(() => {
      if (!panelClosedByUser && !el(PANEL_ID) && document.body && detectContext().supported) ensurePanel();
    });
    observer.observe(document.body, { childList: true, subtree: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
