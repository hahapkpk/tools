// ==UserScript==
// @name         iCloud Photos Web Uploader
// @namespace    https://github.com/hahapkpk/tools
// @version      1.10.7
// @description  Upload via paste/drag/pick on iCloud Photos, with auto JPEG conversion, quick library refresh, and mouse-wheel zoom / drag-pan in the image preview.
// @author       FlyWind
// @match        https://www.icloud.com/photos*
// @match        https://www.icloud.com.cn/photos*
// @match        https://www.icloud.com/applications/photos*
// @match        https://www.icloud.com.cn/applications/photos*
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
  const IMAGE_EXTENSIONS = /\.(apng|avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i;
  const JPEG_EXTENSIONS = /\.jpe?g$/i;
  const JPEG_QUALITY = 0.92;
  const PANEL_TEXT = {
    title: 'iCloud 上传',
    tooltip: '点击选择 · 粘贴 · 拖拽',
    waiting: '等待图片',
    ready: '已就绪',
    uploading: '处理中…',
    closeTitle: '隐藏',
  };

  function getPanelText() {
    return Object.assign({}, PANEL_TEXT);
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function pad3(value) {
    return String(value).padStart(3, '0');
  }

  let imageSequence = 0;

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
      'image/svg+xml': 'svg',
      'image/tiff': 'tiff',
      'image/vnd.microsoft.icon': 'ico',
      'image/webp': 'webp',
      'image/x-icon': 'ico',
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
    imageSequence = (imageSequence + 1) & 0xffff;
    const name = [
      'icloud-screenshot-',
      date.getUTCFullYear(),
      pad2(date.getUTCMonth() + 1),
      pad2(date.getUTCDate()),
      '-',
      pad2(date.getUTCHours()),
      pad2(date.getUTCMinutes()),
      pad2(date.getUTCSeconds()),
      '-',
      pad3(date.getUTCMilliseconds()),
      '-',
      imageSequence.toString(16).padStart(4, '0'),
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
      try {
        return await win.createImageBitmap(file);
      } catch (error) {
        // createImageBitmap commonly fails on SVG and ICO; fall back to <img>.
      }
    }
    return loadImageElement(file, win || root);
  }

  function isSvgFile(file) {
    if (!file) return false;
    const type = String(file.type || '').toLowerCase();
    if (type === 'image/svg+xml') return true;
    return /\.svg$/i.test(String(file.name || ''));
  }

  // SVGs may report 0x0 when their <svg> root has no width/height/viewBox.
  // Pick a reasonable raster size in that case so the JPEG output is usable.
  const SVG_DEFAULT_RASTER_PX = 1024;

  async function convertImageFileToJpeg(file, win) {
    const actualWindow = win || root;
    const doc = actualWindow.document || root.document;
    if (!doc || typeof doc.createElement !== 'function') {
      throw new Error('Canvas JPEG conversion is not available in this browser.');
    }

    const image = await decodeImageForCanvas(file, actualWindow);
    let width = image.width || image.naturalWidth;
    let height = image.height || image.naturalHeight;

    if ((!width || !height) && isSvgFile(file)) {
      width = SVG_DEFAULT_RASTER_PX;
      height = SVG_DEFAULT_RASTER_PX;
    }

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

  const LIBRARY_SIDEBAR_LABELS = [
    '图库', '所有照片', '照片', 'Library', 'All Photos', 'Photos',
  ];
  const PIVOT_SIDEBAR_LABELS = [
    '最近项目', '最近', '个人收藏', '回忆', '相簿', '媒体类型',
    'Recents', 'Recent', 'Favorites', 'Memories', 'Albums', 'Media Types',
  ];

  function normalizeLabelText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function findSidebarItem(doc, labels) {
    const normalizedLabels = labels.map(normalizeLabelText);
    const ownPanel = doc.getElementById ? doc.getElementById(PANEL_ID) : null;
    const candidates = queryAllDeep(
      doc,
      'a, button, [role="button"], [role="menuitem"], [role="tab"], [role="treeitem"]'
    );
    for (let i = 0; i < candidates.length; i += 1) {
      const element = candidates[i];
      if (ownPanel && typeof ownPanel.contains === 'function' && ownPanel.contains(element)) continue;
      if (typeof element.click !== 'function') continue;
      const text = normalizeLabelText(element.textContent);
      if (!text) continue;
      for (let j = 0; j < normalizedLabels.length; j += 1) {
        const label = normalizedLabels[j];
        if (text === label || text.indexOf(label + ' ') === 0 || text.indexOf(label) === 0) {
          return element;
        }
      }
    }
    return null;
  }

  function findActiveSidebarItem(doc) {
    const ownPanel = doc.getElementById ? doc.getElementById(PANEL_ID) : null;
    const allLabels = LIBRARY_SIDEBAR_LABELS.concat(PIVOT_SIDEBAR_LABELS, [
      '隐藏', '最近删除', 'Hidden', 'Recently Deleted',
    ]).map(normalizeLabelText);
    const activeSelectors = [
      '[aria-current="page"]',
      '[aria-current="true"]',
      '[aria-selected="true"]',
      '.is-selected',
      '.selected',
      '.is-active',
      '.active',
    ];
    for (let i = 0; i < activeSelectors.length; i += 1) {
      const els = queryAllDeep(doc, activeSelectors[i]);
      for (let j = 0; j < els.length; j += 1) {
        const el = els[j];
        if (ownPanel && typeof ownPanel.contains === 'function' && ownPanel.contains(el)) continue;
        if (typeof el.click !== 'function') continue;
        const text = normalizeLabelText(el.textContent);
        if (!text) continue;
        for (let k = 0; k < allLabels.length; k += 1) {
          const label = allLabels[k];
          if (text === label || text.indexOf(label + ' ') === 0 || text.indexOf(label) === 0) {
            return el;
          }
        }
      }
    }
    return null;
  }

  function simulateMouseClick(element) {
    if (!element) return false;
    const win = element.ownerDocument && element.ownerDocument.defaultView;
    const MouseEventCtor = (win && win.MouseEvent) || root.MouseEvent;
    const rect = typeof element.getBoundingClientRect === 'function'
      ? element.getBoundingClientRect()
      : { left: 0, top: 0, width: 1, height: 1 };
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: win || undefined,
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y,
    };
    try {
      if (typeof MouseEventCtor === 'function') {
        element.dispatchEvent(new MouseEventCtor('pointerdown', opts));
        element.dispatchEvent(new MouseEventCtor('mousedown', opts));
        element.dispatchEvent(new MouseEventCtor('pointerup', opts));
        element.dispatchEvent(new MouseEventCtor('mouseup', opts));
        element.dispatchEvent(new MouseEventCtor('click', opts));
      } else if (typeof element.click === 'function') {
        element.click();
      }
      return true;
    } catch (error) {
      try {
        if (typeof element.click === 'function') {
          element.click();
          return true;
        }
      } catch (e) {
        // ignore
      }
      return false;
    }
  }

  const KNOWN_HASH_ROUTES = [
    '#/recents',
    '#/favorites',
    '#/memories',
    '#/albums',
    '#/mediatypes',
  ];

  async function softRefreshLibraryView(doc, win, options) {
    const opts = options || {};
    const pivotDelay = typeof opts.pivotDelay === 'number' ? opts.pivotDelay : 180;

    // Preferred path: switch the hash-based route to a different sidebar view
    // and back. This drives iCloud's own router state, which is what actually
    // remounts the photo grid component, without depending on DOM click handlers.
    if (win && win.location && typeof win.location.hash === 'string' && opts.allowHashNavigation !== false) {
      const original = win.location.hash || '';
      let pivot = null;
      for (let i = 0; i < KNOWN_HASH_ROUTES.length; i += 1) {
        const candidate = KNOWN_HASH_ROUTES[i];
        if (original === candidate) continue;
        if (original && original.indexOf(candidate) === 0) continue;
        pivot = candidate;
        break;
      }
      if (pivot) {
        try {
          win.location.hash = pivot;
          await sleep(pivotDelay);
          // Setting hash to '' clears it; setting to the original string restores
          // any deep-link route the user was on (e.g. a specific photo).
          win.location.hash = original;
          return true;
        } catch (error) {
          // fall through to DOM click fallback below
        }
      }
    }

    // Fallback: simulate the user clicking the sidebar.
    const original = findActiveSidebarItem(doc) || findSidebarItem(doc, LIBRARY_SIDEBAR_LABELS);
    if (!original) return false;

    const originalText = normalizeLabelText(original.textContent);

    const pivotLabelPool = PIVOT_SIDEBAR_LABELS.concat(LIBRARY_SIDEBAR_LABELS);
    let pivot = null;
    for (let i = 0; i < pivotLabelPool.length; i += 1) {
      const candidate = findSidebarItem(doc, [pivotLabelPool[i]]);
      if (!candidate || candidate === original) continue;
      const candidateText = normalizeLabelText(candidate.textContent);
      if (candidateText && originalText && candidateText === originalText) continue;
      pivot = candidate;
      break;
    }
    if (!pivot) return false;

    if (!simulateMouseClick(pivot)) return false;
    await sleep(pivotDelay);
    if (!simulateMouseClick(original)) return false;
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
    const inputEvent = typeof EventCtor === 'function'
      ? new EventCtor('input', { bubbles: true, composed: true })
      : { type: 'input' };
    const changeEvent = typeof EventCtor === 'function'
      ? new EventCtor('change', { bubbles: true, composed: true })
      : { type: 'change' };
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

    const transferred = transferFilesToInput(input, images, input.ownerDocument && input.ownerDocument.defaultView || win);
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
      '#' + PANEL_ID + '{position:fixed;right:20px;bottom:20px;z-index:2147483647;',
      'width:44px;height:44px;padding:0;border:0;border-radius:50%;',
      'background:linear-gradient(135deg,#007aff 0%,#5856d6 100%);color:#fff;',
      'box-shadow:0 4px 14px rgba(0,0,0,.25);cursor:pointer;',
      'display:flex;align-items:center;justify-content:center;',
      'transition:transform .15s ease,box-shadow .15s ease,background .15s ease;',
      'touch-action:none;-webkit-user-select:none;user-select:none;',
      'font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
      '#' + PANEL_ID + ':hover{transform:scale(1.06);box-shadow:0 6px 18px rgba(0,0,0,.3)}',
      '#' + PANEL_ID + ':focus{outline:none;box-shadow:0 0 0 3px rgba(0,122,255,.35)}',
      '#' + PANEL_ID + '.is-moving{cursor:grabbing;opacity:.92}',
      '#' + PANEL_ID + '.is-dragging{transform:scale(1.15);background:linear-gradient(135deg,#34c759 0%,#30b0c7 100%)}',
      '#' + PANEL_ID + '.is-busy{background:linear-gradient(135deg,#8e8e93 0%,#48484a 100%);cursor:progress}',
      '#' + PANEL_ID + '.is-busy .iu-ring{animation:iu-spin 1s linear infinite;opacity:1}',
      '#' + PANEL_ID + ' svg{pointer-events:none;display:block}',
      '#' + PANEL_ID + ' .iu-icon-refresh{display:none}',
      '#' + PANEL_ID + '.is-pending-reload .iu-icon-upload{display:none}',
      '#' + PANEL_ID + '.is-pending-reload .iu-icon-refresh{display:block}',
      '#' + PANEL_ID + '.is-pending-reload{background:linear-gradient(135deg,#34c759 0%,#30b0c7 100%)}',
      '#' + PANEL_ID + ' .iu-ring{position:absolute;inset:-3px;border-radius:50%;',
      'border:2px solid transparent;border-top-color:#fff;opacity:0;pointer-events:none}',
      '@keyframes iu-spin{to{transform:rotate(360deg)}}',
      '#' + PANEL_ID + ' .iu-toast{position:absolute;right:calc(100% + 8px);bottom:50%;',
      'transform:translate(6px,50%);white-space:nowrap;background:rgba(0,0,0,.82);color:#fff;',
      'font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      'padding:6px 10px;border-radius:8px;pointer-events:none;opacity:0;',
      'transition:opacity .2s ease,transform .2s ease;max-width:280px;',
      'overflow:hidden;text-overflow:ellipsis}',
      '#' + PANEL_ID + ' .iu-toast.is-visible{opacity:1;transform:translate(0,50%)}',
      '#' + PANEL_ID + ' .iu-toast.is-error{background:rgba(176,0,32,.92)}',
      '#' + PANEL_ID + ' input[type="file"]{display:none}',
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

  function enableFabDragging(panel, win) {
    const savedPosition = loadSavedPosition(win);
    if (savedPosition) applyPanelPosition(panel, savedPosition);

    let dragState = null;
    let moved = false;

    function cleanup() {
      win.removeEventListener('mousemove', move, true);
      win.removeEventListener('mouseup', stop, true);
      win.removeEventListener('touchmove', move, true);
      win.removeEventListener('touchend', stop, true);
      win.removeEventListener('touchcancel', stop, true);
    }

    function move(event) {
      if (!dragState) return;
      const point = getPointerPoint(event);
      const dx = point.x - dragState.startX;
      const dy = point.y - dragState.startY;
      if (!moved && (dx * dx + dy * dy) < 16) return;
      moved = true;
      if (typeof event.preventDefault === 'function') event.preventDefault();
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
      if (moved && dragState.lastPosition) savePosition(win, dragState.lastPosition);
      panel.classList.remove('is-moving');
      dragState = null;
      if (moved) {
        panel._recentDrag = true;
        setTimeout(function () { panel._recentDrag = false; }, 0);
      }
      moved = false;
      cleanup();
    }

    function start(event) {
      if (event.button !== undefined && event.button !== 0) return;
      const point = getPointerPoint(event);
      const rect = panel.getBoundingClientRect();
      dragState = {
        startX: point.x,
        startY: point.y,
        offsetX: point.x - rect.left,
        offsetY: point.y - rect.top,
        panelWidth: rect.width,
        panelHeight: rect.height,
        viewportWidth: win.innerWidth || rect.right,
        viewportHeight: win.innerHeight || rect.bottom,
        lastPosition: { left: rect.left, top: rect.top },
      };
      panel.classList.add('is-moving');
      win.addEventListener('mousemove', move, true);
      win.addEventListener('mouseup', stop, true);
      win.addEventListener('touchmove', move, true);
      win.addEventListener('touchend', stop, true);
      win.addEventListener('touchcancel', stop, true);
    }

    panel.addEventListener('mousedown', start);
    panel.addEventListener('touchstart', start, { passive: false });
  }

  function createPanel(doc, win) {
    const existing = doc.getElementById(PANEL_ID);
    if (existing) return existing;

    injectStyles(doc);

    const panel = doc.createElement('button');
    panel.id = PANEL_ID;
    panel.type = 'button';
    const text = getPanelText();
    panel.setAttribute('aria-label', text.title + '：' + text.tooltip);
    panel.title = text.tooltip;
    panel.innerHTML = [
      '<svg class="iu-icon iu-icon-upload" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">',
      '<path fill="currentColor" d="M19.35 10.04A7.49 7.49 0 0 0 12 4a7.5 7.5 0 0 0-6.98 4.76A5.5 5.5 0 0 0 5.5 20H19a4.5 4.5 0 0 0 .35-9.96zM13 13v4h-2v-4H8l4-4 4 4h-3z"/>',
      '</svg>',
      '<svg class="iu-icon iu-icon-refresh" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">',
      '<path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4a8 8 0 1 0 7.74 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>',
      '</svg>',
      '<span class="iu-ring"></span>',
      '<span class="iu-toast"></span>',
      '<input type="file" accept="image/*,.heic,.heif,.ico,.svg,.avif" multiple>',
    ].join('');

    const picker = panel.querySelector('input[type="file"]');
    const toast = panel.querySelector('.iu-toast');
    let toastTimer = null;

    enableFabDragging(panel, win);

    function status(message, isError) {
      toast.textContent = message;
      toast.classList.toggle('is-error', Boolean(isError));
      toast.classList.add('is-visible');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toast.classList.remove('is-visible');
      }, isError ? 6000 : 2800);
      if (isError) console.warn(LOG_PREFIX, message);
      else console.log(LOG_PREFIX, message);
    }

    let pendingReload = null;
    let reloadInFlight = false;

    async function doReload() {
      clearPendingReload();
      if (reloadInFlight) return;
      reloadInFlight = true;
      try {
        const softened = await softRefreshLibraryView(doc, win);
        if (softened) {
          status('已刷新图库');
          return;
        }
      } catch (error) {
        console.warn(LOG_PREFIX, 'Soft refresh failed:', error && error.message ? error.message : error);
      } finally {
        reloadInFlight = false;
      }
      try {
        if (win.location && typeof win.location.reload === 'function') {
          win.location.reload();
        }
      } catch (error) {
        console.warn(LOG_PREFIX, 'Reload failed:', error && error.message ? error.message : error);
      }
    }

    function clearPendingReload() {
      if (pendingReload) {
        clearTimeout(pendingReload);
        pendingReload = null;
      }
      panel.classList.remove('is-pending-reload');
    }

    function scheduleRefresh(delayMs) {
      clearPendingReload();
      panel.classList.add('is-pending-reload');
      panel.title = '点击立即刷新图库';
      pendingReload = setTimeout(function () {
        pendingReload = null;
        doReload();
      }, delayMs);
    }

    async function send(files) {
      const images = filterImageFiles(files);
      if (!images.length) {
        status('只能上传图片', true);
        return;
      }
      // A new upload cancels any queued auto-refresh so we refresh only once at the end.
      clearPendingReload();
      panel.classList.add('is-busy');
      let uploaded = false;
      try {
        uploaded = await uploadViaICloudPage(files, doc, win, status);
      } finally {
        panel.classList.remove('is-busy');
      }
      if (uploaded) {
        const delay = Math.min(12000, Math.max(3000, (2 + images.length) * 1000));
        const secs = Math.round(delay / 1000);
        status('✓ 已发送 ' + images.length + ' 张，' + secs + ' 秒后自动刷新图库');
        scheduleRefresh(delay);
      }
    }

    panel.addEventListener('click', function (event) {
      // Suppress the click that follows a drag.
      if (panel._recentDrag) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.target === picker) return;
      if (pendingReload) {
        event.preventDefault();
        doReload();
        return;
      }
      picker.click();
    });

    panel.addEventListener('contextmenu', async function (event) {
      // Right-click: quick detection debug.
      event.preventDefault();
      status('检测 iCloud 上传控件…');
      let found = findICloudFileInput(doc);
      if (!found) {
        clickPossibleUploadTrigger(doc);
        found = await waitForICloudFileInput(doc, 3000);
      }
      status(found ? '已找到 iCloud 上传控件' : '未找到上传控件', !found);
    });

    picker.addEventListener('change', function () {
      const files = picker.files;
      picker.value = '';
      send(files);
    });

    panel.addEventListener('dragover', function (event) {
      event.preventDefault();
      panel.classList.add('is-dragging');
    });

    panel.addEventListener('dragleave', function () {
      panel.classList.remove('is-dragging');
    });

    panel.addEventListener('drop', function (event) {
      event.preventDefault();
      panel.classList.remove('is-dragging');
      send(event.dataTransfer && event.dataTransfer.files);
    });

    // Expose the current panel's upload handler so the shared paste listener
    // (installed once by installPasteListener) can dispatch to the active panel
    // even after a MutationObserver re-mount swaps the send closure.
    panel._handlePasteUpload = send;

    doc.body.appendChild(panel);
    return panel;
  }

  let pasteListenerInstalled = false;

  function installPasteListener(doc, win) {
    if (pasteListenerInstalled) return;
    pasteListenerInstalled = true;

    function dispatchPaste(event) {
      // The same paste event bubbles to window/document/body — each has our
      // capture-phase listener. Dedupe by tagging the event once.
      if (event.__iCloudUploaderPasteHandled) return;
      event.__iCloudUploaderPasteHandled = true;

      // Ignore pastes targeted at native editable fields (text inputs, textareas,
      // contenteditable) so we do not hijack users typing into iCloud search or rename dialogs.
      const target = event.target;
      if (target && typeof target.matches === 'function') {
        try {
          if (target.matches('input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="password"], textarea')) {
            return;
          }
        } catch (error) {
          // ignore selector errors and continue
        }
        if (target.isContentEditable) return;
      }

      const files = extractImageFilesFromPaste(event);
      if (!files.length) return;
      const panel = doc.getElementById(PANEL_ID);
      if (!panel || typeof panel._handlePasteUpload !== 'function') return;
      event.preventDefault();
      try {
        panel._handlePasteUpload(files);
      } catch (error) {
        console.warn(LOG_PREFIX, 'Paste handler failed:', error && error.message ? error.message : error);
      }
    }

    // Listen on multiple targets in capture phase so that we get the event
    // regardless of which layer iCloud's own code subscribed to.
    const targets = [];
    if (win && typeof win.addEventListener === 'function') targets.push(win);
    if (doc && typeof doc.addEventListener === 'function' && doc !== win) targets.push(doc);
    if (doc && doc.body && typeof doc.body.addEventListener === 'function') targets.push(doc.body);

    targets.forEach(function (target) {
      try {
        target.addEventListener('paste', dispatchPaste, true);
      } catch (error) {
        // ignore registration failures
      }
    });
  }

  let zoomPanInstalled = false;

  function installImageZoomPan(doc, win) {
    if (zoomPanInstalled) return;
    zoomPanInstalled = true;

    const MIN_PREVIEW_PX = 300;
    const MIN_SCALE = 1;
    const MAX_SCALE = 8;

    const state = {
      element: null,
      scale: 1,
      tx: 0,
      ty: 0,
      dragging: false,
      startX: 0,
      startY: 0,
      origTx: 0,
      origTy: 0,
      savedTransform: '',
      savedTransition: '',
      savedOrigin: '',
      savedCursor: '',
      savedUserSelect: '',
    };

    function isLargeMedia(el) {
      if (!el || !el.tagName) return false;
      const tag = el.tagName;
      if (tag !== 'IMG' && tag !== 'CANVAS' && tag !== 'VIDEO') return false;
      if (typeof el.getBoundingClientRect !== 'function') return false;
      const rect = el.getBoundingClientRect();
      return rect.width >= MIN_PREVIEW_PX && rect.height >= MIN_PREVIEW_PX;
    }

    function findLargestMediaAtPoint(x, y) {
      if (typeof doc.elementsFromPoint !== 'function') return null;
      const stack = doc.elementsFromPoint(x, y) || [];
      let best = null;
      let bestArea = 0;
      for (let i = 0; i < stack.length; i += 1) {
        const el = stack[i];
        if (!isLargeMedia(el)) continue;
        const rect = el.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area > bestArea) {
          best = el;
          bestArea = area;
        }
      }
      return best;
    }

    function findLargestMediaInViewport() {
      const candidates = doc.querySelectorAll
        ? doc.querySelectorAll('img, canvas, video')
        : [];
      let best = null;
      let bestArea = 0;
      const vw = (win && win.innerWidth) || doc.documentElement.clientWidth;
      const vh = (win && win.innerHeight) || doc.documentElement.clientHeight;
      for (let i = 0; i < candidates.length; i += 1) {
        const el = candidates[i];
        const rect = el.getBoundingClientRect();
        if (rect.width < MIN_PREVIEW_PX || rect.height < MIN_PREVIEW_PX) continue;
        // Reject elements outside the viewport.
        if (rect.right < 0 || rect.bottom < 0 || rect.left > vw || rect.top > vh) continue;
        const area = rect.width * rect.height;
        if (area > bestArea) {
          best = el;
          bestArea = area;
        }
      }
      return best;
    }

    function findPreviewImage(target, x, y) {
      // 1. Walk up from the wheel/click target.
      let el = target;
      while (el && el !== doc && el !== doc.body) {
        if (isLargeMedia(el)) return el;
        el = el.parentElement || (el.parentNode && el.parentNode.host) || null;
      }
      // 2. iCloud often layers a transparent overlay on top of the image.
      //    Use elementsFromPoint to inspect the entire stack at the cursor.
      if (typeof x === 'number' && typeof y === 'number') {
        const found = findLargestMediaAtPoint(x, y);
        if (found) return found;
      }
      // 3. Fall back to the largest visible IMG/CANVAS/VIDEO in the viewport.
      return findLargestMediaInViewport();
    }

    // ── Overlay approach ──────────────────────────────────────────────────────
    function findViewerContainer(el) {
      // Walk up to find the nearest ancestor that is narrower than the viewport
      // and has a fixed/absolute/relative position — that is the viewer pane
      // iCloud constrains to the center column.
      const vw = (win && win.innerWidth) || doc.documentElement.clientWidth;
      let node = el.parentElement;
      let safety = 0;
      while (node && node !== doc.body && node !== doc.documentElement && safety < 20) {
        const rect = node.getBoundingClientRect();
        const cs = win && win.getComputedStyle ? win.getComputedStyle(node) : null;
        const pos = cs ? cs.position : '';
        // A container that is clearly narrower than the viewport and positioned
        // is the viewer pane we want to expand.
        if (rect.width > 0 && rect.width < vw * 0.85 &&
            (pos === 'absolute' || pos === 'fixed' || pos === 'relative' || pos === 'sticky')) {
          return node;
        }
        node = node.parentElement;
        safety += 1;
      }
      return null;
    }

    function attach(el) {
      if (state.element === el) return;
      if (state.element) detach();
      state.element = el;
      state.scale = 1;
      state.tx = 0;
      state.ty = 0;
      state.savedTransform = el.style.transform || '';
      state.savedTransition = el.style.transition || '';
      state.savedOrigin = el.style.transformOrigin || '';
      state.savedCursor = el.style.cursor || '';
      state.savedUserSelect = el.style.userSelect || '';

      // Record the image's current viewport position BEFORE we move the container,
      // so we can compensate for the container shift below.
      const elRectBefore = el.getBoundingClientRect();

      // Expand the viewer container to fill the full viewport width/height so
      // the zoomed image can use the black sidebar space.
      const container = findViewerContainer(el);
      if (container) {
        state.container = container;
        state.savedContainerStyle = {
          position: container.style.position,
          left: container.style.left,
          top: container.style.top,
          width: container.style.width,
          height: container.style.height,
          maxWidth: container.style.maxWidth,
          maxHeight: container.style.maxHeight,
          zIndex: container.style.zIndex,
          transition: container.style.transition,
        };
        container.style.transition = 'none';
        container.style.position = 'fixed';
        container.style.left = '0';
        container.style.top = '0';
        container.style.width = '100vw';
        container.style.height = '100vh';
        container.style.maxWidth = 'none';
        container.style.maxHeight = 'none';
        container.style.zIndex = '2147483640';

        // After repositioning the container, the image may have shifted.
        // Compute the delta and bake it into the initial translation so the
        // image appears to stay exactly where it was.
        const elRectAfter = el.getBoundingClientRect();
        state.tx = elRectBefore.left - elRectAfter.left;
        state.ty = elRectBefore.top - elRectAfter.top;
      } else {
        state.container = null;
        state.savedContainerStyle = null;
      }

      el.style.transition = 'none';
      el.style.transformOrigin = 'center center';
      el.style.userSelect = 'none';
      el.style.willChange = 'transform';
      startWatchdog();
    }

    function detach() {
      stopWatchdog();
      const el = state.element;
      if (!el) return;
      // Restore the viewer container.
      if (state.container && state.savedContainerStyle) {
        const c = state.container;
        const s = state.savedContainerStyle;
        c.style.position = s.position;
        c.style.left = s.left;
        c.style.top = s.top;
        c.style.width = s.width;
        c.style.height = s.height;
        c.style.maxWidth = s.maxWidth;
        c.style.maxHeight = s.maxHeight;
        c.style.zIndex = s.zIndex;
        c.style.transition = s.transition;
      }
      state.container = null;
      state.savedContainerStyle = null;
      el.style.transform = state.savedTransform;
      el.style.transition = state.savedTransition;
      el.style.transformOrigin = state.savedOrigin;
      el.style.cursor = state.savedCursor;
      el.style.userSelect = state.savedUserSelect;
      el.style.willChange = '';
      state.element = null;
      state.scale = 1;
      state.tx = 0;
      state.ty = 0;
      state.dragging = false;
    }

    function expectedTransform() {
      return 'translate(' + state.tx + 'px, ' + state.ty + 'px) scale(' + state.scale + ')';
    }

    function applyTransform() {
      if (!state.element) return;
      state.element.style.transform = expectedTransform();
      state.element.style.cursor = state.scale > 1 ? (state.dragging ? 'grabbing' : 'grab') : '';
    }

    function startWatchdog() {
      const raf = (win && win.requestAnimationFrame) || root.requestAnimationFrame;
      if (typeof raf !== 'function' || state.rafActive) return;
      state.rafActive = true;
      function tick() {
        if (!state.element || state.scale <= MIN_SCALE + 0.001) {
          state.rafActive = false;
          return;
        }
        // If the source element was replaced by React, decide whether to migrate.
        if (!state.element.isConnected) {
          const oldSrc = (state.element.currentSrc || state.element.src) || '';
          const replacement = findLargestMediaInViewport();
          const newSrc = (replacement && (replacement.currentSrc || replacement.src)) || '';
          const sameImage = replacement && oldSrc && newSrc && oldSrc === newSrc;
          if (sameImage) {
            debugLog('element re-rendered, re-anchoring zoom');
            const keepScale = state.scale;
            const keepTx = state.tx;
            const keepTy = state.ty;
            state.element = null;
            attach(replacement);
            state.scale = keepScale;
            state.tx = keepTx;
            state.ty = keepTy;
          } else {
            debugLog('user navigated away, detaching');
            detach();
            return;
          }
        }
        // Keep the element's transform in sync.
        if (state.element) {
          const expected = expectedTransform();
          if (state.element.style.transform !== expected) {
            state.element.style.transform = expected;
          }
          if (state.element.style.transition !== 'none') {
            state.element.style.transition = 'none';
          }
        }
        state.rafId = raf(tick);
      }
      state.rafId = raf(tick);
    }

    function stopWatchdog() {
      const cancel = (win && win.cancelAnimationFrame) || root.cancelAnimationFrame;
      if (typeof cancel === 'function' && state.rafId != null) {
        cancel(state.rafId);
      }
      state.rafActive = false;
      state.rafId = null;
    }

    function debugLog() {
      try {
        if (win && win.localStorage && win.localStorage.getItem('iu-debug-zoom') === '1') {
          const args = ['[iCloud Zoom]'].concat(Array.prototype.slice.call(arguments));
          console.log.apply(console, args);
        }
      } catch (error) {
        // ignore localStorage access errors
      }
    }

    function onWheel(event) {
      const img = state.element || findPreviewImage(event.target, event.clientX, event.clientY);
      if (!img) {
        debugLog('no preview img', event.target && event.target.tagName, event.target && event.target.className);
        return;
      }

      const rect = img.getBoundingClientRect();
      const px = event.clientX - rect.left - rect.width / 2;
      const py = event.clientY - rect.top - rect.height / 2;

      const delta = -event.deltaY;
      const factor = Math.exp(delta * 0.0015);
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, state.scale * factor));
      if (newScale === state.scale) {
        // Already at the clamp boundary in the requested direction; let the
        // page scroll naturally so the user is not stuck.
        debugLog('clamped at', newScale);
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (state.element !== img) attach(img);

      const scaleRatio = newScale / state.scale;
      state.tx = px - (px - state.tx) * scaleRatio;
      state.ty = py - (py - state.ty) * scaleRatio;
      state.scale = newScale;

      if (state.scale <= MIN_SCALE + 0.001) {
        debugLog('detach (back to 1x)');
        detach();
        return;
      }
      debugLog('scale=', state.scale.toFixed(2), 'tag=', img.tagName, 'size=', Math.round(rect.width) + 'x' + Math.round(rect.height));
      applyTransform();
    }

    function onMouseDown(event) {
      if (event.button !== 0) return;
      const img = state.element;
      if (!img || state.scale <= MIN_SCALE) return;
      // The cursor may be over an iCloud overlay layered on top of the image
      // rather than the image element itself. Accept the drag as long as the
      // cursor is geometrically inside the image's current visible area.
      const rect = img.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) {
        return;
      }
      state.dragging = true;
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.origTx = state.tx;
      state.origTy = state.ty;
      img.style.cursor = 'grabbing';
      event.preventDefault();
      event.stopPropagation();
    }

    function onMouseMove(event) {
      if (!state.dragging || !state.element) return;
      state.tx = state.origTx + (event.clientX - state.startX);
      state.ty = state.origTy + (event.clientY - state.startY);
      applyTransform();
      event.preventDefault();
    }

    function endDrag() {
      if (!state.dragging) return;
      state.dragging = false;
      if (state.element) state.element.style.cursor = 'grab';
    }

    function onKeyDown(event) {
      if (!state.element) return;
      if (event.key === 'Escape' || event.key === '0') {
        event.preventDefault();
        detach();
      }
    }

    // Capture phase so we run before iCloud's own wheel/drag handlers.
    const targets = [doc];
    if (win && win !== doc) targets.unshift(win);
    targets.forEach(function (target) {
      try {
        target.addEventListener('wheel', onWheel, { passive: false, capture: true });
      } catch (error) {
        try { target.addEventListener('wheel', onWheel, true); } catch (e) { /* ignore */ }
      }
      target.addEventListener('mousedown', onMouseDown, true);
      target.addEventListener('mousemove', onMouseMove, true);
      target.addEventListener('mouseup', endDrag, true);
      target.addEventListener('mouseleave', endDrag, true);
      target.addEventListener('keydown', onKeyDown, true);
    });
  }

  function isInICloudPhotosAppFrame(win) {    try {
      const loc = win && win.location;
      if (!loc) return false;
      // The actual Photos app is loaded inside an iframe at
      // /applications/photos3/current/<locale>/index.html.
      // The outer shell at /photos is just a launcher.
      return /^\/applications\/photos/i.test(loc.pathname || '');
    } catch (error) {
      return false;
    }
  }

  function observeAndRemount(doc, win) {
    const MutationObserverCtor = (win && win.MutationObserver) || root.MutationObserver;
    if (typeof MutationObserverCtor !== 'function') return;
    const observer = new MutationObserverCtor(function () {
      if (doc.body && !doc.getElementById(PANEL_ID)) {
        try {
          createPanel(doc, win);
        } catch (error) {
          console.warn(LOG_PREFIX, 'Remount failed:', error && error.message ? error.message : error);
        }
      }
    });
    const target = doc.body || doc.documentElement;
    if (target) observer.observe(target, { childList: true, subtree: false });
  }

  function mountWhenReady(doc, win) {
    if (doc.body) {
      createPanel(doc, win);
      installPasteListener(doc, win);
      installImageZoomPan(doc, win);
      observeAndRemount(doc, win);
      return;
    }
    doc.addEventListener('DOMContentLoaded', function () {
      if (!doc.body) return;
      createPanel(doc, win);
      installPasteListener(doc, win);
      installImageZoomPan(doc, win);
      observeAndRemount(doc, win);
    }, { once: true });
  }

  function bootstrap() {
    const doc = root.document;
    if (!doc) return;
    const win = root.window || root;
    if (!isInICloudPhotosAppFrame(win)) {
      // Outer shell frame (or unrelated page). The inner iframe instance will mount the panel.
      if (typeof console !== 'undefined' && console.debug) {
        console.debug(LOG_PREFIX, 'Skipping panel mount in non-app frame:', (win.location || {}).href);
      }
      return;
    }
    mountWhenReady(doc, win);
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
    findActiveSidebarItem,
    findICloudFileInput,
    findSidebarItem,
    getConvertedJpegFileName,
    getPanelText,
    isInICloudPhotosAppFrame,
    isJpegLikeFile,
    isImageLikeFile,
    normalizeFilesForICloudWebUpload,
    shouldConvertForICloudWeb,
    softRefreshLibraryView,
    transferFilesToInput,
    uploadViaICloudPage,
    waitForICloudFileInput,
  };
});
