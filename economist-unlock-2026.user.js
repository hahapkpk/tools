// ==UserScript==
// @name         Economist Unlock 2026 — 最小干预版 (v3)
// @namespace    https://github.com/hahapkpk/tools
// @version      3.0.0
// @description  经济学人付费墙解锁：登录态下完全不碰页面（原生已显示全文+图片）；仅匿名态才用内嵌全文补全。最大限度保留原版界面。
// @author       Seagull
// @match        *://*.economist.com/*
// @grant        none
// @run-at       document_idle
// @license      MIT
// ==/UserScript==

/*
 * v3 设计原则（2026-11-21 真实 Chrome 实测）：
 *  - 登录免费账号后：pageProps.auth.loggedIn=true / isSubscriber=false，
 *    walled=false，content.body 有 13 个 block（11 PARAGRAPH + INFOBOX + CROSSHEAD），
 *    页面原生完整渲染全文 + 8 张图片，零付费墙。此时脚本【一个字都不改 DOM】。
 *  - 匿名态：body 只有 1 段（预览），才启用内嵌全文补全（本文专属）。
 *  - 不再用纯文本 innerHTML 覆盖 #content —— 那会毁掉原版排版和图片。
 *  - 拆 killWallLight/killWall，MutationObserver 只做轻量删除。
 *  - 状态条默认关闭（SHOW_STATUS=false），需要调试改成 true。
 */

(function () {
  'use strict';

  var SHOW_STATUS = false;           // 默认静默；改 true 显示调试状态条
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

  var WALL_SELS = ['#tp-regwall', '.layout-article-regwall', '.paywall', '[class*="regwall"]'];

  function log() { if (SHOW_STATUS) { try { console.log('[EconUnlock]', ...arguments); } catch (e) {} } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function status(msg) {
    if (!SHOW_STATUS) return;
    var el = document.getElementById('__econ_status__');
    if (!el) {
      el = document.createElement('div');
      el.id = '__econ_status__';
      el.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:2147483647;' +
        'font:12px system-ui;padding:6px 10px;border-radius:5px;background:#14532d;color:#fff;';
      document.body.appendChild(el);
    }
    el.textContent = '[EconUnlock] ' + msg;
  }

  function killWallLight() {
    WALL_SELS.forEach(function (sel) {
      try { document.querySelectorAll(sel).forEach(function (e) { e.remove(); }); } catch (e) {}
    });
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
  }

  function readSSR() {
    var n = document.getElementById('__NEXT_DATA__');
    if (!n) return null;
    try {
      var pp = JSON.parse(n.textContent).props.pageProps;
      return { body: (pp.content && pp.content.body) || [], auth: pp.auth || {}, walled: pp.walled };
    } catch (e) { return null; }
  }

  function findHost() {
    var sels = ['[data-body-id] > div', '#content', 'article .article__body', '.article-body', 'main article', 'main'];
    for (var i = 0; i < sels.length; i++) {
      var e = document.querySelector(sels[i]);
      if (e) return e;
    }
    return null;
  }

  // 匿名态补全：用内嵌全文，但尽量保留原版样式类，图片用占位说明（内嵌源无图片 URL）
  function embedFulltext() {
    var host = findHost();
    if (!host) { status('未找到正文容器，跳过'); return; }
    // 只在正文明显被截断（段落 < 5）时才补全，避免重复执行
    if (host.querySelectorAll('p.article__body-text').length >= 5) {
      status('正文已完整，无需补全');
      return;
    }
    killWallLight();
    var html = EMBED_PARAS.map(function (p) {
      return '<p class="article__body-text">' + esc(p) + '</p>';
    }).join('\n');
    host.innerHTML = html;
    status('已补全内嵌全文 ' + EMBED_PARAS.length + ' 段（原图需登录查看）');
    log('embedded', EMBED_PARAS.length, 'paras');
  }

  function boot() {
    var ssr = readSSR();
    var isEmbed = location.href.indexOf(EMBED_MATCH) !== -1;

    if (ssr && ssr.body.length > 2) {
      // 登录态 / SSR 全文已下发：页面原生完整，绝不碰正文 DOM
      killWallLight();   // 只清可能的残留遮罩（正常为空，无副作用）
      status('SSR 全文 ' + ssr.body.length + ' block，原生渲染，不干预');
      log('logged-in / full SSR, no DOM touch, blocks=', ssr.body.length);
      return;
    }
    if (isEmbed) {
      embedFulltext();   // 仅匿名态 + 本文
      return;
    }
    // 其它文章匿名态：只清遮罩，不伪造内容
    killWallLight();
    status('非本文且未登录：仅清理遮罩，请登录查看全文');
  }

  var t = setInterval(function () {
    if (document.getElementById('__NEXT_DATA__')) { clearInterval(t); boot(); }
  }, 200);
  setTimeout(function () { clearInterval(t); killWallLight(); }, 15000);

  // 轻量墙清理：SPA 导航后若再出现遮罩，只删元素不重排正文
  new MutationObserver(killWallLight).observe(document.documentElement, { childList: true, subtree: true });
  log('loaded');
})();
