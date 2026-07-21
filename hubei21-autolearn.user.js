// ==UserScript==
// @name         湖北21世纪学习平台 - 自动刷课
// @namespace    https://github.com/hahapkpk/tools
// @version      1.1.1
// @description  自动完成 hubei21.com 学习平台的所有课程视频学习进度（支持普通课程和水课程）
// @author       Flywind
// @match        https://www.hubei21.com/*
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/hubei21-autolearn.user.js
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/hubei21-autolearn.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  console.log('[自动刷课] 脚本已加载 v1.1.1', 'hash:', location.hash);

  const API_BASE = 'https://api.hubei21.com/api';

  // ========== 工具函数 ==========

  function getToken() {
    return localStorage.getItem('token');
  }

  /** 检测当前页面是否为水课程页面 */
  function isWaterCourse() {
    return /\/waterCourse\//.test(location.hash);
  }

  /** 普通课程 ID */
  function getCourseId() {
    const hash = location.hash;
    const m = hash.match(/\/course\/(\d+)/);
    return m ? parseInt(m[1]) : null;
  }

  /** 水课程 ID */
  function getWaterPlanId() {
    const hash = location.hash;
    const m = hash.match(/\/waterCourse\/(\d+)/);
    return m ? parseInt(m[1]) : null;
  }

  function getYear() {
    const hash = location.hash;
    const m = hash.match(/year=(\d+)/);
    return m ? m[1] : new Date().getFullYear().toString();
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function parseDurationSeconds(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) return parseFloat(trimmed);

    const parts = trimmed.split(':').map((part) => parseInt(part, 10));
    if (parts.some((part) => Number.isNaN(part))) return null;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
  }

  function getLessonDuration(lesson) {
    const candidates = [
      lesson.duration,
      lesson.video_duration,
      lesson.video_time,
      lesson.study_time,
      lesson.time,
      lesson.length,
    ];
    for (const value of candidates) {
      const seconds = parseDurationSeconds(value);
      if (seconds) return seconds;
    }
    return 1800;
  }

  async function apiPost(path, body) {
    const resp = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        token: getToken(),
      },
      body: JSON.stringify(body),
    });
    return resp.json();
  }

  async function apiGet(path) {
    const resp = await fetch(`${API_BASE}${path}`, {
      headers: { token: getToken() },
    });
    return resp.json();
  }

  // ========== 普通课程 ==========

  async function fetchCourseDetail(videoId, year) {
    const data = await apiGet(`/video_detail?video_id=${videoId}&year=${year}`);
    if (data.code !== 200) throw new Error('获取课程详情失败: ' + data.msg);
    return data.data;
  }

  async function studyOneLesson(videoId, detailId, year, durationSeconds, onProgress) {
    const steps = 2;
    for (let i = 1; i <= steps; i++) {
      if (stopFlag) return;

      const ratio = ((i / steps) * 100).toFixed(2);
      const time = ((i / steps) * durationSeconds).toFixed(2);

      const result = await apiPost('/video_detail_study', {
        video_id: videoId,
        video_detail_id: detailId,
        ratio: ratio,
        time: parseFloat(time),
        year: year,
      });

      if (onProgress) onProgress(i, steps, result);
      if (result.code !== 200) {
        throw new Error(`学习进度上报失败: ${result.msg || result.message || '未知错误'}`);
      }
      if (i < steps) await sleep(2000);
    }
  }

  // ========== 水课程 ==========

  async function fetchWaterPlanDetail(waterPlanId) {
    const data = await apiPost('/water_plan_detail', {
      water_plan_id: waterPlanId,
      page: 1,
    });
    if (data.code !== 200) throw new Error('获取水课程详情失败: ' + data.msg);
    return data.data;
  }

  async function studyOneWaterLesson(waterPlanId, detailId, durationSeconds, onProgress) {
    const steps = 2;
    for (let i = 1; i <= steps; i++) {
      if (stopFlag) return;

      const ratio = ((i / steps) * 100).toFixed(2);
      const time = ((i / steps) * durationSeconds).toFixed(2);

      const result = await apiPost('/video_detail_study_water', {
        water_plan_id: waterPlanId,
        water_plan_detail_id: detailId,
        ratio: ratio,
        time: parseFloat(time),
      });

      if (onProgress) onProgress(i, steps, result);
      if (result.code !== 200) {
        throw new Error(`水课程学习进度上报失败: ${result.msg || result.message || '未知错误'}`);
      }
      if (i < steps) await sleep(2000);
    }
  }

  // ========== UI 面板 ==========

  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'autolearn-panel';
    const courseLabel = isWaterCourse() ? '水课程' : '普通课程';
    panel.innerHTML = `
      <div style="
        position: fixed; top: 80px; right: 20px; z-index: 99999;
        background: #fff; border: 2px solid #c0392b; border-radius: 10px;
        padding: 16px 20px; width: 340px; box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        font-family: 'Microsoft YaHei', sans-serif; font-size: 14px; color: #333;
      ">
        <div style="font-size: 16px; font-weight: bold; color: #c0392b; margin-bottom: 12px;">
          自动刷课助手<span style="font-size:12px;color:#888;font-weight:normal;"> - ${courseLabel}</span>
        </div>
        <div id="al-status" style="margin-bottom: 10px; color: #666;">等待开始...</div>
        <div style="background: #eee; border-radius: 6px; height: 20px; overflow: hidden; margin-bottom: 10px;">
          <div id="al-progress-bar" style="
            background: linear-gradient(90deg, #e74c3c, #c0392b);
            height: 100%; width: 0%; transition: width 0.3s;
            border-radius: 6px; text-align: center; color: #fff; font-size: 12px; line-height: 20px;
          ">0%</div>
        </div>
        <div id="al-log" style="
          max-height: 200px; overflow-y: auto; font-size: 12px; color: #888;
          border-top: 1px solid #eee; padding-top: 8px; margin-top: 4px;
        "></div>
        <div style="margin-top: 12px; text-align: center;">
          <button id="al-start-btn" style="
            background: #c0392b; color: #fff; border: none; border-radius: 6px;
            padding: 8px 24px; cursor: pointer; font-size: 14px;
          ">开始刷课</button>
          <button id="al-stop-btn" style="
            background: #95a5a6; color: #fff; border: none; border-radius: 6px;
            padding: 8px 24px; cursor: pointer; font-size: 14px; margin-left: 8px; display: none;
          ">停止</button>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    return panel;
  }

  function updateStatus(text) {
    const el = document.getElementById('al-status');
    if (el) el.textContent = text;
  }

  function updateProgress(percent) {
    const bar = document.getElementById('al-progress-bar');
    if (bar) {
      bar.style.width = percent + '%';
      bar.textContent = percent + '%';
    }
  }

  function addLog(text) {
    const log = document.getElementById('al-log');
    if (log) {
      const line = document.createElement('div');
      line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    }
  }

  // ========== 主流程 ==========

  let stopFlag = false;

  async function startAutoLearn() {
    stopFlag = false;

    const waterMode = isWaterCourse();
    const courseId = waterMode ? getWaterPlanId() : getCourseId();
    const year = getYear();

    if (!courseId) {
      updateStatus('请先打开一个课程页面（普通课程或水课程）');
      return;
    }
    if (!getToken()) {
      updateStatus('未检测到登录状态，请先登录');
      return;
    }

    const startBtn = document.getElementById('al-start-btn');
    const stopBtn = document.getElementById('al-stop-btn');
    startBtn.style.display = 'none';
    stopBtn.style.display = 'inline-block';

    try {
      updateStatus('获取课程信息...');
      const label = waterMode ? '水课程' : '课程';
      addLog(`${label}ID: ${courseId}${waterMode ? '' : ', 年份: ' + year}`);

      let lessons, studyDetail, totalStudyTime, gotStudyTime;

      if (waterMode) {
        // 水课程
        const courseData = await fetchWaterPlanDetail(courseId);
        lessons = courseData.data || [];
        studyDetail = courseData.study_detail || {};

        // 水课程将 study_detail 合并到 lesson 数据中
        lessons = lessons.map((lesson) => {
          const detail = studyDetail[lesson.id];
          if (detail) {
            return { ...lesson, ...detail, time: detail.time };
          }
          return lesson;
        });

        // 水课程从 detail 中获取总学时信息
        const detail = courseData.detail || {};
        totalStudyTime = detail.study_time || 0;
        gotStudyTime = 0;
        // 已完成的累计学时
        lessons.forEach((l) => {
          if (l.status === 1) gotStudyTime += parseFloat(l.study_time || l.time || 0);
        });
        gotStudyTime = gotStudyTime.toFixed(2);
      } else {
        // 普通课程
        const courseData = await fetchCourseDetail(courseId, year);
        lessons = courseData.list;
        studyDetail = courseData.study_detail || {};
        totalStudyTime = courseData.total_studytime;
        gotStudyTime = courseData.get_studytime;
      }

      addLog(`共 ${lessons.length} 节课, 已获学时: ${gotStudyTime}/${totalStudyTime}`);

      // 过滤已完成的课程 (status === 1)
      const todoLessons = lessons.filter((lesson) => {
        return lesson.status !== 1;
      });

      if (todoLessons.length === 0) {
        updateStatus('所有课程已完成!');
        addLog('无需刷课，全部已完成');
        startBtn.style.display = 'inline-block';
        stopBtn.style.display = 'none';
        return;
      }

      addLog(`待完成: ${todoLessons.length} 节课`);

      for (let i = 0; i < todoLessons.length; i++) {
        if (stopFlag) {
          updateStatus('已停止');
          addLog('用户手动停止');
          break;
        }

        const lesson = todoLessons[i];
        updateProgress(Math.round((i / todoLessons.length) * 100));
        updateStatus(`正在学习 (${i + 1}/${todoLessons.length}): ${lesson.title}`);
        addLog(`开始: ${lesson.title}`);

        const duration = getLessonDuration(lesson);

        if (waterMode) {
          await studyOneWaterLesson(
            courseId,
            lesson.id,
            duration,
            (step, total, result) => {
              const overallNow = Math.round(
                ((i + step / total) / todoLessons.length) * 100
              );
              updateProgress(overallNow);
              if (result.code !== 200) {
                addLog(`上报异常: ${result.msg}`);
              }
            }
          );
        } else {
          await studyOneLesson(
            courseId,
            lesson.id,
            year,
            duration,
            (step, total, result) => {
              const overallNow = Math.round(
                ((i + step / total) / todoLessons.length) * 100
              );
              updateProgress(overallNow);
              if (result.code !== 200) {
                addLog(`上报异常: ${result.msg}`);
              }
            }
          );
        }

        addLog(`完成: ${lesson.title}`);

        // 课程之间间隔 3 秒
        if (i < todoLessons.length - 1 && !stopFlag) {
          await sleep(3000);
        }
      }

      if (!stopFlag) {
        updateProgress(100);
        updateStatus('全部课程学习完成!');
        addLog('所有课程已刷完，可以去考试了');
      }
    } catch (err) {
      updateStatus('出错: ' + err.message);
      addLog('错误: ' + err.message);
      console.error('[自动刷课]', err);
    } finally {
      startBtn.style.display = 'inline-block';
      stopBtn.style.display = 'none';
    }
  }

  // ========== 初始化 ==========

  function isOnSupportedPage() {
    return /\/course\//.test(location.hash) || /\/waterCourse\//.test(location.hash);
  }

  function init() {
    console.log('[自动刷课] init() 被调用, hash:', location.hash);
    if (!isOnSupportedPage()) {
      console.log('[自动刷课] 不支持的页面, 跳过');
      return;
    }
    if (document.getElementById('autolearn-panel')) {
      console.log('[自动刷课] 面板已存在, 跳过');
      return;
    }

    createPanel();

    document.getElementById('al-start-btn').addEventListener('click', () => {
      startAutoLearn();
    });

    document.getElementById('al-stop-btn').addEventListener('click', () => {
      stopFlag = true;
    });

    addLog('助手已加载，点击「开始刷课」启动');
  }

  // 监听 hash 变化（SPA 路由）
  window.addEventListener('hashchange', () => {
    console.log('[自动刷课] hashchange:', location.hash);
    if (isOnSupportedPage()) {
      if (!document.getElementById('autolearn-panel')) init();
    } else {
      const existing = document.getElementById('autolearn-panel');
      if (existing) existing.remove();
    }
  });

  // 页面加载后多次尝试初始化（SPA 懒加载可能需要更长时间）
  let initAttempts = 0;
  const MAX_INIT_ATTEMPTS = 20;
  const INIT_INTERVAL = 500;

  function tryInit() {
    initAttempts++;
    console.log('[自动刷课] 尝试初始化 ' + initAttempts + '/' + MAX_INIT_ATTEMPTS + ', hash:', location.hash);
    init();
    if (initAttempts < MAX_INIT_ATTEMPTS && !document.getElementById('autolearn-panel')) {
      setTimeout(tryInit, INIT_INTERVAL);
    }
  }

  setTimeout(tryInit, 1000);
})();
