// ==UserScript==
// @name         X (Twitter) — Grok Quick
// @name:zh-CN   X (Twitter) — Grok 快捷分析
// @namespace    https://github.com/hahapkpk/tools
// @version      3.2.9
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/X%20(Twitter)%20%E2%80%94%20Grok%20Quick.user.js
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/X%20(Twitter)%20%E2%80%94%20Grok%20Quick.user.js
// @license      MIT
// @author       Flywind
// @icon         https://abs.twimg.com/favicons/twitter.3.ico
// @match        https://twitter.com/*
// @match        https://x.com/*
// @match        https://pro.x.com/*
// @match        https://mobile.twitter.com/*
// @match        https://m.x.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      discord.com
// @connect      api.telegram.org
// @run-at       document-idle
// @description  替换每条推文的 Grok 图标，点击后选择总结、解释、翻译或自定义提示词，并自动调出右下角 Grok 聊天窗口进入对话。兼容领哥脚本备注/重点关注数据，支持推送通知和私密模式。
// ==/UserScript==

(function () {
  "use strict";

  // ════════════════════════════════════════════════════════════════
  //  默认模板（多语言）
  // ════════════════════════════════════════════════════════════════
  const DEFAULT_TEMPLATES = {
    "zh-CN": {
      summary:   { label: "\u603B\u7ED3\u8FD9\u4E2A\u5E16\u5B50", icon: "\uD83D\uDCDD", prompt: "\u3010\u6307\u4EE4\uFF1A\u603B\u7ED3\u5E16\u5B50\u3011\n\u8BF7\u7528\u7B80\u6D01\u7684\u4E2D\u6587\u603B\u7ED3\u8FD9\u5219\u5E16\u5B50\u7684\u6838\u5FC3\u5185\u5BB9\uFF0C\u5305\u62EC\uFF1A1\uFF09\u4E3B\u8981\u4FE1\u606F\uFF1B2\uFF09\u4F5C\u8005\u60F3\u8868\u8FBE\u7684\u91CD\u70B9\uFF1B3\uFF09\u503C\u5F97\u5173\u6CE8\u7684\u80CC\u666F\u6216\u5F71\u54CD\u3002\n\n" },
      explain:   { label: "\u89E3\u91CA\u8FD9\u4E2A\u5E16\u5B50", icon: "\uD83D\uDCA1", prompt: "\u3010\u6307\u4EE4\uFF1A\u89E3\u91CA\u5E16\u5B50\u3011\n\u8BF7\u50CF\u7ED9\u4E00\u4E2A\u4E0D\u719F\u6089\u80CC\u666F\u7684\u4EBA\u8BB2\u89E3\u4E00\u6837\uFF0C\u89E3\u91CA\u8FD9\u5219\u5E16\u5B50\u5728\u8BF4\u4EC0\u4E48\u3001\u4E3A\u4EC0\u4E48\u6709\u4EBA\u5173\u6CE8\u3001\u5B83\u53EF\u80FD\u6D89\u53CA\u54EA\u4E9B\u6897\u3001\u4E8B\u4EF6\u6216\u884C\u4E1A\u80CC\u666F\u3002\n\n" },
      factcheck: { label: "\u4E8B\u5B9E\u6838\u67E5", icon: "\uD83D\uDC75\uFE0F", prompt: "\u3010\u6307\u4EE4\uFF1A\u8BF7\u8FDB\u884C\u4E8B\u5B9E\u6838\u67E5\u3011\n\u8BF7\u8BE6\u7EC6\u5206\u6790\u4EE5\u4E0B\u8FD9\u5219\u5E16\u5B50\u7684\u771F\u5B9E\u6027\uFF0C\u6307\u51FA\u53EF\u80FD\u7684\u9519\u8BEF\u3001\u8BEF\u5BFC\u6027\u4FE1\u606F\u6216\u7F3A\u4E4F\u8BC1\u636E\u7684\u5730\u65B9\uFF0C\u5E76\u63D0\u4F9B\u6B63\u786E\u7684\u80CC\u666F\u8109\u7EDC\uFF1A\n\n" },
      analysis:  { label: "\u6DF1\u5EA6\u5206\u6790", icon: "\uD83D\uDCCA", prompt: "\u3010\u6307\u4EE4\uFF1A\u6DF1\u5EA6\u5206\u6790\u3011\n\u8BF7\u62C5\u4EFB\u8D44\u6DF1\u7684\u793E\u7FA4\u89C2\u5BDF\u5BB6\uFF0C\u89E3\u6790\u8FD9\u5219\u63A8\u6587\u3002\u8BF7\u5206\u6790\u5176\u6F5C\u5728\u7684\u8BED\u6C14\u3001\u60C5\u7EEA\u5411\u3001\u76EE\u6807\u53D7\u4F17\uFF0C\u4EE5\u53CA\u53D1\u6587\u8005\u53EF\u80FD\u9690\u542B\u7684\u52A8\u673A\u6216\u7ACB\u573A\uFF1A\n\n" },
      translate: { label: "\u7FFB\u8BD1\u89E3\u91CA", icon: "\uD83C\uDF10", prompt: "\u3010\u6307\u4EE4\uFF1A\u7FFB\u8BD1\u4E0E\u89E3\u91CA\u3011\n\u8BF7\u5C06\u8FD9\u5219\u63A8\u6587\u7FFB\u8BD1\u6210\u901A\u987A\u3001\u5730\u9053\u7684\u7B80\u4F53\u4E2D\u6587\u3002\u5982\u679C\u5185\u5BB9\u5305\u542B\u7F51\u7EDC\u6D41\u884C\u8BED\u3001\u8FF7\uFF08Meme\uFF09\u6216\u6587\u5316\u6897\uFF0C\u8BF7\u52A1\u5FC5\u8865\u5145\u89E3\u91CA\u5176\u80CC\u666F\u542B\u4E49\uFF1A\n\n" },
      custom1:   { label: "\u81EA\u5B9A\u4E49 1", icon: "\u270F\uFE0F", prompt: "\uFF08\u8FD9\u662F\u53EF\u81EA\u5B9A\u4E49\u7684\u6A21\u5F0F\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u4FEE\u6539\u6807\u9898\u548C\u63D0\u793A\u8BCD\uFF09\n\n\u8BF7\u7528\u4E00\u6BB5\u8BDD\u7B80\u5355\u8BF4\u660E\u8FD9\u5219\u5E16\u5B50\u5728\u8BA8\u8BBA\u4EC0\u4E48\uFF0C\u4EE5\u53CA\u4E3A\u4EC0\u4E48\u503C\u5F97\u5173\u6CE8\uFF1A\n\n" },
      custom2:   { label: "\u81EA\u5B9A\u4E49 2", icon: "\u270F\uFE0F", prompt: "\uFF08\u8FD9\u662F\u53EF\u81EA\u5B9A\u4E49\u7684\u6A21\u5F0F\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u4E2D\u4FEE\u6539\u6807\u9898\u548C\u63D0\u793A\u8BCD\uFF09\n\n\u8BF7\u9488\u5BF9\u8FD9\u5219\u5E16\u5B50\uFF0C\u63D0\u51FA\u4F60\u8BA4\u4E3A\u6700\u6709\u8DA3\u6216\u503C\u5F97\u6DF1\u5165\u63A2\u8BA8\u7684\u95EE\u9898\uFF1A\n\n" },
    },
    en: {
      summary:   { label: "Summarize Post", icon: "\uD83D\uDCDD", prompt: "[Instruction: Summarize Post]\nSummarize this post clearly and briefly. Include: 1) the main point; 2) what the author is emphasizing; 3) any background or implications worth knowing.\n\n" },
      explain:   { label: "Explain Post", icon: "\uD83D\uDCA1", prompt: "[Instruction: Explain Post]\nExplain this post for someone who does not know the context. Cover what it means, why people may care, and any memes, events, industry context, or hidden references involved.\n\n" },
      factcheck: { label: "Fact Check", icon: "\uD83D\uDC75\uFE0F", prompt: "[Instruction: Fact Check]\nPlease conduct a detailed fact-check on the following tweet. Point out potential errors, misleading information, or lack of evidence, and provide the correct context:\n\n" },
      analysis:  { label: "Deep Analysis", icon: "\uD83D\uDCCA", prompt: "[Instruction: Deep Analysis]\nAct as a social media observer. Analyze this tweet for its tone, emotional direction, target audience, and any implied motives or stances of the author:\n\n" },
      translate: { label: "Translate", icon: "\uD83C\uDF10", prompt: "[Instruction: Translate]\nPlease translate this tweet into fluent English. If it contains internet slang, memes, or cultural references, please explain their background meaning:\n\n" },
      custom1:   { label: "Custom 1", icon: "\u270F\uFE0F", prompt: "(This is a customizable mode. Edit the label and prompt in Settings.)\n\nIn one paragraph, briefly explain what this tweet is discussing and why it matters:\n\n" },
      custom2:   { label: "Custom 2", icon: "\u270F\uFE0F", prompt: "(This is a customizable mode. Edit the label and prompt in Settings.)\n\nWhat is the most interesting or thought-provoking question raised by this tweet?\n\n" },
    },
    ja: {
      summary:   { label: "\u6295\u7A3F\u3092\u8981\u7D04", icon: "\uD83D\uDCDD", prompt: "\u3010\u6307\u4EE4\uFF1A\u6295\u7A3F\u306E\u8981\u7D04\u3011\n\u3053\u306E\u6295\u7A3F\u306E\u8981\u70B9\u3092\u7C21\u6F54\u306B\u8981\u7D04\u3057\u3066\u304F\u3060\u3055\u3044\u30021\uFF09\u4E3B\u8981\u306A\u30E1\u30C3\u30BB\u30FC\u30B8\u30012\uFF09\u6295\u7A3F\u8005\u304C\u5F37\u8ABF\u3057\u305F\u3044\u70B9\u30013\uFF09\u77E5\u3063\u3066\u304A\u304F\u3079\u304D\u80CC\u666F\u3084\u5F71\u97FF\u3092\u542B\u3081\u3066\u304F\u3060\u3055\u3044\u3002\n\n" },
      explain:   { label: "\u6295\u7A3F\u3092\u89E3\u8AAC", icon: "\uD83D\uDCA1", prompt: "\u3010\u6307\u4EE4\uFF1A\u6295\u7A3F\u306E\u89E3\u8AAC\u3011\n\u80CC\u666F\u3092\u77E5\u3089\u306A\u3044\u4EBA\u306B\u8AAC\u660E\u3059\u308B\u3088\u3046\u306B\u3001\u3053\u306E\u6295\u7A3F\u306E\u610F\u5473\u3001\u6CE8\u76EE\u3055\u308C\u308B\u7406\u7531\u3001\u95A2\u9023\u3059\u308B\u30DF\u30FC\u30E0\u3001\u4E8B\u4EF6\u3001\u696D\u754C\u80CC\u666F\u3001\u96A0\u308C\u305F\u53C2\u7167\u3092\u89E3\u8AAC\u3057\u3066\u304F\u3060\u3055\u3044\u3002\n\n" },
      factcheck: { label: "\u30D5\u30A1\u30AF\u30C8\u30C1\u30A7\u30C3\u30AF", icon: "\uD83D\uDC75\uFE0F", prompt: "\u3010\u6307\u4EE4\uFF1A\u30D5\u30A1\u30AF\u30C8\u30C1\u30A7\u30C3\u30AF\u3011\n\u4EE5\u4E0B\u306E\u6295\u7A3F\u306E\u771F\u507D\u3092\u8A73\u7D30\u306B\u5206\u6790\u3057\u3001\u8AA4\u308A\u3084\u8AA4\u89E3\u3092\u62DB\u304D\u60C5\u5831\u306E\u4E0D\u8DB3\u70B9\u3092\u6307\u6458\u3057\u3001\u6B63\u3057\u3044\u80CC\u666F\u60C5\u5831\u3092\u63D0\u4F9B\u3057\u3066\u304F\u3060\u3055\uFF1A\n\n" },
      analysis:  { label: "\u8A73\u7D30\u5206\u6790", icon: "\uD83D\uDCCA", prompt: "\u3010\u6307\u4EE4\uFF1A\u8A73\u7D30\u5206\u6790\u3011\n\u30BD\u30FC\u30B7\u30E3\u30EB\u30E1\u30C7\u30A3\u30A2\u306E\u89B3\u5BDF\u8005E30683068\u3057\u3066\u3001\u3053\u306E\u30C4\u30A4\u30FC\u30C8\u3092\u5206\u6790\u3057\u3066\u304F\u3060\u3055\u3002\u6F5C\u5728\u7684\u30C8\u30FC\u30F3\u3001\u611F\u60C5\u306E\u65B9\u5411\u6027\u3001\u30BF\u30FC\u30B2\u30C3\u30C8\u5C64\u3001\u304A\u3088\u3073\u6295\u7A3F\u8005\u306E\u96A0\u853B\u3055\u308C\u305F\u52D5\u6A5F\u3084\u7ACB\u573A\u3092\u89E3\u6790\u3057\u3066\u304F\u3060\u3055\uFF1A\n\n" },
      translate: { label: "\u7FFB\u8A33\u3068\u89E3\u8AAC", icon: "\uD83C\uDF10", prompt: "\u3010\u6307\u4EE4\uFF1A\u7FFB\u8A33\u3068\u89E3\u8AAC\u3011\n\u3053\u306E\u30C4\u30A4\u30FC\u30C8\u3092\u81EA\u7136\u3067\u6D41\u66A5\u306A\u65E5\u672C\u8A9E\u306B\u7FFB\u8A33\u3057\u3066\u304F\u3060\u3055\u3002\u30CD\u30C3\u30C8\u30B9\u30E9\u30F3\u30B0\u3001\u30DF\u30FC\u30E0\uFF08Meme\uFF09\u307E\u3057\u306F\u6587\u5316\u7684\u30D0\u30C3\u30AF\u30B0\u30E9\u30A6\u30F3\u30C9\u304C\u542B\u307E\u308C\u3066\u3044\u308B\u5834\u5408\u306F\u3001\u305D\u306E\u610F\u5473\u3084\u80CC\u666F\u3082\u5FC5\u305A\u8865\u5145\u8AAC\u660E\u3057\u3066\u304F\u3060\u3055\uFF1A\n\n" },
      custom1:   { label: "\u30AB\u30B9\u30BF\u30E0 1", icon: "\u270F\uFE0F", prompt: "\uFF08\u30AB\u30B9\u30BF\u30DE\u30A4\u30BA\u53EF\u80FD\u306A\u30E2\u30FC\u30C9\u3067\u3059\u3002\u8A2D\u5B9A\u3067\u30BF\u30A4\u30C8\u30EB\u3068\u30D7\u30ED\u30F3\u30D7\u30C8\u3092\u5909\u66F4\u3057\u3066\u304F\u3060\u3055\uFF09\n\n\u3053\u306E\u30C4\u30A4\u30FC\u30C8\u304C\u4F55\u3092\u8AD6\u8AD6\u3057\u3066\u3044\u308B\u306E\u304B\u3001\u3069\u3064\u3051\u6CE8\u76EE\u3059\u3079\u304D\u308B\u306E\u304B\u30011\u6BB5\u843D\u3067\u7C21\u5358\u306B\u8AAC\u660E\u3057\u3066\u304F\u3060\u3055\uFF1A\n\n" },
      custom2:   { label: "\u30AB\u30B9\u30BF\u30E0 2", icon: "\u270F\uFE0F", prompt: "\uFF08\u30AB\u30B9\u30BF\u30DE\u30A4\u30BA\u53EF\u80FD\u306A\u30E2\u30FC\u30C9\u3067\u3059\u3002\u8A2D\u5B9A\u3067\u30BF\u30A4\u30C8\u30EB\u3068\u30D7\u30ED\u30F3\u30D7\u30C8\u3092\u5909\u66F4\u3057\u3066\u304F\u3060\u3055\uFF09\n\n\u3053\u306E\u30C4\u30A4\u30FC\u30C8\u3067\u6700\u3082\u8208\u5473\u6DF1\u3044\u3001\u307E\u305F\u8003\u3048\u3055\u3089\u308C\u308B\u70B9\u306F\u4F55\u3067\u3059\u304B\uFF1F\n\n" },
    },
  };

  // 扩展自定义槽位（v3.1 保留 5 个自定义槽位并兼容 Commander 习惯）
  const EXTRA_CUSTOM_DEFAULTS = {
    custom3: { label: "\u81EA\u5B9A\u4E49 3", icon: "\u270F\uFE0F", prompt: "\u8BF7\u4ECE\u6279\u5224\u6027\u601D\u7EF4\u89D2\u5EA6\u8BC4\u4F30\u8FD9\u6761\u63A8\u6587\uFF1A\n\n" },
    custom4: { label: "\u81EA\u5B9A\u4E49 4", icon: "\u270F\uFE0F", prompt: "\u8BF7\u603B\u7ED3\u8FD9\u6761\u63A8\u6587\u7684\u6838\u5FC3\u4FE1\u606F\uFF0C\u5E76\u7ED9\u51FA\u4F60\u7684\u770B\u6CD5\uFF1A\n\n" },
    custom5: { label: "\u81EA\u5B9A\u4E49 5", icon: "\u270F\uFE0F", prompt: "\u8BF7\u5206\u6790\u8FD9\u6761\u63A8\u658F\u53EF\u80FD\u5F15\u53D1\u7684\u793E\u4F1A\u5F71\u54CD\uFF1A\n\n" },
  };

  // 合并所有默认模板
  function getMergedDefaults(lang) {
    const base = DEFAULT_TEMPLATES[lang] || DEFAULT_TEMPLATES["zh-CN"] || DEFAULT_TEMPLATES.en;
    return { ...base, ...EXTRA_CUSTOM_DEFAULTS };
  }

  const TEMPLATE_KEYS = ["summary", "explain", "translate", "factcheck", "analysis", "custom1", "custom2", "custom3", "custom4", "custom5"];

  // ════════════════════════════════════════════════════════════════
  //  多语言 UI 字典（精简版，核心语言）
  // ════════════════════════════════════════════════════════════════
  const I18N = {
    "zh-CN": {
      settings_title: "\u2699\uFE0F Grok Quick \u8BBE\u7F6E",
      lang_label: "\u8BED\u8A00",
      lang_auto: "\u81EA\u52A8\u68C0\u6D4B",
      send_mode_label: "\u53D1\u9001\u6A21\u5F0F",
      send_manual: "\uD83D\uDEE1\uFE0F \u624B\u52A8",
      send_auto: "\uD83D\uDE80 \u81EA\u52A8",
      btn_cancel: "\u53D6\u6D88",
      btn_save: "\u4FDD\u5B58",
      alert_saved: "\u2705 \u8BBE\u7F6E\u5DF2\u4FDD\u5B58",
      alert_no_grok: "\u26A0\uFE0F \u627E\u4E0D\u5230\u5168\u5C40 Grok \u6309\u94AE",
      need_reopen: "\u8BF7\u5148\u70B9\u51FB\u53F3\u4E0B\u89D2 Grok \u6309\u94AE\u6253\u5F00\u4FA7\u8FB9\u680F",
      push_section: "\u1F4E8 \u63A8\u9001\u8BBE\u7F6E",
      push_discord: "Discord",
      push_telegram: "Telegram",
      push_add: "+ \u65B0\u589E",
      push_test: "\u6D4B\u8BD5\u53D1\u9001",
      push_test_sending: "\u53D1\u9001\u4E2D\u2026",
      push_not_configured: "\u5C1A\u914D\u7F6E\u63A8\u9001\u76EE\u6807",
      push_result_ok: "\u2705 \u63A8\u9001\u6210\u529F",
      push_result_fail: "\u274C \u63A8\u9001\u5931\u8D25",
      push_url_format: "\u94FE\u63A5\u8F6C\u6362\u683C\u5F0F",
      private_mode: "\uD83D\uDD12 \u79C1\u5BC6\u6A21\u5F0F",
    },
    en: {
      settings_title: "\u2699\uFE0F Grok Quick Settings",
      lang_label: "Language",
      lang_auto: "Auto Detect",
      send_mode_label: "Send Mode",
      send_manual: "\uD83D\uDEE1\uFE0F Manual",
      send_auto: "\uD83D\uDE80 Auto Send",
      btn_cancel: "Cancel",
      btn_save: "Save",
      alert_saved: "\u2705 Settings saved!",
      alert_no_grok: "\u26A0\uFE0F Global Grok button not found.",
      need_reopen: "Click the bottom-right Grok button first to open sidebar",
      push_section: "\u1F4E8 Push Settings",
      push_discord: "Discord",
      push_telegram: "Telegram",
      push_add: "+ Add",
      push_test: "Test",
      push_test_sending: "Sending\u2026",
      push_not_configured: "No push targets configured",
      push_result_ok: "\u2705 Push sent",
      push_result_fail: "\u274C Push failed",
      push_url_format: "URL Converter",
      private_mode: "\uD83D\uDD12 Private Mode",
    },
    ja: {
      settings_title: "\u2699\uFE0F Grok Quick \u8A2D\u5B9A",
      lang_label: "\u8A00\u8A9E",
      lang_auto: "\u81EA\u52D8\u691C\u51FA",
      send_mode_label: "\u9001\u4FE1\u30E2\u30FC\u30C9",
      send_manual: "\uD83D\uDEE1\uFE0F \u624B\u52D8",
      send_auto: "\uD83D\uDE80 \u81EA\u52D8",
      btn_cancel: "\u30AD\u30E3\u30F3\u30BB\u30EB",
      btn_save: "\u4FDD\u5B58",
      alert_saved: "\u2705 \u8A2D\u5B9A\u3092\u4FDD\u5B58\u3057\u307E\u3057\u305F!",
      alert_no_grok: "\u26A0\uFE0F \u30B0\u30ED\u30FC\u30D0\u30EB Grok \u30DC\u30BF\u30F3\u304C\u8981\u308A\u307E\u305B\u3093\u3002",
      need_reopen: "\u53F3\u4E0B\u306E Grok \u30DC\u30BF\u30F3\u3092\u30AF\u30EA\u30C3\u30AF\u3057\u3066\u30B5\u30A4\u30C9\u30D0\u30FC\u3092\u958B\u3044\u3066\u304F\u3060\u3055",
      push_section: "\u1F4E8 \u30D7\u30C3\u30B7\uE5300\u8A2D\u5B9A",
      push_discord: "Discord",
      push_telegram: "Telegram",
      push_add: "+ \u8FFD\u52A0",
      push_test: "\u30C6\u30B9\u30C8",
      push_test_sending: "\u9001\u4FE1\u4E2D\u2026",
      push_not_configured: "\u30D7\u30C3\u30B7\u5148\u304C\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093",
      push_result_ok: "\u2705 \u9001\u4FE1\u6210\u529F",
      push_result_fail: "\u274C \u9001\u4FE1\u5931\u6557",
      push_url_format: "URL \u5909\u63DB",
      private_mode: "\uD83D\uDD12 \u30D7\u30E9\u30A4\u30D9\u30FC\u30C8\u30E2\u30FC\u30C9",
    },
  };

  function t(key) {
    const lang = currentLang();
    return (I18N[lang] && I18N[lang][key]) || (I18N["zh-CN"] && I18N["zh-CN"][key]) || key;
  }

  function currentLang() {
    try { return GM_getValue("gq_lang", "auto"); }
    catch { return "auto"; }
  }

  function resolveLang(val) {
    if (val === "auto") {
      // 简单的语言检测
      const navLangs = navigator.languages || [navigator.language || "en"];
      for (const l of navLangs) {
        const code = l.split("-")[0];
        if (DEFAULT_TEMPLATES[code] || DEFAULT_TEMPLATES[l]) return l;
        // 映射
        const map = { zh: "zh-CN", "zh-TW": "zh-CN", "zh-Hans": "zh-CN", "zh-Hant": "zh-CN" };
        if (map[l]) return map[l];
        if (map[code]) return map[code];
      }
      return "en";
    }
    return val;
  }

  // ════════════════════════════════════════════════════════════════
  //  常量
  // ════════════════════════════════════════════════════════════════
  const GROK_PATH_PATTERNS = [
    "M14.2 5.6c-.3-.7-1.1-1-1.8-.7l-8.7 3.7c-.7.3-1 1.1-.7 1.8l.1.3c.2.4.5.7.9.8l2.5.6",
    "M16.7 5.5c-.4-.6-1.2-.8-1.8-.4L6.4 10c-.6.4-.8 1.2-.4 1.8",
    "M12.745 20.54",
    "M2.5 12C2.5 6.75",
    "M12 2C6.48 2",
  ];

  const SEND_BTN_LABELS = [
    "\u53D1\u5E03","Post","Reply","\u56DE\u590D","Send","\u53D1\u9001",
    "Publicar","Enviar","Publier","Envoyer",
    "\uBCF4\uB0B8\uAE30","\uAC8C\uC2DC\uD558\uAE30",
    "\u554F GroK \u4E00\u4E9B\u95EE\u9898",
    "\u53D1\u9001","\u9001\u51FA",
    "\u5411 Grok \u63D0\u95EE",
    "Grok something","Send post","Ask Grok",
    "Grok\u306B\u8cea\u554F",
    "\u30DD\u30B9\u30B9\u3059\u308B","\u9001\u4FE1","\u8FD4\u4FE1",
    "Publicar","Preguntarle a Grok","Responder",
    "Postar","Perguntar ao Grok","Publier",
    "Demander \u00E0 Grok","R\u00E9pondre",
  ];

  const BLACKLIST_LABELS = [
    "image","picture","generate","draw","create",
    "\u56FE\u7247","\u5F71\u50CF","\u751F\u6210","\u7E6B\u5236","\u88FD\u4F5C","\u7167\u7247",
    "\u753B\u50CF","\u751F\u6210","\u753B\u50CF","\u751F\u6210",
    "\uC774\uBBF8\uC9C0","\uC0DD\uC131",
  ];

  const SEND_SVG_FINGERPRINT =
    "M2.504 21.866l.526-2.108C3.04 19.756 4 15.015 4 12s-.96-7.756-.97-7.757l-.527-2.109L21.5 12 2.504 21.866zM5.981 13c-.072 1.962-.34 3.806-.583 5.183L17.764 12 5.398 5.818c.242 1.376.51 3.22.583 5.182H10v2H5.981z";

  const URL_CONVERTER_DOMAINS = ["vxtwitter.com","fixupx.com","fxtwitter.com","cunnyx.com","fixvx.com","twitter.com","x.com"];

  const INJECT_MAX_ATTEMPTS = 100;
  const INJECT_INTERVAL_MS = 80;

  let _activeTimer = null;
  let _pendingTask = null;
  const _hijackedButtons = new WeakSet();
  const _nativeClickBypass = new WeakSet();
  let _hijackScheduled = false;

  // ════════════════════════════════════════════════════════════════
  //  配置读写
  // ════════════════════════════════════════════════════════════════
  function loadConfig() {
    try {
      const raw = GM_getValue("gq_config_v3", null);
      const saved = raw ? JSON.parse(raw) : {};
      const langCode = resolveLang(saved.lang || "auto");
      const defaults = getMergedDefaults(langCode);
      const cfg = {};
      TEMPLATE_KEYS.forEach(k => { cfg[k] = { ...defaults[k], ...(saved[k] || {}) }; });
      cfg.autoSend = saved.autoSend ?? false;
      cfg.privateMode = saved.privateMode ?? false;
      cfg.lang = saved.lang || "auto";
      cfg.templateOrder = Array.isArray(saved.templateOrder) ? saved.templateOrder : null;
      return cfg;
    } catch (e) {
      console.warn("[Grok Quick] Config load error:", e);
      const defaults = getMergedDefaults(resolveLang("auto"));
      return { ...defaults, autoSend: false, privateMode: false, lang: "auto" };
    }
  }

  function saveConfig(cfg) {
    try {
      // 只保存需要持久化的字段
      const toSave = { autoSend: cfg.autoSend, privateMode: cfg.privateMode, lang: cfg.lang };
      TEMPLATE_KEYS.forEach(k => { toSave[k] = { label: cfg[k]?.label, prompt: cfg[k]?.prompt }; });
      if (Array.isArray(cfg.templateOrder)) toSave.templateOrder = cfg.templateOrder;
      GM_setValue("gq_config_v3", JSON.stringify(toSave));
    } catch (e) {
      console.warn("[Grok Quick] Config save error:", e);
    }
  }

  // ─── 推送配置 ──
  function loadPushConfig() {
    try {
      const raw = JSON.parse(GM_getValue("gq_push_config", "{}"));
      return normalizePushConfig(raw);
    } catch { return { discord: [], telegram: [], skipConfirm: false, urlConverter: "x.com" }; }
  }

  function savePushConfig(cfg) { GM_setValue("gq_push_config", JSON.stringify(cfg)); }

  function normalizePushConfig(raw) {
    const cfg = raw && typeof raw === "object" ? raw : {};
    return {
      discord: Array.isArray(cfg.discord) ? cfg.discord : [],
      telegram: Array.isArray(cfg.telegram) ? cfg.telegram : [],
      skipConfirm: !!cfg.skipConfirm,
      urlConverter: URL_CONVERTER_DOMAINS.includes(cfg.urlConverter) ? cfg.urlConverter : "x.com",
    };
  }

  // ════════════════════════════════════════════════════════════════
  //  工具函数
  // ════════════════════════════════════════════════════════════════
  function resetGlobalState() {
    if (_activeTimer) { clearTimeout(_activeTimer); _activeTimer = null; }
    _pendingTask = null;
  }

  function isGrokIcon(el) {
    if (!el || el.tagName !== "PATH") return false;
    const d = el.getAttribute("d");
    if (!d) return false;
    if (GROK_PATH_PATTERNS.some(p => d.startsWith(p))) return true;
    const parentBtn = el.closest("button,[role='button']");
    if (parentBtn && isLikelyGrokButton(parentBtn)) return true;
    return false;
  }

  function isLikelyGrokButton(el) {
    if (!el || el.classList?.contains("gq-btn")) return false;
    const label = [
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.getAttribute("data-testid"),
      el.textContent,
    ].filter(Boolean).join(" ").toLowerCase();
    if (/\bgrok\b/.test(label) || label.includes("\u95EE grok") || label.includes("\u5411 grok") || label.includes("\u64CD\u4F5C")) return true;
    return [...el.querySelectorAll("path")].some(path => {
      const d = path.getAttribute("d") || "";
      return GROK_PATH_PATTERNS.some(p => d.startsWith(p));
    });
  }

  function triggerClick(el) {
    if (!el) return;
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
    el.click();
  }

  function simulateEnterKey(el) {
    ["keydown","keypress","keyup"].forEach(type => {
      el.dispatchEvent(new KeyboardEvent(type, { key:"Enter", code:"Enter", keyCode:13, which:13, bubbles:true, cancelable:true }));
    });
  }

  function setComposerValue(el, value) {
    if (!el) return;
    const tag = el.tagName?.toLowerCase();
    if (tag === "textarea" || tag === "input") {
      const proto = tag === "textarea" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (nativeSetter) nativeSetter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand("insertText", false, value)) {
      el.textContent = value;
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function findGlobalGrokButton() {
    // 仅在 button/role=button 里找（不用 <a href="/i/grok">，那是全页导航会离开当前页）
    for (const btn of document.querySelectorAll("[data-testid='primaryColumn'] button,[data-testid='sidebarColumn'] button,button[aria-label],[role='button'][aria-label]")) {
      if (btn.closest("article") || btn.classList.contains("gq-btn") || btn.offsetParent === null) continue;
      if (isLikelyGrokButton(btn)) return btn;
    }
    return null;
  }

  function getVisibleComposer() {
    const active = document.activeElement;
    if (isUsableComposer(active)) return active;

    const selectors = [
      "textarea[aria-label*='Grok' i]",
      "textarea[placeholder*='Grok' i]",
      "textarea[data-testid*='grok' i]",
      "[contenteditable='true'][aria-label*='Grok' i]",
      "[contenteditable='true'][data-testid*='grok' i]",
      "[role='textbox'][aria-label*='Grok' i]",
      "[role='textbox'][contenteditable='true']",
      "div[contenteditable='true']",
      "textarea[data-testid='tweetTextarea_0']",
      "textarea",
    ];
    for (const el of document.querySelectorAll(selectors.join(","))) {
      if (isUsableComposer(el)) return el;
    }
    return null;
  }

  function isUsableComposer(el) {
    if (!el || !(el instanceof HTMLElement)) return false;
    const tag = el.tagName.toLowerCase();
    const editable = el.isContentEditable || tag === "textarea" || tag === "input" || el.getAttribute("role") === "textbox";
    if (!editable || el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 10) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    if (el.closest("#gq-menu,#gq-settings-overlay,#gq-push-overlay")) return false;
    return true;
  }

  function isTweetComposer(el) {
    if (!el) return false;
    const testId = el.getAttribute("data-testid") || "";
    if (/tweetTextarea|tweetcomposer/i.test(testId)) return true;
    const label = (el.getAttribute("aria-label") || "").toLowerCase();
    return /post|tweet|reply|帖子|推文|回复/.test(label);
  }

  function extractTweetData(article) {
    if (!article) return { text: "", url: location.href, author: "", handle: "", displayName: "", note: "", vip: null, time: "" };
    const textEl = article.querySelector("[data-testid='tweetText']");
    const userBlock = article.querySelector("[data-testid='User-Name']");
    const userLink = findAuthorLink(article);
    const handle = normalizeHandle(userLink?.getAttribute("href") || "");
    const url = getTweetUrl(article);
    const profile = getLingProfileInfo(handle);
    const timeEl = article.querySelector("time");
    return {
      text: cleanText(textEl ? textEl.innerText : getFallbackTweetText(article)),
      url,
      author: handle ? `@${handle}` : "",
      handle,
      displayName: getDisplayName(userBlock, handle),
      note: profile.note,
      vip: profile.vip,
      time: timeEl?.getAttribute("datetime") || "",
    };
  }

  function normalizeHandle(value) {
    if (!value) return "";
    let clean = String(value).trim();
    clean = clean.replace(/^(https?:\/\/)?(www\.)?(twitter\.com|x\.com|pro\.x\.com|mobile\.twitter\.com|m\.x\.com)\//i, "");
    clean = clean.replace(/^\/+/, "").split(/[/?#]/)[0].replace(/^@/, "");
    const systemPaths = new Set(["home","explore","notifications","messages","status","hashtag","search","settings","i","intent","compose"]);
    if (!clean || systemPaths.has(clean.toLowerCase())) return "";
    return clean;
  }

  function findAuthorLink(article) {
    const links = [
      ...article.querySelectorAll("[data-testid='User-Name'] a[href^='/'], [data-testid='User-Name'] a[href*='x.com/'], a[role='link'][href^='/']")
    ];
    return links.find(link => {
      const handle = normalizeHandle(link.getAttribute("href"));
      return handle && !/\d{8,}/.test(handle);
    }) || null;
  }

  function getTweetUrl(article) {
    const timeLink = article.querySelector("time")?.closest("a[href*='/status/']");
    const statusLink = timeLink || [...article.querySelectorAll("a[href*='/status/']")].find(a => /\d{8,}/.test(a.getAttribute("href") || ""));
    if (!statusLink) return location.href;
    try { return new URL(statusLink.getAttribute("href"), location.origin).href; }
    catch { return location.href; }
  }

  function getDisplayName(userBlock, handle) {
    if (!userBlock) return "";
    const lines = cleanText(userBlock.innerText).split("\n").map(s => s.trim()).filter(Boolean);
    return lines.find(line => !line.startsWith("@") && line.toLowerCase() !== handle.toLowerCase()) || "";
  }

  function cleanText(value) {
    return String(value || "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function getFallbackTweetText(article) {
    const ignored = new Set(["Reply","Repost","Like","View","Share","Post","Translate post"]);
    return [...article.querySelectorAll("div[lang], span")]
      .map(el => el.innerText || el.textContent || "")
      .map(cleanText)
      .filter(text => text && !ignored.has(text) && !/^@\w+$/.test(text))
      .slice(0, 8)
      .join("\n");
  }

  function getLingProfileInfo(handle) {
    if (!handle) return { note: "", vip: null };
    const key = handle.toLowerCase();
    const note = readLingNote(key);
    const vip = readLingVip(key);
    return { note, vip };
  }

  function readLingNote(handle) {
    const candidates = ["ling_user_notes", "ling_notes", "twitter_notes", "x_user_notes"];
    for (const key of candidates) {
      try {
        const raw = GM_getValue(key, null);
        if (!raw) continue;
        const data = typeof raw === "string" ? JSON.parse(raw) : raw;
        const value = data?.[handle] || data?.[`@${handle}`];
        if (typeof value === "string") return value;
        if (value?.note) return String(value.note);
      } catch {}
    }
    return "";
  }

  function readLingVip(handle) {
    try {
      const raw = GM_getValue("ling_vips", null);
      if (!raw) return null;
      const data = typeof raw === "string" ? JSON.parse(raw) : raw;
      const value = data?.[handle] || data?.[`@${handle}`];
      if (!value) return null;
      if (Array.isArray(value)) return { label: value[0] || "重点关注", raw: value };
      if (typeof value === "string") return { label: value, raw: value };
      return { label: value.label || value.name || "重点关注", raw: value };
    } catch { return null; }
  }

  function buildTweetMeta(tweetData) {
    const lines = [];
    lines.push(`[推文链接]: ${tweetData.url || location.href}`);
    if (tweetData.displayName || tweetData.author) lines.push(`[推文作者]: ${[tweetData.displayName, tweetData.author].filter(Boolean).join(" ")}`);
    if (tweetData.time) lines.push(`[发布时间]: ${tweetData.time}`);
    if (tweetData.note) lines.push(`[本地备注]: ${tweetData.note}`);
    if (tweetData.vip?.label) lines.push(`[重点关注]: ${tweetData.vip.label}`);
    lines.push(`[推文内容]: ${tweetData.text || "(未提取到正文)"}`);
    return lines.join("\n");
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function convertTweetUrl(url, domain) {
    if (!domain) return url;
    try { return url.replace(/^(https?:\/\/)(www\.)?(x\.com|twitter\.com|pro\.x\.com|mobile\.twitter\.com|m\.x\.com)/i, `$1${domain}`); }
    catch { return url; }
  }

  // ════════════════════════════════════════════════════════════════
  //  执行引擎
  // ════════════════════════════════════════════════════════════════
  function executeCommand(prompt, tweetData) {
    const cfg = loadConfig();
    const fullContent = `${prompt}\n${buildTweetMeta(tweetData)}`;

    resetGlobalState();
    _pendingTask = { content: fullContent, autoSend: cfg.autoSend === true, textFilled: false, targetInput: null };

    if (cfg.privateMode) {
      const encoded = encodeURIComponent(fullContent.slice(0, 2000));
      window.open(`https://x.com/i/grok?q=${encoded}`, "_blank");
      showToast("\uD83D\uDD12 " + t("private_mode"));
      return;
    }

    // 优先尝试已存在的 composer
    const existingComposer = getVisibleComposer();
    if (existingComposer) {
      // 明确识别为 Grok 表面：直接注入
      if (isLikelyGrokSurface(existingComposer)) {
        startInjectionDirect(existingComposer);
        return;
      }
      // X.com 用 React portal 渲染 Grok textarea，不在 sidebarColumn DOM 树内。
      // 只要不是推文/回复框，视为 Grok 的游离 composer 直接注入，
      // 避免重复触发原生 Grok 按钮导致侧边栏重置为默认 UI。
      if (!isTweetComposer(existingComposer)) {
        startInjectionDirect(existingComposer);
        return;
      }
    }

    // 未找到可用 composer：用推文专属按钮打开侧边栏，startInjection 会先停掉原生分析再注入
    const sourceBtn = tweetData?.sourceGrokButton;
    if (sourceBtn && sourceBtn.isConnected) { triggerNativeGrokButton(sourceBtn); startInjection(); return; }
    const globalBtn = findGlobalGrokButton();
    if (globalBtn) { triggerClick(globalBtn); startInjection(); return; }
    showToast(t("alert_no_grok"));
  }

  function triggerNativeGrokButton(btn) {
    _nativeClickBypass.add(btn);
    triggerClick(btn);
    setTimeout(() => _nativeClickBypass.delete(btn), 500);
  }

  function isLikelyGrokSurface(el) {
    const surface = el.closest("[aria-label*='Grok' i],[data-testid*='grok' i],[role='dialog'],aside,[data-testid='sidebarColumn']");
    if (!surface) return false;
    const text = [
      surface.getAttribute("aria-label"),
      surface.getAttribute("data-testid"),
      surface.textContent,
    ].filter(Boolean).join(" ").toLowerCase();
    return text.includes("grok") || text.includes("\u95EE grok") || text.includes("\u5411 grok");
  }

  async function startInjectionDirect(targetInput) {
    const task = _pendingTask;
    if (!task || !isUsableComposer(targetInput)) { showToast(t("need_reopen")); return; }
    try {
      setComposerValue(targetInput, "");
      await sleep(50);
      setComposerValue(targetInput, task.content);
      targetInput.focus();
      task.textFilled = true; task.targetInput = targetInput;
      await sleep(150);
      if (task.autoSend) doSend(targetInput); else resetGlobalState();
    } catch (err) {
      console.error("[Grok Quick]", err); showToast("\u26A0\uFE0F Injection error"); resetGlobalState();
    }
  }

  async function startInjection() {
    const task = _pendingTask; if (!task) return;

    // 阶段 1：等侧边栏打开后，尝试停止原生分析 / 新建对话（最多等 2s）
    for (let i = 0; i < 25; i++) {
      await sleep(80);
      if (!_pendingTask) return;
      if (startNewGrokConversation()) { await sleep(600); break; }
      if (stopGrokGeneration()) { await sleep(400); break; }
    }

    // 阶段 2：轮询等待 textarea 可用，再注入
    let attempts = 0;
    while (attempts < INJECT_MAX_ATTEMPTS) {
      if (!_pendingTask) return;
      attempts++;
      const composer = getVisibleComposer();
      if (composer && (isLikelyGrokSurface(composer) || (!isTweetComposer(composer) && attempts > 10))) {
        startInjectionDirect(composer); return;
      }
      await sleep(INJECT_INTERVAL_MS);
    }
    showToast(t("alert_no_grok")); resetGlobalState();
  }

  function doSend(ta) {
    simulateEnterKey(ta);
    setTimeout(() => {
      const btn = findSendButton();
      if (btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true") {
        triggerClick(btn);
        setTimeout(() => { if (_pendingTask?.targetInput) setComposerValue(_pendingTask.targetInput, ""); resetGlobalState(); }, 500);
      } else resetGlobalState();
    }, 200);
  }

  function stopGrokGeneration() {
    // 经 DOM 确认：X.com Grok 停止按钮 aria-label="取消"，SVG 为圆角矩形
    const STOP_RE = /^取消$|^cancel$|\bstop\b|停止生成/i;
    const STOP_PATH = "M3 5.5C3 4.12 4.12 3 5.5 3h13C19.88";
    for (const btn of document.querySelectorAll("button,[role='button']")) {
      if (btn.offsetParent === null) continue;
      if (btn.closest("article,.gq-btn,#gq-menu,#gq-settings-overlay,#gq-push-overlay")) continue;
      const label = btn.getAttribute("aria-label") || "";
      if (STOP_RE.test(label.trim())) {
        console.log("[GQ] stopGrokGeneration hit:", label);
        triggerClick(btn); return true;
      }
      // SVG 指纹兜底（圆角矩形 = ■）
      const p = btn.querySelector("path");
      if (p && (p.getAttribute("d") || "").startsWith(STOP_PATH)) {
        console.log("[GQ] stopGrokGeneration SVG hit");
        triggerClick(btn); return true;
      }
    }
    return false;
  }

  function startNewGrokConversation() {
    // 经 DOM 确认：X.com Grok 新建对话按钮 aria-label="新聊天"
    // Grok 以 React portal 渲染，需全文档搜索
    for (const btn of document.querySelectorAll("button,[role='button']")) {
      if (btn.offsetParent === null || btn.closest("article,.gq-btn,#gq-menu")) continue;
      const label = btn.getAttribute("aria-label") || "";
      if (/^新聊天$|^new chat$/i.test(label.trim())) {
        console.log("[GQ] startNewGrokConversation: 新聊天 clicked");
        triggerClick(btn); return true;
      }
    }
    return false;
  }

  function findSendButton() {
    for (const btn of document.querySelectorAll("button[aria-label], button[data-testid]")) {
      const label = btn.getAttribute("aria-label") || "";
      if (BLACKLIST_LABELS.some(b => label.toLowerCase().includes(b))) continue;
      if (SEND_BTN_LABELS.some(g => label === g)) return btn;
      const svgPath = btn.querySelector("path"); if (svgPath) {
        const d = svgPath.getAttribute("d") || "";
        if (d === SEND_SVG_FINGERPRINT || d.startsWith("M12 3.59")) return btn;
      }
    }
    return null;
  }

  function sleep(ms) { return new Promise(r => _activeTimer = setTimeout(r, ms)); }

  // ════════════════════════════════════════════════════════════════
  //  Toast
  // ════════════════════════════════════════════════════════════════
  function showToast(msg, duration = 3500) {
    document.querySelector(".gq-toast")?.remove();
    const el = document.createElement("div"); el.className = "gq-toast";
    el.innerHTML = `<span>${msg}</span>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add("gq-toast-visible"));
    setTimeout(() => { el.classList.remove("gq-toast-visible"); setTimeout(() => el.remove(), 320); }, duration);
  }

  // ════════════════════════════════════════════════════════════════
  //  弹出菜单
  // ════════════════════════════════════════════════════════════════
  let _menuActiveIndex = -1, _menuItems = [];

  function closeMenu() {
    document.getElementById("gq-menu")?.remove(); document.getElementById("gq-overlay")?.remove();
    _menuActiveIndex = -1; _menuItems = [];
  }

  function showMenu(x, y, tweetData) {
    closeMenu();
    const cfg = loadConfig();
    const orderedKeys = cfg.templateOrder || [...TEMPLATE_KEYS];

    const overlay = document.createElement("div"); overlay.id = "gq-overlay"; overlay.onclick = closeMenu; document.body.appendChild(overlay);

    const menu = document.createElement("div"); menu.id = "gq-menu"; menu.setAttribute("role","menu");

    _menuItems = [];
    let _dragSrcKey = null;

    orderedKeys.forEach((key, idx) => {
      const tpl = cfg[key]; if (!tpl?.label) return;
      const item = document.createElement("div"); item.className = "gq-menu-item"; item.setAttribute("role","menuitem"); item.tabIndex = 0;
      item.draggable = false;
      item.innerHTML = `<span class="gq-drag-handle" title="\u62D6\u52A8\u6392\u5E8F">\u28FF</span><span class="gq-menu-icon">${tpl.icon||"\u270F\uFE0F"}</span><span class="gq-menu-label">${escapeHtml(tpl.label)}</span>`;
      item.dataset.key = key;

      item.onmouseenter = () => {
        menu.querySelectorAll(".gq-menu-item").forEach(el => el.classList.remove("gq-menu-item-active"));
        item.classList.add("gq-menu-item-active");
        _menuActiveIndex = _menuItems.indexOf(item);
      };
      item.onclick = (e) => { if (e.target.closest(".gq-drag-handle")) return; closeMenu(); executeCommand(tpl.prompt, tweetData); };
      item.onkeydown = handleMenuKeydown(idx, tpl.prompt, tweetData);

      item.querySelector(".gq-drag-handle").addEventListener("mousedown", () => { item.draggable = true; });

      item.addEventListener("dragstart", e => {
        _dragSrcKey = key;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", key);
        requestAnimationFrame(() => item.classList.add("gq-dragging"));
      });

      item.addEventListener("dragend", () => {
        item.draggable = false;
        item.classList.remove("gq-dragging");
        menu.querySelectorAll(".gq-drag-over-top,.gq-drag-over-bot").forEach(el => el.classList.remove("gq-drag-over-top","gq-drag-over-bot"));
        _dragSrcKey = null;
      });

      item.addEventListener("dragover", e => {
        if (!_dragSrcKey || _dragSrcKey === key) return;
        e.preventDefault(); e.dataTransfer.dropEffect = "move";
        const rect = item.getBoundingClientRect();
        const isTop = e.clientY < rect.top + rect.height / 2;
        menu.querySelectorAll(".gq-drag-over-top,.gq-drag-over-bot").forEach(el => { if (el !== item) el.classList.remove("gq-drag-over-top","gq-drag-over-bot"); });
        item.classList.toggle("gq-drag-over-top", isTop);
        item.classList.toggle("gq-drag-over-bot", !isTop);
      });

      item.addEventListener("dragleave", e => {
        if (!item.contains(e.relatedTarget)) item.classList.remove("gq-drag-over-top","gq-drag-over-bot");
      });

      item.addEventListener("drop", e => {
        e.preventDefault();
        if (!_dragSrcKey || _dragSrcKey === key) return;
        item.classList.remove("gq-drag-over-top","gq-drag-over-bot");
        const srcItem = menu.querySelector(`.gq-menu-item[data-key="${_dragSrcKey}"]`);
        if (!srcItem) return;
        const insertBefore = e.clientY < item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2;
        if (insertBefore) menu.insertBefore(srcItem, item); else item.after(srcItem);
        _menuItems = [...menu.querySelectorAll(".gq-menu-item")];
        const newCfg = loadConfig(); newCfg.templateOrder = _menuItems.map(el => el.dataset.key); saveConfig(newCfg);
      });

      _menuItems.push(item); menu.appendChild(item);
    });

    // Footer: 发送模式 | 私密模式切换 | 推送 | 设置
    const footer = document.createElement("div"); footer.className = "gq-menu-footer";

    // 发送模式
    const sendBtn = createFooterButton(cfg.autoSend ? "\uD83D\uDE80" : "\uD83D\uDEE1\uFE0F", cfg.autoSend ? t("send_auto").split(" ")[0]+"..." : t("send_manual").split(" ")[0]+"...",
      () => toggleAutoSend(sendBtn));
    sendBtn.id = "gq-send-mode-btn";

    // 推送按钮
    const pushCfg = loadPushConfig();
    const hasPush = pushCfg.discord?.some(e=>e.enabled&&e.url) || pushCfg.telegram?.some(e=>e.enabled&&e.token&&e.chat);
    const pushBtn = createFooterButton(hasPush ? "\uD83D\uDCE8" : "\uD83D\uDCE8", t("push_section"),
      () => { closeMenu(); doPush(tweetData); });

    // 设置
    const setBtn = createFooterButton("\u2699\uFE0F", t("settings_title").split(/\s/)[1] || "Settings",
      () => { closeMenu(); openSettings(); });

    footer.append(sendBtn, pushBtn, setBtn);
    menu.appendChild(footer);
    document.body.appendChild(menu);

    positionMenu(menu, x, y, orderedKeys.length);
    requestAnimationFrame(() => { if (_menuItems[0]) _menuItems[0].focus(); _menuActiveIndex = 0; });
  }

  function createFooterButton(icon, title, handler) {
    const btn = document.createElement("span"); btn.className = "gq-footer-btn"; btn.title = title; btn.textContent = icon; btn.tabIndex = 0;
    btn.onclick = (e) => { e.stopPropagation(); handler(); }; return btn;
  }

  function toggleAutoSend(btnEl) {
    const c = loadConfig(); c.autoSend = !c.autoSend; saveConfig(c);
    btnEl.textContent = c.autoSend ? "\uD83D\uDE80" : "\uD83D\uDEE1\uFE0F";
    btnEl.title = c.autoSend ? t("send_auto") : t("send_manual");
    showToast(c.autoSend ? "\uD83D\uDE80 " + t("send_auto") : "\uD83D\uDEE1\uFE0F " + t("send_manual"));
  }

  function positionMenu(menu, x, y, itemCount) {
    const mw = 186, mh = itemCount * 44 + 56;
    const fixPos = () => {
      const r = menu.getBoundingClientRect(); const w = r.width || mw, h = r.height || mh;
      let fx = x, fy = y;
      if (fx + w > window.innerWidth - 8) fx = window.innerWidth - w - 8;
      if (fy + h > window.innerHeight - 8) fy = y - h;
      if (fy < 8) fy = 8; if (fx < 8) fx = 8;
      menu.style.left = `${fx}px`; menu.style.top = `${fy}px`;
    };
    menu.style.left = Math.min(x, window.innerWidth - mw - 8) + "px";
    menu.style.top = Math.min(y, window.innerHeight - mh - 8) + "px";
    requestAnimationFrame(fixPos);
  }

  function highlightMenuItem(index) {
    _menuItems.forEach((item,i)=>item.classList.toggle("gq-menu-item-active",i===index));
    _menuActiveIndex = index;
  }

  function handleMenuKeydown(index, prompt, tweetData) {
    return (e) => {
      switch(e.key) {
        case "ArrowDown": e.preventDefault(); const n=(index+1)%_menuItems.length; highlightMenuItem(n); _menuItems[n]?.focus(); break;
        case "ArrowUp": e.preventDefault(); const p=(index-1+_menuItems.length)%_menuItems.length; highlightMenuItem(p); _menuItems[p]?.focus(); break;
        case "Enter": case " ": e.preventDefault(); closeMenu(); executeCommand(prompt,tweetData); break;
        case "Escape": e.preventDefault(); closeMenu(); break;
      }
    };
  }

  document.addEventListener("keydown", (e) => { if (e.key==="Escape") closeMenu(); }, true);

  // ════════════════════════════════════════════════════════════════
  //  推送功能（融合自 Grok Commander）
  // ════════════════════════════════════════════════════════════════
  function doPush(tweetData) {
    const cfg = loadPushConfig();
    const allTargets = [
      ...(cfg.discord||[]).filter(e=>e.enabled&&e.url).map(e=>({type:"discord",label:e.label||"Discord",url:e.url})),
      ...(cfg.telegram||[]).filter(e=>e.enabled&&e.token&&e.chat).map(e=>({type:"telegram",label:e.label||"Telegram",token:e.token,chat:e.chat})),
    ];
    if (!allTargets.length) { showToast(t("push_not_configured")); openSettings(); return; }
    if (allTargets.length === 1) { execPush(tweetData, allTargets); return; }
    showPushSelect(tweetData, allTargets);
  }

  function showPushSelect(tweetData, targets) {
    const cfg = loadPushConfig();
    const convUrl = convertTweetUrl(tweetData.url, cfg.urlConverter);
    const ovId = "gq-push-overlay";
    document.getElementById(ovId)?.remove();

    const ov = document.createElement("div"); ov.id = ovId;
    ov.onclick = (e) => { if (e.target===ov) ov.remove(); };
    ov.innerHTML = `
      <div id="gq-push-box">
        <h3>${t("push_section")}</h3>
        <p style="font-size:12px;color:#71767B;margin-bottom:10px;word-break:break-all">${escapeHtml(convUrl)}</p>
        <div id="gq-push-list"></div>
        <div class="gq-push-actions">
          <button id="gq-push-cancel" class="gq-btn gq-btn-secondary">\u53D6\u6D88</button>
          <button id="gq-push-ok"     class="gq-btn gq-btn-primary">\u63A8\u9001</button>
        </div>
      </div>`;
    document.body.appendChild(ov);

    const list = ov.querySelector("#gq-push-list");
    targets.forEach((tgt,i)=>{
      const row = document.createElement("label"); row.className = "gq-push-select-item";
      row.innerHTML = `<input type=checkbox checked data-i="${i}"> <span>${escapeHtml(tgt.label)}</span> <span class="gq-badge ${tgt.type}">${tgt.type}</span>`;
      list.appendChild(row);
    });

    ov.querySelector("#gq-push-cancel").onclick = () => ov.remove();
    ov.querySelector("#gq-push-ok").onclick = () => {
      const selected = [...list.querySelectorAll(":checked")].map(el=>targets[parseInt(el.dataset.i)]);
      if (!selected.length) { showToast(t("push_not_configured")); return; }
      ov.remove(); execPush(tweetData, selected);
    };
  }

  function execPush(tweetData, targets) {
    const cfg = loadPushConfig();
    const convertedUrl = convertTweetUrl(tweetData.url, cfg.urlConverter);
    const message = buildPushMessage(tweetData, convertedUrl);
    let ok = 0, fail = 0, total = targets.length;
    function done() { if (ok+fail>=total) showToast(`${ok?t("push_result_ok"):t("push_result_fail")} (${ok}/${total})`); }

    targets.forEach((tgt,i)=>{
      setTimeout(()=>{
        if (tgt.type==="discord") {
          GM_xmlhttpRequest({
            method:"POST", url:tgt.url,
            headers:{"Content-Type":"application/json"},
            data:JSON.stringify({content: truncateFor(message, 1900)}),
            onload:(r)=>{(r.status>=200&&r.status<300)?ok++:fail++;done()},
            onerror:()=>{fail++;done()}
          });
        } else {
          GM_xmlhttpRequest({
            method:"POST", url:`https://api.telegram.org/bot${tgt.token}/sendMessage`,
            headers:{"Content-Type":"application/json"},
            data:JSON.stringify({chat_id:tgt.chat,text:truncateFor(message, 3900),disable_web_page_preview:false}),
            onload:(r)=>{try{JSON.parse(r.responseText).ok?ok++:fail++}catch{fail++}done()},
            onerror:()=>{fail++;done()}
          });
        }
      }, i*500);
    });
  }

  function buildPushMessage(tweetData, convertedUrl) {
    const parts = [];
    const author = [tweetData.displayName, tweetData.author].filter(Boolean).join(" ");
    if (tweetData.vip?.label) parts.push(`重点关注: ${tweetData.vip.label}`);
    if (tweetData.note) parts.push(`备注: ${tweetData.note}`);
    if (author) parts.push(`作者: ${author}`);
    if (tweetData.text) parts.push(`内容: ${truncateFor(tweetData.text, 900)}`);
    parts.push(convertedUrl || tweetData.url || location.href);
    return parts.join("\n");
  }

  function truncateFor(text, maxLen) {
    const value = String(text || "");
    return value.length > maxLen ? value.slice(0, maxLen - 1) + "…" : value;
  }

  // ════════════════════════════════════════════════════════════════
  //  设置面板（增强版）
  // ════════════════════════════════════════════════════════════════
  function openSettings() {
    document.getElementById("gq-settings-overlay")?.remove();
    const cfg = loadConfig();
    const draft = {}; TEMPLATE_KEYS.forEach(k => { draft[k] = {...cfg[k]}; });
    draft.autoSend = cfg.autoSend;
    draft.privateMode = cfg.privateMode;
    draft.lang = cfg.lang;
    const pc = loadPushConfig();

    const ov = document.createElement("div"); ov.id = "gq-settings-overlay";
    ov.onclick = (e) => { if (e.target===ov) closeSettings(); };

    const modal = document.createElement("div"); modal.id = "gq-settings-modal";

    modal.innerHTML = `
      <div class="gq-modal-header"><span class="gq-modal-title">${t("settings_title")} <small>v3.2.2</small></span><span id="gq-close-btn" class="gq-close-icon" role=button tabindex=0 aria-label="\u5173\u95ED">\u2715</span></div>
      <div class="gq-modal-body">
        <!-- 语言 & 模式 -->
        <div class="gq-section-card"><div class="gq-section-header">⚙️ ${t("lang_label")} & ${t("send_mode_label")}</div><div class="gq-section-body">
          <div class="gq-form-row"><label class="gq-form-label">${t("lang_label")}</label>
            <select id="gq-lang-select" class="gq-input-text">
              <option value="auto" ${draft.lang==="auto"?"selected":""}>${t("lang_auto")}</option>
              <option value="zh-CN" ${draft.lang==="zh-CN"?"selected":""}>简体中文</option>
              <option value="en" ${draft.lang==="en"?"selected":""}>English</option>
              <option value="ja" ${draft.lang==="ja"?"selected":""}>日本語</option>
            </select></div>
          <div class="gq-toggle-row"><input type=checkbox id="gq-autosend-chk" ${draft.autoSend?"checked":""} class="gq-toggle-input"><span class="gq-toggle-label">${t("send_auto")}</span></div>
          <div class="gq-toggle-row"><input type=checkbox id="gq-private-chk" ${draft.privateMode?"checked":""} class="gq-toggle-input"><span class="gq-toggle-label">${t("private_mode")}</span></div>
        </div></div>

        <!-- 导入/导出 -->
        <div class="gq-section-card"><div class="gq-section-header">\uD83D\uDCE4 / \uD83D\uDCE5 ${t("push_url_format")} & \u5BFC\u5165/\u5BFC\u51FA</div><div class="gq-section-body gq-import-export-row">
          <button id="gq-btn-export" class="gq-btn gq-btn-sm gq-btn-outline">\uD83D\uDCE5 Export JSON</button>
          <label class="gq-btn gq-btn-sm gq-btn-outline"><input type=file id="gq-file-import" accept=.json style=display:none>\uD83D\uDCE4 Import</label>
        </div></div>

        <!-- 模板 -->
        <div id="gq-template-container"></div>

        <!-- 推送设置 -->
        <div class="gq-section-card"><div class="gq-section-header">${t("push_section")}</div><div class="gq-section-body" id="gq-push-container"></div></div>
      </div>

      <div class="gq-modal-footer">
        <button id="gq-btn-cancel" class="gq-btn gq-btn-secondary">${t("btn_cancel")}</button>
        <button id="gq-btn-save"   class="gq-btn gq-btn-primary">${t("btn_save")}</button>
      </div>`;

    ov.appendChild(modal); document.body.appendChild(ov);

    // 渲染模板编辑器
    renderTemplateEditors(document.getElementById("gq-template-container"), draft);
    renderPushSection(document.getElementById("gq-push-container"), pc);

    document.getElementById("gq-close-btn").onclick = closeSettings;
    document.getElementById("gq-btn-cancel").onclick = closeSettings;
    document.getElementById("gq-btn-save").onclick = () => {
      draft.autoSend = document.getElementById("gq-autosend-chk").checked;
      draft.privateMode = document.getElementById("gq-private-chk").checked;
      draft.lang = document.getElementById("gq-lang-select").value;
      // 收集模板值
      document.querySelectorAll(".gq-tmpl-data-key").forEach(ta=>{
        const k = ta.dataset.key; if(draft[k]) draft[k].prompt = ta.value;
      });
      document.querySelectorAll(".gq-tmpl-data-label").forEach(inp=>{
        const k = inp.dataset.key; if(draft[k]) draft[k].label = inp.value;
      });
      // 保存推送
      savePushConfig(collectPushConfig(pc));
      saveConfig(draft); showToast(t("alert_saved")); closeSettings();
    };

    // 导出
    document.getElementById("gq-btn-export").onclick = () => {
      draft.autoSend = document.getElementById("gq-autosend-chk").checked;
      draft.privateMode = document.getElementById("gq-private-chk").checked;
      collectTemplateValues(draft);
      const data = JSON.stringify({ ...draft, push: collectPushConfig(pc) }, null, 2);
      const blob = new Blob([data], {type:"application/json"});
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = `grok-quick-v3-${Date.now()}.json`; a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),1000);
      showToast("\uD83D\uDCE5 Exported!");
    };

    // 导入
    document.getElementById("gq-file-import").onchange = (e)=>{
      const f = e.target.files?.[0]; if(!f)return;
      const reader = new FileReader(); reader.onload = (ev)=>{
        try{
          const imported = JSON.parse(ev.target.result);
          if(!imported||typeof imported!=="object"){showToast("❌ Invalid JSON");return;}
          // 合并导入的值
          TEMPLATE_KEYS.forEach(k=>{if(imported[k]){draft[k]={...getDefaultFor(k),...imported[k]}}});
          if(typeof imported.autoSend==="boolean") draft.autoSend = imported.autoSend;
          if(typeof imported.privateMode==="boolean") draft.privateMode = imported.privateMode;
          if(imported.lang) draft.lang = imported.lang;
          if(imported.push && typeof imported.push === "object") {
            Object.assign(pc, normalizePushConfig(imported.push));
            renderPushSection(document.getElementById("gq-push-container"), pc);
          }
          document.getElementById("gq-autosend-chk").checked = draft.autoSend;
          document.getElementById("gq-private-chk").checked = draft.privateMode;
          renderTemplateEditors(document.getElementById("gq-template-container"), draft);
          showToast("\uD83D\uDCE4 Imported! Click Save.");
        }catch(err){showToast("❌ Parse error: "+err.message);}
      }; reader.readAsText(f); e.target.value="";
    };

    document.addEventListener("keydown", function escHandler(e){
      if(e.key==="Escape"){closeSettings();document.removeEventListener("keydown",escHandler);}
    });
  }

  function getDefaultFor(k) {
    const lc = resolveLang(loadConfig().lang||"auto");
    const defs = getMergedDefaults(lc);
    return defs[k] || {label:k,icon:"\u270F\uFE0F",prompt:""};
  }

  function collectTemplateValues(draft) {
    document.querySelectorAll(".gq-tmpl-data-key").forEach(ta=>{
      const k = ta.dataset.key; if(draft[k]) draft[k].prompt = ta.value;
    });
    document.querySelectorAll(".gq-tmpl-data-label").forEach(inp=>{
      const k = inp.dataset.key; if(draft[k]) draft[k].label = inp.value;
    });
  }

  function renderTemplateEditors(container, draft) {
    container.innerHTML = "";
    const sectionLabels = {
      summary:"\uD83D\uDCDD \u603B\u7ED3\u8FD9\u4E2A\u5E16\u5B50",
      explain:"\uD83D\uDCA1 \u89E3\u91CA\u8FD9\u4E2A\u5E16\u5B50",
      factcheck:"\uD83D\uDC75\uFE0F \u4E8B\u5B9E\u6838\u67E5",
      analysis:"\uD83D\uDCCA \u6DF1\u5EA6\u5206\u6790",
      translate:"\uD83C\uDF10 \u7FFB\u8BD1\u89E3\u91CA",
      custom1:"\u270F\uFE0F Custom 1", custom2:"\u270F\uFE0F Custom 2",
      custom3:"\u270F\uFE0F Custom 3", custom4:"\u270F\uFE0F Custom 4", custom5:"\u270F\uFE0F Custom 5",
    };
    TEMPLATE_KEYS.forEach(key=>{
      const card = document.createElement("div"); card.className = "gq-section-card";
      card.innerHTML = `<div class="gq-section-header">${sectionLabels[key]||key}</div><div class="gq-section-body"></div>`;
      const body = card.querySelector(".gq-section-body");

      const lr = document.createElement("div"); lr.className = "gq-form-row";
      lr.innerHTML = `<label class="gq-form-label">\u6807\u9898</label>`;
      const li = document.createElement("input"); li.className = "gq-input-text gq-tmpl-data-label";
      li.dataset.key = key; li.value = draft[key]?.label || ""; li.placeholder = "Label";
      li.oninput = () => { if(draft[key]) draft[key].label = li.value; }; lr.append(li); body.append(lr);

      const pr = document.createElement("div"); pr.className = "gq-form-row";
      pr.innerHTML = `<label class="gq-form-label">Prompt (\u63A8\u6587\u9644\u52A0)</label>`;
      const pi = document.createElement("textarea"); pi.className = "gq-input-textarea gq-tmpl-data-key";
      pi.dataset.key = key; pi.value = draft[key]?.prompt || ""; pi.rows = 3;
      pi.oninput = () => { if(draft[key]) draft[key].prompt = pi.value; }; pr.append(pi); body.append(pr);

      if(["summary","explain","factcheck","analysis","translate"].includes(key)) {
        const rb = document.createElement("button"); rb.className = "gq-btn-reset"; rb.textContent = "\u62E9\u590D\u9ED8\u8BA4";
        rb.onclick = () => { const lc = resolveLang(draft.lang||"auto"); const defs = getMergedDefaults(lc); draft[key] = {...defs[key]}; li.value=draft[key].label; pi.value=draft[key].prompt; showToast(`✓ ${key} reset`); };
        body.append(rb);
      }
      container.appendChild(card);
    });
  }

  function renderPushSection(container, pc) {
    container.innerHTML = "";

    // URL 转换器
    const ucRow = document.createElement("div"); ucRow.className = "gq-form-row";
    const selectedDomain = pc.urlConverter || "x.com";
    const domainOptions = URL_CONVERTER_DOMAINS.map(domain => `<option value="${domain}" ${selectedDomain===domain?"selected":""}>${domain}</option>`).join("");
    ucRow.innerHTML = `<label class="gq-form-label">${t("push_url_format")}</label>
      <select id="gq-url-sel" class="gq-input-text">${domainOptions}</select>`;
    container.appendChild(ucRow);

    // Discord
    const dHeader = document.createElement("div"); dHeader.style.cssText="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12px;font-weight:bold;color:#8899A6;";
    dHeader.innerHTML=`<span>${t("push_discord")}</span>`;
    const dAdd = document.createElement("button"); dAdd.className = "gq-btn-reset"; dAdd.textContent = t("push_add"); dAdd.style.cssText="padding:3px 10px;border-radius:8px;border:1px dashed #536471;background:transparent;color:#536471;font-size:11px;";
    dAdd.onclick = () => { if ((pc.discord||[]).length >= 10) { showToast("Max 10"); return; } pc.discord = pc.discord || []; pc.discord.push({label:"",url:"",enabled:true}); renderPushSection(container, pc); };
    dHeader.appendChild(dAdd); container.appendChild(dHeader);

    (pc.discord||[]).forEach((entry,idx)=>{
      container.appendChild(createPushEntry("discord", entry, idx, pc));
    });
    if (!(pc.discord||[]).length) {
      const empty = document.createElement("div"); empty.style.cssText="font-size:11px;color:#3d4a55;padding:4px 0;"; empty.textContent = t("push_add")+" →"; container.appendChild(empty);
    }

    // Telegram
    const tHeader = document.createElement("div"); tHeader.style.cssText = dHeader.style.cssText;
    tHeader.innerHTML = `<span>${t("push_telegram")}</span>`;
    const tAdd = document.createElement("button"); tAdd.className = "gq-btn-reset"; tAdd.textContent = t("push_add"); tAdd.style.cssText = dAdd.style.cssText;
    tAdd.onclick = () => { if ((pc.telegram||[]).length >= 10) { showToast("Max 10"); return; } pc.telegram = pc.telegram || []; pc.telegram.push({label:"",token:"",chat:"",enabled:true}); renderPushSection(container, pc); };
    tHeader.appendChild(tAdd); container.appendChild(tHeader);

    (pc.telegram||[]).forEach((entry,idx)=>{
      container.appendChild(createPushEntry("telegram", entry, idx, pc));
    });
    if (!(pc.telegram||[]).length) { const empty = document.createElement("div"); empty.style.cssText = "font-size:11px;color:#3d4a55;padding:4px 0;"; empty.textContent = t("push_add")+" →"; container.appendChild(empty); }

    // 绑定 URL 选择器变化
    container.querySelector("#gq-url-sel")?.addEventListener("change", (e) => { pc.urlConverter = e.target.value; });
  }

  function createPushEntry(type, entry, idx, pc) {
    const div = document.createElement("div"); div.className = "gq-push-entry";
    div.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:8px 10px;background:#16181C;border:1px solid #2f3336;border-radius:8px;";

    const hdr = document.createElement("div"); hdr.style.cssText = "display:flex;align-items:center;gap:6px;";
    const chk = document.createElement("input"); chk.type = "checkbox"; chk.checked = entry.enabled !== false; chk.style.cssText = "cursor:pointer;width:14px;height:14px;";
    chk.onchange = () => { entry.enabled = chk.checked; };
    const lbl = document.createElement("input"); lbl.className = "gq-input-text"; lbl.style.cssText = "flex:1;height:24px;padding:3px 8px;font-size:12px;box-sizing:border-box;";
    lbl.placeholder = "Channel name"; lbl.value = entry.label || "";
    lbl.oninput = () => { entry.label = lbl.value; };
    const rm = document.createElement("button"); rm.className = "gq-remove-btn"; rm.textContent = "\u2715";
    rm.style.cssText = "background:none;border:none;color:#536471;font-size:14px;cursor:pointer;padding:0 4px;line-height:1;flex-shrink:0;";
    rm.onclick = () => { if(type==="discord") pc.discord.splice(idx,1); else pc.telegram.splice(idx,1); renderPushSection(document.getElementById("gq-push-container")||document.body, pc); };
    hdr.append(chk, lbl, rm); div.append(hdr);

    if (type === "discord") {
      const r = document.createElement("div"); r.className = "gq-form-row"; r.innerHTML = `<label class="gq-form-label">Webhook URL</label>`;
      const inp = document.createElement("input"); inp.className = "gq-input-text"; inp.placeholder = "https://discord.com/api/webhooks/...";
      inp.value = entry.url || ""; inp.oninput = () => { entry.url = inp.value; }; r.appendChild(inp); div.append(r);
    } else {
      const r1 = document.createElement("div"); r1.className = "gq-form-row"; r1.innerHTML = `<label class="gq-form-label">Bot Token</label>`;
      const inp1 = document.createElement("input"); inp1.className = "gq-input-text"; inp1.placeholder = "123456789:ABC-xxx";
      inp1.value = entry.token || ""; inp1.oninput = () => { entry.token = inp1.value; }; r1.appendChild(inp1); div.append(r1);
      const r2 = document.createElement("div"); r2.className = "gq-form-row"; r2.innerHTML = `<label class="gq-form-label">Chat ID</label>`;
      const inp2 = document.createElement("input"); inp2.className = "gq-input-text"; inp2.placeholder = "-100xxx or @channel";
      inp2.value = entry.chat || ""; inp2.oninput = () => { entry.chat = inp2.value; }; r2.appendChild(inp2); div.append(r2);
    }
    return div;
  }

  function collectPushConfig(pc) {
    const sel = document.getElementById("gq-url-sel");
    const current = normalizePushConfig(pc || loadPushConfig());
    return {
      discord: current.discord,
      telegram: current.telegram,
      skipConfirm: current.skipConfirm,
      urlConverter: sel ? sel.value : "x.com",
    };
  }

  function closeSettings() { document.getElementById("gq-settings-overlay")?.remove(); }

  // ════════════════════════════════════════════════════════════════
  //  按钮劫持
  // ════════════════════════════════════════════════════════════════
  function scheduleHijack() {
    if (_hijackScheduled) return;
    _hijackScheduled = true;
    requestAnimationFrame(() => { _hijackScheduled = false; hijackThrottled(); });
  }

  function hijackThrottled() {
    document.querySelectorAll("article").forEach(article => {
      findArticleGrokButtons(article).forEach(origBtn => {
        if (!origBtn || origBtn.classList.contains("gq-btn") || _hijackedButtons.has(origBtn)) return;
        if (origBtn.closest("[role='group']") && !isLikelyGrokButton(origBtn)) return;
        const newBtn = replaceWithQuickButton(origBtn);
        if (newBtn) _hijackedButtons.add(newBtn);
      });
    });
  }

  function findArticleGrokButtons(article) {
    const found = new Set();
    article.querySelectorAll("button,[role='button']").forEach(btn => {
      if (isLikelyGrokButton(btn)) found.add(btn);
    });
    article.querySelectorAll("path").forEach(path => {
      if (!isGrokIcon(path)) return;
      const btn = path.closest("button,[role='button']");
      if (btn) found.add(btn);
    });
    return [...found].filter(btn => btn.offsetParent !== null);
  }

  function replaceWithQuickButton(origBtn) {
    try {
      origBtn.classList.add("gq-btn");
      origBtn.style.color = "#FF1493";
      origBtn.style.cursor = "pointer";
      origBtn.setAttribute("aria-label", "Grok Quick: \u603B\u7ED3 / \u89E3\u91CA / \u81EA\u5B9A\u4E49");
      origBtn.title = "Grok Quick v3.2.2 \u2014 \u603B\u7ED3 / \u89E3\u91CA / \u81EA\u5B9A\u4E49";

      origBtn.addEventListener("click", (e) => {
        if (_nativeClickBypass.has(origBtn)) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        const tweetData = extractTweetData(origBtn.closest("article"));
        tweetData.sourceGrokButton = origBtn;
        showMenu(e.clientX, e.clientY, tweetData);
      }, true);
      return origBtn;
    } catch (err) { console.warn("[Grok Quick]", err); }
    return null;
  }

  // ════════════════════════════════════════════════════════════════
  //  样式
  // ════════════════════════════════════════════════════════════════
  const style = document.createElement("style");
  style.textContent = `
    #gq-overlay{position:fixed;inset:0;z-index:99989;background:transparent}
    #gq-menu{position:fixed;z-index:99990;background:var(--gq-bg,#000);border:1px solid var(--gq-border,#333639);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.45),0 0 60px -10px rgba(255,20,147,.18);padding:8px;display:flex;flex-direction:column;gap:2px;min-width:186px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;animation:gqFadeIn .15s cubic-bezier(.16,1,.3,1);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}
    @keyframes gqFadeIn{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
    .gq-menu-item{display:flex;align-items:center;gap:11px;padding:10px 14px;color:var(--gq-text,#E7E9EA);font-size:14px;font-weight:500;border-radius:10px;cursor:pointer;user-select:none;transition:all .12s ease;outline:none}
    .gq-menu-item:hover,.gq-menu-item.gq-menu-item-active{background:linear-gradient(135deg,#FF1493 0%,#E0458A 100%);color:#fff;transform:scale(1.01)}
    .gq-menu-icon{font-size:17px;flex-shrink:0}
    .gq-menu-label{flex:1;line-height:1.3}
    .gq-drag-handle{cursor:grab;font-size:12px;flex-shrink:0;color:var(--gq-muted,#71767B);opacity:0;transition:opacity .15s;padding:0 2px;letter-spacing:-.5px}
    .gq-menu-item:hover .gq-drag-handle{opacity:.6;cursor:grab}
    .gq-menu-item.gq-dragging{opacity:.3}
    .gq-menu-item.gq-drag-over-top{border-top:2px solid #FF1493}
    .gq-menu-item.gq-drag-over-bot{border-bottom:2px solid #FF1493}
    .gq-menu-footer{border-top:1px solid var(--gq-divider,rgba(255,255,255,.08));padding:6px 8px 4px;margin-top:4px;display:flex;justify-content:space-around;align-items:center}
    .gq-footer-btn{padding:5px 9px;font-size:16px;cursor:pointer;color:var(--gq-muted,#71767B);border-radius:8px;user-select:none;transition:all .15s;outline:none}
    .gq-footer-btn:hover{background:var(--gq-hover,rgba(255,255,255,.08));color:#fff;transform:scale(1.1)}
    .gq-toast{position:fixed;bottom:24px;right:24px;background:rgba(15,20,28,.95);border:1.5px solid #FF1493;color:#fff;font-size:13px;font-family:inherit;padding:12px 20px;border-radius:12px;z-index:2147483647;box-shadow:0 8px 32px rgba(255,20,147,.25),0 2px 8px rgba(0,0,0,.3);opacity:0;transform:translateY(8px) scale(.96);transition:all .3s cubic-bezier(.16,1,.3,1);pointer-events:none}
    .gq-toast.gq-toast-visible{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}
    /* Settings */
    #gq-settings-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:2147483640;display:flex;justify-content:center;align-items:center;animation:gqOverlayIn .2s ease}
    @keyframes gqOverlayIn{from{opacity:0}to{opacity:1}}
    #gq-settings-modal{background:var(--gq-bg,#0d1117);border:1px solid var(--gq-border,#2f3336);border-radius:20px;width:min(540px,94vw);height:min(90vh,850px);display:flex;flex-direction:column;color:var(--gq-text,#E7E9EA);box-shadow:0 24px 80px rgba(0,0,0,.8),0 0 120px -20px rgba(255,20,147,.12);overflow:hidden;animation:gqModalIn .22s cubic-bezier(.16,1,.3,1)}
    @keyframes gqModalIn{from{opacity:0;transform:scale(.94) translateY(12px)}to{opacity:1;transform:scale(1) translateY(0)}}
    .gq-modal-header{display:flex;justify-content:space-between;align-items:center;padding:18px 22px;border-bottom:1px solid var(--gq-divider,rgba(255,255,255,.06));flex-shrink:0}
    .gq-modal-title{font-size:16px;font-weight:700;color:#fff;display:flex;align-items:center;gap:8px}
    .gq-modal-title small{font-size:11px;font-weight:400;color:var(--gq-muted,#71767B);background:rgba(255,20,147,.1);padding:2px 8px;border-radius:6px}
    .gq-close-icon{cursor:pointer;color:var(--gq-muted,#536471);font-size:18px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:8px;transition:all .15s;line-height:1}
    .gq-close-icon:hover{background:rgba(255,255,255,.08);color:#fff}
    .gq-modal-body{flex:1;overflow-y:auto;padding:18px 22px;display:flex;flex-direction:column;gap:12px;scrollbar-width:thin;scrollbar-color:#2d3748 transparent}
    .gq-modal-body::-webkit-scrollbar{width:5px}.gq-modal-body::-webkit-scrollbar-thumb{background:#2d3748;border-radius:10px}
    .gq-modal-footer{padding:14px 22px;border-top:1px solid var(--gq-divider,rgba(255,255,255,.06));display:flex;justify-content:flex-end;gap:10px;flex-shrink:0}
    .gq-section-card{background:var(--gq-card-bg,#16181C);border:1px solid var(--gq-border,#2f3336);border-radius:14px;overflow:hidden;transition:border-color .15s}
    .gq-section-card:hover{border-color:rgba(255,20,147,.2)}
    .gq-section-header{padding:11px 15px;font-size:13px;font-weight:600;color:#FF1493;background:rgba(255,20,147,.06);border-bottom:1px solid var(--gq-divider,rgba(255,255,255,.05));letter-spacing:.02em}
    .gq-section-body{padding:14px 15px;display:flex;flex-direction:column;gap:10px}
    .gq-form-row{display:flex;flex-direction:column;gap:5px}
    .gq-form-label{font-size:12px;color:var(--gq-muted,#71767B);font-weight:500}
    .gq-input-text,.gq-input-select{background:var(--gq-input-bg,#0d1117);border:1px solid var(--gq-border,#2f3336);border-radius:10px;color:var(--gq-text,#E7E9EA);font-size:13.5px;padding:9px 12px;outline:none;transition:border-color .15s,box-shadow .15s;width:100%;box-sizing:border-box;font-family:inherit}
    .gq-input-text:focus,.gq-input-select:focus{border-color:#FF1493;box-shadow:0 0 0 3px rgba(255,20,147,.15)}
    .gq-input-textarea{background:var(--gq-input-bg,#0d1117);border:1px solid var(--gq-border,#2f3336);border-radius:10px;color:var(--gq-text,#E7E9EA);font-size:13.5px;padding:9px 12px;outline:none;resize:vertical;min-height:72px;font-family:inherit;line-height:1.55;width:100%;box-sizing:border-box;transition:border-color .15s}
    .gq-input-textarea:focus{border-color:#FF1493;box-shadow:0 0 0 3px rgba(255,20,147,.15)}
    .gq-toggle-row{display:flex;align-items:center;gap:12px;cursor:pointer;font-size:13.5px;color:var(--gq-text,#E7E9EA);user-select:none}
    .gq-toggle-input{appearance:none;-webkit-appearance:none;width:42px;height:24px;background:var(--gq-toggle-off,#333639);border-radius:12px;position:relative;cursor:pointer;transition:background .2s;flex-shrink:0}
    .gq-toggle-input:checked{background:#FF1493}
    .gq-toggle-input::after{content:'';position:absolute;top:2px;left:2px;width:20px;height:20px;background:#fff;border-radius:50%;transition:transform .2s cubic-bezier(.16,1,.3,1);box-shadow:0 1px 4px rgba(0,0,0,.3)}
    .gq-toggle-input:checked::after{transform:translateX(18px)}
    .gq-toggle-label{user-select:none}
    .gq-btn-reset{align-self:flex-start;padding:5px 12px;font-size:12px;border-radius:8px;cursor:pointer;border:1px solid var(--gq-border,#333);background:transparent;color:var(--gq-muted,#71767B);transition:all .15s;font-family:inherit}
    .gq-btn-reset:hover{border-color:#FF1493;color:#FF1493;background:rgba(255,20,147,.06)}
    .gq-remove-btn:hover{color:#F4212E!important}
    .gq-btn{padding:9px 20px;font-size:14px;border-radius:99px;cursor:pointer;border:none;font-weight:600;font-family:inherit;transition:all .15s;display:inline-flex;align-items:center;gap:6px}
    .gq-btn-primary{background:linear-gradient(135deg,#FF1493,#E0458A);color:#fff;box-shadow:0 2px 12px rgba(255,20,147,.3)}
    .gq-btn-primary:hover{transform:translateY(-1px);box-shadow:0 4px 16px rgba(255,20,147,.4)}
    .gq-btn-secondary{background:transparent;color:var(--gq-text,#E7E9EA);border:1px solid var(--gq-border,#536471)}
    .gq-btn-secondary:hover{background:rgba(255,255,255,.06)}
    .gq-btn-sm{padding:6px 14px;font-size:12.5px;border-radius:10px}
    .gq-btn-outline{background:transparent;color:var(--gq-text,#E7E9EA);border:1px solid var(--gq-border,#3d4145)}
    .gq-btn-outline:hover{border-color:#FF1493;color:#FF1493;background:rgba(255,20,147,.06)}
    .gq-push-entry input[type=text]{background:#0d1117!important;border:1px solid #2f3336!important;color:#E7E9EA!important;border-radius:6px!important;font-size:12px!important;padding:4px 8px!important}
    /* Push Select */
    #gq-push-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483641;display:flex;justify-content:center;align-items:center;animation:gqOverlayIn .2s ease}
    #gq-push-box{background:#16181C;border:1px solid #2f3336;border-radius:16px;padding:22px;width:380px;max-width:92vw;font-family:inherit;color:#E7E9EA;box-shadow:0 8px 24px rgba(0,0,0,.6)}
    #gq-push-box h3{margin:0 0 14px;font-size:15px;color:#fff}
    .gq-push-select-item{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#0d1117;border:1px solid #2f3336;border-radius:8px;cursor:pointer;font-size:13px;margin-bottom:4px}
    .gq-push-select-item:hover{border-color:#FF1493}
    .gq-push-select-item input{cursor:pointer;width:14px;height:14px;flex-shrink:0}
    .gq-badge{font-size:10px;padding:1px 6px;border-radius:10px;margin-left:auto;flex-shrink:0}
    .gq-badge.discord{background:rgba(88,101,242,.2);color:#8b9eff}
    .gq-badge.telegram{background:rgba(41,182,246,.2);color:#64c8f5}
    .gq-push-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:14px}

    /* Grok panel resize handle */
    #gq-panel-resize{width:100%;height:8px;cursor:ns-resize;flex-shrink:0;position:relative;border-radius:4px 4px 0 0;transition:background .2s;user-select:none}
    #gq-panel-resize:hover{background:rgba(255,20,147,.2)}
    #gq-panel-resize::after{content:'';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:36px;height:3px;background:rgba(255,255,255,.12);border-radius:2px;transition:background .2s}
    #gq-panel-resize:hover::after{background:rgba(255,20,147,.7)}

    /* Light theme */
    @media(prefers-color-scheme:light){
      :root{--gq-bg:#fff;--gq-text:#0f1419;--gq-muted:#536471;--gq-border:#eff1f3;--gq-divider:rgba(0,0,0,.06);--gq-card-bg:#f7f9fa;--gq-input-bg:#fff;--gq-hover:rgba(0,0,0,.04);--gq-toggle-off:#ccd0d3;--gq-scrollbar:#c4c9cc}
      #gq-settings-modal{box-shadow:0 24px 80px rgba(0,0,0,.12),0 0 120px -20px rgba(255,20,147,.06)}
      #gq-menu{box-shadow:0 8px 32px rgba(0,0,0,.12),0 0 60px -10px rgba(255,20,147,.06);border-color:var(--gq-border)}
      .gq-toast{background:rgba(255,255,255,.96);color:#0f1419;border-color:#FF1493}
    }
  `;
  document.head.appendChild(style);

  // ════════════════════════════════════════════════════════════════
  //  Grok 面板高度调整
  // ════════════════════════════════════════════════════════════════
  function applyGrokPanelHeight(drawer, p0, p1, h, pad) {
    const ch = h + pad;
    drawer.style.height = h + "px";
    p0.style.height = ch + "px";
    p1.style.height = ch + "px";
    p1.style.top = `-${ch}px`;
  }

  function injectGrokResizeHandle() {
    const drawer = document.querySelector("[data-testid='GrokDrawer']");
    if (!drawer || drawer.dataset.gqResize) return;
    const p0 = drawer.parentElement;
    const p1 = p0?.parentElement;
    if (!p1) return;
    drawer.dataset.gqResize = "1";

    const initDrawerH = parseFloat(window.getComputedStyle(drawer).height) || 678;
    const initP0H = parseFloat(window.getComputedStyle(p0).height) || 691;
    const pad = Math.max(0, initP0H - initDrawerH);

    const savedH = GM_getValue("gq_panel_height", 0);
    if (savedH >= 300 && savedH <= window.innerHeight - 60) {
      applyGrokPanelHeight(drawer, p0, p1, savedH, pad);
    }

    const handle = document.createElement("div");
    handle.id = "gq-panel-resize";
    drawer.insertBefore(handle, drawer.firstChild);

    handle.addEventListener("mousedown", e => {
      e.preventDefault(); e.stopPropagation();
      const startY = e.clientY;
      const startH = parseFloat(drawer.style.height) || initDrawerH;

      const onMove = ev => {
        const newH = Math.max(300, Math.min(window.innerHeight - 60, startH + startY - ev.clientY));
        applyGrokPanelHeight(drawer, p0, p1, newH, pad);
      };
      const onUp = () => {
        GM_setValue("gq_panel_height", Math.round(parseFloat(drawer.style.height) || initDrawerH));
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // ════════════════════════════════════════════════════════════════
  //  启动
  // ════════════════════════════════════════════════════════════════
  const observer = new MutationObserver(scheduleHijack);
  observer.observe(document.body, { childList: true, subtree: true });

  const panelObserver = new MutationObserver(() => {
    if (document.querySelector("[data-testid='GrokDrawer']:not([data-gq-resize])")) injectGrokResizeHandle();
  });
  panelObserver.observe(document.body, { childList: true, subtree: true });
  injectGrokResizeHandle();

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(hijackThrottled, 600));
  else setTimeout(hijackThrottled, 600);

  let scrollTimer = null;
  window.addEventListener("scroll", () => { if (scrollTimer) return; scrollTimer = setTimeout(() => { scrollTimer = null; scheduleHijack(); }, 200); }, { passive: true });

  GM_registerMenuCommand("\u2699\uFE0F Grok Quick v3.2.2 \u8BBE\u7F6E", openSettings);
  console.log("[Grok Quick] v3.2.9 loaded — Powered by Flywind | Enhanced from Grok Commander by Star_tanuki07");
})();
