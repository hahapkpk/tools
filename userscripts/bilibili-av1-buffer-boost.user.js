// ==UserScript==
// @name         Bilibili AV1 Buffer Boost
// @namespace    https://github.com/hahapkpk/tools
// @version      0.3.0
// @description  Hold ArrowRight or left mouse for adaptive 8x playback on Bilibili, with optional experimental prefetch.
// @author       Codex
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/bangumi/play/*
// @match        https://www.bilibili.com/list/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    holdKey: 'ArrowRight',
    mouseButton: 0,
    mouseHoldMs: 260,
    boostRate: 8,
    catchupRate: 1,
    minBufferSeconds: 20,
    resumeBufferSeconds: 45,
    criticalBufferSeconds: 4,
    pauseUntilBufferSeconds: 30,
    tickMs: 250,
    hud: true,
    experimentalPrefetch: false,
    prefetchLookahead: 4,
    prefetchConcurrency: 2,
    prefetchRecentLimit: 16,
    prefetchCacheLimit: 24
  };

  function getBufferedAhead(video) {
    if (!video || !video.buffered || !Number.isFinite(video.currentTime)) {
      return 0;
    }

    const currentTime = video.currentTime;
    for (let index = 0; index < video.buffered.length; index += 1) {
      const start = video.buffered.start(index);
      const end = video.buffered.end(index);
      if (currentTime >= start && currentTime <= end) {
        return Math.max(0, end - currentTime);
      }
    }

    return 0;
  }

  function matchesHoldKey(event, holdKey) {
    if (!event || !holdKey) {
      return false;
    }

    return event.code === holdKey || event.key === holdKey;
  }

  function matchesMouseButton(event, button) {
    return Boolean(event) && event.button === button;
  }

  function shouldIgnoreKeyboardEvent(event) {
    const target = event && event.target;
    if (!target) {
      return false;
    }

    const tagName = String(target.tagName || '').toUpperCase();
    return target.isContentEditable === true || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
  }

  function isBilibiliMediaUrl(url) {
    try {
      const parsed = new URL(String(url));
      return /(^|\.)bilivideo\.com$/i.test(parsed.hostname) && /\.m4s$/i.test(parsed.pathname);
    } catch (_error) {
      return false;
    }
  }

  function rememberRecentMediaUrl(recentUrls, url, maxItems) {
    const existingIndex = recentUrls.indexOf(url);
    if (existingIndex >= 0) {
      recentUrls.splice(existingIndex, 1);
    }

    recentUrls.unshift(url);
    while (recentUrls.length > maxItems) {
      recentUrls.pop();
    }
  }

  function inferNextMediaUrls(url, count) {
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch (_error) {
      return [];
    }

    const match = parsed.pathname.match(/(\d+)(\.[^/.]+)$/);
    if (!match) {
      return [];
    }

    const width = match[1].length;
    const current = Number(match[1]);
    if (!Number.isSafeInteger(current)) {
      return [];
    }

    const urls = [];
    for (let offset = 1; offset <= count; offset += 1) {
      const next = String(current + offset).padStart(width, '0');
      const nextUrl = new URL(parsed.toString());
      nextUrl.pathname = parsed.pathname.replace(/(\d+)(\.[^/.]+)$/, `${next}$2`);
      urls.push(nextUrl.toString());
    }
    return urls;
  }

  function choosePlaybackRate(state) {
    if (!state.boosting) {
      return {
        rate: state.normalRate,
        bufferLimited: false,
        pausedForBuffer: false,
        reason: 'normal'
      };
    }

    if (state.wasPausedForBuffer && state.bufferAhead < state.pauseUntilBufferSeconds) {
      return {
        rate: state.catchupRate,
        bufferLimited: true,
        pausedForBuffer: true,
        reason: 'buffer-paused'
      };
    }

    if (state.bufferAhead < state.criticalBufferSeconds) {
      return {
        rate: state.catchupRate,
        bufferLimited: true,
        pausedForBuffer: true,
        reason: 'buffer-critical'
      };
    }

    if (state.wasBufferLimited && state.bufferAhead < state.resumeBufferSeconds) {
      return {
        rate: state.catchupRate,
        bufferLimited: true,
        pausedForBuffer: false,
        reason: 'buffer-recovering'
      };
    }

    if (state.bufferAhead < state.minBufferSeconds) {
      return {
        rate: state.catchupRate,
        bufferLimited: true,
        pausedForBuffer: false,
        reason: 'buffer-low'
      };
    }

    return {
      rate: state.boostRate,
      bufferLimited: false,
      pausedForBuffer: false,
      reason: 'boost'
    };
  }

  const state = {
    video: null,
    boosting: false,
    normalRate: 1,
    bufferLimited: false,
    lastReason: 'normal',
    hud: null,
    mouseHoldTimer: null,
    mouseBoosting: false,
    pausedForBuffer: false,
    pausedByScript: false,
    prefetchCache: new Map(),
    prefetchQueue: [],
    prefetchActive: 0,
    prefetchRecentUrls: []
  };

  function getRequestUrl(input) {
    if (typeof input === 'string') {
      return input;
    }
    if (input && typeof input.url === 'string') {
      return input.url;
    }
    return '';
  }

  function trimPrefetchCache() {
    while (state.prefetchCache.size > CONFIG.prefetchCacheLimit) {
      const oldestKey = state.prefetchCache.keys().next().value;
      state.prefetchCache.delete(oldestKey);
    }
  }

  function enqueuePrefetch(url) {
    if (!CONFIG.experimentalPrefetch || !isBilibiliMediaUrl(url)) {
      return;
    }
    if (state.prefetchCache.has(url) || state.prefetchQueue.includes(url)) {
      return;
    }

    state.prefetchQueue.push(url);
    pumpPrefetchQueue();
  }

  function pumpPrefetchQueue() {
    if (!CONFIG.experimentalPrefetch) {
      return;
    }

    while (state.prefetchActive < CONFIG.prefetchConcurrency && state.prefetchQueue.length > 0) {
      const url = state.prefetchQueue.shift();
      state.prefetchActive += 1;
      originalFetch(url, {
        credentials: 'include',
        cache: 'force-cache',
        priority: 'low'
      }).then((response) => {
        if (!response.ok) {
          return null;
        }
        return response.arrayBuffer().then((buffer) => ({
          buffer,
          status: response.status,
          statusText: response.statusText,
          headers: Array.from(response.headers.entries())
        }));
      }).then((entry) => {
        if (entry) {
          state.prefetchCache.set(url, entry);
          trimPrefetchCache();
        }
      }).catch(() => {}).finally(() => {
        state.prefetchActive -= 1;
        pumpPrefetchQueue();
      });
    }
  }

  function observeMediaRequest(url) {
    if (!CONFIG.experimentalPrefetch || !isBilibiliMediaUrl(url)) {
      return;
    }

    rememberRecentMediaUrl(state.prefetchRecentUrls, url, CONFIG.prefetchRecentLimit);
    inferNextMediaUrls(url, CONFIG.prefetchLookahead).forEach(enqueuePrefetch);
  }

  const originalFetch = window.fetch.bind(window);
  if (CONFIG.experimentalPrefetch && typeof window.fetch === 'function') {
    window.fetch = function patchedFetch(input, init) {
      const url = getRequestUrl(input);
      if (isBilibiliMediaUrl(url)) {
        const cached = state.prefetchCache.get(url);
        if (cached) {
          state.prefetchCache.delete(url);
          observeMediaRequest(url);
          return Promise.resolve(new Response(cached.buffer.slice(0), {
            status: cached.status,
            statusText: cached.statusText,
            headers: cached.headers
          }));
        }
        observeMediaRequest(url);
      }
      return originalFetch(input, init);
    };
  }

  function findVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    return videos.find((video) => video.readyState > 0) || videos[0] || null;
  }

  function setVideoRate(video, rate) {
    if (!video || !Number.isFinite(rate) || video.playbackRate === rate) {
      return;
    }

    video.playbackRate = rate;
  }

  function ensureHud() {
    if (!CONFIG.hud || state.hud) {
      return state.hud;
    }

    const hud = document.createElement('div');
    hud.id = 'bbab-hud';
    hud.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:86px',
      'z-index:2147483647',
      'padding:6px 8px',
      'border-radius:6px',
      'background:rgba(15,18,22,.82)',
      'color:#fff',
      'font:12px/1.35 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
      'pointer-events:none',
      'box-shadow:0 4px 12px rgba(0,0,0,.22)',
      'display:none'
    ].join(';');
    document.documentElement.appendChild(hud);
    state.hud = hud;
    return hud;
  }

  function updateHud(video, bufferAhead, decision) {
    const hud = ensureHud();
    if (!hud) {
      return;
    }

    if (!state.boosting) {
      hud.style.display = 'none';
      return;
    }

    hud.style.display = 'block';
    const mode = decision.pausedForBuffer ? 'buffering' : `${decision.rate}x`;
    hud.textContent = `Bilibili Buffer Boost ${mode} | buffer ${bufferAhead.toFixed(1)}s | ${decision.reason}`;
  }

  function prepareVideo(video) {
    if (!video) {
      return;
    }

    video.preload = 'auto';
    video.setAttribute('preload', 'auto');
    if (video !== state.video) {
      state.video = video;
      state.bufferLimited = false;
    }
  }

  function tick() {
    const video = findVideo();
    prepareVideo(video);
    if (!video) {
      return;
    }

    const bufferAhead = getBufferedAhead(video);
    const decision = choosePlaybackRate({
      boosting: state.boosting,
      normalRate: state.normalRate,
      boostRate: CONFIG.boostRate,
      catchupRate: CONFIG.catchupRate,
      bufferAhead,
      minBufferSeconds: CONFIG.minBufferSeconds,
      resumeBufferSeconds: CONFIG.resumeBufferSeconds,
      criticalBufferSeconds: CONFIG.criticalBufferSeconds,
      pauseUntilBufferSeconds: CONFIG.pauseUntilBufferSeconds,
      wasBufferLimited: state.bufferLimited,
      wasPausedForBuffer: state.pausedForBuffer
    });

    state.bufferLimited = decision.bufferLimited;
    state.pausedForBuffer = decision.pausedForBuffer;
    state.lastReason = decision.reason;
    setVideoRate(video, decision.rate);
    if (decision.pausedForBuffer && !video.paused) {
      state.pausedByScript = true;
      video.pause();
    } else if (!decision.pausedForBuffer && state.pausedByScript && state.boosting) {
      state.pausedByScript = false;
      const playResult = video.play();
      if (playResult && typeof playResult.catch === 'function') {
        playResult.catch(() => {});
      }
    } else if (!decision.pausedForBuffer) {
      state.pausedByScript = false;
    }
    updateHud(video, bufferAhead, decision);
  }

  function beginBoost() {
    const video = findVideo();
    if (video) {
      state.normalRate = video.playbackRate || 1;
    }
    state.boosting = true;
    state.bufferLimited = false;
    tick();
  }

  function endBoost() {
    state.boosting = false;
    state.bufferLimited = false;
    state.pausedForBuffer = false;
    state.mouseBoosting = false;
    tick();
  }

  window.addEventListener('keydown', (event) => {
    if (event.repeat || shouldIgnoreKeyboardEvent(event) || !matchesHoldKey(event, CONFIG.holdKey)) {
      return;
    }

    event.preventDefault();
    beginBoost();
  }, true);

  window.addEventListener('keyup', (event) => {
    if (!matchesHoldKey(event, CONFIG.holdKey)) {
      return;
    }

    event.preventDefault();
    endBoost();
  }, true);

  window.addEventListener('mousedown', (event) => {
    if (!matchesMouseButton(event, CONFIG.mouseButton) || shouldIgnoreKeyboardEvent(event)) {
      return;
    }

    const video = findVideo();
    if (!video || !event.target || !video.contains(event.target)) {
      return;
    }

    window.clearTimeout(state.mouseHoldTimer);
    state.mouseHoldTimer = window.setTimeout(() => {
      state.mouseBoosting = true;
      beginBoost();
    }, CONFIG.mouseHoldMs);
  }, true);

  window.addEventListener('mouseup', () => {
    window.clearTimeout(state.mouseHoldTimer);
    state.mouseHoldTimer = null;
    if (state.mouseBoosting) {
      endBoost();
    }
  }, true);

  window.addEventListener('blur', () => {
    window.clearTimeout(state.mouseHoldTimer);
    state.mouseHoldTimer = null;
    if (state.boosting) {
      endBoost();
    }
  }, true);

  const observer = new MutationObserver(() => {
    prepareVideo(findVideo());
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  prepareVideo(findVideo());
  window.setInterval(tick, CONFIG.tickMs);
})();
