import { detectPlatform } from '../platform/detector';

export async function saveProjectFileDialog(suggestedName: string, jsonContent: string): Promise<boolean> {
  const platform = detectPlatform();
  if (platform.isDesktop && typeof window !== 'undefined' && (window as any).__TAURI__) {
    try {
      const { save } = (window as any).__TAURI__.dialog;
      const { writeTextFile } = (window as any).__TAURI__.fs;
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
  if (platform.isDesktop && typeof window !== 'undefined' && (window as any).__TAURI__) {
    try {
      const { open } = (window as any).__TAURI__.dialog;
      const { readTextFile } = (window as any).__TAURI__.fs;
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
