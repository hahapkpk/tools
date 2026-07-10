const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const api = require('../jd-taobao-review-media-waterfall.user.js');
const source = fs.readFileSync(require.resolve('../jd-taobao-review-media-waterfall.user.js'), 'utf8');

test('识别京东和淘宝天猫商品详情页', () => {
  assert.equal(api.detectSite('https://item.jd.com/100117729409.html'), 'jd');
  assert.equal(api.detectSite('https://detail.tmall.com/item.htm?id=942720563609'), 'taobao');
  assert.equal(api.detectSite('https://item.taobao.com/item.htm?id=942720563609'), 'taobao');
  assert.equal(api.detectSite('https://www.jd.com/'), null);
});

test('媒体条目按原图地址去重且保留首次评价上下文', () => {
  const store = api.createMediaStore();
  store.replace([
    { type: 'image', src: 'a.jpg', text: '第一条' },
    { type: 'image', src: 'a.jpg', text: '重复' },
    { type: 'video', src: 'b.mp4', text: '视频' }
  ]);
  assert.deepEqual(store.items().map(item => item.text), ['第一条', '视频']);
});

test('媒体去重会归一化京东和淘宝同图不同尺寸地址', () => {
  const store = api.createMediaStore();
  store.replace([
    {
      type: 'image',
      src: 'https://img30.360buyimg.com/shaidan/s1080x1080_jfs/t1/431531/36/16798/2026145/6a0a67a8F2ae0d4cc/00a9000c0026c2f7.jpg.dpg',
      text: '京东大图'
    },
    {
      type: 'image',
      src: 'https://img30.360buyimg.com/shaidan/s300x300_jfs/t1/431531/36/16798/2026145/6a0a67a8F2ae0d4cc/00a9000c0026c2f7.jpg.dpg',
      text: '京东小图'
    },
    {
      type: 'image',
      src: 'https://gw.alicdn.com/imgextra/i1/123/O1CN01abc.jpg_400x400q90.jpg',
      text: '淘宝缩略图'
    },
    {
      type: 'image',
      src: 'https://gw.alicdn.com/imgextra/i1/123/O1CN01abc.jpg?x-oss-process=image/resize,w_800',
      text: '淘宝原图'
    },
    {
      type: 'image',
      src: 'https://gw.alicdn.com/bao/uploaded/i1/O1CN01crossHost.jpg',
      text: '天猫 gw 图'
    },
    {
      type: 'image',
      src: 'https://img.alicdn.com/imgextra/i1/4611686018427380848/O1CN01crossHost.jpg',
      text: '天猫 img 图'
    }
  ]);
  assert.deepEqual(store.items().map(item => item.text), ['京东大图', '淘宝缩略图', '天猫 gw 图']);
});

test('媒体归一化去重时保留首次评价文字并升级到更高清图片', () => {
  const store = api.createMediaStore();
  store.replace([
    {
      type: 'image',
      src: 'https://img30.360buyimg.com/shaidan/s300x300_jfs/t1/431531/36/16798/2026145/6a0a67a8F2ae0d4cc/00a9000c0026c2f7.jpg.dpg',
      text: '首次评论'
    },
    {
      type: 'image',
      src: 'https://img30.360buyimg.com/shaidan/s1080x1080_jfs/t1/431531/36/16798/2026145/6a0a67a8F2ae0d4cc/00a9000c0026c2f7.jpg.dpg',
      text: '重复评论'
    }
  ]);
  assert.equal(store.items().length, 1);
  assert.equal(store.items()[0].text, '首次评论');
  assert.match(store.items()[0].src, /s1080x1080_jfs/);
});

test('淘宝 adapter 仅抽取评价相册媒体并附评价文字', () => {
  const comment = {
    innerText: '匿名买家 2026年5月15日 已购：粉蓝款 实物很漂亮',
    querySelectorAll(selector) {
      if (selector.includes('album')) {
        return [{ currentSrc: 'https://gw.alicdn.com/rate-a.jpg', src: '' }];
      }
      return [];
    }
  };
  const root = {
    querySelectorAll(selector) {
      return selector.includes('Comment') ? [comment] : [];
    }
  };

  assert.deepEqual(api.adapters.taobao.collectMedia(root), [{
    type: 'image',
    src: 'https://gw.alicdn.com/rate-a.jpg',
    poster: '',
    text: '匿名买家 2026年5月15日 已购：粉蓝款 实物很漂亮',
    meta: ''
  }]);
});

test('淘宝 adapter 从已渲染卡片状态提取真实原图而非占位图', () => {
  const comment = {
    innerText: '占位评论',
    querySelectorAll: () => [{ src: 'https://img.alicdn.com/placeholder.png' }],
    __reactFiber$test: {
      return: {
        return: {
          memoizedProps: {
            comment: {
              skuText: '粉蓝款',
              reviewInfo: {
                date: '2026年5月15日',
                content: '实物很漂亮',
                picList: ['//img.alicdn.com/imgextra/real-rate.jpg'],
                videoList: []
              }
            }
          }
        }
      }
    }
  };
  const root = {
    querySelectorAll(selector) {
      return selector.includes('Comment') ? [comment] : [];
    }
  };
  assert.deepEqual(api.adapters.taobao.collectMedia(root), [{
    type: 'image',
    src: 'https://img.alicdn.com/imgextra/real-rate.jpg',
    poster: '',
    text: '实物很漂亮',
    meta: '2026年5月15日 粉蓝款'
  }]);
});

