import type {
  AIProvider,
  GenerationInput,
  GenerationOutput,
  ProgressHandler,
  ProviderConfig,
  ProviderTestResult,
} from '../types';
import {
  base64ToBytes,
  describeError,
  extractModelUrl,
  fetchWithTimeout,
  responseBool,
  sleep,
} from '../util';
import { downloadModel } from './local';

/**
 * Bring-your-own-key REST adapter. The contract is intentionally small:
 *
 *   POST <baseUrl>  { prompt, pipeline, image_base64? }
 *
 * Respond either synchronously with { data } (base64 GLB), { url }, or with
 * { job_id } plus an optional status_url. Async jobs are polled until they
 * report completed/failed. The adapter makes no assumptions about the
 * provider's pricing; callers are warned when adding a non-free provider.
 */
export class CustomRestProvider implements AIProvider {
  async test(config: ProviderConfig, secret: string, signal?: AbortSignal): Promise<ProviderTestResult> {
    const base = config.baseUrl.trim();
    if (!base) return { ok: false, message: 'Enter the endpoint URL.' };
    if (!/^https?:\/\//i.test(base)) return { ok: false, message: 'Endpoint must start with http:// or https://.' };

    const headers: Record<string, string> = {};
    if (secret) headers.Authorization = `Bearer ${secret}`;
    const healthUrl = base.replace(/\/+$/, '').replace(/\/generate$/, '/health');
    try {
      const response = await fetchWithTimeout(healthUrl, { method: 'GET', headers }, 10000, signal);
      if (response.status >= 500) return { ok: false, message: `Endpoint returned HTTP ${response.status}.` };
      return {
        ok: true,
        message: `Endpoint reachable (HTTP ${response.status}).`,
        detail: 'Reachability only; a test generation confirms the response contract.',
      };
    } catch (err) {
      return { ok: false, message: `Cannot reach endpoint: ${describeError(err)}` };
    }
  }

  async generate(
    config: ProviderConfig,
    secret: string,
    input: GenerationInput,
    onProgress: ProgressHandler,
    signal?: AbortSignal
  ): Promise<GenerationOutput> {
    const base = config.baseUrl.trim();
    if (!base) throw new Error('Custom endpoint URL is empty. Configure it in the API Manager.');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) headers.Authorization = `Bearer ${secret}`;

    onProgress({ stage: 'submitting', message: 'Submitting job to custom endpoint…' });
    const body: Record<string, unknown> = {
      prompt: input.prompt,
      pipeline: input.pipeline,
    };
    if (input.image) {
      body.image_base64 = input.image.dataUrl;
      body.image_name = input.image.name;
    }

    const response = await fetchWithTimeout(
      base,
      { method: 'POST', headers, body: JSON.stringify(body) },
      120000,
      signal
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Endpoint returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }

    let data = (await response.json()) as Record<string, unknown>;
    const jobId = firstString(data.job_id, data.jobId, data.id, data.task_id, data.prediction_id);
    const completed = isComplete(data);
    if (jobId && !completed) {
      const pollUrl =
        firstString(data.status_url, data.poll_url) ||
        (config.pollUrlTemplate
          ? config.pollUrlTemplate.replace('{jobId}', encodeURIComponent(jobId))
          : defaultPollUrl(base, jobId));
      data = await this.poll(pollUrl, headers, onProgress, signal);
    }

    const bytes = await this.extractBytes(data, base, onProgress, signal);
    const info = (data.model_info ?? {}) as Record<string, unknown>;
    const note = firstString(data.note, info.note) || undefined;
    const genuineAI =
      responseBool(data.is_ai) ||
      responseBool(info.is_ai) ||
      responseBool(data.genuine_ai) ||
      (responseBool(info.neural_model_loaded) && !/placeholder|demo|fallback/i.test(note ?? ''));
    const demo = responseBool(data.is_demo) || responseBool(info.is_demo) || /placeholder|demo geometry|fallback/i.test(note ?? '');

    return {
      bytes,
      filename: firstString(data.filename, data.file_name) || `custom_${Date.now()}.glb`,
      modelUsed: firstString(data.model_used, data.model, info.model) || 'Custom endpoint',
      genuineAI,
      demo: demo && !genuineAI,
      note,
    };
  }

  private async poll(
    url: string,
    headers: Record<string, string>,
    onProgress: ProgressHandler,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    onProgress({ stage: 'queued', message: 'Job queued…' });
    for (let attempt = 0; attempt < 150; attempt++) {
      await sleep(2000, signal);
      const response = await fetchWithTimeout(url, { method: 'GET', headers }, 30000, signal);
      if (!response.ok) throw new Error(`Job status check failed with HTTP ${response.status}.`);
      const data = (await response.json()) as Record<string, unknown>;
      const status = (firstString(data.status, data.state) || '').toLowerCase();
      if (/fail|error|cancel/.test(status)) {
        throw new Error(`Provider job ${status}: ${firstString(data.error, data.detail) || 'no details'}`);
      }
      if (isComplete(data)) return data;
      onProgress({ stage: 'processing', message: `Job ${status || 'processing'}…` });
    }
    throw new Error('Job did not finish within 5 minutes. Try again with a shorter generation.');
  }

  private async extractBytes(
    data: Record<string, unknown>,
    base: string,
    onProgress: ProgressHandler,
    signal?: AbortSignal
  ): Promise<Uint8Array> {
    const payload = firstString(data.data, data.glb, data.base64, data.model_data);
    if (payload && /^(https?:\/\/|data:)/i.test(payload)) {
      return downloadModel(payload, base, onProgress, signal);
    }
    if (payload) return base64ToBytes(payload);
    const url = extractModelUrl(data);
    if (url) return downloadModel(url, base, onProgress, signal);
    throw new Error('Endpoint response contained no GLB data or model URL.');
  }
}

function isComplete(data: Record<string, unknown>): boolean {
  const status = (firstString(data.status, data.state) || '').toLowerCase();
  if (status) return /succeed|success|complete|done|finished|ready/.test(status);
  return (
    typeof data.data === 'string' ||
    typeof data.glb === 'string' ||
    typeof data.model_url === 'string' ||
    typeof data.glb_url === 'string'
  );
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function defaultPollUrl(base: string, jobId: string): string {
  try {
    const url = new URL(base);
    const path = url.pathname.replace(/\/generate\/?$/i, '').replace(/\/+$/, '');
    return `${url.origin}${path}/jobs/${encodeURIComponent(jobId)}`;
  } catch {
    return `${base.replace(/\/+$/, '')}/jobs/${encodeURIComponent(jobId)}`;
  }
}
