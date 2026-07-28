// ==UserScript==
// @name         Bilibili 桌面版大缓冲实验播放器
// @namespace    https://github.com/hahapkpk/tools
// @version      0.2.1
// @description  B 站桌面大缓冲替换播放器：画质/编码切换、长按倍速、4K/AV1、可调前向缓冲、暂停预加载、连续快进合并和手动换 CDN。
// @author       hahapkpk & ChatGPT
// @match        https://www.bilibili.com/video/*
// @homepageURL  https://github.com/hahapkpk/tools/blob/main/bilibili-desktop-large-buffer.user.js
// @supportURL   https://github.com/hahapkpk/tools/issues
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/bilibili-desktop-large-buffer.user.js
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/bilibili-desktop-large-buffer.user.js
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @require      https://raw.githubusercontent.com/hahapkpk/tools/main/bilibili-large-buffer/v0.2.1/chunk-0.js
// @require      https://raw.githubusercontent.com/hahapkpk/tools/main/bilibili-large-buffer/v0.2.1/chunk-1.js
// @require      https://raw.githubusercontent.com/hahapkpk/tools/main/bilibili-large-buffer/v0.2.1/chunk-2.js
// @require      https://raw.githubusercontent.com/hahapkpk/tools/main/bilibili-large-buffer/v0.2.1/chunk-3.js
// @require      https://cdn.jsdelivr.net/npm/artplayer@5.4.1/dist/artplayer.js
// @require      https://cdn.jsdelivr.net/npm/dashjs@5.0.3/dist/modern/umd/dash.all.min.js
// ==/UserScript==

(async function () {
  'use strict';

  try {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('当前浏览器不支持 DecompressionStream，请使用最新版 Chrome/Edge。');
    }

    const ArtPlayerDependency =
      (typeof Artplayer !== 'undefined' ? Artplayer : undefined) ||
      unsafeWindow.Artplayer ||
      globalThis.Artplayer;
    const DashDependency =
      (typeof dashjs !== 'undefined' ? dashjs : undefined) ||
      unsafeWindow.dashjs ||
      globalThis.dashjs;

    if (!ArtPlayerDependency) throw new Error('ArtPlayer 依赖未加载');
    if (!DashDependency?.MediaPlayer) throw new Error('dash.js 依赖未加载');

    const chunks = globalThis.__BILI_LARGE_BUFFER_CHUNKS__;
    if (!Array.isArray(chunks) || chunks.length !== 4) {
      throw new Error(`播放器核心加载不完整：${Array.isArray(chunks) ? chunks.length : 0}/4`);
    }

    const encoded = chunks.join('');
    delete globalThis.__BILI_LARGE_BUFFER_CHUNKS__;

    const bytes = Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const source = await new Response(stream).text();
    const run = new Function(
      'unsafeWindow',
      'GM_getValue',
      'GM_setValue',
      'GM_registerMenuCommand',
      'Artplayer',
      'dashjs',
      source
    );

    run(
      unsafeWindow,
      GM_getValue,
      GM_setValue,
      GM_registerMenuCommand,
      ArtPlayerDependency,
      DashDependency
    );
  } catch (err) {
    console.error('[BiliLargeBuffer Loader]', err);
    alert(`Bilibili 大缓冲播放器加载失败：\n${err?.message || err}`);
  }
})();
