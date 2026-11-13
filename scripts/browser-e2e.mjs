// Browser end-to-end check over the Chrome DevTools Protocol.
// Verifies rigging, keyframe animation and export inside the real app.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/opt/google/chrome/chrome';
const URL_APP = process.env.AI3D_E2E_URL || 'http://127.0.0.1:5199/';
const PORT = 9333;

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

const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--enable-unsafe-swiftshader',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=/tmp/opencode/cdp-profile',
  'about:blank',
]);
chrome.stderr.on('data', () => {});

async function targetUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
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
await send('Page.setDownloadBehavior', {
  behavior: 'allow',
  downloadPath: '/tmp/opencode/downloads',
});
await send('Page.navigate', { url: URL_APP });
await sleep(5000);

const report = await evaluate(`(async () => {
  const out = {};
  const engine = window.ai3d.engine;
  out.hasEngine = !!engine;
  out.hasAnimation = !!engine.animation;
  out.hasExporter = !!engine.exporter;

  engine.addPrimitive('cube');
  const body = engine.graph.objects[0];
  engine.rig.createHumanoidRig(body);
  out.bones = engine.rig.bones.length;
  out.bound = engine.rig.bind(body);
  out.isSkinned = body.isSkinned;
  out.rigName = body.rigName;

  const clip = engine.animation.createClip('BrowserClip', 2, 30);
  out.clip = clip;
  body.three.position.set(0, 0, 0);
  engine.animation.addKeyframe(body, 'position', 0);
  body.three.position.set(3, 0, 0);
  engine.animation.addKeyframe(body, 'position', 1);
  engine.animation.scrub(0.5);
  out.scrubX = body.three.position.x;
  engine.animation.play();
  engine.animation.update(0.1);
  out.playing = engine.animation.isPlaying;
  out.time = engine.animation.currentTime;
  engine.animation.stop();
  out.stoppedAt = engine.animation.currentTime;

  const glb = await engine.exporter.export('glb');
  out.glbSize = glb.blob.size;
  const gltf = await engine.exporter.export('gltf');
  out.gltfSize = gltf.blob.size;
  const obj = await engine.exporter.export('obj');
  out.objSize = obj.blob.size;
  const stl = await engine.exporter.export('stl');
  out.stlSize = stl.blob.size;

  const text = await gltf.blob.text();
  const json = JSON.parse(text);
  out.gltfAnimations = (json.animations || []).length;
  out.gltfSkins = (json.skins || []).length;

  out.serializeAnimations = engine.animation.serialize().length;
  out.panelCount = document.querySelectorAll('.panel').length;
  out.exportMenuItems = document.querySelectorAll('.export-menu button').length;

  out.downloadName = await engine.exporter.download('glb', 'browser-test');
  await new Promise((r) => setTimeout(r, 800));
  const native = await import('/src/engine/export/file-download.ts');
  out.nativeHook = typeof window.AI3DSaveFile;
  window.AI3DSaveFile = { saveFile: (filename, base64) => { window.__nativeCall = [filename, base64.length]; } };
  await native.downloadBlob(new Blob([new Uint8Array([1,2,3])]), 'native.bin');
  out.nativeCall = window.__nativeCall;
  delete window.AI3DSaveFile;
  return out;
})()`);

console.log('BROWSER REPORT ' + JSON.stringify(report, null, 2));
console.log('CONSOLE ERRORS ' + (consoleErrors.length ? JSON.stringify(consoleErrors) : 'none'));

ws.close();
chrome.kill();
if (vite) vite.kill();
