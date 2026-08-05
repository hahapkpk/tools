// ==UserScript==
// @name         iTab 海外网站名称与图标自动补全
// @namespace    https://github.com/hahapkpk/tools
// @version      1.0.0
// @description  为 iTab 添加海外网站时，用域名生成名称并提供通用 favicon，绕过元数据接口取不到墙外站点信息的问题。
// @match        chrome-extension://mhloojimgilafopcmlcikiidgbbnelip/newtab.html
// @include      chrome-extension://*/newtab.html
// @run-at       document-start
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const xhr = XMLHttpRequest.prototype;
  if (xhr.__itabWallSiteMetadataPatch) return;

  const nativeOpen = xhr.open;

  const knownNames = {
    'x.com': 'X',
    'twitter.com': 'X',
    'github.com': 'GitHub',
    'youtube.com': 'YouTube',
    'google.com': 'Google',
    'claude.ai': 'Claude',
    'chatgpt.com': 'ChatGPT',
    'openai.com': 'OpenAI',
    'discord.com': 'Discord',
    'reddit.com': 'Reddit',
    'huggingface.co': 'Hugging Face',
    'notion.so': 'Notion',
    'vercel.com': 'Vercel',
  };

  function getTargetUrl(rawUrl) {
    try {
      const requestUrl = new URL(rawUrl, location.href);
      if (requestUrl.hostname !== 'base.itab.link' || requestUrl.pathname !== '/website/info') {
        return null;
      }

      const target = requestUrl.searchParams.get('url');
      if (!target) return null;

      const pageUrl = new URL(target);
      if (!['http:', 'https:'].includes(pageUrl.protocol)) return null;
      return pageUrl;
    } catch (_) {
      return null;
    }
  }

  function getSiteName(hostname) {
    if (knownNames[hostname]) return knownNames[hostname];

    const parts = hostname.replace(/^www\./i, '').split('.');
    const base = parts.length > 2 ? parts[parts.length - 2] : parts[0];
    return base
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
      .slice(0, 18) || hostname.slice(0, 18);
  }

  function getFaviconUrl(hostname) {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=128`;
  }

  xhr.open = function patchedOpen(method, rawUrl, ...rest) {
    const target = getTargetUrl(String(rawUrl || ''));
    if (!target) return nativeOpen.call(this, method, rawUrl, ...rest);

    const hostname = target.hostname.toLowerCase();
    const icon = getFaviconUrl(hostname);
    const payload = JSON.stringify({
      data: {
        type: 1,
        src: icon,
        imgSrc: icon,
        name: getSiteName(hostname),
        backgroundColor: 'transparent',
      },
    });

    // iTab uses Axios/XHR. A same-origin blob response avoids CORS and keeps
    // iTab's existing “获取图标” flow and form state unchanged.
    const blobUrl = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    this.addEventListener('loadend', () => URL.revokeObjectURL(blobUrl), { once: true });
    return nativeOpen.call(this, 'GET', blobUrl, ...rest);
  };

  xhr.__itabWallSiteMetadataPatch = true;
  console.info('[iTab] 海外网站名称与图标补丁已启用');
})();
