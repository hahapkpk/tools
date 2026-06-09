// ==UserScript==
// @name         YouTube English Auto Captions to Simplified Chinese
// @namespace    https://github.com/hahapkpk/tools
// @version      0.5.18
// @description  Shows clean Simplified Chinese or bilingual subtitles on YouTube with local translation and optional Chinese dubbing.
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
// @connect      tts.tencentcloudapi.com
// @connect      127.0.0.1
// @connect      localhost
// @connect      *
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
  const TENCENT_SECRET_ID_STORAGE_KEY = `${SCRIPT_ID}:tencent-secret-id`;
  const TENCENT_SECRET_KEY_STORAGE_KEY = `${SCRIPT_ID}:tencent-secret-key`;
  const VOLC_TTS_URL = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
  const VOLC_RESOURCE_ID = 'seed-tts-2.0';
  const TENCENT_TTS_URL = 'https://tts.tencentcloudapi.com';
  const TENCENT_TTS_HOST = 'tts.tencentcloudapi.com';
  const TENCENT_TTS_SERVICE = 'tts';
  const TENCENT_TTS_VERSION = '2019-08-23';
  const DEBUG = false;
  const CHECK_INTERVAL_MS = 120;
  const ROUTE_INTERVAL_MS = 800;
  const VOICE_MAX_LAG_SECONDS = 1.5;
  const VOICE_SMART_LAG_THRESHOLD_SECONDS = 0.8;
  const VOICE_SMART_MAX_PLAYBACK_RATE = 1.18;
  const VOICE_SENTENCE_MAX_GAP_SECONDS = 1.2;
  const VOICE_SENTENCE_MAX_UNITS = 120;
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

  const TENCENT_VOICE_GROUPS = [
    {
      label: '基础/精品音色（800万字符）',
      voices: [
        ['101030', '智柯 - 通用男声'],
        ['101054', '智友 - 通用男声'],
        ['101004', '智云 - 通用男声'],
        ['101013', '智辉 - 新闻男声'],
        ['101021', '智瑞 - 新闻男声'],
        ['101055', '智付 - 通用女声'],
        ['101027', '智梅 - 通用女声'],
        ['101026', '智希 - 通用女声'],
        ['101011', '智燕 - 新闻女声'],
        ['101001', '智瑜 - 情感女声'],
        ['101015', '智萌 - 男童声'],
        ['101016', '智甜 - 女童声']
      ]
    },
    {
      label: '大模型音色（10万字符）',
      voices: [
        ['501000', '智斌 - 阅读男声'],
        ['501003', '智宇 - 阅读男声'],
        ['501005', '飞镜 - 聊天男声'],
        ['501006', '千嶂 - 聊天男声'],
        ['501007', '浅草 - 聊天男声'],
        ['501001', '智兰 - 资讯女声'],
        ['501002', '智菊 - 阅读女声'],
        ['501004', '月华 - 聊天女声'],
        ['601008', '爱小豪 - 聊天男声'],
        ['601011', '爱小川 - 聊天男声'],
        ['601014', '爱小简 - 聊天男声'],
        ['601009', '爱小芊 - 聊天女声'],
        ['601010', '爱小娇 - 聊天女声'],
        ['601012', '爱小璟 - 特色女声'],
        ['601013', '爱小伊 - 阅读女声']
      ]
    },
    {
      label: '超自然大模型音色（2万字符）',
      voices: [
        ['502006', '智小悟 - 聊天男声'],
        ['502005', '智小解 - 解说男声'],
        ['602004', '暖心阿灿 - 聊天男声'],
        ['603000', '懂事少年 - 特色男声'],
        ['603003', '随和老李 - 聊天男声'],
        ['603005', '知心大林 - 聊天男声'],
        ['603006', '沉稳青叔 - 聊天男声'],
        ['502001', '智小柔 - 聊天女声'],
        ['502003', '智小敏 - 聊天女声'],
        ['502004', '智小满 - 营销女声'],
        ['602005', '专业梓欣 - 聊天女声'],
        ['603001', '潇湘妹妹 - 特色女声'],
        ['603004', '温柔小柠 - 聊天女声'],
        ['603007', '邻家女孩 - 聊天女声']
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
    translationEngine: 'local',
    voiceEnabled: false,
    voiceEngine: 'browser',
    volcAuthMode: 'apiKey',
    voiceName: 'Google 普通话（中国大陆）',
    volcVoice: 'zh_male_m191_uranus_bigtts',
    volcFavorites: [],
    volcMaleQuickVoice: '',
    volcFemaleQuickVoice: '',
    tencentProxyUrl: 'http://127.0.0.1:8788/tts',
    tencentRegion: 'ap-beijing',
    tencentVoiceType: '101030',
    tencentSampleRate: 16000,
    voiceRate: 1.08,
    voiceSyncMode: 'natural',
    terminologyMap: '',
    originalVolume: 0.25
  };

  const state = {
    videoId: '',
    cues: [],
    voiceCues: [],
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
    remoteVoiceStarting: false,
    remoteVoiceQueue: [],
    remoteVoiceCurrent: null,
    voiceProgressNotice: '',
    voiceProgressNoticeUntil: 0,
    localTranslators: new Map(),
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

  function getTencentCredentials() {
    try {
      return {
        secretId: typeof GM_getValue === 'function' ? String(GM_getValue(TENCENT_SECRET_ID_STORAGE_KEY, '') || '') : '',
        secretKey: typeof GM_getValue === 'function' ? String(GM_getValue(TENCENT_SECRET_KEY_STORAGE_KEY, '') || '') : ''
      };
    } catch {
      return { secretId: '', secretKey: '' };
    }
  }

  function saveTencentCredentials(secretId, secretKey) {
    if (typeof GM_setValue !== 'function') return;
    GM_setValue(TENCENT_SECRET_ID_STORAGE_KEY, String(secretId || '').trim());
    GM_setValue(TENCENT_SECRET_KEY_STORAGE_KEY, String(secretKey || '').trim());
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
      #${CONTROL_ID} button, #${CONTROL_ID} select, #${CONTROL_ID} input, #${CONTROL_ID} textarea {
        border: 1px solid rgba(255,255,255,0.22);
        border-radius: 4px;
        background: rgba(255,255,255,0.1);
        color: #fff;
        font: inherit;
        min-width: 0;
      }
      #${CONTROL_ID} select { width: 100%; }
      #${CONTROL_ID} input[type="range"] { width: 100%; }
      #${CONTROL_ID} textarea {
        width: 100%;
        min-height: 66px;
        padding: 5px 6px;
        resize: vertical;
        line-height: 1.45;
      }
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
      #${CONTROL_ID} .${SCRIPT_ID}-local-translation {
        display: flex;
        gap: 6px;
      }
      #${CONTROL_ID} .${SCRIPT_ID}-local-translation button {
        width: 100%;
      }
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

  function makeTencentRow(labelText, control) {
    const row = makeRow(labelText, control);
    row.dataset.role = 'tencentRow';
    return row;
  }

  function makeTencentProxyRow(labelText, control) {
    const row = makeRow(labelText, control);
    row.dataset.role = 'tencentProxyRow';
    return row;
  }

  function makeTencentDirectRow(labelText, control) {
    const row = makeRow(labelText, control);
    row.dataset.role = 'tencentDirectRow';
    return row;
  }

  function makeRemoteVoiceRow(labelText, control) {
    const row = makeRow(labelText, control);
    row.dataset.role = 'remoteVoiceRow';
    return row;
  }

  function makeAuthRow(labelText, control, mode) {
    const row = makeVolcRow(labelText, control);
    row.dataset.authMode = mode;
    return row;
  }

  function createTencentVoicePicker() {
    const picker = document.createElement('span');
    picker.className = `${SCRIPT_ID}-voice-picker`;

    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.dataset.role = 'tencentVoiceType';
    hidden.value = String(state.settings.tencentVoiceType || '');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${SCRIPT_ID}-voice-button`;
    button.dataset.role = 'tencentVoiceButton';
    button.title = '选择腾讯音色';

    const menu = document.createElement('div');
    menu.className = `${SCRIPT_ID}-voice-menu`;
    menu.dataset.role = 'tencentVoiceMenu';
    button.addEventListener('click', event => {
      event.stopPropagation();
      menu.classList.toggle(`${SCRIPT_ID}-visible`);
    });
    document.addEventListener('click', () => menu.classList.remove(`${SCRIPT_ID}-visible`), { capture: true });

    picker.append(hidden, button, menu);
    populateTencentVoiceOptions(picker);
    return picker;
  }

  function findTencentVoice(value) {
    for (const group of TENCENT_VOICE_GROUPS) {
      const found = group.voices.find(([voiceValue]) => voiceValue === value);
      if (found) return { value: found[0], label: found[1], group: group.label };
    }
    return null;
  }

  function populateTencentVoiceOptions(picker) {
    const hidden = picker.querySelector('[data-role="tencentVoiceType"]');
    const button = picker.querySelector('[data-role="tencentVoiceButton"]');
    const menu = picker.querySelector('[data-role="tencentVoiceMenu"]');
    if (!hidden || !button || !menu) return;
    const current = String(state.settings.tencentVoiceType || '101030');
    hidden.value = current;
    const currentVoice = findTencentVoice(current);
    button.textContent = currentVoice ? `${currentVoice.label} (${current})` : `自定义音色 (${current})`;
    menu.textContent = '';
    let hasCurrent = Boolean(currentVoice);
    for (const group of TENCENT_VOICE_GROUPS) {
      const heading = document.createElement('div');
      heading.className = `${SCRIPT_ID}-voice-group-label ${SCRIPT_ID}-tencent-voice-group`;
      heading.textContent = group.label;
      menu.appendChild(heading);
      for (const [value, text] of group.voices) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = `${SCRIPT_ID}-voice-option`;
        option.textContent = `${text} (${value})`;
        option.classList.toggle(`${SCRIPT_ID}-active`, value === current);
        option.addEventListener('click', event => {
          event.stopPropagation();
          updateSetting('tencentVoiceType', value);
          menu.classList.remove(`${SCRIPT_ID}-visible`);
        });
        menu.appendChild(option);
        if (value === current) hasCurrent = true;
      }
    }
    if (current && !hasCurrent) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = `${SCRIPT_ID}-voice-option ${SCRIPT_ID}-active`;
      option.textContent = `自定义音色 (${current})`;
      option.addEventListener('click', event => {
        event.stopPropagation();
        menu.classList.remove(`${SCRIPT_ID}-visible`);
      });
      menu.insertBefore(option, menu.firstChild);
    }
  }

  function syncTranslationEngineRows() {
    const panel = document.getElementById(CONTROL_ID);
    if (!panel) return;
    const localRow = panel.querySelector('[data-role="localTranslationRow"]');
    if (localRow) localRow.classList.toggle(`${SCRIPT_ID}-volc-hidden`, state.settings.translationEngine !== 'local');
  }

  function isRemoteVoiceEngine() {
    return state.settings.voiceEngine === 'volc' || state.settings.voiceEngine === 'tencent' || state.settings.voiceEngine === 'tencentDirect';
  }

  function syncVoiceEngineRows() {
    const panel = document.getElementById(CONTROL_ID);
    if (!panel) return;
    const isVolc = state.settings.voiceEngine === 'volc';
    const isTencent = state.settings.voiceEngine === 'tencent';
    const isTencentDirect = state.settings.voiceEngine === 'tencentDirect';
    const isRemote = isRemoteVoiceEngine();
    for (const row of panel.querySelectorAll('[data-role="volcRow"]')) {
      const authVisible = !row.dataset.authMode || row.dataset.authMode === state.settings.volcAuthMode;
      row.classList.toggle(`${SCRIPT_ID}-volc-hidden`, !isVolc || !authVisible);
    }
    for (const row of panel.querySelectorAll('[data-role="tencentRow"]')) {
      row.classList.toggle(`${SCRIPT_ID}-volc-hidden`, !isTencent && !isTencentDirect);
    }
    for (const row of panel.querySelectorAll('[data-role="tencentProxyRow"]')) {
      row.classList.toggle(`${SCRIPT_ID}-volc-hidden`, !isTencent);
    }
    for (const row of panel.querySelectorAll('[data-role="tencentDirectRow"]')) {
      row.classList.toggle(`${SCRIPT_ID}-volc-hidden`, !isTencentDirect);
    }
    for (const row of panel.querySelectorAll('[data-role="remoteVoiceRow"]')) {
      row.classList.toggle(`${SCRIPT_ID}-volc-hidden`, !isRemote);
    }
    const browserRow = panel.querySelector('[data-role="browserVoiceRow"]');
    if (browserRow) browserRow.classList.toggle(`${SCRIPT_ID}-volc-hidden`, isRemote);
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
      if (!panel.querySelector('[data-role="translationEngine"]') || !panel.querySelector('[data-role="voiceEngine"]') || !panel.querySelector('[data-role="volcAuthMode"]') || !panel.querySelector('[data-role="volcVoice"]') || !panel.querySelector('[data-role="volcFavoritesBar"]') || !panel.querySelector('[data-role="voiceSyncMode"]') || !panel.querySelector('[data-role="voiceProgressStatus"]') || !panel.querySelector('[data-role="originalVolume"]') || !panel.querySelector('[data-role="testVolcCredentials"]') || !panel.querySelector('[data-role="terminologyMap"]') || !panel.querySelector('[data-role="tencentProxyUrl"]')) {
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

    const translationEngine = document.createElement('select');
    translationEngine.dataset.role = 'translationEngine';
    for (const [value, text] of [['local', 'Chrome 本地翻译（推荐）'], ['youtube', 'YouTube 自动翻译（备用，可能限流）']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      translationEngine.appendChild(option);
    }
    translationEngine.value = state.settings.translationEngine;
    translationEngine.addEventListener('change', () => updateSetting('translationEngine', translationEngine.value));

    const localTranslationWrap = document.createElement('span');
    localTranslationWrap.className = `${SCRIPT_ID}-local-translation`;
    const prepareTranslationButton = makeButton('准备本地翻译', '首次使用需下载或初始化 Chrome 本地翻译模型', () => {
      prepareLocalTranslationForCurrentVideo().catch(error => showStatus(error.message || '本地翻译准备失败', 7000));
    });
    prepareTranslationButton.dataset.role = 'prepareLocalTranslation';
    localTranslationWrap.appendChild(prepareTranslationButton);
    const localTranslationRow = makeRow('本地翻译', localTranslationWrap);
    localTranslationRow.dataset.role = 'localTranslationRow';

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
    for (const [value, text] of [['browser', '浏览器本地语音'], ['volc', '火山自然语音'], ['tencent', '腾讯 TextToVoice（代理）'], ['tencentDirect', '腾讯 TextToVoice（直连）']]) {
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
    const testVolcCredentialsButton = makeButton('测试 Key', '验证当前火山凭证并播放测试语音', () => {
      if (state.settings.volcAuthMode === 'legacy') saveVolcLegacyCredentials(appId.value, accessToken.value);
      else saveVolcApiKey(apiKey.value);
      testVolcCredentials();
    });
    testVolcCredentialsButton.dataset.role = 'testVolcCredentials';

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

    const tencentProxyUrl = document.createElement('input');
    tencentProxyUrl.type = 'text';
    tencentProxyUrl.dataset.role = 'tencentProxyUrl';
    tencentProxyUrl.placeholder = 'http://127.0.0.1:8788/tts';
    tencentProxyUrl.value = state.settings.tencentProxyUrl || '';
    tencentProxyUrl.addEventListener('change', () => updateSetting('tencentProxyUrl', tencentProxyUrl.value.trim()));

    const tencentCredentials = getTencentCredentials();
    const tencentSecretId = document.createElement('input');
    tencentSecretId.type = 'text';
    tencentSecretId.dataset.role = 'tencentSecretId';
    tencentSecretId.placeholder = 'SecretId';
    tencentSecretId.autocomplete = 'off';
    tencentSecretId.value = tencentCredentials.secretId;

    const tencentSecretKeyWrap = document.createElement('span');
    tencentSecretKeyWrap.className = `${SCRIPT_ID}-api-key`;
    const tencentSecretKey = document.createElement('input');
    tencentSecretKey.type = 'password';
    tencentSecretKey.dataset.role = 'tencentSecretKey';
    tencentSecretKey.placeholder = 'SecretKey';
    tencentSecretKey.autocomplete = 'off';
    tencentSecretKey.value = tencentCredentials.secretKey;
    const saveTencentKey = makeButton('保存', '仅保存到本机 Tampermonkey 存储', () => {
      saveTencentCredentials(tencentSecretId.value, tencentSecretKey.value);
      showStatus(tencentSecretId.value.trim() && tencentSecretKey.value.trim() ? '腾讯 SecretId 与 SecretKey 已保存到本机' : '腾讯直连密钥已清除');
    });
    tencentSecretKeyWrap.append(tencentSecretKey, saveTencentKey);

    const tencentRegion = document.createElement('input');
    tencentRegion.type = 'text';
    tencentRegion.dataset.role = 'tencentRegion';
    tencentRegion.placeholder = 'ap-beijing';
    tencentRegion.value = state.settings.tencentRegion || 'ap-beijing';
    tencentRegion.addEventListener('change', () => updateSetting('tencentRegion', tencentRegion.value.trim() || 'ap-beijing'));

    const tencentVoiceType = createTencentVoicePicker();

    const tencentSampleRate = document.createElement('select');
    tencentSampleRate.dataset.role = 'tencentSampleRate';
    for (const value of [16000, 24000, 8000]) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${value} Hz`;
      tencentSampleRate.appendChild(option);
    }
    tencentSampleRate.value = String(state.settings.tencentSampleRate || 16000);
    tencentSampleRate.addEventListener('change', () => updateSetting('tencentSampleRate', Number(tencentSampleRate.value)));

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

    const voiceSyncMode = document.createElement('select');
    voiceSyncMode.dataset.role = 'voiceSyncMode';
    for (const [value, text] of [['natural', '自然流畅'], ['smart', '智能语速追赶'], ['sync', '紧跟画面']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      voiceSyncMode.appendChild(option);
    }
    voiceSyncMode.value = state.settings.voiceSyncMode;
    voiceSyncMode.addEventListener('change', () => updateSetting('voiceSyncMode', voiceSyncMode.value));

    const terminologyMap = document.createElement('textarea');
    terminologyMap.dataset.role = 'terminologyMap';
    terminologyMap.rows = 3;
    terminologyMap.placeholder = 'Notion=诺申\nMCP=M C P';
    terminologyMap.value = state.settings.terminologyMap || '';
    terminologyMap.addEventListener('change', () => updateSetting('terminologyMap', terminologyMap.value));

    const voiceProgressWrap = document.createElement('span');
    voiceProgressWrap.className = `${SCRIPT_ID}-quick-buttons`;
    const voiceProgressStatus = document.createElement('span');
    voiceProgressStatus.dataset.role = 'voiceProgressStatus';
    voiceProgressStatus.textContent = '同步正常';
    const catchUpButton = makeButton('立即追上', '清除排队配音并从当前字幕继续', () => catchUpVolcNarration());
    catchUpButton.dataset.role = 'catchUpVoice';
    voiceProgressWrap.append(voiceProgressStatus, catchUpButton);

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
      makeRow('字幕翻译', translationEngine),
      localTranslationRow,
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
      makeVolcRow('凭证测试', testVolcCredentialsButton),
      makeVolcRow('火山音色', volcVoice),
      makeVolcRow('常用音色', volcFavorites),
      makeVolcRow('男声快捷', volcMaleQuickVoice),
      makeVolcRow('女声快捷', volcFemaleQuickVoice),
      makeVolcRow('快捷切换', quickButtons),
      makeTencentProxyRow('腾讯代理', tencentProxyUrl),
      makeTencentDirectRow('腾讯 SecretId', tencentSecretId),
      makeTencentDirectRow('腾讯 SecretKey', tencentSecretKeyWrap),
      makeTencentDirectRow('腾讯 Region', tencentRegion),
      makeTencentRow('腾讯音色', tencentVoiceType),
      makeTencentRow('采样率', tencentSampleRate),
      makeRow('测试语音', testVoiceButton),
      makeRow('配音语速', voiceRate),
      makeRemoteVoiceRow('配音同步', voiceSyncMode),
      makeRemoteVoiceRow('专有名词修正表', terminologyMap),
      makeRemoteVoiceRow('配音状态', voiceProgressWrap),
      makeRow('原声音量', originalVolumeWrap),
      buttons
    );
    player.appendChild(panel);
    syncVolcFavoriteControls();
    syncTranslationEngineRows();
    syncVoiceEngineRows();
    refreshVoiceProgressStatus();
    return panel;
  }

  function updateSetting(key, value) {
    if (key === 'voiceEngine' || key === 'volcAuthMode' || key === 'voiceName' || key === 'volcVoice' || key === 'tencentProxyUrl' || key === 'tencentRegion' || key === 'tencentVoiceType' || key === 'tencentSampleRate' || key === 'voiceRate' || key === 'voiceSyncMode' || key === 'terminologyMap') {
      cancelSpeech();
      state.spokenCueIndex = -1;
    }
    state.settings[key] = value;
    saveSettings();
    syncControlValues();
    applyVisualSettings();
    applyVoiceSettings();
    syncTranslationEngineRows();
    syncVoiceEngineRows();
    renderCurrentCue();
    if (key === 'translationEngine') reloadCurrentVideo(true);
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
    const inputs = panel.querySelectorAll('input, select, textarea');
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
      if (input.dataset.role === 'voiceSyncMode') input.value = state.settings.voiceSyncMode;
      if (input.dataset.role === 'terminologyMap') input.value = state.settings.terminologyMap || '';
      if (input.dataset.role === 'translationEngine') input.value = state.settings.translationEngine;
      if (input.dataset.role === 'voiceEngine') input.value = state.settings.voiceEngine;
      if (input.dataset.role === 'volcAuthMode') input.value = state.settings.volcAuthMode;
      if (input.dataset.role === 'volcVoice') {
        input.value = state.settings.volcVoice;
        const picker = input.closest(`.${SCRIPT_ID}-voice-picker`);
        if (picker) populateVolcVoiceOptions(picker);
      }
      if (input.dataset.role === 'tencentProxyUrl') input.value = state.settings.tencentProxyUrl || '';
      if (input.dataset.role === 'tencentRegion') input.value = state.settings.tencentRegion || 'ap-beijing';
      if (input.dataset.role === 'tencentVoiceType') {
        input.value = state.settings.tencentVoiceType || '';
        const picker = input.closest(`.${SCRIPT_ID}-voice-picker`);
        if (picker) populateTencentVoiceOptions(picker);
      }
      if (input.dataset.role === 'tencentSampleRate') input.value = String(state.settings.tencentSampleRate || 16000);
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
    if (!cue || !state.settings.enabled || isErrorCaptionText(cue.text)) {
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
    const player = document.getElementById('movie_player');
    try {
      const liveResponse = player?.getPlayerResponse?.();
      if (!videoId || liveResponse?.videoDetails?.videoId === videoId) return liveResponse;
    } catch (error) {
      log('movie player response failed', error);
    }
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
      return { kind: 'youtube-native-zh', targetTrack: directChinese, sourceTrack: null, translationMode: 'none', sourceLanguage: 'zh' };
    }

    const sourceTrack = tracks.find(track => SOURCE_LANG_RE.test(track.languageCode || '') && track.baseUrl && track.isTranslatable !== false) ||
      tracks.find(track => SOURCE_LANG_RE.test(track.languageCode || '') && track.baseUrl) ||
      tracks.find(track => track.baseUrl && track.isTranslatable !== false);

    if (!sourceTrack) return null;
    const sourceLanguage = normalizeTranslatorLanguage(sourceTrack.languageCode || 'en');
    if (state.settings.translationEngine === 'youtube') {
      return { kind: 'youtube-auto-translate-zh', targetTrack: sourceTrack, sourceTrack, translationMode: 'youtube', sourceLanguage };
    }
    return { kind: 'chrome-local-zh', targetTrack: sourceTrack, sourceTrack, translationMode: 'local', sourceLanguage };
  }

  function normalizeTranslatorLanguage(languageCode) {
    return String(languageCode || 'en').split('-')[0].toLowerCase();
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
    if (!response.ok) {
      const isTranslated = new URL(url, location.origin).searchParams.has('tlang');
      throw classifyCaptionError(response.status, isTranslated);
    }
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
        if (error.rateLimited) throw error;
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

  function classifyCaptionError(status, isTranslated = false) {
    if (status === 401 || status === 403) return new Error('字幕接口被权限或地区限制拦截。');
    if (status === 404) return new Error('当前视频没有可用字幕轨道。');
    if (status === 429) {
      const error = new Error(isTranslated ? 'YouTube 自动翻译字幕已被限流，请切换到 Chrome 本地翻译。' : 'YouTube 原始字幕请求暂时被限流，请稍后重试。');
      error.rateLimited = true;
      return error;
    }
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

  function parseTranscriptTimestamp(text) {
    const parts = String(text || '').trim().split(':').map(Number);
    if (!parts.length || parts.some(part => !Number.isFinite(part))) return NaN;
    return parts.reduce((seconds, part) => (seconds * 60) + part, 0);
  }

  function readTranscriptCuesFromPanel() {
    const nodes = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer'));
    const legacyCues = nodes.map((node, index) => {
      const start = parseTranscriptTimestamp(node.querySelector('.segment-timestamp')?.textContent);
      const nextStart = parseTranscriptTimestamp(nodes[index + 1]?.querySelector('.segment-timestamp')?.textContent);
      const text = cleanCaptionText(node.querySelector('.segment-text')?.textContent || '');
      return {
        start,
        end: Number.isFinite(nextStart) && nextStart > start ? nextStart : start + 2.5,
        text
      };
    }).filter(cue => Number.isFinite(cue.start) && cue.text && !isErrorCaptionText(cue.text));
    return legacyCues.length ? legacyCues : readModernTranscriptCuesFromPanel();
  }

  function readModernTranscriptCuesFromPanel() {
    const panel = Array.from(document.querySelectorAll('ytd-engagement-panel-section-list-renderer'))
      .find(node => node.offsetParent && /转写文稿|Transcript|搜索转写内容|Search transcript/i.test(node.textContent || ''));
    if (!panel) return [];
    const nodes = Array.from(panel.querySelectorAll('transcript-segment-view-model, TRANSCRIPT-SEGMENT-VIEW-MODEL'));
    return nodes.map((node, index) => {
      const start = parseTranscriptTimestamp(node.querySelector('.ytwTranscriptSegmentViewModelTimestamp')?.textContent);
      const nextStart = parseTranscriptTimestamp(nodes[index + 1]?.querySelector('.ytwTranscriptSegmentViewModelTimestamp')?.textContent);
      const text = cleanCaptionText(node.querySelector('span[role="text"]')?.textContent || '');
      return {
        start,
        end: Number.isFinite(nextStart) && nextStart > start ? nextStart : start + 2.5,
        text
      };
    }).filter(cue => Number.isFinite(cue.start) && cue.text && !isErrorCaptionText(cue.text));
  }

  function findTranscriptTrigger() {
    const panel = document.querySelector('ytd-video-description-transcript-section-renderer');
    return Array.from(panel?.querySelectorAll('button, tp-yt-paper-button') || [])
      .find(button => /内容转文字|显示文字记录|show transcript/i.test(button.textContent || ''));
  }

  function findTranscriptLanguageOption(sourceTrack, sourceLanguage) {
    const normalizedName = getTrackName(sourceTrack).replace(/\s+/g, ' ').trim();
    const languageLabels = {
      en: ['英语', 'English'],
      de: ['德语', 'German', 'Deutsch'],
      fr: ['法语', 'French', 'Francais'],
      es: ['西班牙语', 'Spanish', 'Espanol'],
      ja: ['日语', 'Japanese'],
      ko: ['韩语', 'Korean'],
      pt: ['葡萄牙语', 'Portuguese'],
      it: ['意大利语', 'Italian'],
      ru: ['俄语', 'Russian']
    };
    const labels = [normalizedName, ...(languageLabels[sourceLanguage] || [])].filter(Boolean);
    return Array.from(document.querySelectorAll('ytd-transcript-footer-renderer tp-yt-paper-item[role="option"], ytd-transcript-footer-renderer tp-yt-paper-item'))
      .find(option => {
        const text = option.textContent.replace(/\s+/g, ' ').trim();
        return labels.some(label => text === label || text.startsWith(`${label} (`) || text.includes(label));
      });
  }

  async function selectTranscriptSourceLanguage(sourceTrack, sourceLanguage) {
    if (readTranscriptCuesFromPanel().length) return;
    const option = findTranscriptLanguageOption(sourceTrack, sourceLanguage);
    if (!option) throw new Error('转写文稿中没有找到原始字幕语言，请换一个字幕来源。');
    option.click();
    await sleep(500);
  }

  async function fetchTranscriptCuesFromPanel(sourceTrack, sourceLanguage) {
    if (!readTranscriptCuesFromPanel().length) {
      let trigger = findTranscriptTrigger();
      if (!trigger) {
        document.querySelector('#description-inline-expander #expand')?.click();
        await sleep(250);
        trigger = findTranscriptTrigger();
      }
      if (!trigger) throw new Error('字幕接口受限，且当前视频没有可读取的转写文稿。');
      showStatus('原始字幕读取被 YouTube 暂时限制，正在改用内容转文字...', 120000);
      trigger.click();
      for (let attempt = 0; attempt < 30 && !readTranscriptCuesFromPanel().length; attempt += 1) await sleep(250);
    }
    await selectTranscriptSourceLanguage(sourceTrack, sourceLanguage);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const cues = readTranscriptCuesFromPanel();
      if (cues.length) return cues;
      await sleep(250);
    }
    throw new Error('视频转写文稿读取失败，请稍后重试。');
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
      .filter(cue => cue.text && !isErrorCaptionText(cue.text))
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

  function isErrorCaptionText(text) {
    return /(?:429\s*错误|YouTube\s*(?:限制|limit).*(?:字幕|caption)|当前设备.*(?:机翻|字幕).*(?:请求|限制)|不要使用\s*\[?\s*自动翻译)/i.test(String(text || ''));
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

  function mergeVoiceCues(displayCues) {
    const merged = [];
    let current = null;
    for (const cue of displayCues) {
      const singleLineText = String(cue.text || '').replace(/\n+/g, ' ');
      const text = cleanCaptionText(singleLineText);
      if (!text) continue;
      const normalizedCue = { ...cue, text };
      if (!current) {
        current = normalizedCue;
        continue;
      }
      const gap = normalizedCue.start - current.end;
      const shouldSplit = /[。！？.!?]\s*$/.test(current.text) ||
        gap > VOICE_SENTENCE_MAX_GAP_SECONDS ||
        countTextUnits(current.text) >= VOICE_SENTENCE_MAX_UNITS ||
        countTextUnits(`${current.text}${normalizedCue.text}`) > VOICE_SENTENCE_MAX_UNITS;
      if (shouldSplit) {
        merged.push(current);
        current = normalizedCue;
        continue;
      }
      current.text = cleanCaptionText(`${current.text}${needsSpace(current.text, normalizedCue.text) ? ' ' : ''}${normalizedCue.text}`);
      current.end = Math.max(current.end, normalizedCue.end);
    }
    if (current) merged.push(current);
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

  async function getLocalTranslator(sourceLanguage, createIfMissing = false) {
    const source = normalizeTranslatorLanguage(sourceLanguage);
    const key = `${source}:zh`;
    if (state.localTranslators.has(key)) return state.localTranslators.get(key);
    if (!('Translator' in self)) throw new Error('当前 Chrome 不支持本地翻译，请升级桌面版 Chrome。');
    if (!createIfMissing) throw new Error('请先点击“准备本地翻译”，下载或启用本地翻译模型。');

    const options = { sourceLanguage: source, targetLanguage: 'zh' };
    const availability = await Translator.availability(options);
    if (availability === 'unavailable') throw new Error(`Chrome 暂不支持 ${source} 到中文的本地翻译。`);
    showStatus(availability === 'available' ? '正在启动本地翻译...' : '正在下载本地翻译模型...', 120000);
    const translator = await Translator.create({
      ...options,
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', event => {
          showStatus(`正在下载本地翻译模型：${Math.round(Number(event.loaded || 0) * 100)}%`, 120000);
        });
      }
    });
    state.localTranslators.set(key, translator);
    return translator;
  }

  async function prepareLocalTranslationForCurrentVideo() {
    const videoId = getVideoId();
    const source = await waitForCaptionSource(videoId);
    if (!source) throw new Error('当前视频没有可用的字幕轨道。');
    if (source.translationMode === 'none') {
      showStatus('当前视频已有中文字幕，无需本地翻译。');
      return;
    }
    if (source.translationMode !== 'local') throw new Error('请先将字幕翻译切换为 Chrome 本地翻译。');
    await getLocalTranslator(source.sourceLanguage, true);
    showStatus('本地翻译已准备，正在生成中文字幕...');
    reloadCurrentVideo(true);
  }

  async function translateCuesLocally(rawSourceCues, sourceLanguage) {
    if (!rawSourceCues.length) return [];
    const translator = await getLocalTranslator(sourceLanguage);
    const sourceCues = mergeSentenceCues(rawSourceCues);
    const translated = [];
    for (let index = 0; index < sourceCues.length; index += 1) {
      if (index % 8 === 0) showStatus(`正在本地翻译字幕：${index + 1}/${sourceCues.length}`, 120000);
      const cue = sourceCues[index];
      const text = cleanCaptionText(await translator.translate(cue.text));
      if (text) translated.push(limitLines({ ...cue, text, sourceText: cue.text }));
    }
    return translated;
  }

  async function waitForCaptionSource(videoId, attempts = 20) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const source = selectBestCaptionSource(getPlayerResponse(videoId));
      if (source?.targetTrack?.baseUrl) return source;
      if (attempt === 0) showStatus('字幕轨道仍在加载，正在等待...', 7000);
      await sleep(250);
    }
    return null;
  }

  function getSourceCacheFingerprint(source) {
    const track = source.sourceTrack || source.targetTrack || {};
    const language = source.sourceLanguage || track.languageCode || 'unknown';
    const kind = track.kind || 'manual';
    const trackId = track.vssId || track.vss_id || '';
    return `${source.kind}:${language}:${kind}:${trackId}`;
  }

  function getCacheKey(videoId, source) {
    return `${CACHE_PREFIX}${videoId}:${getSourceCacheFingerprint(source)}:${TARGET_LANG}:v6`;
  }

  function getLegacyTranslatedCacheKey(videoId) {
    return `${CACHE_PREFIX}${videoId}:translated-en:${TARGET_LANG}:v3`;
  }

  function readCachedCues(key) {
    if (memoryCache.has(key)) return memoryCache.get(key);
    try {
      const cached = JSON.parse(localStorage.getItem(key) || 'null');
      if (!cached || Date.now() - cached.savedAt > CACHE_TTL_MS) return null;
      if ((cached.data?.cues || []).some(cue => isErrorCaptionText(cue.text))) {
        localStorage.removeItem(key);
        return null;
      }
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
    const source = await waitForCaptionSource(videoId);
    if (!source?.targetTrack?.baseUrl) throw new Error('没有找到可翻译的字幕轨道。');

    const cacheKey = getCacheKey(videoId, source);
    if (!force) {
      const cached = readCachedCues(cacheKey);
      if (cached) {
        applyCues(videoId, cached, token, '已从缓存加载字幕');
        return;
      }
      if (source.translationMode === 'local') {
        const legacyCached = readCachedCues(getLegacyTranslatedCacheKey(videoId));
        if (legacyCached) {
          applyCues(videoId, legacyCached, token, '已读取旧版中文字幕缓存');
          return;
        }
      }
    }

    if (source.translationMode === 'local') {
      await loadChromeLocalCaptions(videoId, source, token, force);
      return;
    }

    const isYouTubeTranslation = source.translationMode === 'youtube';
    showStatus(isYouTubeTranslation ? '正在读取 YouTube 自动翻译字幕（可能被限流）...' : '正在读取 YouTube 中文字幕...');
    let targetJson;
    try {
      targetJson = await fetchCaptionJsonWithFallback(videoId, source.targetTrack, { translate: isYouTubeTranslation });
    } catch (error) {
      if (isYouTubeTranslation && error.rateLimited) {
        await switchToLocalTranslationAfterYouTubeRateLimit(videoId, source, token, force);
        return;
      }
      throw error;
    }
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

  async function loadChromeLocalCaptions(videoId, source, token, force = false) {
    const cacheKey = getCacheKey(videoId, source);
    if (!force) {
      const cached = readCachedCues(cacheKey);
      if (cached) {
        applyCues(videoId, cached, token, '已从缓存加载本地翻译字幕');
        return;
      }
    }
    await getLocalTranslator(source.sourceLanguage, true);
    showStatus('正在读取原始字幕，准备本地翻译...', 120000);
    let sourceRaw;
    try {
      const sourceJson = await fetchCaptionJsonWithFallback(videoId, source.sourceTrack, { translate: false });
      sourceRaw = normalizeRawCues(sourceJson);
    } catch (error) {
      if (!error.rateLimited) throw error;
      sourceRaw = await fetchTranscriptCuesFromPanel(source.sourceTrack, source.sourceLanguage);
    }
    const translated = await translateCuesLocally(sourceRaw, source.sourceLanguage);
    if (!translated.length) throw new Error('字幕接口返回了空字幕。');
    const data = { cues: translated, rawTargetCues: translated, rawSourceCues: sourceRaw, sourceKind: source.kind };
    writeCachedCues(cacheKey, data);
    applyCues(videoId, data, token, `本地中文字幕已加载：${translated.length} 句`);
  }

  async function switchToLocalTranslationAfterYouTubeRateLimit(videoId, source, token, force) {
    state.settings.translationEngine = 'local';
    saveSettings();
    syncControlValues();
    syncTranslationEngineRows();
    showStatus('YouTube 自动翻译已限流，正在切换到 Chrome 本地翻译...', 120000);
    const localSource = {
      ...source,
      kind: 'chrome-local-zh',
      targetTrack: source.sourceTrack || source.targetTrack,
      sourceTrack: source.sourceTrack || source.targetTrack,
      translationMode: 'local'
    };
    await loadChromeLocalCaptions(videoId, localSource, token, force);
  }

  function applyCues(videoId, data, token, statusText) {
    if (token !== state.loadToken || videoId !== state.videoId) return;
    state.cues = data.cues || [];
    state.voiceCues = mergeVoiceCues(state.cues);
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
    refreshVoiceProgressStatus();
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
    if (state.settings.voiceEnabled && state.remoteAudio?.paused && isRemoteVoiceEngine()) {
      state.remoteAudio.play().catch(() => {});
    } else if (state.settings.voiceEnabled && isRemoteVoiceEngine()) {
      playNextVolcCue();
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
    if (isRemoteVoiceEngine()) {
      const voiceIndex = findVoiceCueIndex(video.currentTime);
      const voiceCue = voiceIndex >= 0 ? state.voiceCues[voiceIndex] : null;
      if (!voiceCue || voiceIndex === state.spokenCueIndex) return;
      state.spokenCueIndex = voiceIndex;
      enqueueVolcCue(voiceCue, voiceIndex);
      return;
    }
    if (index === state.spokenCueIndex) return;
    state.spokenCueIndex = index;
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance !== 'function') {
      showStatus('当前浏览器不支持中文配音');
      updateSetting('voiceEnabled', false);
      return;
    }
    speakCue(cue);
  }

  function findVoiceCueIndex(time) {
    const adjusted = time + (Number(state.settings.offsetMs) || 0) / 1000;
    let low = 0;
    let high = state.voiceCues.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const cue = state.voiceCues[mid];
      if (adjusted < cue.start) high = mid - 1;
      else if (adjusted > cue.end) low = mid + 1;
      else return mid;
    }
    return -1;
  }

  function speakCue(cue) {
    const text = cue.text.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2) return;
    speakText(text, getSpeechRate(text));
  }

  function testSelectedVoice() {
    if (isRemoteVoiceEngine()) {
      speakVolcText('这是一段中文远程语音测试，用来确认当前选择的配音服务商和音色。', true);
      return;
    }
    if (state.settings.voiceName === AUTO_MALE_VOICE && !findMaleChineseVoice()) {
      showStatus('未找到中文男声，请在系统或浏览器中安装中文男声语音。');
      return;
    }
    speakText('这是一段中文语音测试，用来确认当前选择的配音人物。', Number(state.settings.voiceRate));
  }

  async function testVolcCredentials() {
    const text = '这是火山语音连接测试。';
    cancelSpeech();
    const token = state.remoteVoiceToken;
    showStatus('正在测试火山语音连接...', 30000);
    try {
      const url = await requestVolcAudioWithRetry(text);
      if (token !== state.remoteVoiceToken) {
        URL.revokeObjectURL(url);
        return;
      }
      const audio = new Audio(url);
      state.remoteAudio = audio;
      audio.addEventListener('ended', () => {
        URL.revokeObjectURL(url);
        if (token !== state.remoteVoiceToken) return;
        state.remoteAudio = null;
        catchUpVolcNarration();
      }, { once: true });
      audio.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
      await audio.play();
      showStatus('火山凭证正常，语音连接成功', 5000);
    } catch (error) {
      if (token !== state.remoteVoiceToken) return;
      state.remoteAudio = null;
      showStatus(error.message || '火山语音连接测试失败', 7000);
    }
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

  function parseTerminologyMap(value = state.settings.terminologyMap) {
    return String(value || '')
      .split(/\r?\n/)
      .map(line => {
        const separator = line.indexOf('=');
        if (separator < 1) return null;
        const source = line.slice(0, separator).trim();
        const spoken = line.slice(separator + 1).trim();
        return source && spoken ? { source, spoken } : null;
      })
      .filter(Boolean)
      .sort((left, right) => right.source.length - left.source.length);
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function applyVoiceTerminology(text) {
    let result = String(text || '');
    for (const entry of parseTerminologyMap()) {
      const flags = /[A-Za-z]/.test(entry.source) ? 'gi' : 'g';
      result = result.replace(new RegExp(escapeRegExp(entry.source), flags), entry.spoken);
    }
    return result;
  }

  function getVolcAudioCacheKey(text) {
    return getRemoteAudioCacheKey(text);
  }

  function getRemoteAudioCacheKey(text) {
    if (state.settings.voiceEngine === 'tencent') {
      return `tencent|${state.settings.tencentProxyUrl}|${state.settings.tencentVoiceType}|${state.settings.tencentSampleRate}|${state.settings.voiceRate}|${text}`;
    }
    if (state.settings.voiceEngine === 'tencentDirect') {
      return `tencentDirect|${state.settings.tencentRegion}|${state.settings.tencentVoiceType}|${state.settings.tencentSampleRate}|${state.settings.voiceRate}|${text}`;
    }
    return `volc|${state.settings.volcVoice}|${state.settings.voiceRate}|${text}`;
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
            reject(makeVolcRequestError(`火山语音请求失败：HTTP ${response.status}`, response.status >= 500 && response.status <= 599));
            return;
          }
          try {
            resolve(parseVolcAudioStream(response.responseText || response.response || ''));
          } catch (error) {
            reject(error);
          }
        },
        ontimeout: () => reject(makeVolcRequestError('火山语音请求超时', true)),
        onerror: () => reject(makeVolcRequestError('火山语音网络请求失败', true))
      });
    });
  }

  function makeVolcRequestError(message, retryable = false) {
    const error = new Error(message);
    error.volcRetryable = retryable;
    return error;
  }

  function isRetryableVolcError(error) {
    return Boolean(error?.volcRetryable);
  }

  async function requestVolcAudioWithRetry(text, reportStatus = true) {
    try {
      return await requestVolcAudio(text);
    } catch (error) {
      if (!isRetryableVolcError(error)) throw error;
      if (reportStatus) updateVoiceProgressStatus('语音请求失败，正在重试...', 1800);
      return requestVolcAudio(text);
    }
  }

  function requestTencentProxyAudio(text) {
    const proxyUrl = String(state.settings.tencentProxyUrl || '').trim();
    if (!proxyUrl) return Promise.reject(new Error('请填写腾讯 TextToVoice 代理地址'));
    if (typeof GM_xmlhttpRequest !== 'function') return Promise.reject(new Error('当前脚本未获得跨域请求权限'));
    const payload = {
      action: 'TextToVoice',
      text,
      voiceType: Number(state.settings.tencentVoiceType) || state.settings.tencentVoiceType || 1001,
      sampleRate: Number(state.settings.tencentSampleRate) || 16000,
      codec: 'mp3',
      speed: tencentSpeedFromRate(Number(state.settings.voiceRate))
    };
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: proxyUrl,
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify(payload),
        responseType: 'arraybuffer',
        timeout: 30000,
        onload: response => {
          if (response.status < 200 || response.status >= 300) {
            reject(makeVolcRequestError(`腾讯语音代理请求失败：HTTP ${response.status}`, response.status >= 500 && response.status <= 599));
            return;
          }
          const buffer = response.response;
          if (!buffer || !buffer.byteLength) {
            reject(new Error('腾讯语音代理未返回可播放音频'));
            return;
          }
          resolve(URL.createObjectURL(new Blob([buffer], { type: 'audio/mpeg' })));
        },
        ontimeout: () => reject(makeVolcRequestError('腾讯语音代理请求超时', true)),
        onerror: () => reject(makeVolcRequestError('腾讯语音代理网络请求失败', true))
      });
    });
  }

  async function requestTencentDirectAudio(text) {
    const credentials = getTencentCredentials();
    if (!credentials.secretId || !credentials.secretKey) return Promise.reject(new Error('请填写并保存腾讯 SecretId 与 SecretKey'));
    if (typeof GM_xmlhttpRequest !== 'function') return Promise.reject(new Error('当前脚本未获得跨域请求权限'));
    const region = String(state.settings.tencentRegion || 'ap-beijing').trim() || 'ap-beijing';
    const payload = {
      Text: text,
      SessionId: makeRequestId(),
      Volume: 0,
      Speed: tencentSpeedFromRate(Number(state.settings.voiceRate)),
      ProjectId: 0,
      ModelType: 1,
      VoiceType: Number(state.settings.tencentVoiceType) || 101030,
      PrimaryLanguage: 1,
      SampleRate: Number(state.settings.tencentSampleRate) || 16000,
      Codec: 'mp3',
      EnableSubtitle: false
    };
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const authorization = await createTencentAuthorization({
      secretId: credentials.secretId,
      secretKey: credentials.secretKey,
      timestamp,
      payload: body
    });
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: TENCENT_TTS_URL,
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json; charset=utf-8',
          Host: TENCENT_TTS_HOST,
          'X-TC-Action': 'TextToVoice',
          'X-TC-Version': TENCENT_TTS_VERSION,
          'X-TC-Region': region,
          'X-TC-Timestamp': String(timestamp)
        },
        data: body,
        responseType: 'text',
        timeout: 30000,
        onload: response => {
          if (response.status < 200 || response.status >= 300) {
            reject(makeVolcRequestError(`腾讯语音直连请求失败：HTTP ${response.status}`, response.status >= 500 && response.status <= 599));
            return;
          }
          try {
            resolve(parseTencentTextToVoiceResponse(response.responseText || response.response || ''));
          } catch (error) {
            reject(error);
          }
        },
        ontimeout: () => reject(makeVolcRequestError('腾讯语音直连请求超时', true)),
        onerror: () => reject(makeVolcRequestError('腾讯语音直连网络请求失败', true))
      });
    });
  }

  async function createTencentAuthorization({ secretId, secretKey, timestamp, payload }) {
    const algorithm = 'TC3-HMAC-SHA256';
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const hashedPayload = await sha256Hex(payload);
    const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${TENCENT_TTS_HOST}\nx-tc-action:texttovoice\n`;
    const signedHeaders = 'content-type;host;x-tc-action';
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;
    const credentialScope = `${date}/${TENCENT_TTS_SERVICE}/tc3_request`;
    const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;
    const secretDate = await hmacSha256Bytes(utf8Bytes(`TC3${secretKey}`), date);
    const secretService = await hmacSha256Bytes(secretDate, TENCENT_TTS_SERVICE);
    const secretSigning = await hmacSha256Bytes(secretService, 'tc3_request');
    const signature = bytesToHex(await hmacSha256Bytes(secretSigning, stringToSign));
    return `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }

  function parseTencentTextToVoiceResponse(raw) {
    const data = JSON.parse(raw || '{}');
    const response = data.Response || {};
    if (response.Error) {
      throw new Error(`腾讯语音合成失败：${response.Error.Message || response.Error.Code || '未知错误'}`);
    }
    const audio = response.Audio;
    if (!audio) throw new Error('腾讯语音未返回可播放音频');
    return URL.createObjectURL(new Blob([base64ToBytes(audio)], { type: 'audio/mpeg' }));
  }

  function utf8Bytes(value) {
    return new TextEncoder().encode(String(value));
  }

  async function sha256Hex(value) {
    const digest = await crypto.subtle.digest('SHA-256', utf8Bytes(value));
    return bytesToHex(new Uint8Array(digest));
  }

  async function hmacSha256Bytes(key, value) {
    const cryptoKey = await crypto.subtle.importKey('raw', key instanceof Uint8Array ? key : utf8Bytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, utf8Bytes(value));
    return new Uint8Array(signature);
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function tencentSpeedFromRate(rate) {
    const normalized = clamp(Number(rate), 0.6, 2.5);
    if (normalized <= 0.6) return -2;
    if (normalized <= 0.8) return -1;
    if (normalized <= 1) return 0;
    if (normalized <= 1.2) return 1;
    if (normalized <= 1.5) return 2;
    return Math.min(6, Number(((normalized - 1.5) / 0.25 + 2).toFixed(2)));
  }

  async function requestRemoteAudioWithRetry(text, reportStatus = true) {
    try {
      return await requestRemoteAudio(text);
    } catch (error) {
      if (!isRetryableVolcError(error)) throw error;
      if (reportStatus) updateVoiceProgressStatus('语音请求失败，正在重试...', 1800);
      return requestRemoteAudio(text);
    }
  }

  function requestRemoteAudio(text) {
    if (state.settings.voiceEngine === 'tencent') return requestTencentProxyAudio(text);
    if (state.settings.voiceEngine === 'tencentDirect') return requestTencentDirectAudio(text);
    return requestVolcAudio(text);
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

  function getRemoteAudioUrl(text, reportStatus = true) {
    const key = getRemoteAudioCacheKey(text);
    if (volcAudioCache.has(key)) return Promise.resolve(volcAudioCache.get(key));
    if (volcPendingCache.has(key)) return volcPendingCache.get(key);
    const pending = requestRemoteAudioWithRetry(text, reportStatus).then(url => {
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

  function getVolcAudioUrl(text, reportStatus = true) {
    return getRemoteAudioUrl(text, reportStatus);
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
      if (showPlayingStatus) showStatus(`正在播放${getRemoteVoiceProviderLabel()}测试`);
      audio.addEventListener('ended', () => {
        if (token !== state.remoteVoiceToken) return;
        state.remoteAudio = null;
        playNextVolcCue();
      }, { once: true });
      audio.addEventListener('error', () => {
        if (token !== state.remoteVoiceToken) return;
        state.remoteAudio = null;
        playNextVolcCue();
      }, { once: true });
      await audio.play();
    } catch (error) {
      if (token === state.remoteVoiceToken) state.remoteAudio = null;
      showStatus(error.message || `${getRemoteVoiceProviderLabel()}播放失败`, 5000);
    }
  }

  function getRemoteVoiceProviderLabel() {
    if (state.settings.voiceEngine === 'tencent' || state.settings.voiceEngine === 'tencentDirect') return '腾讯 TextToVoice 语音';
    return '火山自然语音';
  }

  function speakVolcCue(cue, index) {
    const text = applyVoiceTerminology(cue.text).replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2) return;
    speakVolcText(text);
    prefetchVolcCues(index + 1, 2);
  }

  function enqueueVolcCue(cue, index) {
    const text = applyVoiceTerminology(cue.text).replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 2) return;
    state.remoteVoiceQueue.push({ text, index, start: cue.start, end: cue.end });
    refreshVoiceProgressStatus();
    prefetchVolcCues(index + 1, 4);
    playNextVolcCue();
  }

  function shouldSkipQueuedVolcCue(item, video) {
    if (state.settings.voiceSyncMode !== 'sync') return false;
    return Boolean(video && video.currentTime - Number(item.end || 0) > VOICE_MAX_LAG_SECONDS);
  }

  function getVolcPlaybackRate(item, video) {
    if (state.settings.voiceSyncMode !== 'smart' || !item || !video) return 1;
    const lag = Math.max(0, video.currentTime - Number(item.start || 0));
    if (lag <= VOICE_SMART_LAG_THRESHOLD_SECONDS) return 1;
    if (lag <= 2.5) return 1.06;
    if (lag <= 5) return 1.12;
    return VOICE_SMART_MAX_PLAYBACK_RATE;
  }

  function recoverVolcQueueAfterError(audio, token) {
    if (token !== state.remoteVoiceToken || state.remoteAudio !== audio) return;
    audio.pause();
    state.remoteAudio = null;
    state.remoteVoiceCurrent = null;
    state.remoteVoiceStarting = false;
    updateVoiceProgressStatus('播放异常，继续配音', 2500);
    playNextVolcCue();
  }

  async function playNextVolcCue() {
    const video = getVideoEl();
    if (!state.settings.voiceEnabled || !isRemoteVoiceEngine() || !video || video.paused) return;
    if (state.remoteAudio || state.remoteVoiceStarting) return;
    let item = null;
    while (state.remoteVoiceQueue.length && !item) {
      const queued = state.remoteVoiceQueue.shift();
      if (!shouldSkipQueuedVolcCue(queued, video)) item = queued;
    }
    if (!item) {
      refreshVoiceProgressStatus();
      return;
    }

    const token = state.remoteVoiceToken;
    state.remoteVoiceStarting = true;
    refreshVoiceProgressStatus();
    let audio = null;
    try {
      const url = await getVolcAudioUrl(item.text);
      if (token !== state.remoteVoiceToken) return;
      if (shouldSkipQueuedVolcCue(item, video)) {
        state.remoteVoiceStarting = false;
        playNextVolcCue();
        return;
      }
      audio = new Audio(url);
      audio.playbackRate = getVolcPlaybackRate(item, video);
      audio.preservesPitch = true;
      state.remoteAudio = audio;
      state.remoteVoiceCurrent = item;
      if (audio.playbackRate > 1) updateVoiceProgressStatus(`智能追赶 ${audio.playbackRate.toFixed(2)}x`, 1800);
      refreshVoiceProgressStatus();
      audio.addEventListener('ended', () => {
        if (token !== state.remoteVoiceToken) return;
        state.remoteAudio = null;
        state.remoteVoiceCurrent = null;
        refreshVoiceProgressStatus();
        playNextVolcCue();
      }, { once: true });
      audio.addEventListener('error', () => recoverVolcQueueAfterError(audio, token), { once: true });
      if (!video.paused) await audio.play();
    } catch (error) {
      if (token === state.remoteVoiceToken) {
        if (audio) {
          recoverVolcQueueAfterError(audio, token);
          return;
        }
        state.remoteAudio = null;
        state.remoteVoiceCurrent = null;
        state.remoteVoiceStarting = false;
        updateVoiceProgressStatus('本句跳过，继续配音', 2500);
        showStatus(error.message || '火山语音播放失败', 5000);
        playNextVolcCue();
      }
    } finally {
      if (token === state.remoteVoiceToken) state.remoteVoiceStarting = false;
    }
  }

  function prefetchVolcCues(startIndex, count) {
    let hasCredentials = false;
    if (state.settings.voiceEngine === 'tencent') {
      hasCredentials = Boolean(String(state.settings.tencentProxyUrl || '').trim());
    } else if (state.settings.voiceEngine === 'tencentDirect') {
      hasCredentials = Object.values(getTencentCredentials()).every(Boolean);
    } else if (state.settings.volcAuthMode === 'legacy') {
      hasCredentials = Object.values(getVolcLegacyCredentials()).every(Boolean);
    } else {
      hasCredentials = Boolean(getVolcApiKey());
    }
    if (!isRemoteVoiceEngine() || !hasCredentials) return;
    for (const cue of state.voiceCues.slice(startIndex, startIndex + count)) {
      const text = applyVoiceTerminology(cue.text).replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
      if (text.length >= 2) getVolcAudioUrl(text, false).catch(() => {});
    }
  }

  function updateVoiceProgressStatus(text, duration = 0) {
    state.voiceProgressNotice = text || '';
    state.voiceProgressNoticeUntil = duration ? Date.now() + duration : 0;
    refreshVoiceProgressStatus();
  }

  function refreshVoiceProgressStatus() {
    const label = document.querySelector(`#${CONTROL_ID} [data-role="voiceProgressStatus"]`);
    if (!label) return;
    if (state.voiceProgressNotice && Date.now() < state.voiceProgressNoticeUntil) {
      label.textContent = state.voiceProgressNotice;
      return;
    }
    state.voiceProgressNotice = '';
    state.voiceProgressNoticeUntil = 0;
    if (!state.settings.voiceEnabled || !isRemoteVoiceEngine()) {
      label.textContent = '同步正常';
      return;
    }
    if (state.remoteVoiceStarting) {
      label.textContent = '等待配音';
      return;
    }
    const video = getVideoEl();
    const firstWaiting = state.remoteVoiceQueue[0] || state.remoteVoiceCurrent;
    const lag = firstWaiting && video ? Math.max(0, video.currentTime - Number(firstWaiting.start || 0)) : 0;
    if (lag >= 0.1) {
      label.textContent = `落后 ${lag.toFixed(1)} 秒`;
    } else if (state.remoteVoiceQueue.length) {
      label.textContent = `排队 ${state.remoteVoiceQueue.length} 句`;
    } else {
      label.textContent = '同步正常';
    }
  }

  function catchUpVolcNarration() {
    cancelSpeech();
    state.spokenCueIndex = -1;
    updateVoiceProgressStatus('已追上当前字幕', 1500);
    renderCurrentCue();
  }

  function cancelSpeech() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    state.remoteVoiceToken += 1;
    state.remoteVoiceStarting = false;
    state.remoteVoiceQueue.length = 0;
    state.remoteVoiceCurrent = null;
    if (state.remoteAudio) {
      state.remoteAudio.pause();
      state.remoteAudio.currentTime = 0;
      state.remoteAudio = null;
    }
    refreshVoiceProgressStatus();
  }

  function reloadCurrentVideo(force = false) {
    const videoId = getVideoId();
    if (!videoId) return;
    state.videoId = videoId;
    state.cues = [];
    state.voiceCues = [];
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
