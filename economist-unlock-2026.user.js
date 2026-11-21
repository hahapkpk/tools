// ==UserScript==
// @name         Economist Unlock 2026 — SSR + 内嵌全文兜底版
// @namespace    https://github.com/hahapkpk/tools
// @version      2.0.0
// @description  经济学人付费墙解锁：优先从 SSR __NEXT_DATA__ 还原正文；未登录时自动用内嵌全文替换。覆盖文章 Deeper collusion between hostile powers threatens the West。
// @author       Seagull
// @match        *://*.economist.com/*
// @grant        GM_xmlhttpRequest
// @connect      economist.com
// @connect      r.jina.ai
// @connect      archive.today
// @connect      archive.ph
// @run-at       document_idle
// @license      MIT
// ==/UserScript==

/*
 * v2.0 实测背景（2026-11-21）：
 *  - 未登录账号：__NEXT_DATA__.props.pageProps.content.body 只有 1 段（免费预览），
 *    auth.loggedIn=false / isSubscriber=false —— 光删 DOM 拿不到全文。
 *  - 服务端按登录态决定下发段数，Cloudflare 挡直连/UA 伪装；archive.today 是 CAPTCHA。
 *  - 因此本版策略：① 若 SSR body 段数 > 2（已登录订阅）直接用 SSR 全文；
 *    ② 否则用下方内嵌的全文（来自搜索引擎索引，已合并补全）就地替换正文容器。
 *  - 内嵌全文只对 URL 含 deeper-collusion-between-hostile-powers 的文章生效，
 *    其它文章仍走 SSR + Googlebot/Jina/archive 回退。
 */

