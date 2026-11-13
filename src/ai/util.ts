/**
 * Pure helpers shared by the API providers. Kept DOM-free so they can be
 * exercised by the node self-test.
 */

export const MAX_MODEL_BYTES = 40 * 1024 * 1024;

/** Convert huggingface.co/spaces/owner/name to the Space's API origin. */
export function normalizeSpaceUrl(value: string): string {
  const raw = value.trim().replace(/\/+$/, '');
  if (!raw) return '';
  const match = raw.match(/^https?:\/\/huggingface\.co\/spaces\/([^/]+)\/([^/?#]+)/i);
  if (match) {
    return `https://${match[1].toLowerCase()}-${match[2].toLowerCase()}.hf.space`;
  }
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

export function base64ToBytes(value: string): Uint8Array {
  const payload = value.includes(',') && value.trim().startsWith('data:')
    ? value.slice(value.indexOf(',') + 1)
    : value;
  const binary = atob(payload.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function isDataUrl(value: string): boolean {
  return /^data:[^,]*,/i.test(value.trim());
}

/**
 * Validate that a payload is a GLB or a JSON glTF. Returns a short reason when
 * invalid so the UI can explain what the provider actually sent.
 */
export function validateModelBytes(bytes: Uint8Array): { ok: boolean; kind: 'glb' | 'gltf' | 'unknown'; reason?: string } {
  if (bytes.byteLength < 12) {
    return { ok: false, kind: 'unknown', reason: 'response was too small to be a 3D model' };
  }
  if (
    bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46
  ) {
    return { ok: true, kind: 'glb' };
  }
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.byteLength, 512))).trimStart();
  if (head.startsWith('{')) {
    try {
      const json = JSON.parse(new TextDecoder().decode(bytes)) as { asset?: { version?: string }; meshes?: unknown[] };
      if (json.asset?.version && Array.isArray(json.meshes)) return { ok: true, kind: 'gltf' };
    } catch {
      return { ok: false, kind: 'unknown', reason: 'response looked like JSON but was not valid glTF' };
    }
  }
  return { ok: false, kind: 'unknown', reason: 'response was not a GLB or glTF file' };
}

/**
 * Scan a provider response for a downloadable model URL. Handles Gradio
 * file objects, plain URL strings, nested arrays and data URLs.
 */
export function extractModelUrl(value: unknown, depth = 0): string | null {
  if (depth > 8 || value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (isDataUrl(trimmed)) return trimmed;
    if (/^https?:\/\/\S+/i.test(trimmed) && /\.(glb|gltf)(\?|#|$)/i.test(trimmed)) return trimmed;
    if (/^\/\S+\.(glb|gltf)(\?|#|$)/i.test(trimmed)) return trimmed;
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractModelUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['url', 'path', 'name', 'value', 'file', 'model', 'glb', 'glb_url', 'model_url']) {
      const found = extractModelUrl(record[key], depth + 1);
      if (found) return found;
    }
    for (const item of Object.values(record)) {
      const found = extractModelUrl(item, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Resolve a provider path like "/tmp/result.glb" against the Space origin. */
export function resolveModelUrl(url: string, baseUrl: string): string {
  if (isDataUrl(url)) return url;
  try {
    return new URL(url, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
  } catch {
    return url;
  }
}

export function responseBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

export function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'AbortError') return 'Request cancelled.';
    return err.message;
  }
  return String(err);
}

/** Fetch with a timeout while still honouring the caller's AbortSignal. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out.')), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Request cancelled.', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}
