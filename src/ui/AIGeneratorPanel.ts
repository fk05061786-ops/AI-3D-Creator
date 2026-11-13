import { el, setDisabled, text } from './UILite';
import { EditorEngine } from '../engine/core/editor-engine';
import { GLBImporter } from '../engine/export/glb-importer';
import { APIManager, API_PROVIDERS_CHANGED } from '../ai/api-manager';
import type { GenerationOutput, Pipeline } from '../ai/types';
import { describeError } from '../ai/util';

type GeneratorMode = 'text' | 'image';

interface ImagePayload {
  dataUrl: string;
  pixels: number[];
  width: number;
  height: number;
  name: string;
}

/**
 * Generation panel. Providers, keys and connection tests live in the API
 * Manager; this panel only selects a provider, collects input, reports progress
 * and imports the returned GLB/glTF.
 */
export class AIGeneratorPanel {
  readonly element: HTMLElement;
  private readonly promptInput: HTMLInputElement;
  private readonly promptGroup: HTMLElement;
  private readonly imageBox: HTMLElement;
  private readonly imageInput: HTMLInputElement;
  private readonly imagePreview: HTMLImageElement;
  private readonly imageInfo: HTMLElement;
  private readonly generateBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly providerSelect: HTMLSelectElement;
  private readonly statusEl: HTMLElement;
  private readonly resultEl: HTMLElement;
  private readonly modeButtons: Record<GeneratorMode, HTMLButtonElement>;
  private readonly importer = new GLBImporter();
  private mode: GeneratorMode = 'text';
  private imagePayload: ImagePayload | null = null;
  private abort: AbortController | null = null;

