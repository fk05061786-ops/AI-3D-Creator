import type {
  AIProvider,
  GenerationInput,
  GenerationOutput,
  ProgressHandler,
  ProviderConfig,
  ProviderKind,
  ProviderTestResult,
} from './types';
import { DEFAULT_PROVIDERS } from './types';
import { LocalProvider } from './providers/local';
import { GradioProvider } from './providers/gradio';
import { CustomRestProvider } from './providers/custom';
import { clearSecret, isRemembered, loadSecret, saveSecret } from './key-store';

const CONFIG_KEY = 'ai3d:apiProviders:v1';
const ACTIVE_KEY = 'ai3d:activeProvider:v1';

const KIND_LABELS: Record<ProviderKind, string> = {
  local: 'Local backend',
  gradio: 'Hugging Face Space',
  custom: 'Custom REST',
};

const VALID_KINDS: ProviderKind[] = ['local', 'gradio', 'custom'];

export interface ProviderChangeDetail {
  providers: ProviderConfig[];
  activeId: string;
}

/**
 * Single owner of provider configuration, secrets, testing and generation.
 * Non-secret settings persist in localStorage; secrets follow the key-store
 * policy (session by default, opt-in persistence).
 */
export class APIManager {
  private providers: ProviderConfig[] = [];
  private activeId = '';
  private readonly impls: Record<ProviderKind, AIProvider> = {
    local: new LocalProvider(),
    gradio: new GradioProvider(),
    custom: new CustomRestProvider(),
  };

  constructor() {
    this.load();
  }

  list(): ProviderConfig[] {
    return this.providers.map((provider) => ({ ...provider }));
  }

  getActiveId(): string {
    return this.activeId;
  }

  setActiveId(id: string): void {
    if (!this.providers.some((provider) => provider.id === id)) return;
    this.activeId = id;
    this.persistActive();
    this.emitChange();
  }

  getConfig(id: string): ProviderConfig | undefined {
    const config = this.providers.find((provider) => provider.id === id);
    return config ? { ...config } : undefined;
  }

  hasSecret(id: string): boolean {
    return loadSecret(id).length > 0;
  }

  isSecretRemembered(id: string): boolean {
    return isRemembered(id);
  }

  saveProvider(config: ProviderConfig, secret: string, remember: boolean): ProviderConfig {
    const clean: ProviderConfig = {
      id: config.id || newId(),
      kind: config.kind,
      name: config.name.trim() || KIND_LABELS[config.kind],
      baseUrl: config.baseUrl.trim(),
    };
    if (config.kind === 'gradio') {
      clean.apiName = config.apiName?.trim() || '';
      clean.promptArg = normalizeIndex(config.promptArg, 0);
      clean.imageArg = normalizeIndex(config.imageArg, 0);
      clean.resultArg = normalizeIndex(config.resultArg, -1);
    }
    if (config.kind === 'custom' && config.pollUrlTemplate?.trim()) {
      clean.pollUrlTemplate = config.pollUrlTemplate.trim();
    }

    const existing = this.providers.findIndex((provider) => provider.id === clean.id);
    if (existing >= 0) {
      this.providers[existing] = clean;
    } else {
      this.providers.push(clean);
      if (!this.activeId) this.activeId = clean.id;
    }
    saveSecret(clean.id, secret.trim(), remember);
    this.persistConfig();
    if (!this.activeId) this.activeId = clean.id;
    this.persistActive();
    this.emitChange();
    return { ...clean };
  }

  addProvider(kind: ProviderKind, name?: string): ProviderConfig {
    const config: ProviderConfig = {
      id: newId(),
      kind,
      name: name?.trim() || `${KIND_LABELS[kind]} ${this.providers.filter((p) => p.kind === kind).length + 1}`,
      baseUrl: '',
    };
    if (kind === 'gradio') {
      config.apiName = '';
      config.promptArg = 0;
      config.imageArg = 0;
      config.resultArg = -1;
    }
    this.providers.push(config);
    this.persistConfig();
    this.emitChange();
    return { ...config };
  }

  removeProvider(id: string): void {
    if (this.providers.length <= 1) return;
    const index = this.providers.findIndex((provider) => provider.id === id);
    if (index < 0) return;
    this.providers.splice(index, 1);
    clearSecret(id);
    if (this.activeId === id) this.activeId = this.providers[0]?.id ?? '';
    this.persistConfig();
    this.persistActive();
    this.emitChange();
  }

  async testProvider(id: string, signal?: AbortSignal): Promise<ProviderTestResult> {
    const config = this.getConfig(id);
    if (!config) return { ok: false, message: 'Provider not found.' };
    try {
      return await this.impls[config.kind].test(config, loadSecret(id), signal);
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  async generate(
    id: string,
    input: GenerationInput,
    onProgress: ProgressHandler,
    signal?: AbortSignal
  ): Promise<GenerationOutput> {
    const config = this.getConfig(id);
    if (!config) throw new Error('Choose a provider in the API Manager first.');
    return this.impls[config.kind].generate(config, loadSecret(id), input, onProgress, signal);
  }

  private load(): void {
    this.providers = DEFAULT_PROVIDERS.map((provider) => ({ ...provider }));
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          const valid = parsed
            .filter((item): item is ProviderConfig => isValidConfig(item))
            .map((item) => ({ ...item, baseUrl: item.baseUrl ?? '' }));
          if (valid.length > 0) this.providers = valid;
        }
      }
    } catch {
      // Corrupt settings fall back to defaults; secrets are separate.
    }
    const storedActive = localStorage.getItem(ACTIVE_KEY) ?? '';
    this.activeId = this.providers.some((provider) => provider.id === storedActive)
      ? storedActive
      : this.providers[0]?.id ?? '';
  }

  private persistConfig(): void {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(this.providers));
    } catch {
      // Private mode: keep the in-memory configuration.
    }
  }

  private persistActive(): void {
    try {
      localStorage.setItem(ACTIVE_KEY, this.activeId);
    } catch {
      // Private mode: keep the in-memory selection.
    }
  }

  private emitChange(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent<ProviderChangeDetail>('ai3d:providers-changed', {
        detail: { providers: this.list(), activeId: this.activeId },
      })
    );
  }
}

export const API_PROVIDERS_CHANGED = 'ai3d:providers-changed';

function isValidConfig(value: unknown): value is ProviderConfig {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.kind === 'string' &&
    VALID_KINDS.includes(record.kind as ProviderKind) &&
    typeof record.name === 'string'
  );
}

function normalizeIndex(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -1 ? Math.floor(value) : fallback;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `provider_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
