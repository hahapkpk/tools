// ==UserScript==
// @name         湖北专业技术人员继续教育学习助手
// @namespace    local.codex.hubeizj
// @version      1.1.0
// @description  查看课程和考试信息，通过平台播放器一键连续学习当前课程。
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
  const playerVideo = () => document.querySelector('.xgplayer .xg-video-container video');
  const unfinishedControl = (directory) => find('Play_gotoUnfinish', directory)?.querySelector('span');
  let continuous = null;
  let continuousStatus = '';

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

  function clickable(element) {
    if (!visible(element)) return false;
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  }

  function activeChapter(directory) {
    return find('Play_active', directory)?.closest(`${select('Play_child_item')}[data-id]`)?.dataset.id;
  }

  function stopContinuous(message) {
    clearInterval(continuous?.timer);
    continuous = null;
    continuousStatus = message;
    scheduleUpdate();
  }

  function tickContinuous(run) {
    if (run !== continuous) return;
    if (location.href !== run.url || document.hidden) {
      stopContinuous('已停止连播。回到课件页后可重新开启。');
      return;
    }

    const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], .arco-modal')]
      .filter((element) => visible(element) && getComputedStyle(element).visibility === 'visible');
    if (dialogs.some((dialog) => content(dialog).includes('课程学习已完成'))) {
      stopContinuous('平台已确认课程学习完成。');
      return;
    }
    if (dialogs.length || [...document.querySelectorAll('.arco-modal-mask, .xgplayer-error')].some(visible)) {
      stopContinuous('平台有提示或播放异常，请在页面上处理后再开启连播。');
      return;
    }

    const directory = find('Play_video_list');
    const chapter = activeChapter(directory);
    const video = playerVideo();
    const now = performance.now();

    if (run.phase === 'playing') {
      if (chapter !== run.chapter || video !== run.video || video?.currentSrc !== run.source) {
        stopContinuous('课件或播放器已切换，请重新开启连播。');
      }
      return;
    }

    if (run.phase === 'settling' && now >= run.deadline && chapter === run.chapter) {
      const control = unfinishedControl(directory);
      if (!clickable(control)) {
        stopContinuous('当前课件已播完，请在课程目录核对进度或选择下一课件。');
        return;
      }
      run.phase = 'switching';
      run.deadline = now + 15000;
      control.click();
      return;
    }

    if (run.phase === 'settling' || run.phase === 'switching') {
      const newChapter = chapter && chapter !== run.chapter;
      const newVideo = video?.currentSrc && !video.ended && (video !== run.video || video.currentSrc !== run.source);
      if (newChapter && newVideo) {
        const previous = all('Play_child_item', directory).find((item) => item.dataset.id === run.chapter);
        if (!previous || content(find('Play_circle_progress', previous)) === '100%') {
          if (run.finished.has(chapter)) {
            stopContinuous('平台回到了已播课件，请在课程目录核对进度。');
            return;
          }
          run.chapter = chapter;
          run.phase = 'starting';
          run.deadline = now + 12000;
          run.clickedPlay = false;
          continuousStatus = '连播中 · 正在打开下一课件';
        }
      }
      if (run.phase === 'settling') {
        if (!newChapter && now < run.deadline) return;
        run.phase = 'switching';
        run.deadline = now + 15000;
      }
    }

    if (now >= run.deadline) {
      stopContinuous(run.phase === 'switching'
        ? '课件已播完，请在「我的课程」核对进度。'
        : '播放器尚未开始，请点页面上的播放按钮，再开启连播。');
      return;
    }
    if (run.phase !== 'starting' || chapter !== run.chapter || !video?.currentSrc || video.ended) return;

    run.video = video;
    run.source = video.currentSrc;
    if (!video.paused) {
      run.phase = 'playing';
      continuousStatus = '连播中 · 当前课件正常播放';
    } else if (!run.clickedPlay) {
      const play = video.closest('.xgplayer').querySelector('xg-start-inner');
      if (clickable(play)) {
        run.clickedPlay = true;
        play.click();
      }
    }
  }

  function toggleContinuous() {
    if (continuous) {
      stopContinuous('已停止自动切换，当前课件可继续播放。');
      return;
    }

    const chapter = activeChapter(find('Play_video_list'));
    if (!chapter || !playerVideo()) {
      stopContinuous('请等当前课件加载完成后再开启连播。');
      return;
    }
    const run = {
      url: location.href,
      chapter,
      phase: 'starting',
      deadline: performance.now() + 12000,
      finished: new Set(),
      clickedPlay: false,
    };
    continuous = run;
    continuousStatus = '连播中 · 正在启动平台播放器';
    run.timer = setInterval(() => {
      tickContinuous(run);
      scheduleUpdate();
    }, 250);
    tickContinuous(run);
    scheduleUpdate();
  }

  function onContinuousMedia(event) {
    const run = continuous;
    const video = event.target;
    if (!run || !event.isTrusted || video !== run.video || video.currentSrc !== run.source) return;

    if (event.type === 'play' && run.phase === 'starting') {
      run.phase = 'playing';
      continuousStatus = '连播中 · 当前课件正常播放';
    }
    if (run.phase !== 'playing') return;
    if (event.type === 'pause' && !video.ended) {
      stopContinuous('播放器已暂停。请处理页面提示后再开启连播。');
    } else if (event.type === 'ended' && video.ended) {
      run.finished.add(run.chapter);
      run.phase = 'settling';
      run.deadline = performance.now() + 3500;
      continuousStatus = '课件已播完 · 等待平台更新进度';
    }
  }

  function readPlayer() {
    const directory = find('Play_video_list');
    if (!directory) return null;

    const active = find('Play_active', directory);
    const video = playerVideo();
    const target = unfinishedControl(directory);
    const info = [];
    if (content(active)) info.push(content(active));
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      const loading = video.seeking || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
      const state = video.ended ? '播放结束' : video.paused ? '已暂停' : loading ? '加载中' : '播放中';
      info.push(`${state} · ${timeText(video.currentTime)} / ${timeText(Math.ceil(video.duration))}`);
    } else {
      info.push('等待播放器加载');
    }

    if (continuousStatus) info.push(continuousStatus);
    const entries = [];
    if (active && video) {
      entries.push({ action: continuous ? '停止连播' : '一键连续学习', command: 'continuous' });
    }
    if (!continuous && visible(target) && content(target) === '跳转至未完成课件') {
      entries.push({ action: content(target), target });
    }
    return {
      title: '课件助手',
      info,
      entries,
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
          if (entry.command === 'continuous' && route() === 'player') {
            toggleContinuous();
            return;
          }
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
    if (currentRoute !== 'player' && continuous) stopContinuous('');
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
  ['timeupdate', 'play', 'playing', 'pause', 'ended', 'emptied', 'loadedmetadata', 'seeked', 'waiting'].forEach((event) => {
    document.addEventListener(event, (change) => {
      if (change.target instanceof HTMLVideoElement) {
        onContinuousMedia(change);
        scheduleUpdate();
      }
    }, true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && continuous) stopContinuous('切到后台后已停止连播。');
  });
  window.addEventListener('popstate', scheduleUpdate);
  window.navigation?.addEventListener('currententrychange', scheduleUpdate);
  update();
})();