test('淘宝图集模式从 React reviews 提取真实图片而非占位缩略图', () => {
  const item = {
    __reactFiber$gallery: {
      return: {
        return: {
          memoizedProps: {
            reviews: [{
              skuText: { 颜色分类: '粉蓝款' },
              reviewInfo: {
                date: '2026年5月15日',
                content: '实物漂亮',
                picList: ['//img.alicdn.com/imgextra/gallery-real.jpg'],
                videoList: []
              }
            }]
          }
        }
      }
    }
  };
  const root = {
    querySelectorAll(selector) {
      if (selector.includes('commentsImgItem')) return [item];
      return [];
    }
  };
  assert.deepEqual(api.adapters.taobao.collectMedia(root), [{
    type: 'image',
    src: 'https://img.alicdn.com/imgextra/gallery-real.jpg',
    poster: '',
    text: '实物漂亮',
    meta: '2026年5月15日 粉蓝款'
  }]);
});

test('淘宝图集模式会跳过未挂载 reviews 的首个节点继续查找后续节点', () => {
  const emptyItem = {};
  const item = {
    __reactFiber$gallery: {
      return: {
        memoizedProps: {
          reviews: [{
            skuText: '黑色',
            reviewInfo: {
              date: '2026年6月16日',
              content: '后续节点有真实图集',
              picList: ['//img.alicdn.com/imgextra/gallery-second-real.jpg'],
              videoList: []
            }
          }]
        }
      }
    }
  };
  const root = {
    querySelectorAll(selector) {
      if (selector.includes('commentsImgItem')) return [emptyItem, item];
      return [];
    }
  };
  assert.deepEqual(api.adapters.taobao.collectMedia(root), [{
    type: 'image',
    src: 'https://img.alicdn.com/imgextra/gallery-second-real.jpg',
    poster: '',
    text: '后续节点有真实图集',
    meta: '2026年6月16日 黑色'
  }]);
});

test('淘宝视频跳过 null 地址并使用可播放的源视频地址', () => {
  const item = {
    __reactFiber$gallery: {
      return: {
        return: {
          memoizedProps: {
            reviews: [{
              skuText: '透明款',
              reviewInfo: {
                date: '2026年6月1日',
                content: '视频能看清楚',
                picList: [],
                videoList: [{
                  url: '//gw.alicdn.com/bao/uploaded/null',
                  sourceVideoUrl: '//pingjia.alicdn.com/aus/wantu_pingjia/123/review-video.mp4',
                  coverUrl: '//img.alicdn.com/imgextra/i1/video-cover.jpg'
                }]
              }
            }]
          }
        }
      }
    }
  };
  const root = {
    querySelectorAll(selector) {
      if (selector.includes('commentsImgItem')) return [item];
      return [];
    }
  };
  assert.deepEqual(api.adapters.taobao.collectMedia(root), [{
    type: 'video',
    src: 'https://pingjia.alicdn.com/aus/wantu_pingjia/123/review-video.mp4',
    poster: 'https://img.alicdn.com/imgextra/i1/video-cover.jpg',
    text: '视频能看清楚',
    meta: '2026年6月1日 透明款'
  }]);
});

test('京东 adapter 在尚未渲染晒单媒体时返回空数组', () => {
  const root = { querySelectorAll: () => [] };
  assert.deepEqual(api.adapters.jd.collectMedia(root), []);
});

test('京东原生响应中的 pictureInfoList 转换为真实大图媒体', () => {
  const payload = {
    result: {
      data: [{
        commentInfo: {
          commentData: '背起来舒服',
          productSpecifications: '已购 黑色',
          newCommentDate: '2026-05-20 20:56:20',
          pictureInfoList: [{
            picURL: 'https://img30.360buyimg.com/shaidan/s300x300_photo.jpg',
            largePicURL: 'https://img30.360buyimg.com/shaidan/s1080x1080_photo.jpg',
            mediaType: '1'
          }]
        }
      }]
    }
  };
  assert.deepEqual(api.collectJdPayloadMedia(payload), [{
    type: 'image',
    src: 'https://img30.360buyimg.com/shaidan/s1080x1080_photo.jpg',
    poster: 'https://img30.360buyimg.com/shaidan/s300x300_photo.jpg',
    text: '背起来舒服',
    meta: '2026-05-20 20:56:20 已购 黑色'
  }]);
});

test('京东原生 XHR 响应会把评价媒体送入图片墙监听器', () => {
  class FakeXHR {
    open(method, url) {
      this.url = url;
    }
    addEventListener(name, listener) {
      if (name === 'load') this.onLoad = listener;
    }
    send() {
      this.responseText = JSON.stringify({
        commentInfo: {
          pictureInfoList: [{ largePicURL: 'https://img30.360buyimg.com/shaidan/real.jpg' }]
        }
      });
      this.onLoad();
    }
  }
  const received = [];
  const host = { XMLHttpRequest: FakeXHR };
  const stop = api.installJdResponseCapture(host, (items) => received.push(...items));
  const request = new host.XMLHttpRequest();
  request.open('POST', 'https://api.m.jd.com/client.action');
  request.send();
  stop();
  assert.equal(received[0].src, 'https://img30.360buyimg.com/shaidan/real.jpg');
});

test('京东继续加载会保留 URLSearchParams 形式的首个评论请求体', async () => {
  const firstBody = new URLSearchParams({
    body: JSON.stringify({ page: '0', pageSize: 10 })
  });
  const requests = [];
  const host = {
    fetch(url, options) {
      requests.push({ url, options });
      return Promise.resolve({
        ok: true,
        clone() {
          return { json: () => Promise.resolve({ result: { pageInfo: { data: { pageIndex: 0, hasNextPage: true } } } }) };
        }
      });
    }
  };
  const stop = api.installJdResponseCapture(host, () => {});
  await host.fetch('https://api.m.jd.com/client.action', { method: 'POST', body: firstBody });
  await host.__reviewMediaWallJdResponseCapture.requestNextPage();
  stop();

  assert.equal(requests.length, 2);
  const nextPayload = JSON.parse(new URLSearchParams(requests[1].options.body).get('body'));
  assert.equal(nextPayload.page, '1');
});

