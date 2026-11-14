/**
 * Headless self-check for the MCP server and the editor bridge protocol.
 *
 * Starts scripts/mcp-server.ts as a real child process, connects a fake
 * editor over the HTTP/SSE bridge (the same path the browser app uses) and
 * drives the seven MCP tools through the stdio JSON-RPC transport.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  executeMcpTool,
  MCP_TOOLS,
  type McpEditorAdapter,
  type McpObjectLike,
} from '../src/ai/mcp-bridge.ts';

const PORT = Number(process.env.AI3D_MCP_TEST_PORT || 3399);
const BASE = `http://127.0.0.1:${PORT}`;

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error('FAIL: ' + message);
}

/* ------------------------------------------------------------ fake editor */

class FakeObject implements McpObjectLike {
  meta: { id: string; name: string; parentId: string | null; visible: boolean };
  three: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
    isMesh?: boolean;
  };

  constructor(id: string, name: string) {
    this.meta = { id, name, parentId: null, visible: true };
    this.three = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      isMesh: true,
    };
  }
}

const fakeAdapter: McpEditorAdapter = {
  graph: {
    objects: [] as McpObjectLike[],
    selected: null as McpObjectLike | null,
    find(id: string) {
      return this.objects.find((object) => object.meta.id === id);
    },
  },
  addPrimitive(type) {
    const object = new FakeObject(`obj_${this.graph.objects.length + 1}`, type);
    this.graph.objects.push(object);
    this.graph.selected = object;
    return object;
  },
  rig: {
    bones: [] as { name: string }[],
    activeBone: null,
    createHumanoidRig(target) {
      this.bones = Array.from({ length: 21 }, (_, index) => ({ name: `bone_${index}` }));
      this.activeBone = this.bones[0];
      void target;
    },
    bind(target) {
      return !!target;
    },
  },
  animation: {
    clipNames: [] as string[],
    currentClip: null as string | null,
    currentTime: 0,
    isPlaying: false,
    createClip(name) {
      const clip = name ?? `Clip ${this.clipNames.length + 1}`;
      this.clipNames.push(clip);
      this.currentClip = clip;
      return clip;
    },
    addKeyframe(target, property, time) {
      this.currentTime = time;
      void target;
      void property;
      return true;
    },
    play(name) {
      if (name) this.currentClip = name;
      this.isPlaying = true;
    },
    pause() {
      this.isPlaying = false;
    },
    stop() {
      this.isPlaying = false;
      this.currentTime = 0;
    },
  },
  exporter: {
    async export(format, filename) {
      const name = `${filename ?? 'scene'}.${format}`;
      return { filename: name, blob: { size: 2048 } };
    },
  },
};

/* ----------------------------------------------------------- sse client */

interface JsonRpcReply {
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface SseMessage {
  event: string;
  data: string;
}

/** Minimal EventSource replacement: fetch + stream reader. */
async function connectSse(
  url: string,
  onMessage: (message: SseMessage) => void
): Promise<() => Promise<void>> {
  const controller = new AbortController();
  const response = await fetch(`${url}/sse`, {
    headers: { Accept: 'text/event-stream' },
    signal: controller.signal,
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split = buffer.indexOf('\n\n');
        while (split >= 0) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          let event = 'message';
          const dataLines: string[] = [];
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length > 0) onMessage({ event, data: dataLines.join('\n') });
          split = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // stream closed
    }
  })();

  return async () => {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  };
}

/* ------------------------------------------------------------- mcp client */

class McpStdioClient {
  private buffer = '';
  private nextId = 1;
  private readonly pending = new Map<number, (value: JsonRpcReply) => void>();
  private readonly child: ChildProcessWithoutNullStreams;

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf('\n');
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line) {
          const message = JSON.parse(line) as JsonRpcReply;
          if (typeof message.id === 'number') {
            const resolver = this.pending.get(message.id);
            if (resolver) {
              this.pending.delete(message.id);
              resolver(message);
            }
          }
        }
        newline = this.buffer.indexOf('\n');
      }
    });
  }

  request(method: string, params: unknown = {}): Promise<JsonRpcReply> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, 15000);
      this.pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
}

/* ------------------------------------------------------------------ test */

const child = spawn(process.execPath, ['--experimental-strip-types', 'scripts/mcp-server.ts'], {
  env: { ...process.env, AI3D_MCP_PORT: String(PORT) },
  stdio: ['pipe', 'pipe', 'pipe'],
}) as ChildProcessWithoutNullStreams;
child.stderr.setEncoding('utf8');
const serverLog: string[] = [];
child.stderr.on('data', (chunk) => serverLog.push(String(chunk)));

