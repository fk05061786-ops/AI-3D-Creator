import { el, text } from './UILite';
import { APIManager, API_PROVIDERS_CHANGED } from '../ai/api-manager';
import type { ProviderConfig, ProviderKind } from '../ai/types';
import { PROVIDER_KINDS } from '../ai/types';
import { loadSecret } from '../ai/key-store';
import { McpBridge, createEditorAdapter, type McpBridgeState } from '../ai/mcp-bridge';
import type { EditorEngine } from '../engine/core/editor-engine';

/**
 * Mobile-first provider configuration. The compact panel lives in the sidebar;
 * configuration and connection tests open in a scrollable full-width dialog so
 * the form remains usable on a phone.
 */
export class APIManagerPanel {
  readonly element: HTMLElement;
  private readonly providerSelect: HTMLSelectElement;
  private readonly statusEl: HTMLElement;
  private overlay: HTMLElement | null = null;
  private abortTest: AbortController | null = null;
  private editing: ProviderConfig | null = null;
  private fields: {
    name?: HTMLInputElement;
    baseUrl?: HTMLInputElement;
    apiName?: HTMLInputElement;
    promptArg?: HTMLInputElement;
    imageArg?: HTMLInputElement;
    resultArg?: HTMLInputElement;
    pollUrl?: HTMLInputElement;
    secret?: HTMLInputElement;
    remember?: HTMLInputElement;
    kindLabel?: HTMLElement;
  } = {};
  private formBody: HTMLElement | null = null;
  private dialogStatus: HTMLElement | null = null;
  private readonly mcpStatus: HTMLElement;
  private readonly mcpButton: HTMLButtonElement;
  private bridge: McpBridge | null = null;

  constructor(
    private readonly manager: APIManager,
    private readonly engine?: EditorEngine
  ) {
    this.element = el('div', { className: 'panel api-panel' });
    this.element.append(el('h3', {}, 'Universal API Manager'));

    this.providerSelect = el('select', { className: 'api-select' }) as HTMLSelectElement;
    this.providerSelect.addEventListener('change', () => this.manager.setActiveId(this.providerSelect.value));

    const row = el('div', { className: 'actions' });
    row.append(
      el('button', { on: { click: () => this.openDialog(this.manager.getActiveId()) } }, 'Configure'),
      el('button', {
        className: 'ghost',
        on: { click: () => void this.quickTest() },
      }, 'Test')
    );

    this.statusEl = el('div', { className: 'api-status' }, 'Choose a provider, then test it.');
    this.element.append(this.providerSelect, row, this.statusEl);

    this.mcpStatus = el('div', { className: 'api-status' }, 'Antigravity MCP: not connected.');
    this.mcpButton = el(
      'button',
      { className: 'ghost api-mcp-button', on: { click: () => this.toggleMcp() } },
      'Connect MCP'
    );
    this.element.appendChild(
      el(
        'div',
        { className: 'api-mcp' },
        el('span', { className: 'api-label' }, 'Antigravity MCP bridge'),
        this.mcpStatus,
        this.mcpButton
      )
    );

    if (this.manager.list().length > 0) this.renderSelect();
    window.addEventListener(API_PROVIDERS_CHANGED, this.onProvidersChanged as EventListener);
  }

  /** Connect or disconnect the local Antigravity MCP bridge. */
  private toggleMcp(): void {
    if (!this.engine) {
      this.renderMcpState({
        status: 'error',
        url: '',
        message: 'The editor engine is not available, the MCP bridge cannot start.',
      });
      return;
    }
    if (!this.bridge) {
      this.bridge = new McpBridge(createEditorAdapter(this.engine));
      this.bridge.onChange((state) => this.renderMcpState(state));
    }
    if (this.bridge.connected || this.bridge.status === 'connecting') {
      this.bridge.disconnect();
      return;
    }
    this.bridge.connect();
  }

