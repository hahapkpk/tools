// ==UserScript==
// @name         X (Twitter) — Gemini Commander
// @name:zh-CN   X (Twitter) — Gemini 指挥官
// @namespace    https://github.com/user/gemini-commander
// @version      1.0.0
// @license      MIT
// @author       Flywind
// @icon         https://abs.twimg.com/favicons/twitter.3.ico
// @match        https://twitter.com/*
// @match        https://x.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-end
// @description  在每条推文旁添加 Gemini 指令菜单，一键将推文内容发送到 Gemini 进行分析。支持事实核查、深度分析、翻译，以及 5 个自定义 prompt 槽位。
// ==/UserScript==

(function () {
  "use strict";

  // ─── 默认配置 ───────────────────────────────────────────────────────────────
  const DEFAULT_TEMPLATES = {
    factcheck: {
      label: "事实核查",
      icon: "🕵️",
      prompt: "请对以下推文进行详细的事实核查，指出可能存在的错误、误导性信息或缺乏依据的内容，并提供正确的背景信息：\n\n",
    },
    analysis: {
      label: "深度分析",
      icon: "📊",
      prompt: "作为社交媒体观察者，请分析以下推文的潜在语气、情绪倾向、目标受众，以及作者可能隐含的动机或立场：\n\n",
    },
    translate: {
      label: "翻译解释",
      icon: "🌐",
      prompt: "请将以下推文翻译成流畅自然的中文。如果包含网络俚语、梗（Meme）或文化背景，请一并解释其含义：\n\n",
    },
    custom1: { label: "自定义 1", icon: "✏️", prompt: "请简要分析这条推文的主要观点和意义：\n\n" },
    custom2: { label: "自定义 2", icon: "✏️", prompt: "这条推文最值得关注的地方是什么？请详细说明：\n\n" },
    custom3: { label: "自定义 3", icon: "✏️", prompt: "请从批判性思维角度评估这条推文：\n\n" },
    custom4: { label: "自定义 4", icon: "✏️", prompt: "请总结这条推文的核心信息，并给出你的看法：\n\n" },
    custom5: { label: "自定义 5", icon: "✏️", prompt: "请分析这条推文可能引发的社会影响：\n\n" },
  };

  // ─── 配置读写 ────────────────────────────────────────────────────────────────
  function loadConfig() {
    try {
      const raw = GM_getValue("gc_config", null);
      return raw ? { ...DEFAULT_TEMPLATES, ...JSON.parse(raw) } : { ...DEFAULT_TEMPLATES };
    } catch (e) {
      return { ...DEFAULT_TEMPLATES };
    }
  }

  function saveConfig(cfg) {
    GM_setValue("gc_config", JSON.stringify(cfg));
  }

  // ─── Gemini 跳转 ─────────────────────────────────────────────────────────────
  function sendToGemini(prompt, tweetText) {
    const full = prompt + tweetText;
    const url = "https://gemini.google.com/app?q=" + encodeURIComponent(full);
    window.open(url, "_blank");
  }

  // ─── 获取推文文本 ─────────────────────────────────────────────────────────────
  function getTweetText(articleEl) {
    const textEl = articleEl.querySelector('[data-testid="tweetText"]');
    return textEl ? textEl.innerText.trim() : "";
  }

  // ─── Toast 提示 ──────────────────────────────────────────────────────────────
  function showToast(msg) {
    document.querySelector(".gc-toast")?.remove();
    const el = document.createElement("div");
    el.className = "gc-toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.classList.add("fade-out"); setTimeout(() => el.remove(), 300); }, 2000);
  }

  // ─── 关闭菜单 ────────────────────────────────────────────────────────────────
  function closeMenu() {
    document.getElementById("gc-menu")?.remove();
    document.getElementById("gc-menu-backdrop")?.remove();
  }

  // ─── 弹出指令菜单 ────────────────────────────────────────────────────────────
  function openMenu(btnEl, articleEl) {
    closeMenu();
    const cfg = loadConfig();
    const tweetText = getTweetText(articleEl);
    if (!tweetText) { showToast("未找到推文内容"); return; }

    const rect = btnEl.getBoundingClientRect();

    const backdrop = document.createElement("div");
    backdrop.id = "gc-menu-backdrop";
    backdrop.onclick = closeMenu;
    document.body.appendChild(backdrop);

    const menu = document.createElement("div");
    menu.id = "gc-menu";

    const order = ["factcheck", "analysis", "translate", "custom1", "custom2", "custom3", "custom4", "custom5"];
    order.forEach(key => {
      const tpl = cfg[key];
      if (!tpl || !tpl.label) return;
      const item = document.createElement("div");
      item.className = "gc-menu-item";
      item.innerHTML = `<span class="gc-menu-icon">${tpl.icon || "✏️"}</span><span class="gc-menu-label">${tpl.label}</span>`;
      item.onclick = () => {
        closeMenu();
        sendToGemini(tpl.prompt, tweetText);
      };
      menu.appendChild(item);
    });

    const footer = document.createElement("div");
    footer.className = "gc-menu-footer";
    const settingsBtn = document.createElement("span");
    settingsBtn.className = "gc-settings-btn";
    settingsBtn.title = "设置";
    settingsBtn.textContent = "⚙️";
    settingsBtn.onclick = () => { closeMenu(); openSettings(); };
    footer.appendChild(settingsBtn);
    menu.appendChild(footer);

    document.body.appendChild(menu);

    // 定位菜单
    const menuW = 180, menuH = order.length * 40 + 50;
    let top = rect.bottom + window.scrollY + 4;
    let left = rect.left + window.scrollX;
    if (left + menuW > window.innerWidth) left = window.innerWidth - menuW - 8;
    if (top + menuH > window.scrollY + window.innerHeight) top = rect.top + window.scrollY - menuH - 4;
    menu.style.top = top + "px";
    menu.style.left = left + "px";
  }

  // ─── 设置面板 ────────────────────────────────────────────────────────────────
  function openSettings() {
    document.getElementById("gc-settings-overlay")?.remove();
    const cfg = loadConfig();

    const overlay = document.createElement("div");
    overlay.id = "gc-settings-overlay";
    overlay.onclick = (e) => { if (e.target === overlay) closeSettings(); };

    const modal = document.createElement("div");
    modal.id = "gc-settings-modal";

    const header = document.createElement("div");
    header.className = "gc-modal-header";
    header.innerHTML = `<span>⚙️ Gemini Commander 设置</span><span id="gc-settings-close" style="cursor:pointer;color:#536471;font-size:18px">✕</span>`;
    modal.appendChild(header);

    const body = document.createElement("div");
    body.className = "gc-modal-body";

    const order = ["factcheck", "analysis", "translate", "custom1", "custom2", "custom3", "custom4", "custom5"];
    const labels = {
      factcheck: "🕵️ 事实核查", analysis: "📊 深度分析", translate: "🌐 翻译解释",
      custom1: "✏️ 自定义 1", custom2: "✏️ 自定义 2", custom3: "✏️ 自定义 3",
      custom4: "✏️ 自定义 4", custom5: "✏️ 自定义 5",
    };

    const draft = {};
    order.forEach(key => { draft[key] = { ...cfg[key] }; });

    order.forEach(key => {
      const section = document.createElement("div");
      section.className = "gc-section-card";

      const sectionHeader = document.createElement("div");
      sectionHeader.className = "gc-section-header";
      sectionHeader.textContent = labels[key];
      section.appendChild(sectionHeader);

      const sectionBody = document.createElement("div");
      sectionBody.className = "gc-section-body";

      // 标题输入
      const labelRow = document.createElement("div");
      labelRow.className = "gc-form-row";
      labelRow.innerHTML = `<label class="gc-form-label">标题名称</label>`;
      const labelInput = document.createElement("input");
      labelInput.className = "gc-input-text";
      labelInput.value = draft[key].label || "";
      labelInput.placeholder = "菜单显示名称";
      labelInput.oninput = () => { draft[key].label = labelInput.value; };
      labelRow.appendChild(labelInput);
      sectionBody.appendChild(labelRow);

      // Prompt 输入
      const promptRow = document.createElement("div");
      promptRow.className = "gc-form-row";
      promptRow.innerHTML = `<label class="gc-form-label">提示词 (Prompt)</label>`;
      const promptInput = document.createElement("textarea");
      promptInput.className = "gc-input-textarea";
      promptInput.value = draft[key].prompt || "";
      promptInput.rows = 3;
      promptInput.placeholder = "发送给 Gemini 的提示词，推文内容会自动附加在末尾";
      promptInput.oninput = () => { draft[key].prompt = promptInput.value; };
      promptRow.appendChild(promptInput);
      sectionBody.appendChild(promptRow);

      // 重置按钮（仅内置模式）
      if (["factcheck", "analysis", "translate"].includes(key)) {
        const resetBtn = document.createElement("button");
        resetBtn.className = "gc-btn-reset";
        resetBtn.textContent = "恢复默认";
        resetBtn.onclick = () => {
          draft[key] = { ...DEFAULT_TEMPLATES[key] };
          labelInput.value = draft[key].label;
          promptInput.value = draft[key].prompt;
        };
        sectionBody.appendChild(resetBtn);
      }

      section.appendChild(sectionBody);
      body.appendChild(section);
    });

    modal.appendChild(body);

    const modalFooter = document.createElement("div");
    modalFooter.className = "gc-modal-footer";
    modalFooter.innerHTML = `
      <button id="gc-btn-cancel" class="gc-btn gc-btn-secondary">取消</button>
      <button id="gc-btn-save"   class="gc-btn gc-btn-primary">保存设置</button>
    `;
    modal.appendChild(modalFooter);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById("gc-settings-close").onclick = closeSettings;
    document.getElementById("gc-btn-cancel").onclick = closeSettings;
    document.getElementById("gc-btn-save").onclick = () => {
      saveConfig(draft);
      showToast("✅ 设置已保存");
      closeSettings();
    };
  }

  function closeSettings() {
    document.getElementById("gc-settings-overlay")?.remove();
  }

  // ─── 注入按钮 ────────────────────────────────────────────────────────────────
  function injectButton(articleEl) {
    if (articleEl.querySelector(".gc-btn-injected")) return;

    // 找到操作栏（like/retweet/reply 那行）
    const actionBar = articleEl.querySelector('[role="group"]');
    if (!actionBar) return;

    const wrapper = document.createElement("div");
    wrapper.className = "gc-btn-injected";
    wrapper.style.cssText = "display:inline-flex;align-items:center;";

    const btn = document.createElement("div");
    btn.className = "gc-trigger-btn";
    btn.title = "Gemini Commander";
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
    </svg>`;
    btn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      openMenu(btn, articleEl);
    };

    wrapper.appendChild(btn);
    actionBar.appendChild(wrapper);
  }

  // ─── MutationObserver 监听动态渲染 ──────────────────────────────────────────
  function scanArticles() {
    document.querySelectorAll('article[data-testid="tweet"]').forEach(injectButton);
  }

  const observer = new MutationObserver(() => scanArticles());
  observer.observe(document.body, { childList: true, subtree: true });
  scanArticles();

  // ─── 油猴菜单入口 ────────────────────────────────────────────────────────────
  GM_registerMenuCommand("⚙️ Gemini Commander 设置", openSettings);

  // ─── 样式注入 ────────────────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    .gc-trigger-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 34px; height: 34px; border-radius: 50%; cursor: pointer;
      color: #536471; transition: color 0.2s, background 0.2s;
      margin-left: 4px;
    }
    .gc-trigger-btn:hover { color: #1d9bf0; background: rgba(29,155,240,0.1); }

    #gc-menu-backdrop {
      position: fixed; inset: 0; z-index: 99989;
    }
    #gc-menu {
      position: absolute; z-index: 99990;
      background: #000; border: 1px solid #333639;
      border-radius: 12px; box-shadow: 0 8px 16px rgba(255,255,255,0.1);
      padding: 8px; display: flex; flex-direction: column; gap: 2px;
      min-width: 170px; font-family: sans-serif;
      animation: gcFadeIn 0.15s ease-out;
    }
    @keyframes gcFadeIn { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
    .gc-menu-item {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; color: #E7E9EA; font-size: 14px;
      border-radius: 8px; cursor: pointer; user-select: none;
      transition: background 0.1s;
    }
    .gc-menu-item:hover { background: #1D9BF0; color: #fff; }
    .gc-menu-icon { font-size: 16px; flex-shrink: 0; }
    .gc-menu-label { flex: 1; }
    .gc-menu-footer {
      border-top: 1px solid #333; padding-top: 4px; margin-top: 2px;
      display: flex; justify-content: flex-end;
    }
    .gc-settings-btn {
      padding: 4px 8px; font-size: 18px; cursor: pointer;
      color: #71767B; border-radius: 4px;
    }
    .gc-settings-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }

    .gc-toast {
      position: fixed; bottom: 20px; right: 20px;
      background: rgba(15,20,28,0.97); border: 1.5px solid #1d9bf0;
      color: #fff; font-size: 13px; font-family: sans-serif;
      padding: 12px 16px; border-radius: 10px; z-index: 2147483647;
      box-shadow: 0 4px 20px rgba(29,155,240,0.25);
      transition: opacity 0.3s;
    }
    .gc-toast.fade-out { opacity: 0; }

    #gc-settings-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.6); z-index: 2147483640;
      display: flex; justify-content: center; align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #gc-settings-modal {
      background: #0d1117; border: 1px solid #2f3336;
      border-radius: 16px; width: min(500px, 94vw); height: min(88vh, 780px);
      display: flex; flex-direction: column; color: #E7E9EA;
      box-shadow: 0 20px 60px rgba(0,0,0,0.95);
      animation: gcModalIn 0.18s ease-out;
      overflow: hidden;
    }
    @keyframes gcModalIn { from { opacity:0; transform:scale(0.96) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }
    .gc-modal-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 20px; border-bottom: 1px solid #2f3336;
      font-size: 15px; font-weight: bold; color: #fff; flex-shrink: 0;
    }
    .gc-modal-body {
      flex: 1; overflow-y: auto; padding: 16px 20px;
      display: flex; flex-direction: column; gap: 12px;
      scrollbar-width: thin; scrollbar-color: #1e2d3d transparent;
    }
    .gc-modal-body::-webkit-scrollbar { width: 5px; }
    .gc-modal-body::-webkit-scrollbar-thumb { background: #1e2d3d; border-radius: 10px; }
    .gc-modal-footer {
      padding: 12px 20px; border-top: 1px solid #2f3336;
      display: flex; justify-content: flex-end; gap: 10px; flex-shrink: 0;
    }
    .gc-section-card {
      background: #16181C; border: 1px solid #2f3336;
      border-radius: 12px; overflow: hidden;
    }
    .gc-section-header {
      padding: 10px 14px; font-size: 13px; font-weight: bold;
      color: #1d9bf0; background: rgba(29,155,240,0.06);
      border-bottom: 1px solid #2f3336;
    }
    .gc-section-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
    .gc-form-row { display: flex; flex-direction: column; gap: 4px; }
    .gc-form-label { font-size: 12px; color: #71767B; }
    .gc-input-text {
      background: #0d1117; border: 1px solid #2f3336; border-radius: 8px;
      color: #E7E9EA; font-size: 13px; padding: 8px 10px; outline: none;
      transition: border-color 0.15s;
    }
    .gc-input-text:focus { border-color: #1d9bf0; }
    .gc-input-textarea {
      background: #0d1117; border: 1px solid #2f3336; border-radius: 8px;
      color: #E7E9EA; font-size: 13px; padding: 8px 10px; outline: none;
      resize: vertical; min-height: 72px; font-family: inherit;
      transition: border-color 0.15s; line-height: 1.5;
    }
    .gc-input-textarea:focus { border-color: #1d9bf0; }
    .gc-btn-reset {
      align-self: flex-start; padding: 4px 10px; font-size: 12px;
      border-radius: 6px; cursor: pointer; border: 1px solid #333;
      background: transparent; color: #71767B;
      transition: border-color 0.15s, color 0.15s;
    }
    .gc-btn-reset:hover { border-color: #1d9bf0; color: #1d9bf0; }
    .gc-btn {
      padding: 8px 18px; font-size: 14px; border-radius: 20px;
      cursor: pointer; border: none; font-weight: bold; transition: background 0.15s;
    }
    .gc-btn-primary { background: #1d9bf0; color: #fff; }
    .gc-btn-primary:hover { background: #1a8cd8; }
    .gc-btn-secondary { background: transparent; color: #E7E9EA; border: 1px solid #536471; }
    .gc-btn-secondary:hover { background: rgba(255,255,255,0.05); }
  `;
  document.head.appendChild(style);

})();
