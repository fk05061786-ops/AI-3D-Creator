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

type PlatformWindow = Window & {
  Capacitor?: { getPlatform(): string };
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

export function detectPlatform(): PlatformInfo {
  const host = typeof window !== 'undefined' ? (window as PlatformWindow) : null;
  const isAndroid = host?.Capacitor?.getPlatform() === 'android';
  const isTauri = !!host && (host.__TAURI__ !== undefined || host.__TAURI_INTERNALS__ !== undefined);

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
