import { el, text } from './UILite';
import { EditorEngine } from '../engine/core/editor-engine';
import * as THREE from 'three';

/**
 * Inspector for the selected object: material color, roughness/metalness,
 * visibility, transform mode, plus delete/duplicate actions.
 */
export class Inspector {
  readonly element: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly colorInput: HTMLInputElement;
  private readonly roughInput: HTMLInputElement;
  private readonly metalInput: HTMLInputElement;
  private readonly visInput: HTMLInputElement;
  private readonly modeButtons: HTMLButtonElement[];
  private readonly roughVal: HTMLElement;
  private readonly metalVal: HTMLElement;

  constructor(private readonly engine: EditorEngine) {
    this.element = el('div', { className: 'panel' });
    this.element.append(el('h3', {}, 'Inspector'));

    this.nameInput = el('input', { type: 'text', placeholder: 'Name' }) as HTMLInputElement;
    this.colorInput = el('input', { type: 'color', value: '#ffffff' }) as HTMLInputElement;
    this.roughInput = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0.6' }) as HTMLInputElement;
    this.metalInput = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0' }) as HTMLInputElement;
    this.visInput = el('input', { type: 'checkbox', checked: 'true' }) as HTMLInputElement;
    this.roughVal = el('span', { className: 'val' }, '0.60');
    this.metalVal = el('span', { className: 'val' }, '0.00');

    this.modeButtons = (['translate', 'rotate', 'scale'] as const).map((m) =>
      el('button', { on: { click: () => this.setMode(m) } }, m.charAt(0).toUpperCase())
    );

    this.bind();
    this.render();
    this.engine.graph.onSelectionChange(() => this.render());
    this.engine.graph.onChange(() => this.render());

    // Refresh when gizmo transforms the object.
    this.engine.transform.controls.addEventListener('change', () => {
      if (this.engine.graph.selected) this.renderValues();
    });
  }

  private bind(): void {
    this.nameInput.addEventListener('blur', () => {
      const obj = this.engine.graph.selected;
      if (obj) {
        obj.meta.name = this.nameInput.value || 'Object';
        obj.three.name = obj.meta.name;
      }
    });

    this.colorInput.addEventListener('input', () => {
      const obj = this.engine.graph.selected;
      if (obj) {
        obj.meta.color = this.colorInput.value;
        obj.applyMaterial();
      }
    });

    this.roughInput.addEventListener('input', () => {
      const v = parseFloat(this.roughInput.value);
      text(this.roughVal, v.toFixed(2));
      const obj = this.engine.graph.selected;
      if (obj) {
        obj.meta.roughness = v;
        obj.applyMaterial();
      }
    });

    this.metalInput.addEventListener('input', () => {
      const v = parseFloat(this.metalInput.value);
      text(this.metalVal, v.toFixed(2));
      const obj = this.engine.graph.selected;
      if (obj) {
        obj.meta.metalness = v;
        obj.applyMaterial();
      }
    });

    this.visInput.addEventListener('change', () => {
      const obj = this.engine.graph.selected;
      if (obj) {
        obj.meta.visible = this.visInput.checked;
        obj.three.visible = this.visInput.checked;
      }
    });
  }

  private setMode(mode: 'translate' | 'rotate' | 'scale'): void {
    this.engine.setTransformMode(mode);
    for (const b of this.modeButtons) b.classList.toggle('active', b.textContent === mode.charAt(0).toUpperCase());
  }

