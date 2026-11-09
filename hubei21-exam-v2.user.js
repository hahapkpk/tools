// ==UserScript==
// @name         湖北21世纪学习平台 - AI自动答题 (v2)
// @namespace    https://github.com/hahapkpk/tools
// @version      2.0.0
// @description  自动提取考试题目，调用 AI 分析答案，自动填写并定时交卷（v2 独立版：分批提问、失败重试、答案校验、可随时取消。与 1.0.2 并存，不会覆盖旧脚本）
// @author       Flywind
// @match        https://www.hubei21.com/*
// @match        https://hubei21.com/*
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/hubei21-exam-v2.user.js
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/hubei21-exam-v2.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ==========================================================================
   * 这是一个独立的新脚本（hubei21-exam-v2.user.js），@name 与 1.0.2 不同，
   * 所以 Tampermonkey 会当成另一个脚本安装，不会把已装的 1.0.2 自动更新掉。
   * 两个都装会同时出现两个面板，建议装 v2 后停用旧的。
   *
   * 2.0.0 相比 1.0.2 的改动
   *  1. Prompt 里给每个选项加上字母前缀（A. B. C.），AI 才能真正对上字母；
   *     原来只发选项文本却要 AI 回 "A"/"AB"，纯靠位置猜。
   *  2. 分批提问（默认 15 题/批），避免题多时超上下文；每批独立重试。
   *  3. 解析失败/网络失败都会重试，不再是"一次失败整轮作废"。
   *  4. 答案校验：题号缺失、字母越界、多选题字母重复都会被发现并如实报告。
   *  5. 判断题按选项文本匹配（页面可能是"错误/正确"顺序），不再硬编码 A=正确。
   *  6. 选项与可点击节点一一对应，修掉原来"选项去重导致字母错位"的坑。
   *  7. 多选题只点未选中的，避免把已选项点掉。
   *  8. 等待交卷可随时取消；有未答题目时默认不自动交卷（防止交白卷/低分）。
   *  9. 交卷确认按钮排除"取消/关闭"，避免误点。
   * 10. 配置面板防重复打开，日志有上限，题目加载改用 MutationObserver 而不是死等 30 秒。
   * ========================================================================== */

  // ==================== 配置 ====================

  const CONFIG_KEY = 'exam_config';

  const DEFAULT_CONFIG = {
    apiBase: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-v4-pro',
    submitDelay: 11, // 交卷等待分钟数
    batchSize: 15, // 每批提问的题目数
    maxRetries: 3, // 每批最多尝试次数
    requireAllAnswered: true, // 有未答题目时不自动交卷
  };

  function getConfig() {
    let saved = {};
    try {
      saved = GM_getValue(CONFIG_KEY, {}) || {};
    } catch (e) {
      saved = {};
    }
    const config = { ...DEFAULT_CONFIG, ...saved };

    // 数值项做一次收敛，防止配置被写成字符串/0/负数
    const clampNum = (value, fallback, min, max) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    };
    config.submitDelay = clampNum(config.submitDelay, DEFAULT_CONFIG.submitDelay, 1, 180);
    config.batchSize = clampNum(config.batchSize, DEFAULT_CONFIG.batchSize, 1, 50);
    config.maxRetries = clampNum(config.maxRetries, DEFAULT_CONFIG.maxRetries, 1, 6);
    config.requireAllAnswered = config.requireAllAnswered !== false;
    return config;
  }

  function saveConfig(config) {
    GM_setValue(CONFIG_KEY, config);
  }

  function setInputValue(id, value) {
    const input = document.getElementById(id);
    if (input) input.value = value || '';
  }

  function getProviderPreset(config) {
    if (
      config.apiBase === 'https://api.deepseek.com' &&
      config.model === 'deepseek-v4-pro'
    ) {
      return 'deepseek';
    }
    return 'custom';
  }

  function applyProviderPreset(provider) {
    if (provider === 'deepseek') {
      setInputValue('cfg-base', 'https://api.deepseek.com');
      setInputValue('cfg-model', 'deepseek-v4-pro');
    }
  }

  // ==================== 配置面板 ====================

  const DIALOG_ID = 'ai-exam-config';

  function showConfigDialog() {
    // 防重复打开：原来每点一次就叠一层遮罩
    if (document.getElementById(DIALOG_ID)) return;

    const config = getConfig();
    const overlay = document.createElement('div');
    overlay.id = DIALOG_ID;
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:24px;width:420px;max-height:86vh;overflow-y:auto;font-family:'Microsoft YaHei',sans-serif;">
        <h3 style="margin:0 0 16px;color:#c0392b;">AI 答题配置</h3>
        <label style="display:block;margin-bottom:12px;">
          <div style="font-size:13px;color:#666;margin-bottom:4px;">常用配置</div>
          <select id="cfg-provider" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;background:#fff;">
            <option value="deepseek">DeepSeek 官方</option>
            <option value="custom">自定义 OpenAI 兼容接口</option>
          </select>
        </label>
        <label style="display:block;margin-bottom:12px;">
          <div style="font-size:13px;color:#666;margin-bottom:4px;">API Base URL</div>
          <input id="cfg-base" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;" />
        </label>
        <label style="display:block;margin-bottom:12px;">
          <div style="font-size:13px;color:#666;margin-bottom:4px;">API Key</div>
          <input id="cfg-key" type="password" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;" />
        </label>
        <label style="display:block;margin-bottom:12px;">
          <div style="font-size:13px;color:#666;margin-bottom:4px;">模型 (如 gpt-4o, deepseek-chat, claude-sonnet-4-20250514)</div>
          <input id="cfg-model" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;" />
        </label>
        <label style="display:block;margin-bottom:12px;">
          <div style="font-size:13px;color:#666;margin-bottom:4px;">交卷等待时间（分钟）</div>
          <input id="cfg-delay" type="number" min="1" max="180" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;" />
        </label>
        <label style="display:block;margin-bottom:12px;">
          <div style="font-size:13px;color:#666;margin-bottom:4px;">每批题目数（题多时自动分批提问）</div>
          <input id="cfg-batch" type="number" min="1" max="50" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;" />
        </label>
        <label style="display:block;margin-bottom:16px;">
          <div style="font-size:13px;color:#666;margin-bottom:4px;">
            <input id="cfg-require-all" type="checkbox" style="vertical-align:-2px;" /> 有题目没答上时不自动交卷
          </div>
        </label>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="cfg-cancel" style="padding:8px 20px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;">取消</button>
          <button id="cfg-save" style="padding:8px 20px;border:none;border-radius:6px;background:#c0392b;color:#fff;cursor:pointer;">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    setInputValue('cfg-base', config.apiBase);
    setInputValue('cfg-key', config.apiKey);
    setInputValue('cfg-model', config.model);
    setInputValue('cfg-delay', config.submitDelay);
    setInputValue('cfg-batch', config.batchSize);
    setInputValue('cfg-provider', getProviderPreset(config));
    const requireAll = document.getElementById('cfg-require-all');
    if (requireAll) requireAll.checked = config.requireAllAnswered;

    document.getElementById('cfg-provider').onchange = (event) => {
      applyProviderPreset(event.target.value);
    };

    document.getElementById('cfg-cancel').onclick = () => overlay.remove();
    document.getElementById('cfg-save').onclick = () => {
      const delay = parseInt(document.getElementById('cfg-delay').value, 10);
      const batch = parseInt(document.getElementById('cfg-batch').value, 10);
      saveConfig({
        apiBase: document.getElementById('cfg-base').value.trim(),
        apiKey: document.getElementById('cfg-key').value.trim(),
        model: document.getElementById('cfg-model').value.trim(),
        submitDelay: Number.isFinite(delay) ? delay : DEFAULT_CONFIG.submitDelay,
        batchSize: Number.isFinite(batch) ? batch : DEFAULT_CONFIG.batchSize,
        requireAllAnswered: Boolean(requireAll && requireAll.checked),
      });
      overlay.remove();
      addLog('配置已保存');
    };
  }

  GM_registerMenuCommand('AI 答题配置', showConfigDialog);

  // ==================== 工具函数 ====================

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  // ==================== 题目提取 ====================

  function isCheckedNode(node) {
    if (!node || !node.classList) return false;
    if (node.classList.contains('n-checkbox--checked') || node.classList.contains('n-radio--checked')) return true;
    return Boolean(node.querySelector('.n-checkbox--checked, .n-radio--checked'));
  }

  function looksLikeJudgeOptions(options) {
    if (!Array.isArray(options) || options.length !== 2) return false;
    return options.every((opt) => /^(正确|错误|对|错|是|否|√|×|true|false)$/i.test(String(opt).trim()));
  }

  /**
   * 关键：options 与 nodes 一一对应（同一批 querySelectorAll 结果），
   * 这样 AI 给的字母下标才能和真正要点的节点对齐。
   * 原来按 .n-radio__label 收集选项、却按 .n-radio 点击，中间做了去重，字母会错位。
   */
  function extractQuestions() {
    const questions = [];
    const contents = document.querySelectorAll('.content');

    for (const content of contents) {
      const titleEl = content.querySelector('.title');
      if (!titleEl) continue;

      const titleText = (titleEl.innerText || '').trim();
      if (!titleText) continue;

      const match = titleText.match(/^(\d+)\s*[.、．]\s*([\s\S]*)$/);
      if (!match) continue;

      const num = parseInt(match[1], 10);
      const questionText = (match[2] || '').trim() || titleText;

      const checkboxNodes = Array.from(content.querySelectorAll('.n-checkbox'));
      const radioNodes = Array.from(content.querySelectorAll('.n-radio'));
      const isMulti = checkboxNodes.length > 0;
      const nodes = isMulti ? checkboxNodes : radioNodes;
      if (!nodes.length) continue;

      const options = nodes.map((node) => {
        const label = node.querySelector('.n-radio__label, .n-checkbox__label');
        return ((label ? label.innerText : node.innerText) || '').trim();
      });

      // 选项文本没取全就不答，宁可漏题也不乱点
      if (options.some((text) => !text)) continue;

      let type = isMulti ? 'multi' : 'single';
      if (!isMulti && (/判断题/.test(questionText) || looksLikeJudgeOptions(options))) {
        type = 'judge';
      }

      questions.push({ num, question: questionText, options, type, nodes });
    }
    return questions;
  }

  // ==================== AI 调用 ====================

  function buildPrompt(questions) {
    let text = `你是中国继续教育考试的答题助手。下面是 ${questions.length} 道题目，请给出每道题的正确答案。

要求：
1. 只输出 JSON 数组，不要 markdown 代码块，不要任何解释文字
2. 每项格式为 {"num": 题号, "answer": "字母"}
3. 单选题 / 判断题：answer 为单个字母
4. 多选题：answer 为多个字母，按字母顺序拼接，如 "ABD"
5. 选项前的字母就是答案字母，只能从该题给出的选项里选
6. 必须覆盖全部 ${questions.length} 道题，不能遗漏

题目：
`;
    for (const q of questions) {
      text += `\n${q.num}. ${q.question}\n`;
      q.options.forEach((opt, index) => {
        text += `   ${String.fromCharCode(65 + index)}. ${opt}\n`;
      });
    }
    return text;
  }

  function callAI(prompt) {
    const config = getConfig();
    if (!config.apiKey) {
      return Promise.reject(new Error('未配置 API Key，请先点击油猴菜单「AI 答题配置」'));
    }

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: `${config.apiBase}/chat/completions`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        data: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
        }),
        timeout: 120000,
        onload(resp) {
          // 原来不校验状态码，401 时会把错误页当 JSON 解析，报"解析 API 响应失败"
          if (resp.status < 200 || resp.status >= 300) {
            let detail = '';
            try {
              const parsed = JSON.parse(resp.responseText);
              detail = (parsed && parsed.error && parsed.error.message) || '';
            } catch (e) {
              detail = '';
            }
            const hint = resp.status === 401 || resp.status === 403 ? '（API Key 可能无效）' : '';
            reject(new Error(`API 返回 HTTP ${resp.status}${hint}${detail ? '：' + detail : ''}`));
            return;
          }
          try {
            const data = JSON.parse(resp.responseText);
            if (data.error) {
              reject(new Error(data.error.message || 'API 返回错误'));
              return;
            }
            const content = data.choices?.[0]?.message?.content || '';
            if (!content.trim()) {
              reject(new Error('AI 返回了空内容'));
              return;
            }
            resolve(content);
          } catch (e) {
            reject(new Error('解析 API 响应失败: ' + e.message));
          }
        },
        onerror() {
          reject(new Error('网络请求失败'));
        },
        ontimeout() {
          reject(new Error('API 请求超时'));
        },
      });
    });
  }

  function normalizeAnswer(answer) {
    if (Array.isArray(answer)) answer = answer.join('');
    if (answer == null) return '';

    let text = String(answer).trim().toUpperCase();
    text = text
      .replace(/正确|对|TRUE/g, 'A')
      .replace(/错误|错|FALSE/g, 'B')
      .replace(/[^A-F]/g, '');

    return /^[A-F]+$/.test(text) ? text : '';
  }

  function parseAIResponse(text) {
    // 去掉 markdown 代码围栏再找 JSON 数组
    const cleaned = String(text || '')
      .replace(/```json/gi, '```')
      .replace(/```/g, '');

    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('AI 返回格式异常，未找到 JSON');

    let answers;
    try {
      answers = JSON.parse(jsonMatch[0]);
    } catch (e) {
      throw new Error('AI 返回的 JSON 无法解析：' + e.message);
    }
    if (!Array.isArray(answers)) throw new Error('AI 返回格式异常，不是 JSON 数组');

    const result = [];
    for (const a of answers) {
      if (!a || typeof a !== 'object') throw new Error('AI 返回的数组项格式异常');
      const answer = normalizeAnswer(a.answer);
      if (!a.num || !answer) {
        throw new Error(`第${a.num}题答案格式异常: ${JSON.stringify(a.answer)}`);
      }
      result.push({ num: parseInt(a.num, 10), answer, raw: String(a.answer) });
    }
    return result;
  }

  /** 一批题目：调 AI + 解析，任何一步失败都重试（AI 可能下次就返回合法 JSON 了） */
  async function requestAnswers(batch, onRetry) {
    const config = getConfig();
    const attempts = Math.max(1, Math.floor(config.maxRetries));
    const prompt = buildPrompt(batch);
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (aborted) throw new Error('已取消');
      try {
        const text = await callAI(prompt);
        return parseAIResponse(text);
      } catch (err) {
        lastError = err;
        // 配置类错误重试没用
        if (/未配置 API Key/.test(err.message)) throw err;
        if (attempt >= attempts) break;
        if (onRetry) onRetry(attempt, attempts, err);
        await sleep(1500 * attempt);
      }
    }
    throw lastError;
  }

  // ==================== 答案校验与填写 ====================

  function letterToValue(letter) {
    if (typeof letter !== 'string' || !letter) return 0;
    const code = letter.trim().toUpperCase().charCodeAt(0);
    // A -> 1, B -> 2 ... 越界返回 0
    return code >= 65 && code <= 90 ? code - 64 : 0;
  }

  /** 判断题按选项文本找字母，避免页面是"错误/正确"顺序时方向反了 */
  function resolveJudgeAnswer(raw, options) {
    const text = String(raw || '');
    const wantsTrue = /正确|对|是|√|true/i.test(text);
    const wantsFalse = /错误|错|否|×|false/i.test(text);
    if (!wantsTrue && !wantsFalse) return '';
    if (wantsTrue && wantsFalse) return '';

    const pattern = wantsTrue ? /正确|对|是|√|true/i : /错误|错|否|×|false/i;
    const index = options.findIndex((opt) => pattern.test(String(opt)));
    return index >= 0 ? String.fromCharCode(65 + index) : '';
  }

  /** 把 AI 的答案规整成合法字母：越界字母丢掉、去重、排序 */
  function resolveAnswer(question, entry) {
    let letters = question.type === 'judge' ? resolveJudgeAnswer(entry.raw, question.options) : '';
    if (!letters) letters = entry.answer;

    const valid = letters
      .split('')
      .map((letter) => letterToValue(letter))
      .filter((value) => value >= 1 && value <= question.options.length);

    const unique = [...new Set(valid)].sort((a, b) => a - b);
    if (!unique.length) return '';
    const chars = unique.map((value) => String.fromCharCode(64 + value));
    return question.type === 'multi' ? chars.join('') : chars[0];
  }

  function prepareAnswers(questions, answerMap) {
    const resolved = {};
    const problems = [];
    for (const question of questions) {
      const entry = answerMap[question.num];
      if (!entry) {
        problems.push({ num: question.num, reason: 'AI 未给出该题答案' });
        continue;
      }
      const answer = resolveAnswer(question, entry);
      if (!answer) {
        problems.push({ num: question.num, reason: `答案「${entry.raw}」与该题选项不匹配` });
        continue;
      }
      resolved[question.num] = answer;
    }
    return { resolved, problems };
  }

  function fillAnswers(questions, resolved) {
    const stats = { filled: 0, missing: [], failed: [] };

    for (const question of questions) {
      const answer = resolved[question.num];
      if (!answer) {
        stats.missing.push(question.num);
        continue;
      }

      const indexes = answer
        .split('')
        .map((letter) => letterToValue(letter))
        .filter((value) => value >= 1 && value <= question.nodes.length);
      if (!indexes.length) {
        stats.failed.push({ num: question.num, reason: `答案 ${answer} 无对应选项` });
        continue;
      }

      let clicked = 0;
      if (question.type === 'multi') {
        const wanted = new Set(indexes);
        question.nodes.forEach((node, index) => {
          // 只点没选中的，避免把已选项点掉
          if (wanted.has(index + 1) && !isCheckedNode(node)) {
            node.click();
            clicked++;
          } else if (wanted.has(index + 1)) {
            clicked++;
          }
        });
      } else {
        const node = question.nodes[indexes[0] - 1];
        if (node) {
          node.click();
          clicked++;
        }
      }

      if (clicked > 0) stats.filled++;
      else stats.failed.push({ num: question.num, reason: '未能点击到对应选项' });
    }
    return stats;
  }

  // ==================== 交卷 ====================

  function clickSubmit() {
    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      (b.innerText || '').includes('交卷')
    );
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }

  function clickSubmitConfirm() {
    const confirmTexts = ['确认交卷', '确定', '确认', '提交'];
    const btn = Array.from(document.querySelectorAll('button')).find((b) => {
      const text = (b.innerText || '').trim();
      if (!text) return false;
      // 别点到"取消/关闭/返回"
      if (/取消|关闭|返回|放弃/.test(text)) return false;
      return confirmTexts.some((item) => text.includes(item));
    });
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }

  // ==================== UI 面板 ====================

  const PANEL_ID = 'ai-exam-panel';
  const STYLE_ID = 'ai-exam-style';

  const STYLES = `
  #${PANEL_ID} {
    position: fixed !important; top: 80px; right: 20px; z-index: 2147483000 !important;
    width: 360px; box-sizing: border-box; background: #fff; color: #333;
    border: 2px solid #c0392b; border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0,0,0,.18); font-family: 'Microsoft YaHei', system-ui, sans-serif;
    font-size: 13px; line-height: 1.5; text-align: left;
  }
  #${PANEL_ID} * { box-sizing: border-box; }
  #${PANEL_ID} .ae-head {
    display: flex; align-items: center; gap: 6px; cursor: move; user-select: none;
    padding: 10px 12px; border-bottom: 1px solid #f0f0f0; background: #fdf6f5;
    border-radius: 8px 8px 0 0;
  }
  #${PANEL_ID} .ae-title { font-size: 15px; font-weight: 700; color: #c0392b; }
  #${PANEL_ID} .ae-spacer { flex: 1; }
  #${PANEL_ID} .ae-icon {
    width: 20px; height: 20px; line-height: 18px; text-align: center; cursor: pointer;
    border: 1px solid transparent; border-radius: 4px; background: transparent;
    color: #999; font-size: 14px; padding: 0;
  }
  #${PANEL_ID} .ae-icon:hover { background: #f2f2f2; color: #c0392b; }
  #${PANEL_ID} .ae-body { padding: 10px 12px 12px; }
  #${PANEL_ID} .ae-status { color: #555; margin-bottom: 8px; min-height: 20px; word-break: break-all; }
  #${PANEL_ID} .ae-bar { height: 18px; background: #eee; border-radius: 6px; overflow: hidden; margin-bottom: 8px; }
  #${PANEL_ID} .ae-bar > div {
    height: 100%; width: 0%; background: linear-gradient(90deg,#e74c3c,#c0392b); color: #fff;
    font-size: 11px; line-height: 18px; text-align: center; transition: width .3s;
  }
  #${PANEL_ID} .ae-log {
    max-height: 180px; overflow-y: auto; font-size: 11px; color: #777;
    border-top: 1px solid #f0f0f0; padding-top: 6px; margin-bottom: 8px;
    font-family: Consolas, Menlo, monospace; word-break: break-all;
  }
  #${PANEL_ID} .ae-log .err { color: #c0392b; }
  #${PANEL_ID} .ae-log .ok { color: #27ae60; }
  #${PANEL_ID} .ae-btns { display: flex; gap: 8px; }
  #${PANEL_ID} .ae-btn {
    flex: 1; border: none; border-radius: 6px; padding: 8px 0; font-size: 13px;
    cursor: pointer; color: #fff; background: #c0392b;
  }
  #${PANEL_ID} .ae-btn:disabled { opacity: .55; cursor: not-allowed; }
  #${PANEL_ID} .ae-btn.gray { background: #95a5a6; }
  #${PANEL_ID}.ae-min .ae-body { display: none; }
  #${PANEL_ID}.ae-min .ae-head { border-bottom: none; border-radius: 8px; }
  `;

  const MAX_LOG_LINES = 300;

  function el(id) {
    return document.getElementById(id);
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    (document.head || document.documentElement).appendChild(style);
  }

  function createPanel() {
    injectStyles();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = 'position:fixed;top:80px;right:20px;z-index:2147483000;width:360px;box-sizing:border-box;';
    panel.innerHTML = `
      <div class="ae-head" id="ae-drag">
        <span class="ae-title">AI 自动答题助手</span>
        <span class="ae-spacer"></span>
        <button class="ae-icon" id="ae-min" title="最小化">—</button>
        <button class="ae-icon" id="ae-close" title="关闭面板">×</button>
      </div>
      <div class="ae-body">
        <div class="ae-status" id="ae-status">等待开始...</div>
        <div class="ae-bar"><div id="ae-progress">0%</div></div>
        <div class="ae-log" id="ae-log"></div>
        <div class="ae-btns">
          <button class="ae-btn" id="ae-start">一键答题</button>
          <button class="ae-btn gray" id="ae-config">配置</button>
          <button class="ae-btn gray" id="ae-stop" style="display:none">取消</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    el('ae-min').addEventListener('click', () => panel.classList.toggle('ae-min'));
    el('ae-close').addEventListener('click', () => {
      aborted = true;
      removePanel();
    });
    el('ae-start').addEventListener('click', startAutoExam);
    el('ae-config').addEventListener('click', showConfigDialog);
    el('ae-stop').addEventListener('click', () => {
      aborted = true;
      updateStatus('正在取消...');
      addLog('用户取消');
    });

    enableDrag(panel, el('ae-drag'));
    return panel;
  }

  function enableDrag(panel, handle) {
    if (!handle) return;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    handle.addEventListener('mousedown', (event) => {
      if (event.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      originLeft = rect.left;
      originTop = rect.top;
      panel.style.right = 'auto';
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      event.preventDefault();
    });

    window.addEventListener('mousemove', (event) => {
      if (!dragging) return;
      panel.style.left = `${Math.max(0, Math.min(originLeft + event.clientX - startX, window.innerWidth - panel.offsetWidth))}px`;
      panel.style.top = `${Math.max(0, Math.min(originTop + event.clientY - startY, window.innerHeight - 30))}px`;
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  function removePanel() {
    const panel = el(PANEL_ID);
    if (panel) panel.remove();
    const style = el(STYLE_ID);
    if (style) style.remove();
  }

  // 全部 DOM 操作做空值保护，面板被移除时不再抛 TypeError
  function updateStatus(text) {
    const node = el('ae-status');
    if (node) node.textContent = text;
  }

  function updateProgress(pct) {
    const bar = el('ae-progress');
    if (!bar) return;
    const value = Math.max(0, Math.min(100, Math.round(pct)));
    bar.style.width = value + '%';
    bar.textContent = value + '%';
  }

  function addLog(text, level) {
    const box = el('ae-log');
    if (!box) return;
    const line = document.createElement('div');
    if (level) line.className = level;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    box.appendChild(line);
    while (box.childElementCount > MAX_LOG_LINES) box.removeChild(box.firstElementChild);
    box.scrollTop = box.scrollHeight;
  }

  // ==================== 主流程 ====================

  let running = false;
  let aborted = false;

  async function startAutoExam() {
    if (running) return;

    const config = getConfig();
    if (!config.apiKey) {
      showConfigDialog();
      return;
    }

    running = true;
    aborted = false;
    const startBtn = el('ae-start');
    const stopBtn = el('ae-stop');
    if (startBtn) {
      startBtn.disabled = true;
      startBtn.textContent = '运行中...';
    }
    if (stopBtn) stopBtn.style.display = 'block';

    try {
      // Step 1: 提取题目
      updateStatus('正在提取题目...');
      updateProgress(5);
      const questions = extractQuestions();
      addLog(`提取到 ${questions.length} 道题`);
      if (!questions.length) {
        throw new Error('未检测到题目，请确认当前在考试页面且题目已加载');
      }
      const typeCount = questions.reduce((acc, q) => {
        acc[q.type] = (acc[q.type] || 0) + 1;
        return acc;
      }, {});
      addLog(`题型分布: 单选 ${typeCount.single || 0} / 多选 ${typeCount.multi || 0} / 判断 ${typeCount.judge || 0}`);

      // Step 2: 分批调用 AI
      const batches = chunk(questions, config.batchSize);
      addLog(`分 ${batches.length} 批提问（每批 ${config.batchSize} 题），模型: ${config.model}`);

      const answerMap = {};
      for (let i = 0; i < batches.length; i++) {
        if (aborted) throw new Error('已取消');
        updateStatus(`AI 分析中（第 ${i + 1}/${batches.length} 批）...`);
        updateProgress(10 + Math.round((i / batches.length) * 50));

        const answers = await requestAnswers(batches[i], (attempt, total, err) => {
          addLog(`第 ${i + 1} 批第 ${attempt} 次失败（${err.message}），重试中...`, 'err');
        });
        for (const item of answers) {
          if (!answerMap[item.num]) answerMap[item.num] = item;
        }
        addLog(`第 ${i + 1} 批返回 ${answers.length} 道答案`);
      }

      // Step 3: 校验答案
      if (aborted) throw new Error('已取消');
      updateStatus('正在校验答案...');
      updateProgress(65);
      const { resolved, problems } = prepareAnswers(questions, answerMap);
      const answeredCount = Object.keys(resolved).length;
      addLog(`有效答案 ${answeredCount}/${questions.length} 道`);
      for (const p of problems.slice(0, 10)) {
        addLog(`第 ${p.num} 题: ${p.reason}`, 'err');
      }
      if (problems.length > 10) addLog(`...另有 ${problems.length - 10} 道题有问题`, 'err');

      // Step 4: 填写
      if (aborted) throw new Error('已取消');
      updateStatus('正在填写答案...');
      updateProgress(75);
      const stats = fillAnswers(questions, resolved);
      addLog(`已填写 ${stats.filled} 道题`, 'ok');
      if (stats.failed.length) {
        addLog(`填写失败 ${stats.failed.length} 道: ${stats.failed.map((f) => f.num).join(',')}`, 'err');
      }

      const unanswered = questions.length - stats.filled;
      if (unanswered > 0 && config.requireAllAnswered) {
        updateProgress(80);
        updateStatus(`⚠ 还有 ${unanswered} 题没答上，已暂停自动交卷`);
        addLog(`⚠ 还有 ${unanswered} 题没答上。为避免交白卷，已暂停自动交卷，请手动检查后交卷`, 'err');
        return;
      }

      // Step 5: 等待交卷（可取消）
      const delayMin = config.submitDelay;
      const delayMs = delayMin * 60 * 1000;
      const startTime = Date.now();
      addLog(`将在 ${delayMin} 分钟后自动交卷，可点「取消」中止`);

      while (Date.now() - startTime < delayMs) {
        if (aborted) throw new Error('已取消');
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, Math.ceil((delayMs - elapsed) / 1000));
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        updateStatus(`等待交卷中... 剩余 ${mins}:${String(secs).padStart(2, '0')}`);
        updateProgress(80 + Math.floor((elapsed / delayMs) * 18));
        await sleep(1000);
      }

      if (aborted) throw new Error('已取消');

      // Step 6: 交卷
      updateStatus('正在交卷...');
      updateProgress(98);
      addLog('开始交卷');
      if (!clickSubmit()) {
        throw new Error('没找到「交卷」按钮，请手动交卷');
      }

      await sleep(1200);
      if (!aborted) clickSubmitConfirm();

      await sleep(2000);
      updateProgress(100);
      updateStatus('交卷完成!');
      addLog('流程结束', 'ok');
    } catch (err) {
      if (/已取消/.test(err.message)) {
        updateStatus('已取消');
        addLog('已取消', 'err');
      } else {
        updateStatus('出错: ' + err.message);
        addLog('错误: ' + err.message, 'err');
        console.error('[AI答题]', err);
      }
    } finally {
      running = false;
      const startButton = el('ae-start');
      const stopButton = el('ae-stop');
      if (startButton) {
        startButton.disabled = false;
        startButton.textContent = '一键答题';
      }
      if (stopButton) stopButton.style.display = 'none';
    }
  }

  // ==================== 初始化 ====================

  function isExamPage() {
    return location.hash.includes('/exam/');
  }

  function hasQuestions() {
    return document.querySelector('.content .title') !== null;
  }

  function init() {
    if (!isExamPage()) {
      removePanel();
      return;
    }
    if (el(PANEL_ID)) return;

    if (hasQuestions()) {
      createPanel();
      addLog('助手已加载，点击「一键答题」开始');
      return;
    }

    // 题目异步渲染：用 MutationObserver 等，比死等 30 秒更可靠也更安静
    const observer = new MutationObserver(() => {
      if (!isExamPage()) {
        observer.disconnect();
        return;
      }
      if (hasQuestions()) {
        observer.disconnect();
        if (!el(PANEL_ID)) {
          createPanel();
          addLog('助手已加载，点击「一键答题」开始');
        }
      }
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 120000);
  }

  window.addEventListener('hashchange', () => {
    if (isExamPage()) init();
    else {
      aborted = true;
      removePanel();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    setTimeout(init, 1000);
  }
})();
