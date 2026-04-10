// ==UserScript==
// @name         湖北21世纪学习平台 - AI自动答题
// @namespace    https://github.com/hahapkpk/tools
// @version      1.0.0
// @description  自动提取考试题目，调用 AI 分析答案，自动填写并定时交卷
// @author       Flywind
// @match        https://www.hubei21.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ========== 默认配置 ==========
  const DEFAULT_CONFIG = {
    apiBase: 'https://api.laozhang.ai/v1',
    apiKey: '',
    model: 'gpt-4o',
    submitDelay: 11, // 交卷等待分钟数
  };

  function getConfig() {
    return GM_getValue('exam_config', DEFAULT_CONFIG);
  }

  function saveConfig(config) {
    GM_setValue('exam_config', config);
  }

  // ========== 配置面板 ==========
  function showConfigDialog() {
    const config = getConfig();
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:999999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:12px;padding:24px;width:420px;font-family:'Microsoft YaHei',sans-serif;">
        <h3 style="margin:0 0 16px;color:#c0392b;">AI 答题配置</h3>
        <label style="display:block;margin-bottom:12px;">
          <div style="font-size:13px;color:#666;margin-bottom:4px;">API Base URL</div>
          <input id="cfg-base" value="${config.apiBase}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;" />
        </label>
        <label style="display:block;margin-bottom:12px;">
          <div style="font-size:13px;color:#666;margin-bottom:4px;">API Key</div>
          <input id="cfg-key" type="password" value="${config.apiKey}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;" />
        </label>
        <label style="display:block;margin-bottom:12px;">
          <div style="font-size:13px;color:#666;margin-bottom:4px;">模型 (如 gpt-4o, deepseek-chat, claude-sonnet-4-20250514)</div>
          <input id="cfg-model" value="${config.model}" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;" />
        </label>
        <label style="display:block;margin-bottom:16px;">
          <div style="font-size:13px;color:#666;margin-bottom:4px;">交卷等待时间（分钟）</div>
          <input id="cfg-delay" type="number" value="${config.submitDelay}" min="1" max="60" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;" />
        </label>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="cfg-cancel" style="padding:8px 20px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;">取消</button>
          <button id="cfg-save" style="padding:8px 20px;border:none;border-radius:6px;background:#c0392b;color:#fff;cursor:pointer;">保存</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('cfg-cancel').onclick = () => overlay.remove();
    document.getElementById('cfg-save').onclick = () => {
      saveConfig({
        apiBase: document.getElementById('cfg-base').value.trim(),
        apiKey: document.getElementById('cfg-key').value.trim(),
        model: document.getElementById('cfg-model').value.trim(),
        submitDelay: parseInt(document.getElementById('cfg-delay').value) || 11,
      });
      overlay.remove();
      addLog('配置已保存');
    };
  }

  GM_registerMenuCommand('AI 答题配置', showConfigDialog);

  // ========== 工具函数 ==========
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ========== 题目提取 ==========
  function extractQuestions() {
    const contents = document.querySelectorAll('.content');
    const questions = [];

    for (const content of contents) {
      const titleEl = content.querySelector('.title');
      if (!titleEl) continue;
      const titleText = titleEl.innerText.trim();
      const match = titleText.match(/^(\d+)\.\s*(.+)/);
      if (!match) continue;

      const qNum = parseInt(match[1]);
      const qText = match[2];

      // 提取去重选项
      const optionSet = [];
      const seen = new Set();
      const labels = content.querySelectorAll(
        '.n-radio__label, .n-checkbox__label'
      );
      for (const label of labels) {
        const t = label.innerText?.trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          optionSet.push(t);
        }
      }

      let type = 'single';
      if (qText.includes('多选题')) type = 'multi';
      else if (qText.includes('判断题')) type = 'judge';

      questions.push({ num: qNum, question: qText, options: optionSet, type });
    }
    return questions;
  }

  // ========== AI 调用 ==========
  function buildPrompt(questions) {
    let text = `你是一个中国继续教育考试答题专家。以下是考试题目，请给出每道题的正确答案。

要求：
1. 直接返回 JSON 数组，格式为 [{"num": 题号, "answer": 答案}]
2. 单选题和判断题的 answer 为选项字母，如 "A"、"B"、"C"、"D"
3. 多选题的 answer 为多个字母拼接，如 "AB"、"ABC"、"ABCD"
4. 判断题：A=正确，B=错误
5. 只返回 JSON，不要其他文字

题目：
`;
    for (const q of questions) {
      text += `\n${q.num}. ${q.question}\n`;
      for (const opt of q.options) {
        text += `  ${opt}\n`;
      }
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
          try {
            const data = JSON.parse(resp.responseText);
            if (data.error) {
              reject(new Error(data.error.message || 'API 返回错误'));
              return;
            }
            const content = data.choices?.[0]?.message?.content || '';
            resolve(content);
          } catch (e) {
            reject(new Error('解析 API 响应失败: ' + e.message));
          }
        },
        onerror(err) {
          reject(new Error('网络请求失败'));
        },
        ontimeout() {
          reject(new Error('API 请求超时'));
        },
      });
    });
  }

  function parseAIResponse(text) {
    // 从返回文本中提取 JSON 数组
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('AI 返回格式异常，未找到 JSON');
    return JSON.parse(jsonMatch[0]);
  }

  // ========== 答案填写 ==========
  function letterToValue(letter) {
    return { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6 }[letter.toUpperCase()] || 1;
  }

  function fillAnswers(aiAnswers) {
    const contents = document.querySelectorAll('.content');
    let filled = 0;

    // 建立题号到答案的映射
    const answerMap = {};
    for (const a of aiAnswers) {
      answerMap[a.num] = a.answer;
    }

    for (const content of contents) {
      const titleEl = content.querySelector('.title');
      if (!titleEl) continue;
      const titleText = titleEl.innerText.trim();
      const match = titleText.match(/^(\d+)\./);
      if (!match) continue;

      const qNum = parseInt(match[1]);
      const answer = answerMap[qNum];
      if (!answer) continue;

      if (titleText.includes('多选题')) {
        // 多选题 - 点击对应 checkbox
        const letters = answer.split('');
        const checkboxes = content.querySelectorAll('.n-checkbox');
        for (const letter of letters) {
          const idx = letterToValue(letter) - 1;
          if (checkboxes[idx]) checkboxes[idx].click();
        }
        filled++;
      } else {
        // 单选题或判断题
        const idx = letterToValue(answer.charAt(0)) - 1;
        const radios = content.querySelectorAll('.n-radio');
        if (radios[idx]) radios[idx].click();
        filled++;
      }
    }
    return filled;
  }

  // ========== 交卷 ==========
  function clickSubmit() {
    const btn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.innerText.includes('交卷')
    );
    if (btn) btn.click();
  }

  // ========== UI 面板 ==========
  let logEl = null;

  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'ai-exam-panel';
    panel.innerHTML = `
      <div style="
        position:fixed;top:80px;right:20px;z-index:99999;
        background:#fff;border:2px solid #c0392b;border-radius:10px;
        padding:16px 20px;width:360px;box-shadow:0 4px 20px rgba(0,0,0,0.15);
        font-family:'Microsoft YaHei',sans-serif;font-size:14px;color:#333;
      ">
        <div style="font-size:16px;font-weight:bold;color:#c0392b;margin-bottom:12px;">
          AI 自动答题助手
        </div>
        <div id="ae-status" style="margin-bottom:10px;color:#666;">等待开始...</div>
        <div style="background:#eee;border-radius:6px;height:20px;overflow:hidden;margin-bottom:10px;">
          <div id="ae-progress" style="
            background:linear-gradient(90deg,#e74c3c,#c0392b);
            height:100%;width:0%;transition:width 0.3s;
            border-radius:6px;text-align:center;color:#fff;font-size:12px;line-height:20px;
          ">0%</div>
        </div>
        <div id="ae-log" style="
          max-height:200px;overflow-y:auto;font-size:12px;color:#888;
          border-top:1px solid #eee;padding-top:8px;margin-top:4px;
        "></div>
        <div style="margin-top:12px;text-align:center;display:flex;gap:8px;justify-content:center;">
          <button id="ae-start" style="
            background:#c0392b;color:#fff;border:none;border-radius:6px;
            padding:8px 20px;cursor:pointer;font-size:14px;
          ">一键答题</button>
          <button id="ae-config" style="
            background:#95a5a6;color:#fff;border:none;border-radius:6px;
            padding:8px 20px;cursor:pointer;font-size:14px;
          ">配置</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    logEl = document.getElementById('ae-log');
    return panel;
  }

  function updateStatus(text) {
    const el = document.getElementById('ae-status');
    if (el) el.textContent = text;
  }

  function updateProgress(pct) {
    const bar = document.getElementById('ae-progress');
    if (bar) {
      bar.style.width = pct + '%';
      bar.textContent = pct + '%';
    }
  }

  function addLog(text) {
    if (!logEl) return;
    const line = document.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ========== 主流程 ==========
  async function startAutoExam() {
    const config = getConfig();
    if (!config.apiKey) {
      showConfigDialog();
      return;
    }

    const startBtn = document.getElementById('ae-start');
    startBtn.disabled = true;
    startBtn.textContent = '运行中...';

    try {
      // Step 1: 提取题目
      updateStatus('正在提取题目...');
      updateProgress(10);
      const questions = extractQuestions();
      addLog(`提取到 ${questions.length} 道题`);

      if (questions.length === 0) {
        throw new Error('未检测到题目，请确认当前在考试页面');
      }

      // Step 2: 调用 AI
      updateStatus('正在调用 AI 分析答案...');
      updateProgress(20);
      addLog(`调用模型: ${config.model}`);

      const prompt = buildPrompt(questions);
      const aiText = await callAI(prompt);
      addLog('AI 返回成功');

      // Step 3: 解析答案
      updateStatus('正在解析答案...');
      updateProgress(40);
      const aiAnswers = parseAIResponse(aiText);
      addLog(`解析到 ${aiAnswers.length} 道答案`);

      // 打印答案摘要
      for (const a of aiAnswers) {
        addLog(`第${a.num}题: ${a.answer}`);
      }

      // Step 4: 填写答案
      updateStatus('正在填写答案...');
      updateProgress(60);
      const filled = fillAnswers(aiAnswers);
      addLog(`已填写 ${filled} 道题`);

      // Step 5: 等待交卷
      const delayMin = config.submitDelay;
      updateStatus(`答案已填写，等待 ${delayMin} 分钟后自动交卷...`);
      updateProgress(70);
      addLog(`将在 ${delayMin} 分钟后自动交卷`);

      const delayMs = delayMin * 60 * 1000;
      const startTime = Date.now();

      while (Date.now() - startTime < delayMs) {
        const elapsed = Date.now() - startTime;
        const remaining = Math.ceil((delayMs - elapsed) / 1000);
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        updateStatus(
          `等待交卷中... 剩余 ${mins}:${String(secs).padStart(2, '0')}`
        );
        const pct = 70 + Math.floor((elapsed / delayMs) * 25);
        updateProgress(Math.min(pct, 95));
        await sleep(1000);
      }

      // Step 6: 交卷
      updateStatus('正在交卷...');
      updateProgress(98);
      addLog('开始交卷');
      clickSubmit();

      await sleep(3000);
      updateProgress(100);
      updateStatus('交卷完成!');
      addLog('流程结束');
    } catch (err) {
      updateStatus('出错: ' + err.message);
      addLog('错误: ' + err.message);
      console.error('[AI答题]', err);
    } finally {
      startBtn.disabled = false;
      startBtn.textContent = '一键答题';
    }
  }

  // ========== 初始化 ==========
  function init() {
    if (!location.hash.includes('/exam/')) return;
    if (document.getElementById('ai-exam-panel')) return;

    // 等待题目加载
    const checkReady = setInterval(() => {
      const contents = document.querySelectorAll('.content .title');
      if (contents.length > 0) {
        clearInterval(checkReady);
        createPanel();
        document.getElementById('ae-start').addEventListener('click', startAutoExam);
        document.getElementById('ae-config').addEventListener('click', showConfigDialog);
        addLog('助手已加载，点击「一键答题」开始');
      }
    }, 1000);

    // 30 秒后停止检查
    setTimeout(() => clearInterval(checkReady), 30000);
  }

  window.addEventListener('hashchange', () => {
    if (location.hash.includes('/exam/')) {
      if (!document.getElementById('ai-exam-panel')) init();
    } else {
      const existing = document.getElementById('ai-exam-panel');
      if (existing) existing.remove();
    }
  });

  setTimeout(init, 2000);
})();
