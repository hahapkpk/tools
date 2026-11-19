// ==UserScript==
// @name         湖北专业技术人员继续教育学习助手
// @namespace    local.codex.hubeizj
// @version      1.0.0
// @description  汇总当前课程和待考信息，提供原生续学入口，并显示课件播放状态。
// @match        https://hbzsgx.hb12333.com/mgm/goTraining/*
// @match        https://hubeizj.chinamde.cn/me/courses*
// @match        https://hubeizj.chinamde.cn/me/exams*
// @match        https://hubeizj.chinamde.cn/play*
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/hubeizj-study-helper.user.js
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/hubeizj-study-helper.user.js
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const ID = 'hubeizj-study-helper';
  const SCHOOL = 'https://hubeizj.chinamde.cn';
  const COURSES = `${SCHOOL}/me/courses/`;
  const EXAMS = `${SCHOOL}/me/exams/`;
  const routes = {
    '/me/courses': 'courses',
    '/me/exams': 'exams',
    '/play': 'player',
  };

  if (document.getElementById(ID)) return;

  const select = (prefix) => `[class*="${prefix}__"]`;
  const content = (element) => element?.textContent.trim() ?? '';
  const all = (prefix, root = document) => [...root.querySelectorAll(select(prefix))];
  const find = (prefix, root = document) => root.querySelector(select(prefix));
  const visible = (element) => element?.getClientRects().length > 0;

  function readCourses() {
    const list = find('MyCourses_course_list');
    if (!list) return null;

    const cards = all('Course_course_item', list).filter(visible);
    const courses = cards.map((card) => {
      const title = find('Course_courser_title', card);
      const button = find('Course_continue', card);
      const progress = all('Course_progress', card)
        .map((item) => content(item).match(/进度[：:]\s*(\d+(?:\.\d+)?)\s*%/))
        .find(Boolean);
      return {
        title: content(title?.querySelector(':scope > span:last-child')) || content(title),
        progress: progress ? Number(progress[1]) : null,
        action: content(button),
        button: visible(button) && !button.disabled ? button : null,
      };
    }).filter((course) => course.title);

    const tab = content(find('MyCourses_active'));
    const resumable = courses.filter((course) => course.button && course.action === '继续学习');
    const unstarted = courses.filter((course) => course.progress === 0);
    const next = resumable.sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))[0]
      ?? courses.find((course) => course.button && course.action === '开始学习');

    const info = [`${tab || '当前列表'} · ${courses.length} 门课程`];
    if (tab === '学习中' && courses.length) {
      info.push(`${resumable.length} 门可续学，${unstarted.length} 门未开始`);
    }

    return {
      title: '课程助手',
      info,
      entries: next ? [{
        title: next.title,
        detail: next.progress === null ? '' : `课程进度 ${next.progress}%`,
        action: next.action,
        target: next.button,
      }] : [],
      links: [['我的考试', EXAMS]],
    };
  }

  function timeText(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    const min = Math.floor(whole / 60);
    const parts = min >= 60 ? [Math.floor(min / 60), min % 60, whole % 60] : [min, whole % 60];
    return parts.map((part) => String(part).padStart(2, '0')).join(':');
  }

  function readPlayer() {
    const directory = find('Play_video_list');
    if (!directory) return null;

    const active = find('Play_active', directory);
    const video = document.querySelector('.xgplayer .xg-video-container video');
    const target = find('Play_gotoUnfinish', directory);
    const info = [];
    if (content(active)) info.push(content(active));
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      const loading = video.seeking || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
      const state = video.ended ? '播放结束' : video.paused ? '已暂停' : loading ? '加载中' : '播放中';
      info.push(`${state} · ${timeText(video.currentTime)} / ${timeText(Math.ceil(video.duration))}`);
    } else {
      info.push('等待播放器加载');
    }

    return {
      title: '课件助手',
      info,
      entries: visible(target) && content(target) === '跳转至未完成课件' ? [{
        action: content(target),
        target,
      }] : [],
      links: [['我的课程', COURSES]],
    };
  }

  function readExams() {
    const list = find('MyExams_course_list');
    if (!list) return null;

    const tab = content(find('MyExams_active'));
    const cards = all('UnFinishExams_exam', list).filter(visible);
    const entries = cards.map((card) => {
      const title = find('UnFinishExams_exam_title', card);
      const state = content(title?.querySelector(':scope > span'));
      const info = find('UnFinishExams_exam_info', card);
      return {
        title: content(title?.querySelector(':scope > h5')) || content(title),
        detail: [state, ...info?.innerText.trim().split(/\s*\n+\s*/) ?? []].filter(Boolean).join(' · '),
      };
    }).filter((entry) => entry.title);

    const empty = visible(list.querySelector('.arco-empty'));
    const status = empty ? '暂无数据' : tab === '未完成考试' ? `${cards.length} 场` : '';
    return {
      title: '考试概览',
      info: [[tab || '我的考试', status].filter(Boolean).join(' · ')],
      entries,
      links: [['我的课程', COURSES]],
    };
  }

  function readPortal() {
    if (!document.querySelector('.go-training-tip')) return null;
    return {
      title: '继续教育学习入口',
      info: [],
      entries: [],
      links: [['我的课程 ↗', COURSES, true], ['我的考试 ↗', EXAMS, true]],
    };
  }

  const readers = { courses: readCourses, exams: readExams, player: readPlayer, portal: readPortal };

  function route() {
    if (location.origin === SCHOOL) return routes[location.pathname.replace(/\/$/, '')];
    if (location.hostname === 'hbzsgx.hb12333.com' && location.pathname.startsWith('/mgm/goTraining/')) {
      return 'portal';
    }
    return undefined;
  }

  if (!route()) return;

  function make(tag, label, className) {
    const element = document.createElement(tag);
    if (label) element.textContent = label;
    if (className) element.className = className;
    return element;
  }

  const host = make('aside');
  host.id = ID;
  host.hidden = true;
  if (location.origin === SCHOOL) host.classList.add('school');
  host.setAttribute('aria-label', '湖北继续教育助手');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = make('style', `
    :host { --helper-right: 16px; position: fixed;
      inset: auto var(--helper-right) 16px auto; z-index: 120;
      display: block; width: min(330px, calc(100vw - var(--helper-right) - 16px));
      font: 14px/1.5 system-ui, sans-serif; color: #172742; }
    :host(.school) { --helper-right: 88px; }
    :host([hidden]) { display: none; }
    details { border: 1px solid #cbd7e7; border-radius: 12px; overflow: hidden;
      background: #fff; box-shadow: 0 4px 20px #13244325; }
    summary { padding: 9px 13px; color: #fff; background: #214a80;
      cursor: pointer; font-weight: 650; }
    .body { padding: 12px; max-height: min(44vh, 360px); overflow: auto; }
    p { margin: 0 0 6px; overflow-wrap: anywhere; }
    .entry { margin: 8px 0; padding: 8px; border: 1px solid #dae3ef; border-radius: 7px; }
    .entry p:first-child { font-weight: 650; }
    .entry p:last-child { margin-bottom: 0; }
    .detail { color: #465a72; font-size: 13px; }
    nav { display: flex; flex-wrap: wrap; gap: 8px; }
    a, button { display: inline-block; border: 1px solid #98afcc; border-radius: 6px;
      text-decoration: none; padding: 4px 9px; font: inherit; font-weight: 600;
      color: #214a80; background: #f4f8fd; cursor: pointer; }
    a:focus-visible, button:focus-visible, summary:focus-visible {
      outline: 2px solid #e8a126; outline-offset: -2px; }
  `);
  const panel = make('details');
  panel.open = true;
  const heading = make('summary');
  const body = make('div', '', 'body');
  const status = make('div');
  const actions = make('div');
  body.append(status, actions);
  panel.append(heading, body);
  shadow.append(style, panel);
  document.body.append(host);

  let lastRoute;
  let lastStatus = '';
  let lastActions = '';

  function render(data) {
    const { title, info, links } = data;
    if (heading.textContent !== title) heading.textContent = title;
    const nextStatus = JSON.stringify(info);
    if (lastStatus !== nextStatus) {
      lastStatus = nextStatus;
      status.replaceChildren(...info.map((line) => make('p', line)));
    }
    const entries = data.entries.map(({ target, ...entry }) => entry);
    const nextActions = JSON.stringify({ links, entries });
    if (lastActions === nextActions) return;

    lastActions = nextActions;
    const nodes = [];
    entries.forEach((entry, index) => {
      const card = make('div', '', 'entry');
      if (entry.title) card.append(make('p', entry.title));
      if (entry.detail) card.append(make('p', entry.detail, 'detail'));
      if (entry.action) {
        const button = make('button', entry.action);
        button.type = 'button';
        button.addEventListener('click', () => {
          // Recheck the target in case the platform replaced its DOM after rendering.
          const latest = readers[route()]?.()?.entries[index];
          if (latest?.title === entry.title && latest?.action === entry.action && visible(latest.target)) {
            latest.target.click();
          }
        });
        card.append(button);
      }
      nodes.push(card);
    });

    const nav = make('nav');
    nav.setAttribute('aria-label', '学习页面快捷链接');
    links.forEach(([label, url, newTab]) => {
      const link = make('a', label);
      link.href = url;
      if (newTab) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      nav.append(link);
    });
    nodes.push(nav);
    const scrollTop = body.scrollTop;
    actions.replaceChildren(...nodes);
    body.scrollTop = scrollTop;
  }

  function update() {
    const currentRoute = route();
    const data = readers[currentRoute]?.();
    if (!data) {
      host.hidden = true;
      return;
    }

    if (!host.isConnected) document.body.append(host);
    if (lastRoute !== currentRoute) {
      panel.open = true;
      lastRoute = currentRoute;
    }
    host.hidden = false;
    render(data);
  }

  let queued = false;
  function scheduleUpdate() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  }

  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'disabled'],
  });
  ['timeupdate', 'playing', 'pause', 'ended', 'emptied', 'loadedmetadata', 'seeked', 'waiting'].forEach((event) => {
    document.addEventListener(event, (change) => {
      if (change.target instanceof HTMLVideoElement) scheduleUpdate();
    }, true);
  });
  window.addEventListener('popstate', scheduleUpdate);
  window.navigation?.addEventListener('currententrychange', scheduleUpdate);
  update();
})();