  private renderValues(): void {
    const obj = this.engine.graph.selected;
    if (!obj) return;

    const fields = this.element.querySelectorAll('.field-val');
    if (fields.length >= 9) {
      // Pos
      (fields[0] as HTMLInputElement).value = obj.three.position.x.toFixed(2);
      (fields[1] as HTMLInputElement).value = obj.three.position.y.toFixed(2);
      (fields[2] as HTMLInputElement).value = obj.three.position.z.toFixed(2);
      // Rot
      (fields[3] as HTMLInputElement).value = THREE.MathUtils.radToDeg(obj.three.rotation.x).toFixed(1);
      (fields[4] as HTMLInputElement).value = THREE.MathUtils.radToDeg(obj.three.rotation.y).toFixed(1);
      (fields[5] as HTMLInputElement).value = THREE.MathUtils.radToDeg(obj.three.rotation.z).toFixed(1);
      // Scale
      (fields[6] as HTMLInputElement).value = obj.three.scale.x.toFixed(2);
      (fields[7] as HTMLInputElement).value = obj.three.scale.y.toFixed(2);
      (fields[8] as HTMLInputElement).value = obj.three.scale.z.toFixed(2);
    }
  }

  private render(): void {
    const obj = this.engine.graph.selected;

    if (!obj) {
      this.element.innerHTML = '';
      this.element.append(
        el('p', { className: 'empty' }, 'No object selected.'),
        el('p', { className: 'hint' }, 'Tap an object in the viewport or the hierarchy.')
      );
      return;
    }

    this.nameInput.value = obj.meta.name;
    this.colorInput.value = obj.meta.color;
    this.roughInput.value = String(obj.meta.roughness);
    this.metalInput.value = String(obj.meta.metalness);
    this.visInput.checked = obj.meta.visible;
    text(this.roughVal, obj.meta.roughness.toFixed(2));
    text(this.metalVal, obj.meta.metalness.toFixed(2));

    const seg = el('div', { className: 'seg' });
    for (const b of this.modeButtons) seg.appendChild(b);
    this.setMode(this.engine.transform.controls.mode as 'translate' | 'rotate' | 'scale');

    const numInput = (axis: 'x' | 'y' | 'z', type: 'pos' | 'rot' | 'scale') => {
      const val = type === 'rot' ? THREE.MathUtils.radToDeg(obj.three.rotation[axis]) : (type === 'scale' ? obj.three.scale[axis] : obj.three.position[axis]);
      const inp = el('input', {
        className: 'field-val',
        type: 'number',
        step: type === 'rot' ? '1' : '0.1',
        value: val.toFixed(type === 'rot' ? 1 : 2)
      }) as HTMLInputElement;

      inp.addEventListener('change', () => {
        const v = parseFloat(inp.value);
        if (isNaN(v)) return;
        if (type === 'pos') obj.three.position[axis] = v;
        else if (type === 'rot') obj.three.rotation[axis] = THREE.MathUtils.degToRad(v);
        else if (type === 'scale') obj.three.scale[axis] = Math.max(0.001, v);
      });
      return inp;
    };

    this.element.innerHTML = '';
    this.element.append(
      el('label', { className: 'field' }, el('span', {}, 'Name'), this.nameInput),
      el('div', { className: 'field' }, el('span', {}, 'Pos'), numInput('x', 'pos'), numInput('y', 'pos'), numInput('z', 'pos')),
      el('div', { className: 'field' }, el('span', {}, 'Rot'), numInput('x', 'rot'), numInput('y', 'rot'), numInput('z', 'rot')),
      el('div', { className: 'field' }, el('span', {}, 'Scale'), numInput('x', 'scale'), numInput('y', 'scale'), numInput('z', 'scale')),
      el('div', { className: 'field' }, el('span', {}, 'Color'), this.colorInput),
      el('div', { className: 'field' }, el('span', {}, 'Roughness'), this.roughInput, this.roughVal),
      el('div', { className: 'field' }, el('span', {}, 'Metalness'), this.metalInput, this.metalVal),
      el('label', { className: 'field' }, this.visInput, el('span', {}, 'Visible')),
      el('div', { className: 'field' }, el('span', {}, 'Transform mode'), seg),
      el(
        'div',
        { className: 'actions' },
        el('button', { on: { click: () => this.engine.duplicateSelected() } }, 'Duplicate'),
        el('button', { className: 'danger', on: { click: () => this.engine.deleteSelected() } }, 'Delete')
      )
    );
  }
}