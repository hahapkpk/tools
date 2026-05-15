// icloud-notes-paste-inject.js
// 用法: node icloud-notes-paste-inject.js
// 通过 CDP 拦截 main.js 并启用 newEditor 新编辑器引擎

const WebSocket = require('ws');
const http = require('http');

async function findNotesPage() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json/list', r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        const page = JSON.parse(d).find(p => p.url.includes('icloud') && p.url.includes('notes'));
        page ? resolve(page.webSocketDebuggerUrl) : reject(new Error('iCloud Notes not found'));
      });
    }).on('error', reject);
  });
}

(async () => {
  const wsUrl = await findNotesPage();
  const ws = new WebSocket(wsUrl);
  let id = 1;
  const send = (m, p = {}) => { ws.send(JSON.stringify({ id: id++, method: m, params: p })); return id - 1; };
  const pending = {};

  ws.on('open', () => {
    send('Fetch.enable', { patterns: [{ urlPattern: '*main.js', requestStage: 'Response' }] });
    send('Network.setCacheDisabled', { cacheDisabled: true });

    setTimeout(() => {
      send('Runtime.evaluate', {
        expression: `document.querySelector('iframe#early-child')?.contentWindow?.location.reload(); 'ok'`,
        returnByValue: true
      });
      console.log('⏳ Intercepting main.js...');
    }, 500);
  });

  let done = false;
  ws.on('message', data => {
    const msg = JSON.parse(data);

    if (msg.method === 'Fetch.requestPaused' && !done) {
      const { requestId, request, responseHeaders, responseStatusCode } = msg.params;
      if (request.url.includes('main.js')) {
        done = true;
        send('Fetch.getResponseBody', { requestId });
        pending[id - 1] = { requestId, responseHeaders, responseStatusCode };
      } else {
        send('Fetch.continueResponse', { requestId });
      }
    }

    if (msg.id && pending[msg.id]) {
      const { requestId, responseHeaders, responseStatusCode } = pending[msg.id];
      let body = msg.result.base64Encoded
        ? Buffer.from(msg.result.body, 'base64').toString('utf8')
        : msg.result.body;

      // Patch: newEditor = true
      const original = body;
      body = body.replace(
        'newEditor:{configurable:!0,type:Boolean,value:!1}',
        'newEditor:{configurable:!0,type:Boolean,value:!0}'
      );
      body = body.replace(
        'newEditor:{configurable:!0,type:Boolean,value:{prod:!1',
        'newEditor:{configurable:!0,type:Boolean,value:{prod:!0'
      );

      console.log(body !== original ? '✅ newEditor = true' : '⚠️ Pattern not found');

      send('Fetch.fulfillRequest', {
        requestId,
        responseCode: responseStatusCode || 200,
        responseHeaders: responseHeaders || [],
        body: Buffer.from(body).toString('base64')
      });

      setTimeout(() => {
        send('Fetch.disable');
        send('Network.setCacheDisabled', { cacheDisabled: false });
        console.log('✅ 完成！新编辑器已启用。');
        ws.close();
        process.exit(0);
      }, 500);
    }
  });

  setTimeout(() => { console.error('❌ Timeout'); process.exit(1); }, 30000);
})();
