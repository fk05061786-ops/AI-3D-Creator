import { el, text } from './UILite';
import { EditorEngine } from '../engine/core/editor-engine';
import type { SerializedRig } from '../engine/rigging/skeleton';
import * as THREE from 'three';

const RIG_STORE = 'ai3d:rigs';

export class RiggingPanel {
  readonly element: HTMLElement;
  private readonly boneList: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly rigSelect: HTMLSelectElement;
  private readonly paintButton: HTMLButtonElement;
  private readonly radiusInput: HTMLInputElement;
  private readonly strengthInput: HTMLInputElement;
  private readonly status: HTMLElement;

  constructor(private readonly engine: EditorEngine) {
    this.element = el('div', { className: 'panel rig-panel' });
    this.element.append(el('h3', {}, 'Rigging & Skeleton'));

    const rigActions = el('div', { className: 'actions' });
    rigActions.append(
      this.actionButton('Humanoid Rig', () => this.createHumanoid()),
      this.actionButton('Add Bone', () => this.addBone()),
      this.actionButton('Bind Mesh', () => this.bindMesh())
    );
    this.element.appendChild(rigActions);

    this.boneList = el('ul', { className: 'rig-bones' });
    this.element.appendChild(this.boneList);

    const paintRow = el('div', { className: 'actions' });
    this.paintButton = el(
      'button',
      { on: { click: () => this.togglePaint() } },
      'Paint Weights'
    ) as HTMLButtonElement;
    paintRow.append(
      this.paintButton,
      this.actionButton('Pose', () => this.pose()),
      this.actionButton('Rest', () => this.engine.rig.resetPose())
    );
    this.element.appendChild(paintRow);

    this.radiusInput = el('input', {
      type: 'range', min: '0.05', max: '2', step: '0.05', value: String(this.engine.rig.brushRadius),
    }) as HTMLInputElement;
    this.strengthInput = el('input', {
      type: 'range', min: '0.05', max: '1', step: '0.05', value: String(this.engine.rig.brushStrength),
    }) as HTMLInputElement;
    this.element.append(
      el('div', { className: 'field' }, el('span', {}, 'Brush radius'), this.radiusInput),
      el('div', { className: 'field' }, el('span', {}, 'Brush strength'), this.strengthInput)
    );

    this.radiusInput.addEventListener('input', () => {
      this.engine.rig.brushRadius = parseFloat(this.radiusInput.value);
    });
    this.strengthInput.addEventListener('input', () => {
      this.engine.rig.brushStrength = parseFloat(this.strengthInput.value);
    });

    this.nameInput = el('input', { type: 'text', placeholder: 'Rig name' }) as HTMLInputElement;
    this.rigSelect = el('select', { className: 'rig-select' }) as HTMLSelectElement;
    this.element.append(
      el('div', { className: 'field' }, el('span', {}, 'Rig name'), this.nameInput),
      el('div', { className: 'field' }, el('span', {}, 'Saved rigs'), this.rigSelect)
    );

    const saveRow = el('div', { className: 'actions' });
    saveRow.append(
      this.actionButton('Save Rig', () => this.saveRig()),
      this.actionButton('Load Rig', () => this.loadRig())
    );
    this.element.appendChild(saveRow);

    this.status = el('div', { className: 'rig-status' }, 'Ready');
    this.element.appendChild(this.status);

    this.engine.rig.onChange(() => this.render());
    this.engine.graph.onSelectionChange(() => this.render());
    this.render();
    this.refreshSaved();
  }

  private actionButton(label: string, onClick: () => void): HTMLButtonElement {
    return el('button', { on: { click: onClick } }, label) as HTMLButtonElement;
  }

  private createHumanoid(): void {
    this.engine.rig.createHumanoidRig(this.engine.graph.selected);
    this.engine.rig.name = 'Humanoid';
    this.nameInput.value = 'Humanoid';
    this.setStatus('Humanoid rig created. Select it and bind a mesh.');
  }

  private addBone(): void {
    if (this.engine.rig.bones.length === 0) {
      this.engine.rig.createBone('root', null, [0, 0, 0]);
    } else {
      const bone = this.engine.rig.addChildBone();
      this.engine.selectRigBone(bone.name);
    }
    this.setStatus('Bone added.');
  }

