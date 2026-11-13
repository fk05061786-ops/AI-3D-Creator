/**
 * Shared types for the Universal API Manager.
 *
 * Providers are free-first: the local backend and public Gradio Spaces need
 * no payment, and the custom REST adapter only calls endpoints the user owns.
 */

export type Pipeline = 'text-to-3d' | 'image-to-3d';

export type ProviderKind = 'local' | 'gradio' | 'custom';

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  /** Gradio endpoint name, e.g. "/generate". Auto-detected when empty. */
  apiName?: string;
  /** Position of the prompt in the Gradio input array. */
  promptArg?: number;
  /** Position of the uploaded image in the Gradio input array. */
  imageArg?: number;
  /** Optional position of the model output; -1 scans the whole response. */
  resultArg?: number;
  /** Custom REST: poll URL with {jobId}, e.g. https://api.example.com/jobs/{jobId}. */
  pollUrlTemplate?: string;
}

export interface ImageInput {
  dataUrl: string;
  name: string;
  mime: string;
  /** Downsampled luminance grid for the local CPU backend. */
  pixels?: number[];
  width?: number;
  height?: number;
}

export interface GenerationInput {
  prompt: string;
  pipeline: Pipeline;
  image?: ImageInput;
}

export interface ProgressUpdate {
  stage: 'submitting' | 'queued' | 'processing' | 'downloading';
  message: string;
}

export interface GenerationOutput {
  bytes: Uint8Array;
  filename: string;
  modelUsed: string;
  /** True only when a provider produced real model inference. */
  genuineAI: boolean;
  /** True for known placeholder geometry (local demo backend). */
  demo: boolean;
  note?: string;
}

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  detail?: string;
}

export type ProgressHandler = (update: ProgressUpdate) => void;

export interface AIProvider {
  test(config: ProviderConfig, secret: string, signal?: AbortSignal): Promise<ProviderTestResult>;
  generate(
    config: ProviderConfig,
    secret: string,
    input: GenerationInput,
    onProgress: ProgressHandler,
    signal?: AbortSignal
  ): Promise<GenerationOutput>;
}

export const PROVIDER_KINDS: { kind: ProviderKind; label: string; description: string }[] = [
  {
    kind: 'gradio',
    label: 'Hugging Face Space (free)',
    description: 'Public Gradio Space with a text-to-3D or image-to-3D model. No API key required for public Spaces.',
  },
  {
    kind: 'local',
    label: 'Local backend',
    description: 'The bundled ai-backend on this device or LAN. Currently produces demo geometry unless a model is installed.',
  },
  {
    kind: 'custom',
    label: 'Custom REST (bring your own key)',
    description: 'Any endpoint using the documented POST/JSON contract. Provider may be paid; check its pricing.',
  },
];

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    id: 'local',
    kind: 'local',
    name: 'Local backend',
    baseUrl: 'http://localhost:8000',
  },
  {
    id: 'hf-gradio',
    kind: 'gradio',
    name: 'Hugging Face Space',
    baseUrl: '',
    apiName: '',
    promptArg: 0,
    imageArg: 0,
    resultArg: -1,
  },
];
