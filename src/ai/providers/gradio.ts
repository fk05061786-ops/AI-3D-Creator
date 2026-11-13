import type {
  AIProvider,
  GenerationInput,
  GenerationOutput,
  ProgressHandler,
  ProviderConfig,
  ProviderTestResult,
} from '../types';
import {
  extractModelUrl,
  fetchWithTimeout,
  normalizeSpaceUrl,
  resolveModelUrl,
} from '../util';
import { downloadModel } from './local';

interface GradioParameter {
  parameter_name?: string;
  label?: string;
}

interface GradioEndpoint {
  parameters?: GradioParameter[];
  returns?: unknown[];
}

interface GradioInfo {
  named_endpoints?: Record<string, GradioEndpoint>;
  unnamed_endpoints?: Record<string, GradioEndpoint>;
}

interface ResolvedApi {
  /** Origin prepared for either Gradio 5 (/gradio_api) or Gradio 4. */
  apiBase: string;
  info: GradioInfo;
}

const INFO_TIMEOUT = 15000;
const CALL_TIMEOUT = 300000;

/**
 * Public Hugging Face Gradio Spaces. These are free to call for public Spaces.
 * The API surface varies between Spaces, so endpoint names and argument
 * positions are configurable and validated during the connection test.
 */
export class GradioProvider implements AIProvider {
  async test(config: ProviderConfig, secret: string, signal?: AbortSignal): Promise<ProviderTestResult> {
    const base = normalizeSpaceUrl(config.baseUrl);
    if (!base) return { ok: false, message: 'Enter a Space URL or huggingface.co/spaces/owner/name.' };
    try {
      const resolved = await this.resolveApi(base, secret, signal);
      const names = Object.keys(resolved.info.named_endpoints ?? {});
      const wanted = normalizeEndpointName(config.apiName);
      if (wanted && !names.includes(wanted)) {
        return {
          ok: false,
          message: `Endpoint ${wanted} not found on this Space.`,
          detail: names.length ? `Available: ${names.join(', ')}` : 'This Space exposes no named endpoints.',
        };
      }
      const endpoint = wanted ? resolved.info.named_endpoints?.[wanted] : undefined;
      const params = (endpoint?.parameters ?? []).map((p) => p.parameter_name || p.label || '?');
      return {
        ok: true,
        message: `Space reachable (${names.length} endpoint${names.length === 1 ? '' : 's'}).`,
        detail: endpoint
          ? `Inputs: ${params.join(', ') || 'none'}`
          : names.length
            ? `Endpoints: ${names.join(', ')}`
            : 'No named endpoints; generation will try the first endpoint.',
      };
    } catch (err) {
      return { ok: false, message: `Cannot reach Space: ${(err as Error).message}` };
    }
  }

