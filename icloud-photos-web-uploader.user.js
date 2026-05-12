// ==UserScript==
// @name         iCloud Photos Web Uploader
// @namespace    https://github.com/hahapkpk/tools
// @version      1.3.0
// @description  Adds a paste, drag-and-drop, and quick-pick upload panel to iCloud Photos on the web.
// @author       FlyWind
// @match        https://www.icloud.com/photos*
// @match        https://www.icloud.com.cn/photos*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function (root, factory) {
  const api = factory(root);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }

  api.bootstrap();
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const PANEL_ID = 'icloud-web-uploader-panel';
  const LOG_PREFIX = '[iCloud Photos Web Uploader]';
  const POSITION_KEY = 'icloud-web-uploader-position';
  const SIZE_KEY = 'icloud-web-uploader-size';
  const IMAGE_EXTENSIONS = /\.(apng|avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i;
  const JPEG_EXTENSIONS = /\.jpe?g$/i;
  const JPEG_QUALITY = 0.92;
  const PANEL_TEXT = {
    title: 'iCloud 快速上传',
    closeTitle: '隐藏',
    dropText: '拖拽图片到这里，或粘贴截图/选择文件。',
    pickButton: '选择图片',
    detectButton: '检测',
    waiting: '等待图片。',
  };

  function getPanelText() {
    return Object.assign({}, PANEL_TEXT);
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function getImageExtension(type, fallbackName) {
    const byType = {
      'image/apng': 'apng',
      'image/avif': 'avif',
      'image/bmp': 'bmp',
      'image/gif': 'gif',
      'image/heic': 'heic',
      'image/heif': 'heif',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/tiff': 'tiff',
      'image/webp': 'webp',
    };

    const normalizedType = String(type || '').toLowerCase();
    if (byType[normalizedType]) return byType[normalizedType];

    const match = String(fallbackName || '').match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : 'png';
  }

  function isImageLikeFile(file) {
    if (!file) return false;
    const type = String(file.type || '').toLowerCase();
    if (type.startsWith('image/')) return true;
    return IMAGE_EXTENSIONS.test(String(file.name || ''));
  }

  function isJpegLikeFile(file) {
    if (!file) return false;
    const type = String(file.type || '').toLowerCase();
    if (type === 'image/jpeg' || type === 'image/jpg') return true;
    return JPEG_EXTENSIONS.test(String(file.name || ''));
  }

  function shouldConvertForICloudWeb(file) {
    return isImageLikeFile(file) && !isJpegLikeFile(file);
  }

  function getConvertedJpegFileName(name) {
    const sourceName = String(name || 'icloud-upload-image').trim() || 'icloud-upload-image';
    const withoutExtension = sourceName.replace(/\.[^.\\/]+$/, '');
    return withoutExtension + '.jpg';
  }

  function createNamedImageFile(blob, now) {
    const date = now || new Date();
    const ext = getImageExtension(blob && blob.type, blob && blob.name);
    const name = [
      'icloud-screenshot-',
      date.getUTCFullYear(),
      pad2(date.getUTCMonth() + 1),
      pad2(date.getUTCDate()),
      '-',
      pad2(date.getUTCHours()),
      pad2(date.getUTCMinutes()),
      pad2(date.getUTCSeconds()),
      '.',
      ext,
    ].join('');

    if (typeof root.File === 'function') {
      return new root.File([blob], name, {
        type: blob && blob.type ? blob.type : 'image/' + ext,
        lastModified: Date.now(),
      });
    }

    return {
      name,
      type: blob && blob.type ? blob.type : 'image/' + ext,
      size: blob && blob.size ? blob.size : 0,
      _source: blob,
    };
  }

  function extractImageFilesFromPaste(event, now) {
    const items = event && event.clipboardData && event.clipboardData.items;
    if (!items) return [];

    const files = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!item || item.kind !== 'file' || typeof item.getAsFile !== 'function') continue;

      const file = item.getAsFile();
      if (isImageLikeFile(file)) {
        files.push(createNamedImageFile(file, now));
      }
    }

    return files;
  }

  function filterImageFiles(fileList) {
    return Array.from(fileList || []).filter(isImageLikeFile);
  }

  function createFileFromBlob(blob, name, win) {
    const FileCtor = win && win.File ? win.File : root.File;
    if (typeof FileCtor === 'function') {
      return new FileCtor([blob], name, {
        type: 'image/jpeg',
        lastModified: Date.now(),
      });
    }

    blob.name = name;
    return blob;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      if (!canvas || typeof canvas.toBlob !== 'function') {
        reject(new Error('Canvas JPEG conversion is not available in this browser.'));
        return;
      }

      canvas.toBlob(function (blob) {
        if (!blob) reject(new Error('Could not convert image to JPEG.'));
        else resolve(blob);
      }, type, quality);
    });
  }

  function loadImageElement(file, win) {
    return new Promise(function (resolve, reject) {
      const doc = win.document || root.document;
      const ImageCtor = win.Image || root.Image;
      const urlApi = win.URL || root.URL;

      if (!doc || !ImageCtor || !urlApi || typeof urlApi.createObjectURL !== 'function') {
        reject(new Error('Image decoding is not available in this browser.'));
        return;
      }

      const url = urlApi.createObjectURL(file);
      const image = new ImageCtor();
      image.onload = function () {
        urlApi.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = function () {
        urlApi.revokeObjectURL(url);
        reject(new Error('Could not decode image: ' + (file.name || 'unnamed file')));
      };
      image.src = url;
    });
  }

  async function decodeImageForCanvas(file, win) {
    if (win && typeof win.createImageBitmap === 'function') {
      return win.createImageBitmap(file);
    }
    return loadImageElement(file, win || root);
  }

  async function convertImageFileToJpeg(file, win) {
    const actualWindow = win || root;
    const doc = actualWindow.document || root.document;
    if (!doc || typeof doc.createElement !== 'function') {
      throw new Error('Canvas JPEG conversion is not available in this browser.');
    }

    const image = await decodeImageForCanvas(file, actualWindow);
    const width = image.width || image.naturalWidth;
    const height = image.height || image.naturalHeight;
    if (!width || !height) throw new Error('Could not read image dimensions: ' + (file.name || 'unnamed file'));

    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D rendering is not available in this browser.');

    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    if (typeof image.close === 'function') image.close();

    const blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
    return createFileFromBlob(blob, getConvertedJpegFileName(file.name), actualWindow);
  }

  async function normalizeFilesForICloudWebUpload(files, win, status, converter) {
    const images = filterImageFiles(files);
    const normalized = [];
    let convertedCount = 0;
    const convert = converter || convertImageFileToJpeg;

    for (let i = 0; i < images.length; i += 1) {
      const file = images[i];
      if (!shouldConvertForICloudWeb(file)) {
        normalized.push(file);
        continue;
      }

      status('正在转换为 iCloud.com 支持的 JPEG：' + (file.name || '图片'));
      try {
        normalized.push(await convert(file, win));
        convertedCount += 1;
      } catch (error) {
        throw new Error(
          '无法将“' + (file.name || '图片') + '”转换为 JPEG。' +
            '当前浏览器可能无法解码这个源格式。详情：' + error.message
        );
      }
    }

    if (convertedCount) {
      status('已将 ' + convertedCount + ' 张图片转换为 JPEG。');
    }

    return normalized;
  }

  function describeFiles(files) {
    if (!files.length) return '没有选择图片文件。';
    if (files.length === 1) return '已准备：' + files[0].name;
    return '已准备：' + files.length + ' 张图片';
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function calculateDraggedPanelPosition(options) {
    const margin = typeof options.margin === 'number' ? options.margin : 8;
    const maxLeft = Math.max(margin, options.viewportWidth - options.panelWidth - margin);
    const maxTop = Math.max(margin, options.viewportHeight - options.panelHeight - margin);
    return {
      left: clamp(options.pointerX - options.offsetX, margin, maxLeft),
      top: clamp(options.pointerY - options.offsetY, margin, maxTop),
    };
  }

  function calculatePanelSize(options) {
    const margin = typeof options.margin === 'number' ? options.margin : 8;
    const minWidth = typeof options.minWidth === 'number' ? options.minWidth : 260;
    const minHeight = typeof options.minHeight === 'number' ? options.minHeight : 220;
    const maxWidth = Math.max(minWidth, options.viewportWidth - margin * 2);
    const maxHeight = Math.max(minHeight, options.viewportHeight - margin * 2);
    return {
      width: clamp(options.width, minWidth, maxWidth),
      height: clamp(options.height, minHeight, maxHeight),
    };
  }

  function queryAllDeep(rootNode, selector) {
    const results = [];
    const seen = new Set();

    function walk(node) {
      if (!node || seen.has(node) || typeof node.querySelectorAll !== 'function') return;
      seen.add(node);

      results.push.apply(results, Array.from(node.querySelectorAll(selector)));

      Array.from(node.querySelectorAll('*')).forEach(function (element) {
        if (element.shadowRoot) walk(element.shadowRoot);
      });

      Array.from(node.querySelectorAll('iframe, frame')).forEach(function (frame) {
        try {
          if (frame.contentDocument) walk(frame.contentDocument);
          else if (frame.contentWindow && frame.contentWindow.document) walk(frame.contentWindow.document);
        } catch (error) {
          // Cross-origin frames cannot be inspected. Continue with accessible DOM.
        }
      });
    }

    walk(rootNode);
    return results;
  }

  function findICloudFileInput(doc) {
    const inputs = queryAllDeep(doc, 'input[type="file"]').filter(function (input) {
      return !(typeof input.closest === 'function' && input.closest('#' + PANEL_ID));
    });
    if (!inputs.length) return null;

    const preferred = inputs.find(function (input) {
      const accept = String(input.getAttribute('accept') || '').toLowerCase();
      return accept.includes('image') || accept.includes('video') || input.multiple;
    });

    return preferred || inputs[0];
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function waitForICloudFileInput(doc, timeoutMs, intervalMs) {
    const deadline = Date.now() + (timeoutMs || 2500);
    const interval = intervalMs || 80;
    let input = findICloudFileInput(doc);

    while (!input && Date.now() < deadline) {
      await sleep(interval);
      input = findICloudFileInput(doc);
    }

    return input;
  }

  function isUploadTrigger(element) {
    const label = [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.textContent,
    ].join(' ').toLowerCase();

    return (
      label.includes('upload') ||
      label.includes('add photos') ||
      label.includes('add photo') ||
      label.includes('上传') ||
      label.includes('加入') ||
      label.includes('添加')
    );
  }

  function clickPossibleUploadTrigger(doc) {
    const candidates = queryAllDeep(doc, 'button, [role="button"], [aria-label], [title]').filter(function (element) {
      return !(typeof element.closest === 'function' && element.closest('#' + PANEL_ID));
    });
    const trigger = candidates.find(isUploadTrigger);
    if (!trigger || typeof trigger.click !== 'function') return false;
    trigger.click();
    return true;
  }

  function transferFilesToInput(input, files, win) {
    if (!input || !files.length) return false;

    const WindowDataTransfer = win && win.DataTransfer;
    if (typeof WindowDataTransfer !== 'function') return false;

    const transfer = new WindowDataTransfer();
    files.forEach(function (file) {
      transfer.items.add(file);
    });

    input.files = transfer.files;
    const EventCtor = (win && win.Event) || root.Event;
    const inputEvent = typeof EventCtor === 'function' ? new EventCtor('input', { bubbles: true }) : { type: 'input' };
    const changeEvent = typeof EventCtor === 'function' ? new EventCtor('change', { bubbles: true }) : { type: 'change' };
    input.dispatchEvent(inputEvent);
    input.dispatchEvent(changeEvent);
    return true;
  }

  function createDataTransfer(files, win) {
    const WindowDataTransfer = win && win.DataTransfer;
    if (typeof WindowDataTransfer !== 'function') return null;

    const transfer = new WindowDataTransfer();
    files.forEach(function (file) {
      transfer.items.add(file);
    });
    return transfer;
  }

  function createDragEvent(type, transfer, win) {
    const DragEventCtor = win && win.DragEvent;
    if (typeof DragEventCtor === 'function') {
      return new DragEventCtor(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      });
    }

    const EventCtor = (win && win.Event) || root.Event;
    const event = typeof EventCtor === 'function' ? new EventCtor(type, { bubbles: true, cancelable: true }) : { type };
    try {
      Object.defineProperty(event, 'dataTransfer', {
        value: transfer,
      });
    } catch (error) {
      event.dataTransfer = transfer;
    }
    return event;
  }

  function getDropTargets(doc) {
    const targets = [];
    ['[data-testid*="drop" i]', '[class*="drop" i]', '[role="main"]', 'main', '#root', '#app'].forEach(function (selector) {
      queryAllDeep(doc, selector).forEach(function (element) {
        if (targets.indexOf(element) === -1) targets.push(element);
      });
    });

    if (doc.body && targets.indexOf(doc.body) === -1) targets.push(doc.body);
    if (doc.documentElement && targets.indexOf(doc.documentElement) === -1) targets.push(doc.documentElement);
    return targets;
  }

  function dropFilesOnICloudPage(files, doc, win) {
    const transfer = createDataTransfer(files, win);
    if (!transfer) return false;

    const targets = getDropTargets(doc);
    if (!targets.length) return false;

    const eventTypes = ['dragenter', 'dragover', 'drop'];
    targets.forEach(function (target) {
      eventTypes.forEach(function (type) {
        const event = createDragEvent(type, transfer, win);
        if (type === 'dragover' && typeof event.preventDefault === 'function') event.preventDefault();
        target.dispatchEvent(event);
      });
    });

    return true;
  }

  async function uploadViaICloudPage(files, doc, win, status) {
    let images = filterImageFiles(files);
    if (!images.length) {
      status('这里只能上传图片文件。', true);
      return false;
    }

    try {
      images = await normalizeFilesForICloudWebUpload(images, win, status);
    } catch (error) {
      status(error.message, true);
      return false;
    }

    let input = findICloudFileInput(doc);
    if (!input) {
      status('正在打开 iCloud 上传控件...');
      const clickedUploadTrigger = clickPossibleUploadTrigger(doc);
      input = clickedUploadTrigger ? await waitForICloudFileInput(doc, 3000) : null;
    }

    if (!input) {
      status('找不到 iCloud 上传控件，正在尝试拖拽上传通道...');
      if (dropFilesOnICloudPage(images, doc, win)) {
        status('已通过拖拽上传通道发送：' + images.length + ' 张图片。');
        return true;
      }
      status('找不到可用的 iCloud 上传入口。请确认当前页面已经登录并停留在“照片”图库视图。', true);
      return false;
    }

    const transferred = transferFilesToInput(input, images, win);
    if (!transferred) {
      status('浏览器阻止了自动交接。请使用“选择图片”按钮手动选择。', true);
      return false;
    }

    status('已发送到 iCloud 上传队列：' + images.length + ' 张图片。');
    return true;
  }

  function injectStyles(doc) {
    if (doc.getElementById(PANEL_ID + '-style')) return;

    const style = doc.createElement('style');
    style.id = PANEL_ID + '-style';
    style.textContent = [
      '#' + PANEL_ID + '{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:320px;',
      'font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1d1d1f;',
      'background:rgba(255,255,255,.96);border:1px solid rgba(0,0,0,.14);border-radius:10px;',
      'box-shadow:0 10px 30px rgba(0,0,0,.22);overflow:auto;touch-action:none;',
      'resize:both;min-width:260px;min-height:220px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px)}',
      '#' + PANEL_ID + '.is-moving{user-select:none}',
      '#' + PANEL_ID + ' .iu-head{display:flex;align-items:center;justify-content:space-between;',
      'padding:10px 12px;background:#f5f5f7;font-weight:700;cursor:move}',
      '#' + PANEL_ID + ' .iu-body{padding:12px}',
      '#' + PANEL_ID + ' .iu-drop{border:1px dashed #8e8e93;border-radius:8px;padding:14px 10px;',
      'text-align:center;background:#fff;min-height:62px;display:flex;align-items:center;justify-content:center}',
      '#' + PANEL_ID + ' .iu-drop.is-dragging{border-color:#007aff;background:#eef6ff}',
      '#' + PANEL_ID + ' .iu-actions{display:flex;gap:8px;margin-top:10px}',
      '#' + PANEL_ID + ' button{appearance:none;border:1px solid rgba(0,0,0,.16);border-radius:7px;',
      'background:#fff;color:#1d1d1f;padding:7px 10px;cursor:pointer;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-align:center;white-space:nowrap}',
      '#' + PANEL_ID + ' button.iu-primary{background:#007aff;border-color:#007aff;color:#fff;flex:1}',
      '#' + PANEL_ID + ' button.iu-upload{min-width:74px}',
      '#' + PANEL_ID + ' .iu-status{margin-top:10px;color:#515154;word-break:break-word}',
      '#' + PANEL_ID + ' .iu-status.is-error{color:#b00020}',
      '#' + PANEL_ID + ' .iu-close{border:0;background:transparent;padding:0 4px;font-size:18px;line-height:1;cursor:pointer}',
      '#' + PANEL_ID + ' input{display:none}',
    ].join('');
    doc.head.appendChild(style);
  }

  function getPointerPoint(event) {
    const touch = event.touches && event.touches[0] ? event.touches[0] : null;
    const changedTouch = event.changedTouches && event.changedTouches[0] ? event.changedTouches[0] : null;
    const point = touch || changedTouch || event;
    return {
      x: point.clientX,
      y: point.clientY,
    };
  }

  function loadSavedPosition(win) {
    try {
      const raw = win.localStorage && win.localStorage.getItem(POSITION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function savePosition(win, position) {
    try {
      if (win.localStorage) win.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
    } catch (error) {
      // Ignore storage failures; dragging still works for the current page.
    }
  }

  function loadSavedSize(win) {
    try {
      const raw = win.localStorage && win.localStorage.getItem(SIZE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number') return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function saveSize(win, size) {
    try {
      if (win.localStorage) win.localStorage.setItem(SIZE_KEY, JSON.stringify(size));
    } catch (error) {
      // Ignore storage failures; resizing still works for the current page.
    }
  }

  function applyPanelSize(panel, size) {
    panel.style.width = size.width + 'px';
    panel.style.height = size.height + 'px';
  }

  function enablePanelResizePersistence(panel, win) {
    const savedSize = loadSavedSize(win);
    if (savedSize) {
      applyPanelSize(
        panel,
        calculatePanelSize({
          width: savedSize.width,
          height: savedSize.height,
          viewportWidth: win.innerWidth || savedSize.width,
          viewportHeight: win.innerHeight || savedSize.height,
          margin: 8,
        })
      );
    }

    const ResizeObserverCtor = win.ResizeObserver || root.ResizeObserver;
    if (typeof ResizeObserverCtor !== 'function') return;

    const observer = new ResizeObserverCtor(function (entries) {
      const entry = entries && entries[0];
      if (!entry || !entry.contentRect) return;
      saveSize(win, {
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });
    });
    observer.observe(panel);
  }

  function applyPanelPosition(panel, position) {
    panel.style.left = position.left + 'px';
    panel.style.top = position.top + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function enablePanelDragging(panel, handle, win) {
    let dragState = null;

    const savedPosition = loadSavedPosition(win);
    if (savedPosition) applyPanelPosition(panel, savedPosition);

    function move(event) {
      if (!dragState) return;
      event.preventDefault();
      const point = getPointerPoint(event);
      const position = calculateDraggedPanelPosition({
        pointerX: point.x,
        pointerY: point.y,
        offsetX: dragState.offsetX,
        offsetY: dragState.offsetY,
        panelWidth: dragState.panelWidth,
        panelHeight: dragState.panelHeight,
        viewportWidth: win.innerWidth || dragState.viewportWidth,
        viewportHeight: win.innerHeight || dragState.viewportHeight,
        margin: 8,
      });
      applyPanelPosition(panel, position);
      dragState.lastPosition = position;
    }

    function stop() {
      if (!dragState) return;
      panel.classList.remove('is-moving');
      if (dragState.lastPosition) savePosition(win, dragState.lastPosition);
      dragState = null;
      win.removeEventListener('mousemove', move, true);
      win.removeEventListener('mouseup', stop, true);
      win.removeEventListener('touchmove', move, true);
      win.removeEventListener('touchend', stop, true);
      win.removeEventListener('touchcancel', stop, true);
    }

    function start(event) {
      if (event.target && typeof event.target.closest === 'function' && event.target.closest('button')) return;
      const point = getPointerPoint(event);
      const rect = panel.getBoundingClientRect();
      dragState = {
        offsetX: point.x - rect.left,
        offsetY: point.y - rect.top,
        panelWidth: rect.width,
        panelHeight: rect.height,
        viewportWidth: win.innerWidth || rect.right,
        viewportHeight: win.innerHeight || rect.bottom,
        lastPosition: { left: rect.left, top: rect.top },
      };
      panel.classList.add('is-moving');
      event.preventDefault();
      win.addEventListener('mousemove', move, true);
      win.addEventListener('mouseup', stop, true);
      win.addEventListener('touchmove', move, true);
      win.addEventListener('touchend', stop, true);
      win.addEventListener('touchcancel', stop, true);
    }

    handle.addEventListener('mousedown', start);
    handle.addEventListener('touchstart', start, { passive: false });
  }

  function createPanel(doc, win) {
    const existing = doc.getElementById(PANEL_ID);
    if (existing) return existing;

    injectStyles(doc);

    const panel = doc.createElement('section');
    panel.id = PANEL_ID;
    const text = getPanelText();
    panel.innerHTML = [
      '<div class="iu-head"><span>' + text.title + '</span><button class="iu-close" type="button" title="' + text.closeTitle + '">x</button></div>',
      '<div class="iu-body">',
      '<div class="iu-drop" tabindex="0">' + text.dropText + '</div>',
      '<div class="iu-actions">',
      '<button class="iu-primary" type="button">' + text.pickButton + '</button>',
      '<button type="button" class="iu-upload">' + text.detectButton + '</button>',
      '</div>',
      '<div class="iu-status">' + text.waiting + '</div>',
      '<input type="file" accept="image/*,.heic,.heif" multiple>',
      '</div>',
    ].join('');

    const head = panel.querySelector('.iu-head');
    const drop = panel.querySelector('.iu-drop');
    const picker = panel.querySelector('input[type="file"]');
    const pickButton = panel.querySelector('.iu-primary');
    const findButton = panel.querySelector('.iu-upload');
    const closeButton = panel.querySelector('.iu-close');
    const statusEl = panel.querySelector('.iu-status');

    enablePanelDragging(panel, head, win);
    enablePanelResizePersistence(panel, win);

    function status(message, isError) {
      statusEl.textContent = message;
      statusEl.classList.toggle('is-error', Boolean(isError));
      if (isError) console.warn(LOG_PREFIX, message);
      else console.log(LOG_PREFIX, message);
    }

    async function send(files) {
      status(describeFiles(files));
      await uploadViaICloudPage(files, doc, win, status);
    }

    pickButton.addEventListener('click', function () {
      picker.click();
    });

    picker.addEventListener('change', function () {
      send(picker.files);
      picker.value = '';
    });

    findButton.addEventListener('click', async function () {
      status('正在检测 iCloud 上传控件...');
      let found = findICloudFileInput(doc);
      if (!found) {
        clickPossibleUploadTrigger(doc);
        found = await waitForICloudFileInput(doc, 3000);
      }
      status(found ? '已找到 iCloud 上传控件。' : '暂未找到上传控件。', !found);
    });

    closeButton.addEventListener('click', function () {
      panel.remove();
    });

    drop.addEventListener('dragover', function (event) {
      event.preventDefault();
      drop.classList.add('is-dragging');
    });

    drop.addEventListener('dragleave', function () {
      drop.classList.remove('is-dragging');
    });

    drop.addEventListener('drop', function (event) {
      event.preventDefault();
      drop.classList.remove('is-dragging');
      send(event.dataTransfer && event.dataTransfer.files);
    });

    doc.addEventListener('paste', function (event) {
      const files = extractImageFilesFromPaste(event);
      if (!files.length) return;
      event.preventDefault();
      send(files);
    });

    doc.body.appendChild(panel);
    return panel;
  }

  function bootstrap() {
    const doc = root.document;
    if (!doc || !doc.body) return;
    createPanel(doc, root.window || root);
  }

  return {
    bootstrap,
    createNamedImageFile,
    calculateDraggedPanelPosition,
    calculatePanelSize,
    convertImageFileToJpeg,
    dropFilesOnICloudPage,
    extractImageFilesFromPaste,
    filterImageFiles,
    findICloudFileInput,
    getConvertedJpegFileName,
    getPanelText,
    isJpegLikeFile,
    isImageLikeFile,
    normalizeFilesForICloudWebUpload,
    shouldConvertForICloudWeb,
    transferFilesToInput,
    uploadViaICloudPage,
    waitForICloudFileInput,
  };
});