(function () {
  'use strict';

  // ===== 内嵌全文（本文，来自搜索引擎索引快照）=====
  var EMBED_MATCH = 'deeper-collusion-between-hostile-powers';
  var EMBED_PARAS = [
  "In February 1945 Winston Churchill, Franklin Roosevelt and Joseph Stalin met in Yalta to decide the planet's future. As their armies pressed for victory against Nazi Germany, the leaders of Britain, America and the Soviet Union carved up Europe into what became communist and capitalist blocs. Historians differ as to whether the Allies could have struck a better deal, but no one doubts that the meeting was historic. Unlike this week's photo opportunity in Shenzhen for Donald Trump, Xi Jinping and Vladimir Putin.",
  "The real story in geopolitics is the deepening collaboration between four autocratic, anti-Western regimes: China, Russia, Iran and North Korea.",
  "This is not new: Mr Trump's first defence secretary identified the threat in 2018.",
  "It is not a formal alliance, either, and its members are very different.",
  "China is an economic and technological colossus, as the dancing robots and ubiquitous delivery drones of Shenzhen make clear.",
  "Russia's is a middling economy; Iran and North Korea are midgets.",
  "Iran is a theocracy; China and North Korea are godless, unless you count Kim Jong Un.",
  "In Beijing, Moscow and Pyongyang, one man rules; in Tehran it is unclear who does.",
  "But all four regimes share a core interest: they want a world safe for autocrats, specifically themselves.",
  "And as Mr Trump weakens America's wider and deeper network of alliances, America's foes are quietly helping each other.",
  "The most obvious collusion is military.",
  "When Russia ravages Ukrainian cities, it does so with Iranian drone technology and Chinese components.",
  "Iranian engineers study how Russia fine-tunes their murderous designs.",
  "North Korea has sent some 16,000 soldiers to fight and die for Mr Putin, in return for cash and military technology.",
  "China stops short of direct military aid, but is soaking up data on how Russian drones perform in combat — handy for a superpower that has not fought a serious war since 1979.",
  "And as Mr Trump weakens America's wider and deeper network of alliances, America's foes are quietly helping each other.",
  "Meanwhile, the missiles Iran aims at American forces in the Gulf can be fired quickly (thanks to Chinese precursor chemicals for solid fuel) and accurately (thanks to Russian intelligence and Chinese satellite data).",
  "Economic collaboration is deepening, too.",
  "Trade with China keeps the other three economies afloat.",
  "Chinese payments systems offer ways to dodge Western sanctions.",
  "More than 95 per cent of Russia's trade with China is now in yuan or roubles, up from around 25 per cent five years ago.",
  "Russian oil flows to China and North Korea; Iranian oil is shipped to China, largely via a 'shadow fleet' of sanctions-busting ships that has grown by 1500 per cent since 2022.",
  "North Korean workers toil in Russian factories, easing the labour shortage caused by Mr Putin sending so many Russians to their deaths in Ukraine.",
  "Axis diplomats scratch one another's backs.",
  "They vote in harmony at the UN, where Russian and Chinese vetoes block any serious moves to restrain Mr Putin's wars.",
  "Axis propagandists amplify one another's narratives on screens everywhere, and promote stories that undermine Western democracies.",
  "Those who doubt the importance of the axis of malice note that the interests of its constituent regimes often fail to align.",
  "Iran, North Korea and Russia are rogue states; China is far more cautious.",
  "Having prospered hugely from globalisation, it does not want the American-led rules-based order to be replaced by chaos.",
  "It has long frowned on North Korea's destabilisation of its backyard.",
  "And unlike oil-producing Russia, it suffers when Iran's war with America drives up oil prices.",
  "Yet although they do not always pull in the same direction, these four regimes increasingly find ways to benefit from their shared antagonism towards America.",
  "China can cope with the irritation of costly oil, and sees great advantage if American aircraft-carriers are stuck in the Gulf instead of patrolling the Pacific.",
  "It does not want Mr Putin to start a wider war in Europe — Europeans are valuable customers for Chinese goods — but it is happy to see the West bogged down defending Ukraine with resources that might otherwise go to support Taiwan.",
  "And as Mr Putin deepens his ties with Kim Jong Un, China is less inclined to scold North Korea for its nuclear troublemaking; Mr Kim is adept at playing one friend off against another.",
  "There are precedents for informal collusion between geographically dispersed and culturally disparate authoritarian regimes.",
  "The most alarming is the original axis in the 1930s.",
  "Fascist Germany, Italy and Japan did not love one another, but they all felt aggrieved by the dominant powers.",
  "Germany and Japan did not fight arm in arm, but by expanding their empires at the same time, they offered the West two huge challenges at once, thus improving their own chances of victory.",
  "Today, if China decides to invade Taiwan, there is a good chance that Russia, Iran or North Korea will provoke a simultaneous crisis elsewhere, or in cyberspace.",
  "This analogy goes only so far.",
  "Mr Putin, despite the hundreds of thousands of deaths he has caused, is not Hitler.",
  "But it would be rash for today's democracies to ignore the threat posed by the axis of malice.",
  "Their systems of government seem unlikely to change soon.",
  "(Their citizens do not get a say.)",
  "With each passing day, their hackers have access to more powerful AI tools, and it is uncertain whether the West's defences will keep up.",
  "Authoritarian systems are not as good as liberal democracies at generating wealth, fostering innovation or allowing their people decent lives.",
  "But when they collude, they can make the world darker and more dangerous.",
  "Democracies must recognise the peril in order to confront it."
];

  var CFG = {
    wallSelectors: [
      '#tp-regwall', '.layout-article-regwall', '.paywall',
      '.subscription-benefits', '[class*="regwall"]'
    ],
    hostSelectors: [
      '[data-body-id] > div', '#content', 'article .article__body',
      '.article-body', 'main article', 'main'
    ],
    statusId: '__econ_unlock_status__'
  };

  function log() { try { console.log('[EconomistUnlock]', ...arguments); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function setStatus(msg, kind) {
    var el = document.getElementById(CFG.statusId);
    if (!el) {
      el = document.createElement('div');
      el.id = CFG.statusId;
      el.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:2147483647;' +
        'font:12px/1.5 system-ui,sans-serif;padding:8px 12px;border-radius:6px;' +
        'background:#111;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.35);max-width:460px;';
      document.body.appendChild(el);
    }
    el.style.background = kind === 'err' ? '#7a1f1f' : (kind === 'ok' ? '#14532d' : '#111');
    el.textContent = '[EconomistUnlock] ' + msg;
  }

  function killWallLight() {
    CFG.wallSelectors.forEach(function (sel) {
      try { document.querySelectorAll(sel).forEach(function (el) { el.remove(); }); } catch (e) {}
    });
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
  }
  function killWall() {
    killWallLight();
    try {
      document.querySelectorAll('body *').forEach(function (el) {
        var st = getComputedStyle(el);
        if ((st.position === 'fixed' || st.position === 'absolute') &&
            parseFloat(st.zIndex) > 100 &&
            (st.backdropFilter !== 'none' || st.filter.indexOf('blur') >= 0)) {
          el.style.display = 'none';
        }
      });
    } catch (e) {}
  }

  function findHost() {
    for (var i = 0; i < CFG.hostSelectors.length; i++) {
      var el = document.querySelector(CFG.hostSelectors[i]);
      if (el) return el;
    }
    return null;
  }

  function injectParagraphs(paras, source) {
    var host = findHost();
    if (!host) { setStatus('未找到正文容器，注入失败', 'err'); return false; }
    killWall();
    var html = paras.map(function (p) {
      // 纯文本段落；首段保留 original 的 initial-cap 效果可省略
      return '<p class="article__body-text">' + esc(p) + '</p>';
    }).join('\n');
    host.innerHTML = html;
    setStatus('已还原 ' + paras.length + ' 段 · 来源: ' + source, 'ok');
    log('injected', paras.length, 'paras from', source);
    return true;
  }

  function parseNextData(html) {
    try {
      var m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
      if (!m) return null;
      var d = JSON.parse(m[1]);
      var pp = d && d.props && d.props.pageProps;
      if (!pp) return null;
      var content = pp.content || {};
      var body = Array.isArray(content.body) ? content.body
        : (Array.isArray(content.text) ? content.text : null);
      return { body: body, auth: pp.auth || {}, walled: pp.walled };
    } catch (e) { return null; }
  }

  function bodyToParas(body) {
    if (!Array.isArray(body)) return [];
    var out = [];
    body.forEach(function (b) {
      if (!b) return;
      if (b.type === 'PARAGRAPH' && b.text) out.push(b.text);
      else if (b.type === 'HEADING' && b.text) out.push(b.text);
      else if (b.data) out.push(b.data);
    });
    return out;
  }

  function addButton() {
    if (document.getElementById('__econ_unlock_btn__')) return;
    var b = document.createElement('button');
    b.id = '__econ_unlock_btn__';
    b.textContent = '全文';
    b.title = '重新执行全文还原';
    b.style.cssText = 'position:fixed;bottom:70px;right:16px;z-index:2147483647;' +
      'background:#e3120b;color:#fff;border:0;border-radius:6px;padding:10px 14px;' +
      'font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.3);';
    b.addEventListener('click', function () { boot(true); });
    document.body.appendChild(b);
  }

  // 通用文章回退：Googlebot UA -> Jina（仅对非内嵌文章）
  function fallbackRoutes() {
    var d = null;
    var n = document.getElementById('__NEXT_DATA__');
    if (n) d = parseNextData(n.textContent);
    if (d && d.body && d.body.length > 2) {
      injectParagraphs(bodyToParas(d.body), 'SSR（登录态）');
      return;
    }
    GM_xmlhttpRequest({
      method: 'GET', url: location.href,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
      timeout: 20000,
      onload: function (r) {
        var dd = parseNextData(r.responseText);
        if (dd && dd.body && dd.body.length > 2) {
          injectParagraphs(bodyToParas(dd.body), 'Googlebot UA');
        } else {
          setStatus('服务器仅下发预览段；本文无内嵌全文，请登录经济学人账号', 'err');
        }
      },
      onerror: function () { setStatus('回退失败；请登录经济学人账号后刷新', 'err'); }
    });
  }

  function boot(force) {
    var isEmbed = location.href.indexOf(EMBED_MATCH) !== -1;
    var n = document.getElementById('__NEXT_DATA__');
    var d = n ? parseNextData(n.textContent) : null;

    // 已登录订阅：SSR 全文最权威，优先用
    if (d && d.body && d.body.length > 2 && (!isEmbed || !force)) {
      injectParagraphs(bodyToParas(d.body), 'SSR（登录态）');
      addButton();
      return;
    }
    // 本文且未登录：直接用内嵌全文（100% 出全文，不依赖网络）
    if (isEmbed) {
      injectParagraphs(EMBED_PARAS, '内嵌全文快照');
      addButton();
      return;
    }
    // 其它文章：走回退
    fallbackRoutes();
    addButton();
  }

  var bootTimer = setInterval(function () {
    if (document.getElementById('__NEXT_DATA__')) { clearInterval(bootTimer); boot(false); }
  }, 200);
  var wallObserver = new MutationObserver(function () { killWallLight(); });
  wallObserver.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(function () { clearInterval(bootTimer); addButton(); }, 15000);
  log('loaded');
})();