test('京东继续加载支持 body 位于 GET 查询参数且递增 offset', async () => {
  const firstPayload = { requestSource: 'pc', sku: '100083876773', offset: '1', num: '10', type: '4', isCurrentSku: true };
  const firstUrl = `https://api.m.jd.com/client.action?appid=pc-rate-qa&body=${encodeURIComponent(JSON.stringify(firstPayload))}&functionId=getFoldCommentList`;
  const requests = [];
  const host = {
    fetch(url, options) {
      requests.push({ url: String(url), options });
      return Promise.resolve({
        ok: true,
        clone() {
          return { json: () => Promise.resolve({ result: { pageInfo: { data: { pageIndex: 1, hasNextPage: true, maxPage: 8 } } } }) };
        }
      });
    }
  };
  const stop = api.installJdResponseCapture(host, () => {});
  await host.fetch(firstUrl);
  host.__reviewMediaWallJdResponseCapture.pageInfo = { pageIndex: 1, hasNextPage: true, maxPage: 8 };
  await host.__reviewMediaWallJdResponseCapture.requestNextPage();
  stop();

  assert.equal(requests.length, 2);
  const nextUrl = new URL(requests[1].url);
  const nextPayload = JSON.parse(nextUrl.searchParams.get('body'));
  assert.equal(nextPayload.offset, '2');
  assert.equal(requests[1].options.method, 'GET');
});

test('继续加载时优先驱动原生评价列表内部的滚动容器', () => {
  const child = { clientHeight: 200, scrollHeight: 600, parentElement: null };
  const root = {
    clientHeight: 800,
    scrollHeight: 800,
    parentElement: null,
    querySelectorAll() {
      return [child];
    }
  };
  assert.equal(api.findScrollable(root), child);
});

test('预览打开时点击外层只退回图片墙，再次点击才关闭图片墙', () => {
  const state = api.createWallState();
  state.openWall();
  state.openPreview([{ src: 'a.jpg' }], 0);
  state.onBackdrop();
  assert.equal(state.snapshot().wallOpen, true);
  assert.equal(state.snapshot().preview, null);
  state.onBackdrop();
  assert.equal(state.snapshot().wallOpen, false);
});

test('预览可以有边界地切换上一张和下一张', () => {
  const items = [{ src: 'a.jpg' }, { src: 'b.jpg' }, { src: 'c.jpg' }];
  const state = api.createWallState();
  state.openWall();
  state.openPreview(items, 1);
  assert.equal(state.snapshot().preview.src, 'b.jpg');
  assert.equal(state.snapshot().canPrevious, true);
  assert.equal(state.snapshot().canNext, true);
  state.shiftPreview(-1);
  state.shiftPreview(-1);
  assert.equal(state.snapshot().preview.src, 'a.jpg');
  assert.equal(state.snapshot().canPrevious, false);
  state.shiftPreview(1);
  state.shiftPreview(1);
  state.shiftPreview(1);
  assert.equal(state.snapshot().preview.src, 'c.jpg');
  assert.equal(state.snapshot().canNext, false);
});

test('会话状态仅在当前脚本实例内恢复筛选尺寸与浏览位置', () => {
  const session = api.createWallSession();
  session.setFilter('video');
  session.setCardSize('large');
  session.rememberView({ scrollTop: 420, previewKey: 'b.mp4' });
  assert.deepEqual(session.snapshot(), {
    mediaFilter: 'video',
    cardSize: 'large',
    scrollTop: 420,
    previewKey: 'b.mp4',
    contextCollapsed: false,
    contextWidth: 420,
    loadingState: 'idle',
    stagnantLoads: 0
  });
});

test('图片墙缩略图尺寸会写入本地存储并在下次会话恢复', () => {
  const saved = new Map();
  const storage = {
    getItem(key) {
      return saved.get(key) || null;
    },
    setItem(key, value) {
      saved.set(key, value);
    }
  };
  const session = api.createWallSession(storage);
  session.setCardSize('small');
  assert.equal(api.createWallSession(storage).snapshot().cardSize, 'small');
});

test('京东和淘宝分别记忆预览文字区域宽度', () => {
  const saved = new Map();
  const storage = {
    getItem(key) {
      return saved.get(key) || null;
    },
    setItem(key, value) {
      saved.set(key, String(value));
    }
  };
  const jd = api.createWallSession(storage, 'jd');
  const taobao = api.createWallSession(storage, 'taobao');
  jd.setContextWidth(360);
  taobao.setContextWidth(520);
  assert.equal(api.createWallSession(storage, 'jd').snapshot().contextWidth, 360);
  assert.equal(api.createWallSession(storage, 'taobao').snapshot().contextWidth, 520);
});

test('预览文字区域宽度限制在合理范围且支持恢复默认值', () => {
  const session = api.createWallSession(undefined, 'jd');
  session.setContextWidth(100);
  assert.equal(session.snapshot().contextWidth, 320);
  session.setContextWidth(900);
  assert.equal(session.snapshot().contextWidth, 700);
  session.resetContextWidth();
  assert.equal(session.snapshot().contextWidth, 420);
});

test('类型筛选决定预览计数和切换集合', () => {
  const items = [{ type: 'image', src: 'a.jpg' }, { type: 'video', src: 'b.mp4' }];
  assert.deepEqual(api.filterMedia(items, 'video').map(item => item.src), ['b.mp4']);
  const state = api.createWallState();
  state.openWall();
  state.openPreview(api.filterMedia(items, 'video'), 0);
  assert.equal(state.snapshot().previewTotal, 1);
  assert.equal(state.snapshot().previewPosition, 1);
});

