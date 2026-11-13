/**
 * API key storage.
 *
 * Secrets live in memory + sessionStorage by default, so closing the tab
 * clears them. Users may explicitly opt into localStorage persistence for a
 * device; that is convenient but weaker on a shared phone, so the UI warns.
 * Secrets are never written to project files, logs or exported scenes.
 */

const SECRET_PREFIX = 'ai3d:secret:';
const REMEMBER_PREFIX = 'ai3d:remember:';

const memory = new Map<string, string>();

function session(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

function persistent(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadSecret(providerId: string): string {
  if (memory.has(providerId)) return memory.get(providerId)!;
  const fromSession = session()?.getItem(SECRET_PREFIX + providerId);
  if (fromSession) return fromSession;
  if (persistent()?.getItem(REMEMBER_PREFIX + providerId) === '1') {
    return persistent()?.getItem(SECRET_PREFIX + providerId) ?? '';
  }
  return '';
}

export function saveSecret(providerId: string, value: string, remember: boolean): void {
  memory.set(providerId, value);
  const sessionStore = session();
  const localStore = persistent();
  sessionStore?.removeItem(SECRET_PREFIX + providerId);
  localStore?.removeItem(SECRET_PREFIX + providerId);
  localStore?.removeItem(REMEMBER_PREFIX + providerId);

  if (!value) return;
  if (remember) {
    localStore?.setItem(SECRET_PREFIX + providerId, value);
    localStore?.setItem(REMEMBER_PREFIX + providerId, '1');
  } else {
    sessionStore?.setItem(SECRET_PREFIX + providerId, value);
  }
}

export function isRemembered(providerId: string): boolean {
  return persistent()?.getItem(REMEMBER_PREFIX + providerId) === '1';
}

export function clearSecret(providerId: string): void {
  memory.delete(providerId);
  session()?.removeItem(SECRET_PREFIX + providerId);
  persistent()?.removeItem(SECRET_PREFIX + providerId);
  persistent()?.removeItem(REMEMBER_PREFIX + providerId);
}
