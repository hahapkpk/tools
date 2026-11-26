// ==UserScript==
// @name         iCloud Photos Web Uploader
// @namespace    https://github.com/hahapkpk/tools
// @version      1.21.2
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/icloud-photos-web-uploader.user.js
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/icloud-photos-web-uploader.user.js
// @description  Upload via paste/drag/pick on iCloud Photos, with auto JPEG conversion, quick library refresh, grid right-click native download, Ctrl+C / OneUp PNG image copy, and native high-resolution OneUp zoom with double-click / smooth mouse-wheel zoom / drag-pan.
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
  const PICKER_ID = PANEL_ID + '-picker';
  const MOUNT_ATTRIBUTE = 'data-icloud-web-uploader-mounted';
  const CENTERED_VIEWER = '.OneUpCarouselItem.is-center';
  const SIDEBAR_ITEMS = '.Sidebar-innerContainer .SidebarItem[role="treeitem"]';
  const GRID_TILE = '.grid-item, [role="gridcell"]';
  const LOG_PREFIX = '[iCloud Photos Web Uploader]';
  const POSITION_KEY = 'icloud-web-uploader-position';
  const ONEUP_COPY_POSITION_KEY = 'icloud-web-uploader-oneup-copy-position';
  const ONEUP_BUTTON_SIZE = 40;
  const IMAGE_EXTENSIONS = /\.(apng|avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i;
  const JPEG_EXTENSIONS = /\.jpe?g$/i;
  const JPEG_QUALITY = 0.92;
  const pasteDispatcherByDocument = new WeakMap();
  const registeredPasteTargets = new WeakSet();
  const handledPasteEvents = new WeakSet();
  const keyboardPhotoCopyStateByDocument = new WeakMap();
  const oneUpCopyStateByDocument = new WeakMap();
  const clipboardWritesByDocument = new WeakSet();

  function getPanelText() {
    return {
      title: 'iCloud 上传',
      tooltip: '点击选择 · 粘贴 · 拖拽 · Ctrl+C 拷贝图像',
    };
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
    if (type && type !== 'application/octet-stream') return false;
    return IMAGE_EXTENSIONS.test(String(file.name || ''));
  }

  function isJpegLikeFile(file) {
    if (!file) return false;
    const type = String(file.type || '').toLowerCase();
    if (type.startsWith('image/')) {
      return type === 'image/jpeg' || type === 'image/jpg';
    }
    if (type && type !== 'application/octet-stream') return false;
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

  function snapshotFiles(fileList) {
    return Array.from(fileList || []);
  }

  function filterImageFiles(fileList) {
    return Array.from(fileList || []).filter(isImageLikeFile);
  }

  function createFileFromBlob(blob, name, win, lastModified) {
    const FileCtor = win && win.File ? win.File : root.File;
    if (typeof FileCtor === 'function') {
      return new FileCtor([blob], name, {
        type: 'image/jpeg',
        lastModified: typeof lastModified === 'number' ? lastModified : Date.now(),
      });
    }

    // Without a File constructor the raw blob is the best we can hand over.
    // Naming it is best-effort only — Blob.name is not a writable standard
    // property — so callers must not depend on the name surviving.
    try {
      blob.name = name;
    } catch (error) {
      // Ignore: a blob without a name still transfers as image bytes.
    }
    return blob;
  }

  // Decode and encode are browser-native async operations with no built-in
  // timeout. A stalled one would otherwise wedge the whole upload path with the
  // panel stuck in its busy state and no way out.
  const DECODE_TIMEOUT_MS = 20000;
  const ENCODE_TIMEOUT_MS = 30000;
  function createTimeoutError(message) {
    const error = new Error(message);
    error.name = 'TimeoutError';
    return error;
  }


  function withTimeout(promise, ms, message) {
    let timer = null;
    const timeout = new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        reject(createTimeoutError(message));
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(function () {
      clearTimeout(timer);
    });
  }

  function startAbortableTask(operation, timeoutMs, AbortControllerCtor, timeoutMessage) {
    const controller = typeof AbortControllerCtor === 'function'
      ? new AbortControllerCtor()
      : null;
    const signal = controller ? controller.signal : undefined;
    const promise = withTimeout(
      Promise.resolve().then(function () {
        return operation(signal);
      }),
      timeoutMs,
      timeoutMessage
    ).finally(function () {
      if (controller) controller.abort();
    });

    return {
      promise,
      abort: function () {
        if (controller) controller.abort();
      },
    };
  }

  function stableSerialize(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return '[' + value.map(stableSerialize).join(',') + ']';
    }
    const keys = Object.keys(value).sort();
    return '{' + keys.map(function (key) {
      return JSON.stringify(key) + ':' + stableSerialize(value[key]);
    }).join(',') + '}';
  }

  function serializeZoneSyncState(data) {
    if (!data || !Array.isArray(data.zones) || !data.zones.length) return null;
    const zones = data.zones.map(function (zone) {
      return stableSerialize({
        zoneID: zone && zone.zoneID ? zone.zoneID : null,
        syncToken: zone && zone.syncToken !== undefined ? zone.syncToken : null,
      });
    });
    zones.sort();
    return '[' + zones.join(',') + ']';
  }

  async function fetchCloudKitSyncState(win, url, signal) {
    if (!win || typeof win.fetch !== 'function' || !url) return null;
    const response = await win.fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      signal,
    });
    if (!response.ok) return null;
    return serializeZoneSyncState(await response.json());
  }

  function createRefreshDemandTracker() {
    let demand = null;
    let queuedBatches = 0;
    function snapshot() {
      return demand ? { baseline: demand.baseline } : null;
    }
    return {
      enqueue: function () {
        queuedBatches += 1;
      },
      finish: function () {
        queuedBatches = Math.max(0, queuedBatches - 1);
        return queuedBatches === 0 ? snapshot() : null;
      },
      recordSuccess: function (baseline) {
        demand = { baseline: baseline || null };
      },
      ready: function () {
        return queuedBatches === 0 ? snapshot() : null;
      },
      hasPending: function () {
        return Boolean(demand) || queuedBatches > 0;
      },
      clear: function () {
        demand = null;
      },
    };
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      if (!canvas || typeof canvas.toBlob !== 'function') {
        reject(new Error('Canvas JPEG conversion is not available in this browser.'));
        return;
      }

      let settled = false;
      const timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('Encoding timed out.'));
      }, ENCODE_TIMEOUT_MS);

      try {
        canvas.toBlob(function (blob) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (!blob) reject(new Error('Could not convert image to ' + type + '.'));
          else resolve(blob);
        }, type, quality);
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  function loadImageElement(file, win, timeoutMs) {
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
      const deadline = typeof timeoutMs === 'number' ? timeoutMs : DECODE_TIMEOUT_MS;
      let settled = false;
      let timer = null;
      function cleanup() {
        clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        urlApi.revokeObjectURL(url);
      }
      timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          image.src = '';
        } catch (error) {
          // Ignore abort failures after the timeout has already been reported.
        }
        reject(createTimeoutError('Decoding timed out: ' + (file.name || 'unnamed file')));
      }, deadline);
      image.onload = function () {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(image);
      };
      image.onerror = function () {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Could not decode image: ' + (file.name || 'unnamed file')));
      };
      image.src = url;
    });
  }
  async function decodeImageForCanvas(file, win, timeoutMs) {
    const deadline = typeof timeoutMs === 'number' ? timeoutMs : DECODE_TIMEOUT_MS;
    const startedAt = Date.now();
    if (win && typeof win.createImageBitmap === 'function') {
      let bitmapPromise = null;
      try {
        bitmapPromise = Promise.resolve(win.createImageBitmap(file));
        return await withTimeout(
          bitmapPromise,
          deadline,
          'Decoding timed out: ' + (file.name || 'unnamed file')
        );
      } catch (error) {
        if (error && error.name === 'TimeoutError') {
          if (bitmapPromise) {
            bitmapPromise.then(function (bitmap) {
              if (bitmap && typeof bitmap.close === 'function') bitmap.close();
            }, function () {});
          }
          throw error;
        }
        // createImageBitmap commonly rejects SVG and ICO; fall back to <img>.
      }
    }
    const remainingMs = Math.max(1, deadline - (Date.now() - startedAt));
    return loadImageElement(file, win || root, remainingMs);
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

  // Large browser canvases can exhaust hundreds of MiB before JPEG encoding.
  // Bound both dimensions and total pixels; report every downscale to the user.
  const MAX_CANVAS_EDGE_PX = 8192;
  const MAX_CANVAS_PIXELS = 40000000;
  function calculateCanvasSize(width, height, maxEdge, maxPixels) {
    const edgeRatio = Math.min(1, maxEdge / Math.max(width, height));
    const pixelRatio = Math.min(1, Math.sqrt(maxPixels / (width * height)));
    const ratio = Math.min(edgeRatio, pixelRatio);
    return {
      width: Math.max(1, Math.floor(width * ratio)),
      height: Math.max(1, Math.floor(height * ratio)),
    };
  }

  async function convertImageFileToJpeg(file, win, status) {
    const actualWindow = win || root;
    const doc = actualWindow.document || root.document;
    if (!doc || typeof doc.createElement !== 'function') {
      throw new Error('Canvas JPEG conversion is not available in this browser.');
    }
    const image = await decodeImageForCanvas(file, actualWindow);
    let canvas = null;
    try {
      let width = image.width || image.naturalWidth;
      let height = image.height || image.naturalHeight;
      if ((!width || !height) && isSvgFile(file)) {
        width = SVG_DEFAULT_RASTER_PX;
        height = SVG_DEFAULT_RASTER_PX;
      }
      if (!width || !height) {
        throw new Error('Could not read image dimensions: ' + (file.name || 'unnamed file'));
      }
      const sourceWidth = width;
      const sourceHeight = height;
      const canvasSize = calculateCanvasSize(
        sourceWidth,
        sourceHeight,
        MAX_CANVAS_EDGE_PX,
        MAX_CANVAS_PIXELS
      );
      width = canvasSize.width;
      height = canvasSize.height;
      if (width !== sourceWidth || height !== sourceHeight) {
        if (typeof status === 'function') {
          status(
            '为避免浏览器转换崩溃，已将 ' +
            sourceWidth + '×' + sourceHeight +
            ' 缩放至 ' + width + '×' + height
          );
        }
      }
      canvas = doc.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D rendering is not available in this browser.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, width, height);
      const blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
      return createFileFromBlob(
        blob,
        getConvertedJpegFileName(file.name),
        actualWindow,
        file && file.lastModified
      );
    } finally {
      if (image && typeof image.close === 'function') image.close();
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
      }
    }
  }

  async function normalizeFilesForICloudWebUpload(files, win, status, converter, options) {
    const images = filterImageFiles(files);
    const normalized = [];
    const failures = [];
    let convertedCount = 0;
    const convert = converter || convertImageFileToJpeg;
    const report = typeof status === 'function' ? status : function () {};
    let processedCount = 0;

    for (let i = 0; i < images.length; i += 1) {
      if (options && options.shouldContinue && !options.shouldContinue()) return [];
      const file = images[i];
      if (!shouldConvertForICloudWeb(file)) {
        normalized.push(file);
        continue;
      }

      processedCount += 1;
      report('正在转换为 iCloud.com 支持的 JPEG（' + processedCount + '）：' + (file.name || '图片'));
      try {
        const converted = await convert(file, win, report);
        // A converter that resolves to nothing would otherwise put an unusable
        // entry into the upload batch.
        if (!converted) throw new Error('converter returned no file');
        normalized.push(converted);
        convertedCount += 1;
      } catch (error) {
        // One undecodable file must not cost the user the rest of the batch.
        failures.push((file.name || '图片') + '（' + ((error && error.message) || '未知错误') + '）');
      }
    }

    if (options && options.shouldContinue && !options.shouldContinue()) return [];
    if (options && options.onFailures) options.onFailures(failures);
    if (convertedCount) {
      report('已将 ' + convertedCount + ' 张图片转换为 JPEG。');
    }

    if (failures.length) {
      report(
        describeSkippedFiles(failures) +
          (normalized.length ? '。其余 ' + normalized.length + ' 张继续上传。' : '。没有可上传的图片。'),
        !normalized.length
      );
    }

    return normalized;
  }

  function describeSkippedFiles(failures) {
    return '跳过 ' + failures.length + ' 张无法转换的图片：' + failures.join('；');
  }


  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
  function createGenerationGate() {
    let generation = 0;
    return {
      next() {
        generation += 1;
        return generation;
      },
      invalidate() {
        generation += 1;
      },
      isCurrent(candidate) {
        return candidate === generation;
      },
    };
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


  function queryAllDeep(rootNode, selector) {
    const results = [];
    const seen = new Set();

    function walk(node) {
      if (!node || seen.has(node) || typeof node.querySelectorAll !== 'function') return;
      seen.add(node);

      for (const item of node.querySelectorAll(selector)) results.push(item);

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

  // queryAllDeep is expensive (it walks the entire DOM plus every shadow root and
  // same-origin frame), so cache a validated result between route changes.
  const fileInputCacheByDocument = new WeakMap();
  const PHOTO_ACCEPT_PATTERN = /(?:^|,)\s*(?:image\/|\.(?:apng|avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)\b)/i;

  function getPhotosShellWindow(win) {
    try {
      if (win && win.parent && win.parent !== win && win.parent.location.origin === win.location.origin) {
        return win.parent;
      }
    } catch (error) {
      // The Photos iframe can also be embedded across origins.
    }
    return null;
  }

  function getDocumentRouteKey(doc) {
    const win = doc && doc.defaultView;
    if (!win || !win.location) return '';
    const location = win.location;
    const appRoute = String(location.href || ((location.pathname || '') + (location.hash || '')));
    const shell = getPhotosShellWindow(win);
    return shell ? appRoute + '\n' + shell.location.href : appRoute;
  }

  function isUsableICloudFileInput(input) {
    if (!input || input.disabled || input.isConnected === false) return false;
    if (input.id === PICKER_ID) return false;
    if (input.type && String(input.type).toLowerCase() !== 'file') return false;
    if (typeof input.getAttribute !== 'function') return false;
    if (String(input.getAttribute('aria-disabled') || '').toLowerCase() === 'true') return false;
    try {
      if (typeof input.closest === 'function' && input.closest('#' + PANEL_ID)) return false;
    } catch (error) {
      return false;
    }
    const accept = String(input.getAttribute('accept') || '').trim();
    return !accept || PHOTO_ACCEPT_PATTERN.test(accept);
  }

  function getFileInputScore(input, knownInputs) {
    if (!isUsableICloudFileInput(input)) return -Infinity;
    let score = 0;
    const accept = String(input.getAttribute('accept') || '');
    if (PHOTO_ACCEPT_PATTERN.test(accept)) score += 100;
    if (input.multiple) score += 40;
    try {
      if (
        typeof input.closest === 'function' &&
        input.closest('[class*="PhotosRootContent"], [class*="PhotosApp"], [role="main"], main')
      ) {
        score += 80;
      }
    } catch (error) {
      // Keep the MIME/multiple score when the host rejects a selector.
    }
    // "Newly mounted" only ranks candidates that already look like a Photos
    // picker; it must never turn an unrelated generic file input into one.
    if (score < 120) return -Infinity;
    if (knownInputs && !knownInputs.has(input)) score += 1000;
    return score;
  }

  function selectICloudFileInput(inputs, doc, knownInputs) {
    let selected = null;
    let selectedScore = -Infinity;
    Array.from(inputs || []).forEach(function (input) {
      const score = getFileInputScore(input, knownInputs);
      if (score > selectedScore) {
        selected = input;
        selectedScore = score;
      }
    });
    return selected;
  }

  function cacheFileInput(doc, input) {
    if (input) {
      fileInputCacheByDocument.set(doc, {
        input,
        routeKey: getDocumentRouteKey(doc),
      });
    }
    return input;
  }

  function findICloudFileInput(doc, knownInputs) {
    const cached = fileInputCacheByDocument.get(doc);
    if (
      !knownInputs &&
      cached &&
      cached.routeKey === getDocumentRouteKey(doc) &&
      getFileInputScore(cached.input, null) > 119
    ) {
      return cached.input;
    }
    fileInputCacheByDocument.delete(doc);

    return cacheFileInput(
      doc,
      selectICloudFileInput(queryAllDeep(doc, 'input[type="file"]'), doc, knownInputs)
    );
  }

  // Shallow probe for the polling loop: one querySelectorAll instead of a full
  // deep walk. Only reaches inputs that are not inside a shadow root or iframe.
  function findICloudFileInputShallow(doc, knownInputs) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return null;
    return cacheFileInput(
      doc,
      selectICloudFileInput(doc.querySelectorAll('input[type="file"]'), doc, knownInputs)
    );
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function waitForICloudFileInput(doc, timeoutMs, intervalMs, knownInputs) {
    const startedAt = Date.now();
    const deadline = startedAt + (timeoutMs || 2500);
    const preferNewUntil = knownInputs ? Math.min(deadline, startedAt + 500) : startedAt;
    const interval = intervalMs || 80;
    let fallback = null;
    let polls = 0;

    while (Date.now() < deadline) {
      const input = polls % 4 === 0
        ? findICloudFileInput(doc, knownInputs)
        : findICloudFileInputShallow(doc, knownInputs);
      if (input) {
        if (!knownInputs || !knownInputs.has(input)) return input;
        fallback = input;
        if (Date.now() >= preferNewUntil) {
          const finalInput = findICloudFileInput(doc, knownInputs);
          if (finalInput && !knownInputs.has(finalInput)) return finalInput;
          return fallback;
        }
      }
      await sleep(interval);
      polls += 1;
    }
    return fallback;
  }

  // Labels that contain an upload keyword but mean something else. Without this
  // list a substring match on '添加'/'add' would happily click "添加到相簿".
  const NON_UPLOAD_LABEL_MARKERS = [
    'album', '相簿', '共享', 'share', 'description', 'caption', 'comment',
    '评论', '标题', 'title', 'person', 'people', '人脸', '地点', 'location',
    'date', '日期', 'tag', '标签', 'folder', '文件夹', 'link', '链接',
    'cancel upload', 'stop upload', 'abort upload', '取消上传', '停止上传', '终止上传', '取消上傳', '停止上傳',
  ];

  const UPLOAD_LABEL_MARKERS = [
    'upload', 'uploads', 'uploading', 'add photo', 'add photos', 'add image',
    'add images', 'add picture', 'add pictures', 'import photos', 'import photo',
    'choose photo', 'choose photos', 'select photos', 'upload photos',
    '上传', '上傳', '添加照片', '增加照片', '添加图片', '加入照片', '導入', '导入',
  ];

  function isUploadTrigger(element) {
    if (!element || typeof element.getAttribute !== 'function') return false;

    const label = [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.textContent,
    ].join(' ').toLowerCase();

    if (!label.trim()) return false;
    if (NON_UPLOAD_LABEL_MARKERS.some(function (marker) {
      return label.indexOf(marker) !== -1;
    })) return false;

    return UPLOAD_LABEL_MARKERS.some(function (marker) {
      return label.indexOf(marker) !== -1;
    });
  }

  function clickPossibleUploadTrigger(doc) {
    const candidates = queryAllDeep(doc, 'button, [role="button"], [aria-label], [title]').filter(function (element) {
      return !(typeof element.closest === 'function' && element.closest('#' + PANEL_ID));
    });
    const trigger = candidates.find(function (element) {
      return typeof element.click === 'function' && !element.disabled &&
        element.getAttribute('aria-disabled') !== 'true' && isUploadTrigger(element);
    });
    if (!trigger) return false;
    trigger.click();
    return true;
  }

  const LIBRARY_SIDEBAR_LABELS = [
    '图库', '圖庫', '所有照片', '照片', 'Library', 'All Photos', 'Photos',
  ];
  const PIVOT_SIDEBAR_LABELS = [
    '最近项目', '最近項目', '最近', '个人收藏', '個人收藏', '回忆', '回憶', '相簿', '媒体类型', '媒體類型',
    'Recents', 'Recent', 'Favorites', 'Memories', 'Albums', 'Media Types',
  ];

  function normalizeLabelText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function getSidebarItemKey(item) {
    return item ? (item.getAttribute && item.getAttribute('href')) || normalizeLabelText(item.textContent) : '';
  }

  function getSidebarCandidates(doc) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return [];
    const sidebar = Array.from(doc.querySelectorAll(SIDEBAR_ITEMS));
    if (sidebar.length) return sidebar;
    const ownPanel = doc.getElementById ? doc.getElementById(PANEL_ID) : null;
    return queryAllDeep(doc, 'nav a, nav button, [role="treeitem"], [role="tab"], [role="navigation"] a')
      .filter(function (element) {
        return typeof element.click === 'function' && !(ownPanel && ownPanel.contains && ownPanel.contains(element));
      });
  }

  function findSidebarItem(doc, labels) {
    const candidates = getSidebarCandidates(doc);
    for (const name of labels) {
      const label = normalizeLabelText(name);
      const match = candidates.find(function (element) {
        return normalizeLabelText(element.textContent) === label;
      });
      if (match) return match;
    }
    return null;
  }

  function findActiveSidebarItem(doc) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return null;
    const activeMarkers = [
      '[aria-current="page"]',
      '[aria-current="true"]',
      '[aria-selected="true"]',
      '.is-selected',
      '.selected',
      '.is-active',
      '.active',
    ].join(',');
    const sidebar = getSidebarCandidates(doc);
    return sidebar.find(function (element) {
      return typeof element.matches === 'function' && element.matches(activeMarkers) && getSidebarItemKey(element);
    }) || null;
  }

  function clickSidebarItem(item) {
    function preventBrowserNavigation(event) {
      event.preventDefault();
    }
    // Let Photos handle the selection without following the anchor into _top.
    if (item.addEventListener) item.addEventListener('click', preventBrowserNavigation, { once: true });
    try {
      item.click();
    } finally {
      if (item.removeEventListener) item.removeEventListener('click', preventBrowserNavigation);
    }
  }

  const KNOWN_HASH_ROUTES = [
    '#/recents',
    '#/favorites',
    '#/memories',
    '#/albums',
    '#/mediatypes',
  ];

  function captureLibraryViewState(doc) {
    const view = doc && typeof doc.querySelector === 'function'
      ? doc.querySelector('[class*="PhotosRootContent"], [class*="PhotosApp"]')
      : null;
    let grid = null;
    if (view && typeof view.querySelector === 'function') {
      grid = view.querySelector(
        '[role="grid"], [class*="PhotosGrid"], [class*="PhotoGrid"], [class*="GridView"]'
      );
    }
    const active = doc ? findActiveSidebarItem(doc) : null;
    let activeKey = '';
    if (active) {
      activeKey = getSidebarItemKey(active);
    }
    return { view, grid, activeKey };
  }

  function hasLibraryViewStateChanged(before, after) {
    if (after.view && after.view !== before.view) return true;
    if (after.grid && after.grid !== before.grid) return true;
    return Boolean(after.activeKey && after.activeKey !== before.activeKey);
  }

  function waitForLibraryViewChange(doc, win, action, timeoutMs, options) {
    const opts = options || {};
    if (opts.signal && opts.signal.aborted) return Promise.resolve(false);
    const before = captureLibraryViewState(doc);
    const Observer = (win && win.MutationObserver) || root.MutationObserver;
    const target = (doc && (doc.body || doc.documentElement)) || before.view;
    if (typeof Observer !== 'function' || !target) {
      try {
        action();
        return Promise.resolve(false);
      } catch (error) {
        return Promise.reject(error);
      }
    }

    return new Promise(function (resolve, reject) {
      let timer = null;
      let frame = null;
      let routeCheck = null;
      let settled = false;
      function changed() {
        return (!opts.isExpected || opts.isExpected()) &&
          hasLibraryViewStateChanged(before, captureLibraryViewState(doc));
      }
      function check() {
        frame = null;
        if (changed()) {
          finish(true);
        } else if (opts.pollRoute && routeCheck === null) {
          // The shell uses pushState, which does not fire hashchange.
          routeCheck = setTimeout(function () {
            routeCheck = null;
            scheduleCheck();
          }, 75);
        }
      }
      function scheduleCheck() {
        if (frame !== null || settled) return;
        if (win && typeof win.requestAnimationFrame === 'function') frame = win.requestAnimationFrame(check);
        else check();
      }
      function abort() {
        finish(false);
      }
      const observer = new Observer(scheduleCheck);
      function cleanup() {
        clearTimeout(timer);
        clearTimeout(routeCheck);
        if (frame !== null && win && typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(frame);
        if (opts.signal) opts.signal.removeEventListener('abort', abort);
        if (opts.routeWindow && opts.routeWindow.removeEventListener) {
          opts.routeWindow.removeEventListener('hashchange', scheduleCheck);
          opts.routeWindow.removeEventListener('popstate', scheduleCheck);
        }
        observer.disconnect();
      }
      function finish(didChange) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(didChange);
      }

      timer = setTimeout(function () {
        finish(false);
      }, Math.max(0, timeoutMs));
      try {
        observer.observe(target, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'aria-current', 'aria-selected'],
        });
        if (opts.signal) opts.signal.addEventListener('abort', abort, { once: true });
        if (opts.routeWindow && opts.routeWindow.addEventListener) {
          opts.routeWindow.addEventListener('hashchange', scheduleCheck);
          opts.routeWindow.addEventListener('popstate', scheduleCheck);
        }
        if (action() === false) {
          finish(false);
        } else if (changed()) {
          finish(true);
        } else if (opts.pollRoute) {
          scheduleCheck();
        }
      } catch (error) {
        if (!settled) {
          settled = true;
          cleanup();
          reject(error);
        }
      }
    });
  }

  async function softRefreshLibraryView(doc, win, options) {
    const opts = options || {};
    const totalTimeout = typeof opts.verificationTimeout === 'number'
      ? Math.max(0, opts.verificationTimeout)
      : 3000;
    const expiresAt = Date.now() + totalTimeout;
    if (!doc || !win || (doc.querySelector && doc.querySelector(CENTERED_VIEWER))) return false;
    const Controller = win.AbortController || root.AbortController;
    const navigation = typeof Controller === 'function' ? new Controller() : null;
    const shell = getPhotosShellWindow(win);
    function observe(action, isExpected, timeout) {
      return waitForLibraryViewChange(doc, win, action, Math.min(timeout, Math.max(0, expiresAt - Date.now())), {
        isExpected,
        signal: navigation && navigation.signal,
        routeWindow: shell || win,
        pollRoute: Boolean(shell),
      });
    }

    let userNavigated = false;
    function onNavigation(event) {
      if (!event.isTrusted || !event.target || !event.target.closest) return;
      if (event.target.closest(SIDEBAR_ITEMS + ', [role="treeitem"], ' + GRID_TILE)) {
        userNavigated = true;
        if (navigation) navigation.abort();
      }
    }
    if (doc.addEventListener) doc.addEventListener('click', onNavigation, true);

    try {
      const original = findActiveSidebarItem(doc);
      const originalKey = getSidebarItemKey(original);
      const items = getSidebarCandidates(doc);
      const pivot = PIVOT_SIDEBAR_LABELS.concat(LIBRARY_SIDEBAR_LABELS).map(normalizeLabelText)
        .map(function (label) {
          return items.find(function (item) {
            return normalizeLabelText(item.textContent) === label && getSidebarItemKey(item) !== originalKey;
          });
        }).find(Boolean);

      // Inside the current iCloud shell the iframe hash is only a launch
      // parameter. The actual route belongs to the sidebar and outer page.
      if (original && pivot) {
        const pivotKey = getSidebarItemKey(pivot);
        function isSelected(key) {
          if (userNavigated || getSidebarItemKey(findActiveSidebarItem(doc)) !== key) return false;
          if (!shell || !/^https?:\/\//i.test(key)) return true;
          const expected = new URL(key);
          const current = shell.location;
          return current.origin === expected.origin && current.pathname === expected.pathname &&
            current.hash.replace(/\/$/, '') === expected.hash.replace(/\/$/, '');
        }
        if (!isSelected(originalKey)) return false;
        const entered = await observe(function () {
          clickSidebarItem(pivot);
        }, function () { return isSelected(pivotKey); }, Math.ceil(totalTimeout / 2));
        // Give the shell time to settle before issuing the second sidebar action.
        if (shell && entered && !userNavigated) await sleep(250);
        if (!isSelected(pivotKey)) return false;
        const currentOriginal = getSidebarCandidates(doc).find(function (item) {
          return getSidebarItemKey(item) === originalKey;
        });
        if (!currentOriginal) return false;
        const restored = await observe(function () {
          clickSidebarItem(currentOriginal);
        }, function () { return isSelected(originalKey); }, totalTimeout);
        return entered && restored;
      }

      if (
        !win.location || typeof win.location.hash !== 'string' || opts.allowHashNavigation === false ||
        shell || win.location.hash.indexOf('#launchRoute=') === 0
      ) return false;

      const originalHash = win.location.hash || '';
      const pivotHash = KNOWN_HASH_ROUTES.find(function (candidate) {
        return !originalHash.startsWith(candidate);
      });
      if (!pivotHash) return false;
      const isAt = function (hash) { return !userNavigated && win.location.hash === hash; };
      const entered = await observe(function () {
        win.location.hash = pivotHash;
      }, function () { return isAt(pivotHash); }, Math.ceil(totalTimeout / 2));
      if (!isAt(pivotHash)) return false;
      const restored = await observe(function () {
        win.location.hash = originalHash;
      }, function () { return isAt(originalHash); }, totalTimeout);
      return entered && restored;
    } finally {
      if (doc.removeEventListener) doc.removeEventListener('click', onNavigation, true);
    }
  }

  function transferFilesToInput(input, files, win) {
    if (!input || !files.length) return false;
    const transfer = createDataTransfer(files, win);
    if (!transfer) return false;
    try {
      const pending = Array.from(transfer.files);
      if (pending.length !== files.length) return false;
      input.files = transfer.files;
      // Assigning input.files is a silent no-op when the browser rejects it, so
      // verify the files themselves: the control can still hold an older batch.
      const attached = input.files;
      if (!attached || attached.length !== pending.length ||
          pending.some(function (file, index) { return attached[index] !== file; })) return false;
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
    } catch (error) {
      return false;
    }
  }

  function createDataTransfer(files, win) {
    const WindowDataTransfer = win && win.DataTransfer;
    if (typeof WindowDataTransfer !== 'function') return null;
    try {
      const transfer = new WindowDataTransfer();
      files.forEach(function (file) {
        transfer.items.add(file);
      });
      return transfer;
    } catch (error) {
      return null;
    }
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

  function findDropTarget(doc) {
    const selectors = [
      '[data-testid*="drop" i]',
      '[role="main"]',
      'main',
      '#root',
      '#app',
    ];
    for (let i = 0; i < selectors.length; i += 1) {
      const candidates = queryAllDeep(doc, selectors[i]);
      for (let j = 0; j < candidates.length; j += 1) {
        const candidate = candidates[j];
        if (
          candidate &&
          !(typeof candidate.closest === 'function' && candidate.closest('#' + PANEL_ID))
        ) {
          return candidate;
        }
      }
    }
    return doc.body || doc.documentElement || null;
  }
  function dropFilesOnICloudPage(files, doc, win) {
    const transfer = createDataTransfer(files, win);
    const target = transfer && findDropTarget(doc);
    if (!target || typeof target.dispatchEvent !== 'function') return false;
    let handled = false;
    try {
      ['dragenter', 'dragover', 'drop'].forEach(function (type) {
        const event = createDragEvent(type, transfer, win);
        target.dispatchEvent(event);
        if (type === 'drop') handled = event.defaultPrevented;
      });
    } catch (error) {
      return false;
    }
    return handled;
  }

  // Returns the number of images actually handed to iCloud (0 on failure) so the
  // caller reports what happened instead of what was attempted.
  async function uploadViaICloudPage(files, doc, win, status, options) {
    const route = options && typeof options.routeKey === 'string'
      ? options.routeKey : getDocumentRouteKey(doc);
    function isOriginalRoute() {
      return route === getDocumentRouteKey(doc);
    }
    function routeChanged() {
      if (isOriginalRoute()) return false;
      status('图库视图已切换，本批未发送。请在当前视图重新选择图片。', true);
      return true;
    }
    let failures = [];
    function reportHandoff(message, isError) {
      status(message + (failures.length ? '\n' + describeSkippedFiles(failures) : ''), isError);
    }

    if (routeChanged()) return 0;
    let images = filterImageFiles(files);
    if (!images.length) {
      status('这里只能上传图片文件。', true);
      return 0;
    }
    try {
      images = await normalizeFilesForICloudWebUpload(images, win, status, undefined, {
        shouldContinue: isOriginalRoute,
        onFailures: function (details) {
          failures = details;
        },
      });
    } catch (error) {
      status(error.message, true);
      return 0;
    }
    if (routeChanged()) return 0;
    if (!images.length) return 0;
    const beforeDispatch = options && options.beforeDispatch;
    if (typeof beforeDispatch === 'function') await beforeDispatch();
    if (routeChanged()) return 0;

    let input = findICloudFileInput(doc);
    if (!input) {
      const knownInputs = new Set(queryAllDeep(doc, 'input[type="file"]'));
      status('正在打开 iCloud 上传控件...');
      const clickedUploadTrigger = clickPossibleUploadTrigger(doc);
      input = clickedUploadTrigger
        ? await waitForICloudFileInput(doc, 3000, undefined, knownInputs)
        : null;
    }
    if (routeChanged()) return 0;
    if (!input) {
      status('找不到 iCloud 上传控件，正在尝试拖拽上传通道...');
      const handled = dropFilesOnICloudPage(images, doc, win);
      reportHandoff(
        handled
          ? '已触发拖放，请查看 iCloud 原生上传状态确认是否入队。'
          : '无法确认 iCloud 是否接收了拖放图片。请查看上传状态，必要时使用原生“上传”按钮。',
        !handled
      );
      return 0;
    }
    const inputWindow = input.ownerDocument && input.ownerDocument.defaultView || win;
    const transferred = transferFilesToInput(input, images, inputWindow);
    if (!transferred) {
      reportHandoff('未能将图片交给 iCloud。请使用 iCloud 原生工具栏的“上传”按钮。', true);
      return 0;
    }
    reportHandoff('已向 iCloud 提交 ' + images.length + ' 张图片。');
    return images.length;
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
      'touch-action:none;-webkit-user-select:none;user-select:none;overflow:visible;',
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
      '#' + PANEL_ID + '-toast{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(80px,env(safe-area-inset-bottom));',
      'z-index:2147483647;width:min(320px,calc(100vw - 32px));box-sizing:border-box;',
      'transform:translateY(10px);white-space:normal;word-break:normal;overflow-wrap:anywhere;',
      'background:rgba(30,30,34,.94);color:#f5f5f7;',
      'font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      'padding:12px 16px;border:1px solid rgba(255,255,255,.12);border-left:3px solid #0a84ff;',
      'border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.28);backdrop-filter:blur(16px);',
      '-webkit-backdrop-filter:blur(16px);pointer-events:none;opacity:0;visibility:hidden;',
      'transition:opacity .2s ease,transform .2s ease,visibility .2s;',
      'max-height:30vh;overflow:auto;overscroll-behavior:contain;cursor:default;text-align:left;',
      '-webkit-user-select:text;user-select:text;touch-action:auto}',
      '#' + PANEL_ID + '-toast.is-visible{opacity:1;visibility:visible;transform:translateY(0);pointer-events:auto}',
      '#' + PANEL_ID + '-toast.is-error{border-left-color:#ff453a;background:rgba(74,25,30,.96)}',
      '#' + PICKER_ID + '{display:none}',
      '[data-iu-camera="active"]{transition:var(--iu-camera-transition)!important}',
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

  function loadSavedPosition(win, key) {
    try {
      const storageKey = key || POSITION_KEY;
      const raw = win.localStorage && win.localStorage.getItem(storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function savePosition(win, position, key) {
    try {
      const storageKey = key || POSITION_KEY;
      if (win.localStorage) win.localStorage.setItem(storageKey, JSON.stringify(position));
    } catch (error) {
      // Ignore storage failures; dragging still works for the current page.
    }
  }


  function applyPanelPosition(panel, position) {
    panel.style.left = position.left + 'px';
    panel.style.top = position.top + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  // A position saved on a larger window (or a second monitor that is no longer
  // attached) would otherwise restore the FAB off-screen with no way to grab it.
  function restorePanelPosition(panel, win) {
    const savedPosition = loadSavedPosition(win);
    if (!savedPosition) return;

    const rect = typeof panel.getBoundingClientRect === 'function'
      ? panel.getBoundingClientRect()
      : { width: 44, height: 44 };
    const clamped = calculateDraggedPanelPosition({
      pointerX: savedPosition.left + (rect.width || 44) / 2,
      pointerY: savedPosition.top + (rect.height || 44) / 2,
      offsetX: (rect.width || 44) / 2,
      offsetY: (rect.height || 44) / 2,
      panelWidth: rect.width || 44,
      panelHeight: rect.height || 44,
      viewportWidth: win.innerWidth || 0,
      viewportHeight: win.innerHeight || 0,
      margin: 8,
    });
    applyPanelPosition(panel, clamped);
    return clamped;
  }


  function enableFabDragging(panel, win) {
    restorePanelPosition(panel, win);
    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('resize', function () {
        restorePanelPosition(panel, win);
      });
    }

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
    ].join('');

    const picker = doc.createElement('input');
    picker.id = PICKER_ID;
    picker.type = 'file';
    picker.accept = 'image/*,.heic,.heif,.ico,.svg,.avif';
    picker.multiple = true;
    picker.hidden = true;
    // Keep notifications outside the 44px draggable/transformed button.
    // A fixed card must use the viewport, not the button's containing block.
    const toastId = PANEL_ID + '-toast';
    const toast = doc.getElementById(toastId) || doc.createElement('div');
    toast.id = toastId;
    toast.className = 'iu-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    let toastTimer = null;

    enableFabDragging(panel, win);

    function status(message, isError) {
      toast.textContent = message;
      toast.scrollTop = 0;
      toast.classList.toggle('is-error', Boolean(isError));
      toast.classList.add('is-visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toast.classList.remove('is-visible');
      }, isError ? 6000 : 2800);
      if (isError) console.warn(LOG_PREFIX, message);
      else console.log(LOG_PREFIX, message);
    }
    panel._showUploaderStatus = status;

    let reloadTimer = null;
    let activeRefreshGeneration = null;
    let activeSyncTask = null;
    let reloadInFlight = null;
    let refreshOriginRoute = null;
    let uploadFeedback = [];
    let sendQueue = Promise.resolve();
    const refreshGate = createGenerationGate();
    const refreshDemand = createRefreshDemandTracker();

    function isRefreshCurrent(generation) {
      return activeRefreshGeneration === generation && refreshGate.isCurrent(generation);
    }

    function isRefreshActive() {
      return activeRefreshGeneration !== null && isRefreshCurrent(activeRefreshGeneration);
    }

    function refreshStatus(message, isError) {
      status(uploadFeedback.map(function (entry) { return entry.message; }).concat(message).join('\n'),
        isError || uploadFeedback.some(function (entry) { return entry.isError; }));
    }

    function clearPendingReload() {
      clearTimeout(reloadTimer);
      reloadTimer = null;
      if (activeSyncTask) {
        activeSyncTask.abort();
        activeSyncTask = null;
      }
      refreshGate.invalidate();
      activeRefreshGeneration = null;
      panel.classList.remove('is-pending-reload');
      panel.title = text.tooltip;
    }

    function doReload() {
      if (reloadInFlight) return reloadInFlight;
      clearPendingReload();
      refreshOriginRoute = getDocumentRouteKey(doc);
      reloadInFlight = Promise.resolve().then(async function () {
        try {
          const softened = await softRefreshLibraryView(doc, win);
          if (softened) {
            refreshDemand.clear();
            refreshStatus('已刷新图库');
            uploadFeedback = [];
            return true;
          }
          refreshStatus('未完成软刷新。若照片尚未显示，可在 iCloud 侧边栏切换视图后返回。');
        } catch (error) {
          refreshStatus('刷新图库失败，请手动切换视图。', true);
          console.warn(LOG_PREFIX, 'Soft refresh failed:', error && error.message ? error.message : error);
        }
        return false;
      }).finally(function () {
        reloadInFlight = null;
        refreshOriginRoute = null;
        if (refreshDemand.ready()) {
          panel.classList.add('is-pending-reload');
          panel.title = '点击重试刷新图库';
        }
      });
      return reloadInFlight;
    }

    async function fetchSyncToken(signal) {
      const perf = (win && win.performance) || root.performance;
      if (
        !perf ||
        typeof perf.getEntriesByType !== 'function' ||
        !win ||
        typeof win.fetch !== 'function'
      ) {
        return null;
      }
      const entries = perf.getEntriesByType('resource');
      let ckEntry = null;
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        if (
          entries[i].name.indexOf('ckdatabasews') !== -1 &&
          entries[i].name.indexOf('photos.cloud') !== -1 &&
          entries[i].name.indexOf('zones/list') !== -1
        ) {
          ckEntry = entries[i];
          break;
        }
      }
      if (!ckEntry) return null;
      try {
        return await fetchCloudKitSyncState(win, ckEntry.name, signal);
      } catch (error) {
        return null;
      }
    }

    function captureBaselineToken() {
      const task = startAbortableTask(
        fetchSyncToken,
        1500,
        (win && win.AbortController) || root.AbortController,
        'Sync baseline timed out.'
      );
      return task.promise.catch(function () {
        return null;
      });
    }

    function schedulePendingRefresh() {
      const demand = refreshDemand.ready();
      if (!demand || reloadInFlight) return;
      clearPendingReload();
      const generation = refreshGate.next();
      activeRefreshGeneration = generation;
      panel.classList.add('is-pending-reload');
      panel.title = '点击立即刷新图库';
      void pollSyncTokenAndRefresh(demand.baseline, generation).catch(function (error) {
        console.warn(LOG_PREFIX, 'Sync polling failed:', error);
        if (isRefreshCurrent(generation)) void doReload();
      });
    }

    async function pollSyncTokenAndRefresh(baseToken, generation) {
      if (!isRefreshCurrent(generation)) return;
      if (!baseToken) {
        refreshStatus('无法读取同步状态，将在 5 秒后尝试软刷新。');
        reloadTimer = setTimeout(function () {
          reloadTimer = null;
          if (isRefreshCurrent(generation)) void doReload();
        }, 5000);
        return;
      }

      refreshStatus('等待图库同步…');
      const expiresAt = Date.now() + 30000;
      let delay = 2000;

      function scheduleNextPoll() {
        if (!isRefreshCurrent(generation)) return;
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
          refreshStatus('等待图库同步超时，尝试软刷新…');
          void doReload();
          return;
        }
        reloadTimer = setTimeout(function () {
          reloadTimer = null;
          void poll();
        }, Math.min(delay, remaining));
      }

      async function poll() {
        if (!isRefreshCurrent(generation)) return;
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
          scheduleNextPoll();
          return;
        }
        const task = startAbortableTask(
          fetchSyncToken,
          Math.min(5000, remaining),
          (win && win.AbortController) || root.AbortController,
          'Sync check timed out.'
        );
        activeSyncTask = task;
        const token = await task.promise.catch(function () {
          return null;
        });
        if (activeSyncTask === task) activeSyncTask = null;
        if (!isRefreshCurrent(generation)) return;
        if (token && token !== baseToken) {
          refreshStatus('检测到图库同步更新，正在刷新…');
          void doReload();
          return;
        }
        delay = Math.min(delay + 1000, 5000);
        scheduleNextPoll();
      }

      scheduleNextPoll();
    }

    async function sendBatch(files, routeKey) {
      if (reloadInFlight) await reloadInFlight;

      // Batches run serially. The outer queue pauses any active refresh while
      // preserving the latest successful batch's outstanding refresh demand.
      panel.classList.add('is-busy');
      let uploadedCount = 0;
      let baseToken = null;
      let result;
      function report(message, isError) {
        result = { message, isError: Boolean(isError) };
        status(message, isError);
      }
      try {
        uploadedCount = await uploadViaICloudPage(files, doc, win, report, {
          routeKey,
          beforeDispatch: async function () {
            baseToken = await captureBaselineToken();
          },
        });
      } catch (error) {
        const detail = error && error.message ? error.message : String(error);
        report('上传处理失败：' + detail, true);
        console.warn(LOG_PREFIX, 'Upload failed:', error);
      } finally {
        panel.classList.remove('is-busy');
      }
      if (result) uploadFeedback.push(result);
      if (uploadedCount > 0) {
        refreshDemand.recordSuccess(baseToken);
      }
    }

    function send(files) {
      const queuedFiles = filterImageFiles(files);
      if (!queuedFiles.length) {
        status('只能上传图片', true);
        return Promise.resolve();
      }
      if (!refreshDemand.hasPending()) uploadFeedback = [];
      const routeKey = refreshOriginRoute === null ? getDocumentRouteKey(doc) : refreshOriginRoute;
      refreshDemand.enqueue();
      clearPendingReload();
      sendQueue = sendQueue.then(
        function () { return sendBatch(queuedFiles, routeKey); },
        function () { return sendBatch(queuedFiles, routeKey); }
      ).catch(function (error) {
        const detail = error && error.message ? error.message : String(error);
        status('上传处理失败：' + detail, true);
        console.warn(LOG_PREFIX, 'Queued upload failed:', error);
      }).finally(function () {
        if (refreshDemand.finish()) schedulePendingRefresh();
      });
      return sendQueue;
    }

    panel.addEventListener('click', function (event) {
      // Suppress the click that follows a drag.
      if (panel._recentDrag) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (isRefreshActive() || panel.classList.contains('is-pending-reload')) {
        event.preventDefault();
        void doReload();
        return;
      }
      picker.click();
    });

    panel.addEventListener('contextmenu', function (event) {
      // Right-click: quick detection debug.
      event.preventDefault();
      status('检测 iCloud 上传控件…');
      Promise.resolve().then(async function () {
        let found = findICloudFileInput(doc);
        if (!found) {
          const knownInputs = new Set(queryAllDeep(doc, 'input[type="file"]'));
          clickPossibleUploadTrigger(doc);
          found = await waitForICloudFileInput(doc, 3000, undefined, knownInputs);
        }
        status(found ? '已找到 iCloud 上传控件' : '未找到上传控件', !found);
      }).catch(function (error) {
        status('检测上传控件失败。', true);
        console.warn(LOG_PREFIX, 'Upload input detection failed:', error);
      });
    });

    picker.addEventListener('change', function () {
      const files = snapshotFiles(picker.files);
      picker.value = '';
      void send(files);
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
      // Keep the drop from bubbling to iCloud's own drop handling, which would
      // enqueue the very same DataTransfer a second time.
      event.stopPropagation();
      panel.classList.remove('is-dragging');
      void send(event.dataTransfer && event.dataTransfer.files);
    });

    // Expose the current panel's upload handler so the shared paste listener
    // (installed once by installPasteListener) can dispatch to the active panel
    // even after a MutationObserver re-mount swaps the send closure.
    panel._handlePasteUpload = send;

    function attachPanel() {
      if (!doc.body) return;
      for (const element of [picker, toast, panel]) {
        if (element.parentNode !== doc.body) doc.body.appendChild(element);
      }
    }
    attachPanel();
    return attachPanel;
  }

  function installPasteListener(doc, win) {
    let dispatchPaste = pasteDispatcherByDocument.get(doc);
    if (!dispatchPaste) {
      dispatchPaste = function (event) {
        // One paste bubbles through body, document and window. A WeakSet dedupes
        // it without mutating browser-owned Event objects.
        if (handledPasteEvents.has(event)) return;
        handledPasteEvents.add(event);

        // Do not hijack text entry in iCloud search, rename, or description UI.
        if (isEditablePhotoCopyTarget(event.target)) return;

        const files = extractImageFilesFromPaste(event);
        if (!files.length) return;
        const panel = doc.getElementById(PANEL_ID);
        if (!panel || typeof panel._handlePasteUpload !== 'function') return;
        event.preventDefault();
        Promise.resolve().then(function () {
          return panel._handlePasteUpload(files);
        }).catch(function (error) {
          console.warn(LOG_PREFIX, 'Paste handler failed:', error && error.message ? error.message : error);
        });
      };
      pasteDispatcherByDocument.set(doc, dispatchPaste);
    }

    // Body can be replaced by the app shell, so inspect all three targets on
    // every mount while registering each concrete EventTarget only once.
    const targets = [];
    if (win && typeof win.addEventListener === 'function') targets.push(win);
    if (doc && typeof doc.addEventListener === 'function' && doc !== win) targets.push(doc);
    if (doc && doc.body && typeof doc.body.addEventListener === 'function') targets.push(doc.body);

    targets.forEach(function (target) {
      if (registeredPasteTargets.has(target)) return;
      try {
        target.addEventListener('paste', dispatchPaste, true);
        registeredPasteTargets.add(target);
      } catch (error) {
        // A later mount can retry a target that rejected registration.
      }
    });
  }

  // iCloud sets pointer-events:none on the popover wrapper and re-enables it only
  // inside ui-popover-content, so an injected row has to live in the menu list
  // (and carry its own pointer-events) to be reachable by a real mouse click.
  const COPY_MENU_BASE_HEIGHT_ATTR = 'data-icloud-copy-menu-base-height';
  const COPY_MENU_APPLIED_HEIGHT_ATTR = 'data-icloud-copy-menu-applied-height';
  const GRID_COPY_MENU_ATTR = 'data-icloud-copy-photo';
  const GRID_DOWNLOAD_MENU_ATTR = 'data-icloud-download-photo';

  function getCopyablePhotoImageSource(image) {
    if (!image) return '';
    return String(image.currentSrc || image.src || '').trim();
  }

  function findCopyablePhotoImage(target) {
    // iCloud dispatches the tile contextmenu from its <img>. Accepting a parent
    // could otherwise turn a checkbox, title, or blank grid area into a copy
    // action for an unrelated thumbnail.
    if (String((target || {}).tagName || '').toUpperCase() !== 'IMG') return null;
    return getCopyablePhotoImageSource(target) ? target : null;
  }

  function findPhotoImageInNode(node, x, y) {
    if (!node) return null;
    const direct = findCopyablePhotoImage(node);
    if (direct) {
      // Direct hits keep the historic behavior (thin stubs lack layout), but
      // small UI artwork must never count as a photo.
      const rect = typeof direct.getBoundingClientRect === 'function'
        ? direct.getBoundingClientRect()
        : null;
      if (!rect || rect.width >= 64) return direct;
      return null;
    }
    if (typeof node.querySelectorAll !== 'function') return null;
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    const candidates = node.querySelectorAll('img');
    for (let i = 0; i < candidates.length; i += 1) {
      const image = candidates[i];
      if (!getCopyablePhotoImageSource(image)) continue;
      const rect = typeof image.getBoundingClientRect === 'function'
        ? image.getBoundingClientRect()
        : null;
      if (!rect || rect.width < 64 || rect.height < 64) continue;
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      return image;
    }
    return null;
  }

  function findCopyablePhotoImageFromEvent(event, doc) {
    if (!event) return null;
    const x = typeof event.clientX === 'number' ? event.clientX : undefined;
    const y = typeof event.clientY === 'number' ? event.clientY : undefined;
    const direct = findCopyablePhotoImage(event.target);
    if (direct) return direct;
    const target = event.target;
    if (target && typeof target.closest === 'function') {
      try {
        if (target.closest('button, input, [role="button"], [role="checkbox"]')) return null;
      } catch (error) {
        // Fall through to the coordinate lookup when the host rejects a selector.
      }
    }
    // iCloud sets pointer-events:none on tile images, so hit testing never
    // returns the <img> itself. Resolve it from the containing tile instead,
    // matching by pointer coordinates so blank grid areas never copy an
    // unrelated thumbnail.
    const fromTarget = findPhotoImageInNode(target, x, y);
    if (fromTarget) return fromTarget;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (let i = 0; i < path.length; i += 1) {
      const found = findPhotoImageInNode(path[i], x, y);
      if (found) return found;
    }
    if (!doc || typeof doc.elementsFromPoint !== 'function' || x === undefined || y === undefined) {
      return null;
    }
    const stack = doc.elementsFromPoint(x, y) || [];
    for (let i = 0; i < stack.length; i += 1) {
      const found = findPhotoImageInNode(stack[i], x, y);
      if (found) return found;
    }
    return null;
  }

  async function renderPhotoImageToBlob(image, win) {
    // A revoked object URL still leaves decoded pixels in the <img>.
    const doc = (image && image.ownerDocument) || (win && win.document);
    const width = Number(image && (image.naturalWidth ?? image.width)) || 0;
    const height = Number(image && (image.naturalHeight ?? image.height)) || 0;
    if (!width || !height) throw new Error('无法读取图片数据。');
    if (width > MAX_CANVAS_EDGE_PX || height > MAX_CANVAS_EDGE_PX || width * height > MAX_CANVAS_PIXELS) {
      throw new RangeError('图像尺寸超出剪贴板转换上限，请使用 iCloud 原生下载。');
    }
    let canvas = null;
    try {
      canvas = doc && typeof doc.createElement === 'function' ? doc.createElement('canvas') : null;
      if (!canvas) throw new Error('无法读取图片数据。');
      canvas.width = width;
      canvas.height = height;
      const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      if (!context) throw new Error('无法读取图片数据。');
      context.drawImage(image, 0, 0, width, height);
      const blob = await canvasToBlob(canvas, 'image/png');
      if (String(blob && blob.type || '').toLowerCase() !== 'image/png') {
        throw new Error('无法读取 PNG 图片数据。');
      }
      return blob;
    } finally {
      // Release the backing store on success, taint errors, or stalled encoding.
      if (canvas) {
        canvas.width = 1;
        canvas.height = 1;
      }
    }
  }

  const COPY_FETCH_TIMEOUT_MS = 10000;

  function renderUnchangedPhoto(image, win, source) {
    if (getCopyablePhotoImageSource(image) !== source) {
      throw new Error('照片已切换，请重新拷贝。');
    }
    return renderPhotoImageToBlob(image, win);
  }

  async function fetchCopyablePhotoImageBlob(image, win, source) {
    // The decoded image remains usable even after iCloud revokes its blob URL.
    if (image && image.complete !== false && image.naturalWidth && image.naturalHeight) {
      try {
        return await renderUnchangedPhoto(image, win, source);
      } catch (error) {
        if (error.name !== 'SecurityError') throw error;
        // An HTTP image with an unreadable canvas can still have a fetchable response.
      }
    }
    const fetchFn = win && win.fetch;
    if (source && typeof fetchFn === 'function') {
      try {
        // One deadline covers BOTH response headers and consuming the body.
        const task = startAbortableTask(async function (signal) {
          const response = await fetchFn.call(win, source, {
            credentials: 'include',
            signal,
          });
          if (signal && signal.aborted) return null;
          if (response && response.ok && typeof response.blob === 'function') {
            return response.blob();
          }
          return null;
        }, COPY_FETCH_TIMEOUT_MS, (win && win.AbortController) || root.AbortController,
        '读取图片超时。');
        const blob = await task.promise;
        const type = String(blob && blob.type || '').toLowerCase();
        if (type === 'image/png') return blob;
        if (type.startsWith('image/')) {
          const decoded = await decodeImageForCanvas(blob, win);
          try {
            return await renderPhotoImageToBlob(decoded, win);
          } finally {
            if (typeof decoded.close === 'function') decoded.close();
          }
        }
      } catch (error) {
        if (error.name === 'RangeError') throw error;
        // The current image may have finished loading during the request.
      }
    }
    return renderUnchangedPhoto(image, win, source);
  }

  async function copyPhotoImageToClipboard(image, win, preparedBlob) {
    const clipboard = win && win.navigator && win.navigator.clipboard;
    const ClipboardItemCtor = (win && win.ClipboardItem) || root.ClipboardItem;
    if (!clipboard || typeof clipboard.write !== 'function' || typeof ClipboardItemCtor !== 'function') {
      return false;
    }
    const source = getCopyablePhotoImageSource(image);
    const blobPromise = preparedBlob
      ? Promise.resolve(preparedBlob)
      : Promise.resolve().then(function () {
        return fetchCopyablePhotoImageBlob(image, win, source);
      });
    // No await before write: Safari requires the original click/keydown activation.
    const pngPromise = blobPromise.then(function (blob) {
      const type = String(blob && blob.type || '').toLowerCase();
      if (type === 'image/png') return blob;
      if (!/^image\//.test(type)) throw new Error('图片数据格式无效。');
      return renderUnchangedPhoto(image, win, source);
    });
    // A constructor/write failure can occur before the browser consumes the data.
    // Observe its rejection too, so a later fetch failure cannot go unhandled.
    pngPromise.catch(function () {});
    await clipboard.write([new ClipboardItemCtor({ 'image/png': pngPromise })]);
    return true;
  }

  function isPhotoMenuContainer(node) {
    if (!node) return false;
    const role = typeof node.getAttribute === 'function' ? String(node.getAttribute('role') || '') : '';
    const marker = [node.className, node.id, typeof node.getAttribute === 'function' ? node.getAttribute('data-testid') : '']
      .join(' ');
    if (role !== 'menu' && !/(menu|context|popup)/i.test(marker)) return false;
    const label = String(node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const commands = label.match(/下载|下載|download|个人收藏|個人收藏|加入喜好項目|favorite|隐藏|隱藏|hide|删除|刪除|delete|添加到相簿|加入相簿|加至相簿|add to album/g) || [];
    return new Set(commands).size >= 2;
  }

  function findPhotoContextMenus(doc) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return [];
    const menus = [];
    const seen = new Set();
    const items = doc.querySelectorAll(
      '[role="menuitem"], button, [role="menu"], [class*="menu" i], ' +
      '[class*="context" i], [data-testid*="menu" i]'
    );
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const label = String(item.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!/(下载|下載|更多下载选项|更多下載選項|download|more download options)/.test(label)) continue;
      let menu = typeof item.closest === 'function' ? item.closest('[role="menu"]') : null;
      let node = menu || item;
      for (let depth = 0; node && depth < 7; depth += 1) {
        if (isPhotoMenuContainer(node)) {
          if (!seen.has(node)) {
            seen.add(node);
            menus.push(node);
          }
          break;
        }
        node = node.parentElement || node.parentNode;
      }
    }
    return menus;
  }

  function showCopyPhotoStatus(doc, message, isError) {
    const panel = doc && typeof doc.getElementById === 'function' ? doc.getElementById(PANEL_ID) : null;
    if (panel && typeof panel._showUploaderStatus === 'function') {
      panel._showUploaderStatus(message, Boolean(isError));
    }
  }

  // The popover node is reused across opens and iCloud rewrites its inline height
  // for each menu it shows, so work out whether the current height still carries
  // our previous offset before adding ours again. Returns the height iCloud
  // itself wants, or null when it is auto-sized.
  function resolveCopyMenuBaseHeight(options) {
    const current = options ? options.current : NaN;
    const storedBase = options ? options.storedBase : NaN;
    const storedApplied = options ? options.storedApplied : NaN;
    const inflated =
      isFinite(storedBase) &&
      isFinite(storedApplied) &&
      isFinite(current) &&
      Math.abs(current - (storedBase + storedApplied)) < 0.5;
    if (inflated) return storedBase;
    return isFinite(current) ? current : null;
  }

  function readCopyMenuAttr(element, name) {
    return element && typeof element.getAttribute === 'function' ? element.getAttribute(name) : null;
  }

  function findCopyMenuItemList(menu) {
    if (!menu || typeof menu.querySelector !== 'function') return menu || null;
    return (
      menu.querySelector('ui-menu-scroll-container[role="menu"]') ||
      menu.querySelector('[role="menu"]') ||
      menu
    );
  }

  // An extra row would otherwise push the last entry into the menu's scroll area
  // and clip it, because iCloud pins an explicit pixel height on the popover.
  // `extra` is the combined height of every row we injected this time.
  function isInjectedMenuRow(row) {
    if (!row || typeof row.getAttribute !== 'function') return false;
    return (
      row.getAttribute(GRID_COPY_MENU_ATTR) !== null ||
      row.getAttribute(GRID_DOWNLOAD_MENU_ATTR) !== null
    );
  }

  function findNativeMenuRow(container, matcher) {
    if (!container || typeof container.querySelectorAll !== 'function') return null;
    const rows = container.querySelectorAll('[role="menuitem"]');
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (isInjectedMenuRow(row)) continue;
      const label = String(row.textContent || '').replace(/\s+/g, ' ').trim();
      if (matcher.test(label)) return row;
    }
    return null;
  }

  // iCloud's own 下载 row, excluding the ones this script injects.
  function findNativeDownloadItem(container) {
    return findNativeMenuRow(container, /^(下载|下載|download)/i);
  }

  // Keep the native menu's item order, DOM identity and event bindings intact.
  // The old 下载原片 row was only an alias for native 下载; inserting a clone
  // shifts DOM positions relative to the app's own registered menu items.
  // Retain this entrypoint for compatibility, but only clean up legacy rows.
  function addGridDownloadMenuItem(doc, win, menu) {
    if (!menu || !doc) return false;
    const list = findCopyMenuItemList(menu);
    if (!list || !findNativeDownloadItem(list)) return false;
    if (typeof list.querySelectorAll === 'function') {
      const stale = list.querySelectorAll(
        '[' + GRID_COPY_MENU_ATTR + '], [' + GRID_DOWNLOAD_MENU_ATTR + ']'
      );
      for (let i = 0; i < stale.length; i += 1) {
        if (stale[i] && typeof stale[i].remove === 'function') stale[i].remove();
      }
    }
    const popover = typeof menu.closest === 'function'
      ? menu.closest('ui-popover') || menu
      : menu;
    const content = typeof popover.querySelector === 'function'
      ? popover.querySelector('ui-popover-content')
      : null;
    [popover, content].forEach(function (element) {
      if (!element || !element.style) return;
      const current = parseFloat(element.style.height);
      const base = parseFloat(readCopyMenuAttr(element, COPY_MENU_BASE_HEIGHT_ATTR));
      const extra = parseFloat(readCopyMenuAttr(element, COPY_MENU_APPLIED_HEIGHT_ATTR));
      // Restore only a height still carrying our exact old offset. Never undo
      // a new size written by iCloud when it reuses the popover for another menu.
      if (Number.isFinite(base) && Number.isFinite(extra) &&
          Number.isFinite(current) && Math.abs(current - (base + extra)) < 0.5) {
        element.style.height = base + 'px';
      }
      if (typeof element.removeAttribute === 'function') {
        element.removeAttribute(COPY_MENU_BASE_HEIGHT_ATTR);
        element.removeAttribute(COPY_MENU_APPLIED_HEIGHT_ATTR);
      }
    });
    return true;
  }

  function installGridPhotoCopyMenu(doc, win) {
    const stale = doc.querySelectorAll('[' + GRID_COPY_MENU_ATTR + '], [' + GRID_DOWNLOAD_MENU_ATTR + '], [' +
      COPY_MENU_APPLIED_HEIGHT_ATTR + ']');
    const menus = new Set();
    for (const node of stale) {
      const menu = node.closest('ui-popover, [role="menu"]');
      if (menu) menus.add(menu);
    }
    for (const menu of menus) addGridDownloadMenuItem(doc, win, menu);
  }

  function isEditablePhotoCopyTarget(target) {
    if (!target) return false;
    const tag = String(target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return Boolean(target.isContentEditable);
  }

  function findGridPhotoImageAtPoint(doc, x, y) {
    if (!doc || typeof doc.elementsFromPoint !== 'function') return null;
    if (typeof x !== 'number' || typeof y !== 'number' || x < 0 || y < 0) return null;
    const stack = doc.elementsFromPoint(x, y) || [];
    const checked = new Set();
    for (let i = 0; i < stack.length; i += 1) {
      const element = stack[i];
      if (!element || element === doc.body || element === doc.documentElement) continue;
      const tile = typeof element.closest === 'function' ? element.closest(GRID_TILE) : element;
      const target = tile || (element.tagName === 'IMG' ? element : null);
      if (!target || checked.has(target)) continue;
      checked.add(target);
      const found = findPhotoImageInNode(target, x, y);
      if (found) return found;
    }
    return null;
  }

  // Size heuristics are for older or renamed viewer markup.
  const VIEWER_MIN_NATURAL_PX = 800;
  const VIEWER_MIN_RENDERED_PX = 500;

  function getCenteredViewer(doc) {
    return doc && typeof doc.querySelector === 'function' ? doc.querySelector(CENTERED_VIEWER) : null;
  }

  // Pick the viewer-sized image closest to the viewport centre, so a preloaded
  // carousel neighbour never wins over the photo actually on screen.
  function resolveOneUpImage(doc, viewer = getCenteredViewer(doc)) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return null;
    const imgs = viewer ? viewer.querySelectorAll('img') : doc.querySelectorAll('img');
    const root = doc.documentElement || doc.body;
    const vw = root ? root.clientWidth || 0 : 0;
    const vh = root ? root.clientHeight || 0 : 0;
    const cx = vw / 2;
    const cy = vh / 2;
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < imgs.length; i += 1) {
      const img = imgs[i];
      if (!img.naturalWidth || !img.naturalHeight || img.complete === false ||
          typeof img.getBoundingClientRect !== 'function') continue;
      if (!viewer && (Math.max(img.naturalWidth, img.naturalHeight) < VIEWER_MIN_NATURAL_PX ||
          (typeof img.closest === 'function' && img.closest(GRID_TILE)))) continue;
      const rect = img.getBoundingClientRect();
      if (!rect.width || !rect.height || (!viewer && Math.max(rect.width, rect.height) < VIEWER_MIN_RENDERED_PX)) continue;
      // The carousel keeps neighbours mounted and a closed viewer can leave them
      // laid out just outside the viewport, so off-screen candidates never count.
      if (rect.left + rect.width <= 0 || rect.top + rect.height <= 0 || rect.left >= vw || rect.top >= vh) continue;
      if (viewer && doc.defaultView && doc.defaultView.getComputedStyle) {
        const style = doc.defaultView.getComputedStyle(img);
        if (style.visibility === 'hidden' || style.opacity === '0') continue;
      }
      const score = viewer ? -(img.naturalWidth * img.naturalHeight) :
        Math.abs(rect.left + rect.width / 2 - cx) + Math.abs(rect.top + rect.height / 2 - cy);
      if (score < bestScore) {
        best = img;
        bestScore = score;
      }
    }
    return best;
  }

  async function copyCurrentOneUpImage(doc, win) {
    const image = resolveOneUpImage(doc);
    if (!image) {
      showCopyPhotoStatus(doc, '未找到大图，请等图片加载完成后再试', true);
      return;
    }
    return copyPhotoWithStatus(doc, win, image, true);
  }

  async function copyPhotoWithStatus(doc, win, image, isViewer) {
    if (clipboardWritesByDocument.has(doc)) return;
    clipboardWritesByDocument.add(doc);
    const complete = isViewer ? '已拷贝大图 ' + image.naturalWidth + '×' + image.naturalHeight : '图像已拷贝到剪贴板';
    try {
      showCopyPhotoStatus(doc, '正在拷贝图像…');
      const copied = await copyPhotoImageToClipboard(image, win);
      showCopyPhotoStatus(
        doc,
        copied ? complete : '浏览器不支持图像拷贝',
        !copied
      );
    } catch (error) {
      const detail = error && error.message ? error.message : '未知错误';
      showCopyPhotoStatus(doc, '拷贝图像失败：' + detail, true);
    } finally {
      clipboardWritesByDocument.delete(doc);
    }
  }

  // Draggable like the upload FAB, with its own stored position: the button
  // floats over the viewer, and what is a comfortable corner differs per user
  // and per photo aspect.
  function restoreOneUpButtonPosition(button, win) {
    const rect =
      typeof button.getBoundingClientRect === 'function'
        ? button.getBoundingClientRect()
        : { width: ONEUP_BUTTON_SIZE, height: ONEUP_BUTTON_SIZE };
    const width = rect.width || ONEUP_BUTTON_SIZE;
    const height = rect.height || ONEUP_BUTTON_SIZE;
    const saved = loadSavedPosition(win, ONEUP_COPY_POSITION_KEY);
    const fallbackLeft = 20;
    const fallbackTop = Math.max(8, (win.innerHeight || 0) - height - 20);
    const position = calculateDraggedPanelPosition({
      pointerX: (saved ? saved.left : fallbackLeft) + width / 2,
      pointerY: (saved ? saved.top : fallbackTop) + height / 2,
      offsetX: width / 2,
      offsetY: height / 2,
      panelWidth: width,
      panelHeight: height,
      viewportWidth: win.innerWidth || 0,
      viewportHeight: win.innerHeight || 0,
      margin: 8,
    });
    applyPanelPosition(button, position);
    return position;
  }

  function enableOneUpButtonDragging(button, win) {
    restoreOneUpButtonPosition(button, win);
    function resize() {
      restoreOneUpButtonPosition(button, win);
    }
    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('resize', resize);
    }

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
      if (!moved && dx * dx + dy * dy < 16) return;
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
      applyPanelPosition(button, position);
      dragState.lastPosition = position;
    }

    function stop() {
      if (!dragState) return;
      const wasMoved = moved;
      if (wasMoved && dragState.lastPosition) {
        savePosition(win, dragState.lastPosition, ONEUP_COPY_POSITION_KEY);
      }
      dragState = null;
      moved = false;
      if (wasMoved) {
        // The click that follows a drag must not double as "copy".
        button.__icloudDraggedAt = Date.now();
      }
      cleanup();
    }

    function start(event) {
      if (event.button !== undefined && event.button !== 0) return;
      const point = getPointerPoint(event);
      const rect = button.getBoundingClientRect();
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
      moved = false;
      win.addEventListener('mousemove', move, true);
      win.addEventListener('mouseup', stop, true);
      win.addEventListener('touchmove', move, true);
      win.addEventListener('touchend', stop, true);
      win.addEventListener('touchcancel', stop, true);
    }

    button.addEventListener('mousedown', start);
    button.addEventListener('touchstart', start, { passive: false });
    return function disposeDragging() {
      dragState = null;
      moved = false;
      cleanup();
      win.removeEventListener('resize', resize);
      button.removeEventListener('mousedown', start);
      button.removeEventListener('touchstart', start);
    };
  }

  function createOneUpCopyButton(doc, win) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute('data-icloud-oneup-copy', '');
    button.setAttribute('aria-label', '拷贝大图');
    button.title = '点击复制大图；按住可拖动，位置会记住（Ctrl+C 也可以）';
    button.innerHTML = [
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"',
      ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
      '<rect x="3" y="3" width="12.4" height="12.4" rx="2.2"></rect>',
      '<path d="M9.6 20.4h9a2.4 2.4 0 0 0 2.4-2.4v-9"></path>',
      '<circle cx="7.6" cy="7.6" r="1.3" fill="currentColor" stroke="none"></circle>',
      '<path d="M3.5 12.9 6.9 9.7l3.2 3"></path>',
      '</svg>',
    ].join('');
    button.style.cssText = [
      'position:fixed',
      // left/top are applied by restoreOneUpButtonPosition so the saved spot wins.
      'z-index:2147483000',
      'width:40px',
      'height:40px',
      'padding:0',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'border:0',
      'border-radius:50%',
      // Light circle on purpose: the viewer is a dark full-screen surface, so a
      // dark button there reads as disabled and gets missed.
      'background:rgba(255,255,255,.95)',
      'color:#1d1d1f',
      'cursor:grab',
      'pointer-events:auto',
      'user-select:none',
      'touch-action:none',
      'box-shadow:0 6px 20px rgba(0,0,0,.45)',
    ].join(';');
    button.addEventListener(
      'click',
      function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (button.__icloudDraggedAt && Date.now() - button.__icloudDraggedAt < 400) return;
        void copyCurrentOneUpImage(doc, win);
      },
      true
    );
    return button;
  }

  // iCloud only opens the enlarged view from a trusted click, so the grid menu
  // cannot jump into it programmatically. Instead, surface a copy button while
  // OneUp is open — the user opens the photo (one click) and copies from there.
  function installOneUpCopyButton(doc, win) {
    if (!doc || oneUpCopyStateByDocument.has(doc)) return;
    const state = { button: null, disposeDragging: null, scheduled: false, hintShown: false };
    oneUpCopyStateByDocument.set(doc, state);

    function removeButton() {
      if (state.disposeDragging) state.disposeDragging();
      state.disposeDragging = null;
      if (state.button) {
        if (typeof state.button.remove === 'function') state.button.remove();
        else if (state.button.parentNode && typeof state.button.parentNode.removeChild === 'function') {
          state.button.parentNode.removeChild(state.button);
        }
      }
      state.button = null;
    }

    function sync() {
      state.scheduled = false;
      if (doc.hidden || typeof doc.querySelectorAll !== 'function') return;
      if (state.button && (state.button.isConnected === false || state.button.parentNode !== doc.body)) {
        removeButton();
      }
      const hasViewerPhoto = Boolean(resolveOneUpImage(doc));
      if (hasViewerPhoto && !state.button && doc.body && typeof doc.body.appendChild === 'function') {
        state.button = createOneUpCopyButton(doc, win);
        doc.body.appendChild(state.button);
        state.disposeDragging = enableOneUpButtonDragging(state.button, win);
        if (!state.hintShown) {
          state.hintShown = true;
          showCopyPhotoStatus(doc, '提示：点左下角的拷贝图标可复制高清大图（可拖动，位置会记住）');
        }
      } else if (!hasViewerPhoto && state.button) {
        removeButton();
      }
    }

    function scheduleSync() {
      if (doc.hidden || state.scheduled) return;
      state.scheduled = true;
      // A subtree update can happen while Chromium is throttling animation
      // frames in an iframe. Coalesce each mutation delivery without waiting
      // for paint to remove or create the button.
      Promise.resolve().then(sync);
    }

    const Observer = (win && win.MutationObserver) || root.MutationObserver;
    if (typeof Observer === 'function' && (doc.documentElement || doc.body)) {
      const observer = new Observer(function () {
        if (state.button || getCenteredViewer(doc)) scheduleSync();
      });
      observer.observe(doc.documentElement || doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    doc.addEventListener('load', function (event) {
      const image = event.target;
      if (image && image.tagName === 'IMG' && image.closest &&
          (image.closest(CENTERED_VIEWER) ||
            (!image.closest(GRID_TILE) && Math.max(image.naturalWidth, image.naturalHeight) >= VIEWER_MIN_NATURAL_PX))) {
        scheduleSync();
      }
    }, true);
    if (win && win.addEventListener) win.addEventListener('resize', scheduleSync);
    doc.addEventListener('visibilitychange', scheduleSync);
    sync();
  }

  function installGridPhotoKeyboardCopy(doc, win) {
    if (!doc || keyboardPhotoCopyStateByDocument.has(doc)) return;
    const state = { x: -1, y: -1 };
    let hintShown = false;
    keyboardPhotoCopyStateByDocument.set(doc, state);

    function findPhotoUnderPointer() {
      if (state.x < 0 || state.y < 0) return null;
      return findGridPhotoImageAtPoint(doc, state.x, state.y);
    }

    function isCopyShortcut(event) {
      if (String(event.key || '').toLowerCase() !== 'c') return false;
      const primary = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
      const alt = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
      return Boolean(primary || alt);
    }

    function hasTextSelection() {
      const selection = win && typeof win.getSelection === 'function' ? win.getSelection() : null;
      return Boolean(selection && selection.isCollapsed === false && String(selection).length > 0);
    }

    doc.addEventListener('mousemove', function (event) {
      state.x = typeof event.clientX === 'number' ? event.clientX : -1;
      state.y = typeof event.clientY === 'number' ? event.clientY : -1;
    }, true);

    function showHoverHint(event) {
      if (hintShown) return;
      const image = findGridPhotoImageAtPoint(doc, event.clientX, event.clientY);
      if (!image) return;
      hintShown = true;
      if (doc.removeEventListener) doc.removeEventListener('mouseover', showHoverHint, true);
      showCopyPhotoStatus(doc, '提示：鼠标悬停在照片上按 Ctrl+C 可拷贝图像');
    }
    doc.addEventListener('mouseover', showHoverHint, true);
    doc.addEventListener('mouseout', function (event) {
      if (event.relatedTarget === null) {
        state.x = -1;
        state.y = -1;
      }
    }, true);

    doc.addEventListener('keydown', function (event) {
      if (event.defaultPrevented || event.repeat) return;
      if (!isCopyShortcut(event)) return;
      if (isEditablePhotoCopyTarget(event.target)) return;
      if (hasTextSelection()) return;
      const viewer = getCenteredViewer(doc);
      const viewerImage = resolveOneUpImage(doc, viewer);
      const image = viewerImage || (!viewer && findPhotoUnderPointer());
      if (!image) return;
      // The real keystroke carries the user activation that the clipboard
      // write below depends on, so claim the event before the page sees it.
      event.preventDefault();
      event.stopPropagation();
      void copyPhotoWithStatus(doc, win, image, Boolean(viewerImage));
    }, true);
  }

  function calculatePanLimits(baseWidth, baseHeight, scale) {
    return {
      x: Math.max(0, ((scale - 1) * baseWidth) / 2),
      y: Math.max(0, ((scale - 1) * baseHeight) / 2),
    };
  }

  function calculateZoomTranslation(options) {
    return {
      tx: options.tx + options.pointerOffsetX * (1 - options.scaleRatio),
      ty: options.ty + options.pointerOffsetY * (1 - options.scaleRatio),
    };
  }

  function resolveZoomMedia(element, zoomTarget, eventTarget, findAtPoint) {
    const overAttachedTarget = Boolean(
      element &&
      zoomTarget &&
      eventTarget &&
      typeof zoomTarget.contains === 'function' &&
      zoomTarget.contains(eventTarget)
    );
    if (overAttachedTarget) return element;
    return typeof findAtPoint === 'function' ? findAtPoint() : null;
  }

  function getMediaSourceSignature(element) {
    if (!element) return '';
    if (typeof element.getAttribute === 'function') {
      const src = element.getAttribute('src') || '';
      const srcset = element.getAttribute('srcset') || '';
      if (src || srcset) return src + '\n' + srcset;
    }
    return String(element.currentSrc || element.src || '');
  }

  function hasMediaSourceChanged(element, originalSource) {
    return getMediaSourceSignature(element) !== String(originalSource || '');
  }

  function restoreOwnedInlineStyle(style, property, appliedValue, savedValue) {
    if (!style || appliedValue === null || style[property] !== appliedValue) return false;
    style[property] = savedValue;
    return true;
  }

  function findNativeOneUpZoomController(doc) {
    if (!doc || typeof doc.querySelector !== 'function') return null;
    try {
      const element = doc.querySelector('.ToolbarOneUpZoomSlider');
      if (!element || element.isConnected === false) return null;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const key = Object.getOwnPropertyNames(element).find(function (name) {
        return /^__reactFiber\$|^__reactInternalInstance\$/.test(name);
      });
      let fiber = key && element[key];
      if (!fiber) return null;
      let tree = fiber;
      for (let i = 0; tree.return && i < 100; i += 1) tree = tree.return;
      // Bailouts can share host fibers whose return pointers still reference an
      // old parent branch. Follow the committed root's child/sibling links rather
      // than choosing an alternate from those stale return pointers.
      let lineage = null;
      const committed = tree.stateNode && tree.stateNode.current;
      if (committed && committed.child) {
        const stack = [committed];
        const parents = new Map([[committed, null]]);
        for (let visited = 0; stack.length && visited < 10000; visited += 1) {
          const node = stack.pop();
          if (node.stateNode === element) {
            lineage = [];
            for (let ancestor = node; ancestor; ancestor = parents.get(ancestor)) lineage.push(ancestor);
            break;
          }
          const dom = node.stateNode;
          if (dom && dom.nodeType === 1 && typeof dom.contains === 'function' && !dom.contains(element)) continue;
          for (let child = node.child; child; child = child.sibling) {
            if (parents.has(child)) break;
            parents.set(child, node);
            stack.push(child);
          }
        }
        if (!lineage) return null;
      } else {
        if (committed && committed !== tree) fiber = fiber.alternate;
        lineage = [];
        for (let i = 0; fiber && i < 100; i += 1, fiber = fiber.return) lineage.push(fiber);
      }
      let slider = null;
      let photoIndex = null;
      let transformationScale = null;
      let nativeContext = null;
      for (let i = 0; i < lineage.length; i += 1) {
        const props = lineage[i].memoizedProps || {};
        if (!slider && String(props.className || '').indexOf('ToolbarOneUpZoomSlider') !== -1 &&
            typeof props.onChange === 'function' && Number.isFinite(props.value) &&
            Number.isFinite(props.min) && Number.isFinite(props.max) && props.min >= 1 &&
            props.max > props.min && props.value >= props.min && props.value <= props.max && !props.disabled) {
          slider = props;
        }
        const context = props.value;
        if (context && typeof context === 'object' &&
            typeof context.setTransformationState === 'function' &&
            Number.isInteger(context.currentIndex)) {
          photoIndex = context.currentIndex;
          nativeContext = context;
          const matrix = context.transformationState && context.transformationState.matrix;
          if (matrix && Number.isFinite(matrix.a) && Number.isFinite(matrix.b)) {
            transformationScale = Math.hypot(matrix.a, matrix.b);
          }
        }
      }
      if (!slider || photoIndex === null) return null;
      const target = doc.querySelector('.OneUpCarouselItem.is-center .OneUpCarouselItem-itemWrapper');
      if (!target || !target.style || target.isConnected === false) return null;
      return {
        element,
        target,
        context: nativeContext,
        photoIndex,
        min: slider.min,
        max: slider.max,
        value: slider.value,
        renderedValue: transformationScale,
        apply: slider.onChange,
      };
    } catch (error) {
      // An Apple UI change must not break upload/copy or guess a private API.
      return null;
    }
  }

  const zoomPanInstallations = new WeakMap();

  function installImageZoomPan(doc, win) {
    if (zoomPanInstallations.has(doc)) return zoomPanInstallations.get(doc);
    let disposed = false;
    let sessionActive = false;
    let nativeObserver = null;
    let nativeObserverFrame = null;
    let nativeStyleRelease = null;
    let fallbackStyleRelease = null;
    let nativeDrag = null;
    let capturedPointer = null;
    let discoveryObserver = null;
    let sessionController = null;
    const eventRoot = win || doc;

    const MIN_PREVIEW_PX = 300;
    const MIN_SCALE = 1;
    const MAX_SCALE = 8;

    const state = {
      element: null,
      zoomTarget: null,
      scale: 1,
      tx: 0,
      ty: 0,
      dragging: false,
      startX: 0,
      startY: 0,
      origTx: 0,
      origTy: 0,
      baseWidth: 0,
      baseHeight: 0,
      savedInlineTransform: '',
      baseTransform: '',
      savedCursor: '',
      savedWillChange: '',
      appliedInlineTransform: null,
      appliedCursor: null,
      appliedWillChange: null,
      watchdogObserver: null,
      watchdogFrame: null,
      mediaSource: '',
      mediaObserver: null,
      mediaLoadHandler: null,
      renderedScale: 1,
      renderedTx: 0,
      renderedTy: 0,
      animationFrame: null,
      animationTime: null,
    };

    let zoomHintShown = false;

    // The native slider updates OneUp's transformationState, which is also the
    // progressive image loader's resolution input. CSS-only zoom bypasses it.
    let nativeZoom = null;

    // Own only the transform transition. The final explicit transform entry
    // overrides native `all`/transform easing; opacity (including child fades)
    // keeps its original timing. The rule survives native inline resets.
    function ownTransformTransition(target) {
      if (!target || !target.style) return function () {};
      const style = target.style;
      const saved = style.transition || '';
      const priority = style.getPropertyPriority ? style.getPropertyPriority('transition') : '';
      let computed = saved;
      try { computed = win.getComputedStyle(target).transition || saved; } catch (error) { /* inline fallback */ }
      const value = (computed && computed !== 'none' ? computed + ', ' : '') + 'transform 0s linear';
      const attr = 'data-iu-camera', variable = '--iu-camera-transition';
      const marked = typeof target.setAttribute === 'function' && typeof style.setProperty === 'function';
      const savedAttr = marked ? target.getAttribute(attr) : null;
      const savedVariable = marked ? style.getPropertyValue(variable) : '';
      const variablePriority = marked ? style.getPropertyPriority(variable) : '';
      if (marked) {
        target.setAttribute(attr, 'active');
        style.setProperty(variable, value);
      }
      if (style.setProperty) style.setProperty('transition', value, 'important');
      else style.transition = value;
      const appliedTransition = style.transition;
      return function () {
        if (style.transition === appliedTransition && (!style.getPropertyPriority || style.getPropertyPriority('transition') === 'important')) {
          if (style.setProperty) style.setProperty('transition', saved, priority);
          else style.transition = saved;
        }
        if (marked) {
          if (target.getAttribute(attr) === 'active') {
            if (savedAttr === null) target.removeAttribute(attr); else target.setAttribute(attr, savedAttr);
          }
          if (style.getPropertyValue(variable) === value && style.getPropertyPriority(variable) === '') {
            if (savedVariable) style.setProperty(variable, savedVariable, variablePriority);
            else style.removeProperty(variable);
          }
        }
      };
    }

    function startSession() {
      if (sessionActive || disposed) return;
      sessionActive = true;
      if (discoveryObserver) discoveryObserver.disconnect();
      sessionController = findNativeOneUpZoomController(doc);
      if (sessionController) observeNativeSession();
      eventRoot.addEventListener('pointerdown', onMouseDown, true);
      eventRoot.addEventListener('keydown', onKeyDown, true);
      eventRoot.addEventListener('resize', resetZoomOnResize);
      eventRoot.addEventListener('blur', resetZoomOnResize);
      eventRoot.addEventListener('pointercancel', resetZoomOnResize, true);
      eventRoot.addEventListener('pagehide', resetZoomOnResize);
    }

    function stopSession() {
      if (!sessionActive) return;
      endDrag();
      sessionActive = false;
      eventRoot.removeEventListener('pointerdown', onMouseDown, true);
      eventRoot.removeEventListener('keydown', onKeyDown, true);
      eventRoot.removeEventListener('resize', resetZoomOnResize);
      eventRoot.removeEventListener('blur', resetZoomOnResize);
      eventRoot.removeEventListener('pointercancel', resetZoomOnResize, true);
      eventRoot.removeEventListener('pagehide', resetZoomOnResize);
      sessionController = null;
      if (!disposed && discoveryObserver) discoveryObserver.observe(doc.documentElement || doc.body, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['class'],
      });
    }

    function observeNativeSession() {
      if (nativeObserver) return;
      const Observer = win.MutationObserver || root.MutationObserver;
      if (typeof Observer !== 'function' || !(doc.body || doc.documentElement)) return;
      function checkController() {
        nativeObserverFrame = null;
        const controller = findNativeOneUpZoomController(doc);
        if (nativeZoom ? !matchesNativeZoom(controller) : !controller ||
            !sessionController || controller.element !== sessionController.element ||
            controller.target !== sessionController.target || controller.photoIndex !== sessionController.photoIndex) {
          cancelNativeZoom();
        }
      }
      nativeObserver = new Observer(function () {
        if (nativeObserverFrame !== null) return;
        if (typeof win.requestAnimationFrame === 'function') nativeObserverFrame = win.requestAnimationFrame(checkController);
        else checkController();
      });
      nativeObserver.observe(doc.documentElement || doc.body, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['class'],
      });
    }

    function cancelNativeZoom() {
      if (nativeZoom && nativeZoom.frame !== null && win && typeof win.cancelAnimationFrame === 'function') {
        win.cancelAnimationFrame(nativeZoom.frame);
      }
      if (nativeObserver) nativeObserver.disconnect();
      nativeObserver = null;
      if (nativeObserverFrame !== null && typeof win.cancelAnimationFrame === 'function') {
        win.cancelAnimationFrame(nativeObserverFrame);
      }
      nativeObserverFrame = null;
      if (nativeStyleRelease) nativeStyleRelease();
      nativeStyleRelease = null;
      nativeZoom = null;
      if (!state.element) stopSession();
    }

    function matchesNativeZoom(controller) {
      return Boolean(nativeZoom && controller && nativeZoom.element === controller.element &&
        nativeZoom.targetElement === controller.target &&
        nativeZoom.photoIndex === controller.photoIndex &&
        Math.abs(readNativeScale(controller) - nativeZoom.painted) < 0.01);
    }

    function readNativeMatrix(controller) {
      if (!controller.target || controller.target.isConnected === false || typeof win.DOMMatrix !== 'function') return null;
      try {
        const matrix = new win.DOMMatrix(controller.target.style.transform || readCurrentTransform(controller.target));
        return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite) ? matrix : null;
      } catch (error) { return null; }
    }

    function readNativeScale(controller) {
      const matrix = readNativeMatrix(controller);
      return matrix ? Math.hypot(matrix.a, matrix.b) :
        Number.isFinite(controller.renderedValue) ? controller.renderedValue : controller.value;
    }

    function writeNativeMatrix(controller, matrix) {
      controller.target.style.transform = matrix.toString();
      controller.context.setTransformationState(function (old) {
        return old ? Object.assign({}, old, { matrix: {
          a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, tx: matrix.e, ty: matrix.f,
        } }) : old;
      });
    }

    function getNativeCameraImage(controller, camera) {
      const images = controller.target && controller.target.querySelectorAll
        ? Array.from(controller.target.querySelectorAll('img')) : [];
      let best = null;
      images.forEach(function (image) {
        const computed = win.getComputedStyle ? win.getComputedStyle(image) : image.style;
        if (image.isConnected === false || (computed && (computed.display === 'none' || computed.visibility === 'hidden')) ||
            (image.style && image.style.display === 'none')) return;
        const rect = image.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (!best || image.naturalWidth > best.naturalWidth)) best = image;
      });
      return best || (camera.image && camera.image.isConnected !== false ? camera.image : null);
    }

    function getNativeZoomScale(controller) {
      return matchesNativeZoom(controller) ? nativeZoom.target : readNativeScale(controller);
    }

    function applyNativeZoom(controller, value) {
      try {
        controller.apply(value);
        const camera = nativeZoom;
        const matrix = readNativeMatrix(controller);
        if (matrix && value === controller.min) {
          matrix.e = 0; matrix.f = 0;
          writeNativeMatrix(controller, matrix);
        } else if (camera && matrix && camera.anchor && camera.image) {
          const image = getNativeCameraImage(controller, camera);
          if (!image) { cancelNativeZoom(); return false; }
          const rect = image.getBoundingClientRect();
          matrix.e += camera.anchor.x - rect.left - camera.anchor.u * rect.width;
          matrix.f += camera.anchor.y - rect.top - camera.anchor.v * rect.height;
          writeNativeMatrix(controller, matrix);
        }
        return true;
      } catch (error) {
        cancelNativeZoom();
        showCopyPhotoStatus(doc, '原生缩放暂时不可用，请使用左上角调整大小控件。', true);
        console.warn(LOG_PREFIX, 'Native OneUp zoom failed:', error);
        return false;
      }
    }

    function animateNativeZoom(time) {
      const camera = nativeZoom;
      if (!camera) return;
      camera.frame = null;
      const controller = findNativeOneUpZoomController(doc);
      if (!matchesNativeZoom(controller)) { cancelNativeZoom(); return; }
      // Use elapsed time: background tabs can deliver RAF only once per second.
      const dt = camera.time === null ? 16 : Math.max(1, time - camera.time);
      camera.time = time;
      const target = clamp(camera.target, controller.min, controller.max);
      const next = camera.painted + (target - camera.painted) * (1 - Math.exp(-dt / 55));
      const settled = Math.abs(target - next) < 0.001;
      const value = settled ? target : next;
      if (!applyNativeZoom(controller, value)) return;
      camera.painted = value;
      camera.hasPainted = true;
      if (!settled) camera.frame = win.requestAnimationFrame(animateNativeZoom);
      else {
        camera.time = null;
        if (!capturedPointer) eventRoot.removeEventListener('pointermove', onMouseMove, true);
        if (value === controller.min) cancelNativeZoom();
      }
    }

    function prepareNativeCamera(controller) {
      if (state.element) detach();
      if (!matchesNativeZoom(controller)) {
        cancelNativeZoom();
        nativeZoom = { element: controller.element, photoIndex: controller.photoIndex,
          targetElement: controller.target, target: readNativeScale(controller), painted: readNativeScale(controller),
          frame: null, time: null, hasPainted: false, image: null, anchor: null };
        nativeStyleRelease = ownTransformTransition(controller.target);
      }
      startSession();
      observeNativeSession();
    }

    function requestNativeZoom(controller, scale, immediate, image, event) {
      prepareNativeCamera(controller);
      nativeZoom.target = clamp(scale, controller.min, controller.max);
      if (image && event) {
        const rect = image.getBoundingClientRect();
        nativeZoom.image = image;
        nativeZoom.anchor = rect.width && rect.height ? { x: event.clientX, y: event.clientY,
          u: (event.clientX - rect.left) / rect.width, v: (event.clientY - rect.top) / rect.height } : null;
      }
      const reduced = win && typeof win.matchMedia === 'function' &&
        win.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (immediate || reduced || !win || typeof win.requestAnimationFrame !== 'function') {
        const value = nativeZoom.target;
        if (nativeZoom.frame !== null && win.cancelAnimationFrame) win.cancelAnimationFrame(nativeZoom.frame);
        nativeZoom.frame = null; nativeZoom.time = null;
        applyNativeZoom(controller, value);
        if (nativeZoom) nativeZoom.painted = value;
        if (value === controller.min) cancelNativeZoom();
      } else if (nativeZoom.frame === null) {
        if (nativeZoom.time === null && win.performance && typeof win.performance.now === 'function') nativeZoom.time = win.performance.now();
        eventRoot.addEventListener('pointermove', onMouseMove, true);
        nativeZoom.frame = win.requestAnimationFrame(animateNativeZoom);
      }
    }

    function resetZoomOnResize() {
      cancelNativeZoom();
      detach();
    }



    function showZoomHint() {
      if (zoomHintShown) return;
      zoomHintShown = true;
      const panel = doc.getElementById ? doc.getElementById(PANEL_ID) : null;
      if (panel && typeof panel._showUploaderStatus === 'function') {
        panel._showUploaderStatus('双击放大／还原 · 滚轮平滑缩放 · 拖动平移 · Esc 复位');
      }
    }

    function getLargeMediaRect(el) {
      if (!el || !el.tagName) return null;
      if (typeof el.closest === 'function' && el.closest('.grid-item, [role="grid"]')) return null;
      const tag = el.tagName;
      if (tag !== 'IMG' && tag !== 'CANVAS' && tag !== 'VIDEO') return null;
      if (typeof el.getBoundingClientRect !== 'function') return null;
      const rect = el.getBoundingClientRect();
      return Math.max(rect.width, rect.height) >= MIN_PREVIEW_PX &&
        Math.min(rect.width, rect.height) >= 64 ? rect : null;
    }

    function isLargeMedia(el) {
      return Boolean(getLargeMediaRect(el));
    }

    function findLargestMediaAtPoint(x, y) {
      if (typeof doc.elementsFromPoint !== 'function') return null;
      const stack = doc.elementsFromPoint(x, y) || [];
      let best = null;
      let bestArea = 0;
      for (let i = 0; i < stack.length; i += 1) {
        const el = stack[i];
        const rect = getLargeMediaRect(el);
        if (!rect) continue;
        const area = rect.width * rect.height;
        if (area > bestArea) {
          best = el;
          bestArea = area;
        }
      }
      const viewer = best ? null : getCenteredViewer(doc);
      if (!viewer) return best;
      const photo = findPhotoImageInNode(viewer, x, y);
      return isLargeMedia(photo) ? photo : null;
    }

    // The wheel handler runs on every scroll tick, so cache the "largest media in
    // the viewport" answer briefly instead of measuring every image on the page
    // each time.
    let mediaCache = { at: 0, el: null };
    const MEDIA_CACHE_MS = 250;

    function findLargestMediaInViewport() {
      const now = Date.now();
      if (mediaCache.el && mediaCache.el.isConnected && now - mediaCache.at < MEDIA_CACHE_MS) {
        return mediaCache.el;
      }
      const candidates = doc.querySelectorAll
        ? doc.querySelectorAll('img, canvas, video')
        : [];
      let best = null;
      let bestArea = 0;
      const vw = (win && win.innerWidth) || doc.documentElement.clientWidth;
      const vh = (win && win.innerHeight) || doc.documentElement.clientHeight;
      for (let i = 0; i < candidates.length; i += 1) {
        const el = candidates[i];
        const rect = getLargeMediaRect(el);
        if (!rect) continue;
        // Reject elements outside the viewport.
        if (rect.right < 0 || rect.bottom < 0 || rect.left > vw || rect.top > vh) continue;
        const area = rect.width * rect.height;
        if (area > bestArea) {
          best = el;
          bestArea = area;
        }
      }
      mediaCache = { at: now, el: best };
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
      return null;
    }

    // ── Overlay approach ──────────────────────────────────────────────────────
    function findZoomTarget(el) {
      // iCloud's native zoom applies transform on OneUpCarouselItem-itemWrapper.
      // We do the same so overflow:hidden doesn't clip the zoomed content.
      let node = el.parentElement;
      let safety = 0;
      while (node && node !== doc.body && safety < 10) {
        if ((node.className || '').indexOf('OneUpCarouselItem-itemWrapper') !== -1) return node;
        node = node.parentElement;
        safety += 1;
      }
      return el; // fallback to the image itself
    }

    function readCurrentTransform(el) {
      try {
        const getStyle = (win && win.getComputedStyle) || (root.getComputedStyle || null);
        if (typeof getStyle === 'function') {
          const computed = getStyle(el);
          const value = computed && computed.transform;
          if (value && value !== 'none') return value;
        }
      } catch (error) {
        // Fall back to the exact inline value below.
      }
      return el.style && el.style.transform ? el.style.transform : '';
    }

    function resetView() {
      state.scale = 1;
      state.tx = 0;
      state.ty = 0;
      state.dragging = false;
      state.renderedScale = 1;
      state.renderedTx = 0;
      state.renderedTy = 0;
    }

    function setOwnedInlineStyle(property, value, appliedField) {
      if (!state.zoomTarget) return;
      state.zoomTarget.style[property] = value;
      state[appliedField] = state.zoomTarget.style[property];
    }

    function attach(el) {
      if (state.element === el && state.zoomTarget && state.zoomTarget.isConnected) return;
      if (state.element || state.zoomTarget) detach();
      state.element = el;
      state.mediaSource = getMediaSourceSignature(el);
      resetView();

      state.zoomTarget = findZoomTarget(el);
      startSession();
      const rect = state.zoomTarget.getBoundingClientRect();
      state.baseWidth = rect.width;
      state.baseHeight = rect.height;
      state.savedInlineTransform = state.zoomTarget.style.transform || '';
      state.baseTransform = readCurrentTransform(state.zoomTarget);
      state.savedCursor = state.zoomTarget.style.cursor || '';
      state.savedWillChange = state.zoomTarget.style.willChange || '';

      fallbackStyleRelease = ownTransformTransition(state.zoomTarget);
      setOwnedInlineStyle('willChange', 'transform', 'appliedWillChange');
      startWatchdog();
    }

    function detach() {
      cancelZoomAnimation();
      stopWatchdog();
      if (fallbackStyleRelease) fallbackStyleRelease();
      fallbackStyleRelease = null;
      if (state.zoomTarget) {
        // Restore only values the script still owns. React may reuse this wrapper
        // for the next photo and write its own inline state before observers run.
        const style = state.zoomTarget.style;
        restoreOwnedInlineStyle(
          style, 'transform', state.appliedInlineTransform, state.savedInlineTransform
        );
        restoreOwnedInlineStyle(style, 'cursor', state.appliedCursor, state.savedCursor);
        restoreOwnedInlineStyle(
          style, 'willChange', state.appliedWillChange, state.savedWillChange
        );
      }
      state.zoomTarget = null;
      state.element = null;
      state.baseWidth = 0;
      state.baseHeight = 0;
      state.baseTransform = '';
      state.mediaSource = '';
      state.appliedInlineTransform = null;
      state.appliedCursor = null;
      state.appliedWillChange = null;
      resetView();
      if (!nativeZoom) stopSession();
    }

    function expectedTransform() {
      const relative =
        'translate(' + state.renderedTx + 'px, ' + state.renderedTy + 'px) scale(' + state.renderedScale + ')';
      return state.baseTransform ? relative + ' ' + state.baseTransform : relative;
    }

    function clampTranslation() {
      const limit = calculatePanLimits(state.baseWidth, state.baseHeight, state.scale);
      state.tx = Math.max(-limit.x, Math.min(limit.x, state.tx));
      state.ty = Math.max(-limit.y, Math.min(limit.y, state.ty));
    }

    function cancelZoomAnimation() {
      if (state.animationFrame !== null && win && typeof win.cancelAnimationFrame === 'function') {
        win.cancelAnimationFrame(state.animationFrame);
      }
      state.animationFrame = null;
      state.animationTime = null;
      if (!capturedPointer) eventRoot.removeEventListener('pointermove', onMouseMove, true);
    }

    function paintZoom() {
      setOwnedInlineStyle('transform', expectedTransform(), 'appliedInlineTransform');
      setOwnedInlineStyle('cursor', state.scale > 1
        ? (state.dragging ? 'grabbing' : 'grab') : state.savedCursor, 'appliedCursor');
    }

    function animateZoom(time) {
      state.animationFrame = null;
      if (!state.element || !state.zoomTarget) return;
      if (!state.element.isConnected || !state.zoomTarget.isConnected) {
        checkZoomMount();
        return;
      }
      if (hasMediaSourceChanged(state.element, state.mediaSource)) { detach(); return; }
      const dt = state.animationTime === null ? 16 : Math.max(1, time - state.animationTime);
      state.animationTime = time;
      const alpha = 1 - Math.exp(-dt / 55);
      state.renderedScale += (state.scale - state.renderedScale) * alpha;
      state.renderedTx += (state.tx - state.renderedTx) * alpha;
      state.renderedTy += (state.ty - state.renderedTy) * alpha;
      const settled = Math.abs(state.scale - state.renderedScale) < 0.001 &&
        Math.abs(state.tx - state.renderedTx) < 0.1 && Math.abs(state.ty - state.renderedTy) < 0.1;
      if (settled) {
        state.renderedScale = state.scale;
        state.renderedTx = state.tx;
        state.renderedTy = state.ty;
        state.animationTime = null;
        if (state.scale <= MIN_SCALE + 0.001) { detach(); return; }
      }
      paintZoom();
      if (!settled) state.animationFrame = win.requestAnimationFrame(animateZoom);
      else if (!capturedPointer) eventRoot.removeEventListener('pointermove', onMouseMove, true);
    }

    function applyTransform() {
      if (!state.zoomTarget) return;
      const reduced = win && typeof win.matchMedia === 'function' &&
        win.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (state.dragging || reduced || !win || typeof win.requestAnimationFrame !== 'function') {
        cancelZoomAnimation();
        state.renderedScale = state.scale;
        state.renderedTx = state.tx;
        state.renderedTy = state.ty;
        if (state.scale <= MIN_SCALE + 0.001) { detach(); return; }
        paintZoom();
      } else if (state.animationFrame === null) {
        if (win.performance && typeof win.performance.now === 'function') state.animationTime = win.performance.now();
        eventRoot.addEventListener('pointermove', onMouseMove, true);
        state.animationFrame = win.requestAnimationFrame(animateZoom);
      }
    }

    function checkZoomMount() {
      state.watchdogFrame = null;
      if (!state.element) return;
      const elementGone = !state.element.isConnected;
      const targetGone = !state.zoomTarget || !state.zoomTarget.isConnected;
      if (!elementGone && !targetGone) return;

      const oldSrc = (state.element.currentSrc || state.element.src) || '';
      mediaCache = { at: 0, el: null };
      const replacement = findLargestMediaInViewport();
      const newSrc = (replacement && (replacement.currentSrc || replacement.src)) || '';
      const sameImage = replacement &&
        ((oldSrc && newSrc && oldSrc === newSrc) || (targetGone && !elementGone));
      if (!sameImage) {
        debugLog('user navigated away, detaching');
        detach();
        return;
      }

      debugLog('element re-rendered, re-anchoring zoom');
      const camera = { scale: state.scale, tx: state.tx, ty: state.ty };
      detach();
      attach(replacement);
      state.scale = camera.scale;
      state.tx = camera.tx;
      state.ty = camera.ty;
      clampTranslation();
      applyTransform();
    }

    function checkMediaSource() {
      if (!state.element || !hasMediaSourceChanged(state.element, state.mediaSource)) return;
      debugLog('media source changed, detaching');
      mediaCache = { at: 0, el: null };
      detach();
    }

    function startWatchdog() {
      const MutationObserverCtor = (win && win.MutationObserver) || root.MutationObserver;
      state.mediaLoadHandler = checkMediaSource;
      if (state.element && typeof state.element.addEventListener === 'function') {
        state.element.addEventListener('load', state.mediaLoadHandler);
      }
      if (typeof MutationObserverCtor === 'function' && state.element) {
        state.mediaObserver = new MutationObserverCtor(checkMediaSource);
        state.mediaObserver.observe(state.element, {
          attributes: true,
          attributeFilter: ['src', 'srcset'],
        });
      }

      const observeTarget = doc.documentElement || doc.body;
      if (typeof MutationObserverCtor !== 'function' || !observeTarget) return;
      state.watchdogObserver = new MutationObserverCtor(function () {
        if (state.watchdogFrame !== null) return;
        const raf = (win && win.requestAnimationFrame) || root.requestAnimationFrame;
        if (typeof raf === 'function') {
          state.watchdogFrame = raf(checkZoomMount);
          return;
        }
        state.watchdogFrame = 0;
        Promise.resolve().then(checkZoomMount);
      });
      state.watchdogObserver.observe(observeTarget, { childList: true, subtree: true });
    }

    function stopWatchdog() {
      if (state.mediaObserver) state.mediaObserver.disconnect();
      state.mediaObserver = null;
      if (
        state.element &&
        state.mediaLoadHandler &&
        typeof state.element.removeEventListener === 'function'
      ) {
        state.element.removeEventListener('load', state.mediaLoadHandler);
      }
      state.mediaLoadHandler = null;
      if (state.watchdogObserver) state.watchdogObserver.disconnect();
      state.watchdogObserver = null;
      const cancel = (win && win.cancelAnimationFrame) || root.cancelAnimationFrame;
      if (typeof cancel === 'function' && state.watchdogFrame !== null) {
        cancel(state.watchdogFrame);
      }
      state.watchdogFrame = null;
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
      if (event.ctrlKey || event.metaKey || event.altKey || isEditablePhotoCopyTarget(event.target)) return;
      if (event.target && typeof event.target.closest === 'function' &&
          event.target.closest('button, [role="button"], #' + PANEL_ID + '-toast, .grid-item, [role="grid"]')) return;
      if (
        event.target &&
        typeof event.target.closest === 'function' &&
        event.target.closest('#' + PANEL_ID)
      ) {
        return;
      }
      // A user wheel event may only select media under the pointer. The
      // viewport-wide fallback is reserved for React re-mount recovery.
      const attached = state.element && state.element.isConnected ? state.element : null;
      const img = resolveZoomMedia(
        attached,
        state.zoomTarget,
        event.target,
        function () {
          return findPreviewImage(event.target, event.clientX, event.clientY);
        }
      );
      if (!img) {
        debugLog('no preview img', event.target && event.target.tagName, event.target && event.target.className);
        return;
      }

      if (state.dragging || nativeDrag) {
        event.preventDefault(); event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        return;
      }

      const native = findNativeOneUpZoomController(doc);
      if (native) {
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (win.innerHeight || 800) : 1;
        const delta = -clamp(Number(event.deltaY) * unit, -1000, 1000);
        if (!Number.isFinite(delta) || delta === 0) return;
        const scale = getNativeZoomScale(native);
        const next = clamp(scale * Math.exp(delta * 0.0015), native.min, native.max);
        if (next === scale) return;
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        requestNativeZoom(native, next, false, img, event);
        showZoomHint();
        return;
      }
      if (hasPendingNativeViewer()) return;
      const rect = img.getBoundingClientRect();

      // Accumulate scale at the destination, but measure a changed cursor's
      // image point at the painted camera, not the unseen pending destination.
      const px = event.clientX - rect.left - rect.width / 2;
      const py = event.clientY - rect.top - rect.height / 2;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (win.innerHeight || 800) : 1;
      const delta = -clamp(Number(event.deltaY) * unit, -1000, 1000);
      if (!Number.isFinite(delta) || delta === 0) return;
      const factor = Math.exp(delta * 0.0015);
      const currentScale = state.element === img ? state.scale : MIN_SCALE;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, currentScale * factor));
      if (newScale === currentScale) {
        // At a clamp boundary, preserve normal page scrolling.
        debugLog('clamped at', newScale);
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (state.element !== img) attach(img);

      const scaleRatio = newScale / state.renderedScale;
      const translation = calculateZoomTranslation({
        tx: state.renderedTx,
        ty: state.renderedTy,
        pointerOffsetX: px,
        pointerOffsetY: py,
        scaleRatio,
      });
      state.tx = translation.tx;
      state.ty = translation.ty;
      state.scale = newScale;
      if (state.scale <= MIN_SCALE + 0.001) {
        state.scale = MIN_SCALE;
        state.tx = 0;
        state.ty = 0;
      }
      clampTranslation();
      showZoomHint();
      debugLog('scale=', state.scale.toFixed(2), 'tag=', img.tagName, 'size=', Math.round(rect.width) + 'x' + Math.round(rect.height));
      applyTransform();
    }

    function onMouseDown(event) {
      if (event.button !== 0) return;
      if (event.target && typeof event.target.closest === 'function' &&
          event.target.closest('button, input, textarea, select, [role="button"], #' + PANEL_ID + '-toast')) return;
      const native = findNativeOneUpZoomController(doc);
      if (native) {
        const image = findPreviewImage(event.target, event.clientX, event.clientY);
        const matrix = readNativeMatrix(native);
        const scale = readNativeScale(native);
        if (!image || !matrix || scale <= native.min) { cancelNativeZoom(); return; }
        // Adopt what is actually painted, never the unfinished wheel target.
        prepareNativeCamera(native);
        nativeZoom.image = image;
        if (nativeZoom.frame !== null) win.cancelAnimationFrame(nativeZoom.frame);
        nativeZoom.frame = null; nativeZoom.time = null;
        nativeZoom.target = scale; nativeZoom.painted = scale; nativeZoom.anchor = null;
        const rect = image.getBoundingClientRect();
        nativeDrag = { controller: native, matrix, x: event.clientX, y: event.clientY,
          width: rect.width / scale, height: rect.height / scale, scale, pointerId: event.pointerId };
        beginPointerDrag(event);
        return;
      }
      if (!state.zoomTarget || state.scale <= MIN_SCALE) return;
      const rect = state.zoomTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) {
        return;
      }
      cancelZoomAnimation();
      state.scale = state.renderedScale;
      state.tx = state.renderedTx;
      state.ty = state.renderedTy;
      state.dragging = true;
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.origTx = state.tx;
      state.origTy = state.ty;
      setOwnedInlineStyle('cursor', 'grabbing', 'appliedCursor');
      beginPointerDrag(event);
    }

    function beginPointerDrag(event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      capturedPointer = { target: event.target, id: event.pointerId };
      if (event.target && event.target.setPointerCapture && event.pointerId !== undefined) {
        try { event.target.setPointerCapture(event.pointerId); } catch (error) { /* detached overlay */ }
      }
      eventRoot.addEventListener('pointermove', onMouseMove, true);
      eventRoot.addEventListener('pointerup', endDrag, true);
      eventRoot.addEventListener('lostpointercapture', endDrag, true);
    }

    function onMouseMove(event) {
      if (capturedPointer && event.pointerId !== capturedPointer.id) return;
      if (!nativeDrag && !state.dragging) {
        const image = findPreviewImage(event.target, event.clientX, event.clientY);
        if (nativeZoom && nativeZoom.frame !== null && image) {
          const controller = findNativeOneUpZoomController(doc);
          if (matchesNativeZoom(controller)) requestNativeZoom(controller, nativeZoom.target, false, image, event);
          else cancelNativeZoom();
        } else if (state.animationFrame !== null && image === state.element) {
          const rect = image.getBoundingClientRect();
          state.tx = state.renderedTx + (event.clientX - rect.left - rect.width / 2) * (1 - state.scale / state.renderedScale);
          state.ty = state.renderedTy + (event.clientY - rect.top - rect.height / 2) * (1 - state.scale / state.renderedScale);
          clampTranslation();
        }
        return;
      }
      if (nativeDrag) {
        const controller = findNativeOneUpZoomController(doc);
        if (!matchesNativeZoom(controller)) { cancelNativeZoom(); return; }
        const matrix = readNativeMatrix(controller);
        if (!matrix) { cancelNativeZoom(); return; }
        const limits = calculatePanLimits(nativeDrag.width, nativeDrag.height, nativeDrag.scale);
        matrix.e = clamp(nativeDrag.matrix.e + event.clientX - nativeDrag.x, -limits.x, limits.x);
        matrix.f = clamp(nativeDrag.matrix.f + event.clientY - nativeDrag.y, -limits.y, limits.y);
        writeNativeMatrix(controller, matrix);
        event.preventDefault(); event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        return;
      }
      if (!state.dragging || !state.element) return;
      state.tx = state.origTx + (event.clientX - state.startX);
      state.ty = state.origTy + (event.clientY - state.startY);
      // Bound the pan with the unscaled dimensions captured at attach time.
      const limit = calculatePanLimits(state.baseWidth, state.baseHeight, state.scale);
      state.tx = Math.max(-limit.x, Math.min(limit.x, state.tx));
      state.ty = Math.max(-limit.y, Math.min(limit.y, state.ty));
      applyTransform();
      event.preventDefault();
    }

    function endDrag(event) {
      if (event && capturedPointer && event.pointerId !== capturedPointer.id) return;
      eventRoot.removeEventListener('pointermove', onMouseMove, true);
      eventRoot.removeEventListener('pointerup', endDrag, true);
      eventRoot.removeEventListener('lostpointercapture', endDrag, true);
      nativeDrag = null;
      const captured = capturedPointer;
      capturedPointer = null;
      if (captured && captured.target && captured.target.releasePointerCapture && captured.id !== undefined) {
        try { captured.target.releasePointerCapture(captured.id); } catch (error) { /* already released */ }
      }
      if (!state.dragging) return;
      state.dragging = false;
      if (state.zoomTarget) setOwnedInlineStyle('cursor', 'grab', 'appliedCursor');
    }

    function onDoubleClick(event) {
      if (event.button !== undefined && event.button !== 0) return;
      const target = event.target;
      if (target && typeof target.closest === 'function' &&
          target.closest('button, input, textarea, select, [role="button"], #' + PANEL_ID + '-toast')) return;
      const img = findPreviewImage(target, event.clientX, event.clientY);
      if (!img || (typeof img.closest === 'function' && img.closest('.grid-item, [role="grid"]'))) return;
      const native = findNativeOneUpZoomController(doc);
      if (!native && hasPendingNativeViewer()) return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      if (native) {
        const next = getNativeZoomScale(native) > native.min + 0.001 ? native.min : Math.min(2, native.max);
        requestNativeZoom(native, next, false, img, event);
        showZoomHint();
        return;
      }
      if (state.element === img && state.scale > MIN_SCALE + 0.001) {
        state.scale = 1; state.tx = 0; state.ty = 0;
      } else {
        attach(img);
        const rect = state.zoomTarget.getBoundingClientRect();
        state.scale = 2;
        state.tx = -(event.clientX - rect.left - rect.width / 2);
        state.ty = -(event.clientY - rect.top - rect.height / 2);
        clampTranslation();
      }
      showZoomHint();
      applyTransform();
    }

    function onKeyDown(event) {
      const native = findNativeOneUpZoomController(doc);
      if (native && (event.key === 'Escape' || event.key === '0') &&
          !event.ctrlKey && !event.metaKey && !event.altKey && !isEditablePhotoCopyTarget(event.target) &&
          Math.max(native.value, getNativeZoomScale(native)) > native.min + 0.001) {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        requestNativeZoom(native, native.min, true);
        return;
      }
      if (!state.element) return;
      // Only claim the reset keys when the user is not typing or invoking a
      // browser/OS shortcut.
      if (isEditablePhotoCopyTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape' || event.key === '0') {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        detach();
      }
    }

    // One capture root avoids processing the same bubbling event twice.
    function hasPendingNativeViewer() {
      if (!doc.querySelector) return false;
      const toolbar = doc.querySelector('.ToolbarOneUpZoomSlider');
      if (!toolbar || toolbar.isConnected === false) return false;
      const rect = toolbar.getBoundingClientRect();
      return Boolean(rect.width && rect.height);
    }
    eventRoot.addEventListener('wheel', onWheel, { passive: false, capture: true });
    eventRoot.addEventListener('dblclick', onDoubleClick, true);
    function dispose() {
      if (disposed) return;
      disposed = true;
      resetZoomOnResize();
      if (discoveryObserver) discoveryObserver.disconnect();
      eventRoot.removeEventListener('wheel', onWheel, true);
      eventRoot.removeEventListener('dblclick', onDoubleClick, true);
      zoomPanInstallations.delete(doc);
    }
    zoomPanInstallations.set(doc, dispose);
    const Observer = win.MutationObserver || root.MutationObserver;
    if (typeof Observer === 'function' && (doc.documentElement || doc.body)) {
      // Idle mount discovery only; active viewer owns its scoped observer.
      discoveryObserver = new Observer(function () {
        if (!disposed && !sessionActive && findNativeOneUpZoomController(doc)) startSession();
      });
      discoveryObserver.observe(doc.documentElement || doc.body, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['class'],
      });
    }
    if (findNativeOneUpZoomController(doc)) startSession();
    return dispose;
  }

  // DOM markers unique to the Photos app chrome. Used as a fallback so a renamed
  // route does not silently disable the whole script. Keep these narrow: a false
  // positive here would mount a second panel, every bit as bad as mounting none.
  const APP_DOM_MARKERS = [
    '[class*="OneUpCarouselItem"]',
    '[class*="PhotosRootContent"]',
  ];

  function looksLikePhotosAppDom(doc) {
    if (!doc || typeof doc.querySelector !== 'function') return false;
    return APP_DOM_MARKERS.some(function (selector) {
      try {
        return Boolean(doc.querySelector(selector));
      } catch (error) {
        return false;
      }
    });
  }

  function isInICloudPhotosAppFrame(win, doc) {
    try {
      const loc = win && win.location;
      if (!loc) return false;
      // The actual Photos app is loaded inside an iframe at
      // /applications/photos3/current/<locale>/index.html.
      // The outer shell at /photos is just a launcher.
      if (/^\/applications\/photos/i.test(loc.pathname || '')) return true;
      // The route is an implementation detail Apple can rename at any time. If
      // the document carries the app's own markup we mount anyway rather than
      // leaving the user with a script that silently does nothing.
      return looksLikePhotosAppDom(doc || (win && win.document));
    } catch (error) {
      return false;
    }
  }

  function observeAndRemount(doc, win, attachPanel) {
    const MutationObserverCtor = (win && win.MutationObserver) || root.MutationObserver;
    if (typeof MutationObserverCtor !== 'function') return;

    let observedBody = null;
    const observer = new MutationObserverCtor(sync);
    function sync() {
      if (!doc.body) return;
      if (observedBody !== doc.body) {
        observer.disconnect();
        observedBody = doc.body;
        if (doc.documentElement) observer.observe(doc.documentElement, { childList: true });
        observer.observe(observedBody, { childList: true });
        installPasteListener(doc, win);
      }
      // Move the existing nodes, keeping the queue, timers and resize listener.
      attachPanel();
    }
    sync();
  }

  function mountPanel(doc, win) {
    const frameRoot = doc.documentElement;
    if ((frameRoot && frameRoot.hasAttribute(MOUNT_ATTRIBUTE)) || doc.getElementById(PANEL_ID)) return true;
    const attachPanel = createPanel(doc, win);
    if (frameRoot) frameRoot.setAttribute(MOUNT_ATTRIBUTE, '');
    installPasteListener(doc, win);
    installGridPhotoCopyMenu(doc, win);
    installGridPhotoKeyboardCopy(doc, win);
    installOneUpCopyButton(doc, win);
    installImageZoomPan(doc, win);
    observeAndRemount(doc, win, attachPanel);
    return true;
  }

  function mountWhenReady(doc, win) {
    if (!doc) return false;
    if (doc.body) {
      if (!isInICloudPhotosAppFrame(win, doc)) return false;
      mountPanel(doc, win);
      return true;
    }
    doc.addEventListener('DOMContentLoaded', function () {
      if (doc.body && isInICloudPhotosAppFrame(win, doc)) mountPanel(doc, win);
    }, { once: true });
    return true;
  }

  function bootstrap() {
    const doc = root.document;
    if (!doc) return;
    const win = root.window || root;

    if (mountWhenReady(doc, win)) return;

    // Not the app frame. The outer shell loads the Photos app in an iframe, and
    // that iframe usually gets its own copy of this script — but if it mounted
    // before we were injected, adopt it so the panel is not missing all session.
    const adoptFrames = function () {
      let frames = [];
      try {
        frames = Array.from(win.frames || []);
      } catch (error) {
        frames = [];
      }
      for (let i = 0; i < frames.length; i += 1) {
        try {
          const frameDoc = frames[i].document;
          if (!frameDoc) continue;
          if (frameDoc.getElementById(PANEL_ID)) return true;
          if (!looksLikePhotosAppDom(frameDoc)) continue;
          mountPanel(frameDoc, frames[i]);
          return true;
        } catch (error) {
          // Cross-origin frame: nothing we can do from here.
        }
      }
      return false;
    };

    const deadline = Date.now() + 20000;
    const pollFrames = function () {
      if (adoptFrames() || Date.now() > deadline) return;
      setTimeout(pollFrames, 400);
    };
    pollFrames();

    if (typeof console !== 'undefined' && console.debug) {
      console.debug(LOG_PREFIX, 'Waiting for the Photos app frame at', (win.location || {}).href);
    }
  }

  return {
    addGridDownloadMenuItem,
    bootstrap,
    calculateCanvasSize,
    calculateDraggedPanelPosition,
    calculatePanLimits,
    calculateZoomTranslation,
    convertImageFileToJpeg,
    createGenerationGate,
    createRefreshDemandTracker,
    createNamedImageFile,
    decodeImageForCanvas,
    dropFilesOnICloudPage,
    extractImageFilesFromPaste,
    fetchCloudKitSyncState,
    filterImageFiles,
    copyPhotoImageToClipboard,
    findActiveSidebarItem,
    findCopyablePhotoImage,
    findCopyablePhotoImageFromEvent,
    findCopyMenuItemList,
    findNativeDownloadItem,
    findICloudFileInput,
    findPhotoContextMenus,
    findICloudFileInputShallow,
    findSidebarItem,
    getConvertedJpegFileName,
    getPanelText,
    hasMediaSourceChanged,
    installPasteListener,
    installGridPhotoCopyMenu,
    installGridPhotoKeyboardCopy,
    installOneUpCopyButton,
    enableOneUpButtonDragging,
    isEditablePhotoCopyTarget,
    isInICloudPhotosAppFrame,
    isJpegLikeFile,
    isImageLikeFile,
    isUploadTrigger,
    looksLikePhotosAppDom,
    findGridPhotoImageAtPoint,
    resolveOneUpImage,
    copyCurrentOneUpImage,
    createOneUpCopyButton,
    normalizeFilesForICloudWebUpload,
    resolveZoomMedia,
    restoreOwnedInlineStyle,
    resolveCopyMenuBaseHeight,
    renderPhotoImageToBlob,
    selectICloudFileInput,
    serializeZoneSyncState,
    shouldConvertForICloudWeb,
    snapshotFiles,
    startAbortableTask,
    softRefreshLibraryView,
    transferFilesToInput,
    uploadViaICloudPage,
    waitForICloudFileInput,
    waitForLibraryViewChange,
    withTimeout,
  };
});