  private renderMcpState(state: McpBridgeState): void {
    const label =
      state.status === 'connected'
        ? 'Antigravity MCP: connected.'
        : state.status === 'connecting'
          ? 'Antigravity MCP: connecting…'
          : state.status === 'error'
            ? `Antigravity MCP: ${state.message}`
            : 'Antigravity MCP: not connected.';
    text(this.mcpStatus, label);
    this.mcpStatus.style.color =
      state.status === 'connected' ? '#34d399' : state.status === 'error' ? '#f87171' : '#60a5fa';
    this.mcpButton.textContent = state.status === 'connected' ? 'Disconnect MCP' : 'Connect MCP';
  }

  private readonly onProvidersChanged = (): void => {
    this.renderSelect();
  };

  private renderSelect(): void {
    const providers = this.manager.list();
    const activeId = this.manager.getActiveId();
    this.providerSelect.replaceChildren(
      ...providers.map((provider) => {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.name;
        option.selected = provider.id === activeId;
        return option;
      })
    );
  }

  private async quickTest(): Promise<void> {
    const id = this.manager.getActiveId();
    const config = this.manager.getConfig(id);
    if (!config) return;
    this.statusEl.style.color = '#60a5fa';
    text(this.statusEl, `Testing ${config.name}…`);
    const result = await this.manager.testProvider(id);
    this.statusEl.style.color = result.ok ? '#34d399' : '#f87171';
    text(this.statusEl, result.detail ? `${result.message} ${result.detail}` : result.message);
  }

