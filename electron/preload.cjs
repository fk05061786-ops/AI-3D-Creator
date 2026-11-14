const { contextBridge, ipcRenderer } = require('electron');

/**
 * Minimal, explicit bridge between the renderer and the desktop shell.
 * The renderer stays sandboxed: no Node APIs are exposed, only the two
 * operations the app actually needs.
 */
contextBridge.exposeInMainWorld('ai3dDesktop', {
  isElectron: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /** Save a base64 payload through the native save dialog. */
  saveFile: (name, base64) => ipcRenderer.invoke('ai3d:save-file', { name, base64 }),
});

// Same hook name as the Android host, so src/engine/export/file-download.ts
// uses the native save dialog on the desktop without any renderer change.
contextBridge.exposeInMainWorld('AI3DSaveFile', {
  saveFile: (filename, base64) => ipcRenderer.invoke('ai3d:save-file', { name: filename, base64 }),
});
