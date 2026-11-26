// ==UserScript==
// @name         X Viral Monitor Lite
// @namespace    local.codex.x-viral-monitor-lite
// @version      0.2.8
// @description  X timeline velocity badges, bookmark counts, and copy tweet as Markdown. No image viewer.
// @match        https://x.com/*
// @match        https://pro.x.com/*
// @run-at       document-start
// @grant        unsafeWindow
// @homepageURL  https://github.com/hahapkpk/tools
// @supportURL   https://github.com/hahapkpk/tools/issues
// @downloadURL  https://cdn.jsdelivr.net/gh/hahapkpk/tools@main/x-viral-monitor-lite.user.js
// @updateURL    https://cdn.jsdelivr.net/gh/hahapkpk/tools@main/x-viral-monitor-lite.user.js
// @license      MIT
// ==/UserScript==

/*
 * PAGE STRUCTURE (reverse-engineered 2026-11 against the XDS / Base UI redesign).
 * X removed every data-testid from tweet DOM, dropped the <time> element, and
 * renamed the class system to the Tailwind-v4 XDS tokens. Everything below is
 * what the redesign actually renders; keep this block in sync when it rots.
 *
 *   tweet root      article  (must contain [data-engagement-action="share"];
 *                             bare `article` also matches sidebar/who-to-follow)
 *   header row      .x-middot-group  ->  parentElement  (flex row, justify-between)
 *   display name    .x-middot-group a[href^="/"]  (first, wraps a bold div)
 *   handle          .x-middot-group a[href^="/"]  (second, text "@name")
 *   caret           button[aria-label="更多"] / [aria-label="More"]
 *   tweet text      div.whitespace-pre-wrap.wrap-anywhere[lang]
 *   date link       a[href*="/status/<id>"]  whose text is a relative time
 *                   ("8小时", "3天", "2月5日"); NO <time datetime> anymore
 *   action bar      [role="group"][aria-label="8 回复、12 点赞、9 书签、2465 次观看"]
 *     reply         [data-engagement-action="reply"]  (an <a href="/compose/post?in_reply_to=ID">)
 *     repost        [data-engagement-action="retweet"]
 *     like          [data-engagement-action="like"]
 *     bookmark      NO data-engagement-action -> button[aria-label="书签"] / "Bookmark" /
 *                   "已添加书签" / "Remove bookmark"
 *     share         [data-engagement-action="share"]
 *   share menu      [role="menu"][data-slot="xds-menu-content"]
 *     item          [role="menuitem"][data-slot="xds-menu-item"]
 *                   structure: <span.icon> <svg> </span> <div.label>TEXT</div>
 *                   (label is the LAST child div, NOT the first span)
 *
 * DATA SOURCES
 *   primary   GraphQL, hooked via unsafeWindow.fetch / XHR.
 *             NOTE: the endpoint moved from x.com/i/api/graphql/<hash>/<op> to
 *             api.x.com/graphql/<hash>/<op>. GRAPHQL_RE matches both.
 *             The tweet object was ALSO restructured (verified 2026-11):
 *               legacy.created_at        -> details.created_at_ms  (epoch ms)
 *               legacy.full_text         -> details.full_text
 *               legacy.favorite_count    -> counts.favorite_count
 *               legacy.retweet_count     -> counts.retweet_count
 *               legacy.reply_count       -> counts.reply_count
 *               legacy.bookmark_count    -> counts.bookmark_count
 *               legacy.entities.urls     -> url_entities[]
 *               legacy.extended_entities.media -> media_entities2[]
 *               core.user_results.result.legacy.{name,screen_name}
 *                                        -> ...result.core.{name,screen_name}
 *               note_tweet.note_tweet_results.result.text  (unchanged, long posts)
 *             legacy.entities is now nearly empty ({lang, conversation_id_str,
 *             entities}), so never read counters from it on XDS payloads.
 *   fallback  DOM only. Views/counts come from the action-group aria-label;
 *             createdAt is parsed from the relative date text (low precision).
 *             DOM readings stay current and fill fields missing from GraphQL.
 */

