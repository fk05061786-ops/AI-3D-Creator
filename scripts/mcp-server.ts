/**
 * AI-3D-Creator MCP server.
 *
 * Two transports in one process:
 *   - stdio JSON-RPC: the standard MCP transport. Antigravity (or any MCP
 *     client) spawns this file and speaks newline delimited JSON-RPC 2.0 on
 *     stdin/stdout. Only protocol messages go to stdout; logs go to stderr.
 *   - HTTP/SSE on port 3333: the editor bridge. The running 3D app opens an
 *     EventSource on /sse, receives tool calls over the stream and posts the
 *     results back to /response.
 *
 * If port 3333 is already taken (for example the Electron app already runs a
 * server) the process switches to client mode and forwards its stdio traffic
 * to the existing server over HTTP, so both entry points stay usable.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { MCP_TOOLS } from '../src/ai/mcp-bridge.ts';

const PORT = Number(process.env.AI3D_MCP_PORT || 3333);
const HOST = process.env.AI3D_MCP_HOST || '127.0.0.1';
const SERVER_NAME = 'ai-3d-creator';
const SERVER_VERSION = '1.0.0';
const PROTOCOL_VERSION = '2024-11-05';
const REQUEST_TIMEOUT_MS = Number(process.env.AI3D_MCP_TIMEOUT || 30000);

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface BridgeClient {
  id: number;
  res: ServerResponse;
}

const bridgeClients = new Map<number, BridgeClient>();
const pendingBridgeCalls = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }
>();

let nextBridgeRequestId = 1;
let hostMode = false;

function log(message: string): void {
  process.stderr.write(`[mcp] ${message}\n`);
}

function send(response: JsonRpcResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function errorResponse(id: number | string | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function successResponse(id: number | string | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function toolResult(text: string, isError = false): { content: { type: 'text'; text: string }[]; isError?: boolean } {
  return isError ? { content: [{ type: 'text', text }], isError: true } : { content: [{ type: 'text', text }] };
}

/* ------------------------------------------------------------------ tools */

/** Route a tool call to the connected editor, if any. */
async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const client = [...bridgeClients.values()].pop();
  if (!client) {
    throw new Error(
      'No 3D editor is connected to the MCP bridge. Open AI-3D-Creator and enable the MCP bridge in the API Manager panel.'
    );
  }
  const id = nextBridgeRequestId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingBridgeCalls.delete(id);
      reject(new Error(`Tool ${name} timed out after ${REQUEST_TIMEOUT_MS}ms`));
    }, REQUEST_TIMEOUT_MS);
    pendingBridgeCalls.set(id, { resolve, reject, timer });
    client.res.write(
      `event: request\ndata: ${JSON.stringify({ id, name, args })}\n\n`
    );
  });
}

/** Handle one MCP method. Used by both the stdio loop and the HTTP route. */
async function handleMethod(method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      };
    case 'notifications/initialized':
    case 'initialized':
      return {};
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: MCP_TOOLS };
    case 'tools/call': {
      const name = String(params.name ?? '');
      const args = (params.arguments as Record<string, unknown>) ?? {};
      if (!MCP_TOOLS.some((tool) => tool.name === name)) {
        return toolResult(`Unknown tool: ${name}`, true);
      }
      try {
        const result = await callTool(name, args);
        const payload = result as { content?: { type: 'text'; text: string }[]; isError?: boolean };
        if (payload && Array.isArray(payload.content)) return payload;
        return toolResult(JSON.stringify(result ?? {}, null, 2));
      } catch (error) {
        return toolResult((error as Error).message, true);
      }
    }
    case 'shutdown':
      return {};
    default:
      throw new Error(`Method not found: ${method}`);
  }
}

