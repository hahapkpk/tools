// ==UserScript==
// @name         Bilibili AV1 Buffer Boost
// @namespace    https://github.com/hahapkpk/tools
// @version      0.1.0
// @description  Hold a key for adaptive 8x playback on Bilibili while avoiding low-buffer stalls.
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
    holdKey: 'Backquote',
    boostRate: 8,
    catchupRate: 1.25,
    minBufferSeconds: 8,
    resumeBufferSeconds: 20,
    tickMs: 250,
    hud: true
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

  function shouldIgnoreKeyboardEvent(event) {
    const target = event && event.target;
    if (!target) {
      return false;
    }

    const tagName = String(target.tagName || '').toUpperCase();
    return target.isContentEditable === true || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
  }

  function choosePlaybackRate(state) {
    if (!state.boosting) {
      return {
        rate: state.normalRate,
        bufferLimited: false,
        reason: 'normal'
      };
    }

    if (state.wasBufferLimited && state.bufferAhead < state.resumeBufferSeconds) {
      return {
        rate: state.catchupRate,
        bufferLimited: true,
        reason: 'buffer-recovering'
      };
    }

    if (state.bufferAhead < state.minBufferSeconds) {
      return {
        rate: state.catchupRate,
        bufferLimited: true,
        reason: 'buffer-low'
      };
    }

    return {
      rate: state.boostRate,
      bufferLimited: false,
      reason: 'boost'
    };
  }

  const state = {
    video: null,
    boosting: false,
    normalRate: 1,
    bufferLimited: false,
    lastReason: 'normal',
    hud: null
  };

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
    hud.textContent = `Bilibili Buffer Boost ${decision.rate}x | buffer ${bufferAhead.toFixed(1)}s | ${decision.reason}`;
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
      wasBufferLimited: state.bufferLimited
    });

    state.bufferLimited = decision.bufferLimited;
    state.lastReason = decision.reason;
    setVideoRate(video, decision.rate);
    updateHud(video, bufferAhead, decision);
  }

  window.addEventListener('keydown', (event) => {
    if (event.repeat || shouldIgnoreKeyboardEvent(event) || !matchesHoldKey(event, CONFIG.holdKey)) {
      return;
    }

    const video = findVideo();
    if (video) {
      state.normalRate = video.playbackRate || 1;
    }
    state.boosting = true;
    state.bufferLimited = false;
    event.preventDefault();
    tick();
  }, true);

  window.addEventListener('keyup', (event) => {
    if (!matchesHoldKey(event, CONFIG.holdKey)) {
      return;
    }

    state.boosting = false;
    state.bufferLimited = false;
    event.preventDefault();
    tick();
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
