/**
 * Platform abstraction module.
 * Safely detects whether the app is running in a browser, Android (Capacitor),
 * Tauri desktop environment, or an unknown/unsupported shell.
 */

export type PlatformType = 'browser' | 'android' | 'tauri' | 'unknown';

export interface PlatformInfo {
  type: PlatformType;
  isDesktop: boolean;
  isMobile: boolean;
  isBrowser: boolean;
}

export function detectPlatform(): PlatformInfo {
  const isAndroid = typeof window !== 'undefined' && 
    (window as any).Capacitor !== undefined && 
    (window as any).Capacitor.getPlatform() === 'android';

  // Tauri injects __TAURI_INTERNALS__ or __TAURI__ into the window object
  const isTauri = typeof window !== 'undefined' && 
    ((window as any).__TAURI__ !== undefined || 
     (window as any).__TAURI_INTERNALS__ !== undefined);

  let type: PlatformType = 'unknown';
  if (isAndroid) {
    type = 'android';
  } else if (isTauri) {
    type = 'tauri';
  } else if (typeof window !== 'undefined') {
    type = 'browser';
  }

  return {
    type,
    isDesktop: type === 'tauri',
    isMobile: type === 'android',
    isBrowser: type === 'browser' || type === 'unknown',
  };
}

export function getPlatformName(): string {
  const info = detectPlatform();
  switch (info.type) {
    case 'android': return 'Android (Capacitor)';
    case 'tauri': return 'Desktop (Tauri)';
    case 'browser': return 'Web Browser';
    default: return 'Unknown Environment';
  }
}
