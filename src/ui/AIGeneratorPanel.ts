import * as THREE from 'three';
import { el, setDisabled, text } from './UILite';
import { EditorEngine } from '../engine/core/editor-engine';
import { GLBImporter } from '../engine/export/glb-importer';
import { SceneObject } from '../engine/core/object-model';
import { APIManager, API_PROVIDERS_CHANGED } from '../ai/api-manager';
import type { GenerationOutput, ImageInput, Pipeline } from '../ai/types';
import { describeError } from '../ai/util';
import { buildProceduralMesh } from '../ai/procedural-mesh';
import { IMAGE_ACCEPT, pickImageFile } from '../bridge/image-picker';

export type GeneratorMode = 'text' | 'image';

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
 * and imports the returned GLB/glTF. When a provider cannot serve the request
 * (a cold or rate limited free endpoint) a procedural mesh is added instead,
 * so the viewport always receives real geometry.
 */
export class AIGeneratorPanel {
  readonly element: HTMLElement;
  private readonly promptInput: HTMLTextAreaElement;
  private readonly textGroup: HTMLElement;
  private readonly imageGroup: HTMLElement;
  private readonly imageInput: HTMLInputElement;
  private readonly imagePreview: HTMLImageElement;
  private readonly imageInfo: HTMLElement;
  private readonly dropZone: HTMLElement;
  private readonly generateTextBtn: HTMLButtonElement;
  private readonly generateImageBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly providerSelect: HTMLSelectElement;
  private readonly statusEl: HTMLElement;
  private readonly resultEl: HTMLElement;
  private readonly spinner: HTMLElement;
  private readonly modeButtons: Record<GeneratorMode, HTMLButtonElement>;
  private readonly importer = new GLBImporter();
  private imagePayload: ImagePayload | null = null;
  private abort: AbortController | null = null;
  private overlay: HTMLElement | null = null;
  private homeParent: Node | null = null;
  private homeNextSibling: Node | null = null;

  constructor(private readonly engine: EditorEngine, private readonly manager: APIManager) {
    this.element = el('div', { className: 'panel ai-panel' });
    this.element.append(el('h3', {}, 'AI 3D Generator'));

    const modeRow = el('div', { className: 'actions ai-mode' });
    this.modeButtons = {
      text: el('button', { className: 'active', on: { click: () => this.setMode('text') } }, 'Text to 3D') as HTMLButtonElement,
      image: el('button', { on: { click: () => this.setMode('image') } }, 'Image to 3D') as HTMLButtonElement,
    };
    modeRow.append(this.modeButtons.text, this.modeButtons.image);
    this.element.appendChild(modeRow);

    this.providerSelect = el('select', { className: 'api-select' }) as HTMLSelectElement;
    this.providerSelect.addEventListener('change', () => this.manager.setActiveId(this.providerSelect.value));

    this.promptInput = el('textarea', {
      placeholder: 'Describe 3D model to generate...',
      className: 'ai-prompt-input',
      rows: '3',
    }) as HTMLTextAreaElement;
    this.generateTextBtn = el(
      'button',
      { className: 'ai-generate-btn', on: { click: () => void this.handleGenerate('text') } },
      'Generate from Text'
    ) as HTMLButtonElement;
    this.textGroup = el(
      'div',
      { className: 'ai-prompt-group' },
      this.promptInput,
      this.generateTextBtn
    );

    this.imageInput = el('input', {
      type: 'file',
      accept: IMAGE_ACCEPT,
      className: 'ai-image-input',
    }) as HTMLInputElement;
    this.imagePreview = el('img', { className: 'ai-image-preview', alt: 'Selected source image' }) as HTMLImageElement;
    this.imageInfo = el('div', { className: 'ai-image-info' }, 'No image selected.');
    this.dropZone = el(
      'div',
      { className: 'ai-dropzone' },
      el('span', { className: 'ai-dropzone-title' }, 'Drag an image here'),
      el('span', { className: 'ai-dropzone-hint' }, 'PNG, JPEG or WebP')
    );
    this.dropZone.addEventListener('dragover', (event: DragEvent) => {
      event.preventDefault();
      this.dropZone.classList.add('dragover');
    });
    this.dropZone.addEventListener('dragleave', () => this.dropZone.classList.remove('dragover'));
    this.dropZone.addEventListener('drop', (event: DragEvent) => {
      event.preventDefault();
      this.dropZone.classList.remove('dragover');
      const file = event.dataTransfer?.files?.[0];
      if (file) void this.loadImage(file);
    });

    const uploadBtn = el(
      'button',
      { className: 'ghost ai-upload-btn', on: { click: () => void this.chooseImage() } },
      'Upload image'
    );
    this.generateImageBtn = el(
      'button',
      { className: 'ai-generate-btn', on: { click: () => void this.handleGenerate('image') } },
      'Generate from Image'
    ) as HTMLButtonElement;
    this.imageGroup = el(
      'div',
      { className: 'ai-image-box' },
      uploadBtn,
      this.dropZone,
      this.imageInput,
      this.imagePreview,
      this.imageInfo,
      this.generateImageBtn
    );

    this.cancelBtn = el(
      'button',
      { className: 'ai-cancel-btn', on: { click: () => this.cancel() } },
      'Cancel'
    ) as HTMLButtonElement;
    this.cancelBtn.style.display = 'none';

    this.spinner = el('div', { className: 'ai-spinner' });
    this.spinner.style.display = 'none';

    this.statusEl = el('div', { className: 'ai-status' }, 'Ready');
    this.resultEl = el('div', { className: 'ai-result-info' }, '');

    this.element.append(
      el('div', { className: 'field ai-provider-row' }, el('span', { className: 'ai-label' }, 'Provider'), this.providerSelect),
      this.textGroup,
      this.imageGroup,
      el('div', { className: 'ai-generate-row' }, this.cancelBtn),
      this.spinner,
      this.statusEl,
      this.resultEl
    );
    this.imageGroup.style.display = 'none';

    this.renderProviders();
    window.addEventListener(API_PROVIDERS_CHANGED, this.onProvidersChanged as EventListener);
  }

