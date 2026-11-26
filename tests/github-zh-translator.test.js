const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const scriptPath = path.join(__dirname, '..', 'github-zh-translator.user.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const api = require(scriptPath);

test('metadata header is valid and points to hahapkpk/tools without template secrets', () => {
  assert.doesNotMatch(source, /\{\{SECRET_/);
  assert.match(source, /@updateURL\s+https:\/\/raw\.githubusercontent\.com\/hahapkpk\/tools\/main\/github-zh-translator\.user\.js/);
  assert.match(source, /@downloadURL\s+https:\/\/raw\.githubusercontent\.com\/hahapkpk\/tools\/main\/github-zh-translator\.user\.js/);
  assert.match(source, /@license\s+GPL-3\.0/);
  assert.doesNotMatch(source, /edge\.microsoft\.com\/translate\/auth/);
  assert.doesNotMatch(source, /transmart\.qq\.com/);
  assert.doesNotMatch(source, /fanyi\.youdao\.com\/translate/);
  assert.doesNotMatch(source, /location\.reload\(\)/);
});

test('dictionary translates classic and 2026 GitHub UI terms with punctuation normalization', () => {
  assert.equal(api.dictLookup('Code'), '代码');
  assert.equal(api.dictLookup('Pull requests'), '拉取请求');
  assert.equal(api.dictLookup('Security and quality'), '安全与质量');
  assert.equal(api.dictLookup('Backlog'), '待办积压');
  assert.equal(api.dictLookup('Relationships'), '关联关系');
  assert.equal(api.dictLookup('Metadata'), '元数据');
  assert.equal(api.dictLookup('Open in GitHub Copilot app'), '在 GitHub Copilot 应用中打开');
  assert.equal(api.dictLookup('Which remote URL should I use?'), '应使用哪个远程 URL？');
  assert.equal(api.dictLookup('Copy URL to clipboard'), '复制 URL 到剪贴板');
  assert.equal(api.dictLookup('Installation'), '安装');
  assert.equal(api.dictLookup('Summary'), '摘要');
  assert.equal(api.dictLookup('Here’s what’s popular on GitHub today...'), '以下是今天 GitHub 上的热门内容…');
  assert.equal(api.dictLookup("Here's what's popular on GitHub today..."), '以下是今天 GitHub 上的热门内容…');
  // 2-char all-uppercase acronyms should not accidentally hit lowercase dictionary entries
  assert.equal(api.dictLookup('ON'), '');
  assert.equal(api.dictLookup('On'), '开启');
});

test('pattern rules translate counts, relative times, GMT timestamps, and PR checks', () => {
  assert.equal(api.patternTranslate('1081 Branches'), '1081 个分支');
  assert.equal(api.patternTranslate('180 Tags'), '180 个标签');
  assert.equal(api.patternTranslate('+ 136 releases'), '+ 136 个发行版');
  assert.equal(api.patternTranslate('21,814 Commits'), '21,814 个提交');
  assert.equal(api.patternTranslate('187 / 204 checks OK'), '187 / 204 项检查通过');
  assert.equal(api.patternTranslate('1 participant'), '1 位参与者');
  assert.equal(api.patternTranslate('10 hours ago'), '10 小时前');
  assert.equal(api.patternTranslate('opened 2d ago'), '打开于 2天前');
  assert.equal(api.patternTranslate('Nov 26, 2026, 05:52 GMT+8'), '2026年11月26日 05:52 GMT+8');
  assert.equal(api.patternTranslate("Actions for gaearon's comment, 2 days ago"), '对 gaearon 评论的操作');
  assert.equal(api.patternTranslate('main branch'), 'main 分支');
});

test('title translation handles standalone and repo-scoped titles', () => {
  assert.equal(api.translateTitleText('Issues · react/react'), '议题 · react/react');
  assert.equal(api.translateTitleText('Issues · react/react · GitHub'), '议题 · react/react · GitHub');
  assert.equal(api.translateTitleText('Pull requests · react/react'), '拉取请求 · react/react');
  assert.equal(api.translateTitleText('Explore GitHub'), '探索 GitHub');
});

test('repoKey distinguishes repository routes from top-level GitHub pages', () => {
  assert.equal(api.repoKey('/react/react'), 'react/react');
  assert.equal(api.repoKey('/react/react/issues/38396'), 'react/react');
  assert.equal(api.repoKey('/explore'), '');
  assert.equal(api.repoKey('/settings/profile'), '');
  assert.equal(api.repoKey('/features/copilot'), '');
});

test('translatability and identifier filters protect versions, URLs, files, and slugs', () => {
  assert.equal(api.isTranslatable('v2.18.9'), false);
  assert.equal(api.isTranslatable('https://github.com/react/react'), false);
  assert.equal(api.isTranslatable('package.json'), false);
  assert.equal(api.isTranslatable('已翻译'), false);
  assert.equal(api.isTranslatable('The library for web and native user interfaces.'), true);
  assert.equal(api.isIdentifierLike('react/react'), true);
  assert.equal(api.isIdentifierLike('The library for web'), false);
});

test('2026 selectors match React/Primer DOM and skipSelectors preserve dropdowns while skipping search/files', () => {
  assert.match(api.REPO_DESC_SELECTORS, /sidebarSection/);
  assert.match(api.REPO_DESC_SELECTORS, /\.BorderGrid-cell p\.f4/);
  assert.match(api.README_SELECTORS, /SharedMarkdownContent/);
  assert.match(api.README_SELECTORS, /readmeContainer/);
  assert.match(api.README_SELECTORS, /blobContentSectionMarkdown/);
  assert.match(api.ISSUE_SELECTORS, /issue-viewer-comments-container/);
  assert.match(api.ISSUE_SELECTORS, /\.comment-body\.markdown-body/);
  assert.doesNotMatch(api.CFG.skipSelectors, /(^|,)\s*\[role="listbox"\]\s*(,|$)/);
  assert.match(api.CFG.skipSelectors, /query-builder \[role="listbox"\]/);
  assert.match(api.CFG.skipSelectors, /react-directory-row-name-cell/);
  assert.match(api.CFG.skipSelectors, /Breadcrumbs/);
});

test('About and README auto-translation are enabled by default while Issue stays opt-in', () => {
  assert.equal(api.autoPrefs.about, true);
  assert.equal(api.autoPrefs.readme, true);
  assert.equal(api.autoPrefs.issue, false);
  assert.equal(api.ssGet('about'), true);
  assert.equal(api.ssGet('readme'), true);
  assert.equal(api.ssGet('issue'), false);
});

test('timeout or network error trips provider circuit breaker immediately', () => {
  Object.keys(api.providerState).forEach((k) => { delete api.providerState[k]; });
  try {
    api.providerFail('googleClient', new Error('timeout'));
    assert.equal(api.providerAvailable('googleClient'), false);
  } finally {
    Object.keys(api.providerState).forEach((k) => { delete api.providerState[k]; });
  }
});

test('bingWebBatch translates multiple short items in a single batched request', async () => {
  const origGM = global.GM_xmlhttpRequest;
  let postCount = 0;
  try {
    global.GM_xmlhttpRequest = ({ method, url, onload }) => {
      if (method === 'GET' && url.includes('www.bing.com/translator')) {
        onload({ status: 200, responseText: 'IG:"ABCDEF" data-iid="translator.5023" params_AbusePreventionHelper = [12345,"tok",36000];' });
        return;
      }
      if (method === 'POST' && url.includes('ttranslatev3')) {
        postCount += 1;
        onload({ status: 200, responseText: JSON.stringify([{ translations: [{ text: '第一句。\n|||\n第二句。' }] }]) });
        return;
      }
      onload({ status: 500, responseText: '' });
    };
    const res = await api.PROVIDERS.bingWeb(['First sentence.', 'Second sentence.']);
    assert.deepEqual(res, ['第一句。', '第二句。']);
    assert.equal(postCount, 1);
  } finally {
    global.GM_xmlhttpRequest = origGM;
  }
});

test('dedupeScopes removes nested duplicate markdown containers', () => {
  const inner = { contains: (other) => other === inner };
  const outer = { contains: (other) => other === outer || other === inner };
  const sibling = { contains: (other) => other === sibling };
  const result = api.dedupeScopes([outer, inner, sibling]);
  assert.deepEqual(result, [outer, sibling]);
});

test('parseYoudaoMobileHtml extracts translated text cleanly', () => {
  const html = '<html><body><ul id="translateResult"><li>你好，世界 &amp; GitHub</li></ul></body></html>';
  assert.equal(api.parseYoudaoMobileHtml(html), '你好，世界 & GitHub');
  assert.equal(api.parseYoudaoMobileHtml('<html><body></body></html>'), '');
});

test('provider circuit breaker skips failing providers and falls back to working ones', async () => {
  const origGM = global.GM_xmlhttpRequest;
  const origProviders = api.CFG.providers.slice();
  Object.keys(api.providerState).forEach((k) => { delete api.providerState[k]; });

  try {
    api.CFG.providers.splice(0, api.CFG.providers.length, 'googleClient', 'google');
    let calls = [];
    global.GM_xmlhttpRequest = ({ url, onload }) => {
      calls.push(url);
      if (url.includes('clients5.google.com')) {
        onload({ status: 503, responseText: 'unavailable' });
        return;
      }
      if (url.includes('translate.googleapis.com')) {
        onload({ status: 200, responseText: JSON.stringify([[['Web 和原生用户界面库。', 'Library text']]]) });
        return;
      }
      onload({ status: 500, responseText: '' });
    };

    const res1 = await api.translateTexts(['Library text']);
    assert.deepEqual(res1, ['Web 和原生用户界面库。']);
    assert.equal(api.providerAvailable('googleClient'), true);

    const res2 = await api.translateTexts(['Library text']);
    assert.deepEqual(res2, ['Web 和原生用户界面库。']);
    assert.equal(api.providerAvailable('googleClient'), false);

    calls = [];
    const res3 = await api.translateTexts(['Library text']);
    assert.deepEqual(res3, ['Web 和原生用户界面库。']);
    assert.equal(calls.some((u) => u.includes('clients5.google.com')), false);
  } finally {
    global.GM_xmlhttpRequest = origGM;
    api.CFG.providers.splice(0, api.CFG.providers.length, ...origProviders);
    Object.keys(api.providerState).forEach((k) => { delete api.providerState[k]; });
  }
});
