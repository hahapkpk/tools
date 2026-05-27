// ==UserScript==
// @name         京东/淘宝评价实拍墙
// @namespace    https://github.com/hahapkpk/tools
// @version      0.1.0
// @description  将京东和淘宝/天猫评价图视频以瀑布流弹窗展示。
// @match        https://item.jd.com/*
// @match        https://detail.tmall.com/*
// @match        https://item.taobao.com/*
// @run-at       document-idle
// @grant        none
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

  function getMediaSource(element) {
    return element.currentSrc || element.src || element.getAttribute?.('src') || '';
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

  function collectFromAlbums(nativeRoot) {
    if (!nativeRoot) return [];
    const items = [];
    const comments = nativeRoot.querySelectorAll('[class*="Comment--"]');
    comments.forEach((comment) => {
      const state = getTaobaoCommentState(comment);
      const text = (state?.reviewInfo?.content || comment.innerText || '').trim().replace(/\s+/g, ' ');
      const meta = state
        ? [state.reviewInfo.date, state.skuText].filter(Boolean).join(' ')
        : '';
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
      openNativeReviews(doc) {
        const button = doc.querySelector('.all-btn');
        if (button) button.click();
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
    return {
      openWall() {
        wallOpen = true;
      },
      closeWall() {
        wallOpen = false;
        preview = null;
      },
      openPreview(item) {
        preview = item;
      },
      onBackdrop() {
        if (preview) {
          preview = null;
        } else {
          wallOpen = false;
        }
      },
      snapshot() {
        return { wallOpen, preview };
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
    launcher.textContent = '实拍墙';
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
    if (doc.getElementById('review-media-wall-style')) return;
    const style = doc.createElement('style');
    style.id = 'review-media-wall-style';
    style.textContent = `
#${IDS.launcher} { display:inline-flex; align-items:center; height:100%; padding:0 22px; border:0; background:transparent; color:#111; font-size:16px; font-weight:600; cursor:pointer; }
#${IDS.launcher}:hover { color:#e1251b; }
#${IDS.backdrop} { position:fixed; inset:0; z-index:2147483000; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.56); }
#${IDS.modal} { position:relative; display:flex; flex-direction:column; width:min(1460px,94vw); height:min(92vh,1020px); border-radius:16px; overflow:hidden; background:#f7f7f7; box-shadow:0 20px 70px rgba(0,0,0,.34); }
.rmw-header { display:flex; align-items:center; gap:14px; padding:18px 24px 12px; background:#fff; border-bottom:1px solid #ededed; }
.rmw-title { margin:0; font-size:24px; color:#111; }
.rmw-subtitle { flex:1; color:#777; font-size:13px; }
.rmw-sync, .rmw-close { border:1px solid #ddd; border-radius:18px; background:#fff; cursor:pointer; height:36px; padding:0 16px; font-size:14px; }
.rmw-sync:hover { border-color:#e1251b; color:#e1251b; }
.rmw-close { width:40px; padding:0; font-size:25px; line-height:30px; border:0; }
.rmw-guide { padding:10px 24px; color:#666; font-size:13px; background:#fff; }
#${IDS.grid} { flex:1; overflow:auto; padding:18px 20px 30px; column-count:5; column-gap:14px; }
.rmw-card { position:relative; break-inside:avoid; margin:0 0 14px; border-radius:10px; overflow:hidden; background:#eee; cursor:zoom-in; }
.rmw-card img, .rmw-card video { display:block; width:100%; height:auto; min-height:92px; object-fit:cover; }
.rmw-play { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); border-radius:50%; width:50px; height:50px; display:grid; place-items:center; background:rgba(0,0,0,.58); color:white; font-size:23px; }
.rmw-status { break-inside:avoid; padding:26px 16px; text-align:center; color:#777; font-size:14px; }
#${IDS.preview} { position:absolute; inset:0; z-index:2; display:flex; align-items:center; justify-content:center; padding:34px; background:rgba(0,0,0,.82); }
.rmw-preview-content { display:flex; max-width:min(1280px,90vw); max-height:86vh; border-radius:12px; overflow:hidden; background:#111; }
.rmw-preview-media { display:flex; align-items:center; justify-content:center; min-width:300px; max-width:min(900px,68vw); background:#000; }
.rmw-preview-media img, .rmw-preview-media video { max-width:100%; max-height:84vh; object-fit:contain; }
.rmw-context { width:min(330px,26vw); padding:24px; background:#fff; color:#222; overflow:auto; line-height:1.65; }
.rmw-context h3 { margin:0 0 12px; font-size:16px; }
@media (max-width:1100px) { #${IDS.grid} { column-count:4; } }
@media (max-width:760px) { #${IDS.grid} { column-count:2; } .rmw-preview-content { flex-direction:column; } .rmw-context { width:auto; } }
`;
    doc.head.appendChild(style);
  }

  function renderPreview(doc, modal, state, item) {
    const previous = doc.getElementById(IDS.preview);
    if (previous) previous.remove();
    if (!item) return;

    const overlay = makeElement(doc, 'div', '', '');
    overlay.id = IDS.preview;
    const content = makeElement(doc, 'div', 'rmw-preview-content', '');
    const mediaBox = makeElement(doc, 'div', 'rmw-preview-media', '');
    const media = doc.createElement(item.type === 'video' ? 'video' : 'img');
    media.src = item.src;
    if (item.type === 'video') {
      media.controls = true;
      media.autoplay = true;
      if (item.poster) media.poster = item.poster;
    }
    mediaBox.appendChild(media);
    const context = makeElement(doc, 'aside', 'rmw-context', '');
    context.appendChild(makeElement(doc, 'h3', '', item.type === 'video' ? '视频评价' : '图片评价'));
    context.appendChild(makeElement(doc, 'p', '', item.text || '该媒体暂无可见评价文字。'));
    if (item.meta) context.appendChild(makeElement(doc, 'p', '', item.meta));
    content.append(mediaBox, context);
    overlay.appendChild(content);
    overlay.addEventListener('click', (event) => {
      if (event.target !== overlay) return;
      state.onBackdrop();
      renderPreview(doc, modal, state, null);
    });
    modal.appendChild(overlay);
  }

  function renderCards(doc, grid, state, modal, items, emptyMessage) {
    grid.textContent = '';
    if (!items.length) {
      grid.appendChild(makeElement(doc, 'div', 'rmw-status', emptyMessage));
      return;
    }
    items.forEach((item) => {
      const card = makeElement(doc, 'div', 'rmw-card', '');
      const media = doc.createElement('img');
      media.src = item.poster || item.src;
      media.loading = 'lazy';
      media.alt = '用户评价实拍';
      card.appendChild(media);
      if (item.type === 'video') card.appendChild(makeElement(doc, 'span', 'rmw-play', '▶'));
      card.addEventListener('click', () => {
        state.openPreview(item);
        renderPreview(doc, modal, state, item);
      });
      grid.appendChild(card);
    });
    grid.appendChild(makeElement(doc, 'div', 'rmw-status', '继续向下滚动以加载更多原生评价媒体'));
  }

  function findScrollable(element) {
    let current = element;
    while (current && current.parentElement) {
      if (current.scrollHeight > current.clientHeight + 10) return current;
      current = current.parentElement;
    }
    return element;
  }

  function openWall(doc, adapter) {
    const old = doc.getElementById(IDS.backdrop);
    if (old) old.remove();
    const state = createWallState();
    const controller = createWallController(adapter);
    state.openWall();
    adapter.openNativeReviews(doc);

    const backdrop = makeElement(doc, 'div', '', '');
    backdrop.id = IDS.backdrop;
    const modal = makeElement(doc, 'section', '', '');
    modal.id = IDS.modal;
    const header = makeElement(doc, 'header', 'rmw-header', '');
    header.appendChild(makeElement(doc, 'h2', 'rmw-title', '实拍墙'));
    header.appendChild(makeElement(doc, 'span', 'rmw-subtitle', '同步原评价窗口中的图/视频、排序和款式筛选'));
    const sync = makeElement(doc, 'button', 'rmw-sync', '同步筛选结果');
    const close = makeElement(doc, 'button', 'rmw-close', '×');
    header.append(sync, close);
    modal.appendChild(header);
    modal.appendChild(makeElement(doc, 'div', 'rmw-guide', '需要调整“最新 / 当前商品 / 时间排序 / 款式筛选”时，请在原评价窗口选择后点击“同步筛选结果”。'));
    const grid = makeElement(doc, 'main', '', '');
    grid.id = IDS.grid;
    modal.appendChild(grid);
    backdrop.appendChild(modal);
    doc.body.appendChild(backdrop);

    let nativeRoot = null;
    let disconnect = null;
    let attempts = 0;
    function syncMedia(reset) {
      nativeRoot = adapter.findNativeRoot(doc);
      if (!nativeRoot) {
        renderCards(doc, grid, state, modal, [], '正在等待原生评价窗口加载...');
        return false;
      }
      adapter.selectMedia(nativeRoot);
      const observed = collectWithFallback(adapter, nativeRoot, doc);
      const items = reset
        ? (controller.replace(observed), controller.items())
        : (controller.append(observed), controller.items());
      renderCards(doc, grid, state, modal, items, '当前筛选尚未加载出图片/视频，请在原评价窗口切换筛选或滚动后重试。');
      if (!disconnect && root.MutationObserver) {
        const observer = new root.MutationObserver(() => syncMedia(false));
        observer.observe(nativeRoot, { childList: true, subtree: true });
        disconnect = () => observer.disconnect();
      }
      return true;
    }
    function waitForNative() {
      attempts += 1;
      if (!syncMedia(attempts === 1) && attempts < 12) root.setTimeout(waitForNative, 250);
    }
    waitForNative();

    grid.addEventListener('scroll', () => {
      if (!nativeRoot || grid.scrollTop + grid.clientHeight < grid.scrollHeight - 180) return;
      const scroller = findScrollable(nativeRoot);
      scroller.scrollTop = scroller.scrollHeight;
      scroller.dispatchEvent(new root.Event('scroll', { bubbles: true }));
      root.setTimeout(() => syncMedia(false), 250);
    });
    sync.addEventListener('click', () => syncMedia(true));
    close.addEventListener('click', () => {
      disconnect?.();
      state.closeWall();
      backdrop.remove();
    });
    backdrop.addEventListener('click', (event) => {
      if (event.target !== backdrop) return;
      state.onBackdrop();
      if (!state.snapshot().wallOpen) {
        disconnect?.();
        backdrop.remove();
      }
    });
  }

  function init() {
    const doc = root.document;
    if (!doc) return;
    const site = detectSite(root.location.href);
    if (!site) return;
    const adapter = adapters[site];
    addStyles(doc);

    function mountLauncher() {
      const mount = adapter.findMount(doc);
      if (mount) ensureLauncher(mount, () => openWall(doc, adapter));
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
    adapters,
    IDS,
    createWallState,
    createWallController,
    collectWithFallback,
    ensureLauncher,
    init
  };
});
