// ==UserScript==
// @name         YouTube English Auto Captions to Simplified Chinese
// @namespace    https://github.com/hahapkpk/tools
// @version      0.5.4
// @description  Shows clean Simplified Chinese or bilingual subtitles on YouTube using YouTube caption translation data.
// @match        https://www.youtube.com/watch*
// @match        https://www.youtube.com/shorts/*
// @match        https://www.youtube.com/embed/*
// @downloadURL  https://raw.githubusercontent.com/hahapkpk/tools/main/youtube-auto-zh-hans-captions.user.js
// @updateURL    https://raw.githubusercontent.com/hahapkpk/tools/main/youtube-auto-zh-hans-captions.user.js
// @run-at       document-idle
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      openspeech.bytedance.com
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_ID = 'codex-yt-auto-zh-hans-captions';
  const SCRIPT_DATA_KEY = 'codexYtAutoZhHansCaptions';
  const STYLE_ID = `${SCRIPT_ID}-style`;
  const OVERLAY_ID = `${SCRIPT_ID}-overlay`;
  const STATUS_ID = `${SCRIPT_ID}-status`;
  const CONTROL_ID = `${SCRIPT_ID}-controls`;
  const TOGGLE_ID = `${SCRIPT_ID}-toggle`;
  const CACHE_PREFIX = `${SCRIPT_ID}:cache:`;
  const SETTINGS_KEY = `${SCRIPT_ID}:settings`;
  const VOLC_API_KEY_STORAGE_KEY = `${SCRIPT_ID}:volc-api-key`;
  const VOLC_APP_ID_STORAGE_KEY = `${SCRIPT_ID}:volc-app-id`;
  const VOLC_ACCESS_TOKEN_STORAGE_KEY = `${SCRIPT_ID}:volc-access-token`;
  const VOLC_TTS_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
  const VOLC_RESOURCE_ID = 'seed-tts-2.0';
  const DEBUG = false;
  const CHECK_INTERVAL_MS = 120;
  const ROUTE_INTERVAL_MS = 800;
  const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const TARGET_LANG = 'zh-Hans';
  const SOURCE_LANG_RE = /^en(?:-|$)/i;
  const CHINESE_LANG_RE = /^(?:zh|zh-Hans|zh-CN)(?:-|$)/i;
  const AUTO_MALE_VOICE = '__auto_male_zh__';
  const VOLC_VOICE_GROUPS = [
    {
      label: '自然通用男声',
      voices: [
        ['zh_male_m191_uranus_bigtts', '云舟 2.0'],
        ['zh_male_taocheng_uranus_bigtts', '小天 2.0'],
        ['zh_male_liufei_uranus_bigtts', '刘飞 2.0'],
        ['zh_male_shaonianzixin_uranus_bigtts', '少年梓辛/Brayan 2.0'],
        ['zh_male_wennuanahu_uranus_bigtts', '温暖阿虎/Alvin 2.0'],
        ['zh_male_linjiananhai_uranus_bigtts', '邻家男孩 2.0'],
        ['zh_male_ruyaqingnian_uranus_bigtts', '儒雅青年 2.0'],
        ['zh_male_aojiaobazong_uranus_bigtts', '傲娇霸总 2.0'],
        ['zh_male_fanjuanqingnian_uranus_bigtts', '反卷青年 2.0'],
        ['zh_male_huolixiaoge_uranus_bigtts', '活力小哥 2.0'],
        ['zh_male_kailangdidi_uranus_bigtts', '开朗弟弟 2.0'],
        ['zh_male_kuailexiaodong_uranus_bigtts', '快乐小东 2.0'],
        ['zh_male_kailangxuezhang_uranus_bigtts', '开朗学长 2.0'],
        ['zh_male_youyoujunzi_uranus_bigtts', '悠悠君子 2.0'],
        ['zh_male_qingshuangnanda_uranus_bigtts', '清爽男大 2.0'],
        ['zh_male_yuanboxiaoshu_uranus_bigtts', '渊博小叔 2.0'],
        ['zh_male_yangguangqingnian_uranus_bigtts', '阳光青年 2.0'],
        ['zh_male_wenrouxiaoge_uranus_bigtts', '温柔小哥 2.0'],
        ['zh_male_dongfanghaoran_uranus_bigtts', '东方浩然 2.0'],
        ['zh_male_gaolengchenwen_uranus_bigtts', '高冷沉稳 2.0']
      ]
    },
    {
      label: '解说与有声阅读男声',
      voices: [
        ['zh_male_jieshuoxiaoming_uranus_bigtts', '解说小明 2.0'],
        ['zh_male_yizhipiannan_uranus_bigtts', '译制片男 2.0'],
        ['zh_male_baqiqingshu_uranus_bigtts', '霸气青叔 2.0'],
        ['zh_male_xuanyijieshuo_uranus_bigtts', '悬疑解说 2.0'],
        ['zh_male_cixingjieshuonan_uranus_bigtts', '磁性解说男声/Morgan 2.0'],
        ['zh_male_liangsangmengzai_uranus_bigtts', '亮嗓萌仔 2.0'],
        ['zh_male_shenyeboke_uranus_bigtts', '深夜播客 2.0'],
        ['zh_male_guanggaojieshuo_uranus_bigtts', '广告解说 2.0']
      ]
    },
    {
      label: '角色男声',
      voices: [
        ['zh_male_sunwukong_uranus_bigtts', '猴哥 2.0'],
        ['zh_male_dayi_uranus_bigtts', '大壹 2.0'],
        ['zh_male_ruyayichen_uranus_bigtts', '儒雅逸辰 2.0'],
        ['zh_male_qingcang_uranus_bigtts', '擎苍 2.0'],
        ['zh_male_xionger_uranus_bigtts', '熊二 2.0'],
        ['zh_male_silang_uranus_bigtts', '四郎 2.0'],
        ['zh_male_naiqimengwa_uranus_bigtts', '奶气萌娃 2.0'],
        ['zh_male_lanyinmianbao_uranus_bigtts', '懒音绵宝 2.0'],
        ['zh_male_lubanqihao_uranus_bigtts', '鲁班七号 2.0'],
        ['zh_male_tangseng_uranus_bigtts', '唐僧 2.0'],
        ['zh_male_zhuangzhou_uranus_bigtts', '庄周 2.0'],
        ['zh_male_zhubajie_uranus_bigtts', '猪八戒 2.0'],
        ['zh_male_tiancaitongsheng_uranus_bigtts', '天才童声 2.0'],
        ['saturn_zh_male_shuanglangshaonian_tob', '爽朗少年'],
        ['saturn_zh_male_tiancaitongzhuo_tob', '天才同桌'],
        ['saturn_zh_male_qingxinmumu_cs_tob', '清新沐沐 2.0']
      ]
    },
    {
      label: '自然通用女声',
      voices: [
        ['zh_female_vv_uranus_bigtts', 'Vivi 2.0'],
        ['zh_female_xiaohe_uranus_bigtts', '小何 2.0'],
        ['zh_female_sophie_uranus_bigtts', '魅力苏菲 2.0'],
        ['zh_female_qingxinnvsheng_uranus_bigtts', '清新女声 2.0'],
        ['zh_female_tianmeixiaoyuan_uranus_bigtts', '甜美小源 2.0'],
        ['zh_female_tianmeitaozi_uranus_bigtts', '甜美桃子 2.0'],
        ['zh_female_shuangkuaisisi_uranus_bigtts', '爽快思思 2.0'],
        ['zh_female_linjianvhai_uranus_bigtts', '邻家女孩 2.0'],
        ['zh_female_wenroumama_uranus_bigtts', '温柔妈妈 2.0'],
        ['zh_female_tvbnv_uranus_bigtts', 'TVB女声 2.0'],
        ['zh_female_qiaopinv_uranus_bigtts', '俏皮女声 2.0'],
        ['zh_female_popo_uranus_bigtts', '婆婆 2.0'],
        ['zh_female_gaolengyujie_uranus_bigtts', '高冷御姐 2.0'],
        ['zh_female_wenroushunv_uranus_bigtts', '温柔淑女 2.0'],
        ['zh_female_mengyatou_uranus_bigtts', '萌丫头/Cutey 2.0'],
        ['zh_female_tiexinnvsheng_uranus_bigtts', '贴心女声/Candy 2.0'],
        ['zh_female_jitangmei_uranus_bigtts', '鸡汤妹妹/Hope 2.0'],
        ['zh_female_kailangjiejie_uranus_bigtts', '开朗姐姐 2.0'],
        ['zh_female_qinqienv_uranus_bigtts', '亲切女声 2.0'],
        ['zh_female_wenjingmaomao_uranus_bigtts', '文静毛毛 2.0'],
        ['zh_female_zhixingnv_uranus_bigtts', '知性女声 2.0'],
        ['zh_female_qingchezizi_uranus_bigtts', '清澈梓梓 2.0'],
        ['zh_female_tianmeiyueyue_uranus_bigtts', '甜美悦悦 2.0'],
        ['zh_female_xinlingjitang_uranus_bigtts', '心灵鸡汤 2.0'],
        ['zh_female_roumeinvyou_uranus_bigtts', '柔美女友 2.0'],
        ['zh_female_wenrouxiaoya_uranus_bigtts', '温柔小雅 2.0']
      ]
    },
    {
      label: '角色与场景女声',
      voices: [
        ['zh_female_cancan_uranus_bigtts', '知性灿灿 2.0'],
        ['zh_female_sajiaoxuemei_uranus_bigtts', '撒娇学妹 2.0'],
        ['zh_female_peiqi_uranus_bigtts', '佩奇猪 2.0'],
        ['zh_female_yingyujiaoxue_uranus_bigtts', 'Tina老师 2.0'],
        ['zh_female_kefunvsheng_uranus_bigtts', '暖阳女声 2.0'],
        ['zh_female_xiaoxue_uranus_bigtts', '儿童绘本 2.0'],
        ['zh_female_mizai_uranus_bigtts', '黑猫侦探社咪仔 2.0'],
        ['zh_female_jitangnv_uranus_bigtts', '鸡汤女 2.0'],
        ['zh_female_meilinvyou_uranus_bigtts', '魅力女友 2.0'],
        ['zh_female_liuchangnv_uranus_bigtts', '流畅女声 2.0'],
        ['zh_female_zhishuaiyingzi_uranus_bigtts', '直率英子 2.0'],
        ['zh_female_yingtaowanzi_uranus_bigtts', '樱桃丸子 2.0'],
        ['zh_female_gufengshaoyu_uranus_bigtts', '古风少御 2.0'],
        ['zh_female_jiaochuannv_uranus_bigtts', '娇喘女声 2.0'],
        ['zh_female_linxiao_uranus_bigtts', '林潇 2.0'],
        ['zh_female_lingling_uranus_bigtts', '玲玲姐姐 2.0'],
        ['zh_female_chunribu_uranus_bigtts', '春日部姐姐 2.0'],
        ['zh_female_ganmaodianyin_uranus_bigtts', '感冒电音姐姐 2.0'],
        ['zh_female_chanmeinv_uranus_bigtts', '谄媚女声 2.0'],
        ['zh_female_nvleishen_uranus_bigtts', '女雷神 2.0'],
        ['zh_female_wuzetian_uranus_bigtts', '武则天 2.0'],
        ['zh_female_gujie_uranus_bigtts', '顾姐 2.0'],
        ['zh_female_shaoergushi_uranus_bigtts', '少儿故事 2.0'],
        ['saturn_zh_female_tiaopigongzhu_tob', '调皮公主'],
        ['saturn_zh_female_keainvsheng_tob', '可爱女生'],
        ['saturn_zh_female_cancan_tob', '知性灿灿'],
        ['saturn_zh_female_qingyingduoduo_cs_tob', '轻盈朵朵 2.0'],
        ['saturn_zh_female_wenwanshanshan_cs_tob', '温婉珊珊 2.0'],
        ['saturn_zh_female_reqingaina_cs_tob', '热情艾娜 2.0']
      ]
    }
  ];

  const defaultSettings = {
    enabled: true,
    mode: 'zh',
    fontSize: 28,
    position: 8,
    offsetMs: -200,
    hideNative: true,
    voiceEnabled: false,
    voiceEngine: 'browser',
    volcAuthMode: 'apiKey',
    voiceName: 'Google 普通话（中国大陆）',
    volcVoice: 'zh_male_m191_uranus_bigtts',
    volcFavorites: [],
    volcMaleQuickVoice: '',
    volcFemaleQuickVoice: '',
    voiceRate: 1.08,
    originalVolume: 0.25
  };

  const state = {
    videoId: '',
    cues: [],
    rawTargetCues: [],
    rawSourceCues: [],
    cueIndex: -1,
    lastUrl: '',
    loadToken: 0,
    pendingStatus: '',
    rafId: 0,
    routeTimer: 0,
    spokenCueIndex: -1,
    originalVolumeBeforeVoice: null,
    videoHooked: null,
    remoteAudio: null,
    remoteVoiceToken: 0,
    settings: loadSettings()
  };

  const memoryCache = new Map();
  const volcAudioCache = new Map();
  const volcPendingCache = new Map();
  const log = (...args) => DEBUG && console.log(`[${SCRIPT_ID}]`, ...args);

  function loadSettings() {
    try {
      return { ...defaultSettings, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch {
      return { ...defaultSettings };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  }

  function getVolcApiKey() {
    try {
      return typeof GM_getValue === 'function' ? String(GM_getValue(VOLC_API_KEY_STORAGE_KEY, '') || '') : '';
    } catch {
      return '';
    }
  }

  function saveVolcApiKey(value) {
    if (typeof GM_setValue !== 'function') return;
    GM_setValue(VOLC_API_KEY_STORAGE_KEY, String(value || '').trim());
  }

  function getVolcLegacyCredentials() {
    try {
      return {
        appId: typeof GM_getValue === 'function' ? String(GM_getValue(VOLC_APP_ID_STORAGE_KEY, '') || '') : '',
        accessToken: typeof GM_getValue === 'function' ? String(GM_getValue(VOLC_ACCESS_TOKEN_STORAGE_KEY, '') || '') : ''
      };
    } catch {
      return { appId: '', accessToken: '' };
    }
  }

  function saveVolcLegacyCredentials(appId, accessToken) {
    if (typeof GM_setValue !== 'function') return;
    GM_setValue(VOLC_APP_ID_STORAGE_KEY, String(appId || '').trim());
    GM_setValue(VOLC_ACCESS_TOKEN_STORAGE_KEY, String(accessToken || '').trim());
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        position: absolute;
        left: 7%;
        right: 7%;
        bottom: calc(var(--${SCRIPT_ID}-bottom, 8) * 1%);
        z-index: 2147483000;
        display: flex;
        justify-content: center;
        pointer-events: none;
        opacity: 0;
        transition: opacity 100ms ease;
      }
      #${OVERLAY_ID}.${SCRIPT_ID}-visible { opacity: 1; }
      #${OVERLAY_ID} .${SCRIPT_ID}-box {
        max-width: min(1120px, 100%);
        padding: 0.18em 0.46em 0.24em;
        border-radius: 4px;
        background: rgba(0, 0, 0, 0.68);
        color: #fff;
        font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", Arial, sans-serif;
        font-size: calc(var(--${SCRIPT_ID}-font-size, 28) * 1px);
        font-weight: 700;
        line-height: 1.32;
        text-align: center;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
        white-space: pre-wrap;
        word-break: break-word;
      }
      #${OVERLAY_ID} .${SCRIPT_ID}-source {
        display: block;
        margin-top: 0.16em;
        font-size: 0.62em;
        font-weight: 500;
        opacity: 0.86;
      }
      #${STATUS_ID}, #${CONTROL_ID} {
        position: absolute;
        z-index: 2147483001;
        border-radius: 4px;
        background: rgba(18, 18, 18, 0.88);
        color: #fff;
        font-family: Arial, "Microsoft YaHei", sans-serif;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.32);
      }
      #${STATUS_ID} {
        right: 12px;
        bottom: 58px;
        max-width: min(520px, 70%);
        padding: 5px 8px;
        font-size: 12px;
        line-height: 1.45;
        pointer-events: none;
        opacity: 0;
        transition: opacity 180ms ease;
      }
      #${STATUS_ID}.${SCRIPT_ID}-visible { opacity: 1; }
      #${CONTROL_ID} {
        right: 12px;
        top: 12px;
        display: none;
        width: 340px;
        max-width: min(360px, calc(100% - 24px));
        max-height: calc(100% - 24px);
        overflow: auto;
        padding: 10px;
        font-size: 12px;
        line-height: 1.4;
        pointer-events: auto;
      }
      #${CONTROL_ID}.${SCRIPT_ID}-visible { display: block; }
      #${CONTROL_ID} .${SCRIPT_ID}-row {
        display: grid;
        grid-template-columns: 92px minmax(0, 1fr);
        align-items: center;
        gap: 8px;
        margin: 7px 0;
      }
      #${CONTROL_ID} label {
        color: rgba(255,255,255,0.82);
        min-width: 0;
      }
      #${CONTROL_ID} button, #${CONTROL_ID} select, #${CONTROL_ID} input {
        border: 1px solid rgba(255,255,255,0.22);
        border-radius: 4px;
        background: rgba(255,255,255,0.1);
        color: #fff;
        font: inherit;
        min-width: 0;
      }
      #${CONTROL_ID} select { width: 100%; }
      #${CONTROL_ID} input[type="range"] { width: 100%; }
      #${CONTROL_ID} button {
        min-height: 26px;
        padding: 3px 8px;
        cursor: pointer;
      }
      #${CONTROL_ID} select { height: 26px; }
      #${CONTROL_ID} .${SCRIPT_ID}-buttons {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
        margin-top: 8px;
      }
      #${CONTROL_ID} .${SCRIPT_ID}-voice-picker {
        display: block;
        align-items: stretch;
        gap: 6px;
        min-width: 0;
        position: relative;
      }
      #${CONTROL_ID} .${SCRIPT_ID}-voice-button {
        width: 100%;
        height: 26px;
        min-width: 0;
        text-align: left;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding-right: 20px;
        position: relative;
      }
      #${CONTROL_ID} .${SCRIPT_ID}-voice-button::after {
        content: "";
        position: absolute;
        right: 8px;
        top: 9px;
        width: 7px;
        height: 7px;
        border-right: 2px solid rgba(255,255,255,0.86);
        border-bottom: 2px solid rgba(255,255,255,0.86);
        transform: rotate(45deg);
      }
      #${CONTROL_ID} .${SCRIPT_ID}-voice-menu {
        position: absolute;
        left: 0;
        right: 0;
        top: 30px;
        z-index: 2147483004;
        display: none;
        max-height: 220px;
        overflow: auto;
        border: 1px solid rgba(255,255,255,0.24);
        border-radius: 4px;
        background: rgba(22,22,22,0.98);
        box-shadow: 0 8px 18px rgba(0,0,0,0.42);
      }
      #${CONTROL_ID} .${SCRIPT_ID}-voice-menu.${SCRIPT_ID}-visible { display: block; }
      #${CONTROL_ID} .${SCRIPT_ID}-voice-option {
        display: block;
        width: 100%;
        min-height: 28px;
        padding: 5px 8px;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: #fff;
        text-align: left;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${CONTROL_ID} .${SCRIPT_ID}-voice-option:hover,
      #${CONTROL_ID} .${SCRIPT_ID}-voice-option.${SCRIPT_ID}-active {
        background: rgba(62,166,255,0.32);
      }
      #${CONTROL_ID} .${SCRIPT_ID}-voice-option-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 30px;
        align-items: center;
      }
      #${CONTROL_ID} .${SCRIPT_ID}-voice-favorite-toggle {
        min-height: 28px;
        padding: 2px;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: rgba(255,255,255,0.58);
        font-size: 16px;
      }
      #${CONTROL_ID} .${SCRIPT_ID}-voice-favorite-toggle.${SCRIPT_ID}-active {
        color: #fbbf24;
      }
      #${CONTROL_ID} .${SCRIPT_ID}-voice-group-label {
        padding: 6px 8px 3px;
        color: rgba(255,255,255,0.55);
        font-size: 11px;
      }
      #${CONTROL_ID} .${SCRIPT_ID}-api-key {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 48px;
        gap: 6px;
        min-width: 0;
      }
      #${CONTROL_ID} .${SCRIPT_ID}-api-key input {
        height: 26px;
        padding: 3px 6px;
      }
      #${CONTROL_ID} .${SCRIPT_ID}-api-key button { padding: 3px 4px; }
      #${CONTROL_ID} .${SCRIPT_ID}-volc-hidden { display: none; }
      #${CONTROL_ID} .${SCRIPT_ID}-credential-note {
        color: rgba(255,255,255,0.62);
        font-size: 11px;
        line-height: 1.35;
      }
      #${CONTROL_ID} .${SCRIPT_ID}-favorite-voices,
      #${CONTROL_ID} .${SCRIPT_ID}-quick-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        min-width: 0;
      }
      #${CONTROL_ID} .${SCRIPT_ID}-favorite-voices button {
        width: auto;
        max-width: 100%;
        padding: 3px 7px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${CONTROL_ID} .${SCRIPT_ID}-favorite-voices button.${SCRIPT_ID}-active {
        border-color: #3ea6ff;
        color: #3ea6ff;
      }
      #${CONTROL_ID} .${SCRIPT_ID}-quick-buttons button {
        flex: 1 1 0;
      }
      .${SCRIPT_ID}-hide-native .ytp-caption-window-container,
      .${SCRIPT_ID}-hide-native .ytp-caption-segment {
        display: none !important;
      }
      #${TOGGLE_ID} {
        width: 48px;
        height: 100%;
        border: 0;
        background: transparent;
        color: #fff;
        cursor: pointer;
        pointer-events: auto;
        opacity: 0.92;
      }
      #${TOGGLE_ID}:hover,
      #${TOGGLE_ID}.${SCRIPT_ID}-active {
        opacity: 1;
      }
      #${TOGGLE_ID} svg {
        width: 26px;
        height: 26px;
        display: block;
        margin: 0 auto;
        fill: currentColor;
      }
      #${TOGGLE_ID}.${SCRIPT_ID}-active svg {
        filter: drop-shadow(0 0 5px rgba(62,166,255,0.85));
        color: #3ea6ff;
      }
    `;
    document.head.appendChild(style);
  }

  function getVideoId() {
    const url = new URL(location.href);
    if (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/embed/')) {
      return url.pathname.split('/').filter(Boolean)[1] || '';
    }
    return url.searchParams.get('v') || '';
  }

  function getPlayerRoot() {
    return document.querySelector('.html5-video-player') ||
      document.querySelector('#movie_player') ||
      document.querySelector('ytd-player') ||
      document.querySelector('#shorts-player') ||
      document.body;
  }

  function getVideoEl() {
    return document.querySelector('video.html5-main-video') || document.querySelector('video');
  }

  function ensureOverlay() {
    injectStyle();
    const player = getPlayerRoot();
    if (!player) return null;
    if (getComputedStyle(player).position === 'static') player.style.position = 'relative';

    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      const box = document.createElement('div');
      box.className = `${SCRIPT_ID}-box`;
      overlay.appendChild(box);
    } else if (!overlay.querySelector(`.${SCRIPT_ID}-box`)) {
      const box = document.createElement('div');
      box.className = `${SCRIPT_ID}-box`;
      overlay.replaceChildren(box);
    }
    if (overlay.parentElement !== player) player.appendChild(overlay);

    let status = document.getElementById(STATUS_ID);
    if (!status) {
      status = document.createElement('div');
      status.id = STATUS_ID;
    }
    if (status.parentElement !== player) player.appendChild(status);

    ensureControls(player);
    ensureToggleButton(player);
    applyVisualSettings();
    if (state.pendingStatus && !status.classList.contains(`${SCRIPT_ID}-visible`)) {
      status.textContent = state.pendingStatus;
      status.classList.add(`${SCRIPT_ID}-visible`);
    }
    return overlay;
  }

  function ensureToggleButton(player) {
    let button = document.getElementById(TOGGLE_ID);
    if (!button) {
      button = document.createElement('button');
      button.id = TOGGLE_ID;
      button.type = 'button';
      button.classList.add('ytp-button');
      button.title = '字幕脚本设置';
      button.setAttribute('aria-label', '字幕脚本设置');
      button.appendChild(createToggleIcon());
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        toggleControlPanel();
      });
    }
    button.classList.add('ytp-button');
    if (!button.querySelector('svg')) button.replaceChildren(createToggleIcon());
    const toolbar = player.querySelector('.ytp-right-controls');
    if (toolbar) {
      const settingsButton = toolbar.querySelector('.ytp-settings-button');
      const targetGroup = settingsButton?.parentElement || toolbar.querySelector('.ytp-right-controls-right') || toolbar;
      const insertBeforeNode = settingsButton?.parentElement === targetGroup ? settingsButton : targetGroup.firstChild;
      if (button.parentElement !== targetGroup) {
        targetGroup.insertBefore(button, insertBeforeNode);
      } else if (settingsButton?.parentElement === targetGroup && button.nextElementSibling !== settingsButton) {
        targetGroup.insertBefore(button, settingsButton);
      }
    } else if (button.parentElement !== player) {
      player.appendChild(button);
    }
    syncToggleButtonState();
    return button;
  }

  function createToggleIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const rect = document.createElementNS(ns, 'path');
    rect.setAttribute('d', 'M4 5.5h16c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-9c0-1.1.9-2 2-2Zm0 2v9h16v-9H4Z');
    const lineOne = document.createElementNS(ns, 'path');
    lineOne.setAttribute('d', 'M6.5 11h5v1.8h-5V11Zm6.5 0h4.5v1.8H13V11ZM6.5 14h7v1.8h-7V14Zm8.5 0h2.5v1.8H15V14Z');
    svg.append(rect, lineOne);
    return svg;
  }

  function makeButton(text, title, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    if (title) button.title = title;
    button.addEventListener('click', onClick);
    return button;
  }

  function makeRow(labelText, control) {
    const row = document.createElement('div');
    row.className = `${SCRIPT_ID}-row`;
    const label = document.createElement('label');
    label.textContent = labelText;
    row.append(label, control);
    return row;
  }

  function makeVolcRow(labelText, control) {
    const row = makeRow(labelText, control);
    row.dataset.role = 'volcRow';
    return row;
  }

  function makeAuthRow(labelText, control, mode) {
    const row = makeVolcRow(labelText, control);
    row.dataset.authMode = mode;
    return row;
  }

  function syncVoiceEngineRows() {
    const panel = document.getElementById(CONTROL_ID);
    if (!panel) return;
    const isVolc = state.settings.voiceEngine === 'volc';
    for (const row of panel.querySelectorAll('[data-role="volcRow"]')) {
      const authVisible = !row.dataset.authMode || row.dataset.authMode === state.settings.volcAuthMode;
      row.classList.toggle(`${SCRIPT_ID}-volc-hidden`, !isVolc || !authVisible);
    }
    const browserRow = panel.querySelector('[data-role="browserVoiceRow"]');
    if (browserRow) browserRow.classList.toggle(`${SCRIPT_ID}-volc-hidden`, isVolc);
  }

  function createVoicePicker() {
    const picker = document.createElement('span');
    picker.className = `${SCRIPT_ID}-voice-picker`;

    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.dataset.role = 'voiceName';
    hidden.value = state.settings.voiceName || '';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${SCRIPT_ID}-voice-button`;
    button.dataset.role = 'voiceNameButton';
    button.title = '选择语音人物';

    const menu = document.createElement('div');
    menu.className = `${SCRIPT_ID}-voice-menu`;
    menu.dataset.role = 'voiceNameMenu';

    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      menu.classList.toggle(`${SCRIPT_ID}-visible`);
    });
    picker.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', () => menu.classList.remove(`${SCRIPT_ID}-visible`));

    picker.append(hidden, button, menu);
    populateVoiceOptions(picker);
    return picker;
  }

  function populateVoiceOptions(picker) {
    if (!picker) return;
    const hidden = picker.querySelector?.('[data-role="voiceName"]') || picker;
    const button = picker.querySelector?.('[data-role="voiceNameButton"]');
    const menu = picker.querySelector?.('[data-role="voiceNameMenu"]');
    const previous = hidden.value || state.settings.voiceName || '';
    const voices = getSortedChineseVoices();
    const choices = [
      { value: '', label: '自动选择自然中文语音' },
      { value: AUTO_MALE_VOICE, label: '自动选择中文男声' }
    ];

    for (const voice of voices) {
      const tags = [];
      if (isLikelyMaleVoice(voice)) tags.push('男声');
      else if (isLikelyFemaleVoice(voice)) tags.push('女声');
      if (voice.localService === false) tags.push('在线/自然');
      choices.push({
        value: voice.name,
        label: `${voice.name}${tags.length ? ` · ${tags.join('/')}` : ''} (${voice.lang || 'unknown'})`
      });
    }

    hidden.value = previous === AUTO_MALE_VOICE || voices.some(voice => voice.name === previous) ? previous : '';
    if (menu) {
      menu.textContent = '';
      for (const choice of choices) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = `${SCRIPT_ID}-voice-option`;
        option.dataset.value = choice.value;
        option.textContent = choice.label;
        option.title = choice.label;
        option.classList.toggle(`${SCRIPT_ID}-active`, choice.value === hidden.value);
        option.addEventListener('click', event => {
          event.preventDefault();
          hidden.value = choice.value;
          menu.classList.remove(`${SCRIPT_ID}-visible`);
          updateSetting('voiceName', choice.value);
        });
        menu.appendChild(option);
      }
    }
    if (button) {
      const active = choices.find(choice => choice.value === hidden.value) || choices[0];
      button.textContent = active.label;
      button.title = active.label;
    }
  }

  function createVolcVoicePicker() {
    const picker = document.createElement('span');
    picker.className = `${SCRIPT_ID}-voice-picker`;

    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.dataset.role = 'volcVoice';
    hidden.value = state.settings.volcVoice;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${SCRIPT_ID}-voice-button`;
    button.dataset.role = 'volcVoiceButton';

    const menu = document.createElement('div');
    menu.className = `${SCRIPT_ID}-voice-menu`;
    menu.dataset.role = 'volcVoiceMenu';

    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      menu.classList.toggle(`${SCRIPT_ID}-visible`);
    });
    picker.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', () => menu.classList.remove(`${SCRIPT_ID}-visible`));
    picker.append(hidden, button, menu);
    populateVolcVoiceOptions(picker);
    return picker;
  }

  function findVolcVoice(value) {
    for (const group of VOLC_VOICE_GROUPS) {
      const voice = group.voices.find(([voiceValue]) => voiceValue === value);
      if (voice) {
        return {
          value: voice[0],
          label: voice[1],
          gender: /^(zh_male_|saturn_zh_male_)/.test(voice[0]) ? 'male' : 'female',
        };
      }
    }
    return null;
  }

  function getVolcFavorites(gender = '') {
    const favorites = Array.isArray(state.settings.volcFavorites) ? state.settings.volcFavorites : [];
    return favorites
      .map(findVolcVoice)
      .filter(voice => voice && (!gender || voice.gender === gender));
  }

  function isVolcFavorite(value) {
    return getVolcFavorites().some(voice => voice.value === value);
  }

  function toggleVolcFavorite(value) {
    const favorites = Array.isArray(state.settings.volcFavorites) ? [...state.settings.volcFavorites] : [];
    const index = favorites.indexOf(value);
    if (index >= 0) {
      favorites.splice(index, 1);
      if (state.settings.volcMaleQuickVoice === value) state.settings.volcMaleQuickVoice = '';
      if (state.settings.volcFemaleQuickVoice === value) state.settings.volcFemaleQuickVoice = '';
    } else {
      favorites.push(value);
    }
    state.settings.volcFavorites = favorites;
    saveSettings();
    syncControlValues();
  }

  function populateVolcVoiceOptions(picker) {
    const hidden = picker.querySelector('[data-role="volcVoice"]');
    const button = picker.querySelector('[data-role="volcVoiceButton"]');
    const menu = picker.querySelector('[data-role="volcVoiceMenu"]');
    const selectedValue = state.settings.volcVoice;
    menu.textContent = '';
    let selectedLabel = '';
    for (const group of VOLC_VOICE_GROUPS) {
      const heading = document.createElement('div');
      heading.className = `${SCRIPT_ID}-voice-group-label`;
      heading.textContent = group.label;
      menu.appendChild(heading);
      for (const [value, label] of group.voices) {
        const row = document.createElement('div');
        row.className = `${SCRIPT_ID}-voice-option-row`;
        const option = document.createElement('button');
        option.type = 'button';
        option.className = `${SCRIPT_ID}-voice-option`;
        option.dataset.value = value;
        option.textContent = label;
        option.title = label;
        option.classList.toggle(`${SCRIPT_ID}-active`, value === selectedValue);
        if (value === selectedValue) selectedLabel = label;
        option.addEventListener('click', event => {
          event.preventDefault();
          menu.classList.remove(`${SCRIPT_ID}-visible`);
          updateSetting('volcVoice', value);
        });
        const favorite = document.createElement('button');
        favorite.type = 'button';
        favorite.className = `${SCRIPT_ID}-voice-favorite-toggle`;
        favorite.classList.toggle(`${SCRIPT_ID}-active`, isVolcFavorite(value));
        favorite.textContent = isVolcFavorite(value) ? '★' : '☆';
        favorite.title = isVolcFavorite(value) ? '取消收藏' : '收藏音色';
        favorite.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          toggleVolcFavorite(value);
        });
        row.append(option, favorite);
        menu.appendChild(row);
      }
    }
    hidden.value = selectedValue;
    button.textContent = selectedLabel || VOLC_VOICE_GROUPS[0].voices[0][1];
    button.title = button.textContent;
  }

  function renderVolcFavorites(container) {
    const favorites = getVolcFavorites();
    container.textContent = '';
    if (!favorites.length) {
      const empty = document.createElement('span');
      empty.className = `${SCRIPT_ID}-credential-note`;
      empty.textContent = '点击音色列表中的 ☆ 收藏';
      container.appendChild(empty);
      return;
    }
    for (const voice of favorites) {
      const button = makeButton(voice.label, `切换为 ${voice.label}`, () => updateSetting('volcVoice', voice.value));
      button.classList.toggle(`${SCRIPT_ID}-active`, voice.value === state.settings.volcVoice);
      container.appendChild(button);
    }
  }

  function populateVolcQuickVoiceSelect(select, role) {
    const gender = role === 'volcMaleQuickVoice' ? 'male' : 'female';
    const currentValue = state.settings[role] || '';
    const favorites = getVolcFavorites(gender);
    select.textContent = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = gender === 'male' ? '选择收藏男声' : '选择收藏女声';
    select.appendChild(placeholder);
    for (const voice of favorites) {
      const option = document.createElement('option');
      option.value = voice.value;
      option.textContent = voice.label;
      select.appendChild(option);
    }
    select.value = favorites.some(voice => voice.value === currentValue) ? currentValue : '';
  }

  function createVolcQuickVoiceSelect(role) {
    const select = document.createElement('select');
    select.dataset.role = role;
    select.addEventListener('change', () => updateSetting(role, select.value));
    populateVolcQuickVoiceSelect(select, role);
    return select;
  }

  function applyVolcQuickVoice(role, label) {
    const value = state.settings[role];
    const voice = value && findVolcVoice(value);
    if (!voice) {
      showStatus(`请先选择${label}快捷音色`);
      return;
    }
    updateSetting('volcVoice', value);
    showStatus(`已切换为${label}：${voice.label}`);
  }

  function syncVolcFavoriteControls() {
    const panel = document.getElementById(CONTROL_ID);
    if (!panel) return;
    const favorites = panel.querySelector('[data-role="volcFavoritesBar"]');
    if (favorites) renderVolcFavorites(favorites);
    for (const role of ['volcMaleQuickVoice', 'volcFemaleQuickVoice']) {
      const select = panel.querySelector(`[data-role="${role}"]`);
      if (select) populateVolcQuickVoiceSelect(select, role);
    }
    const maleButton = panel.querySelector('[data-role="applyVolcMaleQuickVoice"]');
    const femaleButton = panel.querySelector('[data-role="applyVolcFemaleQuickVoice"]');
    if (maleButton) maleButton.disabled = !state.settings.volcMaleQuickVoice;
    if (femaleButton) femaleButton.disabled = !state.settings.volcFemaleQuickVoice;
  }

  function getSortedChineseVoices() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    return voices
      .filter(voice => isChineseVoice(voice))
      .sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
  }

  function isChineseVoice(voice) {
    return /^zh/i.test(voice.lang || '') || /Chinese|中文|普通话|Mandarin|Xiaoxiao|Yunxi|Yunyang|Xiaoyi|Xiaochen|Xiaohan|Xiaomeng|Yunjian|Yunfeng|Yunhao|Yunze|Kangkang|Danny|Daniel/i.test(voice.name || '');
  }

  function isLikelyMaleVoice(voice) {
    const text = `${voice.name || ''} ${voice.lang || ''}`;
    return /Yunyang|Yunxi|Yunjian|Yunfeng|Yunhao|Yunze|Kangkang|Danny|Daniel|Male|男/i.test(text);
  }

  function isLikelyFemaleVoice(voice) {
    const text = `${voice.name || ''} ${voice.lang || ''}`;
    return /Xiaoxiao|Xiaoyi|Xiaochen|Xiaohan|Xiaomeng|Huihui|Yaoyao|Kangkang|Female|女/i.test(text) && !isLikelyMaleVoice(voice);
  }

  function voiceScore(voice) {
    const text = `${voice.name || ''} ${voice.lang || ''}`;
    let score = 0;
    if (/zh[-_]?CN/i.test(voice.lang || '')) score += 80;
    if (/Google 普通话（中国大陆）/i.test(text)) score += 120;
    if (/Google/i.test(text) && /普通话|Mandarin|Chinese|中文/i.test(text)) score += 90;
    if (isLikelyMaleVoice(voice)) score += 70;
    if (/Natural|Neural|Online|Xiaoxiao|Yunxi|Yunyang|Xiaoyi|Xiaochen|Xiaohan|Xiaomeng/i.test(text)) score += 60;
    if (voice.localService === false) score += 20;
    if (/Microsoft/i.test(text)) score += 10;
    return score;
  }

  function ensureControls(player) {
    let panel = document.getElementById(CONTROL_ID);
    if (panel) {
      if (!panel.querySelector('[data-role="voiceEngine"]') || !panel.querySelector('[data-role="volcAuthMode"]') || !panel.querySelector('[data-role="volcVoice"]') || !panel.querySelector('[data-role="volcFavoritesBar"]') || !panel.querySelector('[data-role="originalVolume"]')) {
        panel.remove();
        panel = null;
      }
    }
    if (panel) {
      if (panel.parentElement !== player) player.appendChild(panel);
      return panel;
    }

    panel = document.createElement('div');
    panel.id = CONTROL_ID;

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = state.settings.enabled;
    enabled.addEventListener('change', () => updateSetting('enabled', enabled.checked));

    const mode = document.createElement('select');
    for (const [value, text] of [['zh', '中文'], ['bilingual', '双语']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      mode.appendChild(option);
    }
    mode.value = state.settings.mode;
    mode.addEventListener('change', () => updateSetting('mode', mode.value));

    const fontSize = document.createElement('input');
    fontSize.type = 'range';
    fontSize.min = '18';
    fontSize.max = '42';
    fontSize.step = '1';
    fontSize.value = String(state.settings.fontSize);
    fontSize.addEventListener('input', () => updateSetting('fontSize', Number(fontSize.value)));

    const position = document.createElement('input');
    position.type = 'range';
    position.min = '4';
    position.max = '24';
    position.step = '1';
    position.value = String(state.settings.position);
    position.addEventListener('input', () => updateSetting('position', Number(position.value)));

    const offset = document.createElement('select');
    for (const value of [-800, -500, -300, 0, 300, 500, 800]) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${value > 0 ? '+' : ''}${value}ms`;
      offset.appendChild(option);
    }
    offset.value = String(state.settings.offsetMs);
    offset.addEventListener('change', () => updateSetting('offsetMs', Number(offset.value)));

    const hideNative = document.createElement('input');
    hideNative.type = 'checkbox';
    hideNative.checked = state.settings.hideNative;
    hideNative.addEventListener('change', () => updateSetting('hideNative', hideNative.checked));

    const voiceEnabled = document.createElement('input');
    voiceEnabled.type = 'checkbox';
    voiceEnabled.checked = state.settings.voiceEnabled;
    voiceEnabled.addEventListener('change', () => updateSetting('voiceEnabled', voiceEnabled.checked));

    const voiceEngine = document.createElement('select');
    voiceEngine.dataset.role = 'voiceEngine';
    for (const [value, text] of [['browser', '浏览器本地语音'], ['volc', '火山自然语音']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      voiceEngine.appendChild(option);
    }
    voiceEngine.value = state.settings.voiceEngine;
    voiceEngine.addEventListener('change', () => updateSetting('voiceEngine', voiceEngine.value));

    const volcAuthMode = document.createElement('select');
    volcAuthMode.dataset.role = 'volcAuthMode';
    for (const [value, text] of [['apiKey', '新版 API Key'], ['legacy', '旧版 APP ID + Access Token']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      volcAuthMode.appendChild(option);
    }
    volcAuthMode.value = state.settings.volcAuthMode;
    volcAuthMode.addEventListener('change', () => updateSetting('volcAuthMode', volcAuthMode.value));

    const voicePicker = createVoicePicker();
    if (window.speechSynthesis) {
      window.speechSynthesis.addEventListener?.('voiceschanged', () => populateVoiceOptions(voicePicker));
    }
    const testVoiceButton = makeButton('测试语音', '朗读一句示例，确认当前语音人物', () => testSelectedVoice());
    testVoiceButton.dataset.role = 'testVoiceButton';

    const apiKeyWrap = document.createElement('span');
    apiKeyWrap.className = `${SCRIPT_ID}-api-key`;
    const apiKey = document.createElement('input');
    apiKey.type = 'password';
    apiKey.dataset.role = 'volcApiKey';
    apiKey.placeholder = '本机保存 API Key';
    apiKey.autocomplete = 'off';
    apiKey.value = getVolcApiKey();
    const saveApiKey = makeButton('保存', '仅保存到本机 Tampermonkey 存储', () => {
      saveVolcApiKey(apiKey.value);
      showStatus(apiKey.value.trim() ? '火山 API Key 已保存到本机' : '火山 API Key 已清除');
    });
    apiKeyWrap.append(apiKey, saveApiKey);

    const legacy = getVolcLegacyCredentials();
    const appId = document.createElement('input');
    appId.type = 'text';
    appId.dataset.role = 'volcAppId';
    appId.placeholder = 'APP ID';
    appId.autocomplete = 'off';
    appId.value = legacy.appId;

    const accessTokenWrap = document.createElement('span');
    accessTokenWrap.className = `${SCRIPT_ID}-api-key`;
    const accessToken = document.createElement('input');
    accessToken.type = 'password';
    accessToken.dataset.role = 'volcAccessToken';
    accessToken.placeholder = 'Access Token';
    accessToken.autocomplete = 'off';
    accessToken.value = legacy.accessToken;
    const saveLegacy = makeButton('保存', '仅保存到本机 Tampermonkey 存储', () => {
      saveVolcLegacyCredentials(appId.value, accessToken.value);
      showStatus(appId.value.trim() && accessToken.value.trim() ? 'APP ID 与 Access Token 已保存到本机' : '旧版凭证已清除');
    });
    accessTokenWrap.append(accessToken, saveLegacy);

    const legacyNote = document.createElement('span');
    legacyNote.className = `${SCRIPT_ID}-credential-note`;
    legacyNote.textContent = 'Secret Key 不用于此接口';

    const volcVoice = createVolcVoicePicker();
    const volcFavorites = document.createElement('span');
    volcFavorites.className = `${SCRIPT_ID}-favorite-voices`;
    volcFavorites.dataset.role = 'volcFavoritesBar';
    renderVolcFavorites(volcFavorites);

    const volcMaleQuickVoice = createVolcQuickVoiceSelect('volcMaleQuickVoice');
    const volcFemaleQuickVoice = createVolcQuickVoiceSelect('volcFemaleQuickVoice');
    const quickButtons = document.createElement('span');
    quickButtons.className = `${SCRIPT_ID}-quick-buttons`;
    const switchMaleVoice = makeButton('切男声', '切换到已设置的男声音色', () => applyVolcQuickVoice('volcMaleQuickVoice', '男声'));
    switchMaleVoice.dataset.role = 'applyVolcMaleQuickVoice';
    const switchFemaleVoice = makeButton('切女声', '切换到已设置的女声音色', () => applyVolcQuickVoice('volcFemaleQuickVoice', '女声'));
    switchFemaleVoice.dataset.role = 'applyVolcFemaleQuickVoice';
    quickButtons.append(switchMaleVoice, switchFemaleVoice);

    const voiceRate = document.createElement('select');
    voiceRate.dataset.role = 'voiceRate';
    for (const value of [0.85, 1, 1.08, 1.18, 1.3]) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${value}x`;
      voiceRate.appendChild(option);
    }
    voiceRate.value = String(state.settings.voiceRate);
    voiceRate.addEventListener('change', () => updateSetting('voiceRate', Number(voiceRate.value)));

    const originalVolumeWrap = document.createElement('span');
    originalVolumeWrap.style.display = 'flex';
    originalVolumeWrap.style.alignItems = 'center';
    originalVolumeWrap.style.gap = '6px';
    const originalVolumeSlider = document.createElement('input');
    originalVolumeSlider.dataset.role = 'originalVolume';
    originalVolumeSlider.type = 'range';
    originalVolumeSlider.min = '0';
    originalVolumeSlider.max = '100';
    originalVolumeSlider.step = '1';
    originalVolumeSlider.value = String(Math.round(Number(state.settings.originalVolume) * 100));
    const originalVolumeValue = document.createElement('span');
    originalVolumeValue.dataset.role = 'originalVolumeValue';
    originalVolumeValue.textContent = `${originalVolumeSlider.value}%`;
    originalVolumeSlider.addEventListener('input', () => {
      originalVolumeValue.textContent = `${originalVolumeSlider.value}%`;
      updateSetting('originalVolume', Number(originalVolumeSlider.value) / 100);
    });
    originalVolumeWrap.append(originalVolumeSlider, originalVolumeValue);

    const buttons = document.createElement('div');
    buttons.className = `${SCRIPT_ID}-buttons`;
    buttons.append(
      makeButton('重新加载', '重新加载字幕', () => reloadCurrentVideo(true)),
      makeButton('SRT', '导出 .srt 字幕', () => downloadSubtitle('srt')),
      makeButton('VTT', '导出 .vtt 字幕', () => downloadSubtitle('vtt')),
      makeButton('TXT', '导出 .txt 文本', () => downloadSubtitle('txt')),
      makeButton('清缓存', '清除当前视频字幕缓存', () => clearCurrentCache()),
      makeButton('关闭', '关闭面板', () => panel.classList.remove(`${SCRIPT_ID}-visible`))
    );

    const browserVoiceRow = makeRow('语音人物', voicePicker);
    browserVoiceRow.dataset.role = 'browserVoiceRow';
    panel.append(
      makeRow('启用', enabled),
      makeRow('模式', mode),
      makeRow('字号', fontSize),
      makeRow('位置', position),
      makeRow('字幕延迟', offset),
      makeRow('隐藏原生字幕', hideNative),
      makeRow('中文配音', voiceEnabled),
      makeRow('配音引擎', voiceEngine),
      browserVoiceRow,
      makeVolcRow('鉴权方式', volcAuthMode),
      makeAuthRow('新版 Key', apiKeyWrap, 'apiKey'),
      makeAuthRow('APP ID', appId, 'legacy'),
      makeAuthRow('Access Token', accessTokenWrap, 'legacy'),
      makeAuthRow('说明', legacyNote, 'legacy'),
      makeVolcRow('火山音色', volcVoice),
      makeVolcRow('常用音色', volcFavorites),
      makeVolcRow('男声快捷', volcMaleQuickVoice),
      makeVolcRow('女声快捷', volcFemaleQuickVoice),
      makeVolcRow('快捷切换', quickButtons),
      makeRow('测试语音', testVoiceButton),
      makeRow('配音语速', voiceRate),
      makeRow('原声音量', originalVolumeWrap),
      buttons
    );
    player.appendChild(panel);
    syncVolcFavoriteControls();
    syncVoiceEngineRows();
    return panel;
  }

  function updateSetting(key, value) {
    if (key === 'voiceEngine' || key === 'volcAuthMode' || key === 'voiceName' || key === 'volcVoice' || key === 'voiceRate') {
      cancelSpeech();
      state.spokenCueIndex = -1;
    }
    state.settings[key] = value;
    saveSettings();
    syncControlValues();
    applyVisualSettings();
    applyVoiceSettings();
    syncVoiceEngineRows();
    renderCurrentCue();
  }

  function applyVisualSettings() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      overlay.style.setProperty(`--${SCRIPT_ID}-font-size`, String(state.settings.fontSize));
      overlay.style.setProperty(`--${SCRIPT_ID}-bottom`, String(state.settings.position));
    }
    document.documentElement.classList.toggle(`${SCRIPT_ID}-hide-native`, Boolean(state.settings.hideNative));
  }

  function syncControlValues() {
    const panel = document.getElementById(CONTROL_ID);
    if (!panel) return;
    const inputs = panel.querySelectorAll('input, select');
    for (const input of inputs) {
      const rowText = input.parentElement?.innerText || '';
      if (input.type === 'checkbox') {
        if (rowText.includes('启用') && !rowText.includes('中文配音')) input.checked = state.settings.enabled;
        if (rowText.includes('隐藏原生字幕')) input.checked = state.settings.hideNative;
        if (rowText.includes('中文配音')) input.checked = state.settings.voiceEnabled;
        continue;
      }
      if (input.dataset.role === 'voiceName') {
        input.value = state.settings.voiceName || '';
        const picker = input.closest(`.${SCRIPT_ID}-voice-picker`);
        if (picker) populateVoiceOptions(picker);
      }
      if (input.dataset.role === 'voiceRate') input.value = String(state.settings.voiceRate);
      if (input.dataset.role === 'voiceEngine') input.value = state.settings.voiceEngine;
      if (input.dataset.role === 'volcAuthMode') input.value = state.settings.volcAuthMode;
      if (input.dataset.role === 'volcVoice') {
        input.value = state.settings.volcVoice;
        const picker = input.closest(`.${SCRIPT_ID}-voice-picker`);
        if (picker) populateVolcVoiceOptions(picker);
      }
      if (input.dataset.role === 'originalVolume') {
        input.value = String(Math.round(Number(state.settings.originalVolume) * 100));
        const valueLabel = panel.querySelector('[data-role="originalVolumeValue"]');
        if (valueLabel) valueLabel.textContent = `${input.value}%`;
      }
    }
    syncVolcFavoriteControls();
  }

  function applyVoiceSettings() {
    const video = getVideoEl();
    if (!video) return;
    if (state.settings.voiceEnabled) {
      if (state.originalVolumeBeforeVoice === null) state.originalVolumeBeforeVoice = video.volume;
      video.volume = clamp(Number(state.settings.originalVolume), 0, 1);
      hookVideoEvents(video);
    } else {
      cancelSpeech();
      state.spokenCueIndex = -1;
      if (state.originalVolumeBeforeVoice !== null) {
        video.volume = clamp(state.originalVolumeBeforeVoice, 0, 1);
        state.originalVolumeBeforeVoice = null;
      }
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  }

  function showStatus(text, timeout = 3500) {
    state.pendingStatus = text;
    ensureOverlay();
    const status = document.getElementById(STATUS_ID);
    if (!status) return;
    status.textContent = text;
    status.classList.add(`${SCRIPT_ID}-visible`);
    window.clearTimeout(Number(status.dataset.timerId || 0));
    status.dataset.timerId = String(window.setTimeout(() => {
      status.classList.remove(`${SCRIPT_ID}-visible`);
      if (state.pendingStatus === text) state.pendingStatus = '';
    }, timeout));
  }

  function setCaption(cue) {
    const overlay = ensureOverlay();
    if (!overlay) return;
    const box = overlay.querySelector(`.${SCRIPT_ID}-box`);
    if (!box) return;
    box.textContent = '';
    if (!cue || !state.settings.enabled) {
      overlay.classList.remove(`${SCRIPT_ID}-visible`);
      return;
    }

    box.appendChild(document.createTextNode(cue.text));
    if (state.settings.mode === 'bilingual' && cue.sourceText) {
      const source = document.createElement('span');
      source.className = `${SCRIPT_ID}-source`;
      source.textContent = cue.sourceText;
      box.appendChild(source);
    }
    overlay.classList.add(`${SCRIPT_ID}-visible`);
  }

  function getPlayerResponse(videoId) {
    if (window.ytInitialPlayerResponse?.videoDetails?.videoId === videoId) return window.ytInitialPlayerResponse;
    const playerResponse = window.ytplayer?.config?.args?.player_response;
    if (playerResponse) {
      try {
        const parsed = typeof playerResponse === 'string' ? JSON.parse(playerResponse) : playerResponse;
        if (!videoId || parsed?.videoDetails?.videoId === videoId) return parsed;
      } catch (error) {
        log('ytplayer parse failed', error);
      }
    }
    return getPlayerResponseFromScripts(videoId);
  }

  function getPlayerResponseFromScripts(videoId) {
    for (const script of Array.from(document.scripts).reverse()) {
      const text = script.textContent || '';
      const markerIndex = text.indexOf('ytInitialPlayerResponse');
      if (markerIndex === -1) continue;
      const start = text.indexOf('{', markerIndex);
      if (start === -1) continue;
      const jsonText = extractBalancedJson(text, start);
      if (!jsonText) continue;
      try {
        const parsed = JSON.parse(jsonText);
        if (!videoId || parsed?.videoDetails?.videoId === videoId) return parsed;
      } catch (error) {
        log('script parse failed', error);
      }
    }
    return null;
  }

  function extractBalancedJson(text, start) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i += 1) {
      const char = text[i];
      if (inString) {
        if (escape) escape = false;
        else if (char === '\\') escape = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return '';
  }

  function selectBestCaptionSource(playerResponse) {
    const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const directChinese = tracks.find(track => CHINESE_LANG_RE.test(track.languageCode || '') && track.baseUrl);
    if (directChinese) {
      return { kind: 'direct-zh', targetTrack: directChinese, sourceTrack: null, needsTranslation: false };
    }

    const english = tracks.find(track => SOURCE_LANG_RE.test(track.languageCode || '') && track.baseUrl && track.isTranslatable !== false) ||
      tracks.find(track => SOURCE_LANG_RE.test(track.languageCode || '') && track.baseUrl) ||
      tracks.find(track => track.baseUrl && track.isTranslatable !== false);

    if (!english) return null;
    return { kind: 'translated-en', targetTrack: english, sourceTrack: english, needsTranslation: true };
  }

  function getClientContextParams() {
    const client = window.ytcfg?.data_?.INNERTUBE_CONTEXT?.client || {};
    return {
      xorb: '2',
      xobt: '3',
      xovt: '3',
      cbr: client.browserName || 'Chrome',
      cbrver: client.browserVersion || '',
      c: client.clientName || 'WEB',
      cver: client.clientVersion || window.ytcfg?.data_?.INNERTUBE_CONTEXT_CLIENT_VERSION || '',
      cplayer: 'UNIPLAYER',
      cos: client.osName || 'Windows',
      cosver: client.osVersion || '',
      cplatform: 'DESKTOP'
    };
  }

  function makeCaptionUrl(track, options = {}) {
    const url = new URL(track.baseUrl, location.origin);
    url.searchParams.set('fmt', 'json3');
    if (options.translate) url.searchParams.set('tlang', TARGET_LANG);
    else url.searchParams.delete('tlang');
    if (track.kind && !url.searchParams.has('kind')) url.searchParams.set('kind', track.kind);
    if (track.languageCode && !url.searchParams.has('lang')) url.searchParams.set('lang', track.languageCode);
    for (const [key, value] of Object.entries(getClientContextParams())) {
      if (value) url.searchParams.set(key, value);
    }
    return url.toString();
  }

  async function fetchCaptionJson(url) {
    const response = await fetch(url, { credentials: 'include', cache: 'force-cache' });
    if (!response.ok) throw classifyCaptionError(response.status);
    const text = await response.text();
    if (!text.trim()) throw new Error('YouTube 当前返回空字幕内容。');
    try {
      return JSON.parse(text);
    } catch {
      return parseTimedTextXml(text);
    }
  }

  async function fetchCaptionJsonWithFallback(videoId, track, options = {}) {
    const tried = new Set();
    let lastError = null;
    const tryUrl = async url => {
      if (!url || tried.has(url)) return null;
      tried.add(url);
      try {
        return await fetchCaptionJson(url);
      } catch (error) {
        lastError = error;
        return null;
      }
    };

    for (const url of findPerformanceCaptionUrls(videoId, options.translate)) {
      const json = await tryUrl(url);
      if (json) return json;
    }

    const json = await tryUrl(makeCaptionUrl(track, options));
    if (json) return json;

    await primeNativeCaptionRequest(track, options.translate);
    for (const url of findPerformanceCaptionUrls(videoId, options.translate)) {
      const jsonFromNativeUrl = await tryUrl(url);
      if (jsonFromNativeUrl) return jsonFromNativeUrl;
    }

    throw lastError || new Error('字幕接口没有返回可用内容。');
  }

  function findPerformanceCaptionUrls(videoId, translate) {
    return performance.getEntriesByType('resource')
      .map(entry => entry.name)
      .filter(name => {
        if (!name.includes('/api/timedtext')) return false;
        try {
          const url = new URL(name);
          if (url.searchParams.get('v') !== videoId) return false;
          const tlang = url.searchParams.get('tlang');
          return translate ? tlang === TARGET_LANG : !tlang;
        } catch {
          return false;
        }
      })
      .reverse();
  }

  async function primeNativeCaptionRequest(track, translate) {
    const player = document.getElementById('movie_player');
    if (!player || typeof player.setOption !== 'function') return;
    const nativeTrack = {
      languageCode: track.languageCode || 'en',
      languageName: getTrackName(track) || 'English',
      displayName: translate ? `${getTrackName(track) || 'English'} >> 中文（简体）` : getTrackName(track) || 'English',
      kind: track.kind || '',
      name: track.name?.simpleText || '',
      id: null,
      is_servable: false,
      is_default: false,
      is_translateable: track.isTranslatable !== false,
      vss_id: track.vssId || track.vss_id || ''
    };
    if (translate) {
      nativeTrack.translationLanguage = { languageCode: TARGET_LANG, languageName: '中文（简体）' };
    }

    try {
      player.setOption('captions', 'track', nativeTrack);
      await sleep(1200);
    } catch (error) {
      log('native caption priming failed', error);
    }
  }

  function getTrackName(track) {
    return track?.name?.simpleText || track?.name?.runs?.map(run => run.text).join('') || track?.languageCode || '';
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function classifyCaptionError(status) {
    if (status === 401 || status === 403) return new Error('字幕接口被权限或地区限制拦截。');
    if (status === 404) return new Error('当前视频没有可用字幕轨道。');
    if (status === 429) return new Error('YouTube 字幕接口暂时限流，请稍后刷新页面重试。');
    return new Error(`字幕接口请求失败：${status}`);
  }

  function parseTimedTextXml(text) {
    const xml = new DOMParser().parseFromString(text, 'text/xml');
    const nodes = Array.from(xml.querySelectorAll('text'));
    return {
      events: nodes.map(node => ({
        tStartMs: Math.round(Number(node.getAttribute('start') || 0) * 1000),
        dDurationMs: Math.round(Number(node.getAttribute('dur') || 2) * 1000),
        segs: [{ utf8: node.textContent || '' }]
      }))
    };
  }

  function normalizeRawCues(captionJson) {
    return (captionJson?.events || [])
      .filter(event => Array.isArray(event.segs))
      .map(event => {
        const start = Number(event.tStartMs || 0) / 1000;
        const duration = Number(event.dDurationMs || 0) / 1000;
        const text = cleanCaptionText(event.segs.map(seg => seg.utf8 || '').join(''));
        return { start, end: start + Math.max(duration, 0.7), text };
      })
      .filter(cue => cue.text)
      .sort((a, b) => a.start - b.start);
  }

  function cleanCaptionText(text) {
    return text
      .replace(/\s+\n/g, '\n')
      .replace(/\n\s+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([，。！？；：,.!?;:])/g, '$1')
      .trim();
  }

  function mergeSentenceCues(rawCues) {
    const merged = [];
    let current = null;
    for (const cue of rawCues) {
      if (!current) {
        current = { ...cue };
        continue;
      }

      const gap = cue.start - current.end;
      const shouldSplit = /[。！？.!?]\s*$/.test(current.text) ||
        gap > 0.8 ||
        countTextUnits(current.text) >= 34 ||
        current.text.includes('\n');

      if (shouldSplit) {
        merged.push(limitLines(current));
        current = { ...cue };
      } else {
        current.text = cleanCaptionText(`${current.text}${needsSpace(current.text, cue.text) ? ' ' : ''}${cue.text}`);
        current.end = Math.max(current.end, cue.end);
      }
    }
    if (current) merged.push(limitLines(current));
    return merged;
  }

  function countTextUnits(text) {
    return Array.from(text.replace(/\s/g, '')).length;
  }

  function needsSpace(left, right) {
    return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
  }

  function limitLines(cue) {
    const maxChars = 32;
    const text = cue.text.replace(/\n+/g, ' ');
    if (countTextUnits(text) <= maxChars) return { ...cue, text };
    const breakAt = findBreakPoint(text, maxChars);
    return { ...cue, text: `${text.slice(0, breakAt).trim()}\n${text.slice(breakAt).trim()}` };
  }

  function findBreakPoint(text, maxChars) {
    const chars = Array.from(text);
    let visible = 0;
    let candidate = -1;
    for (let i = 0; i < chars.length; i += 1) {
      if (!/\s/.test(chars[i])) visible += 1;
      if (/[，,、;；]\s*$/.test(chars.slice(Math.max(0, i - 1), i + 1).join('')) || chars[i] === ' ') candidate = i + 1;
      if (visible >= maxChars) return candidate > 8 ? candidate : i + 1;
    }
    return Math.ceil(chars.length / 2);
  }

  function attachSourceText(targetCues, sourceRawCues) {
    if (!sourceRawCues.length) return targetCues;
    const sourceMerged = mergeSentenceCues(sourceRawCues);
    return targetCues.map(cue => ({
      ...cue,
      sourceText: findOverlappingText(cue, sourceMerged)
    }));
  }

  function findOverlappingText(cue, sources) {
    const center = (cue.start + cue.end) / 2;
    const source = sources.find(item => center >= item.start - 0.25 && center <= item.end + 0.25) ||
      sources.reduce((best, item) => Math.abs(((item.start + item.end) / 2) - center) < Math.abs(((best.start + best.end) / 2) - center) ? item : best, sources[0]);
    return source?.text || '';
  }

  function getCacheKey(videoId, source) {
    return `${CACHE_PREFIX}${videoId}:${source.kind}:${TARGET_LANG}:v3`;
  }

  function readCachedCues(key) {
    if (memoryCache.has(key)) return memoryCache.get(key);
    try {
      const cached = JSON.parse(localStorage.getItem(key) || 'null');
      if (!cached || Date.now() - cached.savedAt > CACHE_TTL_MS) return null;
      memoryCache.set(key, cached.data);
      return cached.data;
    } catch {
      return null;
    }
  }

  function writeCachedCues(key, data) {
    memoryCache.set(key, data);
    try {
      localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
    } catch {
      log('localStorage cache write failed');
    }
  }

  async function loadCaptions(videoId, token, force = false) {
    if (!videoId) return;
    const response = getPlayerResponse(videoId);
    const source = selectBestCaptionSource(response);
    if (!source?.targetTrack?.baseUrl) throw new Error('没有找到可翻译的字幕轨道。');

    const cacheKey = getCacheKey(videoId, source);
    if (!force) {
      const cached = readCachedCues(cacheKey);
      if (cached) {
        applyCues(videoId, cached, token, '已从缓存加载字幕');
        return;
      }
    }

    showStatus(source.needsTranslation ? '正在读取 YouTube 自动翻译字幕...' : '正在读取 YouTube 中文字幕...');
    const targetJson = await fetchCaptionJsonWithFallback(videoId, source.targetTrack, { translate: source.needsTranslation });
    const targetRaw = normalizeRawCues(targetJson);
    let sourceRaw = [];
    if (source.sourceTrack?.baseUrl) {
      try {
        const sourceJson = await fetchCaptionJsonWithFallback(videoId, source.sourceTrack, { translate: false });
        sourceRaw = normalizeRawCues(sourceJson);
      } catch (error) {
        log('source caption load failed', error);
      }
    }

    const mergedTarget = attachSourceText(mergeSentenceCues(targetRaw), sourceRaw);
    if (!mergedTarget.length) throw new Error('字幕接口返回了空字幕。');
    const data = { cues: mergedTarget, rawTargetCues: targetRaw, rawSourceCues: sourceRaw, sourceKind: source.kind };
    writeCachedCues(cacheKey, data);
    applyCues(videoId, data, token, `中文字幕已加载：${mergedTarget.length} 句`);
  }

  function applyCues(videoId, data, token, statusText) {
    if (token !== state.loadToken || videoId !== state.videoId) return;
    state.cues = data.cues || [];
    state.rawTargetCues = data.rawTargetCues || [];
    state.rawSourceCues = data.rawSourceCues || [];
    state.cueIndex = -1;
    showStatus(statusText);
    startSyncLoop();
  }

  function findCueIndex(time) {
    const adjusted = time + (Number(state.settings.offsetMs) || 0) / 1000;
    const cues = state.cues;
    if (!cues.length) return -1;
    const current = state.cueIndex;
    if (current >= 0) {
      const cue = cues[current];
      if (adjusted >= cue.start && adjusted <= cue.end) return current;
      const next = cues[current + 1];
      if (next && adjusted >= next.start && adjusted <= next.end) return current + 1;
    }
    let low = 0;
    let high = cues.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const cue = cues[mid];
      if (adjusted < cue.start) high = mid - 1;
      else if (adjusted > cue.end) low = mid + 1;
      else return mid;
    }
    return -1;
  }

  function renderCurrentCue() {
    const video = getVideoEl();
    if (!video || !state.settings.enabled || !state.cues.length) {
      setCaption(null);
      return;
    }
    hookVideoEvents(video);
    const index = findCueIndex(video.currentTime);
    state.cueIndex = index;
    const cue = index >= 0 ? state.cues[index] : null;
    setCaption(cue);
    syncVoice(cue, index, video);
  }

  function syncCaption() {
    renderCurrentCue();
    state.rafId = window.setTimeout(syncCaption, CHECK_INTERVAL_MS);
  }

  function startSyncLoop() {
    if (state.rafId) window.clearTimeout(state.rafId);
    syncCaption();
  }

  function hookVideoEvents(video) {
    if (!video || state.videoHooked === video) return;
    if (state.videoHooked) {
      state.videoHooked.removeEventListener('pause', handleVideoPause);
      state.videoHooked.removeEventListener('seeking', handleVideoSeeking);
      state.videoHooked.removeEventListener('play', handleVideoPlay);
    }
    state.videoHooked = video;
    video.addEventListener('pause', handleVideoPause);
    video.addEventListener('seeking', handleVideoSeeking);
    video.addEventListener('play', handleVideoPlay);
    applyVoiceSettings();
  }

  function handleVideoPause() {
    if (state.settings.voiceEnabled && state.remoteAudio && !state.remoteAudio.paused) {
      state.remoteAudio.pause();
    } else if (state.settings.voiceEnabled && window.speechSynthesis?.speaking) {
      window.speechSynthesis.pause();
    }
  }

  function handleVideoPlay() {
    if (state.settings.voiceEnabled && state.remoteAudio?.paused && state.settings.voiceEngine === 'volc') {
      state.remoteAudio.play().catch(() => {});
    } else if (state.settings.voiceEnabled && window.speechSynthesis?.paused) {
      window.speechSynthesis.resume();
    }
  }

  function handleVideoSeeking() {
    cancelSpeech();
    state.spokenCueIndex = -1;
  }

  function syncVoice(cue, index, video) {
    if (!state.settings.voiceEnabled || !cue || index < 0 || video.paused) return;
    if (index === state.spokenCueIndex) return;
    state.spokenCueIndex = index;
    if (state.settings.voiceEngine === 'volc') {
      speakVolcCue(cue, index);
      return;
    }
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance !== 'function') {
      showStatus('当前浏览器不支持中文配音');
      updateSetting('voiceEnabled', false);
      return;
    }
    speakCue(cue);
  }

  function speakCue(cue) {
    const text = cue.text.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2) return;
    speakText(text, getSpeechRate(text));
  }

  function testSelectedVoice() {
    if (state.settings.voiceEngine === 'volc') {
      speakVolcText('这是一段火山自然语音测试，用来确认当前选择的配音人物。', true);
      return;
    }
    if (state.settings.voiceName === AUTO_MALE_VOICE && !findMaleChineseVoice()) {
      showStatus('未找到中文男声，请在系统或浏览器中安装中文男声语音。');
      return;
    }
    speakText('这是一段中文语音测试，用来确认当前选择的配音人物。', Number(state.settings.voiceRate));
  }

  function speakText(text, rate) {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance !== 'function') {
      showStatus('当前浏览器不支持中文配音');
      return;
    }
    cancelSpeech();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = clamp(Number(rate), 0.7, 1.6);
    utterance.pitch = 1;
    utterance.volume = 1;
    const voice = selectChineseVoice();
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  }

  function getSpeechRate(text) {
    const base = clamp(Number(state.settings.voiceRate), 0.7, 1.6);
    if (text.length > 60) return clamp(base + 0.12, 0.7, 1.6);
    if (text.length < 12) return clamp(base - 0.08, 0.7, 1.6);
    return base;
  }

  function selectChineseVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    if (state.settings.voiceName === AUTO_MALE_VOICE) {
      const maleVoice = findMaleChineseVoice();
      if (maleVoice) return maleVoice;
      showStatus('未找到中文男声，请在系统或浏览器中安装中文男声语音。');
      return getSortedChineseVoices()[0] || null;
    }
    if (state.settings.voiceName) {
      const selected = voices.find(voice => voice.name === state.settings.voiceName);
      if (selected) return selected;
    }
    return getSortedChineseVoices()[0] || null;
  }

  function findMaleChineseVoice() {
    return getSortedChineseVoices().find(voice => isLikelyMaleVoice(voice)) || null;
  }

  function getVolcAudioCacheKey(text) {
    return `${state.settings.volcVoice}|${state.settings.voiceRate}|${text}`;
  }

  function makeRequestId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function requestVolcAudio(text) {
    const headers = {
      'Content-Type': 'application/json',
      'X-Api-Resource-Id': VOLC_RESOURCE_ID,
      'X-Api-Request-Id': makeRequestId()
    };
    if (state.settings.volcAuthMode === 'legacy') {
      const legacy = getVolcLegacyCredentials();
      if (!legacy.appId || !legacy.accessToken) return Promise.reject(new Error('请填写并保存 APP ID 与 Access Token'));
      headers['X-Api-App-Id'] = legacy.appId;
      headers['X-Api-Access-Key'] = legacy.accessToken;
    } else {
      const apiKey = getVolcApiKey();
      if (!apiKey) return Promise.reject(new Error('请先填写并保存新版 API Key'));
      headers['X-Api-Key'] = apiKey;
    }
    if (typeof GM_xmlhttpRequest !== 'function') return Promise.reject(new Error('当前脚本未获得跨域请求权限'));
    const speechRate = Math.round((clamp(Number(state.settings.voiceRate), 0.7, 1.6) - 1) * 100);
    const payload = {
      user: { uid: 'youtube-userscript' },
      req_params: {
        text,
        speaker: state.settings.volcVoice,
        audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: speechRate }
      }
    };
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: VOLC_TTS_URL,
        headers,
        data: JSON.stringify(payload),
        responseType: 'text',
        timeout: 30000,
        onload: response => {
          if (response.status < 200 || response.status >= 300) {
            reject(new Error(`火山语音请求失败：HTTP ${response.status}`));
            return;
          }
          try {
            resolve(parseVolcAudioStream(response.responseText || response.response || ''));
          } catch (error) {
            reject(error);
          }
        },
        ontimeout: () => reject(new Error('火山语音请求超时')),
        onerror: () => reject(new Error('火山语音网络请求失败'))
      });
    });
  }

  function parseVolcAudioStream(raw) {
    const chunks = [];
    let position = 0;
    while (position < raw.length) {
      const start = raw.indexOf('{', position);
      if (start === -1) break;
      const json = extractBalancedJson(raw, start);
      if (!json) break;
      position = start + json.length;
      const frame = JSON.parse(json);
      if (frame.code && frame.code !== 20000000) {
        throw new Error(`火山语音合成失败：${frame.message || frame.code}`);
      }
      if (typeof frame.data === 'string' && frame.data) chunks.push(base64ToBytes(frame.data));
    }
    if (!chunks.length) throw new Error('火山语音未返回可播放音频');
    return URL.createObjectURL(new Blob(chunks, { type: 'audio/mpeg' }));
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function getVolcAudioUrl(text) {
    const key = getVolcAudioCacheKey(text);
    if (volcAudioCache.has(key)) return Promise.resolve(volcAudioCache.get(key));
    if (volcPendingCache.has(key)) return volcPendingCache.get(key);
    const pending = requestVolcAudio(text).then(url => {
      if (volcAudioCache.size >= 80) {
        const oldestKey = volcAudioCache.keys().next().value;
        URL.revokeObjectURL(volcAudioCache.get(oldestKey));
        volcAudioCache.delete(oldestKey);
      }
      volcAudioCache.set(key, url);
      return url;
    }).finally(() => volcPendingCache.delete(key));
    volcPendingCache.set(key, pending);
    return pending;
  }

  async function speakVolcText(text, showPlayingStatus = false) {
    const token = state.remoteVoiceToken + 1;
    cancelSpeech();
    state.remoteVoiceToken = token;
    try {
      const url = await getVolcAudioUrl(text);
      if (token !== state.remoteVoiceToken) return;
      const audio = new Audio(url);
      state.remoteAudio = audio;
      if (showPlayingStatus) showStatus('正在播放火山自然语音测试');
      await audio.play();
    } catch (error) {
      showStatus(error.message || '火山语音播放失败', 5000);
    }
  }

  function speakVolcCue(cue, index) {
    const text = cue.text.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2) return;
    speakVolcText(text);
    prefetchVolcCues(index + 1, 2);
  }

  function prefetchVolcCues(startIndex, count) {
    const hasCredentials = state.settings.volcAuthMode === 'legacy'
      ? Object.values(getVolcLegacyCredentials()).every(Boolean)
      : Boolean(getVolcApiKey());
    if (state.settings.voiceEngine !== 'volc' || !hasCredentials) return;
    for (const cue of state.cues.slice(startIndex, startIndex + count)) {
      const text = cue.text.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
      if (text.length >= 2) getVolcAudioUrl(text).catch(() => {});
    }
  }

  function cancelSpeech() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    state.remoteVoiceToken += 1;
    if (state.remoteAudio) {
      state.remoteAudio.pause();
      state.remoteAudio.currentTime = 0;
      state.remoteAudio = null;
    }
  }

  function reloadCurrentVideo(force = false) {
    const videoId = getVideoId();
    if (!videoId) return;
    state.videoId = videoId;
    state.cues = [];
    state.rawTargetCues = [];
    state.rawSourceCues = [];
    state.cueIndex = -1;
    state.spokenCueIndex = -1;
    cancelSpeech();
    state.loadToken += 1;
    setCaption(null);
    const token = state.loadToken;
    loadCaptions(videoId, token, force).catch(error => {
      if (token !== state.loadToken) return;
      console.warn(`[${SCRIPT_ID}]`, error);
      showStatus(error?.message || '简体中文字幕生成失败，请刷新或稍后重试。', 7000);
    });
  }

  function clearCurrentCache() {
    const videoId = getVideoId();
    if (!videoId) return;
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(`${CACHE_PREFIX}${videoId}:`)) localStorage.removeItem(key);
    }
    for (const key of Array.from(memoryCache.keys())) {
      if (key.startsWith(`${CACHE_PREFIX}${videoId}:`)) memoryCache.delete(key);
    }
    showStatus('当前视频字幕缓存已清除');
  }

  function downloadSubtitle(format) {
    if (!state.cues.length) {
      showStatus('当前没有可导出的字幕');
      return;
    }
    const base = `youtube-${state.videoId || 'captions'}-zh-Hans`;
    const content = format === 'srt' ? toSrt(state.cues) : format === 'vtt' ? toVtt(state.cues) : toText(state.cues);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function toSrt(cues) {
    return cues.map((cue, i) => `${i + 1}\n${formatSrtTime(cue.start)} --> ${formatSrtTime(cue.end)}\n${cue.text}${cue.sourceText && state.settings.mode === 'bilingual' ? `\n${cue.sourceText}` : ''}\n`).join('\n');
  }

  function toVtt(cues) {
    return `WEBVTT\n\n${cues.map(cue => `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${cue.text}${cue.sourceText && state.settings.mode === 'bilingual' ? `\n${cue.sourceText}` : ''}\n`).join('\n')}`;
  }

  function toText(cues) {
    return cues.map(cue => cue.text.replace(/\n/g, ' ')).join('\n');
  }

  function formatSrtTime(seconds) {
    return formatTime(seconds, ',');
  }

  function formatVttTime(seconds) {
    return formatTime(seconds, '.');
  }

  function formatTime(seconds, msSep) {
    const ms = Math.max(0, Math.round(seconds * 1000));
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const milli = ms % 1000;
    return `${pad(h)}:${pad(m)}:${pad(s)}${msSep}${String(milli).padStart(3, '0')}`;
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function hookKeyboard() {
    document.addEventListener('keydown', event => {
      if (event.altKey && event.shiftKey && event.code === 'KeyZ') {
        toggleControlPanel();
      }
    }, true);
  }

  function toggleControlPanel() {
    const existingPanel = document.getElementById(CONTROL_ID);
    ensureOverlay();
    const panel = document.getElementById(CONTROL_ID);
    if (!panel) return;
    panel.classList.toggle(`${SCRIPT_ID}-visible`);
    syncToggleButtonState();
    if (!existingPanel && panel.classList.contains(`${SCRIPT_ID}-visible`)) {
      showStatus('字幕面板已打开');
    }
  }

  function syncToggleButtonState() {
    const button = document.getElementById(TOGGLE_ID);
    const panel = document.getElementById(CONTROL_ID);
    if (!button || !panel) return;
    button.classList.toggle(`${SCRIPT_ID}-active`, panel.classList.contains(`${SCRIPT_ID}-visible`));
  }

  function registerTampermonkeyMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('打开/关闭字幕控制面板', () => toggleControlPanel());
    GM_registerMenuCommand('重新加载中文字幕', () => reloadCurrentVideo(true));
    GM_registerMenuCommand('启用/停用自定义字幕', () => updateSetting('enabled', !state.settings.enabled));
    GM_registerMenuCommand('启用/停用中文配音', () => updateSetting('voiceEnabled', !state.settings.voiceEnabled));
  }

  function checkRoute() {
    ensureOverlay();
    const videoId = getVideoId();
    const routeKey = `${location.href}::${videoId}`;
    if (videoId && routeKey !== state.lastUrl) {
      state.lastUrl = routeKey;
      reloadCurrentVideo(false);
    }
  }

  function hookYouTubeNavigation() {
    window.addEventListener('yt-navigate-finish', checkRoute, true);
    window.addEventListener('yt-page-data-updated', checkRoute, true);
    window.addEventListener('popstate', checkRoute, true);
    state.routeTimer = window.setInterval(checkRoute, ROUTE_INTERVAL_MS);
  }

  function init() {
    if (document.documentElement.dataset[SCRIPT_DATA_KEY]) return;
    document.documentElement.dataset[SCRIPT_DATA_KEY] = '1';
    injectStyle();
    hookKeyboard();
    registerTampermonkeyMenu();
    hookYouTubeNavigation();
    checkRoute();
  }

  init();
})();