  constructor(private readonly engine: EditorEngine, private readonly manager: APIManager) {
    this.element = el('div', { className: 'panel ai-panel' });
    this.element.append(el('h3', {}, 'AI 3D Generator'));

    const modeRow = el('div', { className: 'actions ai-mode' });
    this.modeButtons = {
      text: el('button', { className: 'active', on: { click: () => this.setMode('text') } }, 'Text') as HTMLButtonElement,
      image: el('button', { on: { click: () => this.setMode('image') } }, 'Image') as HTMLButtonElement,
    };
    modeRow.append(this.modeButtons.text, this.modeButtons.image);
    this.element.appendChild(modeRow);

    this.providerSelect = el('select', { className: 'api-select' }) as HTMLSelectElement;
    this.providerSelect.addEventListener('change', () => this.manager.setActiveId(this.providerSelect.value));

    this.promptInput = el('input', {
      type: 'text',
      placeholder: 'e.g. futuristic red car, wooden chair',
      className: 'ai-prompt-input',
    }) as HTMLInputElement;
    this.generateBtn = el(
      'button',
      { className: 'ai-generate-btn', on: { click: () => void this.handleGenerate() } },
      'Generate 3D Model'
    ) as HTMLButtonElement;
    this.cancelBtn = el(
      'button',
      { className: 'ai-cancel-btn', on: { click: () => this.cancel() } },
      'Cancel'
    ) as HTMLButtonElement;
    this.cancelBtn.style.display = 'none';
    this.promptGroup = el('div', { className: 'ai-prompt-group' }, this.promptInput);

    this.imageInput = el('input', {
      type: 'file',
      accept: 'image/*',
      className: 'ai-image-input',
    }) as HTMLInputElement;
    this.imageInput.addEventListener('change', () => {
      const file = this.imageInput.files?.[0];
      if (file) void this.loadImage(file);
    });
    this.imagePreview = el('img', { className: 'ai-image-preview', alt: 'Selected source image' }) as HTMLImageElement;
    this.imageInfo = el('div', { className: 'ai-image-info' }, 'No image selected.');
    this.imageBox = el(
      'div',
      { className: 'ai-image-box' },
      el('label', { className: 'import-btn' }, 'Choose image', this.imageInput),
      this.imagePreview,
      this.imageInfo
    );
    this.imageBox.style.display = 'none';

    this.statusEl = el('div', { className: 'ai-status' }, 'Ready');
    this.resultEl = el('div', { className: 'ai-result-info' }, '');

    this.promptInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') void this.handleGenerate();
    });

    this.element.append(
      el('div', { className: 'field ai-provider-row' }, el('span', { className: 'ai-label' }, 'Provider'), this.providerSelect),
      this.promptGroup,
      el('div', { className: 'ai-generate-row' }, this.generateBtn, this.cancelBtn),
      this.imageBox,
      this.statusEl,
      this.resultEl
    );

    this.renderProviders();
    window.addEventListener(API_PROVIDERS_CHANGED, this.onProvidersChanged as EventListener);
  }

  private readonly onProvidersChanged = (): void => this.renderProviders();

  private renderProviders(): void {
    const activeId = this.manager.getActiveId();
    this.providerSelect.replaceChildren(
      ...this.manager.list().map((provider) => {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.name;
        option.selected = provider.id === activeId;
        return option;
      })
    );
  }

  private setMode(mode: GeneratorMode): void {
    this.mode = mode;
    this.modeButtons.text.classList.toggle('active', mode === 'text');
    this.modeButtons.image.classList.toggle('active', mode === 'image');
    this.promptGroup.style.display = mode === 'text' ? '' : 'none';
    this.imageBox.style.display = mode === 'image' ? '' : 'none';
    this.generateBtn.textContent = mode === 'image' ? 'Generate from Image' : 'Generate 3D Model';
    this.updateStatus(mode === 'image' ? 'Choose a source image.' : 'Ready', false);
  }

  private async loadImage(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      this.updateStatus('Choose a PNG, JPEG or WebP image.', true);
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      this.updateStatus('Image must be 15 MB or smaller.', true);
      return;
    }

    this.updateStatus('Reading image…', false);
    try {
      const source = await readAsDataUrl(file);
      const image = await loadHtmlImage(source);
      const sample = downsample(image, 64);
      const upload = downsample(image, 1024);
      const preview = downsample(image, 256).canvas.toDataURL('image/jpeg', 0.82);
      const data = sample.context.getImageData(0, 0, sample.canvas.width, sample.canvas.height).data;
      const pixels: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        pixels.push(Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
      }

      this.imagePayload = {
        dataUrl: upload.canvas.toDataURL('image/jpeg', 0.9),
        pixels,
        width: sample.canvas.width,
        height: sample.canvas.height,
        name: file.name.replace(/\.[^.]+$/, '.jpg'),
      };
      this.imagePreview.src = preview;
      this.imagePreview.style.display = 'block';
      text(this.imageInfo, `${file.name} • ${sample.canvas.width}×${sample.canvas.height} samples`);
      this.updateStatus('Image ready. Click Generate from Image.', false);
    } catch (err) {
      this.imagePayload = null;
      this.imagePreview.removeAttribute('src');
      this.imagePreview.style.display = 'none';
      text(this.imageInfo, 'No image selected.');
      this.updateStatus(`Could not read image: ${(err as Error).message}`, true);
    }
  }

  private async handleGenerate(): Promise<void> {
    if (this.abort) return;
    const prompt = this.promptInput.value.trim();
    if (this.mode === 'text' && !prompt) {
      this.updateStatus('Please enter a prompt first.', true);
      return;
    }
    if (this.mode === 'image' && !this.imagePayload) {
      this.updateStatus('Choose an image first.', true);
      return;
    }
    if (this.manager.list().length === 0) {
      this.updateStatus('Add a provider in the Universal API Manager first.', true);
      return;
    }

    const label = this.mode === 'image' ? (this.imagePayload?.name ?? 'image') : prompt;
    const pipeline: Pipeline = this.mode === 'text' ? 'text-to-3d' : 'image-to-3d';
    const providerId = this.manager.getActiveId();
    const provider = this.manager.getConfig(providerId);
    const image = this.mode === 'image' && this.imagePayload
      ? {
          dataUrl: this.imagePayload.dataUrl,
          name: this.imagePayload.name,
          mime: 'image/jpeg',
          pixels: this.imagePayload.pixels,
          width: this.imagePayload.width,
          height: this.imagePayload.height,
        }
      : undefined;

    this.abort = new AbortController();
    setDisabled(this.generateBtn, true);
    this.cancelBtn.style.display = '';
    text(this.resultEl, '');
    this.updateStatus(`Using ${provider?.name ?? 'provider'}…`, false);

    try {
      const output = await this.manager.generate(
        providerId,
        { prompt: label, pipeline, image },
        (progress) => this.updateStatus(progress.message, false),
        this.abort.signal
      );
      await this.importOutput(output, label);
    } catch (err) {
      if (this.abort?.signal.aborted) {
        this.updateStatus('Generation cancelled.', false);
      } else {
        this.updateStatus(`Generation failed: ${describeError(err)}`, true);
        text(
          this.resultEl,
          provider?.kind === 'gradio'
            ? 'Check the Space URL and endpoint in the API Manager, then run Test connection.'
            : 'Check the provider URL and key in the Universal API Manager, then run Test connection.'
        );
      }
    } finally {
      this.abort = null;
      this.cancelBtn.style.display = 'none';
      setDisabled(this.generateBtn, false);
    }
  }

  private async importOutput(output: GenerationOutput, label: string): Promise<void> {
    if (output.bytes.byteLength === 0) throw new Error('Provider returned an empty model.');
    this.updateStatus('Importing generated model…', false);

    const buffer = new ArrayBuffer(output.bytes.byteLength);
    new Uint8Array(buffer).set(output.bytes);
    const file = new File([buffer], output.filename, { type: 'model/gltf-binary' });
    const before = this.engine.graph.objects.length;
    await this.importer.import(file, this.engine.graph);
    const added = this.engine.graph.objects.slice(before);
    if (added.length === 0) throw new Error('Imported model did not add any objects.');

    const prefix = output.genuineAI ? 'AI Model' : output.demo ? 'Demo Geometry' : 'External Model';
    for (const sceneObj of added) {
      sceneObj.meta.name = `${prefix} (${label})`;
      sceneObj.three.name = sceneObj.meta.name;
    }

    if (output.genuineAI) {
      this.updateStatus(`Generated AI Model (${label})`, false);
      text(this.resultEl, `Model: ${output.modelUsed}${output.note ? ` | ${output.note}` : ''}`);
    } else if (output.demo) {
      this.updateStatus(`Loaded Demo Geometry (${label})`, false);
      text(
        this.resultEl,
        'Placeholder mesh loaded, not AI output. Install a model in the backend or use a generative Hugging Face Space.'
      );
    } else {
      this.updateStatus(`Imported model from ${output.modelUsed} (${label})`, false);
      text(
        this.resultEl,
        `The provider did not confirm AI inference${output.note ? ` (${output.note})` : ''}. Label kept neutral.`
      );
    }
    this.engine.resetCamera();
  }

  private cancel(): void {
    this.abort?.abort();
  }

  private updateStatus(msg: string, isError: boolean): void {
    text(this.statusEl, msg);
    this.statusEl.style.color = isError ? '#f87171' : '#60a5fa';
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the image file.'));
    reader.readAsDataURL(file);
  });
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode the image.'));
    image.src = src;
  });
}

function downsample(image: HTMLImageElement, maxSide: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(2, Math.round(image.naturalWidth * scale));
  const height = Math.max(2, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas is unavailable.');
  context.drawImage(image, 0, 0, width, height);
  return { canvas, context };
}
