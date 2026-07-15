// ==UserScript==
// @name         X 视频简体中文字幕
// @namespace    https://github.com/hahapkpk/tools
// @version      1.0.1
// @description  X (Twitter) 视频自动转写 + 翻译 + 简体中文字幕叠加显示，无需配音
// @author       hahapkpk
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      111.46.161.132
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/x-zh-hans-captions.user.js
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/x-zh-hans-captions.user.js
// ==/UserScript==

(function() {
  'use strict';

  // ═══════════════════════════════════════════════════════
  // CONFIG & STATE
  // ═══════════════════════════════════════════════════════
  const DEFAULT_CONFIG = {
    apiUrl: 'http://111.46.161.132:8788',
    apiToken: '',
    sourceLang: 'auto',   // auto / en / ja / ko / zh
    showBilingual: true,   // 双语字幕
    fontSize: 18,
    opacity: 0.85,
  };

  let config = Object.assign({}, DEFAULT_CONFIG, GM_getValue('x-captions-config', {}));

  // Per-tweet state: tweetId -> { mediaUrl, jobId, segments, status }
  const tweetState = new Map();
  let currentTweetId = null;
  let subtitleObserver = null;

  // ═══════════════════════════════════════════════════════
  // 1. FETCH / XHR INTERCEPTION — Capture video URLs
  // ═══════════════════════════════════════════════════════
  function extractVideoUrls(jsonText) {
    const urls = [];
    try {
      // Match all video.twimg.com URLs in the JSON
      const re = /https?:\/\/video\.twimg\.com\/[^"'\s<>\\]+/g;
      let m;
      while ((m = re.exec(jsonText)) !== null) {
        // Clean trailing escapes
        const clean = m[0].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
        urls.push(clean);
      }
    } catch(e) {}
    return urls;
  }

  function pickBestMp4(urls) {
    // Prefer highest bitrate MP4
    const mp4s = urls.filter(u => /\.mp4(\?|$)/i.test(u));
    if (mp4s.length === 0) return urls[0] || null;
    // X URLs sometimes encode bitrate in the path; just return the last (usually highest quality)
    return mp4s[mp4s.length - 1];
  }

  function extractTweetIdFromUrl(urls) {
    // Try to find tweet ID from amplify_video path
    for (const u of urls) {
      const m = u.match(/amplify_video\/(\d+)/);
      if (m) return m[1];
      const m2 = u.match(/tweet_video\/(\d+)/);
      if (m2) return m2[1];
    }
    return null;
  }

  function extractTweetIdFromResponse(jsonText) {
    try {
      const data = JSON.parse(jsonText);
      const entries = data?.data?.threaded_conversation_with_injections_v2?.instructions
        || data?.data?.threaded_conversation_with_injections?.instructions
        || [];
      for (const inst of entries) {
        if (inst.type === 'TimelineAddEntries' || inst.entries) {
          for (const entry of (inst.entries || [])) {
            const tweetResult = entry?.content?.itemContent?.tweet_results?.result
              || entry?.content?.itemContent?.tweet_result?.result;
            if (tweetResult?.rest_id) return tweetResult.rest_id;
            // Check for tweet with tombstone or other wrappers
            const inner = tweetResult?.tweet;
            if (inner?.rest_id) return inner.rest_id;
          }
        }
      }
    } catch(e) {}
    return null;
  }

  // Hook fetch
  const _origFetch = window.fetch;
  window.fetch = function(...args) {
    const p = _origFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');

    p.then(resp => {
      if (resp && resp.ok) {
        const ct = resp.headers?.get?.('content-type') || '';
        if (ct.includes('json') || url.includes('graphql') || url.includes('TweetDetail') || url.includes('TweetResult')) {
          resp.clone().text().then(text => {
            const videoUrls = extractVideoUrls(text);
            if (videoUrls.length > 0) {
              const best = pickBestMp4(videoUrls);
              // Try to find tweet ID from response or URL
              let tid = extractTweetIdFromResponse(text) || extractTweetIdFromUrl(videoUrls);
              if (!tid) {
                // Use current page tweet ID
                tid = getCurrentTweetId();
              }
              if (tid && best) {
                if (!tweetState.has(tid)) tweetState.set(tid, {});
                tweetState.get(tid).mediaUrl = best;
                console.log('[X-Captions] Captured video URL for tweet', tid, best.substring(0, 80));
              }
            }
          }).catch(() => {});
        }
      }
    }).catch(() => {});

    return p;
  };

  // Hook XHR
  const _origXHROpen = XMLHttpRequest.prototype.open;
  const _origXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this._xurl = url;
    return _origXHROpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('load', function() {
      try {
        if (this.status === 200 && this.responseText) {
          const videoUrls = extractVideoUrls(this.responseText);
          if (videoUrls.length > 0) {
            const best = pickBestMp4(videoUrls);
            let tid = extractTweetIdFromResponse(this.responseText) || extractTweetIdFromUrl(videoUrls);
            if (!tid) tid = getCurrentTweetId();
            if (tid && best) {
              if (!tweetState.has(tid)) tweetState.set(tid, {});
              tweetState.get(tid).mediaUrl = best;
              console.log('[X-Captions] XHR captured video URL for tweet', tid);
            }
          }
        }
      } catch(e) {}
    });
    return _origXHRSend.apply(this, arguments);
  };

  // ═══════════════════════════════════════════════════════
  // 2. TWEET ID DETECTION
  // ═══════════════════════════════════════════════════════
  function getCurrentTweetId() {
    const m = location.pathname.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  // Also capture from page URL changes (SPA)
  let lastPath = '';
  function checkRoute() {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      currentTweetId = getCurrentTweetId();
      if (currentTweetId) {
        console.log('[X-Captions] Route changed, tweet:', currentTweetId);
        updateFloatingButton();
      }
    }
  }

  // Watch for SPA navigation
  const _origPushState = history.pushState;
  history.pushState = function() { _origPushState.apply(this, arguments); checkRoute(); };
  const _origReplaceState = history.replaceState;
  history.replaceState = function() { _origReplaceState.apply(this, arguments); checkRoute(); };
  window.addEventListener('popstate', checkRoute);

  // ═══════════════════════════════════════════════════════
  // 3. FRESH VIDEO URL FETCHER — fetch from X API on demand
  // ═══════════════════════════════════════════════════════
  async function fetchFreshVideoUrl(tweetId) {
    const csrf = (document.cookie.match(/ct0=([^;]+)/) || ['', ''])[1];
    if (!csrf) throw new Error('无法获取 X 认证信息，请刷新页面后重试');

    const graphqlHash = '0h6HC0GBNRjGqIudVmBwLQ'; // TweetDetail query ID
    const vars = JSON.stringify({
      focalTweetId: tweetId,
      includePromotedContent: false,
      withBirdwatchNotes: false,
    });

    const url = `/i/api/graphql/${graphqlHash}/TweetDetail?variables=${encodeURIComponent(vars)}`;

    const resp = await fetch(url, {
      headers: {
        'x-csrf-token': csrf,
        'content-type': 'application/json',
      },
      credentials: 'include',
    });

    if (!resp.ok) throw new Error('X API 请求失败: ' + resp.status);
    const data = await resp.json();

    // Navigate the X API response structure
    const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions
      || data?.data?.threaded_conversation_with_injections?.instructions || [];

    for (const inst of instructions) {
      const entries = inst.entries || [];
      for (const entry of entries) {
        const result = entry?.content?.itemContent?.tweet_results?.result
          || entry?.content?.itemContent?.tweet?.result;
        if (!result) continue;
        const media = result?.legacy?.extended_entities?.media || result?.extended_entities?.media || [];
        for (const m of media) {
          const variants = (m.video_info || {}).variants || [];
          if (variants.length === 0) continue;
          // Filter MP4, pick highest bitrate
          const mp4s = variants.filter(v => v.content_type === 'video/mp4');
          if (mp4s.length === 0) continue;
          mp4s.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
          return mp4s[0].url;
        }
      }
    }
    throw new Error('未在推文中找到视频');
  }

  // ═══════════════════════════════════════════════════════
  // 4. CLOUD API
  // ═══════════════════════════════════════════════════════
  function apiRequest(method, path, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: method,
        url: config.apiUrl + path,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + config.apiToken,
        },
        data: body ? JSON.stringify(body) : undefined,
        timeout: 30000,
        onload: function(resp) {
          try {
            resolve(JSON.parse(resp.responseText));
          } catch(e) {
            reject(new Error('Invalid JSON: ' + resp.responseText.substring(0, 200)));
          }
        },
        onerror: function(err) { reject(new Error('Network error')); },
        ontimeout: function() { reject(new Error('Timeout')); },
      });
    });
  }

  async function startTranscription(tweetId, mediaUrl) {
    const st = tweetState.get(tweetId) || {};
    st.status = 'transcribing';
    tweetState.set(tweetId, st);

    try {
      const result = await apiRequest('POST', '/v1/transcriptions', {
        mediaUrl: mediaUrl,
        sourceId: 'x-' + tweetId,
        sourceLanguage: config.sourceLang === 'auto' ? undefined : config.sourceLang,
      });

      if (result.jobId) {
        st.jobId = result.jobId;
        st.status = 'polling';
        tweetState.set(tweetId, st);
        return pollJob(tweetId, result.jobId);
      } else {
        throw new Error(result.message || 'No jobId returned');
      }
    } catch(e) {
      st.status = 'error';
      st.error = e.message;
      tweetState.set(tweetId, st);
      throw e;
    }
  }

  async function pollJob(tweetId, jobId) {
    const st = tweetState.get(tweetId) || {};
    let attempts = 0;
    const maxAttempts = 120; // 4 minutes at 2s intervals

    while (attempts < maxAttempts) {
      await new Promise(r => setTimeout(r, 2000));
      attempts++;

      try {
        const job = await apiRequest('GET', '/v1/jobs/' + jobId);
        st.status = job.status;
        st.progress = job.progress || 0;

        if (job.status === 'completed') {
          st.segments = job.segments || [];
          st.translatedSegments = job.translatedSegments || [];
          tweetState.set(tweetId, st);
          renderSubtitles(tweetId);
          return st;
        }

        if (job.status === 'failed') {
          throw new Error(job.message || 'Transcription failed');
        }

        updateFloatingButton();
      } catch(e) {
        if (attempts > 3) {
          st.status = 'error';
          st.error = e.message;
          tweetState.set(tweetId, st);
          throw e;
        }
      }
    }

    throw new Error('Transcription timed out');
  }

  // ═══════════════════════════════════════════════════════
  // 4. SUBTITLE RENDERING
  // ═══════════════════════════════════════════════════════
  let subtitleContainer = null;
  let currentSubIndex = -1;

  function createSubtitleContainer() {
    if (subtitleContainer) subtitleContainer.remove();

    subtitleContainer = document.createElement('div');
    subtitleContainer.id = 'x-captions-subtitle-box';
    subtitleContainer.style.cssText = `
      position: absolute;
      bottom: 60px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 99999;
      pointer-events: none;
      text-align: center;
      max-width: 90%;
      padding: 6px 14px;
      border-radius: 6px;
      background: rgba(0,0,0,${config.opacity});
      color: #fff;
      font-size: ${config.fontSize}px;
      line-height: 1.5;
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      transition: opacity 0.2s;
      display: none;
    `;
    return subtitleContainer;
  }

  function renderSubtitles(tweetId) {
    const st = tweetState.get(tweetId);
    if (!st || !st.segments || st.segments.length === 0) return;

    // Use translated segments if available, fallback to original
    const segs = st.translatedSegments && st.translatedSegments.length > 0
      ? st.translatedSegments : st.segments;

    const video = document.querySelector('video');
    if (!video) return;

    // Attach container to video's parent
    const videoParent = video.closest('[data-testid="videoPlayer"]') || video.parentElement;
    if (!videoParent) return;
    videoParent.style.position = 'relative';

    const container = createSubtitleContainer();
    videoParent.appendChild(container);

    // Sync subtitles with video time
    function updateSubtitle() {
      const t = video.currentTime;
      let found = null;
      for (let i = 0; i < segs.length; i++) {
        if (t >= segs[i].start && t <= segs[i].end) {
          found = segs[i];
          currentSubIndex = i;
          break;
        }
      }

      if (found) {
        container.style.display = 'block';
        let text = found.text || '';
        // If bilingual, show original + translation
        if (config.showBilingual && st.segments[i] && st.segments[i].text !== text) {
          text = `<span style="opacity:0.7;font-size:${config.fontSize - 3}px">${escHtml(st.segments[currentSubIndex]?.text || '')}</span><br>${escHtml(text)}`;
        } else {
          text = escHtml(text);
        }
        container.innerHTML = text;
      } else {
        container.style.display = 'none';
      }
    }

    video.addEventListener('timeupdate', updateSubtitle);
    video.addEventListener('seeked', updateSubtitle);

    // Initial render
    updateSubtitle();
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ═══════════════════════════════════════════════════════
  // 5. FLOATING BUTTON
  // ═══════════════════════════════════════════════════════
  let floatingBtn = null;

  function createFloatingButton() {
    if (floatingBtn) return;

    floatingBtn = document.createElement('div');
    floatingBtn.id = 'x-captions-float-btn';
    floatingBtn.innerHTML = '字';
    floatingBtn.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 20px;
      z-index: 99998;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #1d9bf0;
      color: #fff;
      font-size: 20px;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      transition: transform 0.2s, background 0.2s;
      user-select: none;
      font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
    `;

    floatingBtn.addEventListener('mouseenter', () => floatingBtn.style.transform = 'scale(1.1)');
    floatingBtn.addEventListener('mouseleave', () => floatingBtn.style.transform = 'scale(1)');
    floatingBtn.addEventListener('click', onFloatClick);

    document.body.appendChild(floatingBtn);
  }

  function updateFloatingButton() {
    if (!floatingBtn) return;
    const tid = currentTweetId;
    const st = tid ? tweetState.get(tid) : null;

    if (st && st.status === 'transcribing') {
      floatingBtn.innerHTML = '⏳';
      floatingBtn.style.background = '#f59e0b';
    } else if (st && st.status === 'polling') {
      floatingBtn.innerHTML = Math.round(st.progress || 0) + '%';
      floatingBtn.style.background = '#f59e0b';
      floatingBtn.style.fontSize = '11px';
    } else if (st && st.status === 'completed') {
      floatingBtn.innerHTML = '✓';
      floatingBtn.style.background = '#10b981';
    } else if (st && st.status === 'error') {
      floatingBtn.innerHTML = '✗';
      floatingBtn.style.background = '#ef4444';
    } else {
      floatingBtn.innerHTML = '字';
      floatingBtn.style.background = '#1d9bf0';
      floatingBtn.style.fontSize = '20px';
    }
  }

  async function onFloatClick() {
    const tid = currentTweetId;
    if (!tid) {
      showToast('当前页面没有推文视频');
      return;
    }

    const st = tweetState.get(tid);
    if (st && st.status === 'completed') {
      if (subtitleContainer) {
        subtitleContainer.style.display = subtitleContainer.style.display === 'none' ? 'block' : 'none';
      }
      return;
    }

    if (st && (st.status === 'transcribing' || st.status === 'polling')) {
      showToast('转写进行中... ' + Math.round(st.progress || 0) + '%');
      return;
    }

    if (!config.apiUrl || !config.apiToken) {
      openControlPanel();
      showToast('请先配置 API 地址和 Token');
      return;
    }

    // Fetch a fresh video URL from X API immediately
    showToast('🔍 获取视频地址...');
    try {
      const freshUrl = await fetchFreshVideoUrl(tid);
      console.log('[X-Captions] Fresh URL:', freshUrl.substring(0, 80));
      if (!tweetState.has(tid)) tweetState.set(tid, {});
      tweetState.get(tid).mediaUrl = freshUrl;

      showToast('🔄 开始云端转写...');
      await startTranscription(tid, freshUrl);
      showToast('✅ 转写完成！字幕已加载');
      updateFloatingButton();
    } catch(e) {
      showToast('❌ ' + e.message);
      updateFloatingButton();
    }
  }

  // ═══════════════════════════════════════════════════════
  // 6. CONTROL PANEL
  // ═══════════════════════════════════════════════════════
  let panel = null;

  function openControlPanel() {
    if (panel) { panel.style.display = 'block'; return; }

    panel = document.createElement('div');
    panel.id = 'x-captions-panel';
    panel.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 100000;
      width: 420px;
      max-height: 80vh;
      overflow-y: auto;
      background: #15202b;
      color: #e7e9ea;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: 14px;
      padding: 24px;
    `;

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h2 style="margin:0;font-size:18px">🎬 X 视频中文字幕</h2>
        <button id="xcp-close" style="background:none;border:none;color:#e7e9ea;font-size:20px;cursor:pointer">✕</button>
      </div>

      <div style="margin-bottom:16px">
        <label style="display:block;margin-bottom:4px;color:#8b98a5;font-size:12px">云端服务地址</label>
        <input id="xcp-url" type="text" value="${escHtml(config.apiUrl)}" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #38444d;background:#253341;color:#e7e9ea;box-sizing:border-box">
      </div>

      <div style="margin-bottom:16px">
        <label style="display:block;margin-bottom:4px;color:#8b98a5;font-size:12px">API Token</label>
        <input id="xcp-token" type="password" value="${escHtml(config.apiToken)}" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid #38444d;background:#253341;color:#e7e9ea;box-sizing:border-box">
      </div>

      <div style="display:flex;gap:12px;margin-bottom:16px">
        <div style="flex:1">
          <label style="display:block;margin-bottom:4px;color:#8b98a5;font-size:12px">源语言</label>
          <select id="xcp-lang" style="width:100%;padding:8px;border-radius:8px;border:1px solid #38444d;background:#253341;color:#e7e9ea">
            <option value="auto" ${config.sourceLang==='auto'?'selected':''}>自动检测</option>
            <option value="en" ${config.sourceLang==='en'?'selected':''}>English</option>
            <option value="ja" ${config.sourceLang==='ja'?'selected':''}>日本語</option>
            <option value="ko" ${config.sourceLang==='ko'?'selected':''}>한국어</option>
          </select>
        </div>
        <div style="flex:1">
          <label style="display:block;margin-bottom:4px;color:#8b98a5;font-size:12px">字幕大小</label>
          <input id="xcp-fontsize" type="number" min="12" max="36" value="${config.fontSize}" style="width:100%;padding:8px;border-radius:8px;border:1px solid #38444d;background:#253341;color:#e7e9ea;box-sizing:border-box">
        </div>
      </div>

      <div style="margin-bottom:20px;display:flex;align-items:center;gap:8px">
        <input id="xcp-bilingual" type="checkbox" ${config.showBilingual?'checked':''}>
        <label for="xcp-bilingual">显示双语字幕（原文 + 中文）</label>
      </div>

      <div style="display:flex;gap:10px">
        <button id="xcp-save" style="flex:1;padding:10px;border-radius:8px;border:none;background:#1d9bf0;color:#fff;font-weight:bold;cursor:pointer;font-size:14px">保存设置</button>
        <button id="xcp-transcribe" style="flex:1;padding:10px;border-radius:8px;border:none;background:#10b981;color:#fff;font-weight:bold;cursor:pointer;font-size:14px">云端转写当前视频</button>
      </div>

      <div id="xcp-status" style="margin-top:16px;padding:10px;border-radius:8px;background:#253341;min-height:20px;font-size:13px;color:#8b98a5"></div>
    `;

    document.body.appendChild(panel);

    // Events
    panel.querySelector('#xcp-close').onclick = () => panel.style.display = 'none';
    panel.querySelector('#xcp-save').onclick = saveConfig;
    panel.querySelector('#xcp-transcribe').onclick = panelTranscribe;
  }

  function saveConfig() {
    config.apiUrl = panel.querySelector('#xcp-url').value.trim();
    config.apiToken = panel.querySelector('#xcp-token').value.trim();
    config.sourceLang = panel.querySelector('#xcp-lang').value;
    config.fontSize = parseInt(panel.querySelector('#xcp-fontsize').value) || 18;
    config.showBilingual = panel.querySelector('#xcp-bilingual').checked;
    GM_setValue('x-captions-config', config);
    showToast('✅ 设置已保存');
    panel.querySelector('#xcp-status').textContent = '已保存';
  }

  async function panelTranscribe() {
    const tid = currentTweetId;
    if (!tid) {
      panel.querySelector('#xcp-status').textContent = '❌ 当前页面没有推文视频';
      return;
    }

    saveConfig();
    const statusEl = panel.querySelector('#xcp-status');
    statusEl.textContent = '🔍 获取视频地址...';

    try {
      const freshUrl = await fetchFreshVideoUrl(tid);
      statusEl.textContent = '🔄 正在转写...';
      if (!tweetState.has(tid)) tweetState.set(tid, {});
      tweetState.get(tid).mediaUrl = freshUrl;

      const result = await startTranscription(tid, freshUrl);
      const segCount = (result.segments || []).length;
      statusEl.textContent = `✅ 转写完成！共 ${segCount} 段字幕`;
      updateFloatingButton();
    } catch(e) {
      statusEl.textContent = '❌ ' + e.message;
      updateFloatingButton();
    }
  }

  // ═══════════════════════════════════════════════════════
  // 7. TOAST NOTIFICATIONS
  // ═══════════════════════════════════════════════════════
  function showToast(msg, duration = 3000) {
    let toast = document.getElementById('x-captions-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'x-captions-toast';
      toast.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 100001;
        padding: 10px 20px;
        border-radius: 8px;
        background: rgba(29,155,240,0.95);
        color: #fff;
        font-size: 14px;
        font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: opacity 0.3s;
        pointer-events: none;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.display = 'block';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.style.display = 'none', 300);
    }, duration);
  }

  // ═══════════════════════════════════════════════════════
  // 8. KEYBOARD SHORTCUT
  // ═══════════════════════════════════════════════════════
  document.addEventListener('keydown', function(e) {
    if (e.altKey && e.shiftKey && e.key === 'Z') {
      e.preventDefault();
      openControlPanel();
    }
  });

  // ═══════════════════════════════════════════════════════
  // 9. INIT
  // ═══════════════════════════════════════════════════════
  function init() {
    checkRoute();
    // Wait for body
    const waitForBody = setInterval(() => {
      if (document.body) {
        clearInterval(waitForBody);
        createFloatingButton();
        // Periodically check route (backup for SPA)
        setInterval(checkRoute, 2000);
      }
    }, 500);
  }

  init();
})();
