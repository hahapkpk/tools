// ==UserScript==
// @name         iCloud 备忘录图片粘贴增强
// @namespace    https://www.icloud.com.cn/
// @version      7.1
// @description  启用 iCloud 备忘录 Web 版隐藏的图片粘贴功能
// @match        https://www.icloud.com.cn/notes*
// @match        https://www.icloud.com.cn/applications/notes3/*
// @match        https://www.icloud.com/notes*
// @match        https://www.icloud.com/applications/notes3/*
// @noframes     false
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
  'use strict';

  const isNotesApp = location.pathname.includes('/applications/notes3/');

  if (isNotesApp) {
    patchNotesApp();
  } else if (location.pathname.includes('/notes')) {
    patchMainPage();
  }

  // === Inside notes3 iframe: intercept and patch main.js ===
  function patchNotesApp() {
    const origAppendChild = Node.prototype.appendChild;
    const origInsertBefore = Node.prototype.insertBefore;

    function tryPatchScript(script) {
      if (!script || script.tagName !== 'SCRIPT' || script.__np) return false;
      if (!script.src || !script.src.includes('main.js')) return false;
      script.__np = true;

      const origSrc = script.src;
      script.removeAttribute('src');
      script.type = 'text/plain'; // Block execution

      fetch(origSrc).then(r => r.text()).then(src => {
        let patched = src;

        // Patch 1: attachmentInsert flag
        patched = patched.replace(
          'attachmentInsert:{configurable:!1,type:Boolean,value:!1}',
          'attachmentInsert:{configurable:!1,type:Boolean,value:!0}'
        );

        // Patch 2: digest beforeinput - don't block file paste
        // Original: if(null===(r=n.dataTransfer)||void 0===r?void 0:r.files.length)n.preventDefault()
        // Replace with: noop (let it through to editor handler)
        patched = patched.replace(
          'if(null===(r=n.dataTransfer)||void 0===r?void 0:r.files.length)n.preventDefault()',
          'if(null===(r=n.dataTransfer)||void 0===r?void 0:r.files.length){/* paste-patch: pass through */}'
        );

        // Patch 3: digest paste - don't skip file paste
        // Original: (null===(r=n.clipboardData)||void 0===r?void 0:r.files.length)||e.paste(...)
        // This means: if files exist, skip e.paste(). We want it to NOT skip.
        // Actually this is fine - the paste handler for text doesn't need to run for images.
        // The editor's own beforeInput handler will handle it now that featureFlag is true.

        if (patched !== src) {
          console.log('[Notes Paste] ✅ Patches applied');
        } else {
          console.warn('[Notes Paste] ⚠️ No patches matched');
        }

        const s = document.createElement('script');
        s.__np = true;
        s.textContent = patched;
        (document.head || document.documentElement).appendChild(s);
      }).catch(err => {
        console.error('[Notes Paste] ❌ Failed:', err);
        script.type = 'text/javascript';
        script.src = origSrc;
      });

      return true;
    }

    // Hook appendChild/insertBefore
    Node.prototype.appendChild = function(child) {
      if (child && child.tagName === 'SCRIPT' && tryPatchScript(child)) {
        return origAppendChild.call(this, child);
      }
      return origAppendChild.call(this, child);
    };
    Node.prototype.insertBefore = function(child, ref) {
      if (child && child.tagName === 'SCRIPT' && tryPatchScript(child)) {
        return origInsertBefore.call(this, child, ref);
      }
      return origInsertBefore.call(this, child, ref);
    };

    // MutationObserver for scripts already in HTML
    new MutationObserver(muts => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.tagName === 'SCRIPT') tryPatchScript(n);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });

    console.log('[Notes Paste] 🔧 Interceptor active in notes3 iframe');
  }

  // === Main page: ensure iframe gets patched ===
  function patchMainPage() {
    // Tampermonkey should auto-run in the iframe via @match
    // But as fallback, we can also try to inject into iframe manually
    console.log('[Notes Paste] Main page ready (iframe patched via @match)');
  }
})();