test('重复初始化仅生成一个图片墙入口且显示新名称', () => {
  const children = [];
  const mount = {
    ownerDocument: {
      createElement() {
        return {
          id: '',
          className: '',
          textContent: '',
          dataset: {},
          listeners: {},
          addEventListener(name, fn) { this.listeners[name] = fn; },
          replaceWith(node) {
            const index = children.indexOf(this);
            if (index >= 0) children.splice(index, 1, node);
          }
        };
      }
    },
    appendChild(child) {
      children.push(child);
    },
    querySelector(selector) {
      return selector === '#review-media-wall-launcher'
        ? children.find(child => child.id === 'review-media-wall-launcher') || null
        : null;
    }
  };

  api.ensureLauncher(mount, () => {});
  api.ensureLauncher(mount, () => {});
  assert.equal(children.filter(child => child.id === 'review-media-wall-launcher').length, 1);
  assert.equal(children[0].textContent, '图片墙');
});

test('热更新时会替换旧版本图片墙入口以移除旧监听器', () => {
  const children = [];
  const mount = {
    ownerDocument: {
      createElement() {
        return {
          id: '',
          className: '',
          textContent: '',
          dataset: {},
          listeners: {},
          addEventListener(name, fn) { this.listeners[name] = fn; },
          replaceWith(node) {
            const index = children.indexOf(this);
            if (index >= 0) children.splice(index, 1, node);
          }
        };
      }
    },
    appendChild(child) {
      children.push(child);
    },
    querySelector(selector) {
      return selector === '#review-media-wall-launcher'
        ? children.find(child => child.id === 'review-media-wall-launcher') || null
        : null;
    }
  };
  let oldClicks = 0;
  let newClicks = 0;
  const old = api.ensureLauncher(mount, () => { oldClicks += 1; });
  old.dataset.rmwVersion = '0.5.1';
  const fresh = api.ensureLauncher(mount, () => { newClicks += 1; });
  assert.notEqual(fresh, old);
  fresh.listeners.click();
  assert.equal(oldClicks, 0);
  assert.equal(newClicks, 1);
});

test('图片墙采用规则方形图集并仅在内容区纵向滚动', () => {
  assert.match(source, /#\$\{IDS\.grid\}\s*\{[^}]*display:grid;[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\);[^}]*overflow-y:auto;[^}]*overflow-anchor:none;/s);
  assert.match(source, /\.rmw-card\s*\{[^}]*height:var\(--rmw-card-size, 180px\);[^}]*contain:paint;/s);
  assert.match(source, /\.rmw-card img,\s*\.rmw-card video\s*\{[^}]*position:absolute;[^}]*inset:0;[^}]*height:100%;[^}]*object-fit:cover;/s);
  assert.doesNotMatch(source, /aspect-ratio:1 \/ 1/);
  assert.doesNotMatch(source, /column-count:/);
});

