// ==UserScript==
// @name         湖北21世纪学习平台 - 自动刷课
// @namespace    https://github.com/hahapkpk/tools
// @version      1.0.0
// @description  自动完成 hubei21.com 学习平台的所有课程视频学习进度
// @author       Flywind
// @match        https://www.hubei21.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const API_BASE = 'https://api.hubei21.com/api';

  // ========== 工具函数 ==========

  function getToken() {
    return localStorage.getItem('token');
  }

  function getCourseId() {
    const hash = location.hash; // e.g. #/course/368?year=2026
    const m = hash.match(/\/course\/(\d+)/);
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

  // ========== 获取课程详情 ==========

  async function fetchCourseDetail(videoId, year) {
    const data = await apiGet(`/video_detail?video_id=${videoId}&year=${year}`);
    if (data.code !== 200) throw new Error('获取课程详情失败: ' + data.msg);
    return data.data;
  }

  // ========== 模拟学习进度上报 ==========

  async function studyOneLesson(videoId, detailId, year, durationSeconds, onProgress) {
    // 分 2 次上报（50% 和 100%），间隔 2 秒
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
      if (i < steps) await sleep(2000);
    }
  }


  // ========== UI 面板 ==========

  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'autolearn-panel';
    panel.innerHTML = `
      <div style="
        position: fixed; top: 80px; right: 20px; z-index: 99999;
        background: #fff; border: 2px solid #c0392b; border-radius: 10px;
        padding: 16px 20px; width: 340px; box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        font-family: 'Microsoft YaHei', sans-serif; font-size: 14px; color: #333;
      ">
        <div style="font-size: 16px; font-weight: bold; color: #c0392b; margin-bottom: 12px;">
          自动刷课助手
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
    const videoId = getCourseId();
    const year = getYear();

    if (!videoId) {
      updateStatus('请先打开一个课程页面');
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
      addLog(`课程ID: ${videoId}, 年份: ${year}`);

      const courseData = await fetchCourseDetail(videoId, year);
      const lessons = courseData.list;
      const studyDetail = courseData.study_detail || {};
      const totalStudyTime = courseData.total_studytime;
      const gotStudyTime = courseData.get_studytime;

      addLog(`共 ${lessons.length} 节课, 已获学时: ${gotStudyTime}/${totalStudyTime}`);

      // 过滤已完成的课程 (status === 1)
      const todoLessons = lessons.filter((lesson) => {
        const detail = studyDetail[lesson.id];
        return !detail || detail.status !== 1;
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

        // 假设每节课约 30 分钟 (1800秒)
        const estimatedDuration = 1800;

        await studyOneLesson(
          videoId,
          lesson.id,
          year,
          estimatedDuration,
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

  function init() {
    if (!location.hash.includes('/course/')) return;
    if (document.getElementById('autolearn-panel')) return;

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
    if (location.hash.includes('/course/')) {
      if (!document.getElementById('autolearn-panel')) init();
    } else {
      const existing = document.getElementById('autolearn-panel');
      if (existing) existing.remove();
    }
  });

  // 页面加载后延迟初始化
  setTimeout(init, 1500);
})();
