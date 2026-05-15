// ==UserScript==
// @name         iCloud 备忘录图片粘贴增强
// @namespace    https://www.icloud.com.cn/
// @version      9.0
// @description  启用 iCloud 备忘录 Web 版隐藏的图片粘贴功能
// @match        https://www.icloud.com.cn/notes*
// @match        https://www.icloud.com/notes*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
  'use strict';

  // Strategy: After the notes app loads, find the editor's input div and
  // add a capture-phase paste listener that handles image files directly.
  // The app's digest layer blocks image paste (preventDefault + skip),
  // so we intercept BEFORE it and handle the image ourselves.

  function setup() {
    const iframe = document.querySelector('iframe#early-child');
    if (!iframe) { setTimeout(setup, 1000); return; }

    let doc, win;
    try { doc = iframe.contentDocument; win = iframe.contentWindow; } catch(e) { setTimeout(setup, 1000); return; }
    if (!doc || !win || !win.NotesApp) { setTimeout(setup, 1000); return; }

    const inputDiv = doc.querySelector('.ct-input-manager > [tabindex]');
    if (!inputDiv) { setTimeout(setup, 1000); return; }
    if (inputDiv.__imgPaste) return;
    inputDiv.__imgPaste = true;

    // Add capture-phase paste handler that runs BEFORE the app's digest handler
    inputDiv.addEventListener('paste', function(e) {
      const cd = e.clipboardData;
      if (!cd || !cd.files || !cd.files.length) return;
      const imageFile = Array.from(cd.files).find(f => f.type.startsWith('image/'));
      if (!imageFile) return;

      // Stop the event from reaching the digest handler (which would skip it)
      e.stopImmediatePropagation();
      e.preventDefault();

      // Insert image via the app's internal API
      insertImage(win, doc, imageFile);
    }, {capture: true});

    // Also handle beforeinput to prevent digest from blocking
    inputDiv.addEventListener('beforeinput', function(e) {
      if (e.inputType === 'insertFromPaste') {
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length &&
            Array.from(dt.files).some(f => f.type.startsWith('image/'))) {
          e.stopImmediatePropagation();
          // Don't preventDefault - let the editor handle it if possible
        }
      }
    }, {capture: true});

    console.log('[Notes Paste] ✅ Image paste handler active');
  }

  async function insertImage(win, doc, imageFile) {
    const dm = win.NotesApp.dataManager;

    // Find the currently selected/editing note
    const selectedEl = doc.querySelector('.list-item.is-selected .note-list-item-title, .note-list-item-container.cw-selected .note-list-item-title');
    if (!selectedEl) {
      showToast(doc, '❌ 请先选择一条备忘录');
      return;
    }

    const titleText = selectedEl.innerText.trim();
    let currentNote = null;
    for (const note of dm.allNotes) {
      if (note.Title && note.Title.startsWith(titleText.substring(0, 30))) {
        currentNote = note;
        break;
      }
    }

    if (!currentNote) {
      showToast(doc, '❌ 无法找到当前备忘录');
      return;
    }

    // Convert image to data URL and insert as inline image via the editor
    const reader = new FileReader();
    reader.onload = function() {
      const dataUrl = reader.result;

      // Try to use the app's internal attachment mechanism
      // The editor uses a "topoTextManager" for text operations
      // Since we can't easily call attachmentPaste (featureFlag blocks it),
      // we'll use an alternative: paste as HTML with an <img> tag

      // Create a synthetic paste event with HTML containing the image
      const htmlContent = `<img src="${dataUrl}" style="max-width:100%">`;
      const dt = new DataTransfer();
      dt.setData('text/html', htmlContent);

      // Dispatch as a paste event without files (so digest won't block it)
      const syntheticPaste = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      });

      // Temporarily remove our handler to avoid infinite loop
      const inputDiv = doc.querySelector('.ct-input-manager > [tabindex]');
      inputDiv.__imgPaste = false;
      inputDiv.dispatchEvent(syntheticPaste);
      inputDiv.__imgPaste = true;

      showToast(doc, '✅ 图片已粘贴');
    };
    reader.readAsDataURL(imageFile);
  }

  function showToast(doc, msg) {
    let toast = doc.getElementById('__paste-toast');
    if (!toast) {
      toast = doc.createElement('div');
      toast.id = '__paste-toast';
      toast.style.cssText = 'position:fixed;top:20px;right:20px;padding:10px 16px;background:#333;color:#fff;border-radius:8px;font-size:14px;z-index:99999;transition:opacity 0.3s;pointer-events:none;';
      doc.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    setTimeout(() => { toast.style.opacity = '0'; }, 2000);
  }

  setup();
})();
