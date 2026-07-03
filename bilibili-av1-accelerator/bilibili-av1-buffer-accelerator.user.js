// ==UserScript==
// @name         Bilibili AV1 缓冲加速器
// @namespace    https://github.com/hahapkpk/tools
// @version      0.1.0
// @description  预取 AV1 视频分片（多连接并发），解决倍速播放卡顿问题。默认 AV1(177)，可在脚本开头的 CONFIG 中修改 codecId。
// @author       reasonix
// @match        https://www.bilibili.com/video/*
// @grant        GM.xmlHttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // ─── 配置 ──────────────────────────────────────────────
    const CONFIG = {
        codecId: 177,            // AV1 1080P（其他常用: 125=AVC-1080P, 32=HEVC-4K, 30216=AV1-4K）
        maxConcurrent: 4,        // 同时预取的最大 HTTP 连接数
        maxCacheSegments: 50,    // 缓存最多保留的分片数
        bufferThreshold: 30,     // 剩余缓冲低于此秒数时触发预取
        checkInterval: 500,      // 缓冲检查周期 (ms)
        minBufferForPrefetch: 60,// 预取目标：将缓冲拉到此秒数以上
    };

    // ─── 状态 ──────────────────────────────────────────────
    let cache = new Map();               // url → ArrayBuffer
    let cacheOrder = [];                 // 按访问时间的 URL 列表 (LRU)
    let videoEl = null;                  // <video> 元素
    let dashSegments = null;             // { urls: string[], initUrl: string|null }
    let prefetchPool = null;             // PrefetchPool 实例
    let lastPrefetchedIndex = -1;        // 已预取到的最后一个分片 index
    let monitorTimer = null;
    let enabled = true;

    // ─── 日志 ──────────────────────────────────────────────
    const LOG_PREFIX = '[BiliAV1Boost]';
    function log(...args) { console.log(LOG_PREFIX, ...args); }
    function warn(...args) { console.warn(LOG_PREFIX, ...args); }
    function err(...args) { console.error(LOG_PREFIX, ...args); }

    // ═══════════════════════════════════════════════════════════
    // 1. 并发预取池
    // ═══════════════════════════════════════════════════════════
    class PrefetchPool {
        constructor(maxConcurrent) {
            this.maxConcurrent = maxConcurrent;
            this.running = 0;
            this.queue = [];           // [{ url, resolve, reject }]
            this.aborted = false;
        }

        /** 添加一个预取任务，返回 Promise（完成或失败都 resolve，不抛错） */
        addTask(url) {
            if (this.aborted) return Promise.resolve(null);
            // 去重：如果已经在队列里或在跑，跳过
            if (this.queue.some(t => t.url === url)) return Promise.resolve(null);
            // 如果已经在缓存里，跳过
            if (cache.has(url)) return Promise.resolve(cache.get(url));

            return new Promise((resolve) => {
                this.queue.push({ url, resolve });
                this._drain();
            });
        }

        abort() {
            this.aborted = true;
            this.queue = [];
        }

        _drain() {
            while (this.running < this.maxConcurrent && this.queue.length > 0 && !this.aborted) {
                const task = this.queue.shift();
                this.running++;
                this._fetch(task.url)
                    .then(buf => {
                        if (buf && buf.byteLength > 0) {
                            _addToCache(task.url, buf);
                        }
                        task.resolve(buf);
                    })
                    .catch(e => {
                        // 静默失败，单个分片拉不到不影响整体
                        task.resolve(null);
                    })
                    .finally(() => {
                        this.running--;
                        this._drain();
                    });
            }
        }

        _fetch(url) {
            return new Promise((resolve, reject) => {
                GM.xmlHttpRequest({
                    method: 'GET',
                    url: url,
                    responseType: 'arraybuffer',
                    timeout: 10000,        // 10 秒超时
                    onload: (resp) => {
                        if (resp.status >= 200 && resp.status < 300) {
                            resolve(resp.response);
                        } else {
                            resolve(null);
                        }
                    },
                    onerror: () => resolve(null),
                    ontimeout: () => resolve(null),
                    onabort: () => resolve(null),
                });
            });
        }
    }

    // ─── 缓存管理 ──────────────────────────────────────────
    function _addToCache(url, buf) {
        // LRU 淘汰
        if (cache.size >= CONFIG.maxCacheSegments) {
            const oldest = cacheOrder.shift();
            cache.delete(oldest);
        }
        cache.set(url, buf);
        // 维护顺序（移到最新）
        const idx = cacheOrder.indexOf(url);
        if (idx > -1) cacheOrder.splice(idx, 1);
        cacheOrder.push(url);
    }

    function _touchCache(url) {
        const idx = cacheOrder.indexOf(url);
        if (idx > -1) cacheOrder.splice(idx, 1);
        cacheOrder.push(url);
    }

    // ═══════════════════════════════════════════════════════════
    // 2. DASH 分片信息获取
    // ═══════════════════════════════════════════════════════════

    /**
     * 尝试从多个来源获取 DASH 视频流信息
     * 返回匹配 codecId 的 video 对象，或 null
     */
    function getDashVideoStream(data) {
        if (!data || !data.dash || !data.dash.video) return null;
        const videos = data.dash.video;
        // 精确匹配 codecId
        let match = videos.find(v => v.id === CONFIG.codecId);
        if (!match) {
            // 回退：找任意 AV1 (codecid=13)
            match = videos.find(v => v.codecid === 13);
            if (match) {
                log(`未找到 id=${CONFIG.codecId}，使用 AV1 codecid=13 流 (id=${match.id})`);
            }
        }
        return match || null;
    }

    /**
     * 从 video stream 对象解析分片 URL 列表
     * 支持 segmentUrls / segments 字段，以及 base_url 回退
     */
    function parseSegmentUrls(videoStream) {
        const segments = [];

        // 方式1：segmentUrls 或 segments 数组
        const segList = videoStream.segmentUrls || videoStream.segment_urls ||
                        videoStream.segments || videoStream.Segments;
        if (segList && Array.isArray(segList) && segList.length > 0) {
            for (const seg of segList) {
                const url = typeof seg === 'string' ? seg : (seg.url || seg.Url || '');
                if (url) segments.push(url);
            }
            if (segments.length > 0) {
                log(`从 segmentUrls 解析到 ${segments.length} 个分片`);
                return segments;
            }
        }

        // 方式2：base_url 模板（无显式分片列表时回退）
        const baseUrl = videoStream.baseUrl || videoStream.base_url || videoStream.BaseURL || '';
        if (baseUrl) {
            // 仅一个 URL，作为单分片/整段处理
            segments.push(baseUrl);
            log(`使用 base_url 作为单个分片 URL`);
            return segments;
        }

        // 方式3：backup_url 数组
        const backupUrls = videoStream.backupUrl || videoStream.backup_url ||
                          videoStream.BackupURL || [];
        if (Array.isArray(backupUrls) && backupUrls.length > 0) {
            for (const u of backupUrls) {
                if (u) segments.push(u);
            }
            if (segments.length > 0) {
                log(`从 backup_url 解析到 ${segments.length} 个分片`);
                return segments;
            }
        }

        return segments;
    }

    /**
     * 扫描多个可能的数据源，提取 DASH 分片信息
     */
    function discoverDashInfo() {
        // 源1：window.__playinfo__
        const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        if (win.__playinfo__ && win.__playinfo__.data) {
            const video = getDashVideoStream(win.__playinfo__.data);
            if (video) {
                const urls = parseSegmentUrls(video);
                if (urls.length > 0) {
                    return { urls, initUrl: null, source: '__playinfo__' };
                }
            }
        }

        // 源2：window.__INITIAL_STATE__.videoData.dash
        if (win.__INITIAL_STATE__ && win.__INITIAL_STATE__.videoData) {
            const dash = win.__INITIAL_STATE__.videoData.dash;
            if (dash) {
                const video = getDashVideoStream({ dash });
                if (video) {
                    const urls = parseSegmentUrls(video);
                    if (urls.length > 0) {
                        return { urls, initUrl: null, source: '__INITIAL_STATE__' };
                    }
                }
            }
        }

        return null;
    }

    /**
     * 轮询等待 DASH 信息就绪，最多等 15 秒
     */
    function waitForDashInfo(maxWait = 15000) {
        return new Promise((resolve) => {
            const start = Date.now();
            function check() {
                const info = discoverDashInfo();
                if (info) {
                    resolve(info);
                    return;
                }
                if (Date.now() - start > maxWait) {
                    resolve(null);
                    return;
                }
                setTimeout(check, 300);
            }
            check();
        });
    }

    // ═══════════════════════════════════════════════════════════
    // 3. fetch / XHR 劫持
    // ═══════════════════════════════════════════════════════════

    const M4S_PATTERN = /\.m4s(\?|$)/i;      // 匹配 .m4s 请求
    const BVIDEO_HOST = /bilivideo\.com/i;

    function isMediaSegment(url) {
        return M4S_PATTERN.test(url) && BVIDEO_HOST.test(url);
    }

    // ─── fetch 劫持 ────────────────────────────────────────
    const _origFetch = window.fetch;

    window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');

        if (!enabled || !isMediaSegment(url)) {
            return _origFetch.call(this, input, init);
        }

        // 命中缓存
        if (cache.has(url)) {
            _touchCache(url);
            const buf = cache.get(url);
            return Promise.resolve(new Response(buf, {
                status: 200,
                headers: { 'Content-Type': 'video/mp4', 'X-BiliAV1Boost': 'cached' },
            }));
        }

        // 未命中 → 透传，同时触发预取后续分片
        const promise = _origFetch.call(this, input, init);
        _onSegmentRequest(url);
        return promise;
    };

    // ─── XMLHttpRequest 劫持 ───────────────────────────────
    const _origXHROpen = XMLHttpRequest.prototype.open;
    const _origXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
        this._bili_url = typeof url === 'string' ? url : (url && url.toString ? url.toString() : '');
        this._bili_method = method;
        this._bili_cached = false;
        return _origXHROpen.call(this, method, url, async, user, password);
    };

    XMLHttpRequest.prototype.send = function (body) {
        const url = this._bili_url;

        if (!enabled || !url || !isMediaSegment(url) || !cache.has(url)) {
            // 未命中 → 透传，触发预取
            if (url && isMediaSegment(url)) _onSegmentRequest(url);
            return _origXHRSend.call(this, body);
        }

        // 命中缓存 → mock 响应
        _touchCache(url);
        const buf = cache.get(url);
        this._bili_cached = true;

        // 保存原始回调引用
        const origOnReadyStateChange = this.onreadystatechange;
        const self = this;

        // 异步模拟 XHR 生命周期（setTimeout 0 模拟网络响应的微任务）
        setTimeout(() => {
            // 模拟 readyState 变化
            Object.defineProperty(self, 'readyState', { value: 4, writable: false, configurable: true });
            Object.defineProperty(self, 'status', { value: 200, writable: false, configurable: true });
            Object.defineProperty(self, 'statusText', { value: 'OK', writable: false, configurable: true });
            Object.defineProperty(self, 'response', { value: buf, writable: false, configurable: true });
            Object.defineProperty(self, 'responseText', { value: '', writable: false, configurable: true });

            // 触发事件
            if (origOnReadyStateChange) {
                origOnReadyStateChange.call(self);
            }
            if (self.onload) {
                self.onload.call(self, new ProgressEvent('load'));
            }
            if (self.onloadend) {
                self.onloadend.call(self, new ProgressEvent('loadend'));
            }
        }, 0);

        // 仍调用原始 send 以保持兼容，但阻止真实请求
        // 部分播放器库可能检查 send 是否被调用
        return _origXHRSend.call(this, body);
    };

    // ═══════════════════════════════════════════════════════════
    // 4. 缓冲监控 & 预取触发
    // ═══════════════════════════════════════════════════════════

    let _lastSegmentRequestTime = 0;
    let _pendingSegmentUrls = new Set();   // 正在预取中的 URL

    /**
     * 播放器请求了某个分片 → 记录该 index，触发后续预取
     */
    function _onSegmentRequest(url) {
        if (!dashSegments || dashSegments.urls.length === 0) return;

        const now = Date.now();
        // 去抖：同一 URL 短时间内不去重触发
        if (now - _lastSegmentRequestTime < 100) return;
        _lastSegmentRequestTime = now;

        // 找到当前请求的 index
        const idx = dashSegments.urls.indexOf(url);
        if (idx >= 0) {
            _prefetchFrom(idx + 1);
        } else {
            // URL 不在已知列表里（可能是 init 或变体）→ 从当前已知位置继续
            _prefetchFrom(lastPrefetchedIndex + 1);
        }
    }

    /**
     * 从 fromIndex 开始预取后续分片，直到达到目标范围
     */
    function _prefetchFrom(fromIndex) {
        if (!dashSegments || !prefetchPool) return;

        const totalSegments = dashSegments.urls.length;
        // 预取目标：当前 index 往后最多 bufferThreshold 覆盖的分片
        // 估算每个分片 5 秒
        const segmentsToPrefetch = Math.max(
            Math.ceil(CONFIG.minBufferForPrefetch / 5),
            5  // 至少预取 5 片
        );
        const endIndex = Math.min(fromIndex + segmentsToPrefetch, totalSegments);

        for (let i = fromIndex; i < endIndex; i++) {
            const url = dashSegments.urls[i];
            if (!url) continue;
            if (cache.has(url)) continue;      // 已缓存
            if (_pendingSegmentUrls.has(url)) continue;  // 正在拉取

            _pendingSegmentUrls.add(url);
            prefetchPool.addTask(url).then(() => {
                _pendingSegmentUrls.delete(url);
            });

            lastPrefetchedIndex = Math.max(lastPrefetchedIndex, i);
        }
    }

    /**
     * 基于 video.buffered 和 currentTime 的监控循环
     */
    function _startBufferMonitor() {
        if (monitorTimer) return;

        monitorTimer = setInterval(() => {
            if (!enabled || !dashSegments || !videoEl) return;

            const currentTime = videoEl.currentTime;
            let bufferEnd = currentTime;
            try {
                if (videoEl.buffered && videoEl.buffered.length > 0) {
                    bufferEnd = videoEl.buffered.end(videoEl.buffered.length - 1);
                }
            } catch (e) { /* ignore */ }

            const bufferRemaining = bufferEnd - currentTime;

            if (bufferRemaining < CONFIG.bufferThreshold) {
                // 缓冲区不足 → 触发预取
                // 估计当前分片 index
                const estimatedSegDuration = dashSegments.urls.length > 0
                    ? (videoEl.duration || 600) / dashSegments.urls.length
                    : 5;
                const currentSegIndex = Math.floor(currentTime / estimatedSegDuration);
                const prefetchStart = Math.max(currentSegIndex, lastPrefetchedIndex + 1);
                _prefetchFrom(prefetchStart);
            }
        }, CONFIG.checkInterval);
    }

    // ═══════════════════════════════════════════════════════════
    // 5. 初始化流程
    // ═══════════════════════════════════════════════════════════

    /**
     * 寻找页面上的 <video> 元素
     */
    function _findVideo() {
        return new Promise((resolve) => {
            function check() {
                const v = document.querySelector('video');
                if (v && v.readyState >= 0) {
                    resolve(v);
                    return;
                }
                setTimeout(check, 500);
            }
            check();
        });
    }

    async function main() {
        log('启动 Bilibili AV1 缓冲加速器...');

        // Step 1: 等待 DASH 信息
        const dashInfo = await waitForDashInfo();
        if (!dashInfo) {
            warn('未能获取 DASH 分片信息（可能非 DASH 视频或 AV1 不可用），降级为被动缓存模式');
            // 无分片列表，仅靠 fetch/XHR 劫持做被动缓存（对已看过的分片 seek 回去有效）
            dashSegments = { urls: [], initUrl: null };
        } else {
            dashSegments = dashInfo;
            log(`获取到 ${dashSegments.urls.length} 个分片（来源: ${dashInfo.source}）`);
        }

        // Step 2: 初始化预取池
        prefetchPool = new PrefetchPool(CONFIG.maxConcurrent);

        // Step 3: 等待视频元素
        videoEl = await _findVideo();
        log('检测到视频元素');

        // Step 4: 启动缓冲监控
        _startBufferMonitor();
        log('缓冲监控已启动');

        // Step 5: 如果有分片列表，立即开始预取前几片
        if (dashSegments.urls.length > 0) {
            // 从第 0 片开始预取（覆盖初始加载）
            _prefetchFrom(0);
            log('开始首批预取...');
        }

        // Step 6: 监听画质切换（URL 变化时重新发现 DASH）
        const observer = new MutationObserver(() => {
            const newInfo = discoverDashInfo();
            if (newInfo && newInfo.urls.length > 0 &&
                JSON.stringify(newInfo.urls) !== JSON.stringify(dashSegments.urls)) {
                log('检测到分片列表变化，重新加载...');
                prefetchPool.abort();
                cache.clear();
                cacheOrder.length = 0;
                _pendingSegmentUrls.clear();
                lastPrefetchedIndex = -1;
                dashSegments = newInfo;
                prefetchPool = new PrefetchPool(CONFIG.maxConcurrent);
                _prefetchFrom(0);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        log('✅ 加速器就绪');
    }

    // ─── 启动 ──────────────────────────────────────────────
    // 等 DOM 开始渲染后启动（document-start 下 body 尚未就绪）
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            // 再等一拍确保 __playinfo__ 等全局变量赋值完成
            setTimeout(main, 0);
        });
    } else {
        setTimeout(main, 0);
    }

})();