async function waitForHealth(): Promise<unknown> {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return await res.json();
    } catch {
      // retry
    }
    await sleep(250);
  }
  throw new Error('MCP server did not start:\n' + serverLog.join(''));
}

const health = (await waitForHealth()) as { ok: boolean; mode: string; tools: number };
assert(health.ok === true, 'health endpoint reports ok');
assert(health.mode === 'host', 'server owns the http port');
assert(health.tools === 7, 'seven tools registered');

// The fake editor behaves like the browser bridge: SSE in, POST /response out.
let helloSeen = false;
const closeSse = await connectSse(BASE, async (message) => {
  if (message.event === 'hello') {
    helloSeen = true;
    return;
  }
  if (message.event !== 'request') return;
  const payload = JSON.parse(message.data) as { id: number; name: string; args: Record<string, unknown> };
  const result = await executeMcpTool(fakeAdapter, payload.name, payload.args);
  await fetch(`${BASE}/response`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: payload.id, result }),
  });
});
await sleep(300);
assert(helloSeen, 'bridge received the hello event');

const mcp = new McpStdioClient(child);

const initialize = await mcp.request('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'mcp-selftest', version: '1.0.0' },
});
const serverInfo = initialize.result?.['serverInfo'] as { name?: string } | undefined;
assert(serverInfo?.name === 'ai-3d-creator', 'initialize returns the server info');
assert(initialize.result?.['capabilities'] !== undefined, 'initialize advertises the tools capability');

const list = await mcp.request('tools/list');
const listed = list.result?.['tools'] as { name: string; inputSchema: { type: string } }[];
assert(listed.length === 7, 'tools/list returns seven tools');
assert(
  listed.map((tool) => tool.name).join(',') === MCP_TOOLS.map((tool) => tool.name).join(','),
  'tools/list matches the shared catalogue'
);

async function call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await mcp.request('tools/call', { name, arguments: args });
  assert(!response.error, `${name} returned no protocol error`);
  const result = response.result as { content: { text: string }[]; isError?: boolean };
  assert(!result.isError, `${name} did not fail: ${result.content?.[0]?.text}`);
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

const listedObjects = await call('list_scene_objects', {});
assert(listedObjects['count'] === 0, 'scene starts empty');

const added = await call('add_primitive', { type: 'cube', name: 'Hero' });
const created = added['created'] as { name?: string; id?: string };
assert(created.name === 'Hero', 'add_primitive names the object');
const objectId = String(created.id);

const transformed = await call('transform_object', {
  id: objectId,
  position: [1, 2, 3],
  scale: [2, 2, 2],
});
const updated = transformed['updated'] as { position: number[]; scale: number[] };
assert(updated.position.join(',') === '1,2,3', 'transform_object moves the object');
assert(updated.scale.join(',') === '2,2,2', 'transform_object scales the object');

const missing = await mcp.request('tools/call', {
  name: 'transform_object',
  arguments: { id: 'nope', position: [0, 0, 0] },
});
assert((missing.result as { isError?: boolean }).isError === true, 'unknown object id is an error result');

const rig = await call('bind_humanoid_rig', { id: objectId });
assert((rig['bones'] as unknown[]).length === 21, 'bind_humanoid_rig creates 21 bones');
assert(rig['bound'] === true, 'bind_humanoid_rig binds the mesh');

const keyed = await call('add_animation_keyframe', { id: objectId, property: 'position', time: 1.5 });
assert(keyed['recorded'] === true, 'add_animation_keyframe records a key');
assert(keyed['time'] === 1.5, 'keyframe time is honoured');

const played = await call('play_stop_animation', { action: 'play' });
assert(played['playing'] === true, 'play_stop_animation plays');
const stopped = await call('play_stop_animation', { action: 'stop' });
assert(stopped['playing'] === false, 'play_stop_animation stops');

const exported = await call('export_scene_glb_obj_stl', { format: 'glb', filename: 'test-scene' });
assert(exported['filename'] === 'test-scene.glb', 'export names the file');
assert(exported['bytes'] === 2048, 'export reports the byte size');

const badFormat = await mcp.request('tools/call', {
  name: 'export_scene_glb_obj_stl',
  arguments: { format: 'xyz' },
});
assert((badFormat.result as { isError?: boolean }).isError === true, 'invalid export format is an error result');

const httpTools = (await (await fetch(`${BASE}/tools`)).json()) as { tools: unknown[] };
assert(httpTools.tools.length === 7, 'http /tools lists the catalogue');

const httpRpc = (await (
  await fetch(`${BASE}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/list' }),
  })
).json()) as { result: { tools: unknown[] } };
assert(httpRpc.result.tools.length === 7, 'http /rpc answers tools/list');

await closeSse();
child.kill();
await sleep(200);

console.log('MCP SELFTEST PASS');