  private bindMesh(): void {
    const selected = this.engine.graph.selected;
    if (!selected) {
      this.setStatus('Select a mesh first.', true);
      return;
    }
    const ok = this.engine.rig.bind(selected);
    if (ok) {
      this.engine.graph.select(null);
      this.engine.graph.select(selected);
    }
    this.setStatus(ok ? `Bound ${selected.meta.name}.` : 'Selected object is not a mesh.', !ok);
  }

  private togglePaint(): void {
    if (!this.engine.rig.targetMesh) {
      this.setStatus('Bind a mesh before painting weights.', true);
      return;
    }
    this.engine.rig.paintEnabled = !this.engine.rig.paintEnabled;
    this.paintButton.classList.toggle('active', this.engine.rig.paintEnabled);
    this.setStatus(this.engine.rig.paintEnabled ? 'Paint mode: drag on the mesh. Shift subtracts.' : 'Paint mode off.');
  }

  private pose(): void {
    const bone = this.engine.rig.activeBone;
    if (!bone) {
      this.setStatus('Select a bone first.', true);
      return;
    }
    this.engine.selectRigBone(bone.name);
    this.setStatus(`Posing ${bone.name} with the gizmo.`);
  }

  private saveRig(): void {
    const bones = this.engine.rig.getBoneNames();
    if (bones.length === 0) {
      this.setStatus('Create a rig before saving.', true);
      return;
    }
    const name = (this.nameInput.value || this.engine.rig.name || 'Rig').trim();
    try {
      const store = this.readStore();
      this.engine.rig.name = name;
      store[name] = this.engine.rig.serialize(name);
      localStorage.setItem(RIG_STORE, JSON.stringify(store));
      this.refreshSaved(name);
      this.setStatus(`Saved rig "${name}".`);
    } catch (err) {
      this.setStatus(`Save failed: ${(err as Error).message}`, true);
    }
  }

  private loadRig(): void {
    const name = this.rigSelect.value;
    if (!name) {
      this.setStatus('No saved rig selected.', true);
      return;
    }
    const data = this.readStore()[name] as SerializedRig | undefined;
    if (!data) {
      this.setStatus('Saved rig not found.', true);
      return;
    }
    const ok = this.engine.rig.load(data, this.engine.graph);
    this.nameInput.value = name;
    this.setStatus(ok ? `Loaded rig "${name}".` : 'Could not load rig data.', !ok);
  }

  private readStore(): Record<string, SerializedRig> {
    try {
      const raw = localStorage.getItem(RIG_STORE);
      return raw ? (JSON.parse(raw) as Record<string, SerializedRig>) : {};
    } catch {
      return {};
    }
  }

  private refreshSaved(selected?: string): void {
    this.rigSelect.innerHTML = '';
    const names = Object.keys(this.readStore()).sort();
    for (const name of names) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      this.rigSelect.appendChild(option);
    }
    if (selected) this.rigSelect.value = selected;
  }

  private render(): void {
    this.boneList.innerHTML = '';
    const active = this.engine.rig.activeBone?.name ?? null;
    for (const bone of this.engine.rig.bones) {
      const depth = this.boneDepth(bone);
      const item = el(
        'button',
        {
          className: 'rig-bone' + (bone.name === active ? ' active' : ''),
          style: `padding-left:${8 + depth * 12}px`,
          on: { click: () => this.engine.selectRigBone(bone.name) },
        },
        bone.name
      );
      this.boneList.appendChild(el('li', {}, item));
    }
    if (this.engine.rig.bones.length === 0) {
      this.boneList.append(el('li', { className: 'empty' }, 'No bones yet.'));
    }
  }

  private boneDepth(bone: THREE.Bone): number {
    let depth = 0;
    let node = bone.parent;
    while (node instanceof THREE.Bone) {
      depth++;
      node = node.parent;
    }
    return depth;
  }

  private setStatus(message: string, error = false): void {
    text(this.status, message);
    this.status.style.color = error ? '#f87171' : '#60a5fa';
  }
}
