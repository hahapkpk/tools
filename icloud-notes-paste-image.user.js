// ==UserScript==
// @name         iCloud 备忘录图片粘贴增强
// @namespace    https://www.icloud.com.cn/
// @version      1.0
// @description  让从其他地方复制的图片能直接粘贴到 iCloud 备忘录文本中
// @match        https://www.icloud.com.cn/notes*
// @match        https://www.icloud.com/notes*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  function setupPasteHandler(doc) {
    doc.addEventListener('paste', async (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;

      // Check if clipboard contains image
      let imageItem = null;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          imageItem = item;
          break;
        }
      }
      if (!imageItem) return;

      // Check if we're in the editor (ct-input-manager is focused)
      const active = doc.activeElement;
      const inputDiv = doc.querySelector('.ct-input-manager > [tabindex]');
      if (!inputDiv || (active !== inputDiv && !inputDiv.contains(active))) return;

      // The native handler should pick it up, but if it doesn't,
      // re-dispatch the event directly to the input div
      if (e.target !== inputDiv && !inputDiv.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();

        const blob = imageItem.getAsFile();
        const dt = new DataTransfer();
        dt.items.add(blob);

        const newEvent = new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: dt
        });
        inputDiv.dispatchEvent(newEvent);
      }
    }, true);
  }

  // Wait for the notes iframe to load
  function init() {
    const iframe = document.querySelector('iframe#early-child');
    if (!iframe) {
      setTimeout(init, 1000);
      return;
    }

    const trySetup = () => {
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        if (!iframeDoc.querySelector('.ct-input-manager')) {
          setTimeout(trySetup, 1000);
          return;
        }
        setupPasteHandler(iframeDoc);
        console.log('[iCloud Notes Paste] 图片粘贴增强已启用');
      } catch (e) {
        setTimeout(trySetup, 1000);
      }
    };

    iframe.addEventListener('load', trySetup);
    trySetup();
  }

  // Also handle paste at the top document level and forward to iframe
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;

    let hasImage = false;
    for (const item of items) {
      if (item.type.startsWith('image/')) { hasImage = true; break; }
    }
    if (!hasImage) return;

    const iframe = document.querySelector('iframe#early-child');
    if (!iframe) return;

    try {
      const iframeDoc = iframe.contentDocument;
      const inputDiv = iframeDoc.querySelector('.ct-input-manager > [tabindex]');
      if (!inputDiv) return;

      // If the iframe editor is active, forward the paste
      const iframeActive = iframeDoc.activeElement;
      if (iframeActive === inputDiv || (inputDiv.contains && inputDiv.contains(iframeActive))) {
        // Already handled inside iframe, skip
        return;
      }

      // Focus the editor and forward paste
      inputDiv.focus();
      e.preventDefault();

      const imageItem = Array.from(items).find(i => i.type.startsWith('image/'));
      const blob = imageItem.getAsFile();
      const dt = new DataTransfer();
      dt.items.add(blob);

      const newEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      });
      inputDiv.dispatchEvent(newEvent);
    } catch (err) {
      // cross-origin or not ready
    }
  }, true);

  init();
})();
