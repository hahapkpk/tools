// icloud-notes-paste-inject.js
// 用法: node icloud-notes-paste-inject.js
// 通过 Chrome DevTools Protocol 拦截 iCloud Notes 的 main.js 并启用图片粘贴功能
// 运行后会重载备忘录 iframe，patch 生效后即可粘贴图片

const WebSocket = require('ws');
const http = require('http');

async function findNotesPage() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json/list', r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        const page = JSON.parse(d).find(p => p.url.includes('icloud') && p.url.includes('notes'));
        page ? resolve(page.webSocketDebuggerUrl) : reject(new Error('iCloud Notes page not found'));
      });
    }).on('error', reject);
  });
}

(async () => {
  const wsUrl = await findNotesPage();
  const ws = new WebSocket(wsUrl);
  let id = 1;
  const send = (method, params = {}) => { ws.send(JSON.stringify({ id: id++, method, params })); return id - 1; };
  const pendingBodies = {};

  ws.on('open', () => {
    send('Fetch.enable', { patterns: [{ urlPattern: '*.js', requestStage: 'Response' }] });
    send('Network.setCacheDisabled', { cacheDisabled: true });

    setTimeout(() => {
      send('Runtime.evaluate', {
        expression: `document.querySelector('iframe#early-child')?.contentWindow?.location.reload(); 'ok'`,
        returnByValue: true
      });
      console.log('⏳ Reloading iframe and intercepting main.js...');
    }, 500);
  });

  let done = false;
  ws.on('message', (data) => {
    const msg = JSON.parse(data);

    if (msg.method === 'Fetch.requestPaused') {
      const { requestId, request } = msg.params;
      if (request.url.includes('main.js') && !done) {
        done = true;
        send('Fetch.getResponseBody', { requestId });
        pendingBodies[id - 1] = requestId;
      } else {
        send('Fetch.continueRequest', { requestId });
      }
    }

    if (msg.id && pendingBodies[msg.id]) {
      const requestId = pendingBodies[msg.id];
      let body = msg.result.base64Encoded
        ? Buffer.from(msg.result.body, 'base64').toString('utf8')
        : msg.result.body;

      const patched = body.replace(
        'attachmentInsert:{configurable:!1,type:Boolean,value:!1}',
        'attachmentInsert:{configurable:!1,type:Boolean,value:!0}'
      );
      console.log(patched !== body ? '✅ attachmentInsert = true' : '⚠️ Pattern not found');

      send('Fetch.fulfillRequest', {
        requestId, responseCode: 200,
        body: Buffer.from(patched).toString('base64'),
        responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }]
      });

      setTimeout(() => {
        send('Fetch.disable');
        send('Network.setCacheDisabled', { cacheDisabled: false });
        console.log('✅ 图片粘贴功能已启用。打开备忘录后可直接 Ctrl+V 粘贴图片。');
        ws.close();
        process.exit(0);
      }, 1000);
    }
  });

  setTimeout(() => { console.error('❌ Timeout'); process.exit(1); }, 20000);
})();
