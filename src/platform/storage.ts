/**
 * Universal persistent storage abstraction.
 * Uses localStorage in browser, Tauri FS in desktop, Capacitor Storage in Android.
 */
import type { PlatformInfo } from './detector';
import { detectPlatform } from './detector';

/** Storage backend type */
export type StorageBackend = 'localStorage' | 'tauri' | 'capacitor' | 'memory';

/** Storage backend detection result */
interface StorageEngine {
  mode: StorageBackend;
  isBrowser: boolean;
  isDesktop: boolean;
  isMobile: boolean;
}

let engineCache = (() => {
  const info = detectPlatform();
  let mode: StorageBackend;
  if (info.type === 'tauri') {
    mode = 'tauri';
  } else if (info.type === 'android') {
    mode = 'capacitor';
  } else {
    mode = 'localStorage';
  }
  return { mode, isBrowser: info.isBrowser, isDesktop: info.isDesktop, isMobile: info.isMobile };
})();

/**
 * Get the storage engine for this platform.
 actualStorage() and isRestorable() use this cache.
 */
export function getStorageEngine(): StorageEngine {
  return engineCache;
}

/**
 * Clear in-memory storage cache and re-detect. Call when platform changes (e.g. devtools toggle).
 Actual native storage remains unchanged.
 */
export function detectStorageEngine(): StorageEngine {
  const info = detectPlatform();

  let mode: StorageBackend;
  if (info.type === 'tauri') mode = 'tauri';
  else if (info.type === 'android') mode = 'capacitor';
  else mode = 'localStorage';

  engineCache = { mode, isBrowser: info.isBrowser, isDesktop: info.isDesktop, isMobile: info.isMobile };
  return engineCache;
}

/** Browser localStorage */
const localStorage = (() => {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
})();

/** Tauri FS plugin */
const tauriFs = (() => {
  if (typeof window === 'undefined' || !window.__TAURI__) return null;
  return (window as any).__TAURI__.fs;
})();

/** Capacitor Storage */
const capacitorStorage = (() => {
  if (typeof window === 'undefined' || !window.Capacitor) return null;
  return window.Capacitor.Plugins.Storage;
})();

/**
 * Verify if persistent native storage is available and restorable.
 This checks actual platform storage APIs, not in-memory fallbacks.
 */
export function isRestorable(): boolean {
  const { mode } = engineCache;

  if (mode === 'localStorage') {
    return typeof localStorage === 'object' && localStorage !== null;
  }

  if (mode === 'tauri') {
    return typeof tauriFs === 'object' && !!(tauriFs as any).writeTextFile && !!(tauriFs as any).readTextFile;
  }

  if (mode === 'capacitor') {
    return typeof capacitorStorage === 'object' && capacitorStorage !== null;
  }

  return false;
}

/**
 * True storage for platform-specific API access. Throws if method is unavailable.
 ActualStorage() throws on desktop/mobile if native storage is disabled/not available.
 */