  /** Show the generator, optionally switching to a mode first. */
  open(mode?: GeneratorMode): void {
    if (!this.overlay) this.createOverlay();
    if (mode) this.setMode(mode);
    this.overlay.style.display = 'flex';
    this.promptInput.focus();
  }

  /** Hide the generator and return it to its place in the sidebar. */
  close(): void {
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
    if (this.homeParent) {
      if (this.homeNextSibling && this.homeNextSibling.parentNode === this.homeParent) {
        this.homeParent.insertBefore(this.element, this.homeNextSibling);
      } else {
        this.homeParent.appendChild(this.element);
      }
    }
  }

  private createOverlay(): void {
    this.homeParent = this.element.parentNode;
    this.homeNextSibling = this.element.nextSibling;

    const backdrop = el('div', { className: 'api-modal-backdrop ai-generator-backdrop', style: 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.75);padding:16px;' });
    const card = el('div', { className: 'api-modal ai-generator-modal', style: 'background:#1e293b;color:#f8fafc;border:1px solid #334155;border-radius:12px;padding:20px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 50px rgba(0,0,0,0.6);' });
    const closeBtn = el('button', { className: 'ghost', on: { click: () => this.close() } }, 'Close');
    const header = el(
      'div',
      { className: 'ai-generator-header' },
      el('h3', {}, 'AI 3D Generator'),
      closeBtn
    );
    const body = el('div', { className: 'ai-generator-body' });
    body.append(this.element);
    card.append(header, body);
    backdrop.append(card);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) this.close();
    });
    document.body.append(backdrop);
    this.overlay = backdrop;
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
    this.modeButtons.text.classList.toggle('active', mode === 'text');
    this.modeButtons.image.classList.toggle('active', mode === 'image');
    this.textGroup.style.display = mode === 'text' ? '' : 'none';
    this.imageGroup.style.display = mode === 'image' ? '' : 'none';
    this.updateStatus(mode === 'image' ? 'Choose a source image.' : 'Ready', false);
  }

  private async chooseImage(): Promise<void> {
    try {
      const file = await pickImageFile(this.imageInput);
      if (file) await this.loadImage(file);
    } catch (err) {
      this.updateStatus(`Could not open the file picker: ${describeError(err)}`, true);
    }
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

  private async handleGenerate(mode: GeneratorMode): Promise<void> {
    if (this.abort) return;
    const prompt = this.promptInput.value.trim();
    if (mode === 'text' && !prompt) {
      this.updateStatus('Please enter a prompt first.', true);
      return;
    }
    if (mode === 'image' && !this.imagePayload) {
      this.updateStatus('Choose an image first.', true);
      return;
    }

    const providerId = this.resolveProviderId();
    const provider = this.manager.getConfig(providerId);
    const label = mode === 'image' ? (this.imagePayload?.name ?? 'image') : prompt;
    const pipeline: Pipeline = mode === 'image' ? 'image-to-3d' : 'text-to-3d';
    const image: ImageInput | undefined =
      mode === 'image' && this.imagePayload
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
    this.setBusy(true);
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
        this.addProceduralFallback(prompt || label, image, describeError(err));
      }
    } finally {
      this.abort = null;
      this.setBusy(false);
    }
  }

  /**
   * Hugging Face prefers a configured Space over the local placeholder
   * backend, so the generator buttons reach the real inference endpoint.
   */
  private resolveProviderId(): string {
    const activeId = this.manager.getActiveId();
    const active = this.manager.getConfig(activeId);
    if (active?.kind === 'gradio') return activeId;
    const gradio = this.manager.list().find((provider) => provider.kind === 'gradio' && provider.baseUrl.trim());
    if (gradio) {
      this.manager.setActiveId(gradio.id);
      return gradio.id;
    }
    return activeId;
  }

  private setBusy(busy: boolean): void {
    this.spinner.style.display = busy ? '' : 'none';
    setDisabled(this.generateTextBtn, busy);
    setDisabled(this.generateImageBtn, busy);
    this.cancelBtn.style.display = busy ? '' : 'none';
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

  /**
   * The free endpoint was cold, rate limited or unreachable. Build a real
   * mesh from the inputs instead of leaving the viewport empty.
   */
  private addProceduralFallback(label: string, image: ImageInput | undefined, reason: string): void {
    try {
      const result = buildProceduralMesh(label, image);
      const obj = new SceneObject(result.mesh, { name: result.name });
      const box = new THREE.Box3().setFromObject(result.mesh);
      result.mesh.position.y -= box.min.y;
      this.engine.graph.add(obj);
      this.engine.resetCamera();
      this.updateStatus(`Added procedural mesh (${label})`, false);
      text(
        this.resultEl,
        `The AI endpoint was unavailable (${reason}). ${result.description} Configure a Hugging Face Space in the API Manager for real AI models.`
      );
    } catch (err) {
      this.updateStatus(`Generation failed: ${describeError(err)}`, true);
      text(
        this.resultEl,
        'Check the provider URL and key in the Universal API Manager, then run Test connection.'
      );
    }
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
