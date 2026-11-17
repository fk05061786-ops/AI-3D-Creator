export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";

interface NativeImagePayload {
  name: string;
  mime: string;
  base64: string;
}

interface DesktopBridge {
  openImage?: () => Promise<NativeImagePayload | null>;
}

type BridgeWindow = Window & { ai3dDesktop?: DesktopBridge };

function desktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as BridgeWindow).ai3dDesktop ?? null;
}

export async function pickImageFile(input: HTMLInputElement): Promise<File | null> {
  const bridge = desktopBridge();
  if (bridge?.openImage) {
    try {
      const payload = await bridge.openImage();
      if (!payload) return null;
      return fileFromPayload(payload);
    } catch (err) {
      console.warn("Native image dialog failed, falling back to file input:", err);
    }
  }
  return fileFromInput(input);
}

function fileFromPayload(payload: NativeImagePayload): File {
  const binary = atob(payload.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], payload.name || "source-image.png", { type: payload.mime || "image/png" });
}

function fileFromInput(input: HTMLInputElement): Promise<File | null> {
  return new Promise((resolve) => {
    input.value = "";
    const finish = (file: File | null): void => {
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      resolve(file);
    };
    const onChange = (): void => finish(input.files?.[0] ?? null);
    const onCancel = (): void => finish(null);
    input.addEventListener("change", onChange, { once: true });
    input.addEventListener("cancel", onCancel, { once: true });
    input.click();
  });
}
