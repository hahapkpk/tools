// ==UserScript==
// @name         湖北继续教育 · 一键续学
// @namespace    local.hubeizj.resume-queue
// @version      1.2.0
// @description  整理待学课程、显示课件播放状态，可在课程列表确认完课后打开下一门。
// @match        https://hubeizj.chinamde.cn/me/courses*
// @match        https://hubeizj.chinamde.cn/play*
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
  const onRoute = (path) => location.pathname === path || location.pathname === `${path}/`;
  const onNavigation = (update) => {
    window.navigation?.addEventListener('currententrychange', update);
    window.addEventListener('popstate', update);
  };
  const lists = () => onRoute('/me/courses')
    ? Array.from(document.querySelectorAll(select('MyCourses_course_list'))).filter(visible) : [];

  function readCard(card) {
    const button = card.querySelector(select('Course_continue'));
    const action = text(button);
    const heading = card.querySelector(select('Course_courser_title'));
    const label = heading?.querySelector(':scope > span:last-child') ?? heading;
    const title = label?.getAttribute('title')?.trim() || text(label) || text(heading);
    if (!title) return null;
    const progress = Array.from(card.querySelectorAll(select('Course_progress')),
      (node) => text(node).match(/进度\s*[：:]?\s*(\d+(?:\.\d+)?)\s*[%％]/) ?? text(node).match(/^(\d+(?:\.\d+)?)\s*[%％]$/))
      .find(Boolean);
    const percent = progress ? Number(progress[1]) : null;
    return { card, button, title, action, percent };
  }

  function scan() {
    const list = lists()[0];
    const cards = list ? Array.from(list.querySelectorAll(select('Course_course_item')))
      .filter(visible).map(readCard).filter(Boolean) : [];
    const entries = cards.filter(({ action, button, percent }) =>
      ['继续学习', '开始学习'].includes(action) && (percent === null || percent < 100) && visible(button) &&
      !button.closest(':disabled, [aria-disabled="true"]') && getComputedStyle(button).pointerEvents !== 'none');
    entries.sort((a, b) => Number(b.action === '继续学习') - Number(a.action === '继续学习') ||
      (b.percent ?? -1) - (a.percent ?? -1));
    return { list, cards, entries };
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
        <p><label><input type="checkbox" data-auto-next> 返回列表后，已完课则打开下一门</label></p>
        <ul aria-label="待学课程"></ul>
        <p role="status" aria-live="polite"></p>
      </div>
    </details>`;
  document.body.append(host);
  const resume = root.querySelector('[data-resume]');
  const queue = root.querySelector('ul');
  const status = root.querySelector('[role="status"]');
  const autoNext = root.querySelector('[data-auto-next]');
  const autoKey = 'hubeizj.resume-queue.auto-next';
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem(autoKey)); } catch { /* Storage unavailable. */ }
  if (!pending || pending.until <= Date.now() || typeof pending.title !== 'string') pending = null;
  autoNext.checked = Boolean(pending);
  let previous = null;

  function remember(next) {
    pending = next;
    try {
      if (pending) sessionStorage.setItem(autoKey, JSON.stringify(pending));
      else sessionStorage.removeItem(autoKey);
    } catch { /* The option still works within the current document. */ }
  }

  function openEntry(entry) {
    const { cards, entries } = scan();
    const refreshed = entry && entries.find((current) => current.button === entry.button);
    if (!refreshed) {
      refresh();
      status.textContent = '课程入口已变动，请重新选择。';
      return;
    }
    status.textContent = `正在打开：${refreshed.title}。若未跳转，请点击平台原按钮。`;
    const identifiable = refreshed.percent !== null && cards.filter((card) => card.title === refreshed.title).length === 1;
    remember(autoNext.checked && identifiable ? { title: refreshed.title, until: Date.now() + 6 * 60 * 60 * 1000 } : null);
    // For a manual click, retain the browser's user activation for native popups.
    refreshed.button.click();
  }

  function refresh() {
    const { list, cards, entries } = scan();
    host.hidden = !list;
    resume.disabled = !entries.length;
    if (previous && previous.length === entries.length && entries.every((entry, i) =>
      ['button', 'title', 'action', 'percent'].every((key) => entry[key] === previous[i][key]))) {
      maybeAdvance(cards, entries);
      return;
    }
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
    maybeAdvance(cards, entries);
  }

  function maybeAdvance(cards, entries) {
    if (!autoNext.checked || !pending || document.hidden) return;
    if (pending.until <= Date.now()) {
      remember(null);
      autoNext.checked = false;
      return;
    }
    if (Array.from(document.querySelectorAll('dialog[open], [aria-modal="true"]')).some(visible)) return;
    const matches = cards.filter(({ title }) => title === pending.title);
    if (matches.length !== 1 || matches[0].percent !== 100) return;
    remember(null); // Consume the confirmation before invoking the native action.
    if (entries.length) openEntry(entries[0]);
  }

  autoNext.addEventListener('change', () => { if (!autoNext.checked) remember(null); });
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('pageshow', refresh);
  resume.addEventListener('click', () => openEntry(scan().entries[0]));
  const observer = new MutationObserver((records) => {
    if (timer !== null || records.every((record) => record.target === host)) return;
    timer = setTimeout(() => { timer = null; refresh(); }, 250);
  });
  let timer = null;
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'style', 'disabled', 'aria-disabled', 'aria-hidden', 'hidden', 'inert', 'title', 'open', 'aria-modal'] });
  onNavigation(refresh);
  refresh();

  const player = document.createElement('aside');
  player.id = 'hubeizj-player-status';
  player.hidden = true;
  const playerRoot = player.attachShadow({ mode: 'open' });
  playerRoot.innerHTML = `
    <style>
      :host{position:fixed;right:16px;bottom:16px;z-index:1000;width:min(280px,calc(100vw - 32px));font:14px/1.5 system-ui,sans-serif;color:#172c43}
      :host([hidden]){display:none}
      details{background:#fff;border:1px solid #a9c5db;border-radius:10px;box-shadow:0 4px 20px #17334930;padding:9px 12px}
      summary{cursor:pointer;font-weight:650}p{margin:6px 0}a{color:#15527f}
    </style>
    <details open>
      <summary>课件播放状态</summary>
      <p data-remaining></p>
      <p role="status"></p>
      <a href="/me/courses/">返回我的课程</a>
    </details>`;
  document.body.append(player);
  const remaining = playerRoot.querySelector('[data-remaining]');
  const playback = playerRoot.querySelector('[role="status"]');
  const mediaEvents = ['loadstart', 'emptied', 'loadedmetadata', 'durationchange', 'timeupdate', 'seeking',
    'seeked', 'pause', 'playing', 'waiting', 'ended', 'error'];
  let media = null;
  let buffering = false;
  const updateText = (node, value) => { if (node.textContent !== value) node.textContent = value; };

  function showPlayback(event) {
    if (!media) return;
    if (event?.type === 'waiting') buffering = true;
    else if (['playing', 'pause', 'ended', 'loadstart', 'emptied', 'error'].includes(event?.type)) buffering = false;

    const { duration, currentTime, ended, paused, error } = media;
    const seconds = Number.isFinite(duration) && duration > 0 && Number.isFinite(currentTime)
      ? Math.ceil(Math.max(0, duration - currentTime)) : null;
    const clock = seconds === null ? '未知' : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    updateText(remaining, `本课件剩余（按 1×）：${clock}`);
    updateText(playback, error ? '播放出错，请查看平台提示。'
      : ended ? '本课件已播完，学习进度以平台为准。'
      : paused ? '已暂停，请查看播放器或平台提示。'
      : buffering ? '正在缓冲…' : '播放中');
  }

  function bindPlayer() {
    const next = onRoute('/play') ? document.querySelector('#mse video') : null;
    if (next === media) return;
    if (media) for (const type of mediaEvents) media.removeEventListener(type, showPlayback);
    media = next;
    buffering = false;
    player.hidden = !media;
    if (!media) return;
    for (const type of mediaEvents) media.addEventListener(type, showPlayback);
    showPlayback();
  }

  const playerObserver = new MutationObserver(() => bindPlayer());
  playerObserver.observe(document.body, { childList: true, subtree: true });
  onNavigation(bindPlayer);
  bindPlayer();
})();