async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;
  if (request.id === undefined || request.id === null) {
    // Notification: no response.
    try {
      await handleMethod(request.method, request.params ?? {});
    } catch {
      // Notifications never answer.
    }
    return null;
  }
  try {
    const result = await handleMethod(request.method, request.params ?? {});
    return successResponse(id, result);
  } catch (error) {
    const message = (error as Error).message;
    return errorResponse(id, message.startsWith('Method not found') ? -32601 : -32603, message);
  }
}

/* ------------------------------------------------------------- http server */

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += String(chunk);
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleRpcPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(errorResponse(null, -32700, 'Parse error')));
    return;
  }
  const requests = Array.isArray(parsed) ? (parsed as JsonRpcRequest[]) : [parsed as JsonRpcRequest];
  const responses: JsonRpcResponse[] = [];
  for (const request of requests) {
    const response = await handleRequest(request);
    if (response) responses.push(response);
  }
  if (responses.length === 0) {
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end('{}');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(Array.isArray(parsed) ? responses : responses[0]));
}

function handleSse(req: IncomingMessage, res: ServerResponse): void {
  setCors(res);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const id = nextBridgeRequestId++;
  bridgeClients.set(id, { id, res });
  res.write(`event: hello\ndata: ${JSON.stringify({ sessionId: id, server: SERVER_NAME, tools: MCP_TOOLS.length })}\n\n`);
  log(`editor bridge connected (${bridgeClients.size} online)`);

  const keepAlive = setInterval(() => {
    res.write(': ping\n\n');
  }, 20000);

  req.on('close', () => {
    clearInterval(keepAlive);
    bridgeClients.delete(id);
    log(`editor bridge disconnected (${bridgeClients.size} online)`);
  });
}

function startHttpServer(): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      setCors(res);
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/sse') {
        handleSse(req, res);
        return;
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            server: SERVER_NAME,
            version: SERVER_VERSION,
            mode: hostMode ? 'host' : 'client',
            tools: MCP_TOOLS.length,
            editors: bridgeClients.size,
          })
        );
        return;
      }
      if (req.method === 'GET' && url.pathname === '/tools') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tools: MCP_TOOLS }));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/rpc') {
        void handleRpcPost(req, res);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/response') {
        void readBody(req).then((raw) => {
          try {
            const payload = JSON.parse(raw) as { id: number; result?: unknown; error?: string };
            const pending = pendingBridgeCalls.get(payload.id);
            if (!pending) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'unknown request id' }));
              return;
            }
            clearTimeout(pending.timer);
            pendingBridgeCalls.delete(payload.id);
            if (payload.error) pending.reject(new Error(payload.error));
            else pending.resolve(payload.result);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: (error as Error).message }));
          }
        });
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    });

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        log(`port ${PORT} already in use, running in client mode`);
        resolve(false);
        return;
      }
      log(`server error: ${error.message}`);
      resolve(false);
    });

    server.listen(PORT, HOST, () => {
      hostMode = true;
      log(`http/sse bridge listening on http://${HOST}:${PORT}`);
      resolve(true);
    });
  });
}

/* ------------------------------------------------------------- stdio mode */

function startStdio(): void {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length > 0) void handleStdioLine(line);
      newline = buffer.indexOf('\n');
    }
  });
  process.stdin.on('end', () => {
    process.exit(0);
  });
}

async function handleStdioLine(line: string): Promise<void> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    send(errorResponse(null, -32700, 'Parse error'));
    return;
  }
  if (hostMode) {
    const response = await handleRequest(request);
    if (response) send(response);
    return;
  }
  // Client mode: forward to the server that owns the bridge.
  try {
    const res = await fetch(`http://${HOST}:${PORT}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const text = await res.text();
    if (text && text !== '{}') process.stdout.write(`${text.trim()}\n`);
  } catch (error) {
    send(errorResponse(request.id ?? null, -32603, (error as Error).message));
  }
}

async function main(): Promise<void> {
  const host = await startHttpServer();
  if (!host) {
    log(`forwarding stdio traffic to http://${HOST}:${PORT}`);
  }
  startStdio();
}

void main();
