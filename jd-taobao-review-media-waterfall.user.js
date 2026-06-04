// ==UserScript==
// @name         京东/淘宝评价图片墙
// @namespace    https://github.com/hahapkpk/tools
// @version      0.4.5
// @description  将京东和淘宝/天猫评价图视频以纵向滚动图片墙展示。
// @match        https://item.jd.com/*
// @match        https://detail.tmall.com/*
// @match        https://item.taobao.com/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/jd-taobao-review-media-waterfall.user.js
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/jd-taobao-review-media-waterfall.user.js
// ==/UserScript==

(function (root, factory) {
  'use strict';

  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  api.init();
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function detectSite(href) {
    if (/^https:\/\/item\.jd\.com\//.test(href)) return 'jd';
    if (/^https:\/\/(?:detail\.tmall|item\.taobao)\.com\//.test(href)) return 'taobao';
    return null;
  }

  function createMediaStore() {
    let media = [];
    const keyed = (item) => item.src || item.poster || '';

    function unique(items) {
      const seen = new Set();
      return items.filter((item) => {
        const key = keyed(item);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    return {
      replace(items) {
        media = unique(items);
      },
      append(items) {
        media = unique(media.concat(items));
      },
      items() {
        return media.slice();
      }
    };
  }

  function filterMedia(items, filter) {
    return filter === 'all' ? items.slice() : items.filter((item) => item.type === filter);
  }

  const STORAGE_KEYS = {
    cardSize: 'reviewMediaWall.cardSize',
    contextWidth: 'reviewMediaWall.contextWidth'
  };
  const CARD_SIZES = new Set(['small', 'medium', 'large']);
  const DEFAULT_CONTEXT_WIDTH = 420;
  const MIN_CONTEXT_WIDTH = 320;
  const MAX_CONTEXT_WIDTH = 700;
  const preloadedPreviewMedia = new Set();

  function clampContextWidth(value) {
    return Math.max(MIN_CONTEXT_WIDTH, Math.min(MAX_CONTEXT_WIDTH, Math.round(Number(value) || DEFAULT_CONTEXT_WIDTH)));
  }

  function contextWidthKey(site) {
    return `${STORAGE_KEYS.contextWidth}.${site || 'shared'}`;
  }

  function readStoredContextWidth(storage, site) {
    try {
      return clampContextWidth(storage?.getItem(contextWidthKey(site)));
    } catch (error) {
      return DEFAULT_CONTEXT_WIDTH;
    }
  }

  function writeStoredContextWidth(storage, site, value) {
    try {
      storage?.setItem(contextWidthKey(site), String(value));
    } catch (error) {
      return undefined;
    }
    return undefined;
  }

  function readStoredCardSize(storage) {
    try {
      const value = storage?.getItem(STORAGE_KEYS.cardSize);
      return CARD_SIZES.has(value) ? value : '';
    } catch (error) {
      return '';
    }
  }

  function writeStoredCardSize(storage, value) {
    try {
      storage?.setItem(STORAGE_KEYS.cardSize, value);
    } catch (error) {
      return undefined;
    }
    return undefined;
  }

  function createWallSession(storage = root.localStorage, site = 'shared') {
    const saved = {
      mediaFilter: 'all',
      cardSize: readStoredCardSize(storage) || 'medium',
      scrollTop: 0,
      previewKey: '',
      contextCollapsed: false,
      contextWidth: readStoredContextWidth(storage, site),
      loadingState: 'idle',
      stagnantLoads: 0
    };
    return {
      setFilter(value) {
        saved.mediaFilter = value;
      },
      setCardSize(value) {
        if (!CARD_SIZES.has(value)) return;
        saved.cardSize = value;
        writeStoredCardSize(storage, value);
      },
      toggleContext() {
        saved.contextCollapsed = !saved.contextCollapsed;
      },
      setContextWidth(value) {
        saved.contextWidth = clampContextWidth(value);
        writeStoredContextWidth(storage, site, saved.contextWidth);
      },
      resetContextWidth() {
        saved.contextWidth = DEFAULT_CONTEXT_WIDTH;
        writeStoredContextWidth(storage, site, saved.contextWidth);
      },
      rememberView({ scrollTop, previewKey }) {
        if (Number.isFinite(scrollTop)) saved.scrollTop = scrollTop;
        if (typeof previewKey === 'string') saved.previewKey = previewKey;
      },
      beginLoad() {
        if (saved.loadingState === 'loading' || saved.loadingState === 'exhausted') return false;
        saved.loadingState = 'loading';
        return true;
      },
      finishLoad(added) {
        if (added) {
          saved.stagnantLoads = 0;
          saved.loadingState = 'idle';
          return;
        }
        saved.stagnantLoads += 1;
        saved.loadingState = saved.stagnantLoads >= 2 ? 'exhausted' : 'idle';
      },
      failLoad() {
        saved.loadingState = 'error';
      },
      retryLoad() {
        saved.loadingState = 'idle';
        saved.stagnantLoads = 0;
      },
      snapshot() {
        return { ...saved };
      }
    };
  }

  function getMediaSource(element) {
    return element.currentSrc || element.src || element.getAttribute?.('src') || '';
  }

  function preloadPreviewMedia(item) {
    if (!item?.src || item.type !== 'image' || preloadedPreviewMedia.has(item.src) || !root.Image) return;
    preloadedPreviewMedia.add(item.src);
    const image = new root.Image();
    image.decoding = 'async';
    image.src = item.src;
  }

  function preloadPreviewAround(items, index) {
    [index, index + 1, index - 1].forEach((position) => preloadPreviewMedia(items[position]));
  }

  function absoluteMediaUrl(url) {
    if (!url) return '';
    return url.startsWith('//') ? `https:${url}` : url;
  }

  function getTaobaoCommentState(element) {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = fiberKey ? element[fiberKey] : null;
    for (let depth = 0; fiber && depth < 7; depth += 1, fiber = fiber.return) {
      if (fiber.memoizedProps?.comment?.reviewInfo) return fiber.memoizedProps.comment;
    }
    return null;
  }

  function getReactProps(element, predicate) {
    const fiberKey = element && Object.keys(element).find((key) => key.startsWith('__reactFiber'));
    let fiber = fiberKey ? element[fiberKey] : null;
    for (let depth = 0; fiber && depth < 12; depth += 1, fiber = fiber.return) {
      if (predicate(fiber.memoizedProps || {})) return fiber.memoizedProps;
    }
    return null;
  }

  function getTaobaoMeta(review) {
    const sku = review.skuText;
    const skuText = typeof sku === 'object' && sku
      ? Object.values(sku).filter(Boolean).join(' ')
      : (sku || '');
    return [review.reviewInfo?.date, skuText].filter(Boolean).join(' ');
  }

  function appendTaobaoReviewMedia(items, review) {
    const info = review?.reviewInfo;
    if (!info) return;
    const text = (info.content || '').trim().replace(/\s+/g, ' ');
    const meta = getTaobaoMeta(review);
    (info.picList || []).forEach((src) => {
      items.push({ type: 'image', src: absoluteMediaUrl(src), poster: '', text, meta });
    });
    (info.videoList || []).forEach((video) => {
      const src = absoluteMediaUrl(typeof video === 'string' ? video : (video.url || video.videoUrl || video.playUrl));
      const poster = absoluteMediaUrl(typeof video === 'object' ? (video.cover || video.coverUrl || '') : '');
      if (src) items.push({ type: 'video', src, poster, text, meta });
    });
  }

  function collectFromTaobaoGallery(nativeRoot) {
    if (!nativeRoot) return [];
    const item = nativeRoot.querySelectorAll('[class*="commentsImgItem--"]')[0];
    const props = getReactProps(item, (value) => Array.isArray(value.reviews));
    if (!props) return [];
    const items = [];
    props.reviews.forEach((review) => appendTaobaoReviewMedia(items, review));
    return items;
  }

  function collectFromAlbums(nativeRoot) {
    if (!nativeRoot) return [];
    const galleryItems = collectFromTaobaoGallery(nativeRoot);
    if (galleryItems.length) return galleryItems;
    const items = [];
    const comments = nativeRoot.querySelectorAll('[class*="Comment--"]');
    comments.forEach((comment) => {
      const state = getTaobaoCommentState(comment);
      const text = (state?.reviewInfo?.content || comment.innerText || '').trim().replace(/\s+/g, ' ');
      const meta = state ? getTaobaoMeta(state) : '';
      const pictures = state?.reviewInfo?.picList || [];
      const videos = state?.reviewInfo?.videoList || [];
      if (pictures.length || videos.length) {
        pictures.forEach((src) => {
          items.push({ type: 'image', src: absoluteMediaUrl(src), poster: '', text, meta });
        });
        videos.forEach((video) => {
          const src = absoluteMediaUrl(typeof video === 'string' ? video : (video.url || video.videoUrl || video.playUrl));
          const poster = absoluteMediaUrl(typeof video === 'object' ? (video.cover || video.coverUrl || '') : '');
          if (src) items.push({ type: 'video', src, poster, text, meta });
        });
        return;
      }
      comment.querySelectorAll('[class*="album--"] img').forEach((img) => {
        const src = absoluteMediaUrl(getMediaSource(img));
        if (!src || !/rate|uploaded/i.test(src)) return;
        items.push({ type: 'image', src, poster: '', text, meta });
      });
    });
    return items;
  }

  function collectJdPayloadMedia(payload) {
    const items = [];
    const visited = new Set();
    const processed = new Set();

    function addComment(info) {
      if (!info || processed.has(info) || !Array.isArray(info.pictureInfoList)) return;
      processed.add(info);
      const text = String(info.commentData || '').trim().replace(/\s+/g, ' ');
      const meta = [info.newCommentDate, info.productSpecifications].filter(Boolean).join(' ');
      info.pictureInfoList.forEach((media) => {
        const poster = absoluteMediaUrl(media.picURL || media.coverUrl || '');
        const videoSrc = absoluteMediaUrl(media.videoPlayUrl || media.videoUrl || media.playUrl || '');
        const imageSrc = absoluteMediaUrl(media.largePicURL || media.picURL || '');
        if (String(media.mediaType) === '2' && videoSrc) {
          items.push({ type: 'video', src: videoSrc, poster, text, meta });
        } else if (imageSrc) {
          items.push({ type: 'image', src: imageSrc, poster, text, meta });
        }
      });
    }

    function visit(value) {
      if (!value || typeof value !== 'object' || visited.has(value)) return;
      visited.add(value);
      addComment(value.commentInfo || value);
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else {
        Object.values(value).forEach(visit);
      }
    }
    visit(payload);
    return items;
  }

  function installJdResponseCapture(host, onMedia) {
    if (!host || !onMedia) return () => {};
    const captureKey = '__reviewMediaWallJdResponseCapture';
    let capture = host[captureKey];
    if (!capture) {
      capture = { listeners: new Set() };
      capture.emit = (payload) => {
        const items = collectJdPayloadMedia(payload);
        if (items.length) capture.listeners.forEach((listener) => listener(items));
      };
      host[captureKey] = capture;

      const XHR = host.XMLHttpRequest;
      if (XHR?.prototype) {
        const originalOpen = XHR.prototype.open;
        const originalSend = XHR.prototype.send;
        XHR.prototype.open = function open(method, url, ...args) {
          this.__rmwJdResponseUrl = String(url || '');
          return originalOpen.call(this, method, url, ...args);
        };
        XHR.prototype.send = function send(...args) {
          if (/api\.m\.jd\.com\/client\.action/.test(this.__rmwJdResponseUrl || '')) {
            this.addEventListener('load', () => {
              try {
                capture.emit(JSON.parse(this.responseText));
              } catch (error) {
                return undefined;
              }
              return undefined;
            }, { once: true });
          }
          return originalSend.apply(this, args);
        };
      }

      if (typeof host.fetch === 'function') {
        const originalFetch = host.fetch;
        host.fetch = function fetch(input, ...args) {
          const url = String(typeof input === 'string' ? input : input?.url || '');
          return originalFetch.call(this, input, ...args).then((response) => {
            if (/api\.m\.jd\.com\/client\.action/.test(url)) {
              response.clone().json().then((payload) => capture.emit(payload)).catch(() => {});
            }
            return response;
          });
        };
      }
    }
    capture.listeners.add(onMedia);
    return () => capture.listeners.delete(onMedia);
  }

  function collectJdMedia(nativeRoot) {
    if (!nativeRoot) return [];
    return Array.from(nativeRoot.querySelectorAll(
      'img[src*="shaidan"], img[src*="s300x300"], img[src*="s1440x1440"], video'
    )).map((media) => {
      const isVideo = String(media.tagName || '').toUpperCase() === 'VIDEO';
      const src = isVideo ? (media.currentSrc || media.src || '') : getMediaSource(media);
      if (!src) return null;
      const review = media.closest?.('[class*="comment"], [class*="rate"]');
      return {
        type: isVideo ? 'video' : 'image',
        src,
        poster: media.poster || '',
        text: (review?.innerText || '').trim().replace(/\s+/g, ' '),
        meta: ''
      };
    }).filter(Boolean);
  }

  function clickText(nativeRoot, text) {
    if (!nativeRoot) return false;
    const matches = Array.from(nativeRoot.querySelectorAll('*')).filter((element) => {
      const value = (element.textContent || element.innerText || '').trim();
      return value === text || value.startsWith(text);
    });
    const target = matches.find((element) => /(?:imprItem|_tag(?:_|-))/i.test(String(element.className || '')))
      || matches.find((element) => element.children.length === 0)
      || matches[0];
    if (!target) return false;
    if (/(?:isSelected|active|selected|tag-active)/i.test(String(target.className || target.parentElement?.className || ''))) {
      return true;
    }
    target.click();
    return true;
  }

  const adapters = {
    jd: {
      findMount(doc) {
        return doc.querySelector('.left-tabs-nav');
      },
      findNativeRoot(doc) {
        return doc.querySelector('#rateList');
      },
      observeResponses(onMedia) {
        return installJdResponseCapture(root, onMedia);
      },
      openNativeReviews(doc) {
        const button = doc.querySelector('.all-btn');
        if (button) button.click();
      },
      closeNativeReviews(nativeRoot) {
        nativeRoot?.querySelector('[class*="_closeIcon_"]')?.click();
      },
      selectMedia(nativeRoot) {
        return clickText(nativeRoot, '图/视频');
      },
      collectMedia: collectJdMedia
    },
    taobao: {
      allowPageFallback: true,
      findMount(doc) {
        return doc.querySelector('[class*="tabTitleList--"]') || doc.querySelector('[class*="Comments--"]');
      },
      findNativeRoot(doc) {
        const drawers = doc.querySelectorAll('[class*="Drawer--"]');
        return drawers[drawers.length - 1] || null;
      },
      openNativeReviews(doc) {
        const button = doc.querySelector('[class*="ShowButton--"]');
        if (button) button.click();
      },
      closeNativeReviews(nativeRoot) {
        nativeRoot?.querySelector('[class*="closeWrap--"]')?.click();
      },
      selectMedia(nativeRoot) {
        return clickText(nativeRoot, '图/视频');
      },
      collectMedia: collectFromAlbums
    }
  };

  function collectWithFallback(adapter, nativeRoot, doc) {
    const items = adapter.collectMedia(nativeRoot);
    if (items.length || !adapter.allowPageFallback) return items;
    return adapter.collectMedia(doc);
  }

  const IDS = {
    launcher: 'review-media-wall-launcher',
    backdrop: 'review-media-wall-backdrop',
    modal: 'review-media-wall-modal',
    grid: 'review-media-wall-grid',
    preview: 'review-media-wall-preview'
  };

  function createWallState() {
    let wallOpen = false;
    let preview = null;
    let previewItems = [];
    let previewIndex = -1;
    function clearPreview() {
      preview = null;
      previewItems = [];
      previewIndex = -1;
    }
    return {
      openWall() {
        wallOpen = true;
      },
      closeWall() {
        wallOpen = false;
        clearPreview();
      },
      openPreview(items, index) {
        previewItems = Array.isArray(items) ? items : [items];
        previewIndex = Math.max(0, Math.min(Number(index) || 0, previewItems.length - 1));
        preview = previewItems[previewIndex] || null;
      },
      shiftPreview(delta) {
        if (!preview) return;
        previewIndex = Math.max(0, Math.min(previewIndex + delta, previewItems.length - 1));
        preview = previewItems[previewIndex] || null;
      },
      onBackdrop() {
        if (preview) {
          clearPreview();
        } else {
          wallOpen = false;
        }
      },
      snapshot() {
        return {
          wallOpen,
          preview,
          previewIndex,
          previewPosition: preview ? previewIndex + 1 : 0,
          previewTotal: previewItems.length,
          canPrevious: previewIndex > 0,
          canNext: previewIndex >= 0 && previewIndex < previewItems.length - 1
        };
      }
    };
  }

  function ensureLauncher(mount, onOpen) {
    if (!mount) return null;
    const existing = mount.querySelector(`#${IDS.launcher}`);
    if (existing) return existing;
    const launcher = mount.ownerDocument.createElement('button');
    launcher.id = IDS.launcher;
    launcher.className = 'review-media-wall-launcher';
    launcher.type = 'button';
    launcher.textContent = '图片墙';
    launcher.addEventListener('click', onOpen);
    mount.appendChild(launcher);
    return launcher;
  }

  function createWallController(adapter) {
    const store = createMediaStore();
    return {
      replace(items) {
        store.replace(items);
      },
      append(items) {
        store.append(items);
      },
      items() {
        return store.items();
      },
      onFilterChanged(nativeRoot) {
        store.replace(adapter.collectMedia(nativeRoot));
        return store.items();
      },
      appendFrom(nativeRoot) {
        store.append(adapter.collectMedia(nativeRoot));
        return store.items();
      }
    };
  }

  function makeElement(doc, tagName, className, text) {
    const element = doc.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function addStyles(doc) {
    const style = doc.getElementById('review-media-wall-style') || doc.createElement('style');
    style.id = 'review-media-wall-style';
    style.textContent = `
#${IDS.launcher} { display:inline-flex; align-items:center; height:100%; padding:0 22px; border:0; background:transparent; color:#111; font-size:16px; font-weight:600; cursor:pointer; }
#${IDS.launcher}:hover { color:#e1251b; }
#${IDS.backdrop} { position:fixed; inset:0; z-index:2147483000; display:flex; align-items:center; justify-content:center; background:rgba(32,33,36,.42); }
#${IDS.modal} { position:relative; display:flex; flex-direction:column; width:min(1460px,94vw); height:min(92vh,1020px); border-radius:28px; overflow:hidden; background:#fff; box-shadow:0 1px 3px rgba(60,64,67,.30), 0 8px 24px rgba(60,64,67,.15); }
.rmw-toolbar { display:flex; align-items:center; gap:12px; padding:16px 20px 12px; background:#fff; border-bottom:1px solid #edf0f3; }
.rmw-group { display:flex; gap:8px; }
.rmw-filter, .rmw-size, .rmw-sync, .rmw-close { height:36px; padding:0 14px; border:1px solid #dadce0; border-radius:999px; background:#fff; color:#3c4043; cursor:pointer; font-size:14px; line-height:34px; transition:background .14s ease, border-color .14s ease, box-shadow .14s ease, color .14s ease; }
.rmw-filter:hover, .rmw-size:hover, .rmw-sync:hover, .rmw-close:hover { background:#f8fafd; border-color:#c9d7f1; box-shadow:0 1px 2px rgba(60,64,67,.12); }
.rmw-filter.is-active, .rmw-size.is-active { border-color:#1a73e8; color:#1a73e8; background:#e8f0fe; }
.rmw-loaded { margin-left:auto; color:#5f6368; font-size:13px; white-space:nowrap; }
.rmw-sync { color:#1a73e8; }
.rmw-close { width:36px; padding:0; border-color:transparent; color:#5f6368; font-size:24px; line-height:30px; }
#${IDS.grid} { flex:1; display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); align-content:start; gap:14px; overflow-y:auto; overflow-x:hidden; padding:18px 20px 30px; background:#fff; }
.rmw-size-small { grid-template-columns:repeat(6,minmax(0,1fr)) !important; }
.rmw-size-medium { grid-template-columns:repeat(5,minmax(0,1fr)) !important; }
.rmw-size-large { grid-template-columns:repeat(4,minmax(0,1fr)) !important; }
.rmw-card { position:relative; border-radius:18px; overflow:hidden; background:#f1f3f4; cursor:zoom-in; outline:none; transition:box-shadow .16s ease, transform .16s ease; }
.rmw-card:focus-visible { box-shadow:0 0 0 3px #1a73e8; }
.rmw-card.rmw-current { box-shadow:0 0 0 4px #1a73e8; transform:scale(.985); }
.rmw-card::before { content:''; display:block; padding-top:100%; }
.rmw-card img, .rmw-card video { position:absolute; inset:0; display:block; width:100%; height:100%; object-fit:cover; }
.rmw-play { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); border-radius:50%; width:50px; height:50px; display:grid; place-items:center; background:rgba(0,0,0,.58); color:white; font-size:23px; }
.rmw-status { grid-column:1 / -1; padding:26px 16px; text-align:center; color:#777; font-size:14px; }
.rmw-retry { margin-left:12px; height:32px; padding:0 15px; border:1px solid #e1251b; border-radius:16px; background:#fff; color:#e1251b; cursor:pointer; }
#${IDS.preview} { position:absolute; inset:0; z-index:2; display:flex; align-items:center; justify-content:center; padding:34px; background:rgba(0,0,0,.82); }
.rmw-preview-content { display:flex; max-width:min(1280px,90vw); max-height:86vh; border-radius:12px; overflow:hidden; background:#111; }
.rmw-preview-content.is-collapsed .rmw-context { display:none; }
.rmw-preview-media { position:relative; display:flex; align-items:center; justify-content:center; min-width:300px; max-width:min(900px,68vw); background:#000; }
.rmw-preview-content.is-collapsed .rmw-preview-media { max-width:min(1240px,86vw); }
.rmw-preview-media img, .rmw-preview-media video { max-width:100%; max-height:84vh; object-fit:contain; }
.rmw-counter { position:absolute; top:14px; left:50%; transform:translateX(-50%); padding:6px 14px; border-radius:18px; background:rgba(0,0,0,.58); color:#fff; font-size:14px; }
.rmw-preview-tools { position:absolute; top:12px; right:12px; z-index:2; display:flex; gap:8px; }
.rmw-preview-nav { position:absolute; top:50%; z-index:1; transform:translateY(-50%); width:52px; height:72px; border:0; border-radius:28px; background:rgba(0,0,0,.5); color:#fff; font-size:36px; line-height:1; cursor:pointer; }
.rmw-preview-nav:hover { background:rgba(0,0,0,.72); }
.rmw-preview-prev { left:18px; }
.rmw-preview-next { right:18px; }
.rmw-context-resizer { position:relative; flex:0 0 10px; width:10px; background:#f1f3f4; cursor:col-resize; touch-action:none; }
.rmw-context-resizer::after { content:''; position:absolute; left:3px; top:50%; width:4px; height:48px; border-radius:3px; background:#c4c7c5; transform:translateY(-50%); transition:background .15s ease, height .15s ease; }
.rmw-context-resizer:hover::after, .rmw-context-resizer.is-dragging::after { height:72px; background:#1a73e8; }
.rmw-context { box-sizing:border-box; flex:0 0 auto; width:420px; min-width:320px; max-width:700px; padding:38px 40px; background:#fff; color:#202124; overflow:auto; }
.rmw-context-title { margin:0 0 26px; font-size:30px; line-height:1.22; font-weight:700; letter-spacing:-.025em; color:#202124; }
.rmw-context-label { display:block; margin:0 0 10px; font-size:14px; line-height:1.4; font-weight:700; letter-spacing:.08em; color:#1a73e8; }
.rmw-context-text { margin:0; font-size:20px; line-height:1.9; font-weight:400; color:#202124; white-space:pre-wrap; overflow-wrap:anywhere; }
.rmw-context-meta { margin:22px 0 0; padding-top:18px; border-top:1px solid #edf0f3; font-size:17px; line-height:1.75; color:#5f6368; overflow-wrap:anywhere; }
.rmw-context-toggle, .rmw-media-action { display:inline-flex; align-items:center; height:32px; margin:0 8px 12px 0; padding:0 12px; border:1px solid #ddd; border-radius:17px; background:#fff; color:#333; cursor:pointer; text-decoration:none; font-size:13px; }
.rmw-preview-tools .rmw-context-toggle, .rmw-preview-tools .rmw-media-action { margin:0; }
@media (max-width:1100px) { #${IDS.grid} { grid-template-columns:repeat(4,minmax(0,1fr)); } }
@media (max-width:900px) { #${IDS.grid} { grid-template-columns:repeat(3,minmax(0,1fr)); } }
@media (max-width:760px) { #${IDS.grid} { grid-template-columns:repeat(2,minmax(0,1fr)); } .rmw-preview-content { flex-direction:column; } .rmw-context-resizer { display:none; } .rmw-context { width:auto !important; min-width:0; max-width:none; } }
`;
    if (!style.parentNode) doc.head.appendChild(style);
  }

  function renderPreview(doc, modal, state, session, onReturn) {
    const previous = doc.getElementById(IDS.preview);
    if (previous) previous.remove();
    const snapshot = state.snapshot();
    const item = snapshot.preview;
    if (!item) return;

    const sessionSnapshot = session.snapshot();
    const overlay = makeElement(doc, 'div', '', '');
    overlay.id = IDS.preview;
    overlay.tabIndex = -1;
    const content = makeElement(doc, 'div', `rmw-preview-content${sessionSnapshot.contextCollapsed ? ' is-collapsed' : ''}`, '');
    const mediaBox = makeElement(doc, 'div', 'rmw-preview-media', '');
    mediaBox.appendChild(makeElement(doc, 'span', 'rmw-counter', `${snapshot.previewPosition} / ${snapshot.previewTotal}`));
    const media = doc.createElement(item.type === 'video' ? 'video' : 'img');
    if (media.tagName === 'IMG') {
      const previewSrc = item.poster || item.src;
      media.decoding = 'async';
      media.src = previewSrc;
      if (item.src && item.src !== previewSrc && root.Image) {
        const fullImage = new root.Image();
        fullImage.decoding = 'async';
        fullImage.onload = () => { media.src = item.src; };
        fullImage.src = item.src;
      }
    } else {
      media.src = item.src;
    }
    if (item.type === 'video') {
      media.controls = true;
      media.autoplay = true;
      if (item.poster) media.poster = item.poster;
    }
    mediaBox.appendChild(media);
    const resizer = makeElement(doc, 'div', 'rmw-context-resizer', '');
    resizer.title = '拖动调整评价区域宽度，双击恢复默认宽度';
    const context = makeElement(doc, 'aside', 'rmw-context', '');
    context.style.width = `${sessionSnapshot.contextWidth}px`;
    context.appendChild(makeElement(doc, 'h3', 'rmw-context-title', item.type === 'video' ? '视频评价' : '图片评价'));
    context.appendChild(makeElement(doc, 'span', 'rmw-context-label', '评价内容'));
    const tools = makeElement(doc, 'div', 'rmw-preview-tools', '');
    const toggle = makeElement(doc, 'button', 'rmw-context-toggle', sessionSnapshot.contextCollapsed ? '展开评价' : '收起评价');
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      session.toggleContext();
      renderPreview(doc, modal, state, session, onReturn);
    });
    const original = makeElement(doc, 'a', 'rmw-media-action', '打开原图');
    original.href = item.src;
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    const download = makeElement(doc, 'a', 'rmw-media-action', '下载原图');
    download.href = item.src;
    download.download = '';
    tools.append(toggle, original, download);
    mediaBox.appendChild(tools);
    context.appendChild(makeElement(doc, 'p', 'rmw-context-text', item.text || '该媒体暂无可见评价文字。'));
    if (item.meta) {
      context.appendChild(makeElement(doc, 'span', 'rmw-context-label rmw-context-meta-label', '购买信息'));
      context.appendChild(makeElement(doc, 'p', 'rmw-context-meta', item.meta));
    }
    let pendingWidth = sessionSnapshot.contextWidth;
    let resizing = false;
    function finishResize() {
      if (!resizing) return;
      resizing = false;
      resizer.classList.remove('is-dragging');
      root.removeEventListener('pointermove', moveResize);
      root.removeEventListener('pointerup', finishResize);
      root.removeEventListener('pointercancel', finishResize);
      const width = pendingWidth;
      session.setContextWidth(width);
    }
    function moveResize(event) {
      if (!resizing) return;
      const bounds = content.getBoundingClientRect();
      pendingWidth = clampContextWidth(bounds.right - event.clientX);
      context.style.width = `${pendingWidth}px`;
    }
    resizer.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      resizing = true;
      resizer.classList.add('is-dragging');
      try {
        resizer.setPointerCapture(event.pointerId);
      } catch (error) {
        // Window-level listeners below keep dragging working when pointer capture is unavailable.
      }
      root.addEventListener('pointermove', moveResize);
      root.addEventListener('pointerup', finishResize);
      root.addEventListener('pointercancel', finishResize);
    });
    resizer.addEventListener('dblclick', () => {
      session.resetContextWidth();
      context.style.width = `${session.snapshot().contextWidth}px`;
    });
    content.append(mediaBox, resizer, context);
    overlay.appendChild(content);
    function shift(delta) {
      state.shiftPreview(delta);
      session.rememberView({ previewKey: state.snapshot().preview?.src || '' });
      renderPreview(doc, modal, state, session, onReturn);
    }
    if (snapshot.canPrevious) {
      const previousButton = makeElement(doc, 'button', 'rmw-preview-nav rmw-preview-prev', '‹');
      previousButton.type = 'button';
      previousButton.setAttribute('aria-label', '上一张');
      previousButton.addEventListener('click', () => shift(-1));
      overlay.appendChild(previousButton);
    }
    if (snapshot.canNext) {
      const nextButton = makeElement(doc, 'button', 'rmw-preview-nav rmw-preview-next', '›');
      nextButton.type = 'button';
      nextButton.setAttribute('aria-label', '下一张');
      nextButton.addEventListener('click', () => shift(1));
      overlay.appendChild(nextButton);
    }
    overlay.addEventListener('pointerdown', (event) => {
      if (event.target !== overlay) return;
      event.preventDefault();
      state.onBackdrop();
      renderPreview(doc, modal, state, session, onReturn);
      onReturn();
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft' && state.snapshot().canPrevious) shift(-1);
      if (event.key === 'ArrowRight' && state.snapshot().canNext) shift(1);
      if (event.key === 'Escape') {
        state.onBackdrop();
        renderPreview(doc, modal, state, session, onReturn);
        onReturn();
      }
    });
    modal.appendChild(overlay);
    overlay.focus();
  }

  function sizeGridCards(grid) {
    grid.querySelectorAll('.rmw-card').forEach((card) => {
      const width = card.getBoundingClientRect().width;
      if (width > 0) card.style.height = `${Math.round(width)}px`;
    });
  }

  function statusMessage(session, total) {
    const status = session.snapshot().loadingState;
    if (status === 'loading') return `已加载 ${total} 项，正在加载更多...`;
    if (status === 'exhausted') return `已加载 ${total} 项，没有更多内容`;
    if (status === 'error') return `已加载 ${total} 项，加载失败`;
    return `已加载 ${total} 项，继续向下滚动以加载更多`;
  }

  function renderCards(doc, grid, state, modal, items, emptyMessage, session, onReturn, onRetry, highlightKey) {
    grid.textContent = '';
    if (!items.length) {
      grid.appendChild(makeElement(doc, 'div', 'rmw-status', emptyMessage));
    } else items.forEach((item, index) => {
      const card = makeElement(doc, 'div', 'rmw-card', '');
      card.tabIndex = 0;
      card.dataset.mediaKey = item.src;
      if (item.src === highlightKey) card.classList.add('rmw-current');
      const media = doc.createElement('img');
      media.src = item.poster || item.src;
      media.loading = 'lazy';
      media.decoding = 'async';
      media.alt = '用户评价图片';
      card.appendChild(media);
      preloadPreviewMedia(item);
      if (item.type === 'video') card.appendChild(makeElement(doc, 'span', 'rmw-play', '▶'));
      function openPreview() {
        session.rememberView({ scrollTop: grid.scrollTop, previewKey: item.src });
        state.openPreview(items, index);
        preloadPreviewAround(items, index);
        renderPreview(doc, modal, state, session, onReturn);
      }
      card.addEventListener('click', openPreview);
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openPreview();
        }
      });
      grid.appendChild(card);
    });
    const status = makeElement(doc, 'div', 'rmw-status', statusMessage(session, items.length));
    if (session.snapshot().loadingState === 'error') {
      const retry = makeElement(doc, 'button', 'rmw-retry', '重试');
      retry.type = 'button';
      retry.addEventListener('click', onRetry);
      status.appendChild(retry);
    }
    grid.appendChild(status);
    sizeGridCards(grid);
  }

  function findScrollable(element) {
    const nested = element?.querySelectorAll
      ? Array.from(element.querySelectorAll('*')).filter((node) => node.scrollHeight > node.clientHeight + 10)
      : [];
    if (nested.length) {
      return nested.reduce((selected, node) => (
        node.scrollHeight - node.clientHeight > selected.scrollHeight - selected.clientHeight ? node : selected
      ));
    }
    let current = element;
    while (current && current.parentElement) {
      if (current.scrollHeight > current.clientHeight + 10) return current;
      current = current.parentElement;
    }
    return element;
  }

  function openWall(doc, adapter, wallSession = createWallSession(), wallController = createWallController(adapter)) {
    const old = doc.getElementById(IDS.backdrop);
    if (old) old.remove();
    const state = createWallState();
    const controller = wallController;
    state.openWall();
    let stopCapture = null;

    const backdrop = makeElement(doc, 'div', '', '');
    backdrop.id = IDS.backdrop;
    const modal = makeElement(doc, 'section', '', '');
    modal.id = IDS.modal;
    modal.tabIndex = -1;
    const toolbar = makeElement(doc, 'div', 'rmw-toolbar', '');
    const filterGroup = makeElement(doc, 'div', 'rmw-group', '');
    const sizeGroup = makeElement(doc, 'div', 'rmw-group', '');
    const loaded = makeElement(doc, 'span', 'rmw-loaded', '');
    const sync = makeElement(doc, 'button', 'rmw-sync', '同步');
    const close = makeElement(doc, 'button', 'rmw-close', '×');
    sync.type = 'button';
    close.type = 'button';
    close.setAttribute('aria-label', '关闭图片墙');
    [['all', '全部'], ['image', '图片'], ['video', '视频']].forEach(([value, label]) => {
      const button = makeElement(doc, 'button', 'rmw-filter', label);
      button.type = 'button';
      button.dataset.value = value;
      filterGroup.appendChild(button);
    });
    [['small', '小'], ['medium', '中'], ['large', '大']].forEach(([value, label]) => {
      const button = makeElement(doc, 'button', 'rmw-size', label);
      button.type = 'button';
      button.dataset.value = value;
      sizeGroup.appendChild(button);
    });
    toolbar.append(filterGroup, sizeGroup, loaded, sync, close);
    modal.appendChild(toolbar);
    const grid = makeElement(doc, 'main', '', '');
    grid.id = IDS.grid;
    modal.appendChild(grid);
    backdrop.appendChild(modal);
    doc.body.appendChild(backdrop);

    let nativeRoot = null;
    let disconnect = null;
    let disconnectResize = null;
    let attempts = 0;
    let restoredScroll = false;
    let highlightKey = '';
    function revealCurrentCard() {
      modal.focus();
      const key = wallSession.snapshot().previewKey;
      highlightKey = key;
      const card = Array.from(grid.querySelectorAll('.rmw-card')).find((node) => node.dataset.mediaKey === key);
      if (!card) return;
      card.scrollIntoView({ block: 'center', behavior: 'auto' });
      card.classList.add('rmw-current');
      root.setTimeout(() => {
        if (highlightKey !== key) return;
        highlightKey = '';
        grid.querySelectorAll('.rmw-current').forEach((node) => node.classList.remove('rmw-current'));
      }, 1000);
    }
    function renderWall(emptyMessage) {
      const sessionSnapshot = wallSession.snapshot();
      const desiredScroll = restoredScroll ? grid.scrollTop : sessionSnapshot.scrollTop;
      grid.className = `rmw-size-${sessionSnapshot.cardSize}`;
      const visible = filterMedia(controller.items(), sessionSnapshot.mediaFilter);
      loaded.textContent = `已收集 ${controller.items().length} 项 / 当前显示 ${visible.length} 项`;
      filterGroup.querySelectorAll('.rmw-filter').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.value === sessionSnapshot.mediaFilter);
      });
      sizeGroup.querySelectorAll('.rmw-size').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.value === sessionSnapshot.cardSize);
      });
      renderCards(doc, grid, state, modal, visible, emptyMessage, wallSession, revealCurrentCard, requestMore, highlightKey);
      grid.scrollTop = desiredScroll;
      restoredScroll = true;
    }
    if (root.ResizeObserver) {
      const resizeObserver = new root.ResizeObserver(() => sizeGridCards(grid));
      resizeObserver.observe(grid);
      disconnectResize = () => resizeObserver.disconnect();
    }
    if (adapter.observeResponses) {
      stopCapture = adapter.observeResponses((items) => {
        const before = controller.items().length;
        controller.append(items);
        wallSession.finishLoad(controller.items().length > before);
        renderWall('当前筛选尚未加载出图片/视频，请在原评价窗口切换筛选或滚动后重试。');
      });
    }
    adapter.openNativeReviews(doc);
    function syncMedia(reset) {
      nativeRoot = adapter.findNativeRoot(doc);
      if (!nativeRoot) {
        renderWall('正在等待原生评价窗口加载...');
        return false;
      }
      adapter.selectMedia(nativeRoot);
      const observed = collectWithFallback(adapter, nativeRoot, doc);
      const before = controller.items().length;
      if (reset) controller.replace(observed);
      else controller.append(observed);
      if (wallSession.snapshot().loadingState === 'loading') {
        wallSession.finishLoad(controller.items().length > before);
      }
      renderWall('当前筛选尚未加载出图片/视频，请在原评价窗口切换筛选或滚动后重试。');
      if (!disconnect && root.MutationObserver) {
        const observer = new root.MutationObserver(() => syncMedia(false));
        observer.observe(nativeRoot, { childList: true, subtree: true });
        disconnect = () => observer.disconnect();
      }
      return true;
    }
    function waitForNative() {
      attempts += 1;
      if (!syncMedia(attempts === 1 && !controller.items().length) && attempts < 12) root.setTimeout(waitForNative, 250);
    }
    waitForNative();

    function requestMore() {
      if (!nativeRoot || !wallSession.beginLoad()) return;
      renderWall('当前筛选尚未加载出图片/视频，请在原评价窗口切换筛选或滚动后重试。');
      try {
        const scroller = findScrollable(nativeRoot);
        scroller.scrollTop = Math.min(scroller.scrollHeight, scroller.scrollTop + Math.max(scroller.clientHeight, 200));
        scroller.dispatchEvent(new root.Event('scroll', { bubbles: true }));
        root.setTimeout(() => syncMedia(false), 300);
      } catch (error) {
        wallSession.failLoad();
        renderWall('评价加载失败，请重试。');
      }
    }
    grid.addEventListener('scroll', () => {
      wallSession.rememberView({ scrollTop: grid.scrollTop, previewKey: wallSession.snapshot().previewKey });
      if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 180) requestMore();
    });
    filterGroup.addEventListener('click', (event) => {
      const button = event.target.closest?.('.rmw-filter');
      if (!button) return;
      wallSession.setFilter(button.dataset.value);
      renderWall('当前类型暂无已加载媒体。');
    });
    sizeGroup.addEventListener('click', (event) => {
      const button = event.target.closest?.('.rmw-size');
      if (!button) return;
      wallSession.setCardSize(button.dataset.value);
      renderWall('当前类型暂无已加载媒体。');
    });
    sync.addEventListener('click', () => {
      wallSession.retryLoad();
      syncMedia(true);
    });
    function dismissWall() {
      disconnect?.();
      disconnectResize?.();
      stopCapture?.();
      wallSession.rememberView({ scrollTop: grid.scrollTop, previewKey: wallSession.snapshot().previewKey });
      state.closeWall();
      backdrop.remove();
      adapter.closeNativeReviews?.(nativeRoot || adapter.findNativeRoot(doc));
    }
    close.addEventListener('click', dismissWall);
    backdrop.addEventListener('click', (event) => {
      if (event.target !== backdrop) return;
      const hadPreview = Boolean(state.snapshot().preview);
      state.onBackdrop();
      if (hadPreview) {
        renderPreview(doc, modal, state, wallSession, revealCurrentCard);
        revealCurrentCard();
        return;
      }
      dismissWall();
    });
    backdrop.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || state.snapshot().preview) return;
      dismissWall();
    });
  }

  function init() {
    const doc = root.document;
    if (!doc) return;
    const site = detectSite(root.location.href);
    if (!site) return;
    const adapter = adapters[site];
    const wallSession = createWallSession(root.localStorage, site);
    const wallController = createWallController(adapter);
    addStyles(doc);

    function mountLauncher() {
      const mount = adapter.findMount(doc);
      if (mount) ensureLauncher(mount, () => openWall(doc, adapter, wallSession, wallController));
    }
    mountLauncher();
    if (root.MutationObserver) {
      const observer = new root.MutationObserver(mountLauncher);
      observer.observe(doc.documentElement, { childList: true, subtree: true });
    }
  }

  return {
    detectSite,
    createMediaStore,
    filterMedia,
    createWallSession,
    adapters,
    IDS,
    createWallState,
    createWallController,
    collectJdPayloadMedia,
    installJdResponseCapture,
    collectWithFallback,
    findScrollable,
    ensureLauncher,
    init
  };
});
