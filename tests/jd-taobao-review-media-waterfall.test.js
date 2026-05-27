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
  state.openPreview({ src: 'a.jpg' });
  state.onBackdrop();
  assert.equal(state.snapshot().wallOpen, true);
  assert.equal(state.snapshot().preview, null);
  state.onBackdrop();
  assert.equal(state.snapshot().wallOpen, false);
});

test('重复初始化仅生成一个图片墙入口且显示新名称', () => {
  const children = [];
  const mount = {
    ownerDocument: {
      createElement() {
        return { id: '', className: '', textContent: '', listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; } };
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

test('图片墙采用规则方形图集并仅在内容区纵向滚动', () => {
  assert.match(source, /#\$\{IDS\.grid\}\s*\{[^}]*display:grid;[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\);[^}]*overflow-y:auto;/s);
  assert.match(source, /\.rmw-card::before\s*\{[^}]*content:'';[^}]*display:block;[^}]*padding-top:100%;/s);
  assert.match(source, /\.rmw-card img,\s*\.rmw-card video\s*\{[^}]*position:absolute;[^}]*inset:0;[^}]*height:100%;[^}]*object-fit:cover;/s);
  assert.doesNotMatch(source, /column-count:/);
});

test('图片墙按实际列宽设置卡片高度以避免天猫网格行重叠', () => {
  assert.match(source, /function sizeGridCards\(grid\)\s*\{[\s\S]*card\.style\.height\s*=\s*`\$\{Math\.round\(width\)\}px`;/);
  assert.match(source, /renderCards\([\s\S]*sizeGridCards\(grid\);/);
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