  async generate(
    config: ProviderConfig,
    secret: string,
    input: GenerationInput,
    onProgress: ProgressHandler,
    signal?: AbortSignal
  ): Promise<GenerationOutput> {
    const base = normalizeSpaceUrl(config.baseUrl);
    if (!base) throw new Error('Hugging Face Space URL is empty. Configure it in the API Manager.');

    onProgress({ stage: 'submitting', message: 'Reading Space API…' });
    const resolved = await this.resolveApi(base, secret, signal);
    const endpointName = this.pickEndpoint(resolved.info, config, input);
    const endpoint = resolved.info.named_endpoints?.[endpointName];
    if (!endpoint) throw new Error(`Endpoint ${endpointName} disappeared from the Space.`);

    const params = endpoint.parameters ?? [];
    const data: unknown[] = new Array(Math.max(params.length, 1)).fill(null);

    const promptIndex = clampIndex(config.promptArg, params, /prompt|text|description|caption/i, 0);
    if (input.pipeline === 'text-to-3d') {
      data[promptIndex] = input.prompt;
    } else if (input.image) {
      onProgress({ stage: 'submitting', message: 'Uploading source image to Space…' });
      const uploadedPath = await this.uploadImage(resolved.apiBase, input.image.dataUrl, input.image.name, secret, signal);
      const imageIndex = clampIndex(config.imageArg, params, /image|img|photo|picture/i, promptIndex === 0 ? 0 : 1);
      data[imageIndex] = uploadedPath
        ? { path: uploadedPath, meta: { _type: 'gradio.FileData' } }
        : null;
    }

    onProgress({ stage: 'queued', message: 'Submitting generation job…' });
    const callUrl = `${resolved.apiBase}/call/${endpointName.replace(/^\//, '')}`;
    const call = await fetchWithTimeout(
      callUrl,
      {
        method: 'POST',
        headers: this.headers(secret),
        body: JSON.stringify({ data }),
      },
      INFO_TIMEOUT,
      signal
    );
    if (!call.ok) {
      const detail = await call.text().catch(() => '');
      throw new Error(`Space rejected the job (HTTP ${call.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }
    const callData = (await call.json()) as { event_id?: string; eventId?: string } | unknown[];
    const eventId = Array.isArray(callData)
      ? String(callData[0] ?? '')
      : String(callData.event_id ?? callData.eventId ?? '');
    if (!eventId) throw new Error('Space did not return a job id; its API may have changed.');

    onProgress({ stage: 'processing', message: 'Model is generating (this can take a minute)…' });
    const output = await this.waitForResult(
      `${resolved.apiBase}/call/${endpointName.replace(/^\//, '')}/${eventId}`,
      secret,
      config.resultArg,
      onProgress,
      signal
    );

    const url = extractModelUrl(output);
    if (!url) {
      throw new Error('Space finished but returned no .glb/.gltf file. Use a Space that outputs a 3D model.');
    }
    const bytes = await downloadModel(resolveModelUrl(url, base), base, onProgress, signal);
    return {
      bytes,
      filename: filenameFor(url, input.prompt),
      modelUsed: `Hugging Face Space (${new URL(base).host})`,
      genuineAI: true,
      demo: false,
    };
  }

  private async resolveApi(base: string, secret: string, signal?: AbortSignal): Promise<ResolvedApi> {
    const candidates = [`${base}/gradio_api`, base];
    let lastError = '';
    for (const apiBase of candidates) {
      try {
        const response = await fetchWithTimeout(
          `${apiBase}/info`,
          { method: 'GET', headers: this.headers(secret) },
          INFO_TIMEOUT,
          signal
        );
        if (!response.ok) {
          lastError = `HTTP ${response.status}`;
          continue;
        }
        const text = await response.text();
        const info = JSON.parse(text) as GradioInfo;
        if (!info.named_endpoints && !info.unnamed_endpoints) {
          lastError = 'response was not a Gradio API description';
          continue;
        }
        return { apiBase, info };
      } catch (err) {
        lastError = (err as Error).message;
      }
    }
    throw new Error(lastError || 'Gradio API was not reachable. Check the URL.');
  }

  private pickEndpoint(info: GradioInfo, config: ProviderConfig, input: GenerationInput): string {
    const named = info.named_endpoints ?? {};
    const wanted = normalizeEndpointName(config.apiName);
    if (wanted && named[wanted]) return wanted;
    if (wanted) throw new Error(`Endpoint ${wanted} not found. Use the connection test to list endpoints.`);

    const pattern = input.pipeline === 'text-to-3d' ? /prompt|text|description|caption/i : /image|img|photo|picture/i;
    for (const [name, endpoint] of Object.entries(named)) {
      if ((endpoint.parameters ?? []).some((p) => pattern.test(p.parameter_name || p.label || ''))) return name;
    }
    const first = Object.keys(named)[0];
    if (first) return first;
    const unnamed = Object.keys(info.unnamed_endpoints ?? {})[0];
    if (unnamed) return unnamed;
    throw new Error('Space exposes no callable endpoints.');
  }

  private async uploadImage(
    apiBase: string,
    dataUrl: string,
    name: string,
    secret: string,
    signal?: AbortSignal
  ): Promise<string | null> {
    let blob: Blob;
    try {
      blob = await (await fetch(dataUrl)).blob();
    } catch {
      throw new Error('Could not read the selected image for upload.');
    }
    const form = new FormData();
    form.append('files', blob, name || 'source.png');
    const headers = this.headers(secret);
    delete headers['Content-Type'];

    for (const uploadBase of [apiBase, apiBase.replace(/\/gradio_api$/, '')]) {
      try {
        const response = await fetchWithTimeout(
          `${uploadBase}/upload`,
          { method: 'POST', headers, body: form },
          60000,
          signal
        );
        if (!response.ok) continue;
        const payload = (await response.json()) as unknown;
        if (Array.isArray(payload) && typeof payload[0] === 'string') return payload[0];
        if (payload && typeof payload === 'object') {
          const record = payload as Record<string, unknown>;
          if (typeof record.path === 'string') return record.path;
          if (Array.isArray(record.files) && typeof record.files[0] === 'string') return record.files[0];
        }
      } catch {
        // Try the other upload route.
      }
    }
    throw new Error('Image upload to the Space failed.');
  }

  private async waitForResult(
    eventsUrl: string,
    secret: string,
    resultArg: number | undefined,
    onProgress: ProgressHandler,
    signal?: AbortSignal
  ): Promise<unknown> {
    const response = await fetchWithTimeout(
      eventsUrl,
      { method: 'GET', headers: { ...this.headers(secret), Accept: 'text/event-stream' } },
      CALL_TIMEOUT,
      signal
    );
    if (!response.ok) throw new Error(`Could not read job events (HTTP ${response.status}).`);
    if (!response.body) throw new Error('Job event stream is unavailable in this browser.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastHeartbeat = Date.now();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? '';

        for (const block of blocks) {
          const event = parseSseBlock(block);
          if (!event) continue;
          if (event.type === 'error') {
            throw new Error(`Space job failed: ${eventDataMessage(event.data)}`);
          }
          if (event.type === 'complete') {
            const parsed = safeJson(event.data);
            const result = Array.isArray(parsed) ? parsed : [parsed];
            return resultArg != null && resultArg >= 0 ? result[resultArg] : result;
          }
          if (event.type === 'heartbeat' || Date.now() - lastHeartbeat > 5000) {
            lastHeartbeat = Date.now();
            onProgress({ stage: 'processing', message: 'Model is still generating…' });
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    throw new Error('Job stream ended without a result.');
  }

  private headers(secret: string): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers.Authorization = `Bearer ${secret}`;
    return headers;
  }
}

function normalizeEndpointName(value?: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function clampIndex(value: number | undefined, params: GradioParameter[], pattern: RegExp, fallback: number): number {
  if (typeof value === 'number' && value >= 0 && value < Math.max(params.length, 1)) return value;
  const found = params.findIndex((p) => pattern.test(p.parameter_name || p.label || ''));
  if (found >= 0) return found;
  return Math.min(fallback, Math.max(params.length - 1, 0));
}

function parseSseBlock(block: string): { type: string; data: string } | null {
  let type = 'message';
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return null;
  return { type, data: data.join('\n') };
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function eventDataMessage(value: string): string {
  const parsed = safeJson(value);
  if (typeof parsed === 'string') return parsed;
  if (Array.isArray(parsed)) return parsed.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(' ');
  return JSON.stringify(parsed).slice(0, 300);
}

function filenameFor(url: string, prompt: string): string {
  try {
    const path = new URL(url, 'https://example.invalid').pathname;
    const name = path.split('/').pop() || '';
    if (/\.(glb|gltf)$/i.test(name)) return name;
  } catch {
    // Fall through to the prompt-based name.
  }
  const safe = prompt.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40) || 'model';
  return `${safe}_${Date.now()}.glb`;
}
