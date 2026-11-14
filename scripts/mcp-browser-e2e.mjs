// Browser end-to-end check for the Antigravity MCP bridge.
// Starts the real MCP server, opens the app in Chrome, enables the MCP
// toggle in the API Manager panel and drives the tools through the server.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/opt/google/chrome/chrome';
const URL_APP = process.env.AI3D_E2E_URL || 'http://127.0.0.1:5199/';
const MCP_PORT = 3333;
const BASE = `http://127.0.0.1:${MCP_PORT}`;

let vite = null;
async function ensureServer() {
  try {
    const res = await fetch(URL_APP);
    if (res.ok) return;
  } catch {
    /* start our own */
  }
  vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5199'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'ignore',
  });
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const res = await fetch(URL_APP);
      if (res.ok) return;
    } catch {
      /* retry */
    }
  }
  throw new Error('dev server did not start');
}

await ensureServer();

const mcp = spawn(process.execPath, ['--experimental-strip-types', 'scripts/mcp-server.ts'], {
  env: { ...process.env, AI3D_MCP_PORT: String(MCP_PORT) },
  stdio: ['pipe', 'pipe', 'pipe'],
});
mcp.stderr.on('data', () => {});

for (let i = 0; i < 40; i++) {
  await sleep(250);
  try {
    const res = await fetch(`${BASE}/health`);
    if (res.ok) break;
  } catch {
    /* retry */
  }
}

const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--enable-unsafe-swiftshader',
  '--remote-debugging-port=9334',
  '--user-data-dir=/tmp/opencode/cdp-profile-mcp',
  'about:blank',
]);
chrome.stderr.on('data', () => {});

async function targetUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9334/json/list');
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  throw new Error('chrome did not start');
}

const ws = new WebSocket(await targetUrl());
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 1;
const pending = new Map();
const consoleErrors = [];

ws.onmessage = (event) => {
  const msg = JSON.parse(String(event.data));
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(JSON.stringify(msg.params.exceptionDetails));
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(JSON.stringify(msg.params.args.map((a) => a.value ?? a.description)));
  }
};

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (res.result?.exceptionDetails) {
    throw new Error('page exception: ' + JSON.stringify(res.result.exceptionDetails));
  }
  return res.result?.result?.value;
}

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL_APP });
await sleep(5000);

// Point the app at the test MCP server and press the MCP toggle in the UI.
const diagnostics = await evaluate(`(() => ({
  buttons: document.querySelectorAll('.api-mcp-button').length,
  status: document.querySelector('.api-mcp .api-status')?.textContent ?? null,
  panels: document.querySelectorAll('.api-panel').length
}))()`);
console.log('UI DIAGNOSTICS ' + JSON.stringify(diagnostics));

const ui = await evaluate(`(() => {
  const button = [...document.querySelectorAll('.api-mcp-button')][0];
  if (!button) return { found: false };
  button.click();
  return { found: true, label: button.textContent };
})()`);

await sleep(1500);

const health = await (await fetch(`${BASE}/health`)).json();

const mcpReply = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('mcp timeout')), 15000);
  mcp.stdout.setEncoding('utf8');
  let buffer = '';
  const onData = (chunk) => {
    buffer += chunk;
    const newline = buffer.indexOf('\n');
    if (newline < 0) return;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) return;
    try {
      const message = JSON.parse(line);
      if (message.id === 1) {
        clearTimeout(timer);
        mcp.stdout.off('data', onData);
        resolve(message);
      }
    } catch {
      /* ignore */
    }
  };
  mcp.stdout.on('data', onData);
  mcp.stdin.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_scene_objects', arguments: {} },
    }) + '\n'
  );
});

const scene = JSON.parse(mcpReply.result.content[0].text);

console.log(
  'MCP BROWSER REPORT ' +
    JSON.stringify(
      {
        uiButtonFound: ui.found,
        uiLabel: ui.label,
        bridgeEditors: health.editors,
        bridgeMode: health.mode,
        sceneObjects: scene.count,
        firstObject: scene.objects[0]?.name ?? null,
      },
      null,
      2
    )
);
console.log('CONSOLE ERRORS ' + (consoleErrors.length ? JSON.stringify(consoleErrors) : 'none'));

ws.close();
chrome.kill();
mcp.kill();
if (vite) vite.kill();