  private openDialog(providerId: string): void {
    this.closeDialog();
    this.editing = this.manager.getConfig(providerId) ?? this.manager.list()[0] ?? null;

    this.overlay = el('div', { className: 'api-modal-backdrop' });
    const card = el('div', { className: 'api-modal' });
    card.append(el('h3', {}, 'Universal API Manager'));
    card.append(
      el(
        'p',
        { className: 'api-help' },
        'Free-first providers. Keys stay on this device and are never written to projects or logs.'
      )
    );

    const editorSelect = el('select', { className: 'api-select' }) as HTMLSelectElement;
    const refreshEditorSelect = () => {
      editorSelect.replaceChildren(
        ...this.manager.list().map((provider) => {
          const option = document.createElement('option');
          option.value = provider.id;
          option.textContent = provider.name;
          option.selected = provider.id === this.editing?.id;
          return option;
        })
      );
    };
    refreshEditorSelect();
    editorSelect.addEventListener('change', () => {
      this.abortTest?.abort();
      this.editing = this.manager.getConfig(editorSelect.value) ?? null;
      this.renderForm();
    });

    this.formBody = el('div', { className: 'api-form' });
    this.dialogStatus = el('div', { className: 'api-status' }, '');
    const actions = el('div', { className: 'api-modal-actions' });

    const addKind = el('select', { className: 'api-select' }) as HTMLSelectElement;
    for (const entry of PROVIDER_KINDS) {
      const option = document.createElement('option');
      option.value = entry.kind;
      option.textContent = entry.label;
      addKind.append(option);
    }
    const addButton = el('button', { className: 'ghost', on: { click: () => this.addProvider(addKind.value as ProviderKind, editorSelect, refreshEditorSelect) } }, 'Add');
    const testButton = el('button', { className: 'ghost', on: { click: () => void this.runTest() } }, 'Test connection');
    const saveButton = el('button', { on: { click: () => this.save() } }, 'Save');
    const clearButton = el('button', { className: 'ghost danger', on: { click: () => this.clearKey() } }, 'Clear key');
    const deleteButton = el('button', { className: 'ghost danger', on: { click: () => this.deleteProvider(editorSelect, refreshEditorSelect) } }, 'Delete');
    const closeButton = el('button', { className: 'ghost', on: { click: () => this.closeDialog() } }, 'Close');

    actions.append(testButton, saveButton, clearButton, deleteButton, closeButton);
    card.append(
      el('div', { className: 'api-add-row' }, el('span', { className: 'api-label' }, 'Add provider'), addKind, addButton),
      editorSelect,
      this.formBody,
      this.dialogStatus,
      actions
    );

    this.overlay.append(card);
    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) this.closeDialog();
    });
    document.body.append(this.overlay);
    this.renderForm();
  }

  private renderForm(): void {
    if (!this.formBody || !this.editing) return;
    const config = this.editing;
    const kindInfo = PROVIDER_KINDS.find((entry) => entry.kind === config.kind);
    this.fields = {};

    const name = el('input', { type: 'text', value: config.name, autocomplete: 'off' }) as HTMLInputElement;
    const baseUrl = el('input', {
      type: 'url',
      value: config.baseUrl,
      placeholder: config.kind === 'gradio' ? 'https://owner-space.hf.space' : 'http://localhost:8000',
      autocomplete: 'off',
      spellcheck: 'false',
      class: 'api-wide-input',
    }) as HTMLInputElement;
    const children: (Node | string)[] = [
      el('div', { className: 'api-kind' }, kindInfo?.description ?? config.kind),
      this.field('Name', name),
      this.field(config.kind === 'custom' ? 'Generate endpoint URL' : 'URL', baseUrl),
    ];

    let apiName: HTMLInputElement | undefined;
    let promptArg: HTMLInputElement | undefined;
    let imageArg: HTMLInputElement | undefined;
    let resultArg: HTMLInputElement | undefined;
    let pollUrl: HTMLInputElement | undefined;

    if (config.kind === 'gradio') {
      apiName = el('input', {
        type: 'text',
        value: config.apiName ?? '',
        placeholder: '/generate (leave empty to auto-detect)',
        autocomplete: 'off',
        class: 'api-wide-input',
      }) as HTMLInputElement;
      promptArg = el('input', { type: 'number', value: String(config.promptArg ?? 0), min: '0', step: '1' }) as HTMLInputElement;
      imageArg = el('input', { type: 'number', value: String(config.imageArg ?? 0), min: '0', step: '1' }) as HTMLInputElement;
      resultArg = el('input', { type: 'number', value: String(config.resultArg ?? -1), min: '-1', step: '1' }) as HTMLInputElement;
      children.push(
        this.field('Endpoint', apiName),
        this.field('Prompt arg index', promptArg),
        this.field('Image arg index', imageArg),
        this.field('Result arg index (-1 = scan)', resultArg)
      );
      children.push(
        el('p', { className: 'api-help' }, 'Public Spaces work without a key. Add a Hugging Face token only if the Space asks for one.')
      );
    }

    if (config.kind === 'custom') {
      pollUrl = el('input', {
        type: 'text',
        value: config.pollUrlTemplate ?? '',
        placeholder: 'https://api.example.com/jobs/{jobId}',
        autocomplete: 'off',
        class: 'api-wide-input',
      }) as HTMLInputElement;
      children.push(this.field('Poll URL (optional)', pollUrl));
      children.push(
        el(
          'p',
          { className: 'api-help' },
          'Contract: POST JSON {prompt, pipeline, image_base64?}. Reply with {data} base64 GLB or {job_id}. Paid providers are allowed only if you choose them.'
        )
      );
    }

    const existingSecret = loadSecret(config.id);
    const secret = el('input', {
      type: 'password',
      value: existingSecret,
      placeholder: config.kind === 'local' ? 'Not required' : 'API token (optional for public Spaces)',
      autocomplete: 'off',
      spellcheck: 'false',
      class: 'api-wide-input',
    }) as HTMLInputElement;
    const show = el('button', {
      className: 'ghost',
      on: {
        click: () => {
          secret.type = secret.type === 'password' ? 'text' : 'password';
        },
      },
    }, 'Show');
    const remember = el('input', {
      type: 'checkbox',
      class: 'api-checkbox',
    }) as HTMLInputElement;
    remember.checked = this.manager.isSecretRemembered(config.id);
    children.push(
      el('div', { className: 'field api-field' }, el('span', { className: 'api-label' }, 'API key'), secret, show),
      el(
        'label',
        { className: 'api-remember' },
        remember,
        el('span', {}, 'Remember on this device (less safe on a shared phone)')
      ),
      el('p', { className: 'api-help' }, 'Default: key is kept only for this tab session.')
    );

    this.fields = {
      name,
      baseUrl,
      apiName,
      promptArg,
      imageArg,
      resultArg,
      pollUrl,
      secret,
      remember,
    };
    this.formBody.replaceChildren(...children);
    if (this.dialogStatus) text(this.dialogStatus, '');
  }

  private addProvider(
    kind: ProviderKind,
    editorSelect: HTMLSelectElement,
    refresh: () => void
  ): void {
    const config = this.manager.addProvider(kind);
    this.editing = config;
    refresh();
    editorSelect.value = config.id;
    this.renderForm();
  }

  private save(): void {
    if (!this.editing) return;
    const fields = this.fields;
    const config: ProviderConfig = {
      ...this.editing,
      name: fields.name?.value ?? this.editing.name,
      baseUrl: fields.baseUrl?.value ?? this.editing.baseUrl,
      apiName: fields.apiName?.value,
      promptArg: fields.promptArg ? Number(fields.promptArg.value) : undefined,
      imageArg: fields.imageArg ? Number(fields.imageArg.value) : undefined,
      resultArg: fields.resultArg ? Number(fields.resultArg.value) : undefined,
      pollUrlTemplate: fields.pollUrl?.value || undefined,
    };
    this.editing = this.manager.saveProvider(
      config,
      fields.secret?.value ?? '',
      fields.remember?.checked ?? false
    );
    this.renderForm();
    this.setDialogStatus('Saved on this device.', false);
  }

  private async runTest(): Promise<void> {
    if (!this.editing) return;
    this.save();
    const id = this.editing.id;
    this.abortTest?.abort();
    this.abortTest = new AbortController();
    this.setDialogStatus('Testing connection…', false);
    const result = await this.manager.testProvider(id, this.abortTest.signal);
    this.setDialogStatus(result.detail ? `${result.message} ${result.detail}` : result.message, !result.ok);
  }

  private clearKey(): void {
    if (!this.fields.secret) return;
    this.fields.secret.value = '';
    if (this.fields.remember) this.fields.remember.checked = false;
    this.setDialogStatus('Key field cleared. Press Save to remove it from storage.', false);
  }

  private deleteProvider(editorSelect: HTMLSelectElement, refresh: () => void): void {
    if (!this.editing) return;
    if (this.manager.list().length <= 1) {
      this.setDialogStatus('Keep at least one provider.', true);
      return;
    }
    if (!confirm(`Delete provider "${this.editing.name}"?`)) return;
    this.manager.removeProvider(this.editing.id);
    refresh();
    this.editing = this.manager.getConfig(editorSelect.value) ?? this.manager.list()[0] ?? null;
    if (this.editing) editorSelect.value = this.editing.id;
    this.renderForm();
    this.setDialogStatus('Provider deleted.', false);
  }

  private setDialogStatus(message: string, isError: boolean): void {
    if (!this.dialogStatus) return;
    text(this.dialogStatus, message);
    this.dialogStatus.style.color = isError ? '#f87171' : '#60a5fa';
  }

  private closeDialog(): void {
    this.abortTest?.abort();
    this.abortTest = null;
    this.overlay?.remove();
    this.overlay = null;
    this.formBody = null;
    this.dialogStatus = null;
    this.fields = {};
    this.editing = null;
  }

  private field(label: string, control: HTMLInputElement): HTMLElement {
    return el(
      'label',
      { className: 'field api-field' },
      el('span', { className: 'api-label' }, label),
      control
    );
  }
}
