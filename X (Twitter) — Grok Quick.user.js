// ==UserScript==
// @name         X (Twitter) — Grok Quick
// @name:zh-CN   X (Twitter) — Grok 快捷分析
// @namespace    https://github.com/hahapkpk/tools
// @version      2.0.0
// @license      MIT
// @author       Flywind
// @icon         https://abs.twimg.com/favicons/twitter.3.ico
// @match        https://twitter.com/*
// @match        https://x.com/*
// @match        https://mobile.twitter.com/*
// @match        https://m.x.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @run-at       document-idle
// @description  替换每条推文的 Grok 按钮，一键将推文发送到 Grok 侧边栏分析。支持事实核查、深度分析、翻译及 5 个自定义 prompt 槽位。
// ==/UserScript==

(function () {
  "use strict";

  // ════════════════════════════════════════════════════════════════
  //  默认模板
  // ════════════════════════════════════════════════════════════════
  const DEFAULT_TEMPLATES = {
    factcheck: { label: "\u4E8B\u5B9E\u6838\u67E5", icon: "\uD83D\uDC75\uFE0F", prompt: "\u8BF7\u5BF9\u4EE5\u4E0B\u63A8\u6587\u8FDB\u884C\u8BE6\u7EC6\u7684\u4E8B\u5B9E\u6838\u67E5\uFF0C\u6307\u51FA\u53EF\u80FD\u5B58\u5728\u7684\u9519\u8BEF\u3001\u8BEF\u5BFC\u6027\u4FE1\u606F\u6216\u7F3A\u4E4F\u4F9D\u636E\u7684\u5185\u5BB9\uFF0C\u5E76\u63D0\u4F9B\u6B63\u786E\u7684\u80CC\u666F\u4FE1\u606F\uFF1A\n\n" },
    analysis:  { label: "\u6DF1\u5EA6\u5206\u6790", icon: "\uD83D\uDCCA", prompt: "\u4F5C\u4E3A\u793E\u4EA4\u5A92\u4F53\u89C2\u5BDF\u8005\uFF0C\u8BF7\u5206\u6790\u4EE5\u4E0B\u63A8\u6587\u7684\u6F5C\u5728\u8BED\u6C14\u3001\u60C5\u7EEA\u503E\u5411\u3001\u76EE\u6807\u53D7\u4F17\uFF0C\u4EE5\u53CA\u4F5C\u8005\u53EF\u80FD\u9690\u542B\u7684\u52A8\u673A\u6216\u7ACB\u573A\uFF1A\n\n" },
    translate: { label: "\u7FFB\u8BD1\u89E3\u91CA", icon: "\uD83C\uDF10", prompt: "\u8BF7\u5C06\u4EE5\u4E0B\u63A8\u658F\u7FFB\u8BD1\u6210\u6D41\u7545\u81EA\u7136\u7684\u4E2D\u6587\u3002\u5982\u679C\u5305\u542B\u7F51\u7EDC\u4FD7\u8BED\u3001\u6897\uFF08Meme\uFF09\u6216\u6587\u5316\u80CC\u666F\uFF0C\u8BF7\u4E00\u5E76\u89E3\u91CA\u5176\u542B\u4E49\uFF1A\n\n" },
    custom1:   { label: "\u81EA\u5B9A\u4E49 1", icon: "\u270F\uFE0F", prompt: "\u8BF7\u7B80\u8981\u5206\u6790\u8FD9\u6761\u63A8\u6587\u7684\u4E3B\u8981\u89C2\u70B9\u548C\u610F\u4E49\uFF1A\n\n" },
    custom2:   { label: "\u81EA\u5B9A\u4E49 2", icon: "\u270F\uFE0F", prompt: "\u8FD9\u6761\u63A8\u658F\u6700\u503C\u5F97\u5173\u6CE8\u7684\u5730\u65B9\u662F\u4EC0\u4E48\uFF1F\u8BF7\u8BE6\u7EC6\u8BF4\u660E\uFF1A\n\n" },
    custom3:   { label: "\u81EA\u5B9A\u4E49 3", icon: "\u270F\uFE0F", prompt: "\u8BF7\u4ECE\u6279\u5224\u6027\u601D\u7EF4\u89D2\u5EA6\u8BC4\u4F30\u8FD9\u6761\u63A8\u6587\uFF1A\n\n" },
    custom4:   { label: "\u81EA\u5B9A\u4E49 4", icon: "\u270F\uFE0F", prompt: "\u8BF7\u603B\u7ED3\u8FD9\u6761\u63A8\u6587\u7684\u6838\u5FC3\u4FE1\u606F\uFF0C\u5E76\u7ED9\u51FA\u4F60\u7684\u770B\u6CD5\uFF1A\n\n" },
    custom5:   { label: "\u81EA\u5B9A\u4E49 5", icon: "\u270F\uFE0F", prompt: "\u8BF7\u5206\u6790\u8FD9\u6761\u63A8\u658F\u53EF\u80FD\u5F15\u53D1\u7684\u793E\u4F1A\u5F71\u54CD\uFF1A\n\n" },
  };

  const TEMPLATE_KEYS = ["factcheck", "analysis", "translate", "custom1", "custom2", "custom3", "custom4", "custom5"];

  // ════════════════════════════════════════════════════════════════
  //  常量 & 配置
  // ════════════════════════════════════════════════════════════════

  /** Grok SVG path d 属性特征（多维度匹配，提高鲁棒性） */
  const GROK_PATH_PATTERNS = [
    // Grok 主图标 - 变体 1（当前版本）
    "M14.2 5.6c-.3-.7-1.1-1-1.8-.7l-8.7 3.7c-.7.3-1 1.1-.7 1.8l.1.3c.2.4.5.7.9.8l2.5.6",
    // Grok 主图标 - 变体 2
    "M16.7 5.5c-.4-.6-1.2-.8-1.8-.4L6.4 10c-.6.4-.8 1.2-.4 1.8",
    // Grok 主图标 - 变体 3（备用）
    "M12 2a10 10 0",
  ];

  const SEND_BTN_LABELS = [
    "\u53D1\u5E03", "Post", "Reply", "\u56DE\u590D", "Send", "\u53D1\u9001",
    "Publicar", "Enviar", "Publier", "Envoyer",
    "\uBCF4\uB0B4\uAE30", "\uAC8C\uC2DC\uD558\uAE30"
  ];

  const BLACKLIST_LABELS = [
    "image", "picture", "generate", "draw", "create",
    "\u56FE\u7247", "\u751F\u6210", "\u753B\u50CF", "\uC774\uBBF8\uC9C0"
  ];

  const SEND_SVG_FINGERPRINT =
    "M2.504 21.866l.526-2.108C3.04 19.756 4 15.015 4 12s-.96-7.756-.97-7.757l-.527-2.109L21.5 12 2.504 21.866zM5.981 13c-.072 1.962-.34 3.806-.583 5.183L17.764 12 5.398 5.818c.242 1.376.51 3.22.583 5.182H10v2H5.981z";

  /** 轮询最大尝试次数和间隔 */
  const INJECT_MAX_ATTEMPTS = 100;
  const INJECT_INTERVAL_MS = 80;

  // 全局状态
  let _activeTimer = null;
  let _pendingTask = null;
  const _hijackedButtons = new WeakSet();

  // ════════════════════════════════════════════════════════════════
  //  工具函数
  // ════════════════════════════════════════════════════════════════

  function resetGlobalState() {
    if (_activeTimer) {
      clearTimeout(_activeTimer);
      _activeTimer = null;
    }
    _pendingTask = null;
  }

  /**
   * 判断一个 <path> 元素是否是 Grok 图标
   * 多维度匹配：path d + 父级 button aria-label
   */
  function isGrokIcon(pathEl) {
    if (!pathEl || pathEl.tagName !== "PATH") return false;
    const d = pathEl.getAttribute("d");
    if (!d) return false;
    // 优先精确匹配 d 属性
    if (GROK_PATH_PATTERNS.some(p => d.startsWith(p))) return true;
    // 兜底：检查父按钮的 aria-label
    const parentBtn = pathEl.closest("button");
    if (parentBtn) {
      const label = (parentBtn.getAttribute("aria-label") || "").toLowerCase();
      if (label === "grok" || label.includes("grok \u64CD\u4F5C")) return true;
    }
    return false;
  }

  function triggerClick(el) {
    if (!el) return;
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
    el.click();
  }

  function simulateEnterKey(el) {
    ["keydown", "keypress", "keyup"].forEach(type => {
      el.dispatchEvent(new KeyboardEvent(type, {
        key: "Enter", code: "Enter", keyCode: 13, which: 13,
        bubbles: true, cancelable: true
      }));
    });
  }

  /**
   * 安全设置 React 受控 input/textarea 的值
   * 兼容 React 16/17/18 的合成事件系统
   */
  function setReactValue(el, value) {
    // 使用原生 setter 触发 React 内部更新
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, "value"
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findGlobalGrokButton() {
    for (const path of document.querySelectorAll("article path, [data-testid='primaryColumn'] path")) {
      if (!isGrokIcon(path)) continue;
      const btn = path.closest("button");
      if (btn && !btn.closest("article") && !btn.classList.contains("gq-btn") && btn.offsetParent !== null) {
        return btn;
      }
    }
    return null;
  }

  function getVisibleTextarea() {
    for (const ta of document.querySelectorAll("textarea[data-testid='tweetTextarea_0'], textarea")) {
      if (ta.offsetParent !== null && ta.offsetWidth > 0) return ta;
    }
    return null;
  }

  /**
   * 从 article 元素中提取推文数据
   */
  function extractTweetData(article) {
    if (!article) return { text: "", url: location.href };
    const textEl = article.querySelector("[data-testid='tweetText']");
    const urlEl = article.querySelector("time")?.closest("a");
    // 尝试获取用户名
    const userLink = article.querySelector("[data-testid='User-Name'] a");
    let author = "";
    if (userLink) {
      author = userLink.getAttribute("href")?.replace("/", "") || "";
    }
    return {
      text: textEl ? textEl.innerText : "",
      url: urlEl ? `${location.origin}${urlEl.getAttribute("href")}` : location.href,
      author,
    };
  }

  // ════════════════════════════════════════════════════════════════
  //  配置读写
  // ════════════════════════════════════════════════════════════════

  function loadConfig() {
    try {
      const raw = GM_getValue("gq_config_v2", null);
      const saved = raw ? JSON.parse(raw) : {};
      const cfg = {};
      TEMPLATE_KEYS.forEach(k => {
        cfg[k] = { ...DEFAULT_TEMPLATES[k], ...(saved[k] || {}) };
      });
      cfg.autoSend = saved.autoSend ?? false;
      cfg.templateOrder = saved.templateOrder || [...TEMPLATE_KEYS];
      return cfg;
    } catch (e) {
      console.warn("[Grok Quick] Config load failed:", e);
      return { ...DEFAULT_TEMPLATES, autoSend: false, templateOrder: [...TEMPLATE_KEYS] };
    }
  }

  function saveConfig(cfg) {
    try {
      GM_setValue("gq_config_v2", JSON.stringify(cfg));
    } catch (e) {
      console.warn("[Grok Quick] Config save failed:", e);
      showToast("\u26A0\uFE0F \u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25");
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  执行引擎：填入 Grok 侧边栏
  // ════════════════════════════════════════════════════════════════

  /**
   * 执行分析命令：构建完整 prompt 并注入 Grok 侧边栏
   */
  function executeCommand(prompt, tweetData) {
    const tweetMeta = `[${"\u63A8\u6587\u94FE\u63A5"}]: ${tweetData.url}\n[${"\u63A8\u6587\u4F5C\u8005"}]: ${tweetData.author || "\u672A\u77E5"}\n[${"\u63A8\u6587\u5185\u5BB9"}]: ${tweetData.text}`;
    const fullContent = `${prompt}\n${tweetMeta}`;
    const autoSend = loadConfig().autoSend === true;

    resetGlobalState();
    _pendingTask = { content: fullContent, autoSend, textFilled: false, targetInput: null };

    // 情况 A：Grok 侧边栏已打开（有可见 textarea）
    const existingTa = getVisibleTextarea();
    if (existingTa) {
      startInjectionDirect(existingTa);
      return;
    }

    // 情况 B：需要点击全局 Grok 按钮打开侧边栏
    const globalBtn = findGlobalGrokButton();
    if (globalBtn) {
      triggerClick(globalBtn);
      startInjection();
    } else {
      showToast("\u26A0\uFE0F \u8BF7\u5148\u70B9\u51FB\u53F3\u4E0B\u89D2 Grok \u6309\u94AE\u6253\u5F00\u4FA7\u8FB9\u680F");
    }
  }

  /**
   * 直接向已有 textarea 注入内容（Promise 化，替代 setInterval）
   */
  async function startInjectionDirect(targetInput) {
    const task = _pendingTask;
    if (!task || targetInput.offsetParent === null) {
      showToast("\u26A0\uFE0F \u4FA7\u8FB9\u680F\u5DF2\u5173\u95ED\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00");
      return;
    }

    try {
      // 清空现有内容
      setReactValue(targetInput, "");
      await sleep(50);

      // 填入新内容
      setReactValue(targetInput, task.content);
      targetInput.focus();
      task.textFilled = true;
      task.targetInput = targetInput;

      await sleep(150);

      if (task.autoSend) {
        doSend(targetInput);
      } else {
        resetGlobalState();
      }
    } catch (err) {
      console.error("[Grok Quick] Injection error:", err);
      showToast("\u26A0\uFE0F \u6CE8\u5165\u5931\u8D25");
      resetGlobalState();
    }
  }

  /**
   * 点击全局 Grok 后等待 textarea 出现再注入
   */
  async function startInjection() {
    const task = _pendingTask;
    if (!task) return;

    let attempts = 0;
    while (attempts < INJECT_MAX_ATTEMPTS) {
      attempts++;
      const ta = getVisibleTextarea();
      if (ta) {
        startInjectionDirect(ta);
        return;
      }
      await sleep(INJECT_INTERVAL_MS);
    }

    showToast("\u26A0\uFE0F \u7B49\u5F85 Grok \u4FA7\u8FB9\u680F\u8D85\u65F6");
    resetGlobalState();
  }

  function doSend(ta) {
    simulateEnterKey(ta);

    setTimeout(() => {
      // 查找发送按钮
      const targetBtn = findSendButton();
      if (targetBtn && !targetBtn.disabled && targetBtn.getAttribute("aria-disabled") !== "true") {
        triggerClick(targetBtn);
        setTimeout(() => {
          if (_pendingTask?.targetInput) setReactValue(_pendingTask.targetInput, "");
          resetGlobalState();
        }, 500);
      } else {
        // 即使没找到发送按钮也清理状态
        resetGlobalState();
      }
    }, 200);
  }

  function findSendButton() {
    for (const btn of document.querySelectorAll("button[aria-label], button[data-testid]")) {
      const label = btn.getAttribute("aria-label") || "";
      // 排除黑名单按钮（图片生成等）
      if (BLACKLIST_LABELS.some(b => label.toLowerCase().includes(b))) continue;
      // 匹配发送按钮标签
      if (SEND_BTN_LABELS.some(g => label === g)) return btn;
      // 通过 SVG 指纹匹配
      const svgPath = btn.querySelector("path");
      if (svgPath) {
        const d = svgPath.getAttribute("d") || "";
        if (d === SEND_SVG_FINGERPRINT || d.startsWith("M12 3.59")) return btn;
      }
    }
    return null;
  }

  function sleep(ms) {
    return new Promise(resolve => _activeTimer = setTimeout(resolve, ms));
  }

  // ════════════════════════════════════════════════════════════════
  //  Toast 通知
  // ════════════════════════════════════════════════════════════════

  function showToast(msg, duration = 3000) {
    document.querySelector(".gq-toast")?.remove();

    const el = document.createElement("div");
    el.className = "gq-toast";
    el.innerHTML = `<span>${msg}</span>`;
    document.body.appendChild(el);

    requestAnimationFrame(() => el.classList.add("gq-toast-visible"));

    setTimeout(() => {
      el.classList.remove("gq-toast-visible");
      setTimeout(() => el.remove(), 320);
    }, duration);
  }

  // ════════════════════════════════════════════════════════════════
  //  弹出菜单（支持键盘导航）
  // ════════════════════════════════════════════════════════════════

  let _menuActiveIndex = -1;
  let _menuItems = [];

  function closeMenu() {
    document.getElementById("gq-menu")?.remove();
    document.getElementById("gq-overlay")?.remove();
    _menuActiveIndex = -1;
    _menuItems = [];
  }

  function showMenu(x, y, tweetData) {
    closeMenu();
    const cfg = loadConfig();
    const orderedKeys = cfg.templateOrder || [...TEMPLATE_KEYS];

    // 遮罩层
    const overlay = document.createElement("div");
    overlay.id = "gq-overlay";
    overlay.onclick = closeMenu;
    document.body.appendChild(overlay);

    // 菜单容器
    const menu = document.createElement("div");
    menu.id = "gq-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Grok Quick \u5206\u6790\u83DC\u5355");

    _menuItems = [];
    orderedKeys.forEach((key, idx) => {
      const tpl = cfg[key];
      if (!tpl?.label) return;

      const item = document.createElement("div");
      item.className = "gq-menu-item";
      item.setAttribute("role", "menuitem");
      item.setAttribute("tabindex", "0");
      item.innerHTML = `<span class="gq-menu-icon">${tpl.icon || "\u270F\uFE0F"}</span><span class="gq-menu-label">${escapeHtml(tpl.label)}</span>`;
      item.dataset.key = key;

      item.onmouseenter = () => highlightMenuItem(idx);
      item.onclick = () => { closeMenu(); executeCommand(tpl.prompt, tweetData); };
      item.onkeydown = handleMenuKeydown(idx, tpl.prompt, tweetData);

      _menuItems.push(item);
      menu.appendChild(item);
    });

    // 底部操作栏
    const footer = document.createElement("div");
    footer.className = "gq-menu-footer";

    const sendModeBtn = createFooterButton(
      cfg.autoSend ? "\uD83D\uDE80" : "\uD83D\uDEE1\uFE0F",
      cfg.autoSend ? "\u5F53\u524D\uFF1A\u81EA\u52A8\u53D1\u9001\uFF08\u70B9\u51FB\u5207\u6362\uFF09" : "\u5F53\u524D\uFF1A\u624B\u52A8\u53D1\u9001\uFF08\u70B9\u51FB\u5207\u6362\uFF09",
      () => toggleAutoSend(sendModeBtn)
    );

    const settingsBtn = createFooterButton(
      "\u2699\uFE0F", "\u8BBE\u7F6E",
      () => { closeMenu(); openSettings(); }
    );

    footer.appendChild(sendModeBtn);
    footer.appendChild(settingsBtn);
    menu.appendChild(footer);

    document.body.appendChild(menu);

    // 智能定位（自动避免溢出屏幕）
    positionMenu(menu, x, y, orderedKeys.length);

    // 键盘焦点管理
    requestAnimationFrame(() => {
      if (_menuItems[0]) _menuItems[0].focus();
      _menuActiveIndex = 0;
    });
  }

  function createFooterButton(icon, title, handler) {
    const btn = document.createElement("span");
    btn.className = "gq-footer-btn";
    btn.title = title;
    btn.textContent = icon;
    btn.tabIndex = 0;
    btn.onclick = (e) => { e.stopPropagation(); handler(); };
    return btn;
  }

  function toggleAutoSend(btnEl) {
    const c = loadConfig();
    c.autoSend = !c.autoSend;
    saveConfig(c);
    btnEl.textContent = c.autoSend ? "\uD83D\uDE80" : "\uD83D\uDEE1\uFE0F";
    btnEl.title = c.autoSend
      ? "\u5F53\u524D\uFF1A\u81EA\u52A8\u53D1\u9001\uFF08\u70B9\u51FB\u5207\u6362\uFF09"
      : "\u5F53\u524D\uFF1A\u624B\u52A8\u53D1\u9001\uFF08\u70B9\u51FB\u5207\u6362\uFF09";
    showToast(c.autoSend ? "\uD83D\uDE80 \u5DF2\u5207\u6362\u4E3A\u81EA\u52A8\u53D1\u9001" : "\uD83D\uDEE1\uFE0F \u5DF2\u5207\u6362\u4E3A\u624B\u52A8\u53D1\u9001");
  }

  function positionMenu(menu, x, y, itemCount) {
    const mw = Math.max(menu.offsetWidth, 180);
    const mh = itemCount * 44 + 52; // 每项 44px + footer 52px

    // 首次渲染后取实际尺寸（如果可用）
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      const actualW = rect.width || mw;
      const actualH = rect.height || mh;

      let fx = x, fy = y;
      if (fx + actualW > window.innerWidth - 8)  fx = window.innerWidth - actualW - 8;
      if (fy + actualH > window.innerHeight - 8) fy = y - actualH;
      if (fy < 8) fy = 8;
      if (fx < 8) fx = 8;

      menu.style.left = fx + "px";
      menu.style.top  = fy + "px";
    });

    // 初始定位（防止闪烁）
    menu.style.left = Math.min(x, window.innerWidth - mw - 8) + "px";
    menu.style.top  = Math.min(y, window.innerHeight - mh - 8) + "px";
  }

  function highlightMenuItem(index) {
    _menuItems.forEach((item, i) => {
      item.classList.toggle("gq-menu-item-active", i === index);
    });
    _menuActiveIndex = index;
  }

  function handleMenuKeydown(index, prompt, tweetData) {
    return (e) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          const nextIdx = (index + 1) % _menuItems.length;
          highlightMenuItem(nextIdx);
          _menuItems[nextIdx]?.focus();
          break;
        case "ArrowUp":
          e.preventDefault();
          const prevIdx = (index - 1 + _menuItems.length) % _menuItems.length;
          highlightMenuItem(prevIdx);
          _menuItems[prevIdx]?.focus();
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          closeMenu();
          executeCommand(prompt, tweetData);
          break;
        case "Escape":
          e.preventDefault();
          closeMenu();
          break;
      }
    };
  }

  // ESC 关闭菜单
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  }, true);

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ════════════════════════════════════════════════════════════════
  //  设置面板（增强版：导入/导出/排序）
  // ════════════════════════════════════════════════════════════════

  function openSettings() {
    document.getElementById("gq-settings-overlay")?.remove();
    const cfg = loadConfig();

    // 深拷贝草稿
    const draft = JSON.parse(JSON.stringify(cfg));

    // 遮罩
    const overlay = document.createElement("div");
    overlay.id = "gq-settings-overlay";
    overlay.onclick = (e) => { if (e.target === overlay) closeSettings(); };

    // Modal
    const modal = document.createElement("div");
    modal.id = "gq-settings-modal";

    // ── Header ──
    const header = document.createElement("div");
    header.className = "gq-modal-header";
    header.innerHTML = `
      <span class="gq-modal-title">\u2699\uFE0F Grok Quick \u8BBE\u7F6E <small>v${GM_info?.script?.version || "2.0"}</small></span>
      <span id="gq-close-btn" class="gq-close-icon" role="button" tabindex="0" aria-label="\u5173\u95ED">\u2715</span>
    `;
    modal.appendChild(header);

    document.getElementById("gq-close-btn").onclick = closeSettings;

    // ── Body ──
    const body = document.createElement("div");
    body.className = "gq-modal-body";

    // 发送模式卡片
    body.appendChild(buildModeCard(draft));

    // 导入/导出卡片
    body.appendChild buildImportExportCard(draft);

    // 模板编辑卡片
    const sectionLabels = {
      factcheck: "\uD83D\uDC75\uFE0F \u4E8B\u5B9E\u6838\u67E5",
      analysis:  "\uD83D\uDCCA \u6DF1\u5EA6\u5206\u6790",
      translate: "\uD83C\uDF10 \u7FFB\u8BD1\u89E3\u91CA",
      custom1:   "\u270F\uFE0F \u81EA\u5B9A\u4E49 1",
      custom2:   "\u270F\uFE0F \u81EA\u5B9A\u4E49 2",
      custom3:   "\u270F\uFE0F \u81EA\u5B9A\u4E49 3",
      custom4:   "\u270F\uFE0F \u81EA\u5B9A\u4E49 4",
      custom5:   "\u270F\uFE0F \u81EA\u5B9A\u4E49 5",
    };

    TEMPLATE_KEYS.forEach(key => {
      body.appendChild(buildTemplateCard(key, sectionLabels[key], draft));
    });

    modal.appendChild(body);

    // ── Footer ──
    const footer = document.createElement("div");
    footer.className = "gq-modal-footer";
    footer.innerHTML = `
      <button id="gq-btn-cancel" class="gq-btn gq-btn-secondary">\u53D6\u6D88</button>
      <button id="gq-btn-save"   class="gq-btn gq-btn-primary">\u4FDD\u5B58\u8BBE\u7F6E</button>
    `;
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // 事件绑定
    document.getElementById("gq-btn-cancel").onclick = closeSettings;
    document.getElementById("gq-btn-save").onclick = () => {
      draft.autoSend = document.getElementById("gq-autosend-chk").checked;
      saveConfig(draft);
      showToast("\u2705 \u8BBE\u7F6E\u5DF2\u4FDD\u5B58");
      closeSettings();
    };

    // ESC 关闭
    document.addEventListener("keydown", function escHandler(e) {
      if (e.key === "Escape") { closeSettings(); document.removeEventListener("keydown", escHandler); }
    });
  }

  function buildModeCard(draft) {
    const card = document.createElement("div");
    card.className = "gq-section-card";
    card.innerHTML = `
      <div class="gq-section-header">\u2699\uFE0F \u53D1\u9001\u6A21\u5F0F</div>
      <div class="gq-section-body">
        <label class="gq-toggle-row">
          <input type="checkbox" id="gq-autosend-chk" ${draft.autoSend ? "checked" : ""} class="gq-toggle-input">
          <span class="gq-toggle-slider"></span>
          <span class="gq-toggle-label">\uD83D\uDE80 \u81EA\u52A8\u53D1\u9001\uFF08\u586B\u5165\u540E\u81EA\u52A8\u63D0\u4EA4\uFF0C\u4E0D\u52FE\u9009\u5219\u624B\u52A8\u53D1\u9001\uFF09</span>
        </label>
      </div>`;
    return card;
  }

  function buildImportExportCard(draft) {
    const card = document.createElement("div");
    card.className = "gq-section-card";
    card.innerHTML = `
      <div class="gq-section-header">\uD83D\uDCE4 / \uD83D\uDCE5 \u5BFC\u5165 / \u5BFC\u51FA\u914D\u7F6E</div>
      <div class="gq-section-body gq-import-export-row">
        <button id="gq-btn-export" class="gq-btn gq-btn-sm gq-btn-outline">\uD83D\uDCE5 \u5BFC\u51FA JSON</button>
        <label class="gq-btn gq-btn-sm gq-btn-outline" style="cursor:pointer">
          \uD83D\uDCE4 \u5BFC\u5165 JSON
          <input type="file" id="gq-file-import" accept=".json" style="display:none">
        </label>
      </div>`;

    // 延迟绑定（因为 innerHTML 后才存在 DOM）
    requestAnimationFrame(() => {
      document.getElementById("gq-btn-export")?.onclick = () => exportConfig(draft);
      document.getElementById("gq-file-import")?.onchange = (e) => importConfig(e, draft);
    });

    return card;
  }

  function buildTemplateCard(key, label, draft) {
    const card = document.createElement("div");
    card.className = "gq-section-card";
    card.dataset.tplKey = key;

    const sh = document.createElement("div");
    sh.className = "gq-section-header";
    sh.textContent = label;

    const sb = document.createElement("div");
    sb.className = "gq-section-body";

    // 标题输入
    sb.append(createFormRow("\u6807\u9898\u540D\u79F0", "text", draft[key].label, "\u83DC\u5355\u663E\u793A\u540D\u79F0", (v) => { draft[key].label = v; }));

    // Prompt 输入
    sb.append(createFormRow("\u63D0\u793A\u8BCD", "textarea", draft[key].prompt, "\u63A8\u6587\u5185\u5BB9\u4F1A\u81EA\u52A8\u9644\u52A0\u5728\u672B\u5C3E", (v) => { draft[key].prompt = v; }));

    // 内置模板的重置按钮
    if (["factcheck", "analysis", "translate"].includes(key)) {
      const rb = document.createElement("button");
      rb.className = "gq-btn-reset";
      rb.textContent = "\u62E2\u590D\u9ED8\u8BA4";
      rb.onclick = () => {
        draft[key] = { ...DEFAULT_TEMPLATES[key] };
        card.querySelector(".gq-form-text-input")?.setAttribute("value", draft[key].label);
        card.querySelector(".gq-form-textarea-input")?.setAttribute("value", draft[key].prompt);
        showToast(`\u271A ${label} \u5DF2\u62E2\u590D`);
      };
      sb.appendChild(rb);
    }

    card.appendChild(sh);
    card.appendChild(sb);
    return card;
  }

  function createFormRow(labelText, type, value, placeholder, onChange) {
    const row = document.createElement("div");
    row.className = "gq-form-row";
    row.innerHTML = `<label class="gq-form-label">${labelText}</label>`;

    const input = type === "textarea"
      ? document.createElement("textarea")
      : document.createElement("input");

    input.className = type === "textarea" ? "gq-input-textarea gq-form-textarea-input" : "gq-input-text gq-form-text-input-input";
    input.value = value || "";
    input.placeholder = placeholder || "";
    if (type === "textarea") input.rows = 3;
    input.oninput = () => onChange(input.value);

    row.appendChild(input);
    return row;
  }

  function exportConfig(draft) {
    const data = JSON.stringify(draft, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `grok-quick-config-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("\uD83D\uDCE5 \u914D\u7F6E\u5DF2\u5BFC\u51FA");
  }

  function importConfig(event, draft) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        if (!imported || typeof imported !== "object") throw new Error("Invalid format");

        // 合并导入的配置（只合并已知字段）
        TEMPLATE_KEYS.forEach(k => {
          if (imported[k]?.label || imported[k]?.prompt) {
            draft[k] = { ...DEFAULT_TEMPLATES[k], ...imported[k] };
          }
        });
        if (typeof imported.autoSend === "boolean") draft.autoSend = imported.autoSend;

        showToast("\uD83D\uDCE4 \u914D\u7F6E\u5DF2\u5BFC\u5165\uFF0C\u8BF7\u70B9\u201C\u4FDD\u5B58\u201D\u751F\u6548");

        // 可选：刷新 UI 中的值
        openSettings(); // 重绘面板以显示新值
      } catch (err) {
        showToast("\u26A0\uFE0F JSON \u683C\u5F0F\u9519\u8BEF\uFF0C\u5BFC\u5165\u5931\u8D25");
      }
    };
    reader.readAsText(file);
    // 重置 file input 以允许重复导入同一文件
    event.target.value = "";
  }

  function closeSettings() {
    document.getElementById("gq-settings-overlay")?.remove();
  }

  // ════════════════════════════════════════════════════════════════
  //  按钮劫持（优化性能版）
  // ════════════════════════════════════════════════════════════════

  let _hijackScheduled = false;

  /**
   * 劫持推文中的 Grok 按钮 → 替换为 Grok Quick 按钮
   * 使用 requestAnimationFrame 合并多次调用，避免高频触发
   */
  function scheduleHijack() {
    if (_hijackScheduled) return;
    _hijackScheduled = true;
    requestAnimationFrame(() => {
      _hijackScheduled = false;
      hijackOperationsThrottled();
    });
  }

  function hijackOperationsThrottled() {
    // 只扫描 article 内的 path（缩小搜索范围）
    const articles = document.querySelectorAll("article");
    articles.forEach(article => {
      const paths = article.querySelectorAll("path");
      paths.forEach(path => {
        if (!isGrokIcon(path)) return;

        const origBtn = path.closest("button");
        if (!origBtn || origBtn.classList.contains("gq-btn") || _hijackedButtons.has(origBtn)) return;

        // 创建替换按钮
        const newBtn = replaceWithQuickButton(origBtn);
        if (newBtn) {
          _hijackedButtons.add(newBtn);
        }
      });
    });
  }

  function replaceWithQuickButton(origBtn) {
    try {
      const newBtn = origBtn.cloneNode(true);
      newBtn.classList.add("gq-btn");
      newBtn.style.color = "#1d9bf0";
      newBtn.style.cursor = "pointer";
      newBtn.setAttribute("aria-label", "Grok Quick");
      newBtn.title = "Grok Quick \u5FEB\u6377\u5206\u6790";

      // 移除原有的事件监听器（通过 cloneNode 已实现）
      newBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const article = newBtn.closest("article");
        const tweetData = extractTweetData(article);
        showMenu(e.clientX, e.clientY, tweetData);
      };

      if (origBtn.parentNode) {
        origBtn.parentNode.replaceChild(newBtn, origBtn);
        return newBtn;
      }
    } catch (err) {
      console.warn("[Grok Quick] Button hijack error:", err);
    }
    return null;
  }

  // ════════════════════════════════════════════════════════════════
  //  样式（增强版：暗亮主题适配 + 更精致的视觉设计）
  // ════════════════════════════════════════════════════════════════

  const style = document.createElement("style");
  style.textContent = `
    /* ─── 遮罩 ─── */
    #gq-overlay {
      position: fixed; inset: 0; z-index: 99989; background: transparent;
    }

    /* ─── 弹出菜单 ─── */
    #gq-menu {
      position: fixed; z-index: 99990;
      background: var(--gq-bg, #000000);
      border: 1px solid var(--gq-border, #333639);
      border-radius: 16px;
      box-shadow:
        0 8px 32px rgba(0, 0, 0, 0.45),
        0 0 0 1px rgba(255, 255, 255, 0.03),
        0 0 60px -10px rgba(29, 155, 240, 0.15);
      padding: 8px;
      display: flex; flex-direction: column; gap: 2px;
      min-width: 176px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      animation: gqFadeIn 0.15s cubic-bezier(0.16, 1, 0.3, 1);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
    }
    @keyframes gqFadeIn {
      from { opacity: 0; transform: translateY(-6px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .gq-menu-item {
      display: flex; align-items: center; gap: 11px;
      padding: 10px 14px;
      color: var(--gq-text, #E7E9EA); font-size: 14px; font-weight: 500;
      border-radius: 10px; cursor: pointer; user-select: none;
      transition: all 0.12s ease;
      outline: none;
    }
    .gq-menu-item:hover,
    .gq-menu-item.gq-menu-item-active {
      background: linear-gradient(135deg, #1D9BF0 0%, #1a8cd8 100%);
      color: #fff;
      transform: scale(1.01);
    }
    .gq-menu-icon { font-size: 17px; flex-shrink: 0; filter: none; transition: filter 0.12s; }
    .gq-menu-item:hover .gq-menu-icon,
    .gq-menu-item.gq-menu-item-active .gq-menu-icon { filter: drop-shadow(0 0 4px rgba(255,255,255,0.3)); }
    .gq-menu-label { flex: 1; line-height: 1.3; }

    /* ─── 菜单底部 ─── */
    .gq-menu-footer {
      border-top: 1px solid var(--gq-divider, rgba(255,255,255,0.08));
      padding: 6px 8px 4px;
      margin-top: 4px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .gq-footer-btn {
      padding: 5px 9px; font-size: 16px; cursor: pointer;
      color: var(--gq-muted, #71767B); border-radius: 8px;
      user-select: none; transition: all 0.15s;
      outline: none;
    }
    .gq-footer-btn:hover {
      background: var(--gq-hover, rgba(255,255,255,0.08)); color: #fff;
      transform: scale(1.1);
    }
    .gq-footer-btn:focus-visible {
      box-shadow: 0 0 0 2px #1d9bf0;
    }

    /* ─── Toast ─── */
    .gq-toast {
      position: fixed; bottom: 24px; right: 24px;
      background: rgba(15, 20, 28, 0.95);
      border: 1.5px solid #1d9bf0;
      color: #fff; font-size: 13px; font-family: inherit;
      padding: 12px 20px; border-radius: 12px;
      z-index: 2147483647;
      box-shadow:
        0 8px 32px rgba(29, 155, 240, 0.2),
        0 2px 8px rgba(0, 0, 0, 0.3);
      opacity: 0; transform: translateY(8px) scale(0.96);
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
    }
    .gq-toast.gq-toast-visible {
      opacity: 1; transform: translateY(0) scale(1);
      pointer-events: auto;
    }
    .gq-toast.fade-out {
      opacity: 0; transform: translateY(8px) scale(0.96);
    }

    /* ─── 设置弹窗 ─── */
    #gq-settings-overlay {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 2147483640;
      display: flex; justify-content: center; align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      animation: gqOverlayIn 0.2s ease;
    }
    @keyframes gqOverlayIn { from { opacity: 0; } to { opacity: 1; } }
    #gq-settings-modal {
      background: var(--gq-bg, #0d1117);
      border: 1px solid var(--gq-border, #2f3336);
      border-radius: 20px;
      width: min(520px, 94vw);
      height: min(86vh, 820px);
      display: flex; flex-direction: column;
      color: var(--gq-text, #E7E9EA);
      box-shadow:
        0 24px 80px rgba(0, 0, 0, 0.8),
        0 0 0 1px rgba(255, 255, 255, 0.04),
        0 0 120px -20px rgba(29, 155, 240, 0.12);
      overflow: hidden;
      animation: gqModalIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes gqModalIn {
      from { opacity: 0; transform: scale(0.94) translateY(12px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }
    .gq-modal-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 18px 22px;
      border-bottom: 1px solid var(--gq-divider, rgba(255,255,255,0.06));
      flex-shrink: 0;
    }
    .gq-modal-title {
      font-size: 16px; font-weight: 700; color: #fff;
      display: flex; align-items: center; gap: 8px;
    }
    .gq-modal-title small {
      font-size: 11px; font-weight: 400; color: var(--gq-muted, #71767B);
      background: rgba(29, 155, 240, 0.1);
      padding: 2px 8px; border-radius: 6px;
    }
    .gq-close-icon {
      cursor: pointer; color: var(--gq-muted, #536471);
      font-size: 18px; width: 28px; height: 28px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 8px; transition: all 0.15s;
      line-height: 1;
    }
    .gq-close-icon:hover {
      background: rgba(255, 255, 255, 0.08); color: #fff;
    }
    .gq-modal-body {
      flex: 1; overflow-y: auto; padding: 18px 22px;
      display: flex; flex-direction: column; gap: 12px;
      scrollbar-width: thin; scrollbar-color: var(--gq-scrollbar, #2d3748) transparent;
    }
    .gq-modal-body::-webkit-scrollbar { width: 5px; }
    .gq-modal-body::-webkit-scrollbar-thumb { background: var(--gq-scrollbar, #2d3748); border-radius: 10px; }
    .gq-modal-footer {
      padding: 14px 22px;
      border-top: 1px solid var(--gq-divider, rgba(255,255,255,0.06));
      display: flex; justify-content: flex-end; gap: 10px; flex-shrink: 0;
    }

    /* ─── 卡片 & 分区 ─── */
    .gq-section-card {
      background: var(--gq-card-bg, #16181C);
      border: 1px solid var(--gq-border, #2f3336);
      border-radius: 14px; overflow: hidden;
      transition: border-color 0.15s;
    }
    .gq-section-card:hover {
      border-color: rgba(29, 155, 240, 0.2);
    }
    .gq-section-header {
      padding: 11px 15px; font-size: 13px; font-weight: 600;
      color: #1d9bf0;
      background: rgba(29, 155, 240, 0.06);
      border-bottom: 1px solid var(--gq-divider, rgba(255,255,255,0.05));
      letter-spacing: 0.02em;
    }
    .gq-section-body {
      padding: 14px 15px;
      display: flex; flex-direction: column; gap: 10px;
    }

    /* ─── 表单控件 ─── */
    .gq-form-row { display: flex; flex-direction: column; gap: 5px; }
    .gq-form-label {
      font-size: 12px; color: var(--gq-muted, #71767B); font-weight: 500;
    }
    .gq-input-text, .gq-input-textarea {
      background: var(--gq-input-bg, #0d1117);
      border: 1px solid var(--gq-border, #2f3336);
      border-radius: 10px;
      color: var(--gq-text, #E7E9EA); font-size: 13.5px;
      padding: 9px 12px; outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
      width: 100%; box-sizing: border-box;
      font-family: inherit;
    }
    .gq-input-text:focus, .gq-input-textarea:focus {
      border-color: #1d9bf0;
      box-shadow: 0 0 0 3px rgba(29, 155, 240, 0.15);
    }
    .gq-input-textarea {
      resize: vertical; min-height: 76px;
      line-height: 1.55;
    }

    /* Toggle 开关 */
    .gq-toggle-row {
      display: flex; align-items: center; gap: 12px;
      cursor: pointer; font-size: 13.5px; color: var(--gq-text, #E7E9EA);
      user-select: none;
    }
    .gq-toggle-input {
      appearance: none; -webkit-appearance: none;
      width: 42px; height: 24px;
      background: var(--gq-toggle-off, #333639);
      border-radius: 12px; position: relative;
      cursor: pointer; transition: background 0.2s;
      flex-shrink: 0;
    }
    .gq-toggle-input:checked { background: #1d9bf0; }
    .gq-toggle-input::after {
      content: "";
      position: absolute; top: 2px; left: 2px;
      width: 20px; height: 20px;
      background: #fff; border-radius: 50%;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
    }
    .gq-toggle-input:checked::after { transform: translateX(18px); }
    .gq-toggle-label { user-select: none; }

    /* Import/Export 行 */
    .gq-import-export-row {
      display: flex; gap: 10px; flex-wrap: wrap;
    }

    /* Buttons */
    .gq-btn-reset {
      align-self: flex-start; padding: 5px 12px; font-size: 12px;
      border-radius: 8px; cursor: pointer;
      border: 1px solid var(--gq-border, #333);
      background: transparent; color: var(--gq-muted, #71767B);
      transition: all 0.15s; font-family: inherit;
    }
    .gq-btn-reset:hover {
      border-color: #1d9bf0; color: #1d9bf0;
      background: rgba(29, 155, 240, 0.06);
    }
    .gq-btn {
      padding: 9px 20px; font-size: 14px; border-radius: 99px;
      cursor: pointer; border: none; font-weight: 600;
      font-family: inherit; transition: all 0.15s;
      display: inline-flex; align-items: center; gap: 6px;
    }
    .gq-btn-primary {
      background: linear-gradient(135deg, #1d9bf0 0%, #1a8cd8 100%);
      color: #fff; box-shadow: 0 2px 12px rgba(29, 155, 240, 0.3);
    }
    .gq-btn-primary:hover {
      background: linear-gradient(135deg, #1a8cd8 0%, #177ec3 100%);
      transform: translateY(-1px);
      box-shadow: 0 4px 16px rgba(29, 155, 240, 0.4);
    }
    .gq-btn-secondary {
      background: transparent; color: var(--gq-text, #E7E9EA);
      border: 1px solid var(--gq-border, #536471);
    }
    .gq-btn-secondary:hover {
      background: rgba(255, 255, 255, 0.06);
    }
    .gq-btn-sm { padding: 6px 14px; font-size: 12.5px; border-radius: 10px; }
    .gq-btn-outline {
      background: transparent; color: var(--gq-text, #E7E9EA);
      border: 1px solid var(--gq-border, #3d4145);
    }
    .gq-btn-outline:hover {
      border-color: #1d9bf0; color: #1d9bf0;
      background: rgba(29, 155, 240, 0.06);
    }

    /* ─── 明色主题适配 ─── */
    @media (prefers-color-scheme: light) {
      :root {
        --gq-bg: #ffffff;
        --gq-text: #0f1419;
        --gq-muted: #536471;
        --gq-border: #eff1f3;
        --gq-divider: rgba(0,0,0,0.06);
        --gq-card-bg: #f7f9fa;
        --gq-input-bg: #fff;
        --gq-hover: rgba(0,0,0,0.04);
        --gq-toggle-off: #ccd0d3;
        --gq-scrollbar: #c4c9cc;
      }
      #gq-settings-modal {
        box-shadow:
          0 24px 80px rgba(0, 0, 0, 0.15),
          0 0 0 1px rgba(0, 0, 0, 0.04),
          0 0 120px -20px rgba(29, 155, 240, 0.08);
      }
      .gq-toast { background: rgba(255,255,255,0.96); color: #0f1419; }
      #gq-menu {
        box-shadow:
          0 8px 32px rgba(0, 0, 0, 0.12),
          0 0 60px -10px rgba(29, 155, 240, 0.1);
        border-color: var(--gq-border);
      }
    }
  `;
  document.head.appendChild(style);

  // ════════════════════════════════════════════════════════════════
  //  启动
  // ════════════════════════════════════════════════════════════════

  // 使用 MutationObserver 监听 DOM 变化（带节流）
  const observer = new MutationObserver(scheduleHijack);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // 初始执行（延迟等页面渲染完成）
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(hijackOperationsThrottled, 500));
  } else {
    setTimeout(hijackOperationsThrottled, 500);
  }

  // 滚动时也检查（处理懒加载的推文）
  let scrollTimer = null;
  window.addEventListener("scroll", () => {
    if (scrollTimer) return;
    scrollTimer = setTimeout(() => { scrollTimer = null; scheduleHijack(); }, 200);
  }, { passive: true });

  // 注册油猴菜单命令
  GM_registerMenuCommand("\u2699\uFE0F Grok Quick \u8BBE\u7F6E", openSettings);

  console.log("[Grok Quick] v2.0.0 loaded \u2014 Optimized by Flywind");
})();