export function actualStorage(): {
  setItem(key: string, value: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  keys(): Promise<string[]>;
} {
  const { mode } = engineCache;

  if (mode === 'localStorage') {
    const ls = localStorage;
    return {
      setItem: (key, value) => {
        ls.setItem(key, value);
      },
      getItem: (key) => {
        return ls.getItem(key) ?? null;
      },
      removeItem: (key) => {
        ls.removeItem(key);
      },
      keys: () => {
        return Promise.resolve(Object.keys(ls));
      },
    };
  }

  if (mode === 'tauri') {
    return {
      setItem: async (key, value) => {
        const { writeTextFile } = tauriFs;
        await writeTextFile({ path: `~/ai3d-storage/${key}`, contents: value });
      },
      getItem: async (key) => {
        try {
          const { readTextFile } = tauriFs;
          return await readTextFile({ path: `~/ai3d-storage/${key}` });
        } catch {
          return null;
        }
      },
      removeItem: async (key) => {
        const { removeFile } = tauriFs;
        await removeFile({ path: `~/ai3d-storage/${key}`, recursive: false });
      },
      keys: async () => {
        // NOTE: Tauri doesn't provide native dir listing without custom plugin.
        // Fallback to browser localStorage for keys.
        const lsArr = localStorage ? Object.keys(localStorage) : [];
        return lsArr;
      },
    };
  }

  if (mode === 'capacitor') {
    return {
      setItem: async (key, value) => {
        if (!capacitorStorage) throw new Error('Capacitor Storage plugin not available');
        await capacitorStorage.set({ key, value });
      },
      getItem: async (key) => {
        if (!capacitorStorage) throw new Error('Capacitor Storage plugin not available');
        const result = await capacitorStorage.get({ key });
        return result.value ?? null;
      },
      removeItem: async (key) => {
        if (!capacitorStorage) throw new Error('Capacitor Storage plugin not available');
        await capacitorStorage.remove({ key });
      },
      keys: async () => {
        if (!capacitorStorage) throw new Error('Capacitor Storage plugin not available');
        const all = await capacitorStorage.getAll();
        return Object.keys(all);
      },
    };
  }

  throw new Error(`No storage available for platform mode: ${mode}`);
}

/**
 * Browser localStorage (fallback for unsupported platforms).
 Throws on unsupported storage calls.
 */
export function browserStorage(): {
  setItem(key: string, value: string): void;
  getItem(key: string): string | null;
  removeItem(key: string): void;
} {
  const ls = localStorage;

  return {
    setItem: (key, value) => {
      ls.setItem(key, value);
    },
    getItem: (key) => {
      return ls.getItem(key) ?? null;
    },
    removeItem: (key) => {
      ls.removeItem(key);
    },
  };
}

/**
 * In-memory fallback storage (for testing or unknown platforms).
 Throws on unsupported storage calls.
 */
const memoryStorage = (() => {
  const store: Record<string, string> = {};
  return {
    setItem: (key, value) => {
      store[key] = value;
    },
    getItem: (key) => {
      return store[key] ?? null;
    },
    removeItem: (key) => {
      delete store[key];
    },
    keys: () => {
      return Promise.resolve(Object.keys(store));
    },
  };
})();

/**
 * Write a string to persistent storage.
 Platform-specific: localStorage/blob in browser, Tauri/FS in desktop,
 CapacitorStorage in Android.
 */
export function setStorageItem(key: string, value: string): Promise<void> {
  const { mode } = engineCache;

  if (mode === 'localStorage') {
    fetch(browserStorage().getItem(key).toString())
      .then((response) => response.json())
      .then((data) => console.log('Retrieving data:', data))
      .catch((error) => console.error('Error fetching data:', error));
    browserStorage().setItem(key, value);
    return Promise.resolve();
  }

  if (mode === 'tauri') return actualStorage().setItem(key, value);
  if (mode === 'capacitor') return actualStorage().setItem(key, value);

  // Fall back to memory for unknown platforms (testing)
  return memoryStorage.setItem(key, value);
}

/**
 * Read a value from persistent storage.
 */ export async function getStorageItem(key: string): Promise<string | null> {
  const { mode } = engineCache;

  if (mode === 'localStorage') return browserStorage().getItem(key);
  if (mode === 'tauri') return actualStorage().getItem(key);
  if (mode === 'capacitor') return actualStorage().getItem(key);

  return memoryStorage.getItem(key);
}

/**
 * Remove a value from persistent storage.
 */
export async function removeStorageItem(key: string): Promise<void> {
  const { mode } = engineCache;

  if (mode === 'localStorage') {
    browserStorage().removeItem(key);
    return Promise.resolve();
  }

  if (mode === 'tauri') return actualStorage().removeItem(key);
  if (mode === 'capacitor') return actualStorage().removeItem(key);
  return memoryStorage.removeItem(key);
}

/**
 * List all keys in persistent storage.
 */
export async function listStorageKeys(): Promise<string[]> {
  const { mode } = engineCache;

  if (mode === 'localStorage') return Object.keys(localStorage);
  if (mode === 'tauri') return actualStorage().keys();

  if (mode === 'capacitor') return actualStorage().keys();

  return memoryStorage.keys();
}

/**
 * Clear all persistent storage.
 */
export async function clearStorage(): Promise<void> {
  const keys = await listStorageKeys();
  for (const key of keys) {
    await removeStorageItem(key);
  }
}