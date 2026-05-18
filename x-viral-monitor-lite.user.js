// ==UserScript==
// @name         X Viral Monitor Lite
// @namespace    local.codex.x-viral-monitor-lite
// @version      0.1.0
// @description  X timeline velocity badges, bookmark counts, and copy tweet as Markdown. No image viewer.
// @match        https://x.com/*
// @match        https://pro.x.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_ID = 'x-viral-monitor-lite';
  const DEBUG = false;
  const GRAPHQL_RE = /\/i\/api\/graphql\//;
  const MSG = `${SCRIPT_ID}:graphql`;
  const pageWindow = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
  const thresholds = { trending: 1000, viral: 10000 };
  const tweetDataStore = new Map();
  let lastShareContext = null;
  let renderTimer = 0;

  const log = (...args) => DEBUG && console.log(`[${SCRIPT_ID}]`, ...args);

  function injectStyles() {
    if (document.getElementById(`${SCRIPT_ID}-style`)) return;
    const style = document.createElement('style');
    style.id = `${SCRIPT_ID}-style`;
    style.textContent = `
.xvl-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  margin-right: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 800;
  line-height: 18px;
  white-space: nowrap;
  user-select: none;
  cursor: default;
}
.xvl-badge::before { content: attr(data-prefix); }
.xvl-badge::after { content: attr(data-velocity) "/h"; }
.xvl-badge--normal { color: #16a34a; background: rgba(22, 163, 74, .22); }
.xvl-badge--trending { color: #c2410c; background: rgba(234, 88, 12, .23); }
.xvl-badge--viral { color: #dc2626; background: rgba(220, 38, 38, .23); }
.xvl-bookmark-count {
  margin-left: 4px;
  min-width: 0;
  color: rgb(83, 100, 113);
  font: inherit;
  line-height: inherit;
}
.xvl-copy-md-source {
  display: block;
  margin-top: 1px;
  color: rgb(113, 118, 123);
  font-size: 11px;
  font-weight: 400;
  opacity: .86;
}
.xvl-toast {
  position: fixed;
  left: 50%;
  bottom: 32px;
  z-index: 2147483647;
  transform: translate(-50%, 12px);
  opacity: 0;
  transition: opacity 160ms ease, transform 160ms ease;
  padding: 10px 16px;
  border-radius: 10px;
  background: rgba(15, 20, 25, .94);
  color: #fff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .35);
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  pointer-events: none;
}
.xvl-toast--show { opacity: 1; transform: translate(-50%, 0); }
.xvl-toast--error { background: rgba(185, 28, 28, .96); }
`;
    document.documentElement.appendChild(style);
  }

  function installNetworkHook() {
    if (pageWindow.__xvlNetworkHookInstalled) return;
    pageWindow.__xvlNetworkHookInstalled = true;

    const postGraphql = (url, payload, source) => {
      try {
        window.postMessage({ type: MSG, url, payload, source }, '*');
      } catch (_) {}
    };

    const extractUrl = (input) => {
      if (!input) return '';
      if (typeof input === 'string') return input;
      if (input instanceof URL) return input.href;
      if (typeof input.url === 'string') return input.url;
      return '';
    };

    const originalFetch = pageWindow.fetch;
    pageWindow.fetch = async function xvlFetchHook(...args) {
      const url = extractUrl(args[0]);
      const response = await originalFetch.apply(this, args);
      if (GRAPHQL_RE.test(url)) {
        response.clone().json()
          .then((payload) => postGraphql(url, payload, 'fetch'))
          .catch(() => {});
      }
      return response;
    };

    const xhrOpen = pageWindow.XMLHttpRequest?.prototype?.open;
    if (xhrOpen) {
      pageWindow.XMLHttpRequest.prototype.open = function xvlXhrOpen(method, url, ...rest) {
        this.__xvlUrl = typeof url === 'string' ? url : String(url || '');
        this.addEventListener('load', function xvlXhrLoad() {
          if (!GRAPHQL_RE.test(this.__xvlUrl || '')) return;
          try { postGraphql(this.__xvlUrl, JSON.parse(this.responseText), 'xhr'); } catch (_) {}
        });
        return xhrOpen.call(this, method, url, ...rest);
      };
    }
    log('network hook installed');
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.type !== MSG) return;
    scanForTweets(event.data.payload);
  });

  function scanForTweets(root) {
    const seen = new WeakSet();
    let changed = false;

    const walk = (obj) => {
      if (!obj || typeof obj !== 'object' || seen.has(obj)) return;
      seen.add(obj);

      const result = obj.tweet_results?.result || obj.tweetResult?.result;
      if (result) {
        const data = extractTweetData(result);
        if (data?.id) {
          mergeTweetData(data.id, data);
          changed = true;
        }
      }

      if (Array.isArray(obj)) {
        obj.forEach(walk);
      } else {
        Object.keys(obj).forEach((key) => {
          if (key !== 'tweet_results' && key !== 'tweetResult') walk(obj[key]);
        });
      }
    };

    walk(root);
    if (changed) scheduleRender();
  }

  function mergeTweetData(id, patch) {
    const prev = tweetDataStore.get(id) || {};
    tweetDataStore.set(id, { ...prev, ...patch, urlMap: { ...(prev.urlMap || {}), ...(patch.urlMap || {}) } });
  }

  function extractTweetData(result) {
    const tweet = result?.tweet || result;
    const legacy = tweet?.legacy;
    if (!legacy || legacy.promotedMetadata || tweet.promotedMetadata) return null;

    const rtResult = legacy.retweeted_status_result?.result;
    if (rtResult) return extractTweetData(rtResult);

    const viewCount = Number.parseInt(tweet.views?.count || '0', 10) || 0;
    const user = tweet.core?.user_results?.result || tweet.user_results?.result || {};
    const userLegacy = user.legacy || {};
    const tweetId = legacy.id_str || tweet.rest_id;
    const note = tweet.note_tweet?.note_tweet_results?.result;
    const urlMap = {};

    const normalizeExpanded = (raw) => raw ? raw.replace(/^https:\/\/twitter\.com\//, 'https://x.com/') : raw;
    [...(legacy.entities?.urls || []), ...(note?.entity_set?.urls || [])].forEach((u) => {
      if (u?.url && u.expanded_url) urlMap[u.url] = normalizeExpanded(u.expanded_url);
    });

    for (const m of legacy.extended_entities?.media || legacy.entities?.media || []) {
      if (!m?.url) continue;
      if (m.type === 'photo') {
        urlMap[m.url] = `![](${upgradeMediaUrl(m.media_url_https || m.media_url || '')})`;
      } else if (m.type === 'video' || m.type === 'animated_gif') {
        const mp4 = [...(m.video_info?.variants || [])]
          .filter((v) => v.content_type === 'video/mp4')
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        urlMap[m.url] = `[video](${mp4?.url || m.media_url_https || ''})`;
      }
    }

    return {
      id: tweetId,
      screenName: userLegacy.screen_name || user.core?.screen_name || '',
      author: userLegacy.name || user.core?.name || '',
      views: viewCount,
      likes: legacy.favorite_count || 0,
      retweets: legacy.retweet_count || 0,
      replies: legacy.reply_count || 0,
      bookmarks: legacy.bookmark_count || 0,
      createdAt: legacy.created_at || '',
      text: note?.text || legacy.full_text || '',
      urlMap,
    };
  }

  function getTweetIdFromArticle(article) {
    const links = [...article.querySelectorAll('a[href*="/status/"]')];
    const main = links.find((a) => !/\/(?:analytics|photo|video)(?:\/|$)/.test(a.getAttribute('href') || ''))
      || links[0];
    return main?.getAttribute('href')?.match(/\/status\/(\d+)/)?.[1] || null;
  }

  function getArticleFallbackData(article, id) {
    const groupLabel = article.querySelector('[role="group"]')?.getAttribute('aria-label') || '';
    const counts = parseActionGroupLabel(groupLabel);
    const time = article.querySelector('time[datetime]')?.getAttribute('datetime') || '';
    const text = article.querySelector('[data-testid="tweetText"]')?.innerText?.trim() || '';
    const userName = article.querySelector('[data-testid="User-Name"]');
    const handleText = [...(userName?.querySelectorAll('a[href^="/"]') || [])]
      .map((a) => a.textContent.trim())
      .find((s) => /^@/.test(s)) || '';
    const author = userName?.querySelector('a[href^="/"]')?.innerText?.split('\n')?.[0]?.trim() || '';
    const href = article.querySelector('a[href*="/status/"]')?.getAttribute('href') || '';
    const handleFromUrl = href.match(/^\/([^/]+)\/status\//)?.[1] || '';

    return {
      id,
      screenName: handleText.replace(/^@/, '') || handleFromUrl,
      author,
      createdAt: time,
      text,
      ...counts,
    };
  }

  function parseActionGroupLabel(label) {
    const out = {};
    if (!label) return out;
    for (const part of label.split(/[，,]/).map((s) => s.trim())) {
      const value = parseHumanNumber(part);
      if (!Number.isFinite(value)) continue;
      if (/回复|repl/i.test(part)) out.replies = value;
      else if (/转帖|转发|repost|retweet/i.test(part)) out.retweets = value;
      else if (/喜欢|赞|like/i.test(part)) out.likes = value;
      else if (/书签|收藏|bookmark/i.test(part)) out.bookmarks = value;
      else if (/观看|查看|view/i.test(part)) out.views = value;
    }
    return out;
  }

  function parseHumanNumber(raw) {
    if (!raw) return NaN;
    const m = String(raw).replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([万萬亿億kKmMbB]?)/);
    if (!m) return NaN;
    const n = Number.parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    const mult = unit === '万' || unit === '萬' ? 10000
      : unit === '亿' || unit === '億' ? 100000000
      : unit === 'k' ? 1000
      : unit === 'm' ? 1000000
      : unit === 'b' ? 1000000000
      : 1;
    return Math.round(n * mult);
  }

  function computeScore(data) {
    const created = new Date(data.createdAt || 0).getTime();
    if (!created || !data.views) return null;
    const hours = Math.max((Date.now() - created) / 3600000, 0.1);
    const velocity = data.views / hours;
    const engagement = (data.likes || 0) + (data.retweets || 0) + (data.replies || 0);
    const engagementRate = data.views > 0 ? engagement / data.views : 0;
    const rtRatio = data.likes > 0 ? (data.retweets || 0) / data.likes : 0;
    const bmRatio = data.likes > 0 ? (data.bookmarks || 0) / data.likes : 0;
    const score = Math.round(
      Math.min(velocity / 50000, 1) * 40
      + Math.min(engagementRate / 0.1, 1) * 25
      + Math.min(rtRatio / 0.5, 1) * 20
      + Math.min(bmRatio / 0.3, 1) * 15
    );
    return { velocity, score: Math.min(score, 100) };
  }

  function formatCompact(n) {
    const v = Number(n) || 0;
    if (v >= 100000000) return `${stripZero(v / 100000000)}亿`;
    if (v >= 10000) return `${stripZero(v / 10000)}万`;
    if (v >= 1000) return `${stripZero(v / 1000)}k`;
    return String(Math.round(v));
  }

  function stripZero(v) {
    return v >= 100 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, '');
  }

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = window.setTimeout(() => {
      renderTimer = 0;
      renderAll();
    }, 120);
  }

  function renderAll() {
    injectStyles();
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      const id = getTweetIdFromArticle(article);
      if (!id) continue;
      const fallback = getArticleFallbackData(article, id);
      mergeTweetData(id, withoutEmpty(fallback));
      const data = tweetDataStore.get(id);
      renderBadge(article, data);
      renderBookmarkCount(article, data);
    }
  }

  function withoutEmpty(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== '' && value != null));
  }

  function renderBadge(article, data) {
    const score = computeScore(data);
    if (!score) return;
    const { velocity } = score;
    const tier = velocity >= thresholds.viral ? 'viral' : velocity >= thresholds.trending ? 'trending' : 'normal';
    const prefix = tier === 'viral' ? '🔥' : tier === 'trending' ? '🚀' : '🌱';
    const headerRow = findHeaderRow(article);
    if (!headerRow) return;
    if (headerRow.querySelector(':scope > .xvm-badge')) return;

    let badge = headerRow.querySelector(':scope > .xvl-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'xvl-badge';
      headerRow.insertBefore(badge, article.querySelector('[data-testid="caret"]')?.parentElement || null);
    }
    badge.className = `xvl-badge xvl-badge--${tier}`;
    badge.dataset.prefix = prefix;
    badge.dataset.velocity = formatCompact(velocity);
    badge.title = [
      `浏览量: ${(data.views || 0).toLocaleString()}`,
      `点赞: ${(data.likes || 0).toLocaleString()}`,
      `转发: ${(data.retweets || 0).toLocaleString()}`,
      `回复: ${(data.replies || 0).toLocaleString()}`,
      `书签: ${(data.bookmarks || 0).toLocaleString()}`,
      `流速: ${formatCompact(velocity)}/h`,
      `爆帖指数: ${score.score}/100`,
    ].join('\n');
  }

  function findHeaderRow(article) {
    const caret = article.querySelector('[data-testid="caret"]');
    let el = caret?.parentElement || article.querySelector('[data-testid="User-Name"]')?.parentElement;
    while (el && el !== article) {
      const cs = getComputedStyle(el);
      if (cs.display === 'flex' && cs.flexDirection === 'row' && el.querySelector('[data-testid="User-Name"]')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function renderBookmarkCount(article, data) {
    const count = Number(data.bookmarks || 0);
    const button = article.querySelector('button[data-testid="bookmark"], button[data-testid="removeBookmark"]');
    if (!button) return;

    if (button.querySelector('.xvm-bookmark-count')) return;

    let node = button.querySelector('.xvl-bookmark-count');
    if (!count) {
      node?.remove();
      return;
    }
    if (!node) {
      node = document.createElement('span');
      node.className = 'xvl-bookmark-count';
      const inner = button.querySelector(':scope > div') || button;
      inner.appendChild(node);
    }
    node.textContent = formatCompact(count);
    node.title = `${count.toLocaleString()} 书签`;
  }

  document.addEventListener('click', (event) => {
    const shareButton = event.target.closest?.(
      'button[aria-label*="分享"], button[aria-label*="Share"], button[aria-label*="共有"], button[aria-label*="share"]'
    );
    if (shareButton) {
      const article = shareButton.closest('article[data-testid="tweet"]');
      if (article) lastShareContext = { article, id: getTweetIdFromArticle(article) };
    }

    const bookmark = event.target.closest?.('button[data-testid="bookmark"], button[data-testid="removeBookmark"]');
    if (bookmark) {
      const article = bookmark.closest('article[data-testid="tweet"]');
      const id = article && getTweetIdFromArticle(article);
      const data = id && tweetDataStore.get(id);
      if (data) {
        const isRemoving = bookmark.getAttribute('data-testid') === 'removeBookmark';
        data.bookmarks = Math.max(0, (data.bookmarks || 0) + (isRemoving ? -1 : 1));
        window.setTimeout(scheduleRender, 100);
      }
    }
  }, true);

  function injectCopyMarkdownItem(menuEl) {
    if (!lastShareContext?.article?.isConnected) return;
    if (menuEl.querySelector('.xvl-copy-md-item, .xvm-copy-md-item')) return;
    const items = menuEl.querySelectorAll('[role="menuitem"]');
    if (!items.length) return;

    const nativeItems = [...items].filter((item) => !item.matches(
      '.xvl-copy-md-item, .xvm-copy-md-item, .xvm-starchart-item'
    ));
    const template = nativeItems[nativeItems.length - 1] || items[items.length - 1];
    const clone = template.cloneNode(true);
    clone.classList.add('xvl-copy-md-item');
    clone.removeAttribute('data-testid');
    clone.querySelectorAll('[data-testid]').forEach((el) => el.removeAttribute('data-testid'));
    clone.querySelectorAll('.xvl-copy-md-source, .xvm-copy-md-source').forEach((el) => el.remove());

    const label = [...clone.querySelectorAll('span')]
      .find((span) => span.children.length === 0 && span.textContent.trim());
    if (label) {
      label.textContent = '';
      const title = document.createElement('span');
      title.textContent = '复制为 Markdown';
      const source = document.createElement('span');
      source.className = 'xvl-copy-md-source';
      source.textContent = 'X Viral Monitor Lite';
      label.append(title, document.createElement('br'), source);
    } else {
      clone.textContent = '复制为 Markdown';
    }

    const svg = clone.querySelector('svg');
    if (svg) {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('width', svg.getAttribute('width') || '18');
      icon.setAttribute('height', svg.getAttribute('height') || '18');
      icon.setAttribute('aria-hidden', 'true');
      icon.style.fill = 'currentColor';
      icon.innerHTML = '<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm2 3v8h2v-5l2 3 2-3v5h2V8H9.5L8 10.5 6.5 8H5zm11 0v4h-2l3 4 3-4h-2V8h-2z"/>';
      svg.replaceWith(icon);
    }

    clone.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const markdown = buildTweetMarkdown(lastShareContext);
      const ok = await copyToClipboard(markdown);
      showToast(ok ? '已复制为 Markdown' : '复制失败', ok ? 'success' : 'error');
      closeMenus();
    });

    items[items.length - 1].parentElement.appendChild(clone);
  }

  function isShareMenu(menuEl) {
    const text = (menuEl.textContent || '').toLowerCase();
    return /复制链接|复制帖子链接|copy link|copy post link|copy/i.test(text);
  }

  function buildTweetMarkdown(ctx) {
    const article = ctx?.article;
    const id = ctx?.id || (article && getTweetIdFromArticle(article));
    const fallback = article ? getArticleFallbackData(article, id) : {};
    const data = { ...(tweetDataStore.get(id) || {}), ...withoutEmpty(fallback) };
    const screenName = data.screenName || '';
    const author = data.author || screenName || 'X user';
    const url = screenName && id ? `https://x.com/${screenName}/status/${id}` : location.href;
    const created = data.createdAt ? new Date(data.createdAt) : null;
    const createdText = created && !Number.isNaN(created.getTime()) ? created.toLocaleString() : '';

    let body = data.text || '';
    for (const [shortUrl, expanded] of Object.entries(data.urlMap || {})) {
      if (!shortUrl || !expanded) continue;
      const replacement = /^!\[\]/.test(expanded) || /^\[video\]/.test(expanded) ? `\n\n${expanded}` : expanded;
      body = body.split(shortUrl).join(replacement);
    }
    body = body.trim() || article?.querySelector('[data-testid="tweetText"]')?.innerText?.trim() || '';

    const media = article ? collectArticleMediaMarkdown(article, body) : [];
    const parts = [];
    if (body) parts.push(body);
    if (media.length) parts.push(media.join('\n'));
    parts.push(`\n---`);
    parts.push(`作者: [${author}${screenName ? ` (@${screenName})` : ''}](https://x.com/${screenName || ''})`);
    if (createdText) parts.push(`时间: ${createdText}`);
    parts.push(`链接: ${url}`);
    return parts.join('\n\n').replace(/\n{4,}/g, '\n\n\n').trim();
  }

  function collectArticleMediaMarkdown(article, existingText) {
    const out = [];
    const seen = new Set();
    for (const img of article.querySelectorAll('img[src*="pbs.twimg.com/media"], img[src*="pbs.twimg.com/card_img"]')) {
      const url = upgradeMediaUrl(img.currentSrc || img.src);
      if (!url || seen.has(url) || existingText.includes(url)) continue;
      seen.add(url);
      out.push(`![](${url})`);
    }
    return out;
  }

  function upgradeMediaUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      if (u.hostname === 'pbs.twimg.com' && u.pathname.includes('/media/')) {
        u.searchParams.set('name', 'large');
      }
      return u.toString();
    } catch (_) {
      return url;
    }
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  function showToast(text, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `xvl-toast ${type === 'error' ? 'xvl-toast--error' : ''}`;
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('xvl-toast--show'));
    setTimeout(() => {
      toast.classList.remove('xvl-toast--show');
      setTimeout(() => toast.remove(), 180);
    }, 1800);
  }

  function closeMenus() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    setTimeout(() => document.querySelectorAll('[role="menu"]').forEach((menu) => menu.remove()), 80);
  }

  function watchDom() {
    const observer = new MutationObserver((mutations) => {
      let shouldRender = false;
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches?.('article[data-testid="tweet"]') || node.querySelector?.('article[data-testid="tweet"]')) {
            shouldRender = true;
          }
          const menus = [
            ...(node.matches?.('[role="menu"]') ? [node] : []),
            ...(node.querySelectorAll?.('[role="menu"]') || []),
          ];
          menus.filter(isShareMenu).forEach(injectCopyMarkdownItem);
        }
      }
      if (shouldRender) scheduleRender();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function initWhenReady() {
    injectStyles();
    watchDom();
    scheduleRender();
    setInterval(scheduleRender, 2500);
  }

  installNetworkHook();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWhenReady, { once: true });
  } else {
    initWhenReady();
  }
})();