(() => {
  'use strict';

  const SCRIPT_ID = 'x-viral-monitor-lite';
  const DEBUG = false;
  // X moved GraphQL from x.com/i/api/graphql/<hash>/<op> to api.x.com/graphql/<hash>/<op>
  // (verified 2026-11 against the XDS frontend). Match both, plus the legacy form.
  const GRAPHQL_RE = /^\/(?:i\/api\/)?graphql\//;
  const API_HOSTS = new Set(['x.com', 'api.x.com', 'pro.x.com', 'twitter.com', 'api.twitter.com']);
  const STATUS_PATH = /^\/(?:i\/web|[^/]+)\/status\/(\d+)\/?$/;
  const pageWindow = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
  const thresholds = { trending: 1000, viral: 10000 };
  const tweetDataStore = new Map();
  let lastShareContext = null;
  let renderTimer = 0;
  let netPayloads = 0;

  // Diagnostic breadcrumb so a broken data path is visible instead of silent.
  function markDiag() {
    try {
      document.documentElement.dataset.xvlNet = String(netPayloads);
      document.documentElement.dataset.xvlTweets = String(tweetDataStore.size);
    } catch (_) {}
  }

  const log = (...args) => DEBUG && console.log(`[${SCRIPT_ID}]`, ...args);

  // ---- XDS selectors (single source of truth) -------------------------------
  const SEL = {
    tweet: 'article',
    share: '[data-engagement-action="share"]',
    header: '.x-middot-group',
    authorHeader: '.x-middot-group, [data-testid="User-Name"]',
    quote: '[data-testid="quoteTweet"], [data-testid="card.wrapper"], [role="link"]:not(a)',
    caret: 'button[aria-label="更多"], button[aria-label="More"]',
    text: '.whitespace-pre-wrap.wrap-anywhere[lang]',
    group: '[role="group"]',
    engagement: '[data-engagement-action]',
    reply: '[data-engagement-action="reply"]',
    bookmark: [
      '[data-engagement-action="bookmark"]',
      'button[aria-label="书签"]', 'button[aria-label="Bookmark"]',
      'button[aria-label="已添加书签"]', 'button[aria-label="已加入书签"]',
      'button[aria-label="Remove bookmark"]', 'button[aria-label="Remove Bookmark"]',
      'button[aria-label^="从书签"]',
    ].join(', '),
    menu: '[role="menu"]',
    menuItem: '[role="menuitem"]',
    ownBadge: '.xvl-badge, .xvm-badge',
    ownBookmark: '.xvl-bookmark-count',
    ownMenuItem: '.xvl-copy-md-item, .xvm-copy-md-item',
  };

  function injectStyles() {
    if (document.getElementById(`${SCRIPT_ID}-style`)) return;
    const style = document.createElement('style');
    style.id = `${SCRIPT_ID}-style`;
    style.textContent = `
.${SCRIPT_ID}-badge, .xvl-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  margin-right: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 800;
  line-height: 18px;
  white-space: nowrap;
  user-select: none;
  cursor: default;
}
.xvl-badge::before { content: attr(data-prefix); }
.xvl-badge::after { content: attr(data-velocity) "/h"; }
.xvl-badge--normal { color: #16a34a; background: rgba(22, 163, 74, .22); }
.xvl-badge--trending { color: #c2410c; background: rgba(234, 88, 12, .23); }
.xvl-badge--viral { color: #dc2626; background: rgba(220, 38, 38, .23); }
.xvl-bookmark-count {
  margin-left: 4px;
  min-width: 0;
  color: rgb(83, 100, 113);
  font: inherit;
  line-height: inherit;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.xvl-copy-md-source {
  display: block;
  margin-top: 1px;
  color: rgb(113, 118, 123);
  font-size: 11px;
  font-weight: 400;
  opacity: .86;
}
.xvl-toast {
  position: fixed;
  left: 50%;
  bottom: 32px;
  z-index: 2147483647;
  transform: translate(-50%, 12px);
  opacity: 0;
  transition: opacity 160ms ease, transform 160ms ease;
  padding: 10px 16px;
  border-radius: 10px;
  background: rgba(15, 20, 25, .94);
  color: #fff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .35);
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  pointer-events: none;
}
.xvl-toast--show { opacity: 1; transform: translate(-50%, 0); }
.xvl-toast--error { background: rgba(185, 28, 28, .96); }
`;
    document.documentElement.appendChild(style);
  }

  // ---- network hook (page main world via unsafeWindow) -----------------------
  function isGraphqlRequest(input) {
    try {
      const value = typeof input === 'string' ? input : input?.url || input?.href;
      if (!value) return false;
      const url = new URL(value, location.href);
      return url.protocol === 'https:' && API_HOSTS.has(url.hostname) && GRAPHQL_RE.test(url.pathname);
    } catch (_) {
      return false;
    }
  }

  function ingestGraphql(payload) {
    netPayloads += 1;
    scanForTweets(payload);
    markDiag();
  }

  function installNetworkHook() {
    if (pageWindow.__xvlNetworkHookInstalled) return;
    pageWindow.__xvlNetworkHookInstalled = true;

    const originalFetch = pageWindow.fetch;
    pageWindow.fetch = async function xvlFetchHook(...args) {
      const response = await originalFetch.apply(this, args);
      if (response.ok && isGraphqlRequest(args[0])) {
        try {
          // The hook and the collector share a closure, even when Tampermonkey
          // exposes the page's fetch through a different Window object.
          response.clone().json().then(ingestGraphql).catch(() => {});
        } catch (_) {}
      }
      return response;
    };

    const xhrOpen = pageWindow.XMLHttpRequest?.prototype?.open;
    if (xhrOpen) {
      const graphqlRequests = new WeakMap();
      pageWindow.XMLHttpRequest.prototype.open = function xvlXhrOpen(method, url, ...rest) {
        const result = xhrOpen.call(this, method, url, ...rest);
        if (!graphqlRequests.has(this)) {
          this.addEventListener('load', function xvlXhrLoad() {
            if (!graphqlRequests.get(this) || this.status < 200 || this.status >= 300) return;
            try {
              ingestGraphql(this.responseType === 'json' ? this.response : JSON.parse(this.responseText));
            } catch (_) {}
          });
        }
        graphqlRequests.set(this, isGraphqlRequest(url));
        return result;
      };
    }
    log('network hook installed');
  }

  function scanForTweets(root) {
    const seen = new WeakSet();
    let changed = false;

    const walk = (obj) => {
      if (!obj || typeof obj !== 'object' || seen.has(obj)) return;
      seen.add(obj);

      const result = obj.tweet_results?.result || obj.tweetResult?.result;
      if (result) {
        const data = extractTweetData(result);
        if (data?.id) {
          mergeTweetData(data.id, data, 'api');
          changed = true;
        }
      }

      if (Array.isArray(obj)) {
        obj.forEach(walk);
      } else {
        Object.keys(obj).forEach((key) => {
          if (key !== 'tweet_results' && key !== 'tweetResult') walk(obj[key]);
        });
      }
    };

    walk(root);
    if (changed) scheduleRender();
  }

  function mergeTweetData(id, patch, source) {
    let record = tweetDataStore.get(id);
    if (!record) {
      record = { api: {}, dom: {} };
      tweetDataStore.set(id, record);
    }

    if (source === 'dom') {
      if (record.api.bookmarks === undefined && patch.bookmarks !== undefined && patch.bookmarks !== record.dom.bookmarks) {
        delete record.bookmarkOverride;
      }
      record.dom = patch;
      return;
    }

    record.api = {
      ...record.api,
      ...patch,
      urlMap: { ...record.api.urlMap, ...patch.urlMap },
    };
    if (patch.bookmarks !== undefined) delete record.bookmarkOverride;
  }

  function getTweetData(id) {
    const record = tweetDataStore.get(id);
    if (!record) return {};
    const data = { ...record.dom, ...record.api };
    if (record.bookmarkOverride !== undefined) data.bookmarks = record.bookmarkOverride;
    return data;
  }

  function extractTweetData(result) {
    const tweet = result?.tweet || result;
    if (!tweet) return null;
    const legacy = tweet.legacy || {};
    const details = tweet.details || {};
    const counts = tweet.counts || {};
    const note = tweet.note_tweet?.note_tweet_results?.result;

    if (legacy.promotedMetadata || tweet.promotedMetadata) return null;

    // Retweet wrapper (legacy schema only; the XDS schema inlines the original).
    const rtResult = legacy.retweeted_status_result?.result;
    if (rtResult) return extractTweetData(rtResult);

    const user = tweet.core?.user_results?.result || tweet.user_results?.result || {};
    const userLegacy = user.legacy || {};
    const userCore = user.core || {};

    const tweetId = tweet.rest_id || tweet.id || legacy.id_str;
    if (!tweetId) return null;

    // created_at: XDS ships epoch milliseconds in details.created_at_ms;
    // the pre-XDS schema used a "Wed Oct 05 ..." string in legacy.created_at.
    const created = new Date(Number(details.created_at_ms));
    const createdAt = created.getTime() > 0 ? created.toISOString() : (legacy.created_at || '');

    const num = (...vals) => {
      for (const value of vals) {
        if (value === '' || value == null) continue;
        const count = Number(value);
        if (Number.isFinite(count) && count >= 0) return count;
      }
      return undefined;
    };

    const urlMap = {};
    const normalizeExpanded = (raw) => raw ? raw.replace(/^https:\/\/twitter\.com\//, 'https://x.com/') : raw;
    const pushUrls = (list) => {
      for (const u of list || []) {
        if (u?.url && u.expanded_url) urlMap[u.url] = normalizeExpanded(u.expanded_url);
      }
    };
    pushUrls(tweet.url_entities);          // XDS
    pushUrls(legacy.entities?.urls);       // pre-XDS
    pushUrls(note?.entity_set?.urls);      // long-post entities

    // Media: XDS keeps them in media_entities2, pre-XDS in entities/extended_entities.
    const mediaList = [
      ...(tweet.media_entities2 || []),
      ...(legacy.extended_entities?.media || []),
      ...(legacy.entities?.media || []),
    ];
    for (const m of mediaList) {
      if (!m) continue;
      const shortUrl = m.url || m.expanded_url;
      if (!shortUrl) continue;
      const full = m.media_url_https || m.media_url || '';
      if (m.type === 'photo') {
        urlMap[shortUrl] = `![](${upgradeMediaUrl(full)})`;
      } else if (m.type === 'video' || m.type === 'animated_gif') {
        const mp4 = [...(m.video_info?.variants || [])]
          .filter((v) => v.content_type === 'video/mp4')
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        urlMap[shortUrl] = `[video](${mp4?.url || full})`;
      }
    }

    return withoutEmpty({
      id: String(tweetId),
      screenName: userCore.screen_name || userLegacy.screen_name || '',
      author: userCore.name || userLegacy.name || '',
      views: num(tweet.views?.count, legacy.ext_views?.count),
      likes: num(counts.favorite_count, legacy.favorite_count),
      retweets: num(counts.retweet_count, legacy.retweet_count),
      replies: num(counts.reply_count, legacy.reply_count),
      bookmarks: num(counts.bookmark_count, legacy.bookmark_count),
      createdAt,
      text: note?.text || details.full_text || legacy.full_text || '',
      urlMap,
    });
  }

  // ---- DOM readers ----------------------------------------------------------

  function isTweetArticle(article) {
    if (article.tagName !== 'ARTICLE') return false;
    // XDS markers, with the pre-XDS markers kept as a fallback so an A/B revert
    // to the old frontend does not silently disable the whole script.
    return !!(
      article.querySelector(SEL.share)
      || article.matches('[data-testid="tweet"]')
      || article.querySelector('[data-testid="User-Name"]')
      || article.querySelector('button[data-testid="bookmark"], button[data-testid="removeBookmark"]')
    );
  }

  function getTweetArticles(root = document) {
    if (root instanceof Element && root.matches?.('article')) {
      return isTweetArticle(root) ? [root] : [];
    }
    return [...root.querySelectorAll?.('article') || []].filter(isTweetArticle);
  }

  function belongsToPost(el, article) {
    if (el.closest('article') !== article) return false;
    const quote = el.closest(SEL.quote);
    return !quote || !article.contains(quote);
  }

  function getStatusLinks(article) {
    return [...article.querySelectorAll('a[href*="/status/"]')].filter((link) => {
      if (!belongsToPost(link, article) || !API_HOSTS.has(link.hostname)) return false;
      if (!STATUS_PATH.test(link.pathname)) return false;
      return !link.closest(`${SEL.text}, [data-testid="tweetText"]`);
    });
  }

  function getTweetPermalink(article) {
    const links = getStatusLinks(article);
    return findDateLink(article, links) || (links.length === 1 ? links[0] : null);
  }

  function getTweetId(link) {
    return link?.pathname.match(STATUS_PATH)?.[1] || null;
  }

  function findHeaderRow(article) {
    // Timeline cards put the name/handle/time inside .x-middot-group, whose parent
    // is the flex row that also holds the caret.
    const middot = [...article.querySelectorAll(SEL.header)].find((el) => belongsToPost(el, article));
    if (middot) {
      let el = middot.parentElement;
      for (let i = 0; el && el !== article && i < 3; i++) {
        const cs = getComputedStyle(el);
        if (cs.display === 'flex' && cs.flexDirection === 'row') return el;
        el = el.parentElement;
      }
    }

    // Tweet detail page: the focal tweet has NO .x-middot-group. Its header is
    // "div.flex.items-start.justify-between" holding a stacked name/handle block
    // plus the caret. Walk up from the caret to the first row that also contains
    // the display-name link.
    const caret = article.querySelector(SEL.caret);
    if (caret) {
      const nameLink = [...article.querySelectorAll('a[href^="/"]')]
        .find((a) => {
          const t = a.textContent.trim();
          return t && !t.startsWith('@');
        });
      let el = caret.parentElement;
      for (let i = 0; el && el !== article && i < 6; i++) {
        if (nameLink && el.contains(nameLink)) {
          const cs = getComputedStyle(el);
          if (cs.display === 'flex' && cs.flexDirection === 'row') return el;
        }
        el = el.parentElement;
      }
    }

    // Legacy layout fallback (pre-XDS DOM, still served to some accounts).
    let el = caret?.parentElement || article.querySelector('[data-testid="User-Name"]')?.parentElement;
    while (el && el !== article) {
      const cs = getComputedStyle(el);
      if (cs.display === 'flex' && cs.flexDirection === 'row' && el.querySelector('[data-testid="User-Name"]')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function findBookmarkButton(article) {
    // XDS puts data-engagement-action on the WRAPPER div, not the control, so
    // resolve wrapper -> inner button. [role=group] scoping avoids picking a
    // bookmark control inside a quoted tweet.
    const bar = article.querySelector(SEL.group);
    const scope = bar || article;
    const wrap = scope.querySelector('[data-engagement-action="bookmark"]');
    const fromWrap = wrap?.querySelector('button, [role="button"]') || (wrap?.matches?.('button, [role="button"]') ? wrap : null);
    if (fromWrap) return fromWrap;
    const labelled = [...(scope.querySelectorAll('button, [role="button"]') || [])]
      .find((b) => !b.closest('[data-engagement-action]')?.matches('[data-engagement-action="reply"],[data-engagement-action="retweet"],[data-engagement-action="like"],[data-engagement-action="share"]')
        && /书签|bookmark/i.test(b.getAttribute('aria-label') || ''));
    if (labelled) return labelled;
    // Last resort: the only button in the bar that is not inside any known
    // engagement wrapper and has no aria-haspopup (that would be the caret/3rd-party).
    return [...(bar?.querySelectorAll('button') || [])].find((b) => {
      const w = b.closest('[data-engagement-action]');
      return !w || w.getAttribute('data-engagement-action') === 'bookmark';
    }) || null;
  }

  function getArticleFallbackData(article, permalink, id) {
    const groupLabel = article.querySelector(SEL.group)?.getAttribute('aria-label') || '';
    const counts = parseActionGroupLabel(groupLabel);
    const dateLink = findDateLink(article, permalink ? [permalink] : []);
    const createdAt = dateLink ? relativeTimeToIso(dateLink.textContent) : '';
    const text = article.querySelector(SEL.text)?.innerText?.trim()
      || article.querySelector('[data-testid="tweetText"]')?.innerText?.trim() || '';
    const { author, screenName } = readAuthor(article, permalink);
    const time = permalink?.querySelector('time[datetime]')?.getAttribute('datetime') || createdAt;

    return {
      id,
      screenName,
      author,
      createdAt: time,
      text,
      ...counts,
    };
  }

  function findDateLink(article, links) {
    // Timeline cards: "8小时", "11月23日", "Mar 5", "2024年3月5日".
    // Tweet detail pages prefix a clock: "21:26 · 2026年11月24日",
    // "9:26 PM · Nov 24, 2026", "21:26 · 11月24日".
    const TIME = '(?:\\d{1,2}:\\d{2}(?:\\s*(?:AM|PM|上午|下午))?)';
    const DATE = '(?:\\d+\\s*(?:秒|分钟|小时|天|周|s|m|h|d|w)\\S*|[A-Za-z]{3,}\\s+\\d{1,2}(?:,?\\s*\\d{4})?|\\d{4}年\\d{1,2}月\\d{1,2}日|\\d{1,2}月\\d{1,2}日)';
    const re = new RegExp(`^\\s*(?:${TIME}\\s*[·•,]?\\s*${DATE}|${DATE}|${TIME})\\s*$`, 'i');
    const dates = links.filter((link) => link.querySelector('time[datetime]') || re.test(link.textContent));
    const body = article.querySelector(`${SEL.text}, [data-testid="tweetText"]`);
    const headerDate = dates.find((link) => {
      const header = link.closest(SEL.authorHeader);
      return header && belongsToPost(header, article)
        && (!body || (link.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    const postId = location.pathname.match(STATUS_PATH)?.[1];
    return headerDate
      || dates.find((link) => postId && getTweetId(link) === postId)
      || dates[0] || null;
  }

  function relativeTimeToIso(raw) {
    // Low-precision fallback only. GraphQL created_at is the precise source and
    // always wins when present.
    if (!raw) return '';
    let s = raw.trim();

    // Detail pages prefix the date with a clock: "21:26 · 2026年11月24日".
    let hours = null;
    let minutes = null;
    let meridiem = '';
    const tm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|上午|下午)?\s*[·•,]?\s*/i);
    if (tm) {
      hours = Number(tm[1]);
      minutes = Number(tm[2]);
      meridiem = (tm[3] || '').toUpperCase();
      s = s.slice(tm[0].length).trim();
    }

    const withTime = (d) => {
      if (hours !== null && !Number.isNaN(d.getTime())) {
        let h = hours;
        if (meridiem === 'PM' || meridiem === '下午') { if (h < 12) h += 12; }
        else if (meridiem === 'AM' || meridiem === '上午') { if (h === 12) h = 0; }
        d.setHours(h, minutes || 0, 0, 0);
      }
      return d.toISOString();
    };

    let m = s.match(/^(\d+)\s*(秒|分钟|小时|天|周|seconds?|minutes?|hours?|days?|weeks?|sec|min|s|m|h|d|w)(?![a-z])/i);
    if (m) {
      const n = Number(m[1]);
      const u = m[2].toLowerCase();
      const ms = /^(秒|s)/.test(u) ? 1000
        : /^(分钟|min|m)/.test(u) ? 60000
        : /^(小时|h)/.test(u) ? 3600000
        : /^(天|d)/.test(u) ? 86400000
        : 604800000;
      return new Date(Date.now() - n * ms).toISOString();
    }
    // Absolute short date without a year: assume the current year, and if that
    // lands in the future, it belongs to the previous year.
    m = s.match(/^(\d{1,2})月(\d{1,2})日$/) || s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/) || s.match(/^([A-Za-z]{3,})\s+(\d{1,2})(?:,?\s*(\d{4}))?$/);
    if (m) {
      const now = new Date();
      let month; let day; let year;
      if (m[0].includes('年')) {
        month = Number(m[2]) - 1; day = Number(m[3]); year = Number(m[1]);
      } else if (m[0].includes('月')) {
        month = Number(m[1]) - 1; day = Number(m[2]); year = now.getFullYear();
      } else {
        month = new Date(`${m[1]} 1 2000`).getMonth(); day = Number(m[2]); year = m[3] ? Number(m[3]) : now.getFullYear();
      }
      if (Number.isNaN(month)) return '';
      let d = new Date(year, month, day);
      if (!m[3] && !m[0].includes('年') && d.getTime() > now.getTime()) d = new Date(year - 1, month, day);
      return withTime(d);
    }
    return '';
  }

  function readAuthor(article, permalink) {
    const path = permalink?.pathname.match(/^\/([^/]+)\/status\//);
    const handle = path?.[1] === 'i' ? '' : (path?.[1] || '');
    const header = permalink?.closest(SEL.authorHeader)
      || [...article.querySelectorAll(SEL.authorHeader)].find((el) => belongsToPost(el, article));
    const scope = header || article;
    const links = [...scope.querySelectorAll('a[href^="/"]')].filter((link) =>
      belongsToPost(link, article) && (!handle || link.pathname.toLowerCase() === `/${handle.toLowerCase()}`)
    );
    const handleLink = links.find((a) => /^@/.test(a.textContent.trim()));
    const nameLink = links.find((a) => !/^@/.test(a.textContent.trim()) && a.textContent.trim());
    return {
      screenName: handle || handleLink?.textContent.trim().replace(/^@/, '')
        || nameLink?.getAttribute('href')?.slice(1).split('/')[0]
        || '',
      author: nameLink?.textContent.trim().split('\n')[0] || '',
    };
  }

  function parseActionGroupLabel(label) {
    const out = {};
    if (!label) return out;
    // XDS zh-CN joins counters with the ideographic 、 (U+3001); older builds used ，or , .
    const ungrouped = label.replace(/(\d)[,，](?=\d{3}(?!\d))/g, '$1');
    for (const part of ungrouped.split(/[，,、]/)) {
      const value = parseHumanNumber(part);
      if (!Number.isFinite(value)) continue;
      if (/回复|repl/i.test(part)) out.replies = value;
      else if (/转帖|转发|repost|retweet/i.test(part)) out.retweets = value;
      else if (/喜欢|赞|like/i.test(part)) out.likes = value;
      else if (/书签|收藏|bookmark/i.test(part)) out.bookmarks = value;
      else if (/观看|查看|view/i.test(part)) out.views = value;
    }
    return out;
  }

  function parseHumanNumber(raw) {
    if (!raw) return NaN;
    const m = String(raw).match(/(\d+(?:\.\d+)?)(?:\s*(万|萬|亿|億|[kmb](?![a-z])))?/i);
    if (!m) return NaN;
    const n = Number.parseFloat(m[1]);
    const unit = (m[2] || '').toLowerCase();
    const mult = unit === '万' || unit === '萬' ? 10000
      : unit === '亿' || unit === '億' ? 100000000
      : unit === 'k' ? 1000
      : unit === 'm' ? 1000000
      : unit === 'b' ? 1000000000
      : 1;
    return Math.round(n * mult);
  }

  // ---- scoring / formatting (unchanged) ------------------------------------

  function computeScore(data) {
    const created = new Date(data.createdAt || 0).getTime();
    if (!created || !data.views) return null;
    const hours = Math.max((Date.now() - created) / 3600000, 0.1);
    const velocity = data.views / hours;
    const engagement = (data.likes || 0) + (data.retweets || 0) + (data.replies || 0);
    const engagementRate = data.views > 0 ? engagement / data.views : 0;
    const rtRatio = data.likes > 0 ? (data.retweets || 0) / data.likes : 0;
    const bmRatio = data.likes > 0 ? (data.bookmarks || 0) / data.likes : 0;
    const score = Math.round(
      Math.min(velocity / 50000, 1) * 40
      + Math.min(engagementRate / 0.1, 1) * 25
      + Math.min(rtRatio / 0.5, 1) * 20
      + Math.min(bmRatio / 0.3, 1) * 15
    );
    return { velocity, score: Math.min(score, 100) };
  }

  function formatCompact(n) {
    const v = Number(n) || 0;
    if (v >= 100000000) return `${stripZero(v / 100000000)}亿`;
    if (v >= 10000) return `${stripZero(v / 10000)}万`;
    if (v >= 1000) return `${stripZero(v / 1000)}k`;
    return String(Math.round(v));
  }

  function stripZero(v) {
    return v >= 100 ? Math.round(v).toString() : v.toFixed(1).replace(/\.0$/, '');
  }

  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = window.setTimeout(() => {
      renderTimer = 0;
      renderAll();
    }, 120);
  }

  function renderAll() {
    injectStyles();
    for (const article of getTweetArticles()) {
      const permalink = getTweetPermalink(article);
      const id = getTweetId(permalink);
      if (!id) continue;
      const fallback = getArticleFallbackData(article, permalink, id);
      mergeTweetData(id, withoutEmpty(fallback), 'dom');
      const data = getTweetData(id);
      renderBadge(article, data);
      renderBookmarkCount(article, data);
    }
    markDiag();
  }

  function withoutEmpty(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== '' && value != null));
  }

  function renderBadge(article, data) {
    const score = computeScore(data);
    if (!score) {
      article.querySelector('.xvl-badge')?.remove();
      return;
    }
    const { velocity } = score;
    const tier = velocity >= thresholds.viral ? 'viral' : velocity >= thresholds.trending ? 'trending' : 'normal';
    const prefix = tier === 'viral' ? '🔥' : tier === 'trending' ? '🚀' : '🌱';
    const headerRow = findHeaderRow(article);
    if (!headerRow) return;
    if (headerRow.querySelector(':scope > .xvm-badge')) return;

    let badge = headerRow.querySelector(':scope > .xvl-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'xvl-badge';
      let before = headerRow.querySelector(SEL.caret);
      while (before && before.parentElement !== headerRow) before = before.parentElement;
      headerRow.insertBefore(badge, before);
    }
    const className = `xvl-badge xvl-badge--${tier}`;
    if (badge.className !== className) badge.className = className;
    if (badge.dataset.prefix !== prefix) badge.dataset.prefix = prefix;
    const displayVelocity = formatCompact(velocity);
    if (badge.dataset.velocity !== displayVelocity) badge.dataset.velocity = displayVelocity;
    const title = [
      `浏览量: ${(data.views || 0).toLocaleString()}`,
      `点赞: ${(data.likes || 0).toLocaleString()}`,
      `转发: ${(data.retweets || 0).toLocaleString()}`,
      `回复: ${(data.replies || 0).toLocaleString()}`,
      `书签: ${(data.bookmarks || 0).toLocaleString()}`,
      `流速: ${displayVelocity}/h`,
      `爆帖指数: ${score.score}/100`,
    ].join('\n');
    if (badge.title !== title) badge.title = title;
  }

  function renderBookmarkCount(article, data) {
    const count = Number(data.bookmarks || 0);
    const button = findBookmarkButton(article);
    if (!button) return;

    if (button.querySelector('.xvm-bookmark-count')) return;

    let node = button.querySelector('.xvl-bookmark-count');
    if (!count) {
      node?.remove();
      return;
    }
    if (!node) {
      node = document.createElement('span');
      node.className = 'xvl-bookmark-count';
      // XDS buttons: <button><span.x-engagement-pill><svg/></span></button>.
      // Append next to the icon inside the pill so it lines up with the like count.
      const pill = button.querySelector('.x-engagement-pill') || button.querySelector(':scope > div') || button;
      pill.appendChild(node);
    }
    const text = formatCompact(count);
    const title = `${count.toLocaleString()} 书签`;
    if (node.textContent !== text) node.textContent = text;
    if (node.title !== title) node.title = title;
  }

  // ---- interactions ---------------------------------------------------------

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || document.body?.dataset.xUserscriptPicker) return;
    const shareButton = event.target.closest?.(
      `${SEL.share}, button[aria-label*="分享"], button[aria-label*="Share"], button[aria-label*="共有"], button[aria-label*="share"]`
    );
    if (shareButton) {
      const article = shareButton.closest('article');
      if (article && isTweetArticle(article)) {
        const trigger = event.target.closest('button, [role="button"]')
          || shareButton.querySelector('button, [role="button"]') || shareButton;
        if (trigger.getAttribute('aria-expanded') !== 'true') {
          const permalink = getTweetPermalink(article);
          lastShareContext = {
            article, permalink, trigger,
            previousMenus: new Set(document.querySelectorAll(SEL.menu)),
            startedAt: Date.now(),
          };
          scheduleMenuInject();
        }
      }
    }

    const bookmark = event.target.closest?.('button');
    if (bookmark && isBookmarkControl(bookmark)) {
      const article = bookmark.closest('article');
      const id = article && getTweetId(getTweetPermalink(article));
      const record = tweetDataStore.get(id);
      if (record) {
        const isRemoving = /已添加书签|已加入书签|从书签|remove/i.test(bookmark.getAttribute('aria-label') || '')
          || bookmark.getAttribute('data-testid') === 'removeBookmark'
          || bookmark.getAttribute('aria-pressed') === 'true';
        record.bookmarkOverride = Math.max(0, (getTweetData(id).bookmarks || 0) + (isRemoving ? -1 : 1));
        window.setTimeout(scheduleRender, 100);
      }
    }
  }, true);

  function isBookmarkControl(el) {
    if (el.matches('button[data-testid="bookmark"], button[data-testid="removeBookmark"]')) return true;
    const action = el.closest(SEL.engagement)?.getAttribute('data-engagement-action');
    if (action) return action === 'bookmark';
    const label = el.getAttribute('aria-label') || '';
    return /书签|bookmark/i.test(label);
  }

  // ---- share-menu injection ------------------------------------------------

  let menuPollTimer = 0;
  const copyContexts = new WeakMap();

  /**
   * Base UI mounts an EMPTY [role=menu] container first and fills the items in a
   * later commit, so a MutationObserver callback on the container sees zero
   * menuitems. Poll until the menu is populated (or 2s elapses) before injecting.
   */
  function scheduleMenuInject(menuEl) {
    const context = lastShareContext;
    if (!context || menuPollTimer || Date.now() - context.startedAt > 2000) return;
    const tick = () => {
      menuPollTimer = 0;
      if (context !== lastShareContext) {
        scheduleMenuInject();
        return;
      }
      if (!context.article.isConnected) return;
      const menuId = context.trigger.getAttribute('aria-controls');
      const current = [...document.querySelectorAll(SEL.menu)];
      const menus = menuEl?.isConnected ? [menuEl, ...current.filter((menu) => menu !== menuEl)] : current;
      for (const menu of menus) {
        const belongsToTrigger = menuId && menu.id ? menu.id === menuId : !context.previousMenus.has(menu);
        if (!belongsToTrigger) continue;
        if (!menu.querySelectorAll(SEL.menuItem).length) continue;
        if (!isShareMenu(menu)) continue;
        injectCopyMarkdownItem(menu, context);
        return;
      }
      if (Date.now() - context.startedAt > 2000) return;
      menuPollTimer = window.setTimeout(tick, 80);
    };
    tick();
  }

  function buildCopyIcon(refSvg) {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('width', refSvg?.getAttribute('width') || '1.75em');
    icon.setAttribute('height', refSvg?.getAttribute('height') || '1.75em');
    icon.setAttribute('aria-hidden', 'true');
    icon.style.fill = 'currentColor';
    icon.innerHTML = '<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm2 3v8h2v-5l2 3 2-3v5h2V8H9.5L8 10.5 6.5 8H5zm11 0v4h-2l3 4 3-4h-2V8h-2z"/>';
    return icon;
  }

  /**
   * Put the icon back and clear text another injector may have dumped into the
   * icon container. XDS items are <span.icon><svg/></span><div.label>TEXT</div>.
   */
  function ensureMenuIcon(item) {
    const iconBox = [...item.children].find((c) => c.tagName === 'SPAN');
    if (!iconBox) return;
    [...iconBox.childNodes].forEach((n) => { if (n.nodeType === 3) n.remove(); });
    const svg = iconBox.querySelector('svg');
    if (svg) svg.replaceWith(buildCopyIcon(svg));
    else iconBox.appendChild(buildCopyIcon());
  }

  function bindCopyHandler(item, menu, context) {
    copyContexts.set(item, { menu, context });
    if (item.dataset.xvlBound === '1') return;
    item.dataset.xvlBound = '1';
    item.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const binding = copyContexts.get(item);
      const markdown = buildTweetMarkdown(binding.context);
      const ok = await copyToClipboard(markdown);
      showToast(ok ? '已复制为 Markdown' : '复制失败', ok ? 'success' : 'error');
      if (ok) closeShareMenu(binding.menu, binding.context);
    });
  }

  function injectCopyMarkdownItem(menuEl, context) {
    if (!context.article.isConnected) return;
    const items = [...menuEl.querySelectorAll(SEL.menuItem)];
    if (!items.length) return;

    // Another tool may already have added a (possibly broken) "复制为 Markdown"
    // entry. Take that one over instead of stacking a second copy.
    const foreign = items.find((i) => /复制为\s*Markdown/i.test(i.textContent || ''));
    if (foreign) {
      if (foreign.dataset.xvlBound !== '1') {
        foreign.classList.add('xvl-copy-md-item');
        ensureMenuIcon(foreign);
        setMenuItemLabel(foreign, '复制为 Markdown', 'X Viral Monitor Lite');
      }
      bindCopyHandler(foreign, menuEl, context);
      return;
    }

    if (menuEl.querySelector(SEL.ownMenuItem)) return;

    const nativeItems = items.filter((item) => !item.matches(`${SEL.ownMenuItem}, .xvm-starchart-item`));
    const template = nativeItems[nativeItems.length - 1] || items[items.length - 1];
    const clone = template.cloneNode(true);
    clone.classList.add('xvl-copy-md-item');
    clone.removeAttribute('data-testid');
    clone.removeAttribute('id');
    clone.removeAttribute('aria-labelledby');
    clone.querySelectorAll('[data-testid]').forEach((el) => el.removeAttribute('data-testid'));
    clone.querySelectorAll('.xvl-copy-md-source, .xvm-copy-md-source').forEach((el) => el.remove());

    ensureMenuIcon(clone);
    setMenuItemLabel(clone, '复制为 Markdown', 'X Viral Monitor Lite');
    bindCopyHandler(clone, menuEl, context);

    items[items.length - 1].parentElement.appendChild(clone);
  }

  function setMenuItemLabel(item, title, source) {
    // 1) XDS: the label is the last direct child <div> of the item.
    const labelDiv = [...item.children].reverse().find((c) => c.tagName === 'DIV');
    if (labelDiv) {
      labelDiv.textContent = '';
      labelDiv.append(
        Object.assign(document.createElement('span'), { textContent: title }),
        document.createElement('br'),
        Object.assign(document.createElement('span'), { className: 'xvl-copy-md-source', textContent: source }),
      );
      return;
    }
    // 2) Any descendant div that is not the icon wrapper.
    const anyDiv = [...item.querySelectorAll('div')].find((d) => !d.querySelector('svg'));
    if (anyDiv) {
      anyDiv.textContent = '';
      anyDiv.append(
        Object.assign(document.createElement('span'), { textContent: title }),
        document.createElement('br'),
        Object.assign(document.createElement('span'), { className: 'xvl-copy-md-source', textContent: source }),
      );
      return;
    }
    // 3) Legacy flat layout: the leaf span that holds the text.
    const leaf = [...item.querySelectorAll('span')]
      .find((span) => span.children.length === 0 && span.textContent.trim());
    if (leaf) {
      leaf.textContent = '';
      leaf.append(
        Object.assign(document.createElement('span'), { textContent: title }),
        document.createElement('br'),
        Object.assign(document.createElement('span'), { className: 'xvl-copy-md-source', textContent: source })
      );
      return;
    }
    item.textContent = title;
  }

  function isShareMenu(menuEl) {
    // Must contain a share-ish native item. Exclude the copied-Markdown item's own
    // text so our injection never makes a menu look like a share menu.
    const native = [...menuEl.querySelectorAll(SEL.menuItem)]
      .filter((i) => !i.matches(SEL.ownMenuItem));
    const text = native.map((i) => i.textContent).join(' ').toLowerCase();
    return /复制链接|复制帖子链接|复制帖子|copy link|copy post link|copy post|帖子分享途径|share via/i.test(text);
  }

  function buildTweetMarkdown(ctx) {
    const article = ctx.article;
    const permalink = ctx.permalink || getTweetPermalink(article);
    const id = getTweetId(permalink);
    const fallback = getArticleFallbackData(article, permalink, id);
    if (id) mergeTweetData(id, withoutEmpty(fallback), 'dom');
    const data = id ? getTweetData(id) : fallback;
    const screenName = data.screenName || '';
    const author = data.author || screenName || 'X user';
    const url = permalink ? `https://x.com${permalink.pathname}` : location.href;
    const created = data.createdAt ? new Date(data.createdAt) : null;
    const createdText = created && !Number.isNaN(created.getTime()) ? created.toLocaleString() : '';

    let body = data.text || '';
    for (const [shortUrl, expanded] of Object.entries(data.urlMap || {})) {
      if (!shortUrl || !expanded) continue;
      const replacement = /^!\[\]/.test(expanded) || /^\[video\]/.test(expanded) ? `\n\n${expanded}` : expanded;
      body = body.split(shortUrl).join(replacement);
    }
    body = body.trim() || article?.querySelector(SEL.text)?.innerText?.trim() || '';

    const media = article ? collectArticleMediaMarkdown(article, body) : [];
    const parts = [];
    if (body) parts.push(body);
    if (media.length) parts.push(media.join('\n'));
    parts.push(`\n---`);
    parts.push(`作者: [${author}${screenName ? ` (@${screenName})` : ''}](https://x.com/${screenName || ''})`);
    if (createdText) parts.push(`时间: ${createdText}`);
    parts.push(`链接: ${url}`);
    return parts.join('\n\n').replace(/\n{4,}/g, '\n\n\n').trim();
  }

  function collectArticleMediaMarkdown(article, existingText) {
    const out = [];
    const seen = new Set();
    for (const img of article.querySelectorAll('img[src*="pbs.twimg.com/media"], img[src*="pbs.twimg.com/card_img"], img[src*="pbs.twimg.com/amplify_video_thumb"]')) {
      const url = upgradeMediaUrl(img.currentSrc || img.src);
      if (!url || seen.has(url) || existingText.includes(url)) continue;
      seen.add(url);
      out.push(`![](${url})`);
    }
    return out;
  }

  function upgradeMediaUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      if (u.hostname === 'pbs.twimg.com' && u.pathname.includes('/media/')) {
        u.searchParams.set('name', 'large');
      }
      return u.toString();
    } catch (_) {
      return url;
    }
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        return document.execCommand('copy');
      } catch (_) {
        return false;
      } finally {
        ta.remove();
      }
    }
  }

  function showToast(text, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `xvl-toast ${type === 'error' ? 'xvl-toast--error' : ''}`;
    toast.textContent = text;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('xvl-toast--show'));
    setTimeout(() => {
      toast.classList.remove('xvl-toast--show');
      setTimeout(() => toast.remove(), 180);
    }, 1800);
  }

  function closeShareMenu(menu, context) {
    const trigger = context.trigger;
    if (lastShareContext !== context || !menu.isConnected || !trigger.isConnected) return;
    if (document.body?.dataset.xUserscriptPicker || trigger.getAttribute('aria-expanded') === 'false') return;
    const menuId = trigger.getAttribute('aria-controls');
    if (menuId && menu.id && menuId !== menu.id) return;
    const focused = document.activeElement;
    const target = menu.contains(focused) ? focused : menu.querySelector(SEL.menuItem) || menu;
    target.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
    }));
  }

  function watchDom() {
    const observer = new MutationObserver((mutations) => {
      let shouldRender = false;
      for (const m of mutations) {
        if (m.type === 'attributes') {
          if (m.target.matches(SEL.group) && m.target.closest(SEL.tweet)) shouldRender = true;
          continue;
        }
        for (const node of m.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches?.('article') || node.querySelector?.('article')) {
            shouldRender = true;
          }
          const menus = [
            ...(node.matches?.(SEL.menu) ? [node] : []),
            ...(node.querySelectorAll?.(SEL.menu) || []),
          ];
          menus.forEach(scheduleMenuInject);
        }
      }
      if (shouldRender) scheduleRender();
    });
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'],
    });
  }

  function initWhenReady() {
    injectStyles();
    watchDom();
    scheduleRender();
    setInterval(scheduleRender, 2500);
  }

  installNetworkHook();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWhenReady, { once: true });
  } else {
    initWhenReady();
  }
})();
