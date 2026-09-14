// ==UserScript==
// @name         iCloud Photos Web Uploader
// @namespace    https://github.com/hahapkpk/tools
// @version      1.16.0
// @description  Upload via paste/drag/pick on iCloud Photos, with auto JPEG conversion, quick library refresh, grid right-click & Ctrl+C photo copy, and mouse-wheel zoom / drag-pan in the image preview.
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
  const IMAGE_EXTENSIONS = /\.(apng|avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i;
  const JPEG_EXTENSIONS = /\.jpe?g$/i;
  const JPEG_QUALITY = 0.92;
  const pasteDispatcherByDocument = new WeakMap();
  const registeredPasteTargets = new WeakSet();
  const handledPasteEvents = new WeakSet();
  const gridCopyMenuStateByDocument = new WeakMap();
  const keyboardPhotoCopyStateByDocument = new WeakMap();
  const oneUpCopyStateByDocument = new WeakMap();

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

      canvas.toBlob(function (blob) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!blob) reject(new Error('Could not convert image to JPEG.'));
        else resolve(blob);
      }, type, quality);
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

  async function normalizeFilesForICloudWebUpload(files, win, status, converter) {
    const images = filterImageFiles(files);
    const normalized = [];
    const failures = [];
    let convertedCount = 0;
    const convert = converter || convertImageFileToJpeg;
    const report = typeof status === 'function' ? status : function () {};
    let processedCount = 0;

    for (let i = 0; i < images.length; i += 1) {
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

    if (convertedCount) {
      report('已将 ' + convertedCount + ' 张图片转换为 JPEG。');
    }

    if (failures.length) {
      report(
        '跳过 ' + failures.length + ' 张无法转换的图片：' + failures.join('；') +
          (normalized.length ? '。其余 ' + normalized.length + ' 张继续上传。' : '。没有可上传的图片。'),
        !normalized.length
      );
    }

    return normalized;
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

  // queryAllDeep is expensive (it walks the entire DOM plus every shadow root and
  // same-origin frame), so cache a validated result between route changes.
  const fileInputCacheByDocument = new WeakMap();
  const PHOTO_ACCEPT_PATTERN = /(?:^|,)\s*(?:image\/|\.(?:apng|avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)\b)/i;

  function getDocumentRouteKey(doc) {
    const location = doc && doc.defaultView && doc.defaultView.location;
    if (!location) return '';
    return String(location.href || location.pathname || '') + String(location.hash || '');
  }

  function isUsableICloudFileInput(input) {
    if (!input || input.disabled || input.isConnected === false) return false;
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
    'cancel upload', 'stop upload', 'abort upload', '取消上传', '停止上传', '终止上传',
  ];

  const UPLOAD_LABEL_MARKERS = [
    'upload', 'uploads', 'uploading', 'add photo', 'add photos', 'add image',
    'add images', 'add picture', 'add pictures', 'import photos', 'import photo',
    'choose photo', 'choose photos', 'select photos', 'upload photos',
    '上传', '添加照片', '增加照片', '添加图片', '导入',
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
      activeKey = [
        normalizeLabelText(active.textContent),
        typeof active.getAttribute === 'function' ? active.getAttribute('aria-current') || '' : '',
        typeof active.getAttribute === 'function' ? active.getAttribute('aria-selected') || '' : '',
      ].join('|');
    }
    return { view, grid, activeKey };
  }

  function hasLibraryViewStateChanged(before, after) {
    if (after.view && after.view !== before.view) return true;
    if (after.grid && after.grid !== before.grid) return true;
    return Boolean(after.activeKey && after.activeKey !== before.activeKey);
  }

  function waitForLibraryViewChange(doc, win, action, timeoutMs) {
    const before = captureLibraryViewState(doc);
    const Observer = (win && win.MutationObserver) || root.MutationObserver;
    const target = (before.view && before.view.parentNode) ||
      before.view ||
      (doc && (doc.body || doc.documentElement));
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
      let settled = false;
      function changed() {
        return hasLibraryViewStateChanged(before, captureLibraryViewState(doc));
      }
      const observer = new Observer(function () {
        if (changed()) finish(true);
      });
      function cleanup() {
        clearTimeout(timer);
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
        if (action() === false) {
          finish(false);
        } else if (changed()) {
          finish(true);
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
    function observe(action) {
      return waitForLibraryViewChange(
        doc,
        win,
        action,
        Math.max(0, expiresAt - Date.now())
      );
    }

    // Prefer iCloud's hash router, but count the round-trip as successful only
    // when both route changes produce an observable Photos view mutation.
    if (win && win.location && typeof win.location.hash === 'string' && opts.allowHashNavigation !== false) {
      const originalHash = win.location.hash || '';
      let pivotHash = null;
      for (let i = 0; i < KNOWN_HASH_ROUTES.length; i += 1) {
        const candidate = KNOWN_HASH_ROUTES[i];
        if (originalHash === candidate) continue;
        if (originalHash && originalHash.indexOf(candidate) === 0) continue;
        pivotHash = candidate;
        break;
      }
      if (pivotHash) {
        try {
          const pivotChanged = await observe(function () {
            win.location.hash = pivotHash;
          });
          if (pivotChanged) {
            const originalChanged = await observe(function () {
              win.location.hash = originalHash;
            });
            if (originalChanged) return true;
          } else {
            win.location.hash = originalHash;
          }
        } catch (error) {
          try {
            win.location.hash = originalHash;
          } catch (restoreError) {
            // Continue to the DOM fallback with the best state the router kept.
          }
        }
      }
    }

    if (Date.now() >= expiresAt) return false;

    // Fallback: simulate the user clicking two distinct sidebar views and apply
    // the same observable-change requirement to both clicks.
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

    const pivotChanged = await observe(function () {
      return simulateMouseClick(pivot);
    });
    if (!pivotChanged) return false;
    return observe(function () {
      return simulateMouseClick(original);
    });
  }

  function transferFilesToInput(input, files, win) {
    if (!input || !files.length) return false;
    const WindowDataTransfer = win && win.DataTransfer;
    if (typeof WindowDataTransfer !== 'function') return false;
    try {
      const transfer = new WindowDataTransfer();
      files.forEach(function (file) {
        transfer.items.add(file);
      });
      input.files = transfer.files;
      // Assigning input.files is a silent no-op when the browser rejects it, so
      // read the result back instead of claiming a success we cannot observe.
      const attached = input.files ? input.files.length : 0;
      if (attached !== files.length) return false;
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
    let accepted = false;
    try {
      ['dragenter', 'dragover', 'drop'].forEach(function (type) {
        const event = createDragEvent(type, transfer, win);
        target.dispatchEvent(event);
        if (
          (type === 'dragover' || type === 'drop') &&
          event.defaultPrevented
        ) {
          accepted = true;
        }
      });
    } catch (error) {
      return false;
    }
    return accepted;
  }

  // Returns the number of images actually handed to iCloud (0 on failure) so the
  // caller reports what happened instead of what was attempted.
  async function uploadViaICloudPage(files, doc, win, status, options) {
    let images = filterImageFiles(files);
    if (!images.length) {
      status('这里只能上传图片文件。', true);
      return 0;
    }
    try {
      images = await normalizeFilesForICloudWebUpload(images, win, status);
    } catch (error) {
      status(error.message, true);
      return 0;
    }
    if (!images.length) {
      status('没有图片可以上传：全部转换失败。', true);
      return 0;
    }
    let input = findICloudFileInput(doc);
    if (!input) {
      const knownInputs = new Set(queryAllDeep(doc, 'input[type="file"]'));
      status('正在打开 iCloud 上传控件...');
      const clickedUploadTrigger = clickPossibleUploadTrigger(doc);
      input = clickedUploadTrigger
        ? await waitForICloudFileInput(doc, 3000, undefined, knownInputs)
        : null;
    }
    const beforeDispatch = options && options.beforeDispatch;
    if (typeof beforeDispatch === 'function') await beforeDispatch();
    if (!input) {
      status('找不到 iCloud 上传控件，正在尝试拖拽上传通道...');
      if (dropFilesOnICloudPage(images, doc, win)) {
        status('iCloud 页面已接受拖拽上传：' + images.length + ' 张图片。');
        return images.length;
      }
      status('找不到可用的 iCloud 上传入口。请确认当前页面已经登录并停留在“照片”图库视图。', true);
      return 0;
    }
    const inputWindow = input.ownerDocument && input.ownerDocument.defaultView || win;
    const transferred = transferFilesToInput(input, images, inputWindow);
    if (!transferred) {
      status('浏览器阻止了自动交接。请使用“选择图片”按钮手动选择。', true);
      return 0;
    }
    status('已发送到 iCloud 上传队列：' + images.length + ' 张图片。');
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
      '#' + PANEL_ID + ' .iu-toast{position:absolute;right:calc(100% + 8px);bottom:50%;',
      'transform:translate(6px,50%);white-space:normal;word-break:break-word;',
      'background:rgba(0,0,0,.82);color:#fff;',
      'font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      'padding:6px 10px;border-radius:8px;pointer-events:none;opacity:0;',
      'transition:opacity .2s ease,transform .2s ease;max-width:320px;',
      'max-height:40vh;overflow:auto;overscroll-behavior:contain;cursor:default;text-align:left}',
      '#' + PANEL_ID + ' .iu-toast.is-visible{opacity:1;transform:translate(0,50%);pointer-events:auto}',
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
    let sendQueue = Promise.resolve();
    const refreshGate = createGenerationGate();
    const refreshDemand = createRefreshDemandTracker();

    function isRefreshCurrent(generation) {
      return activeRefreshGeneration === generation && refreshGate.isCurrent(generation);
    }

    function isRefreshActive() {
      return activeRefreshGeneration !== null && isRefreshCurrent(activeRefreshGeneration);
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
      reloadInFlight = Promise.resolve().then(async function () {
        try {
          const softened = await softRefreshLibraryView(doc, win);
          if (softened) {
            refreshDemand.clear();
            status('已刷新图库');
            return true;
          }
          status('无法自动刷新图库，请使用 iCloud 侧边栏切换视图后返回。', true);
        } catch (error) {
          status('刷新图库失败，请手动切换视图。', true);
          console.warn(LOG_PREFIX, 'Soft refresh failed:', error && error.message ? error.message : error);
        }
        return false;
      }).finally(function () {
        reloadInFlight = null;
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
        status('无法读取同步状态，将在 5 秒后尝试软刷新。');
        reloadTimer = setTimeout(function () {
          reloadTimer = null;
          if (isRefreshCurrent(generation)) void doReload();
        }, 5000);
        return;
      }

      status('等待服务器确认…');
      const expiresAt = Date.now() + 30000;
      let delay = 2000;

      function scheduleNextPoll() {
        if (!isRefreshCurrent(generation)) return;
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
          status('等待确认超时，尝试软刷新…');
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
          status('服务器已确认，正在刷新…');
          void doReload();
          return;
        }
        delay = Math.min(delay + 1000, 5000);
        scheduleNextPoll();
      }

      scheduleNextPoll();
    }

    async function sendBatch(files) {
      const images = filterImageFiles(files);
      if (!images.length) {
        status('只能上传图片', true);
        return;
      }
      if (reloadInFlight) await reloadInFlight;

      // Batches run serially. The outer queue pauses any active refresh while
      // preserving the latest successful batch's outstanding refresh demand.
      panel.classList.add('is-busy');
      let uploadedCount = 0;
      let baseToken = null;
      try {
        uploadedCount = await uploadViaICloudPage(images, doc, win, status, {
          beforeDispatch: async function () {
            baseToken = await captureBaselineToken();
          },
        });
      } catch (error) {
        const detail = error && error.message ? error.message : String(error);
        status('上传处理失败：' + detail, true);
        console.warn(LOG_PREFIX, 'Upload failed:', error);
      } finally {
        panel.classList.remove('is-busy');
      }
      if (uploadedCount > 0) {
        status('已发送 ' + uploadedCount + ' 张，等待服务器确认…');
        refreshDemand.recordSuccess(baseToken);
      }
    }

    function send(files) {
      const queuedFiles = snapshotFiles(files);
      refreshDemand.enqueue();
      clearPendingReload();
      sendQueue = sendQueue.then(
        function () { return sendBatch(queuedFiles); },
        function () { return sendBatch(queuedFiles); }
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
      // Suppress the click that follows a drag, and never open the picker when
      // the user is scrolling or selecting text inside a long status message.
      if (panel._recentDrag || event.target === toast) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.target === picker) return;
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

    doc.body.appendChild(panel);
    return panel;
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
        const target = event.target;
        if (target && typeof target.matches === 'function') {
          try {
            if (target.matches('input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="password"], textarea')) {
              return;
            }
          } catch (error) {
            // Ignore selector failures and continue with the file payload.
          }
          if (target.isContentEditable) return;
        }

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
  const DOWNLOAD_MENU_LABEL = '下载原片';

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

  function renderPhotoImageToBlob(image, win) {
    // iCloud revokes the object URL once a thumbnail has rendered: the <img>
    // keeps painting but fetch() rejects with "Failed to fetch". Redraw the
    // already-decoded image into a canvas to recover the same pixels.
    return new Promise(function (resolve, reject) {
      const doc = (image && image.ownerDocument) || (win && win.document);
      const width = Number(image && image.naturalWidth) || 0;
      const height = Number(image && image.naturalHeight) || 0;
      let canvas = null;
      let context = null;
      try {
        canvas = doc && typeof doc.createElement === 'function' ? doc.createElement('canvas') : null;
        if (canvas) {
          canvas.width = width;
          canvas.height = height;
          context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
        }
      } catch (error) {
        canvas = null;
        context = null;
      }
      if (!canvas || !context || !width || !height || typeof canvas.toBlob !== 'function') {
        reject(new Error('无法读取图片数据。'));
        return;
      }
      try {
        context.drawImage(image, 0, 0, width, height);
      } catch (error) {
        reject(new Error('无法读取图片数据。'));
        return;
      }
      canvas.toBlob(function (blob) {
        if (blob && /^image\//i.test(String(blob.type || ''))) {
          resolve(blob);
        } else {
          reject(new Error('无法读取图片数据。'));
        }
      }, 'image/png');
    });
  }

  async function fetchCopyablePhotoImageBlob(image, win) {
    const source = getCopyablePhotoImageSource(image);
    const fetchFn = win && win.fetch;
    if (source && typeof fetchFn === 'function') {
      try {
        const response = await fetchFn(source, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (response && response.ok && typeof response.blob === 'function') {
          const blob = await response.blob();
          if (/^image\//i.test(String(blob && blob.type || ''))) return blob;
        }
      } catch (error) {
        // Revoked blob object URLs land here; fall through to the canvas path.
      }
    }
    return renderPhotoImageToBlob(image, win);
  }

  async function copyPhotoImageToClipboard(image, win, preparedBlob) {
    const clipboard = win && win.navigator && win.navigator.clipboard;
    const ClipboardItemCtor = (win && win.ClipboardItem) || root.ClipboardItem;
    if (!clipboard || typeof clipboard.write !== 'function' || typeof ClipboardItemCtor !== 'function') {
      return false;
    }
    const blob = preparedBlob || await fetchCopyablePhotoImageBlob(image, win);
    const type = String(blob && blob.type || '');
    if (!/^image\//i.test(type)) throw new Error('图片数据格式无效。');
    await clipboard.write([new ClipboardItemCtor({ [type]: blob })]);
    return true;
  }

  function isVisibleMenu(menu) {
    if (!menu || typeof menu.getBoundingClientRect !== 'function') return true;
    const rect = menu.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
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

  function applyCopyMenuHeight(element, extra) {
    if (!element || !element.style || !extra) return;
    const base = resolveCopyMenuBaseHeight({
      current: parseFloat(element.style.height),
      storedBase: parseFloat(readCopyMenuAttr(element, COPY_MENU_BASE_HEIGHT_ATTR)),
      storedApplied: parseFloat(readCopyMenuAttr(element, COPY_MENU_APPLIED_HEIGHT_ATTR)),
    });
    if (base === null) return;
    if (typeof element.setAttribute === 'function') {
      element.setAttribute(COPY_MENU_BASE_HEIGHT_ATTR, String(base));
      element.setAttribute(COPY_MENU_APPLIED_HEIGHT_ATTR, String(extra));
    }
    element.style.height = base + extra + 'px';
  }

  // iCloud's popover wrapper is pointer-events:none; only ui-popover-content
  // restores interaction, so the row must be inserted into the list it owns.
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
  function growCopyMenuHeight(menu, extra) {
    const height = Math.round(extra || 0);
    if (!height) return;
    const popover =
      menu && typeof menu.closest === 'function' ? menu.closest('ui-popover') || menu : menu;
    applyCopyMenuHeight(popover, height);
    const content =
      popover && typeof popover.querySelector === 'function'
        ? popover.querySelector('ui-popover-content')
        : null;
    applyCopyMenuHeight(content, height);
  }

  // A plain <button> inherits the popover's dimmed colour and has no icon slot,
  // so it looks nothing like iCloud's own rows. Clone a real row instead and
  // swap its label/icon: that keeps typography, colour and hover behaviour.
  const MENU_ROW_FALLBACK_STYLE = [
    'display:flex',
    'width:100%',
    'align-items:center',
    'padding:5px 16px',
    'border:0',
    'background:transparent',
    'color:inherit',
    'font:inherit',
    'text-align:left',
    'cursor:pointer',
    // iCloud sets pointer-events:none on the popover wrapper, so the row must
    // re-enable hit testing for itself to be reachable by a real mouse click.
    'pointer-events:auto',
  ].join(';');

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

  function buildMenuRow(doc, label, marker) {
    const item = doc.createElement('button');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.setAttribute(marker, '');
    item.textContent = label;
    item.style.cssText = MENU_ROW_FALLBACK_STYLE;
    return item;
  }

  function setMenuRowLabel(row, label) {
    if (!row) return;
    const title = typeof row.querySelector === 'function' ? row.querySelector('.menuItem-title') : null;
    if (title) title.textContent = label;
    else row.textContent = label;
  }

  function copyMenuRowIcon(row, source) {
    if (!row || !source || typeof row.querySelector !== 'function') return;
    const target = row.querySelector('.menuItem-icon');
    const sourceIcon =
      typeof source.querySelector === 'function' ? source.querySelector('.menuItem-icon') : null;
    if (!target || !sourceIcon) return;
    const svg = typeof sourceIcon.querySelector === 'function' ? sourceIcon.querySelector('svg') : null;
    if (!svg || typeof svg.cloneNode !== 'function') return;
    target.textContent = '';
    target.appendChild(svg.cloneNode(true));
  }

  function createMenuRow(doc, container, label, marker, iconSourceRow) {
    const existing =
      container && typeof container.querySelector === 'function'
        ? container.querySelector('[' + marker + ']')
        : null;
    if (existing) return existing;
    const template = findNativeMenuRow(container, /./);
    let item = null;
    if (template && typeof template.cloneNode === 'function') {
      item = template.cloneNode(true);
      item.setAttribute(marker, '');
      item.setAttribute('role', 'menuitem');
      item.setAttribute('tabindex', '-1');
      if (typeof item.removeAttribute === 'function') {
        item.removeAttribute('aria-selected');
        item.removeAttribute('aria-disabled');
      }
      if (item.style) item.style.pointerEvents = 'auto';
      setMenuRowLabel(item, label);
      if (iconSourceRow) copyMenuRowIcon(item, iconSourceRow);
    }
    if (!item) item = buildMenuRow(doc, label, marker);
    return item;
  }

  // Delegate the download to iCloud's own command: its TCC/asset mapping is the
  // only reliable way to fetch true originals (multi-select downloads a zip).
  function triggerNativeDownload(doc, win, container) {
    const native = findNativeDownloadItem(container);
    if (!native || typeof native.dispatchEvent !== 'function') return false;
    const MouseEventCtor = win && win.MouseEvent ? win.MouseEvent : root.MouseEvent;
    let event = null;
    if (typeof MouseEventCtor === 'function') {
      event = new MouseEventCtor('click', { bubbles: true, cancelable: true });
    } else if (doc && typeof doc.createEvent === 'function') {
      event = doc.createEvent('MouseEvents');
      event.initEvent('click', true, true);
    }
    if (!event) return false;
    native.dispatchEvent(event);
    return true;
  }

  // Resolve the list at click time: the popover content can be replaced between
  // opens, so a list captured when the row was created may already be detached.
  function makeDownloadRowHandler(doc, win, row) {
    return function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      const menu = typeof row.closest === 'function' ? row.closest('ui-popover') : row.parentElement;
      const list = findCopyMenuItemList(menu || row.parentElement) || row.parentElement;
      if (!triggerNativeDownload(doc, win, list)) {
        showCopyPhotoStatus(doc, '未找到 iCloud 的下载项，请使用菜单中的“下载”', true);
      }
    };
  }

  // The grid only ever renders a small derivative, and neither the DOM nor the
  // React tree exposes which asset a tile belongs to, so the clipboard cannot
  // receive the original. Hand the job to iCloud's own 下载 command instead:
  // it resolves the asset itself and yields the true original (a zip when
  // several photos are selected).
  function addGridDownloadMenuItem(doc, win, menu) {
    if (!menu || !doc || typeof doc.createElement !== 'function') return false;
    const list = findCopyMenuItemList(menu);
    if (!list || typeof list.querySelector !== 'function') return false;
    const nativeDownload = findNativeDownloadItem(list);
    if (!nativeDownload) return false;
    // Older builds injected a 拷贝图像 row that only copied the small on-screen
    // derivative; drop it so an update without a page reload still matches.
    if (typeof list.querySelectorAll === 'function') {
      const stale = list.querySelectorAll('[' + GRID_COPY_MENU_ATTR + ']');
      for (let i = 0; i < stale.length; i += 1) {
        if (stale[i] && typeof stale[i].remove === 'function') stale[i].remove();
      }
    }
    let row = list.querySelector('[' + GRID_DOWNLOAD_MENU_ATTR + ']');
    // A row injected by an older build has no working click binding; rebuild it.
    if (row && !row.__icloudDownloadBound && typeof row.remove === 'function') {
      row.remove();
      row = null;
    }
    if (!row) {
      row = createMenuRow(doc, list, DOWNLOAD_MENU_LABEL, GRID_DOWNLOAD_MENU_ATTR, nativeDownload);
      row.addEventListener('click', makeDownloadRowHandler(doc, win, row), true);
      row.__icloudDownloadBound = true;
      // Insert as a sibling row before iCloud's own 下载: appending to the
      // popover wrapper would land outside the hit-testable content.
      if (nativeDownload.parentNode) nativeDownload.parentNode.insertBefore(row, nativeDownload);
      else if (typeof list.insertBefore === 'function') list.insertBefore(row, list.firstChild);
    }
    if (row && typeof row.getBoundingClientRect === 'function') {
      growCopyMenuHeight(menu, row.getBoundingClientRect().height || 0);
    }
    return true;
  }

  function installGridPhotoCopyMenu(doc, win) {
    if (!doc || gridCopyMenuStateByDocument.has(doc)) return;
    const state = { observer: null, timer: null, knownMenus: null };
    gridCopyMenuStateByDocument.set(doc, state);

    function clearPending() {
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      if (state.observer) state.observer.disconnect();
      state.observer = null;
      state.knownMenus = null;
    }

    function findOpenedMenu() {
      const menus = findPhotoContextMenus(doc);
      return (
        menus.find(function (menu) {
          return isVisibleMenu(menu) && (!state.knownMenus || !state.knownMenus.get(menu));
        }) || null
      );
    }

    function tryInstall() {
      const menu = findOpenedMenu();
      if (!menu) return;
      if (addGridDownloadMenuItem(doc, win, menu)) clearPending();
    }

    doc.addEventListener(
      'contextmenu',
      function () {
        clearPending();
        // Remember which menus were already on screen so a re-used popover is
        // not mistaken for a freshly opened one.
        state.knownMenus = new Map(
          findPhotoContextMenus(doc).map(function (menu) {
            return [menu, isVisibleMenu(menu)];
          })
        );
        const MutationObserverCtor = (win && win.MutationObserver) || root.MutationObserver;
        const rootNode = doc.documentElement || doc.body;
        if (typeof MutationObserverCtor === 'function' && rootNode) {
          state.observer = new MutationObserverCtor(function () {
            tryInstall();
          });
          state.observer.observe(rootNode, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
          });
        }
        tryInstall();
        state.timer = setTimeout(clearPending, 5000);
      },
      true
    );
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
    for (let i = 0; i < stack.length; i += 1) {
      const found = findPhotoImageInNode(stack[i], x, y);
      if (found) return found;
    }
    return null;
  }

  // The enlarged (OneUp) view swaps progressively larger derivatives into the
  // same <img>, so resolve the biggest one currently rendered for the centered
  // photo. Outside OneUp this returns null — the grid must keep using its own
  // pointer-based lookup.
  function resolveOneUpImage(doc) {
    if (!doc || typeof doc.querySelector !== 'function') return null;
    const scope =
      doc.querySelector('OneUpCarouselItem.is-center') ||
      doc.querySelector('OneUpCarouselItem') ||
      doc.querySelector('OneUp');
    if (!scope || typeof scope.querySelectorAll !== 'function') return null;
    const imgs = scope.querySelectorAll('img');
    let best = null;
    let bestEdge = 0;
    for (let i = 0; i < imgs.length; i += 1) {
      const img = imgs[i];
      const edge = Math.max(img.naturalWidth || img.width || 0, img.naturalHeight || img.height || 0);
      if (edge > bestEdge) {
        best = img;
        bestEdge = edge;
      }
    }
    return bestEdge >= 300 ? best : null;
  }

  async function copyCurrentOneUpImage(doc, win) {
    const image = resolveOneUpImage(doc);
    if (!image) {
      showCopyPhotoStatus(doc, '未找到大图，请等图片加载完成后再试', true);
      return;
    }
    const width = image.naturalWidth || image.width || 0;
    const height = image.naturalHeight || image.height || 0;
    try {
      const blob = await fetchCopyablePhotoImageBlob(image, win);
      const copied = await copyPhotoImageToClipboard(image, win, blob);
      showCopyPhotoStatus(
        doc,
        copied ? '已拷贝大图 ' + width + '×' + height : '浏览器不支持图像拷贝',
        !copied
      );
    } catch (error) {
      const detail = error && error.message ? error.message : '未知错误';
      showCopyPhotoStatus(doc, '拷贝大图失败：' + detail, true);
    }
  }

  function createOneUpCopyButton(doc, win) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute('data-icloud-oneup-copy', '');
    button.textContent = '拷贝大图';
    button.title = '把当前大图复制到剪贴板（Ctrl+C 也可以）';
    button.style.cssText = [
      'position:fixed',
      'left:16px',
      'bottom:16px',
      'z-index:2147483000',
      'padding:8px 14px',
      'border:0',
      'border-radius:8px',
      'background:rgba(28,28,30,.72)',
      'color:#fff',
      "font:13px/1.2 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif",
      'cursor:pointer',
      'pointer-events:auto',
    ].join(';');
    button.addEventListener(
      'click',
      function (event) {
        event.preventDefault();
        event.stopPropagation();
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
    const state = { button: null, observer: null, scheduled: false };
    oneUpCopyStateByDocument.set(doc, state);

    function sync() {
      state.scheduled = false;
      if (typeof doc.querySelector !== 'function') return;
      const inOneUp = Boolean(doc.querySelector('OneUpCarouselItem'));
      if (inOneUp && !state.button && doc.body && typeof doc.body.appendChild === 'function') {
        state.button = createOneUpCopyButton(doc, win);
        doc.body.appendChild(state.button);
      } else if (!inOneUp && state.button) {
        if (typeof state.button.remove === 'function') state.button.remove();
        else if (state.button.parentNode && typeof state.button.parentNode.removeChild === 'function') {
          state.button.parentNode.removeChild(state.button);
        }
        state.button = null;
      }
    }

    function schedule() {
      if (state.scheduled) return;
      state.scheduled = true;
      if (win && typeof win.setTimeout === 'function') win.setTimeout(sync, 150);
      else sync();
    }

    const MutationObserverCtor = (win && win.MutationObserver) || root.MutationObserver;
    if (typeof MutationObserverCtor === 'function' && doc.documentElement) {
      state.observer = new MutationObserverCtor(schedule);
      state.observer.observe(doc.documentElement, { childList: true, subtree: true });
    }
    sync();
  }

  function installGridPhotoKeyboardCopy(doc, win) {
    if (!doc || keyboardPhotoCopyStateByDocument.has(doc)) return;
    const state = { x: -1, y: -1, busy: false, hintShown: false };
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

    function copyPhotoUnderPointer(image) {
      state.busy = true;
      showCopyPhotoStatus(doc, '正在拷贝图像…');
      fetchCopyablePhotoImageBlob(image, win).then(function (blob) {
        return copyPhotoImageToClipboard(image, win, blob);
      }).then(function (copied) {
        showCopyPhotoStatus(doc, copied ? '图像已拷贝到剪贴板' : '浏览器不支持图像拷贝', !copied);
      }).catch(function (error) {
        const detail = error && error.message ? error.message : '未知错误';
        showCopyPhotoStatus(doc, '拷贝图像失败：' + detail, true);
      }).then(function () {
        state.busy = false;
      });
    }

    doc.addEventListener('mousemove', function (event) {
      state.x = typeof event.clientX === 'number' ? event.clientX : -1;
      state.y = typeof event.clientY === 'number' ? event.clientY : -1;
    }, true);

    doc.addEventListener('mouseover', function (event) {
      if (state.hintShown) return;
      const image = findGridPhotoImageAtPoint(doc, event.clientX, event.clientY);
      if (!image) return;
      state.hintShown = true;
      showCopyPhotoStatus(doc, '提示：鼠标悬停在照片上按 Ctrl+C 可拷贝图像');
    }, true);

    doc.addEventListener('keydown', function (event) {
      if (event.defaultPrevented || event.repeat) return;
      if (!isCopyShortcut(event)) return;
      if (isEditablePhotoCopyTarget(event.target)) return;
      if (hasTextSelection()) return;
      // In the enlarged view the pointer often rests on toolbars instead of the
      // photo, so fall back to the centered OneUp image there.
      const image = findPhotoUnderPointer() || resolveOneUpImage(doc);
      if (!image) return;
      // The real keystroke carries the user activation that the clipboard
      // write below depends on, so claim the event before the page sees it.
      event.preventDefault();
      event.stopPropagation();
      if (state.busy) return;
      copyPhotoUnderPointer(image);
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

  let zoomPanInstalled = false;

  function installImageZoomPan(doc, win) {
    if (zoomPanInstalled) return;
    zoomPanInstalled = true;

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
      savedTransition: '',
      savedCursor: '',
      savedWillChange: '',
      appliedInlineTransform: null,
      appliedTransition: null,
      appliedCursor: null,
      appliedWillChange: null,
      watchdogObserver: null,
      watchdogFrame: null,
      mediaSource: '',
      mediaObserver: null,
      mediaLoadHandler: null,
    };

    let zoomHintShown = false;

    function showZoomHint() {
      if (zoomHintShown) return;
      zoomHintShown = true;
      const panel = doc.getElementById ? doc.getElementById(PANEL_ID) : null;
      if (panel && typeof panel._showUploaderStatus === 'function') {
        panel._showUploaderStatus('滚轮缩放 · 拖动平移 · 双击或 Esc 复位');
      }
    }

    function getLargeMediaRect(el) {
      if (!el || !el.tagName) return null;
      const tag = el.tagName;
      if (tag !== 'IMG' && tag !== 'CANVAS' && tag !== 'VIDEO') return null;
      if (typeof el.getBoundingClientRect !== 'function') return null;
      const rect = el.getBoundingClientRect();
      return rect.width >= MIN_PREVIEW_PX && rect.height >= MIN_PREVIEW_PX ? rect : null;
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
      return best;
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
      const rect = state.zoomTarget.getBoundingClientRect();
      state.baseWidth = rect.width;
      state.baseHeight = rect.height;
      state.savedInlineTransform = state.zoomTarget.style.transform || '';
      state.baseTransform = readCurrentTransform(state.zoomTarget);
      state.savedTransition = state.zoomTarget.style.transition || '';
      state.savedCursor = state.zoomTarget.style.cursor || '';
      state.savedWillChange = state.zoomTarget.style.willChange || '';

      setOwnedInlineStyle('transition', 'none', 'appliedTransition');
      setOwnedInlineStyle('willChange', 'transform', 'appliedWillChange');
      startWatchdog();
    }

    function detach() {
      stopWatchdog();
      if (state.zoomTarget) {
        // Restore only values the script still owns. React may reuse this wrapper
        // for the next photo and write its own inline state before observers run.
        const style = state.zoomTarget.style;
        restoreOwnedInlineStyle(
          style, 'transform', state.appliedInlineTransform, state.savedInlineTransform
        );
        restoreOwnedInlineStyle(
          style, 'transition', state.appliedTransition, state.savedTransition
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
      state.appliedTransition = null;
      state.appliedCursor = null;
      state.appliedWillChange = null;
      resetView();
    }

    function expectedTransform() {
      const relative =
        'translate(' + state.tx + 'px, ' + state.ty + 'px) scale(' + state.scale + ')';
      return state.baseTransform ? relative + ' ' + state.baseTransform : relative;
    }

    function clampTranslation() {
      const limit = calculatePanLimits(state.baseWidth, state.baseHeight, state.scale);
      state.tx = Math.max(-limit.x, Math.min(limit.x, state.tx));
      state.ty = Math.max(-limit.y, Math.min(limit.y, state.ty));
    }

    function applyTransform() {
      if (!state.zoomTarget) return;
      setOwnedInlineStyle('transform', expectedTransform(), 'appliedInlineTransform');
      setOwnedInlineStyle(
        'cursor',
        state.scale > 1 ? (state.dragging ? 'grabbing' : 'grab') : state.savedCursor,
        'appliedCursor'
      );
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

      const observeTarget = doc.body || doc.documentElement;
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

      const rect = img.getBoundingClientRect();
      const px = event.clientX - rect.left - rect.width / 2;
      const py = event.clientY - rect.top - rect.height / 2;
      const delta = -event.deltaY;
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

      const scaleRatio = newScale / state.scale;
      const translation = calculateZoomTranslation({
        tx: state.tx,
        ty: state.ty,
        pointerOffsetX: px,
        pointerOffsetY: py,
        scaleRatio,
      });
      state.tx = translation.tx;
      state.ty = translation.ty;
      state.scale = newScale;
      if (state.scale <= MIN_SCALE + 0.001) {
        debugLog('detach (back to 1x)');
        detach();
        return;
      }
      clampTranslation();
      showZoomHint();
      debugLog('scale=', state.scale.toFixed(2), 'tag=', img.tagName, 'size=', Math.round(rect.width) + 'x' + Math.round(rect.height));
      applyTransform();
    }

    function onMouseDown(event) {
      if (event.button !== 0) return;
      if (!state.zoomTarget || state.scale <= MIN_SCALE) return;
      const rect = state.zoomTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) {
        return;
      }
      state.dragging = true;
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.origTx = state.tx;
      state.origTy = state.ty;
      setOwnedInlineStyle('cursor', 'grabbing', 'appliedCursor');
      event.preventDefault();
      event.stopPropagation();
    }

    function onMouseMove(event) {
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

    function endDrag() {
      if (!state.dragging) return;
      state.dragging = false;
      if (state.zoomTarget) setOwnedInlineStyle('cursor', 'grab', 'appliedCursor');
    }

    function onDoubleClick(event) {
      if (!state.element) return;
      if (event.target && state.zoomTarget && typeof state.zoomTarget.contains === 'function' &&
          !state.zoomTarget.contains(event.target)) {
        return;
      }
      event.preventDefault();
      detach();
    }

    function onKeyDown(event) {
      if (!state.element) return;
      // Only claim the reset keys when the user is not typing or invoking a
      // browser/OS shortcut.
      const target = event.target;
      if (target && typeof target.matches === 'function') {
        try {
          if (target.matches('input, textarea, select, [contenteditable]')) return;
        } catch (error) {
          // ignore selector errors and continue
        }
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
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
      target.addEventListener('dblclick', onDoubleClick, true);
      target.addEventListener('keydown', onKeyDown, true);
    });
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

  function observeAndRemount(doc, win) {
    const MutationObserverCtor = (win && win.MutationObserver) || root.MutationObserver;
    if (typeof MutationObserverCtor !== 'function') return;

    let observed = null;
    let reattachTimer = null;

    const observer = new MutationObserverCtor(function () {
      const panel = doc.getElementById(PANEL_ID);
      if (panel && panel.isConnected) {
        // React can replace the subtree the panel lives in (not just body's
        // direct children), so track whichever parent currently holds it.
        if (observed !== panel.parentNode) {
          observed = panel.parentNode;
          if (observed) observer.observe(observed, { childList: true, subtree: false });
        }
        return;
      }
      try {
        const remounted = createPanel(doc, win);
        observed = remounted && remounted.parentNode;
        if (observed) observer.observe(observed, { childList: true, subtree: false });
      } catch (error) {
        console.warn(LOG_PREFIX, 'Remount failed:', error && error.message ? error.message : error);
      }
      // Swapping out the subtree can drop our document-level listeners too;
      // re-assert them, which is idempotent thanks to the handler marker.
      if (reattachTimer) clearTimeout(reattachTimer);
      reattachTimer = setTimeout(function () {
        reattachTimer = null;
        installPasteListener(doc, win);
      }, 200);
    });

    const target = (doc.getElementById(PANEL_ID) || {}).parentNode || doc.body || doc.documentElement;
    if (target) {
      observed = target;
      observer.observe(target, { childList: true, subtree: false });
    }
  }

  function mountPanel(doc, win) {
    createPanel(doc, win);
    installPasteListener(doc, win);
    installGridPhotoCopyMenu(doc, win);
    installGridPhotoKeyboardCopy(doc, win);
    installOneUpCopyButton(doc, win);
    installImageZoomPan(doc, win);
    observeAndRemount(doc, win);
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
