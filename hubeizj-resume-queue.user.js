// ==UserScript==
// @name         湖北继续教育 · 一键续学
// @namespace    local.hubeizj.resume-queue
// @version      1.0.1
// @description  整理当前课程列表的待学课程，通过平台原有的按钮开始或继续学习。
// @match        https://hubeizj.chinamde.cn/me/courses*
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/hubeizj-resume-queue.user.js
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/hubeizj-resume-queue.user.js
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==
(() => {
  'use strict';

  const id = 'hubeizj-resume-queue';
  if (!document.body || document.getElementById(id)) return;
  const select = (prefix) => `[class*="${prefix}__"]`;
  const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const visible = (element) => Boolean(element?.isConnected && element.getClientRects().length &&
    !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
    getComputedStyle(element).visibility === 'visible');
  const lists = () => Array.from(document.querySelectorAll(select('MyCourses_course_list'))).filter(visible);

  function readEntry(card) {
    const button = card.querySelector(select('Course_continue'));
    const action = text(button);
    if (!['继续学习', '开始学习'].includes(action) || !visible(button) ||
        button.closest(':disabled, [aria-disabled="true"]') || getComputedStyle(button).pointerEvents === 'none') return null;
    const heading = card.querySelector(select('Course_courser_title'));
    const label = heading?.querySelector(':scope > span:last-child') ?? heading;
    const title = label?.getAttribute('title')?.trim() || text(label) || text(heading);
    if (!title) return null;
    const progress = Array.from(card.querySelectorAll(select('Course_progress')),
      (node) => text(node).match(/进度\s*[：:]?\s*(\d+(?:\.\d+)?)\s*[%％]/) ?? text(node).match(/^(\d+(?:\.\d+)?)\s*[%％]$/))
      .find(Boolean);
    const percent = progress ? Number(progress[1]) : null;
    if (percent !== null && percent >= 100) return null;
    return { card, button, title, action, percent };
  }

  function scan() {
    const list = lists()[0];
    const entries = list ? Array.from(list.querySelectorAll(select('Course_course_item')))
      .filter(visible).map(readEntry).filter(Boolean) : [];
    entries.sort((a, b) => Number(b.action === '继续学习') - Number(a.action === '继续学习') ||
      (b.percent ?? -1) - (a.percent ?? -1));
    return { list, entries };
  }

  const host = document.createElement('aside');
  host.id = id;
  host.setAttribute('aria-label', '湖北续学助手');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:min(340px,calc(100vw - 32px));font:14px/1.45 system-ui,sans-serif;color:#172c43}
      :host([hidden]){display:none}
      details{background:#fff;border:1px solid #a9c5db;border-radius:10px;box-shadow:0 4px 20px #17334930;overflow:hidden;max-height:calc(100vh - 32px)}
      summary{background:#15527f;color:#fff;padding:9px 12px;font-weight:650;cursor:pointer}
      .body{padding:10px}.scope{color:#415872;font-size:12px;margin:0 0 8px}
      button{font:inherit;cursor:pointer;text-align:left;width:100%;border-radius:6px;box-sizing:border-box}
      button:focus-visible,summary:focus-visible{outline:2px solid #0086bc;outline-offset:-2px}
      [data-resume]{background:#176ca6;color:white;border:0;padding:8px 10px;font-weight:650;text-align:center}
      [data-resume]:disabled{background:#e6edf4;color:#4b5e71;cursor:default}
      ul{list-style:none;margin:8px 0 0;padding:0;overflow:auto;max-height:min(34vh,260px);overscroll-behavior:contain}
      li+li{margin-top:5px}li button{border:1px solid #c9ddeb;background:#f4f9fd;color:#172c43;padding:6px 8px;overflow-wrap:anywhere}
      small{display:block;color:#405b76;margin-top:2px}
      [role=status]{margin:8px 0 0;color:#415872;font-size:12px;min-height:1.45em}
    </style>
    <details open>
      <summary>湖北续学助手</summary>
      <div class="body">
        <p class="scope">只列当前显示的课程，不修改学习进度。</p>
        <button type="button" data-resume disabled>一键续学</button>
        <ul aria-label="待学课程"></ul>
        <p role="status" aria-live="polite"></p>
      </div>
    </details>`;
  document.body.append(host);
  const resume = root.querySelector('[data-resume]');
  const queue = root.querySelector('ul');
  const status = root.querySelector('[role="status"]');
  let previous = null;

  function openEntry(entry) {
    const refreshed = entry && scan().entries.find((current) => current.button === entry.button);
    if (!refreshed) {
      refresh();
      status.textContent = '课程入口已变动，请重新选择。';
      return;
    }
    status.textContent = `正在打开：${refreshed.title}。若未跳转，请点击平台原按钮。`;
    // Keep this synchronous so the site can use the user's click to open its player.
    refreshed.button.click();
  }

  function refresh() {
    const { list, entries } = scan();
    host.hidden = !list;
    resume.disabled = !entries.length;
    if (previous && previous.length === entries.length && entries.every((entry, i) =>
      ['button', 'title', 'action', 'percent'].every((key) => entry[key] === previous[i][key]))) return;
    previous = entries;
    const rows = entries.map((entry) => {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.queueItem = '';
      const detail = document.createElement('small');
      detail.textContent = entry.percent === null ? entry.action : `${entry.action} · ${entry.percent}%`;
      button.append(entry.title, detail);
      button.addEventListener('click', () => openEntry(entry));
      row.append(button);
      return row;
    });
    queue.replaceChildren(...rows);
    status.textContent = entries.length ? `当前列表有 ${entries.length} 门可开始或续学。` : '当前列表没有待学课程。';
  }

  resume.addEventListener('click', () => openEntry(scan().entries[0]));
  const observer = new MutationObserver((records) => {
    if (timer !== null || records.every((record) => record.target === host)) return;
    timer = setTimeout(() => { timer = null; refresh(); }, 250);
  });
  let timer = null;
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'style', 'disabled', 'aria-disabled', 'aria-hidden', 'hidden', 'inert', 'title'] });
  refresh();
})();
