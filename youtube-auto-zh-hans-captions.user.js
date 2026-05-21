// ==UserScript==
// @name         YouTube English Auto Captions to Simplified Chinese
// @namespace    https://github.com/hahapkpk/tools
// @version      0.2.2
// @description  Automatically shows Simplified Chinese subtitles for English YouTube videos using YouTube caption translation tracks.
// @match        https://www.youtube.com/watch*
// @match        https://www.youtube.com/shorts/*
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/youtube-auto-zh-hans-captions.user.js
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/youtube-auto-zh-hans-captions.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_ID = 'codex-yt-auto-zh-hans-captions';
  const SCRIPT_DATA_KEY = 'codexYtAutoZhHansCaptions';
  const DEBUG = false;
  const TARGET_LANG = 'zh-Hans';
  const SOURCE_LANG_RE = /^en(?:-|$)/i;
  const STYLE_ID = `${SCRIPT_ID}-style`;
  const OVERLAY_ID = `${SCRIPT_ID}-overlay`;
  const STATUS_ID = `${SCRIPT_ID}-status`;
  const CHECK_INTERVAL_MS = 150;
  const ROUTE_INTERVAL_MS = 800;

  const state = {
    videoId: '',
    cues: [],
    cueIndex: -1,
    loadToken: 0,
    enabled: true,
    lastUrl: '',
    pendingStatus: '',
    rafId: 0,
    routeTimer: 0
  };

  const cache = new Map();
  const log = (...args) => DEBUG && console.log(`[${SCRIPT_ID}]`, ...args);

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        position: absolute;
        left: 8%;
        right: 8%;
        bottom: 8.5%;
        z-index: 64;
        display: flex;
        justify-content: center;
        pointer-events: none;
        opacity: 0;
        transition: opacity 120ms ease;
      }
      #${OVERLAY_ID}.${SCRIPT_ID}-visible {
        opacity: 1;
      }
      #${OVERLAY_ID} .${SCRIPT_ID}-line {
        max-width: min(1100px, 100%);
        padding: 0.18em 0.42em 0.22em;
        border-radius: 4px;
        background: rgba(0, 0, 0, 0.72);
        color: #fff;
        font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif;
        font-size: clamp(20px, 3.4vw, 34px);
        font-weight: 700;
        line-height: 1.34;
        text-align: center;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
        white-space: pre-wrap;
        word-break: break-word;
      }
      .ytp-autohide #${OVERLAY_ID} {
        bottom: 5.5%;
      }
      #${STATUS_ID} {
        position: absolute;
        right: 12px;
        bottom: 58px;
        z-index: 65;
        padding: 4px 8px;
        border-radius: 4px;
        background: rgba(0, 0, 0, 0.72);
        color: #fff;
        font: 12px/1.4 Arial, sans-serif;
        pointer-events: none;
        opacity: 0;
        transition: opacity 180ms ease;
      }
      #${STATUS_ID}.${SCRIPT_ID}-visible {
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  function getVideoId() {
    const url = new URL(location.href);
    if (url.pathname.startsWith('/shorts/')) {
      return url.pathname.split('/').filter(Boolean)[1] || '';
    }
    return url.searchParams.get('v') || '';
  }

  function getPlayerRoot() {
    return document.querySelector('.html5-video-player') ||
      document.querySelector('#movie_player') ||
      document.querySelector('ytd-player') ||
      document.querySelector('#shorts-player');
  }

  function getVideoEl() {
    return document.querySelector('video.html5-main-video') || document.querySelector('video');
  }

  function ensureOverlay() {
    injectStyle();

    const player = getPlayerRoot();
    if (!player) return null;

    const playerStyle = getComputedStyle(player);
    if (playerStyle.position === 'static') {
      player.style.position = 'relative';
    }

    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      const line = document.createElement('div');
      line.className = `${SCRIPT_ID}-line`;
      overlay.appendChild(line);
    }
    if (overlay.parentElement !== player) {
      player.appendChild(overlay);
    }

    let status = document.getElementById(STATUS_ID);
    if (!status) {
      status = document.createElement('div');
      status.id = STATUS_ID;
    }
    if (status.parentElement !== player) {
      player.appendChild(status);
    }
    if (state.pendingStatus && !status.classList.contains(`${SCRIPT_ID}-visible`)) {
      status.textContent = state.pendingStatus;
      status.classList.add(`${SCRIPT_ID}-visible`);
    }

    return overlay;
  }

  function showStatus(text, timeout = 2600) {
    state.pendingStatus = text;
    const player = getPlayerRoot();
    if (!player) return;

    ensureOverlay();
    const status = document.getElementById(STATUS_ID);
    if (!status) return;

    status.textContent = text;
    status.classList.add(`${SCRIPT_ID}-visible`);
    window.clearTimeout(status.dataset.timerId);
    status.dataset.timerId = String(window.setTimeout(() => {
      status.classList.remove(`${SCRIPT_ID}-visible`);
      if (state.pendingStatus === text) state.pendingStatus = '';
    }, timeout));
  }

  function setCaptionText(text) {
    const overlay = ensureOverlay();
    if (!overlay) return;

    const line = overlay.querySelector(`.${SCRIPT_ID}-line`);
    if (line) line.textContent = text || '';
    overlay.classList.toggle(`${SCRIPT_ID}-visible`, Boolean(text));
  }

  function getPlayerResponseFromScripts(videoId) {
    const scripts = Array.from(document.scripts).reverse();
    for (const script of scripts) {
      const text = script.textContent || '';
      const marker = 'ytInitialPlayerResponse';
      const markerIndex = text.indexOf(marker);
      if (markerIndex === -1) continue;

      const start = text.indexOf('{', markerIndex);
      if (start === -1) continue;

      const jsonText = extractBalancedJson(text, start);
      if (!jsonText) continue;

      try {
        const parsed = JSON.parse(jsonText);
        if (!videoId || parsed?.videoDetails?.videoId === videoId) return parsed;
      } catch (error) {
        log('script player response parse failed', error);
      }
    }
    return null;
  }

  function extractBalancedJson(text, start) {
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i += 1) {
      const char = text[i];

      if (inString) {
        if (escape) {
          escape = false;
        } else if (char === '\\') {
          escape = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }

    return '';
  }

  function getPlayerResponse(videoId) {
    if (window.ytInitialPlayerResponse?.videoDetails?.videoId === videoId) {
      return window.ytInitialPlayerResponse;
    }

    const playerResponse = window.ytplayer?.config?.args?.player_response;
    if (playerResponse) {
      try {
        const parsed = typeof playerResponse === 'string' ? JSON.parse(playerResponse) : playerResponse;
        if (!videoId || parsed?.videoDetails?.videoId === videoId) return parsed;
      } catch (error) {
        log('ytplayer player_response parse failed', error);
      }
    }

    return getPlayerResponseFromScripts(videoId);
  }

  function selectEnglishTrack(playerResponse) {
    const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    if (!tracks.length) return null;

    return tracks.find(track => SOURCE_LANG_RE.test(track.languageCode || '') && track.isTranslatable !== false) ||
      tracks.find(track => SOURCE_LANG_RE.test(track.languageCode || '')) ||
      tracks.find(track => track.isTranslatable !== false) ||
      null;
  }

  function makeTranslatedUrl(baseUrl) {
    const url = new URL(baseUrl, location.origin);
    url.searchParams.set('fmt', 'json3');
    url.searchParams.set('tlang', TARGET_LANG);
    return url.toString();
  }

  async function fetchCaptionJson(url) {
    const response = await fetch(url, {
      credentials: 'include',
      cache: 'force-cache'
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('YouTube 字幕接口暂时限流，请稍后刷新页面重试。');
      }
      throw new Error(`Caption request failed: ${response.status}`);
    }

    const text = await response.text();
    if (!text.trim()) {
      throw new Error('YouTube 当前返回空字幕内容，播放器本身也可能显示“无法显示字幕”。');
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      return parseTimedTextXml(text);
    }
  }

  function parseTimedTextXml(text) {
    const xml = new DOMParser().parseFromString(text, 'text/xml');
    const nodes = Array.from(xml.querySelectorAll('text'));
    return {
      events: nodes.map(node => ({
        tStartMs: Math.round(Number(node.getAttribute('start') || 0) * 1000),
        dDurationMs: Math.round(Number(node.getAttribute('dur') || 2) * 1000),
        segs: [{ utf8: node.textContent || '' }]
      }))
    };
  }

  function normalizeCues(captionJson) {
    return (captionJson?.events || [])
      .filter(event => Array.isArray(event.segs))
      .map(event => {
        const start = Number(event.tStartMs || 0) / 1000;
        const duration = Number(event.dDurationMs || 0) / 1000;
        const text = event.segs
          .map(seg => seg.utf8 || '')
          .join('')
          .replace(/\s+\n/g, '\n')
          .replace(/\n\s+/g, '\n')
          .trim();

        return {
          start,
          end: start + Math.max(duration, 0.75),
          text
        };
      })
      .filter(cue => cue.text && !/^\s*$/.test(cue.text))
      .sort((a, b) => a.start - b.start);
  }

  async function loadCaptions(videoId, token) {
    if (!videoId) return;

    if (cache.has(videoId)) {
      applyCues(videoId, cache.get(videoId), token);
      return;
    }

    const response = getPlayerResponse(videoId);
    const track = selectEnglishTrack(response);

    if (!track?.baseUrl) {
      state.cues = [];
      setCaptionText('');
      showStatus('没有找到可翻译英文字幕');
      return;
    }

    showStatus('正在生成简体中文字幕...');
    const captionUrl = makeTranslatedUrl(track.baseUrl);
    const captionJson = await fetchCaptionJson(captionUrl);
    const cues = normalizeCues(captionJson);

    if (!cues.length) {
      throw new Error('Translated caption track is empty');
    }

    cache.set(videoId, cues);
    applyCues(videoId, cues, token);
  }

  function applyCues(videoId, cues, token) {
    if (token !== state.loadToken || videoId !== state.videoId) return;

    state.cues = cues;
    state.cueIndex = -1;
    showStatus(`简体中文字幕已加载：${cues.length} 条`);
    startSyncLoop();
  }

  function findCueIndex(time) {
    const cues = state.cues;
    if (!cues.length) return -1;

    const current = state.cueIndex;
    if (current >= 0) {
      const cue = cues[current];
      if (time >= cue.start && time <= cue.end) return current;
      const next = cues[current + 1];
      if (next && time >= next.start && time <= next.end) return current + 1;
    }

    let low = 0;
    let high = cues.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const cue = cues[mid];
      if (time < cue.start) {
        high = mid - 1;
      } else if (time > cue.end) {
        low = mid + 1;
      } else {
        return mid;
      }
    }

    return -1;
  }

  function syncCaption() {
    const video = getVideoEl();
    if (!video || !state.enabled || !state.cues.length) {
      setCaptionText('');
    } else {
      const index = findCueIndex(video.currentTime);
      state.cueIndex = index;
      setCaptionText(index >= 0 ? state.cues[index].text : '');
    }

    state.rafId = window.setTimeout(syncCaption, CHECK_INTERVAL_MS);
  }

  function startSyncLoop() {
    if (state.rafId) window.clearTimeout(state.rafId);
    syncCaption();
  }

  function resetForVideo(videoId) {
    state.videoId = videoId;
    state.cues = [];
    state.cueIndex = -1;
    state.loadToken += 1;
    setCaptionText('');

    const token = state.loadToken;
    loadCaptions(videoId, token).catch(error => {
      if (token !== state.loadToken) return;
      console.warn(`[${SCRIPT_ID}]`, error);
      showStatus(error?.message || '简体中文字幕生成失败，请刷新或稍后重试', 6000);
    });
  }

  function checkRoute() {
    const videoId = getVideoId();
    const routeKey = `${location.href}::${videoId}`;
    ensureOverlay();

    if (videoId && routeKey !== state.lastUrl) {
      state.lastUrl = routeKey;
      resetForVideo(videoId);
    }
  }

  function hookYouTubeNavigation() {
    window.addEventListener('yt-navigate-finish', checkRoute, true);
    window.addEventListener('yt-page-data-updated', checkRoute, true);
    window.addEventListener('popstate', checkRoute, true);
    state.routeTimer = window.setInterval(checkRoute, ROUTE_INTERVAL_MS);
  }

  function init() {
    if (document.documentElement.dataset[SCRIPT_DATA_KEY]) return;
    document.documentElement.dataset[SCRIPT_DATA_KEY] = '1';

    injectStyle();
    hookYouTubeNavigation();
    checkRoute();
  }

  init();
})();
