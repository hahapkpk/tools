// ==UserScript==
// @name         Bilibili AV1 Buffer Boost
// @namespace    https://github.com/hahapkpk/tools
// @version      0.2.0
// @description  Hold ArrowRight or left mouse for adaptive 8x playback on Bilibili while protecting buffer.
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
    pausedByScript: false
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
