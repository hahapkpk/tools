// ==UserScript==
// @name         YouTube English Auto Captions to Simplified Chinese
// @namespace    https://github.com/hahapkpk/tools
// @version      0.4.0
// @description  Shows clean Simplified Chinese or bilingual subtitles on YouTube using YouTube caption translation data.
// @match        https://www.youtube.com/watch*
// @match        https://www.youtube.com/shorts/*
// @match        https://www.youtube.com/embed/*
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/youtube-auto-zh-hans-captions.user.js
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/youtube-auto-zh-hans-captions.user.js
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_ID = 'codex-yt-auto-zh-hans-captions';
  const SCRIPT_DATA_KEY = 'codexYtAutoZhHansCaptions';
  const STYLE_ID = `${SCRIPT_ID}-style`;
  const OVERLAY_ID = `${SCRIPT_ID}-overlay`;
  const STATUS_ID = `${SCRIPT_ID}-status`;
  const CONTROL_ID = `${SCRIPT_ID}-controls`;
  const CACHE_PREFIX = `${SCRIPT_ID}:cache:`;
  const SETTINGS_KEY = `${SCRIPT_ID}:settings`;
  const DEBUG = false;
  const CHECK_INTERVAL_MS = 120;
  const ROUTE_INTERVAL_MS = 800;
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const TARGET_LANG = 'zh-Hans';
  const SOURCE_LANG_RE = /^en(?:-|$)/i;
  const CHINESE_LANG_RE = /^(?:zh|zh-Hans|zh-CN)(?:-|$)/i;

  const defaultSettings = {
    enabled: true,
    mode: 'zh',
    fontSize: 28,
    position: 8,
    offsetMs: -200,
    hideNative: true,
    voiceEnabled: false,
    voiceRate: 1.08,
    originalVolume: 0.25
  };

  const state = {
    videoId: '',
    cues: [],
    rawTargetCues: [],
    rawSourceCues: [],
    cueIndex: -1,
    lastUrl: '',
    loadToken: 0,
    pendingStatus: '',
    rafId: 0,
    routeTimer: 0,
    spokenCueIndex: -1,
    originalVolumeBeforeVoice: null,
    videoHooked: null,
    settings: loadSettings()
  };

  const memoryCache = new Map();
  const log = (...args) => DEBUG && console.log(`[${SCRIPT_ID}]`, ...args);

  function loadSettings() {
    try {
      return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch {
      return { ...defaultSettings };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        position: absolute;
        left: 7%;
        right: 7%;
        bottom: calc(var(--${SCRIPT_ID}-bottom, 8) * 1%);
        z-index: 2147483000;
        display: flex;
        justify-content: center;
        pointer-events: none;
        opacity: 0;
        transition: opacity 100ms ease;
      }
      #${OVERLAY_ID}.${SCRIPT_ID}-visible { opacity: 1; }
      #${OVERLAY_ID} .${SCRIPT_ID}-box {
        max-width: min(1120px, 100%);
        padding: 0.18em 0.46em 0.24em;
        border-radius: 4px;
        background: rgba(0, 0, 0, 0.68);
        color: #fff;
        font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif;
        font-size: calc(var(--${SCRIPT_ID}-font-size, 28) * 1px);
        font-weight: 700;
        line-height: 1.32;
        text-align: center;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
        white-space: pre-wrap;
        word-break: break-word;
      }
      #${OVERLAY_ID} .${SCRIPT_ID}-source {
        display: block;
        margin-top: 0.16em;
        font-size: 0.62em;
        font-weight: 500;
        opacity: 0.86;
      }
      #${STATUS_ID}, #${CONTROL_ID} {
        position: absolute;
        z-index: 2147483001;
        border-radius: 4px;
        background: rgba(18, 18, 18, 0.88);
        color: #fff;
        font-family: Arial, "Microsoft YaHei", sans-serif;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.32);
      }
      #${STATUS_ID} {
        right: 12px;
        bottom: 58px;
        max-width: min(520px, 70%);
        padding: 5px 8px;
        font-size: 12px;
        line-height: 1.45;
        pointer-events: none;
        opacity: 0;
        transition: opacity 180ms ease;
      }
      #${STATUS_ID}.${SCRIPT_ID}-visible { opacity: 1; }
      #${CONTROL_ID} {
        right: 12px;
        top: 12px;
        display: none;
        width: 286px;
        padding: 10px;
        font-size: 12px;
        line-height: 1.4;
        pointer-events: auto;
      }
      #${CONTROL_ID}.${SCRIPT_ID}-visible { display: block; }
      #${CONTROL_ID} .${SCRIPT_ID}-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin: 7px 0;
      }
      #${CONTROL_ID} label { color: rgba(255,255,255,0.82); }
      #${CONTROL_ID} button, #${CONTROL_ID} select, #${CONTROL_ID} input {
        border: 1px solid rgba(255,255,255,0.22);
        border-radius: 4px;
        background: rgba(255,255,255,0.1);
        color: #fff;
        font: inherit;
      }
      #${CONTROL_ID} button {
        min-height: 26px;
        padding: 3px 8px;
        cursor: pointer;
      }
      #${CONTROL_ID} select { height: 26px; min-width: 96px; }
      #${CONTROL_ID} input[type="range"] { width: 145px; }
      #${CONTROL_ID} .${SCRIPT_ID}-buttons {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
        margin-top: 8px;
      }
      .${SCRIPT_ID}-hide-native .ytp-caption-window-container,
      .${SCRIPT_ID}-hide-native .ytp-caption-segment {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  function getVideoId() {
    const url = new URL(location.href);
    if (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/embed/')) {
      return url.pathname.split('/').filter(Boolean)[1] || '';
    }
    return url.searchParams.get('v') || '';
  }

  function getPlayerRoot() {
    return document.querySelector('.html5-video-player') ||
      document.querySelector('#movie_player') ||
      document.querySelector('ytd-player') ||
      document.querySelector('#shorts-player') ||
      document.body;
  }

  function getVideoEl() {
    return document.querySelector('video.html5-main-video') || document.querySelector('video');
  }

  function ensureOverlay() {
    injectStyle();
    const player = getPlayerRoot();
    if (!player) return null;
    if (getComputedStyle(player).position === 'static') player.style.position = 'relative';

    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      const box = document.createElement('div');
      box.className = `${SCRIPT_ID}-box`;
      overlay.appendChild(box);
    } else if (!overlay.querySelector(`.${SCRIPT_ID}-box`)) {
      const box = document.createElement('div');
      box.className = `${SCRIPT_ID}-box`;
      overlay.replaceChildren(box);
    }
    if (overlay.parentElement !== player) player.appendChild(overlay);

    let status = document.getElementById(STATUS_ID);
    if (!status) {
      status = document.createElement('div');
      status.id = STATUS_ID;
    }
    if (status.parentElement !== player) player.appendChild(status);

    ensureControls(player);
    applyVisualSettings();
    if (state.pendingStatus && !status.classList.contains(`${SCRIPT_ID}-visible`)) {
      status.textContent = state.pendingStatus;
      status.classList.add(`${SCRIPT_ID}-visible`);
    }
    return overlay;
  }

  function makeButton(text, title, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    if (title) button.title = title;
    button.addEventListener('click', onClick);
    return button;
  }

  function makeRow(labelText, control) {
    const row = document.createElement('div');
    row.className = `${SCRIPT_ID}-row`;
    const label = document.createElement('label');
    label.textContent = labelText;
    row.append(label, control);
    return row;
  }

  function ensureControls(player) {
    let panel = document.getElementById(CONTROL_ID);
    if (panel) {
      if (panel.parentElement !== player) player.appendChild(panel);
      return panel;
    }

    panel = document.createElement('div');
    panel.id = CONTROL_ID;

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = state.settings.enabled;
    enabled.addEventListener('change', () => updateSetting('enabled', enabled.checked));

    const mode = document.createElement('select');
    for (const [value, text] of [['zh', '中文'], ['bilingual', '双语']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      mode.appendChild(option);
    }
    mode.value = state.settings.mode;
    mode.addEventListener('change', () => updateSetting('mode', mode.value));

    const fontSize = document.createElement('input');
    fontSize.type = 'range';
    fontSize.min = '18';
    fontSize.max = '42';
    fontSize.step = '1';
    fontSize.value = String(state.settings.fontSize);
    fontSize.addEventListener('input', () => updateSetting('fontSize', Number(fontSize.value)));

    const position = document.createElement('input');
    position.type = 'range';
    position.min = '4';
    position.max = '24';
    position.step = '1';
    position.value = String(state.settings.position);
    position.addEventListener('input', () => updateSetting('position', Number(position.value)));

    const offset = document.createElement('select');
    for (const value of [-800, -500, -300, 0, 300, 500, 800]) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${value > 0 ? '+' : ''}${value}ms`;
      offset.appendChild(option);
    }
    offset.value = String(state.settings.offsetMs);
    offset.addEventListener('change', () => updateSetting('offsetMs', Number(offset.value)));

    const hideNative = document.createElement('input');
    hideNative.type = 'checkbox';
    hideNative.checked = state.settings.hideNative;
    hideNative.addEventListener('change', () => updateSetting('hideNative', hideNative.checked));

    const voiceEnabled = document.createElement('input');
    voiceEnabled.type = 'checkbox';
    voiceEnabled.checked = state.settings.voiceEnabled;
    voiceEnabled.addEventListener('change', () => updateSetting('voiceEnabled', voiceEnabled.checked));

    const voiceRate = document.createElement('select');
    for (const value of [0.85, 1, 1.08, 1.18, 1.3]) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${value}x`;
      voiceRate.appendChild(option);
    }
    voiceRate.value = String(state.settings.voiceRate);
    voiceRate.addEventListener('change', () => updateSetting('voiceRate', Number(voiceRate.value)));

    const originalVolume = document.createElement('select');
    for (const [value, text] of [[0, '静音'], [0.25, '25%'], [0.5, '50%'], [1, '原音量']]) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = text;
      originalVolume.appendChild(option);
    }
    originalVolume.value = String(state.settings.originalVolume);
    originalVolume.addEventListener('change', () => updateSetting('originalVolume', Number(originalVolume.value)));

    const buttons = document.createElement('div');
    buttons.className = `${SCRIPT_ID}-buttons`;
    buttons.append(
      makeButton('重新加载', '重新加载字幕', () => reloadCurrentVideo(true)),
      makeButton('SRT', '导出 .srt 字幕', () => downloadSubtitle('srt')),
      makeButton('VTT', '导出 .vtt 字幕', () => downloadSubtitle('vtt')),
      makeButton('TXT', '导出 .txt 文本', () => downloadSubtitle('txt')),
      makeButton('清缓存', '清除当前视频字幕缓存', () => clearCurrentCache()),
      makeButton('关闭', '关闭面板', () => panel.classList.remove(`${SCRIPT_ID}-visible`))
    );

    panel.append(
      makeRow('启用', enabled),
      makeRow('模式', mode),
      makeRow('字号', fontSize),
      makeRow('位置', position),
      makeRow('字幕延迟', offset),
      makeRow('隐藏原生字幕', hideNative),
      makeRow('中文配音', voiceEnabled),
      makeRow('配音语速', voiceRate),
      makeRow('原声音量', originalVolume),
      buttons
    );
    player.appendChild(panel);
    return panel;
  }

  function updateSetting(key, value) {
    state.settings[key] = value;
    saveSettings();
    syncControlValues();
    applyVisualSettings();
    applyVoiceSettings();
    renderCurrentCue();
  }

  function applyVisualSettings() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      overlay.style.setProperty(`--${SCRIPT_ID}-font-size`, String(state.settings.fontSize));
      overlay.style.setProperty(`--${SCRIPT_ID}-bottom`, String(state.settings.position));
    }
    document.documentElement.classList.toggle(`${SCRIPT_ID}-hide-native`, Boolean(state.settings.hideNative));
  }

  function syncControlValues() {
    const panel = document.getElementById(CONTROL_ID);
    if (!panel) return;
    const inputs = panel.querySelectorAll('input, select');
    for (const input of inputs) {
      const rowText = input.parentElement?.innerText || '';
      if (input.type === 'checkbox') {
        if (rowText.includes('启用') && !rowText.includes('中文配音')) input.checked = state.settings.enabled;
        if (rowText.includes('隐藏原生字幕')) input.checked = state.settings.hideNative;
        if (rowText.includes('中文配音')) input.checked = state.settings.voiceEnabled;
        continue;
      }
      if (input.parentElement?.innerText?.includes('配音语速')) input.value = String(state.settings.voiceRate);
      if (input.parentElement?.innerText?.includes('原声音量')) input.value = String(state.settings.originalVolume);
    }
  }

  function applyVoiceSettings() {
    const video = getVideoEl();
    if (!video) return;
    if (state.settings.voiceEnabled) {
      if (state.originalVolumeBeforeVoice === null) state.originalVolumeBeforeVoice = video.volume;
      video.volume = clamp(Number(state.settings.originalVolume), 0, 1);
      hookVideoEvents(video);
    } else {
      cancelSpeech();
      state.spokenCueIndex = -1;
      if (state.originalVolumeBeforeVoice !== null) {
        video.volume = clamp(state.originalVolumeBeforeVoice, 0, 1);
        state.originalVolumeBeforeVoice = null;
      }
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  }

  function showStatus(text, timeout = 3500) {
    state.pendingStatus = text;
    ensureOverlay();
    const status = document.getElementById(STATUS_ID);
    if (!status) return;
    status.textContent = text;
    status.classList.add(`${SCRIPT_ID}-visible`);
    window.clearTimeout(Number(status.dataset.timerId || 0));
    status.dataset.timerId = String(window.setTimeout(() => {
      status.classList.remove(`${SCRIPT_ID}-visible`);
      if (state.pendingStatus === text) state.pendingStatus = '';
    }, timeout));
  }

  function setCaption(cue) {
    const overlay = ensureOverlay();
    if (!overlay) return;
    const box = overlay.querySelector(`.${SCRIPT_ID}-box`);
    if (!box) return;
    box.textContent = '';
    if (!cue || !state.settings.enabled) {
      overlay.classList.remove(`${SCRIPT_ID}-visible`);
      return;
    }

    box.appendChild(document.createTextNode(cue.text));
    if (state.settings.mode === 'bilingual' && cue.sourceText) {
      const source = document.createElement('span');
      source.className = `${SCRIPT_ID}-source`;
      source.textContent = cue.sourceText;
      box.appendChild(source);
    }
    overlay.classList.add(`${SCRIPT_ID}-visible`);
  }

  function getPlayerResponse(videoId) {
    if (window.ytInitialPlayerResponse?.videoDetails?.videoId === videoId) return window.ytInitialPlayerResponse;
    const playerResponse = window.ytplayer?.config?.args?.player_response;
    if (playerResponse) {
      try {
        const parsed = typeof playerResponse === 'string' ? JSON.parse(playerResponse) : playerResponse;
        if (!videoId || parsed?.videoDetails?.videoId === videoId) return parsed;
      } catch (error) {
        log('ytplayer parse failed', error);
      }
    }
    return getPlayerResponseFromScripts(videoId);
  }

  function getPlayerResponseFromScripts(videoId) {
    for (const script of Array.from(document.scripts).reverse()) {
      const text = script.textContent || '';
      const markerIndex = text.indexOf('ytInitialPlayerResponse');
      if (markerIndex === -1) continue;
      const start = text.indexOf('{', markerIndex);
      if (start === -1) continue;
      const jsonText = extractBalancedJson(text, start);
      if (!jsonText) continue;
      try {
        const parsed = JSON.parse(jsonText);
        if (!videoId || parsed?.videoDetails?.videoId === videoId) return parsed;
      } catch (error) {
        log('script parse failed', error);
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
        if (escape) escape = false;
        else if (char === '\\') escape = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return '';
  }

  function selectBestCaptionSource(playerResponse) {
    const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const directChinese = tracks.find(track => CHINESE_LANG_RE.test(track.languageCode || '') && track.baseUrl);
    if (directChinese) {
      return { kind: 'direct-zh', targetTrack: directChinese, sourceTrack: null, needsTranslation: false };
    }

    const english = tracks.find(track => SOURCE_LANG_RE.test(track.languageCode || '') && track.baseUrl && track.isTranslatable !== false) ||
      tracks.find(track => SOURCE_LANG_RE.test(track.languageCode || '') && track.baseUrl) ||
      tracks.find(track => track.baseUrl && track.isTranslatable !== false);

    if (!english) return null;
    return { kind: 'translated-en', targetTrack: english, sourceTrack: english, needsTranslation: true };
  }

  function getClientContextParams() {
    const client = window.ytcfg?.data_?.INNERTUBE_CONTEXT?.client || {};
    return {
      xorb: '2',
      xobt: '3',
      xovt: '3',
      cbr: client.browserName || 'Chrome',
      cbrver: client.browserVersion || '',
      c: client.clientName || 'WEB',
      cver: client.clientVersion || window.ytcfg?.data_?.INNERTUBE_CONTEXT_CLIENT_VERSION || '',
      cplayer: 'UNIPLAYER',
      cos: client.osName || 'Windows',
      cosver: client.osVersion || '',
      cplatform: 'DESKTOP'
    };
  }

  function makeCaptionUrl(track, options = {}) {
    const url = new URL(track.baseUrl, location.origin);
    url.searchParams.set('fmt', 'json3');
    if (options.translate) url.searchParams.set('tlang', TARGET_LANG);
    else url.searchParams.delete('tlang');
    if (track.kind && !url.searchParams.has('kind')) url.searchParams.set('kind', track.kind);
    if (track.languageCode && !url.searchParams.has('lang')) url.searchParams.set('lang', track.languageCode);
    for (const [key, value] of Object.entries(getClientContextParams())) {
      if (value) url.searchParams.set(key, value);
    }
    return url.toString();
  }

  async function fetchCaptionJson(url) {
    const response = await fetch(url, { credentials: 'include', cache: 'force-cache' });
    if (!response.ok) throw classifyCaptionError(response.status);
    const text = await response.text();
    if (!text.trim()) throw new Error('YouTube 当前返回空字幕内容。');
    try {
      return JSON.parse(text);
    } catch {
      return parseTimedTextXml(text);
    }
  }

  async function fetchCaptionJsonWithFallback(videoId, track, options = {}) {
    const tried = new Set();
    let lastError = null;
    const tryUrl = async url => {
      if (!url || tried.has(url)) return null;
      tried.add(url);
      try {
        return await fetchCaptionJson(url);
      } catch (error) {
        lastError = error;
        return null;
      }
    };

    for (const url of findPerformanceCaptionUrls(videoId, options.translate)) {
      const json = await tryUrl(url);
      if (json) return json;
    }

    const json = await tryUrl(makeCaptionUrl(track, options));
    if (json) return json;

    await primeNativeCaptionRequest(track, options.translate);
    for (const url of findPerformanceCaptionUrls(videoId, options.translate)) {
      const jsonFromNativeUrl = await tryUrl(url);
      if (jsonFromNativeUrl) return jsonFromNativeUrl;
    }

    throw lastError || new Error('字幕接口没有返回可用内容。');
  }

  function findPerformanceCaptionUrls(videoId, translate) {
    return performance.getEntriesByType('resource')
      .map(entry => entry.name)
      .filter(name => {
        if (!name.includes('/api/timedtext')) return false;
        try {
          const url = new URL(name);
          if (url.searchParams.get('v') !== videoId) return false;
          const tlang = url.searchParams.get('tlang');
          return translate ? tlang === TARGET_LANG : !tlang;
        } catch {
          return false;
        }
      })
      .reverse();
  }

  async function primeNativeCaptionRequest(track, translate) {
    const player = document.getElementById('movie_player');
    if (!player || typeof player.setOption !== 'function') return;
    const nativeTrack = {
      languageCode: track.languageCode || 'en',
      languageName: getTrackName(track) || 'English',
      displayName: translate ? `${getTrackName(track) || 'English'} >> 中文（简体）` : getTrackName(track) || 'English',
      kind: track.kind || '',
      name: track.name?.simpleText || '',
      id: null,
      is_servable: false,
      is_default: false,
      is_translateable: track.isTranslatable !== false,
      vss_id: track.vssId || track.vss_id || ''
    };
    if (translate) {
      nativeTrack.translationLanguage = { languageCode: TARGET_LANG, languageName: '中文（简体）' };
    }

    try {
      player.setOption('captions', 'track', nativeTrack);
      await sleep(1200);
    } catch (error) {
      log('native caption priming failed', error);
    }
  }

  function getTrackName(track) {
    return track?.name?.simpleText || track?.name?.runs?.map(run => run.text).join('') || track?.languageCode || '';
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function classifyCaptionError(status) {
    if (status === 401 || status === 403) return new Error('字幕接口被权限或地区限制拦截。');
    if (status === 404) return new Error('当前视频没有可用字幕轨道。');
    if (status === 429) return new Error('YouTube 字幕接口暂时限流，请稍后刷新页面重试。');
    return new Error(`字幕接口请求失败：${status}`);
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

  function normalizeRawCues(captionJson) {
    return (captionJson?.events || [])
      .filter(event => Array.isArray(event.segs))
      .map(event => {
        const start = Number(event.tStartMs || 0) / 1000;
        const duration = Number(event.dDurationMs || 0) / 1000;
        const text = cleanCaptionText(event.segs.map(seg => seg.utf8 || '').join(''));
        return { start, end: start + Math.max(duration, 0.7), text };
      })
      .filter(cue => cue.text)
      .sort((a, b) => a.start - b.start);
  }

  function cleanCaptionText(text) {
    return text
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([，。！？；：,.!?;:])/g, '$1')
      .trim();
  }

  function mergeSentenceCues(rawCues) {
    const merged = [];
    let current = null;
    for (const cue of rawCues) {
      if (!current) {
        current = { ...cue };
        continue;
      }

      const gap = cue.start - current.end;
      const shouldSplit = /[。！？.!?]\s*$/.test(current.text) ||
        gap > 0.8 ||
        countTextUnits(current.text) >= 34 ||
        current.text.includes('\n');

      if (shouldSplit) {
        merged.push(limitLines(current));
        current = { ...cue };
      } else {
        current.text = cleanCaptionText(`${current.text}${needsSpace(current.text, cue.text) ? ' ' : ''}${cue.text}`);
        current.end = Math.max(current.end, cue.end);
      }
    }
    if (current) merged.push(limitLines(current));
    return merged;
  }

  function countTextUnits(text) {
    return Array.from(text.replace(/\s/g, '')).length;
  }

  function needsSpace(left, right) {
    return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
  }

  function limitLines(cue) {
    const maxChars = 32;
    const text = cue.text.replace(/\n+/g, ' ');
    if (countTextUnits(text) <= maxChars) return { ...cue, text };
    const breakAt = findBreakPoint(text, maxChars);
    return { ...cue, text: `${text.slice(0, breakAt).trim()}\n${text.slice(breakAt).trim()}` };
  }

  function findBreakPoint(text, maxChars) {
    const chars = Array.from(text);
    let visible = 0;
    let candidate = -1;
    for (let i = 0; i < chars.length; i += 1) {
      if (!/\s/.test(chars[i])) visible += 1;
      if (/[，,、;；]\s*$/.test(chars.slice(Math.max(0, i - 1), i + 1).join('')) || chars[i] === ' ') candidate = i + 1;
      if (visible >= maxChars) return candidate > 8 ? candidate : i + 1;
    }
    return Math.ceil(chars.length / 2);
  }

  function attachSourceText(targetCues, sourceRawCues) {
    if (!sourceRawCues.length) return targetCues;
    const sourceMerged = mergeSentenceCues(sourceRawCues);
    return targetCues.map(cue => ({
      ...cue,
      sourceText: findOverlappingText(cue, sourceMerged)
    }));
  }

  function findOverlappingText(cue, sources) {
    const center = (cue.start + cue.end) / 2;
    const source = sources.find(item => center >= item.start - 0.25 && center <= item.end + 0.25) ||
      sources.reduce((best, item) => Math.abs(((item.start + item.end) / 2) - center) < Math.abs(((best.start + best.end) / 2) - center) ? item : best, sources[0]);
    return source?.text || '';
  }

  function getCacheKey(videoId, source) {
    return `${CACHE_PREFIX}${videoId}:${source.kind}:${TARGET_LANG}:v3`;
  }

  function readCachedCues(key) {
    if (memoryCache.has(key)) return memoryCache.get(key);
    try {
      const cached = JSON.parse(localStorage.getItem(key) || 'null');
      if (!cached || Date.now() - cached.savedAt > CACHE_TTL_MS) return null;
      memoryCache.set(key, cached.data);
      return cached.data;
    } catch {
      return null;
    }
  }

  function writeCachedCues(key, data) {
    memoryCache.set(key, data);
    try {
      localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
    } catch {
      log('localStorage cache write failed');
    }
  }

  async function loadCaptions(videoId, token, force = false) {
    if (!videoId) return;
    const response = getPlayerResponse(videoId);
    const source = selectBestCaptionSource(response);
    if (!source?.targetTrack?.baseUrl) throw new Error('没有找到可翻译的字幕轨道。');

    const cacheKey = getCacheKey(videoId, source);
    if (!force) {
      const cached = readCachedCues(cacheKey);
      if (cached) {
        applyCues(videoId, cached, token, '已从缓存加载字幕');
        return;
      }
    }

    showStatus(source.needsTranslation ? '正在读取 YouTube 自动翻译字幕...' : '正在读取 YouTube 中文字幕...');
    const targetJson = await fetchCaptionJsonWithFallback(videoId, source.targetTrack, { translate: source.needsTranslation });
    const targetRaw = normalizeRawCues(targetJson);
    let sourceRaw = [];
    if (source.sourceTrack?.baseUrl) {
      try {
        const sourceJson = await fetchCaptionJsonWithFallback(videoId, source.sourceTrack, { translate: false });
        sourceRaw = normalizeRawCues(sourceJson);
      } catch (error) {
        log('source caption load failed', error);
      }
    }

    const mergedTarget = attachSourceText(mergeSentenceCues(targetRaw), sourceRaw);
    if (!mergedTarget.length) throw new Error('字幕接口返回了空字幕。');
    const data = { cues: mergedTarget, rawTargetCues: targetRaw, rawSourceCues: sourceRaw, sourceKind: source.kind };
    writeCachedCues(cacheKey, data);
    applyCues(videoId, data, token, `中文字幕已加载：${mergedTarget.length} 句`);
  }

  function applyCues(videoId, data, token, statusText) {
    if (token !== state.loadToken || videoId !== state.videoId) return;
    state.cues = data.cues || [];
    state.rawTargetCues = data.rawTargetCues || [];
    state.rawSourceCues = data.rawSourceCues || [];
    state.cueIndex = -1;
    showStatus(statusText);
    startSyncLoop();
  }

  function findCueIndex(time) {
    const adjusted = time + (Number(state.settings.offsetMs) || 0) / 1000;
    const cues = state.cues;
    if (!cues.length) return -1;
    const current = state.cueIndex;
    if (current >= 0) {
      const cue = cues[current];
      if (adjusted >= cue.start && adjusted <= cue.end) return current;
      const next = cues[current + 1];
      if (next && adjusted >= next.start && adjusted <= next.end) return current + 1;
    }
    let low = 0;
    let high = cues.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const cue = cues[mid];
      if (adjusted < cue.start) high = mid - 1;
      else if (adjusted > cue.end) low = mid + 1;
      else return mid;
    }
    return -1;
  }

  function renderCurrentCue() {
    const video = getVideoEl();
    if (!video || !state.settings.enabled || !state.cues.length) {
      setCaption(null);
      return;
    }
    hookVideoEvents(video);
    const index = findCueIndex(video.currentTime);
    state.cueIndex = index;
    const cue = index >= 0 ? state.cues[index] : null;
    setCaption(cue);
    syncVoice(cue, index, video);
  }

  function syncCaption() {
    renderCurrentCue();
    state.rafId = window.setTimeout(syncCaption, CHECK_INTERVAL_MS);
  }

  function startSyncLoop() {
    if (state.rafId) window.clearTimeout(state.rafId);
    syncCaption();
  }

  function hookVideoEvents(video) {
    if (!video || state.videoHooked === video) return;
    if (state.videoHooked) {
      state.videoHooked.removeEventListener('pause', handleVideoPause);
      state.videoHooked.removeEventListener('seeking', handleVideoSeeking);
      state.videoHooked.removeEventListener('play', handleVideoPlay);
    }
    state.videoHooked = video;
    video.addEventListener('pause', handleVideoPause);
    video.addEventListener('seeking', handleVideoSeeking);
    video.addEventListener('play', handleVideoPlay);
    applyVoiceSettings();
  }

  function handleVideoPause() {
    if (state.settings.voiceEnabled && window.speechSynthesis?.speaking) {
      window.speechSynthesis.pause();
    }
  }

  function handleVideoPlay() {
    if (state.settings.voiceEnabled && window.speechSynthesis?.paused) {
      window.speechSynthesis.resume();
    }
  }

  function handleVideoSeeking() {
    cancelSpeech();
    state.spokenCueIndex = -1;
  }

  function syncVoice(cue, index, video) {
    if (!state.settings.voiceEnabled || !cue || index < 0 || video.paused) return;
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance !== 'function') {
      showStatus('当前浏览器不支持中文配音');
      updateSetting('voiceEnabled', false);
      return;
    }
    if (index === state.spokenCueIndex) return;
    state.spokenCueIndex = index;
    speakCue(cue);
  }

  function speakCue(cue) {
    const text = cue.text.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2) return;
    cancelSpeech();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = getSpeechRate(text);
    utterance.pitch = 1;
    utterance.volume = 1;
    const voice = selectChineseVoice();
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  }

  function getSpeechRate(text) {
    const base = clamp(Number(state.settings.voiceRate), 0.7, 1.6);
    if (text.length > 60) return clamp(base + 0.12, 0.7, 1.6);
    if (text.length < 12) return clamp(base - 0.08, 0.7, 1.6);
    return base;
  }

  function selectChineseVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    return voices.find(voice => /zh[-_]?CN/i.test(voice.lang)) ||
      voices.find(voice => /^zh/i.test(voice.lang)) ||
      voices.find(voice => /Chinese|中文|普通话|Mandarin/i.test(voice.name)) ||
      null;
  }

  function cancelSpeech() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  function reloadCurrentVideo(force = false) {
    const videoId = getVideoId();
    if (!videoId) return;
    state.videoId = videoId;
    state.cues = [];
    state.rawTargetCues = [];
    state.rawSourceCues = [];
    state.cueIndex = -1;
    state.spokenCueIndex = -1;
    cancelSpeech();
    state.loadToken += 1;
    setCaption(null);
    const token = state.loadToken;
    loadCaptions(videoId, token, force).catch(error => {
      if (token !== state.loadToken) return;
      console.warn(`[${SCRIPT_ID}]`, error);
      showStatus(error?.message || '简体中文字幕生成失败，请刷新或稍后重试。', 7000);
    });
  }

  function clearCurrentCache() {
    const videoId = getVideoId();
    if (!videoId) return;
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(`${CACHE_PREFIX}${videoId}:`)) localStorage.removeItem(key);
    }
    for (const key of Array.from(memoryCache.keys())) {
      if (key.startsWith(`${CACHE_PREFIX}${videoId}:`)) memoryCache.delete(key);
    }
    showStatus('当前视频字幕缓存已清除');
  }

  function downloadSubtitle(format) {
    if (!state.cues.length) {
      showStatus('当前没有可导出的字幕');
      return;
    }
    const base = `youtube-${state.videoId || 'captions'}-zh-Hans`;
    const content = format === 'srt' ? toSrt(state.cues) : format === 'vtt' ? toVtt(state.cues) : toText(state.cues);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function toSrt(cues) {
    return cues.map((cue, i) => `${i + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}${cue.sourceText && state.settings.mode === 'bilingual' ? `\n${cue.sourceText}` : ''}\n`).join('\n');
  }

  function toVtt(cues) {
    return `WEBVTT\n\n${cues.map(cue => `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${cue.text}${cue.sourceText && state.settings.mode === 'bilingual' ? `\n${cue.sourceText}` : ''}\n`).join('\n')}`;
  }

  function toText(cues) {
    return cues.map(cue => cue.text.replace(/\n/g, ' ')).join('\n');
  }

  function formatSrtTime(seconds) {
    return formatTime(seconds, ',');
  }

  function formatVttTime(seconds) {
    return formatTime(seconds, '.');
  }

  function formatTime(seconds, msSep) {
    const ms = Math.max(0, Math.round(seconds * 1000));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const milli = ms % 1000;
    return `${pad(h)}:${pad(m)}:${pad(s)}${msSep}${String(milli).padStart(3, '0')}`;
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function hookKeyboard() {
    document.addEventListener('keydown', event => {
      if (event.altKey && event.shiftKey && event.code === 'KeyZ') {
        toggleControlPanel();
      }
    }, true);
  }

  function toggleControlPanel() {
    const existingPanel = document.getElementById(CONTROL_ID);
    ensureOverlay();
    const panel = document.getElementById(CONTROL_ID);
    if (!panel) return;
    panel.classList.toggle(`${SCRIPT_ID}-visible`);
    if (!existingPanel && panel.classList.contains(`${SCRIPT_ID}-visible`)) {
      showStatus('字幕面板已打开');
    }
  }

  function registerTampermonkeyMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('打开/关闭字幕控制面板', () => toggleControlPanel());
    GM_registerMenuCommand('重新加载中文字幕', () => reloadCurrentVideo(true));
    GM_registerMenuCommand('启用/停用自定义字幕', () => updateSetting('enabled', !state.settings.enabled));
    GM_registerMenuCommand('启用/停用中文配音', () => updateSetting('voiceEnabled', !state.settings.voiceEnabled));
  }

  function checkRoute() {
    ensureOverlay();
    const videoId = getVideoId();
    const routeKey = `${location.href}::${videoId}`;
    if (videoId && routeKey !== state.lastUrl) {
      state.lastUrl = routeKey;
      reloadCurrentVideo(false);
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
    hookKeyboard();
    registerTampermonkeyMenu();
    hookYouTubeNavigation();
    checkRoute();
  }

  init();
})();
