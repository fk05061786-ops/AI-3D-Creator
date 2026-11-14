const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const DEV_SERVER_URL = process.env.AI3D_DESKTOP_DEV_URL || 'http://localhost:5173';
const MCP_PORT = Number(process.env.AI3D_MCP_PORT || 3333);

let mainWindow = null;
let mcpProcess = null;

/** True when nothing is listening on the MCP port, so we can own it. */
function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

/**
 * Locate the MCP server entry point.
 *
 * A packaged app ships the bundled server as an extra resource, because a
 * file inside app.asar cannot be executed. A development checkout uses the
 * esbuild bundle when it exists and falls back to the TypeScript source.
 */
function resolveMcpEntry() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'mcp', 'mcp-server.mjs')]
    : [
        path.join(__dirname, '..', 'dist-mcp', 'mcp-server.mjs'),
        path.join(__dirname, '..', 'scripts', 'mcp-server.ts'),
      ];
  return candidates.find((file) => fs.existsSync(file)) ?? null;
}

/**
 * Start the MCP server so the in-app bridge has an endpoint on port 3333.
 * When the port is already taken (for example Antigravity started the server
 * itself) the child is skipped and the editor uses the existing one.
 */
async function startMcpServer() {
  if (!(await isPortFree(MCP_PORT))) {
    console.log(`[desktop] MCP port ${MCP_PORT} already in use, using the running server`);
    return;
  }
  const entry = resolveMcpEntry();
  if (!entry) {
    console.log('[desktop] MCP server not found, skipping');
    return;
  }
  const isSource = entry.endsWith('.ts');
  const args = isSource ? ['--experimental-strip-types', entry] : [entry];
  // ELECTRON_RUN_AS_NODE makes the Electron binary behave like plain Node,
  // so the child never opens a second application window.
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    AI3D_MCP_PORT: String(MCP_PORT),
  };
  mcpProcess = spawn(process.execPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  mcpProcess.on('error', (error) => {
    console.log(`[desktop] MCP server failed to start: ${error.message}`);
    mcpProcess = null;
  });
  mcpProcess.stdout.on('data', (chunk) => process.stdout.write(`[mcp] ${chunk}`));
  mcpProcess.stderr.on('data', (chunk) => process.stderr.write(`[mcp] ${chunk}`));
  mcpProcess.on('exit', (code) => {
    console.log(`[desktop] MCP server exited with code ${code}`);
    mcpProcess = null;
  });
  console.log(`[desktop] MCP server started (${isSource ? 'source' : 'bundled'})`);
}

/** True when the vite dev server answers, so the window can load it. */
async function devServerReady() {
  try {
    const response = await fetch(DEV_SERVER_URL, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#101827',
    title: 'AI 3D Creator',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // An unpackaged build prefers the dev server when it runs, so `electron .`
  // works the same on Windows, macOS and Linux.
  const useDevServer =
    process.env.AI3D_DESKTOP_DEV === '1' || (!app.isPackaged && (await devServerReady()));
  if (useDevServer) {
    mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('ai3d:save-file', async (event, payload) => {
  const { name, base64 } = payload || {};
  if (!name || !base64) return { ok: false, error: 'Missing file name or payload.' };
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('downloads'), name),
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'));
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

app.whenReady().then(async () => {
  await startMcpServer();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (mcpProcess) {
    mcpProcess.kill();
    mcpProcess = null;
  }
});
