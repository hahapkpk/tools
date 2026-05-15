// ==UserScript==
// @name         iCloud 备忘录图片粘贴增强
// @namespace    https://www.icloud.com.cn/
// @version      13.0
// @description  启用 iCloud 备忘录 Web 版隐藏的图片粘贴功能
// @include      https://www.icloud.com.cn/*
// @include      https://www.icloud.com/*
// @grant        none
// @run-at       document-start
// @allFrames    true
// ==/UserScript==

(function() {
  'use strict';

  // This script runs in ALL frames including the notes3 iframe.
  // When running inside the notes3 iframe, we hook addEventListener
  // to bypass the digest layer's image paste blocking,
  // AND we patch the featureFlags by intercepting the Flags class output.

  const isNotesFrame = location.pathname.includes('/applications/notes3/');
  if (!isNotesFrame) return;

  console.log('[Notes Paste] Running in notes3 iframe');

  // HOOK 1: addEventListener - wrap digest handlers for image paste
  const origAEL = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if ((type === 'beforeinput' || type === 'paste') &&
        this.nodeType === 1 && this.getAttribute &&
        this.getAttribute('tabindex') === '0' &&
        this.parentElement && this.parentElement.classList &&
        this.parentElement.classList.contains('ct-input-manager')) {

      const orig = listener;
      if (type === 'beforeinput') {
        listener = function(e) {
          const dt = e.dataTransfer;
          if (dt && dt.files && dt.files.length &&
              Array.from(dt.files).some(f => f.type.startsWith('image/'))) {
            return;
          }
          return orig.apply(this, arguments);
        };
        console.log('[Notes Paste] ✅ Wrapped digest beforeinput');
      }
      if (type === 'paste') {
        listener = function(e) {
          const cd = e.clipboardData;
          if (cd && cd.files && cd.files.length &&
              Array.from(cd.files).some(f => f.type.startsWith('image/'))) {
            return;
          }
          return orig.apply(this, arguments);
        };
        console.log('[Notes Paste] ✅ Wrapped digest paste');
      }
    }
    return origAEL.call(this, type, listener, options);
  };

  // HOOK 2: Patch featureFlags.attachmentInsert
  // The Flags class creates a values object and assigns it: t.featureFlags = a.values
  // We intercept by wrapping Object.defineProperty (webpack uses it for exports)
  const origODP = Object.defineProperty;
  Object.defineProperty = function(obj, prop, desc) {
    const result = origODP.apply(this, arguments);
    // Webpack exports: Object.defineProperty(exports, "__esModule", {value: true})
    // Then later: exports.featureFlags = values
    // Actually webpack uses direct assignment for non-esModule exports.
    // Let's use a Proxy on module exports objects instead.
    return result;
  };

  // Better approach for HOOK 2: intercept the specific pattern
  // The code does: t.featureFlags = a.values where a = new Flags({...})
  // Flags constructor builds a values object. We can intercept Object.create or
  // the Flags constructor itself.
  //
  // Simplest: just poll for the featureFlags object after load
  const patchFlags = () => {
    // The featureFlags is stored as a module export. We can't access webpack modules.
    // But we CAN find it by searching from known objects.
    // Actually, the simplest approach: the editor's beforeInput method references
    // featureFlags via a module-level variable 'v'. If we can find the function
    // and extract 'v' from its scope... not possible in JS.
    //
    // ALTERNATIVE: Override the script loading entirely.
    // Since we're running at document-start IN the iframe, we can block main.js!

    // Check if main.js script tag exists yet
    const scripts = document.querySelectorAll('script[src*="main.js"]');
    if (scripts.length > 0) return; // Too late

    // Block main.js by removing the preload link and intercepting the script
    const preload = document.querySelector('link[href*="main.js"]');
    if (preload) preload.remove();
  };
  patchFlags();

  // HOOK 3: Block and replace main.js script tag
  const observer = new MutationObserver(muts => {
    for (const m of muts) for (const node of m.addedNodes) {
      if (node.tagName === 'SCRIPT' && node.src && node.src.includes('main.js')) {
        // Block execution
        const origSrc = node.src;
        node.removeAttribute('src');
        node.type = 'text/blocked';
        observer.disconnect();

        // Fetch, patch, and execute
        fetch(origSrc).then(r => r.text()).then(src => {
          let patched = src.replace(
            'attachmentInsert:{configurable:!1,type:Boolean,value:!1}',
            'attachmentInsert:{configurable:!1,type:Boolean,value:!0}'
          );
          if (patched !== src) {
            console.log('[Notes Paste] ✅ attachmentInsert patched to true');
          } else {
            console.warn('[Notes Paste] ⚠️ Pattern not found');
          }
          const s = document.createElement('script');
          s.textContent = patched;
          (document.head || document.documentElement).appendChild(s);
        }).catch(err => {
          console.error('[Notes Paste] ❌ Failed:', err);
          // Restore original
          node.type = 'text/javascript';
          node.src = origSrc;
        });
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
