// icloud-notes-paste-inject.js
// 用法: node icloud-notes-paste-inject.js
// 通过 CDP 拦截 main.js 并启用 attachmentInsert feature flag

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
    // Use Fetch with Response stage to modify body while keeping original headers
    send('Fetch.enable', {
      patterns: [{ urlPattern: '*main.js', requestStage: 'Response' }]
    });
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

      // Patch 1: attachmentInsert = true
      body = body.replace(
        'attachmentInsert:{configurable:!1,type:Boolean,value:!1}',
        'attachmentInsert:{configurable:!1,type:Boolean,value:!0}'
      );

      // Patch 2: digest beforeinput - don't block file paste
      body = body.replace(
        'if(null===(r=n.dataTransfer)||void 0===r?void 0:r.files.length)n.preventDefault()',
        'if(false)n.preventDefault()'
      );

      // Patch 3: newEditor = true
      body = body.replace(
        'newEditor:{configurable:!0,type:Boolean,value:!1}',
        'newEditor:{configurable:!0,type:Boolean,value:!0}'
      );
      // Also try alternate pattern
      body = body.replace(
        'newEditor:{configurable:!0,type:Boolean,value:{prod:!1',
        'newEditor:{configurable:!0,type:Boolean,value:{prod:!0'
      );

      console.log('✅ Patches applied');
      console.log('   - attachmentInsert = true');
      console.log('   - digest beforeinput bypass');
      console.log('   - newEditor = true');

      // Fulfill with ORIGINAL headers to avoid CSP issues
      send('Fetch.fulfillRequest', {
        requestId,
        responseCode: responseStatusCode || 200,
        responseHeaders: responseHeaders || [],
        body: Buffer.from(body).toString('base64')
      });

      setTimeout(() => {
        send('Fetch.disable');
        send('Network.setCacheDisabled', { cacheDisabled: false });
        console.log('✅ 完成！图片粘贴已启用。');
        ws.close();
        process.exit(0);
      }, 500);
    }
  });

  setTimeout(() => { console.error('❌ Timeout'); process.exit(1); }, 30000);
})();
