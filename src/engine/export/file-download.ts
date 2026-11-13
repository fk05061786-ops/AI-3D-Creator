export type DownloadMethod = 'native' | 'blob' | 'data-uri';

type NativeSave = (filename: string, base64: string, mime: string) => void | Promise<void>;

interface NativeSaveBridge {
  saveFile?: NativeSave;
}

interface NativeWindow extends Window {
  AI3DSaveFile?: NativeSave | NativeSaveBridge;
}

function nativeSave(): NativeSave | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as NativeWindow).AI3DSaveFile;
  if (typeof bridge === 'function') return bridge;
  if (bridge && typeof bridge.saveFile === 'function') return bridge.saveFile.bind(bridge);
  return null;
}

/** Base64 payload without relying on FileReader (not available on every shell). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Save a blob to the device. Uses the native Android bridge when the host
 * exposes `AI3DSaveFile`, otherwise a blob URL download with a data-URI
 * fallback for WebViews that block blob downloads.
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<DownloadMethod> {
  const native = nativeSave();
  if (native) {
    await native(filename, await blobToBase64(blob), blob.type);
    return 'native';
  }

  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoking immediately cancels the download in some Android WebViews.
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    return 'blob';
  } catch {
    const link = document.createElement('a');
    link.href = `data:${blob.type};base64,${await blobToBase64(blob)}`;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    return 'data-uri';
  }
}
