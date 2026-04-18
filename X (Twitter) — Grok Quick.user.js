// ==UserScript==
// @name         X (Twitter) — Grok Quick
// @name:zh-CN   X (Twitter) — Grok 快捷分析
// @namespace    https://github.com/hahapkpk/tools
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
// @description  替换每条推文的 Grok 按钮，一键将推文发送到 Grok 侧边栏分析。支持事实核查、深度分析、翻译及 5 个自定义 prompt 槽位。
// ==/UserScript==

(function () {
  "use strict";

  // ─── 默认模板 ────────────────────────────────────────────────────────────────
  const DEFAULT_TEMPLATES = {
    factcheck: { label: "事实核查", icon: "🕵️", prompt: "请对以下推文进行详细的事实核查，指出可能存在的错误、误导性信息或缺乏依据的内容，并提供正确的背景信息：\n\n" },
    analysis:  { label: "深度分析", icon: "📊", prompt: "作为社交媒体观察者，请分析以下推文的潜在语气、情绪倾向、目标受众，以及作者可能隐含的动机或立场：\n\n" },
    translate: { label: "翻译解释", icon: "🌐", prompt: "请将以下推文翻译成流畅自然的中文。如果包含网络俚语、梗（Meme）或文化背景，请一并解释其含义：\n\n" },
    custom1:   { label: "自定义 1", icon: "✏️", prompt: "请简要分析这条推文的主要观点和意义：\n\n" },
    custom2:   { label: "自定义 2", icon: "✏️", prompt: "这条推文最值得关注的地方是什么？请详细说明：\n\n" },
    custom3:   { label: "自定义 3", icon: "✏️", prompt: "请从批判性思维角度评估这条推文：\n\n" },
    custom4:   { label: "自定义 4", icon: "✏️", prompt: "请总结这条推文的核心信息，并给出你的看法：\n\n" },
    custom5:   { label: "自定义 5", icon: "✏️", prompt: "请分析这条推文可能引发的社会影响：\n\n" },
  };

  const TEMPLATE_KEYS = ["factcheck", "analysis", "translate", "custom1", "custom2", "custom3", "custom4", "custom5"];

  // ─── 配置读写 ────────────────────────────────────────────────────────────────
  function loadConfig() {
    try {
      const raw = GM_getValue("gq_config", null);
      const saved = raw ? JSON.parse(raw) : {};
      const cfg = {};
      TEMPLATE_KEYS.forEach(k => { cfg[k] = { ...DEFAULT_TEMPLATES[k], ...(saved[k] || {}) }; });
      cfg.autoSend = saved.autoSend || false;
      return cfg;
    } catch (e) { return { ...DEFAULT_TEMPLATES, autoSend: false }; }
  }

  function saveConfig(cfg) { GM_setValue("gq_config", JSON.stringify(cfg)); }

  // ─── Grok SVG 特征 ───────────────────────────────────────────────────────────
  const GROK_PATTERNS = [
    "M14.2 5.6c-.3-.7-1.1-1-1.8-.7l-8.7 3.7c-.7.3-1 1.1-.7 1.8l.1.3c.2.4.5.7.9.8l2.5.6",
    "M16.7 5.5c-.4-.6-1.2-.8-1.8-.4L6.4 10c-.6.4-.8 1.2-.4 1.8",
  ];

  const SEND_BTN_LABELS = ["发布", "Post", "Reply", "回复", "Send", "发送", "Publicar", "Enviar", "Publier", "Envoyer", "보내기", "게시하기"];
  const BLACKLIST_LABELS = ["image", "picture", "generate", "draw", "create", "图片", "生成", "画像", "이미지"];
  const SEND_SVG_FINGERPRINT = "M2.504 21.866l.526-2.108C3.04 19.756 4 15.015 4 12s-.96-7.756-.97-7.757l-.527-2.109L21.5 12 2.504 21.866zM5.981 13c-.072 1.962-.34 3.806-.583 5.183L17.764 12 5.398 5.818c.242 1.376.51 3.22.583 5.182H10v2H5.981z";

  let activeInterval = null;
  let pendingTask = null;

  function resetGlobalState() {
    if (activeInterval) { clearInterval(activeInterval); activeInterval = null; }
    pendingTask = null;
  }

  function isGrokIcon(el) {
    if (!el || el.tagName !== "path") return false;
    const d = el.getAttribute("d");
    return d && GROK_PATTERNS.some(p => d.startsWith(p));
  }

  function triggerClick(el) {
    if (!el) return;
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
    el.click();
  }

  function simulateEnterKey(el) {
    ["keydown", "keypress", "keyup"].forEach(type => {
      el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    });
  }

  function setReactValue(el, value) {
    const ownDesc   = Object.getOwnPropertyDescriptor(el, "value");
    const protoDesc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
    const setter    = (ownDesc?.set && ownDesc.set !== protoDesc?.set) ? protoDesc?.set : (ownDesc?.set || protoDesc?.set);
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findGlobalGrokButton() {
    for (const path of document.querySelectorAll("path")) {
      if (isGrokIcon(path)) {
        const btn = path.closest("button");
        if (btn && !btn.closest("article") && !btn.classList.contains("gq-btn") && btn.offsetParent !== null) return btn;
      }
    }
    return null;
  }

  function getVisibleTextarea() {
    for (const ta of document.querySelectorAll("textarea")) {
      if (ta.offsetParent !== null) return ta;
    }
    return null;
  }


  // ─── 执行命令：填入 Grok 侧边栏 ──────────────────────────────────────────────
  function executeCommand(prompt, tweetData) {
    const fullContent = `${prompt}\n[推文链接]: ${tweetData.url}\n[推文内容]: ${tweetData.text}`;
    const autoSend = loadConfig().autoSend === true;
    pendingTask = { content: fullContent, autoSend, textFilled: false, targetInput: null };

    const existing = getVisibleTextarea();
    if (existing) {
      startInjectionDirect(existing);
      return;
    }

    const globalBtn = findGlobalGrokButton();
    if (globalBtn) {
      triggerClick(globalBtn);
      startInjection();
    } else {
      showToast("⚠️ 请先点击右下角 Grok 按钮打开侧边栏");
    }
  }

  function startInjectionDirect(targetInput) {
    if (activeInterval) { clearInterval(activeInterval); activeInterval = null; }
    let attempts = 0, cleared = false;
    activeInterval = setInterval(() => {
      attempts++;
      if (attempts > 80 || !pendingTask) { resetGlobalState(); return; }
      if (targetInput.offsetParent === null) { resetGlobalState(); showToast("⚠️ 侧边栏已关闭，请重新打开"); return; }
      if (!pendingTask.textFilled) {
        if (!cleared) { setReactValue(targetInput, ""); cleared = true; return; }
        setReactValue(targetInput, pendingTask.content);
        targetInput.focus();
        pendingTask.textFilled = true;
        pendingTask.targetInput = targetInput;
        return;
      }
      if (pendingTask.autoSend) { doSend(targetInput); }
      else { resetGlobalState(); }
    }, 100);
  }

  function startInjection() {
    if (activeInterval) { clearInterval(activeInterval); activeInterval = null; }
    let attempts = 0, cleared = false;
    activeInterval = setInterval(() => {
      attempts++;
      if (attempts > 80 || !pendingTask) { resetGlobalState(); return; }
      const ta = getVisibleTextarea();
      if (!ta) return;
      if (!pendingTask.textFilled) {
        if (!cleared) { setReactValue(ta, ""); cleared = true; return; }
        setReactValue(ta, pendingTask.content);
        ta.focus();
        pendingTask.textFilled = true;
        pendingTask.targetInput = ta;
        return;
      }
      if (pendingTask.autoSend) { doSend(ta); }
      else { resetGlobalState(); }
    }, 100);
  }

  function doSend(ta) {
    simulateEnterKey(ta);
    let targetBtn = null;
    for (const btn of document.querySelectorAll("button")) {
      const label = btn.getAttribute("aria-label") || "";
      if (BLACKLIST_LABELS.some(b => label.toLowerCase().includes(b))) continue;
      if (SEND_BTN_LABELS.some(g => label === g)) { targetBtn = btn; break; }
      const svgPath = btn.querySelector("path");
      if (svgPath) {
        const d = svgPath.getAttribute("d") || "";
        if (d === SEND_SVG_FINGERPRINT || d.startsWith("M12 3.59")) { targetBtn = btn; break; }
      }
    }
    if (targetBtn && !targetBtn.disabled && targetBtn.getAttribute("aria-disabled") !== "true") {
      triggerClick(targetBtn);
      setTimeout(() => {
        if (pendingTask?.targetInput) setReactValue(pendingTask.targetInput, "");
        resetGlobalState();
      }, 500);
    }
  }

  // ─── Toast ───────────────────────────────────────────────────────────────────
  function showToast(msg, duration = 3000) {
    document.querySelector(".gq-toast")?.remove();
    const el = document.createElement("div");
    el.className = "gq-toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.classList.add("fade-out"); setTimeout(() => el.remove(), 320); }, duration);
  }

  // ─── 菜单 ────────────────────────────────────────────────────────────────────
  function closeMenu() {
    document.getElementById("gq-menu")?.remove();
    document.getElementById("gq-overlay")?.remove();
  }

  function showMenu(x, y, tweetData) {
    closeMenu();
    const cfg = loadConfig();

    const overlay = document.createElement("div");
    overlay.id = "gq-overlay";
    overlay.onclick = closeMenu;
    document.body.appendChild(overlay);

    const menu = document.createElement("div");
    menu.id = "gq-menu";

    TEMPLATE_KEYS.forEach(key => {
      const tpl = cfg[key];
      if (!tpl?.label) return;
      const item = document.createElement("div");
      item.className = "gq-menu-item";
      item.innerHTML = `<span class="gq-menu-icon">${tpl.icon || "✏️"}</span><span class="gq-menu-label">${tpl.label}</span>`;
      item.onclick = () => { closeMenu(); executeCommand(tpl.prompt, tweetData); };
      menu.appendChild(item);
    });

    const footer = document.createElement("div");
    footer.className = "gq-menu-footer";

    const sendModeBtn = document.createElement("span");
    sendModeBtn.className = "gq-footer-btn";
    sendModeBtn.title = cfg.autoSend ? "当前：自动发送（点击切换）" : "当前：手动发送（点击切换）";
    sendModeBtn.textContent = cfg.autoSend ? "🚀" : "🛡️";
    sendModeBtn.onclick = (e) => {
      e.stopPropagation();
      const c = loadConfig(); c.autoSend = !c.autoSend; saveConfig(c);
      sendModeBtn.textContent = c.autoSend ? "🚀" : "🛡️";
      sendModeBtn.title = c.autoSend ? "当前：自动发送（点击切换）" : "当前：手动发送（点击切换）";
      showToast(c.autoSend ? "🚀 已切换为自动发送" : "🛡️ 已切换为手动发送");
    };

    const settingsBtn = document.createElement("span");
    settingsBtn.className = "gq-footer-btn";
    settingsBtn.title = "设置";
    settingsBtn.textContent = "⚙️";
    settingsBtn.onclick = (e) => { e.stopPropagation(); closeMenu(); openSettings(); };

    footer.appendChild(sendModeBtn);
    footer.appendChild(settingsBtn);
    menu.appendChild(footer);
    document.body.appendChild(menu);

    // 定位
    const mw = 180, mh = TEMPLATE_KEYS.length * 42 + 48;
    let fx = x, fy = y;
    if (fx + mw > window.innerWidth)  fx = window.innerWidth  - mw - 8;
    if (fy + mh > window.innerHeight) fy = y - mh;
    if (fy < 0) fy = 4;
    menu.style.left = fx + "px";
    menu.style.top  = fy + "px";
  }


  // ─── 设置面板 ────────────────────────────────────────────────────────────────
  function openSettings() {
    document.getElementById("gq-settings-overlay")?.remove();
    const cfg = loadConfig();
    const draft = {};
    TEMPLATE_KEYS.forEach(k => { draft[k] = { ...cfg[k] }; });
    draft.autoSend = cfg.autoSend;

    const overlay = document.createElement("div");
    overlay.id = "gq-settings-overlay";
    overlay.onclick = (e) => { if (e.target === overlay) closeSettings(); };

    const modal = document.createElement("div");
    modal.id = "gq-settings-modal";

    // header
    const header = document.createElement("div");
    header.className = "gq-modal-header";
    header.innerHTML = `<span>⚙️ Grok Quick 设置</span><span id="gq-close-btn" style="cursor:pointer;color:#536471;font-size:18px">✕</span>`;
    modal.appendChild(header);

    // body
    const body = document.createElement("div");
    body.className = "gq-modal-body";

    // 发送模式
    const modeCard = document.createElement("div");
    modeCard.className = "gq-section-card";
    modeCard.innerHTML = `
      <div class="gq-section-header">⚙️ 发送模式</div>
      <div class="gq-section-body">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13px;color:#E7E9EA">
          <input type="checkbox" id="gq-autosend-chk" ${draft.autoSend ? "checked" : ""} style="width:16px;height:16px;cursor:pointer">
          🚀 自动发送（填入后自动提交，不勾选则手动发送）
        </label>
      </div>`;
    body.appendChild(modeCard);

    // 模板编辑
    const sectionLabels = {
      factcheck: "🕵️ 事实核查", analysis: "📊 深度分析", translate: "🌐 翻译解释",
      custom1: "✏️ 自定义 1", custom2: "✏️ 自定义 2", custom3: "✏️ 自定义 3",
      custom4: "✏️ 自定义 4", custom5: "✏️ 自定义 5",
    };

    TEMPLATE_KEYS.forEach(key => {
      const card = document.createElement("div");
      card.className = "gq-section-card";

      const sh = document.createElement("div");
      sh.className = "gq-section-header";
      sh.textContent = sectionLabels[key];
      card.appendChild(sh);

      const sb = document.createElement("div");
      sb.className = "gq-section-body";

      // 标题
      const lr = document.createElement("div");
      lr.className = "gq-form-row";
      lr.innerHTML = `<label class="gq-form-label">标题名称</label>`;
      const li = document.createElement("input");
      li.className = "gq-input-text";
      li.value = draft[key].label;
      li.placeholder = "菜单显示名称";
      li.oninput = () => { draft[key].label = li.value; };
      lr.appendChild(li);
      sb.appendChild(lr);

      // Prompt
      const pr = document.createElement("div");
      pr.className = "gq-form-row";
      pr.innerHTML = `<label class="gq-form-label">提示词（推文内容会自动附加在末尾）</label>`;
      const pi = document.createElement("textarea");
      pi.className = "gq-input-textarea";
      pi.value = draft[key].prompt;
      pi.rows = 3;
      pi.oninput = () => { draft[key].prompt = pi.value; };
      pr.appendChild(pi);
      sb.appendChild(pr);

      // 重置（内置模式）
      if (["factcheck", "analysis", "translate"].includes(key)) {
        const rb = document.createElement("button");
        rb.className = "gq-btn-reset";
        rb.textContent = "恢复默认";
        rb.onclick = () => {
          draft[key] = { ...DEFAULT_TEMPLATES[key] };
          li.value = draft[key].label;
          pi.value = draft[key].prompt;
        };
        sb.appendChild(rb);
      }

      card.appendChild(sb);
      body.appendChild(card);
    });

    modal.appendChild(body);

    // footer
    const mf = document.createElement("div");
    mf.className = "gq-modal-footer";
    mf.innerHTML = `
      <button id="gq-btn-cancel" class="gq-btn gq-btn-secondary">取消</button>
      <button id="gq-btn-save"   class="gq-btn gq-btn-primary">保存设置</button>`;
    modal.appendChild(mf);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById("gq-close-btn").onclick   = closeSettings;
    document.getElementById("gq-btn-cancel").onclick  = closeSettings;
    document.getElementById("gq-btn-save").onclick    = () => {
      draft.autoSend = document.getElementById("gq-autosend-chk").checked;
      saveConfig(draft);
      showToast("✅ 设置已保存");
      closeSettings();
    };
  }

  function closeSettings() { document.getElementById("gq-settings-overlay")?.remove(); }

  // ─── 注入按钮（替换 Grok 图标） ──────────────────────────────────────────────
  const _hijacked = new WeakSet();

  function hijackOperations() {
    document.querySelectorAll("path").forEach(path => {
      if (!isGrokIcon(path)) return;
      const origBtn = path.closest("button");
      if (!origBtn || !origBtn.closest("article") || origBtn.classList.contains("gq-btn") || _hijacked.has(origBtn)) return;

      const newBtn = origBtn.cloneNode(true);
      newBtn.classList.add("gq-btn");
      newBtn.style.color = "#1d9bf0";
      newBtn.setAttribute("aria-label", "Grok Quick");
      newBtn.title = "Grok Quick 分析";

      newBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const article = newBtn.closest("article");
        if (!article) return;
        const textEl = article.querySelector('[data-testid="tweetText"]');
        const urlEl  = article.querySelector("time")?.closest("a");
        showMenu(e.clientX, e.clientY, {
          text: textEl ? textEl.innerText : "",
          url:  urlEl  ? urlEl.href : window.location.href,
        });
      };

      if (origBtn.parentNode) {
        _hijacked.add(newBtn);
        origBtn.parentNode.replaceChild(newBtn, origBtn);
      }
    });
  }


  // ─── 样式 ────────────────────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    #gq-overlay {
      position: fixed; inset: 0; z-index: 99989; background: transparent;
    }
    #gq-menu {
      position: fixed; z-index: 99990;
      background: #000; border: 1px solid #333639;
      border-radius: 12px; box-shadow: 0 8px 16px rgba(255,255,255,0.1);
      padding: 8px; display: flex; flex-direction: column; gap: 2px;
      min-width: 170px; font-family: sans-serif;
      animation: gqFadeIn 0.15s ease-out;
    }
    @keyframes gqFadeIn { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
    .gq-menu-item {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; color: #E7E9EA; font-size: 14px;
      border-radius: 8px; cursor: pointer; user-select: none;
      transition: background 0.1s;
    }
    .gq-menu-item:hover { background: #1D9BF0; color: #fff; }
    .gq-menu-icon { font-size: 16px; flex-shrink: 0; }
    .gq-menu-label { flex: 1; }
    .gq-menu-footer {
      border-top: 1px solid #333; padding-top: 4px; margin-top: 2px;
      display: flex; justify-content: space-between; align-items: center;
      padding: 6px 8px 2px;
    }
    .gq-footer-btn {
      padding: 4px 8px; font-size: 16px; cursor: pointer;
      color: #71767B; border-radius: 4px; user-select: none;
    }
    .gq-footer-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
    .gq-toast {
      position: fixed; bottom: 20px; right: 20px;
      background: rgba(15,20,28,0.97); border: 1.5px solid #1d9bf0;
      color: #fff; font-size: 13px; font-family: sans-serif;
      padding: 12px 16px; border-radius: 10px; z-index: 2147483647;
      box-shadow: 0 4px 20px rgba(29,155,240,0.25); transition: opacity 0.3s;
    }
    .gq-toast.fade-out { opacity: 0; }
    #gq-settings-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      z-index: 2147483640; display: flex; justify-content: center; align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #gq-settings-modal {
      background: #0d1117; border: 1px solid #2f3336; border-radius: 16px;
      width: min(500px, 94vw); height: min(88vh, 800px);
      display: flex; flex-direction: column; color: #E7E9EA;
      box-shadow: 0 20px 60px rgba(0,0,0,0.95); overflow: hidden;
      animation: gqModalIn 0.18s ease-out;
    }
    @keyframes gqModalIn { from { opacity:0; transform:scale(0.96) translateY(8px); } to { opacity:1; transform:scale(1) translateY(0); } }
    .gq-modal-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 20px; border-bottom: 1px solid #2f3336;
      font-size: 15px; font-weight: bold; color: #fff; flex-shrink: 0;
    }
    .gq-modal-body {
      flex: 1; overflow-y: auto; padding: 16px 20px;
      display: flex; flex-direction: column; gap: 12px;
      scrollbar-width: thin; scrollbar-color: #1e2d3d transparent;
    }
    .gq-modal-body::-webkit-scrollbar { width: 5px; }
    .gq-modal-body::-webkit-scrollbar-thumb { background: #1e2d3d; border-radius: 10px; }
    .gq-modal-footer {
      padding: 12px 20px; border-top: 1px solid #2f3336;
      display: flex; justify-content: flex-end; gap: 10px; flex-shrink: 0;
    }
    .gq-section-card { background: #16181C; border: 1px solid #2f3336; border-radius: 12px; overflow: hidden; }
    .gq-section-header { padding: 10px 14px; font-size: 13px; font-weight: bold; color: #1d9bf0; background: rgba(29,155,240,0.06); border-bottom: 1px solid #2f3336; }
    .gq-section-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
    .gq-form-row { display: flex; flex-direction: column; gap: 4px; }
    .gq-form-label { font-size: 12px; color: #71767B; }
    .gq-input-text {
      background: #0d1117; border: 1px solid #2f3336; border-radius: 8px;
      color: #E7E9EA; font-size: 13px; padding: 8px 10px; outline: none;
      transition: border-color 0.15s; width: 100%; box-sizing: border-box;
    }
    .gq-input-text:focus { border-color: #1d9bf0; }
    .gq-input-textarea {
      background: #0d1117; border: 1px solid #2f3336; border-radius: 8px;
      color: #E7E9EA; font-size: 13px; padding: 8px 10px; outline: none;
      resize: vertical; min-height: 72px; font-family: inherit;
      transition: border-color 0.15s; line-height: 1.5;
      width: 100%; box-sizing: border-box;
    }
    .gq-input-textarea:focus { border-color: #1d9bf0; }
    .gq-btn-reset {
      align-self: flex-start; padding: 4px 10px; font-size: 12px;
      border-radius: 6px; cursor: pointer; border: 1px solid #333;
      background: transparent; color: #71767B; transition: border-color 0.15s, color 0.15s;
    }
    .gq-btn-reset:hover { border-color: #1d9bf0; color: #1d9bf0; }
    .gq-btn { padding: 8px 18px; font-size: 14px; border-radius: 20px; cursor: pointer; border: none; font-weight: bold; transition: background 0.15s; }
    .gq-btn-primary { background: #1d9bf0; color: #fff; }
    .gq-btn-primary:hover { background: #1a8cd8; }
    .gq-btn-secondary { background: transparent; color: #E7E9EA; border: 1px solid #536471; }
    .gq-btn-secondary:hover { background: rgba(255,255,255,0.05); }
  `;
  document.head.appendChild(style);

  // ─── 启动 ────────────────────────────────────────────────────────────────────
  const observer = new MutationObserver(() => hijackOperations());
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(hijackOperations, 1000);

  GM_registerMenuCommand("⚙️ Grok Quick 设置", openSettings);

  console.log("[Grok Quick] v1.0.0 loaded");
})();
