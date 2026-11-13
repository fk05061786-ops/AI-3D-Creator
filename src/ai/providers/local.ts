import type {
  AIProvider,
  GenerationInput,
  GenerationOutput,
  ProgressHandler,
  ProviderConfig,
  ProviderTestResult,
} from '../types';
import {
  MAX_MODEL_BYTES,
  base64ToBytes,
  describeError,
  extractModelUrl,
  fetchWithTimeout,
  responseBool,
  validateModelBytes,
} from '../util';

/**
 * The bundled Python backend. It is free and offline-capable, but without a
 * neural model installed it returns placeholder geometry. Results are always
 * labelled as demo unless the backend explicitly reports real inference.
 */
export class LocalProvider implements AIProvider {
  async test(config: ProviderConfig, _secret: string, signal?: AbortSignal): Promise<ProviderTestResult> {
    const base = config.baseUrl.trim().replace(/\/+$/, '');
    if (!base) return { ok: false, message: 'Enter the backend URL.' };
    try {
      const response = await fetchWithTimeout(`${base}/health`, { method: 'GET' }, 8000, signal);
      if (!response.ok) return { ok: false, message: `Backend returned HTTP ${response.status}.` };
      const data = (await response.json()) as { status?: string; gpu_available?: boolean; model_loaded?: boolean };
      if (data.status && data.status !== 'healthy') return { ok: false, message: `Backend status: ${data.status}` };
      const detail = data.model_loaded
        ? 'Neural model loaded.'
        : data.gpu_available
          ? 'Backend online. No neural model reported; expect demo geometry.'
          : 'Backend online (CPU). Expect demo geometry unless a model is installed.';
      return { ok: true, message: 'Connected to local backend.', detail };
    } catch (err) {
      return { ok: false, message: `Cannot reach local backend: ${describeError(err)}` };
    }
  }

  async generate(
    config: ProviderConfig,
    _secret: string,
    input: GenerationInput,
    onProgress: ProgressHandler,
    signal?: AbortSignal
  ): Promise<GenerationOutput> {
    const base = config.baseUrl.trim().replace(/\/+$/, '');
    if (!base) throw new Error('Local backend URL is empty. Configure it in the API Manager.');

    onProgress({ stage: 'submitting', message: 'Sending request to local backend…' });
    const body: Record<string, unknown> = {
      prompt: input.prompt,
      pipeline: input.pipeline,
      max_vertices: input.pipeline === 'image-to-3d' ? 4000 : 1000,
    };
    if (input.image) {
      body.image_base64 = input.image.dataUrl;
      body.image_name = input.image.name;
      if (input.image.pixels) {
        body.image_pixels = input.image.pixels;
        body.image_width = input.image.width;
        body.image_height = input.image.height;
      }
    }

    const response = await fetchWithTimeout(
      `${base}/api/generate-3d`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      180000,
      signal
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Backend returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }

    onProgress({ stage: 'processing', message: 'Backend is generating geometry…' });
    const data = (await response.json()) as Record<string, unknown>;
    if (data.success === false) throw new Error(String(data.error || data.detail || 'Backend generation failed.'));

    const info = (data.model_info ?? {}) as Record<string, unknown>;
    const note = String(info.note ?? '');
    const genuineAI =
      responseBool(info.is_ai) ||
      responseBool(data.is_ai) ||
      (responseBool(info.neural_model_loaded) && !/placeholder|demo|fallback/i.test(note));

    let bytes: Uint8Array;
    const payload = data.data ?? data.glb ?? data.base64;
    if (typeof payload === 'string' && /^(https?:\/\/|data:)/i.test(payload)) {
      bytes = await downloadModel(payload, base, onProgress, signal);
    } else if (typeof payload === 'string' && payload.length > 0) {
      bytes = base64ToBytes(payload);
    } else {
      const url = extractModelUrl(data);
      if (!url) throw new Error('Backend response contained no GLB data or model URL.');
      bytes = await downloadModel(url, base, onProgress, signal);
    }

    const filename = typeof data.filename === 'string' && data.filename ? data.filename : `local_${Date.now()}.glb`;
    return {
      bytes,
      filename,
      modelUsed: String(data.model_used || info.model || 'Local backend'),
      genuineAI,
      demo: !genuineAI,
      note: note || undefined,
    };
  }
}

export async function downloadModel(
  url: string,
  baseUrl: string,
  onProgress: ProgressHandler,
  signal?: AbortSignal
): Promise<Uint8Array> {
  let target = url;
  if (url.startsWith('/')) {
    try {
      target = new URL(url, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
    } catch {
      throw new Error(`Could not resolve model URL: ${url}`);
    }
  }
  onProgress({ stage: 'downloading', message: 'Downloading generated model…' });

  if (target.startsWith('data:')) {
    const bytes = base64ToBytes(target);
    const check = validateModelBytes(bytes);
    if (!check.ok) throw new Error(`Provider returned invalid model: ${check.reason}`);
    return bytes;
  }

  const response = await fetchWithTimeout(target, { method: 'GET' }, 120000, signal);
  if (!response.ok) throw new Error(`Model download failed with HTTP ${response.status}.`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_MODEL_BYTES) throw new Error('Model is larger than the 40 MB safety limit.');
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_MODEL_BYTES) throw new Error('Model is larger than the 40 MB safety limit.');
  const bytes = new Uint8Array(buffer);
  const check = validateModelBytes(bytes);
  if (!check.ok) throw new Error(`Provider returned invalid model: ${check.reason}`);
  return bytes;
}
