import { detectPlatform } from '../platform/detector';

interface TauriBridge {
  dialog: {
    save(options: { defaultPath: string; filters: { name: string; extensions: string[] }[] }): Promise<string | null>;
    open(options: { multiple: boolean; filters: { name: string; extensions: string[] }[] }): Promise<string | string[] | null>;
  };
  fs: {
    writeTextFile(path: string, contents: string): Promise<void>;
    readTextFile(path: string): Promise<string>;
  };
}

function tauriBridge(): TauriBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { __TAURI__?: TauriBridge }).__TAURI__ ?? null;
}

export async function saveProjectFileDialog(suggestedName: string, jsonContent: string): Promise<boolean> {
  const platform = detectPlatform();
  const tauri = tauriBridge();
  if (platform.isDesktop && tauri) {
    try {
      const { save } = tauri.dialog;
      const { writeTextFile } = tauri.fs;
      const filePath = await save({
        defaultPath: suggestedName,
        filters: [{ name: 'JSON Project', extensions: ['json'] }]
      });
      if (filePath) {
        await writeTextFile(filePath, jsonContent);
        return true;
      }
      return false;
    } catch (err) {
      console.warn('Tauri native save dialog failed, using fallback:', err);
    }
  }

  // Web / Fallback behavior
  const blob = new Blob([jsonContent], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName.endsWith('.json') ? suggestedName : `${suggestedName}.json`;
  link.click();
  URL.revokeObjectURL(url);
  return true;
}

export async function openProjectFileDialog(): Promise<string | null> {
  const platform = detectPlatform();
  const tauri = tauriBridge();
  if (platform.isDesktop && tauri) {
    try {
      const { open } = tauri.dialog;
      const { readTextFile } = tauri.fs;
      const selected = await open({
        multiple: false,
        filters: [{ name: 'JSON Project', extensions: ['json'] }]
      });
      if (selected && typeof selected === 'string') {
        return await readTextFile(selected);
      }
    } catch (err) {
      console.warn('Tauri native open dialog failed, using fallback:', err);
    }
  }
  return null;
}