test('图片墙每次按网格列宽设置统一卡片高度避免京东行高塌陷', () => {
  assert.match(source, /grid\.style\.setProperty\('--rmw-card-size', `\$\{cardHeight\}px`\)/);
  assert.match(source, /const columnTracks = template && template !== 'none'/);
  assert.match(source, /const paddingX = \(Number\.parseFloat\(style\?\.paddingLeft/);
  assert.match(source, /if \(items\.length && !windowInfo\.virtualized\) getGridMetrics\(grid\)/);
  assert.doesNotMatch(source, /function sizeGridCards/);
  assert.doesNotMatch(source, /getBoundingClientRect\(\)\.width[\s\S]{0,120}card\.style\.height/);
  assert.doesNotMatch(source, /ResizeObserver[\s\S]{0,160}sizeGridCards/);
});

test('图片墙大量媒体采用前后三屏缓冲虚拟化渲染', () => {
  assert.match(source, /const VIRTUALIZE_THRESHOLD = 60/);
  assert.match(source, /const VIRTUAL_BUFFER_SCREENS = 3/);
  assert.match(source, /function getVirtualWindow/);
  assert.match(source, /gridTemplateColumns/);
  assert.match(source, /function setVirtualWindowState/);
  assert.match(source, /function appendVirtualSpacer/);
  assert.match(source, /rmw-virtual-spacer/);
  assert.match(source, /const shouldShowStatus = !windowInfo\.virtualized \|\| windowInfo\.end >= items\.length \|\| loadingState === 'error'/);
  assert.match(source, /const chunkRows = Math\.max\(1, Math\.floor\(visibleRows \/ 2\)\)/);
  assert.match(source, /const bufferRows = visibleRows \* VIRTUAL_BUFFER_SCREENS/);
  assert.match(source, /const previousStartRow = Number\(grid\.dataset\.virtualStartRow\)/);
  assert.match(source, /currentRow >= previousStartRow \+ guardRows/);
  assert.doesNotMatch(source, /--rmw-virtual-top/);
  assert.doesNotMatch(source, /--rmw-virtual-bottom/);
});

test('虚拟化窗口会跟随图片墙滚动节流刷新', () => {
  assert.match(source, /let virtualRenderFrame = null/);
  assert.match(source, /function scheduleVirtualRender/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /grid\.addEventListener\('scroll'[\s\S]*scheduleVirtualRender\(\)/);
  assert.match(source, /if \(virtualRenderFrame\) root\.cancelAnimationFrame\?\.|\|\| root\.clearTimeout/);
});

test('图片墙滚动在虚拟窗口未变化时不清空重建卡片以避免闪烁', () => {
  assert.match(source, /function virtualRenderSignature/);
  assert.match(source, /grid\.dataset\.renderSignature === signature/);
  assert.match(source, /setVirtualWindowState\(grid, windowInfo\);[\s\S]*if \(grid\.dataset\.renderSignature === signature\) return;/);
  assert.match(source, /if \(grid\.dataset\.renderSignature === signature\) return;/);
  assert.match(source, /grid\.dataset\.renderSignature = signature;[\s\S]*grid\.textContent = '';/);
  assert.match(source, /const previousScrollTop = grid\.scrollTop/);
  assert.match(source, /grid\.scrollTop = previousScrollTop/);
});

test('图片墙只预热视口附近缩略图并在预览时预热前后两张', () => {
  assert.match(source, /const THUMB_PRELOAD_AHEAD = 18/);
  assert.match(source, /function preloadVisibleThumbs/);
  assert.match(source, /preloadVisibleThumbs\(items, windowInfo\.start, windowInfo\.end, scrollMode\)/);
  assert.match(source, /media\.loading = shouldEagerLoadThumb\(index, windowInfo, scrollMode\) \? 'eager' : 'lazy'/);
  assert.match(source, /\[index, index \+ 1, index - 1, index \+ 2, index - 2\]/);
  assert.doesNotMatch(source, /items\.forEach[\s\S]{0,400}preloadPreviewMedia\(item\)/);
});

test('视频无封面时卡片使用 video 元素读取首帧避免 mp4 被当图片加载为空白', () => {
  assert.match(source, /const useVideoThumb = item\.type === 'video' && !item\.poster/);
  assert.match(source, /doc\.createElement\(useVideoThumb \? 'video' : 'img'\)/);
  assert.match(source, /media\.preload = 'metadata'/);
  assert.match(source, /media\.muted = true/);
  assert.match(source, /media\.playsInline = true/);
});

test('图片卡片显示骨架占位并在加载完成后淡入', () => {
  assert.match(source, /\.rmw-card::before\s*\{/);
  assert.match(source, /@keyframes rmw-skeleton/);
  assert.match(source, /\.rmw-card\.is-loaded::before/);
  assert.match(source, /\.rmw-card\.is-failed::after/);
  assert.match(source, /bindMediaLoadState\(media, card, item, onThumbFailure\)/);
});

test('缩略图加载失败会有限重试并回退到原图地址', () => {
  assert.match(source, /const THUMB_RETRY_LIMIT = 2/);
  assert.match(source, /const THUMB_RETRY_DELAY = 450/);
  assert.match(source, /function buildThumbCandidates/);
  assert.match(source, /function bindMediaLoadState/);
  assert.match(source, /media\.addEventListener\('error'/);
  assert.match(source, /retryCount < THUMB_RETRY_LIMIT/);
  assert.match(source, /card\.classList\.add\('is-failed'\)/);
});

test('图片墙根据滚动速度调整缩略图预取距离和加载优先级', () => {
  assert.match(source, /const FAST_SCROLL_THRESHOLD = 1800/);
  assert.match(source, /function getScrollMode/);
  assert.match(source, /function getThumbPreloadAhead/);
  assert.match(source, /function shouldEagerLoadThumb/);
  assert.match(source, /let scrollSpeed = 0/);
  assert.match(source, /scrollSpeed = Math\.abs\(grid\.scrollTop - lastScrollTop\)/);
  assert.match(source, /getScrollMode\(scrollSpeed\)/);
});

test('视频预览才加载完整播放源，卡片阶段保持轻量 metadata', () => {
  assert.match(source, /media\.preload = 'metadata'/);
  assert.match(source, /if \(item\.type === 'video'\) \{[\s\S]*media\.preload = 'auto'/);
  assert.match(source, /media\.src = item\.src/);
  assert.doesNotMatch(source, /useVideoThumb[\s\S]{0,160}media\.preload = 'auto'/);
});

test('工具栏显示更细的加载进度、最近新增和缩略图失败数量', () => {
  assert.match(source, /const mediaStats = \{ lastAdded: 0, thumbFailures: 0 \}/);
  assert.match(source, /function updateLoadedText/);
  assert.match(source, /最近新增 \$\{mediaStats\.lastAdded\} 项/);
  assert.match(source, /失败 \$\{mediaStats\.thumbFailures\} 项/);
  assert.match(source, /onThumbFailure/);
});

test('图片墙包含类型尺寸控制与键盘可达的卡片', () => {
  assert.match(source, /rmw-filter/);
  assert.match(source, /rmw-size/);
  assert.match(source, /card\.tabIndex\s*=\s*0/);
  assert.match(source, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(source, /scrollIntoView/);
  assert.match(source, /rmw-current/);
});

test('加载状态防止重复请求并在连续无新增后结束', () => {
  const session = api.createWallSession();
  assert.equal(session.beginLoad(), true);
  assert.equal(session.beginLoad(), false);
  for (let i = 0; i < 5; i += 1) {
    session.finishLoad(false);
    if (i < 4) session.beginLoad();
  }
  assert.equal(session.snapshot().loadingState, 'exhausted');
  session.retryLoad();
  assert.equal(session.snapshot().loadingState, 'idle');
  assert.equal(session.snapshot().stagnantLoads, 0);
});

test('入口复用同一页面会话状态对象和媒体控制器', () => {
  assert.match(source, /const wallSession = createWallSession\(root\.localStorage, site\)/);
  assert.match(source, /const wallController = createWallController\(adapter\)/);
  assert.match(source, /openWall\(doc, adapter, wallSession, wallController\)/);
});

test('重新打开图片墙时不会清空本页已经加载的媒体', () => {
  assert.match(source, /syncMedia\(attempts === 1 && !controller\.items\(\)\.length\)/);
});

test('媒体同步重新渲染不会覆盖恢复后的滚动位置', () => {
  assert.match(source, /if \(!restoredScroll\) \{[\s\S]*grid\.scrollTop = sessionSnapshot\.scrollTop;[\s\S]*restoredScroll = true;[\s\S]*\}/);
  assert.doesNotMatch(source, /const desiredScroll = restoredScroll \? grid\.scrollTop : sessionSnapshot\.scrollTop/);
});

test('预览提供计数评价折叠与单项原图操作', () => {
  const session = api.createWallSession();
  session.toggleContext();
  assert.equal(session.snapshot().contextCollapsed, true);
  assert.match(source, /rmw-counter/);
  assert.match(source, /rmw-context-toggle/);
  assert.match(source, /打开原图/);
  assert.match(source, /下载原图/);
});

test('评价信息收起后操作按钮仍保留在媒体区域以便重新展开', () => {
  assert.match(source, /rmw-preview-tools/);
  assert.match(source, /mediaBox\.appendChild\(tools\)/);
  assert.match(source, /tools\.append\(toggle, original, download, slideshow\)/);
});

test('预览幻灯片状态在 renderPreview 可访问以避免打开图片时报错', () => {
  assert.match(source, /let slideshowTimer = null;[\s\S]*let slideshowActive = false;[\s\S]*function renderPreview/);
  assert.doesNotMatch(source, /function openWall[\s\S]*let slideshowTimer = null;[\s\S]*function revealCurrentCard/);
});

test('退出预览返回图片墙时使用即时定位避免点击外部区域迟钝', () => {
  assert.match(source, /card\.scrollIntoView\(\{ block: 'center', behavior: 'auto' \}\)/);
  assert.doesNotMatch(source, /scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/);
});

test('预览右侧评价文字采用更清晰的大字号分层排版', () => {
  assert.match(source, /rmw-context-title/);
  assert.match(source, /rmw-context-label/);
  assert.match(source, /rmw-context-text/);
  assert.match(source, /rmw-context-meta/);
  assert.match(source, /\.rmw-context-title\s*\{[^}]*font-size:30px;/s);
  assert.match(source, /\.rmw-context-text\s*\{[^}]*font-size:20px;[^}]*line-height:1\.9;/s);
  assert.match(source, /\.rmw-context-meta\s*\{[^}]*font-size:17px;[^}]*line-height:1\.75;/s);
  assert.match(source, /makeElement\(doc, 'span', 'rmw-context-label', '评价内容'\)/);
  assert.match(source, /makeElement\(doc, 'span', 'rmw-context-label rmw-context-meta-label', '购买信息'\)/);
});

test('预览图片与文字之间提供可拖动并可双击复位的分隔条', () => {
  assert.match(source, /rmw-context-resizer/);
  assert.match(source, /\.rmw-context\s*\{[^}]*box-sizing:border-box;/s);
  assert.match(source, /setPointerCapture\(event\.pointerId\)/);
  assert.match(source, /session\.setContextWidth\(width\)/);
  assert.match(source, /session\.resetContextWidth\(\)/);
  assert.match(source, /resizer\.addEventListener\('dblclick'/);
});

test('预览图片区域支持滚轮切换上一张和下一张并防止连续跳图', () => {
  assert.match(source, /mediaBox\.addEventListener\('wheel'/);
  assert.match(source, /\{ passive: false \}/);
  assert.match(source, /event\.deltaY > 0 \? 1 : -1/);
  assert.match(source, /WHEEL_SHIFT_COOLDOWN/);
  assert.match(source, /event\.preventDefault\(\)/);
});

test('淘宝天猫评价内容使用同一套预览阅读排版', () => {
  assert.match(source, /function appendTaobaoReviewMedia/);
  assert.match(source, /items\.push\(\{ type: 'image', src: absoluteMediaUrl\(src\), poster: '', text, meta \}\)/);
  assert.match(source, /function extractTaobaoVideo/);
  assert.match(source, /function appendTaobaoVideos/);
  assert.match(source, /context\.appendChild\(makeElement\(doc, 'p', 'rmw-context-text', item\.text \|\|/);
  assert.match(source, /context\.appendChild\(makeElement\(doc, 'p', 'rmw-context-meta', item\.meta\)\)/);
});

test('打开预览前会提前预热原图以减少黑屏等待', () => {
  assert.match(source, /function preloadPreviewMedia/);
  assert.match(source, /new root\.Image\(\)/);
  assert.match(source, /preloadPreviewAround\(items, index\)/);
});

test('预览图片先显示缩略图并在原图加载后替换以提升打开速度', () => {
  assert.match(source, /const previewSrc = item\.poster \|\| item\.src/);
  assert.match(source, /media\.src = previewSrc/);
  assert.match(source, /fullImage\.onload = \(\) => \{ media\.src = item\.src; \}/);
});

test('预览外层关闭使用 pointerdown 提前响应', () => {
  assert.match(source, /overlay\.addEventListener\('pointerdown'/);
  assert.doesNotMatch(source, /overlay\.addEventListener\('click', \(event\) => \{[\s\S]*state\.onBackdrop\(\);[\s\S]*onReturn\(\);[\s\S]*\}\);/);
});

test('图片墙弹窗头部不再显示标题副标题和说明文案', () => {
  assert.doesNotMatch(source, /rmw-header/);
  assert.doesNotMatch(source, /rmw-subtitle/);
  assert.doesNotMatch(source, /rmw-guide/);
  assert.doesNotMatch(source, /makeElement\(doc, 'h2', 'rmw-title', '图片墙'\)/);
  assert.doesNotMatch(source, /需要调整/);
});

test('关闭按钮和同步按钮位于工具栏中而不是独立顶部栏', () => {
  assert.match(source, /toolbar\.append\(filterGroup, sizeGroup, currentProduct, loaded, sync, close\)/);
  assert.doesNotMatch(source, /makeElement\(doc, 'header', 'rmw-header'/);
  assert.doesNotMatch(source, /modal\.appendChild\(header\)/);
});

test('图片墙使用轻量 Google 风格的白底圆角和蓝色交互色', () => {
  assert.match(source, /border-radius:28px/);
  assert.match(source, /#1a73e8/);
  assert.match(source, /box-shadow:0 1px 3px rgba\(60,64,67,\.[0-9]+\)/);
});

test('样式节点存在时会更新内容以支持油猴热更新后的新界面', () => {
  assert.match(source, /const style = doc\.getElementById\('review-media-wall-style'\) \|\| doc\.createElement\('style'\)/);
  assert.doesNotMatch(source, /if \(doc\.getElementById\('review-media-wall-style'\)\) return/);
});

test('预览打开时点击整个弹窗外侧遮罩也只返回图片墙', () => {
  assert.match(source, /const hadPreview = Boolean\(state\.snapshot\(\)\.preview\)/);
  assert.match(source, /if \(hadPreview\) \{[\s\S]*renderPreview\(doc, modal, state, wallSession, revealCurrentCard\);[\s\S]*revealCurrentCard\(\);[\s\S]*return;/);
});

test('返回卡片高亮在媒体同步重新渲染后仍可保留至超时', () => {
  assert.match(source, /let highlightKey = ''/);
  assert.match(source, /item\.src === highlightKey/);
  assert.match(source, /highlightKey = key/);
  assert.match(source, /highlightKey = ''/);
});

test('发布脚本提供油猴更新地址并提升增强版版本号', () => {
  assert.match(source, /@version\s+0\.5\.17/);
  assert.match(source, /@downloadURL\s+https:\/\/raw\.githubusercontent\.com\/hahapkpk\/tools\/main\/jd-taobao-review-media-waterfall\.user\.js/);
  assert.match(source, /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/hahapkpk\/tools\/main\/jd-taobao-review-media-waterfall\.user\.js/);
});

test('加载新增媒体只追加此前未见的地址', () => {
  const store = api.createMediaStore();
  store.replace([{ src: 'a.jpg', type: 'image' }]);
  store.append([{ src: 'a.jpg', type: 'image' }, { src: 'b.jpg', type: 'image' }]);
  assert.deepEqual(store.items().map(item => item.src), ['a.jpg', 'b.jpg']);
});

test('原生筛选切换后重置为当前筛选媒体集合', () => {
  const controller = api.createWallController({
    collectMedia: () => [{ src: 'new.jpg', type: 'image' }]
  });
  controller.replace([{ src: 'old.jpg', type: 'image' }]);
  controller.onFilterChanged({});
  assert.deepEqual(controller.items().map(item => item.src), ['new.jpg']);
});

test('即时当前商品筛选先清空旧集合且后续 DOM 同步只追加不覆盖响应媒体', () => {
  const controller = api.createWallController({
    collectMedia: () => [{ src: 'dom-current.jpg', type: 'image' }]
  });
  controller.replace([{ src: 'all-products.jpg', type: 'image' }]);
  const previous = controller.beginFilterChange();
  controller.append([{ src: 'api-current.jpg', type: 'image' }]);
  controller.appendFrom({});

  assert.deepEqual(previous.map(item => item.src), ['all-products.jpg']);
  assert.deepEqual(controller.items().map(item => item.src), ['api-current.jpg', 'dom-current.jpg']);
  assert.match(source, /if \(behavior === 'immediate'\)[\s\S]{0,500}controller\.beginFilterChange\(\)[\s\S]{0,500}syncMedia\(false\)/);
});

test('当前商品首批媒体不足一屏时自动请求下一页', () => {
  assert.equal(api.shouldAutoFillCurrentProduct({ active: true, added: true, nearBottom: true, loadingState: 'idle' }), true);
  assert.equal(api.shouldAutoFillCurrentProduct({ active: false, added: true, nearBottom: true, loadingState: 'idle' }), false);
  assert.equal(api.shouldAutoFillCurrentProduct({ active: true, added: false, nearBottom: true, loadingState: 'idle' }), false);
  assert.equal(api.shouldAutoFillCurrentProduct({ active: true, added: true, nearBottom: false, loadingState: 'idle' }), false);
  assert.equal(api.shouldAutoFillCurrentProduct({ active: true, added: true, nearBottom: true, loadingState: 'exhausted' }), false);
  assert.match(source, /shouldAutoFillCurrentProduct\([\s\S]{0,300}requestMore\(\)/);
});

test('图视频筛选已激活时不重复触发原生点击', () => {
  let clicks = 0;
  const selected = {
    textContent: '图/视频44',
    innerText: '图/视频44',
    className: 'imprItem isSelected',
    children: [],
    click() { clicks += 1; }
  };
  const root = { querySelectorAll: () => [selected] };
  assert.equal(api.adapters.taobao.selectMedia(root), true);
  assert.equal(clicks, 0);
});

test('京东当前商品筛选复用原生当前商品开关', () => {
  let clicked = 0;
  const current = {
    className: '_skuSelect_test',
    textContent: '当前商品',
    innerText: '当前商品',
    children: [],
    click() {
      clicked += 1;
    }
  };
  const root = {
    querySelectorAll() {
      return [current];
    }
  };
  assert.equal(api.adapters.jd.openCurrentProductFilter(root), 'immediate');
  assert.equal(clicked, 1);
});

test('京东全部评价筛选优先点击已激活的当前商品开关恢复全部商品', () => {
  let clicked = 0;
  const current = {
    className: '_skuSelect_19gj1_28 _active_19gj1_25',
    textContent: '当前商品',
    innerText: '当前商品',
    children: [],
    click() {
      clicked += 1;
    }
  };
  const allReviews = {
    className: 'imprItem',
    textContent: '全部评价',
    innerText: '全部评价',
    children: [],
    click() {
      clicked += 10;
    }
  };
  const root = {
    querySelectorAll() {
      return [allReviews, current];
    }
  };
  assert.equal(api.adapters.jd.openAllReviewsFilter(root), true);
  assert.equal(clicked, 1);
});

test('淘宝当前商品筛选打开原生款式筛选面板', () => {
  let clicked = 0;
  const root = {
    querySelector(selector) {
      if (!selector.includes('shapeFliterWrap')) return null;
      return {
        click() {
          clicked += 1;
        }
      };
    }
  };
  assert.equal(api.adapters.taobao.openCurrentProductFilter(root), 'interactive');
  assert.equal(clicked, 1);
});

test('淘宝只把评价款式筛选弹层识别为当前商品筛选面板', () => {
  const documentWithProductPanel = {
    querySelectorAll() {
      return [
        { innerText: '商品规格\n颜色分类' },
        { innerText: '款式筛选\n商品规格\n清空选择\n确定' }
      ];
    }
  };
  assert.equal(api.adapters.taobao.isCurrentProductFilterOpen(documentWithProductPanel), true);
  documentWithProductPanel.querySelectorAll = () => [{ innerText: '商品规格\n颜色分类' }];
  assert.equal(api.adapters.taobao.isCurrentProductFilterOpen(documentWithProductPanel), false);
});

test('图片墙工具栏提供当前商品筛选并在淘宝交互筛选后恢复同步', () => {
  assert.match(source, /makeElement\(doc, 'button', 'rmw-current-product', '当前商品'\)/);
  assert.match(source, /adapter\.openCurrentProductFilter\(nativeRoot\)/);
  assert.match(source, /backdrop\.style\.display = 'none'/);
  assert.match(source, /waitForCurrentProductFilter/);
  assert.match(source, /syncMedia\(true\)/);
});

test('京东取消当前商品筛选时先恢复全部商品媒体缓存避免清空图片墙', () => {
  assert.match(source, /let allProductItems = \[\]/);
  assert.match(source, /allProductItems = controller\.items\(\)/);
  assert.match(source, /controller\.replace\(allProductItems\)/);
  assert.match(source, /syncMedia\(false\)/);
});

test('图片墙滚动接近底部时按需懒加载原生评价列表补齐更多图片', () => {
  assert.match(source, /AUTO_LOAD_MAX_ROUNDS/);
  assert.match(source, /AUTO_LOAD_SETTLE_DELAY/);
  assert.match(source, /AUTO_LOAD_SCROLL_PULSES/);
  assert.match(source, /AUTO_LOAD_NEAR_BOTTOM/);
  assert.match(source, /function scheduleAutoLoad/);
  assert.match(source, /function runAutoLoad/);
  assert.match(source, /function isGridNearBottom/);
  assert.match(source, /scrollNativeReviews\(\)/);
  assert.match(source, /findScrollableCandidates\(nativeRoot\)/);
  assert.match(source, /looksScrollable/);
  assert.match(source, /new root\.WheelEvent\('wheel'/);
  assert.match(source, /syncMedia\(false\)/);
  assert.match(source, /grid\.addEventListener\('scroll'[\s\S]*if \(isGridNearBottom\(\)\) requestMore\(\)/);
  assert.doesNotMatch(source, /waitForNative[\s\S]{0,260}scheduleAutoLoad\(true\)/);
});

test('按需懒加载新增内容后只有仍接近图片墙底部才继续下一批', () => {
  assert.match(source, /let userRequestedMore = false/);
  assert.match(source, /userRequestedMore = true/);
  assert.match(source, /wallSession\.snapshot\(\)\.loadingState === 'exhausted'/);
  assert.match(source, /wallSession\.retryLoad\(\)/);
  assert.match(source, /if \(\(moved \|\| added\) && userRequestedMore && isGridNearBottom\(\) && autoLoadRounds < AUTO_LOAD_MAX_ROUNDS/);
  assert.match(source, /else if \(added && userRequestedMore && nearBottom\)/);
});

test('京东自动加载会复用最近一次评论接口请求体拉取下一页', () => {
  assert.match(source, /function buildNextJdBody/);
  assert.match(source, /function buildNextJdRequest/);
  assert.match(source, /capture\.lastRequest = \{\s*url: this\.__rmwJdResponseUrl/);
  assert.match(source, /capture\.requestNextPage/);
  assert.match(source, /if \(!response\.ok\) return false/);
  assert.match(source, /adapter\.requestNextPage/);
});

test('淘宝图视频筛选项含数量子节点时点击真实筛选容器', () => {
  let clicks = 0;
  const item = {
    textContent: '图/视频44',
    className: 'imprItem--filter',
    children: [{}],
    click() { clicks += 1; }
  };
  const root = { querySelectorAll: () => [item] };
  assert.equal(api.adapters.taobao.selectMedia(root), true);
  assert.equal(clicks, 1);
});

test('淘宝抽屉暂未挂载媒体时回退读取同页评价相册', () => {
  const emptyDrawer = { querySelectorAll: () => [] };
  const pageComment = {
    innerText: '匿名买家 实物很好看',
    querySelectorAll: () => [{ src: 'https://gw.alicdn.com/fallback-rate.jpg' }]
  };
  const page = {
    querySelectorAll(selector) {
      return selector.includes('Comment') ? [pageComment] : [];
    }
  };
  assert.deepEqual(api.collectWithFallback(api.adapters.taobao, emptyDrawer, page).map(item => item.src), [
    'https://gw.alicdn.com/fallback-rate.jpg'
  ]);
});

test('淘宝打开原生评价抽屉使用查看全部评价按钮', () => {
  let clicks = 0;
  const button = { click() { clicks += 1; } };
  const doc = {
    querySelector(selector) {
      return selector.includes('ShowButton') ? button : null;
    }
  };
  api.adapters.taobao.openNativeReviews(doc);
  assert.equal(clicks, 1);
});

test('关闭图片墙会关闭淘宝原生评价抽屉', () => {
  let clicks = 0;
  const root = {
    querySelector(selector) {
      return selector.includes('closeWrap') ? { click() { clicks += 1; } } : null;
    }
  };
  api.adapters.taobao.closeNativeReviews(root);
  assert.equal(clicks, 1);
});

test('关闭图片墙会关闭京东原生评价弹窗', () => {
  let clicks = 0;
  const root = {
    querySelector(selector) {
      return selector.includes('_closeIcon_') ? { click() { clicks += 1; } } : null;
    }
  };
  api.adapters.jd.closeNativeReviews(root);
  assert.equal(clicks, 1);
});

test('淘宝同步等待原生评价抽屉而非内嵌评价摘要', () => {
  const inline = { className: 'Comments--inline' };
  const doc = {
    querySelectorAll: () => [],
    querySelector(selector) {
      return selector.includes('Comments') ? inline : null;
    }
  };
  assert.equal(api.adapters.taobao.findNativeRoot(doc), null);
});
