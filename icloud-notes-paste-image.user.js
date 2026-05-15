// ==UserScript==
// @name         iCloud 备忘录图片粘贴增强
// @namespace    https://www.icloud.com.cn/
// @version      12.0
// @description  启用 iCloud 备忘录 Web 版隐藏的图片粘贴功能
// @match        https://www.icloud.com.cn/notes*
// @match        https://www.icloud.com/notes*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
  'use strict';

  // For same-origin iframes, when the iframe navigates to a new URL,
  // the window object is REPLACED. So hooks on about:blank's window won't persist.
  // We need to hook AFTER the real document starts loading but BEFORE scripts execute.
  //
  // The only reliable way in Chrome from the parent page is:
  // 1. Detect iframe src change
  // 2. Immediately access contentWindow (which is the NEW window for the new doc)
  // 3. Hook its prototypes before any scripts run
  //
  // This works because: iframe navigation → new window created → parent can access it
  // → scripts in iframe haven't run yet (they run after HTML parsing starts)
  //
  // We use a very tight polling loop to catch the window change.

  let lastIframeWindow = null;

  function pollForIframe() {
    const iframe = document.querySelector('iframe#early-child, iframe[src*="notes3"]');
    if (!iframe) { requestAnimationFrame(pollForIframe); return; }

    let win;
    try { win = iframe.contentWindow; } catch(e) { requestAnimationFrame(pollForIframe); return; }

    if (win && win !== lastIframeWindow && !win.__np12) {
      lastIframeWindow = win;
      hookWindow(win);
    }
    requestAnimationFrame(pollForIframe);
  }

  function hookWindow(win) {
    if (win.__np12) return;
    win.__np12 = true;

    const origAEL = win.EventTarget.prototype.addEventListener;
    win.EventTarget.prototype.addEventListener = function(type, listener, options) {
      // Detect digest layer registering on the editor input div
      if ((type === 'beforeinput' || type === 'paste') &&
          this && this.nodeType === 1 && this.getAttribute &&
          this.getAttribute('tabindex') === '0' &&
          this.parentElement && this.parentElement.classList &&
          this.parentElement.classList.contains('ct-input-manager')) {

        const orig = listener;
        if (type === 'beforeinput') {
          listener = function(e) {
            // Digest handler: if files → preventDefault and return (blocks image paste)
            // We skip this for image files
            const dt = e.dataTransfer;
            if (dt && dt.files && dt.files.length &&
                Array.from(dt.files).some(f => f.type.startsWith('image/'))) {
              // Don't block - let event continue to editor's internal handler
              return;
            }
            return orig.apply(this, arguments);
          };
          console.log('[Notes Paste] ✅ Wrapped digest beforeinput handler');
        }
        if (type === 'paste') {
          listener = function(e) {
            // Digest handler: if files → skip text paste (but doesn't handle images)
            // We skip this for image files
            const cd = e.clipboardData;
            if (cd && cd.files && cd.files.length &&
                Array.from(cd.files).some(f => f.type.startsWith('image/'))) {
              return;
            }
            return orig.apply(this, arguments);
          };
          console.log('[Notes Paste] ✅ Wrapped digest paste handler');
        }
      }
      return origAEL.call(this, type, listener, options);
    };

    console.log('[Notes Paste] 🔧 EventTarget.prototype.addEventListener hooked');
  }

  // Start polling immediately at document-start
  pollForIframe();

  // Also use MutationObserver as backup
  const obs = new MutationObserver(() => {
    const iframe = document.querySelector('iframe#early-child, iframe[src*="notes3"]');
    if (iframe) {
      try {
        const win = iframe.contentWindow;
        if (win && !win.__np12) hookWindow(win);
      } catch(e) {}
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
