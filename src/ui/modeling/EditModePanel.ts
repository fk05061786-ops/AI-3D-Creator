import { el, text } from '../UILite';
import { EditorEngine } from '../../engine/core/editor-engine';
import { EditMode } from '../../engine/modeling/mesh-editor';
import * as THREE from 'three';

/**
 * Edit mode panel for mesh editing.
 */
export class EditModePanel {
  readonly element: HTMLElement;
  private readonly modeButtons: Partial<Record<EditMode, HTMLButtonElement>> = {};
  private readonly brushTypeButtons: Partial<Record<string, HTMLButtonElement>> = {};
  private readonly modelingButtons: Partial<Record<string, HTMLButtonElement>> = {};

  constructor(private readonly engine: EditorEngine) {
    this.element = el('div', { className: 'panel' });
    this.element.append(el('h3', {}, 'Mesh Editing'));

    // Edit mode selection
    const modeGroup = el('div', { className: 'mode-group' });
    modeGroup.append(el('span', {}, 'Edit Mode:'));

    for (const mode of ['object', 'vertex', 'edge', 'face'] as const) {
      this.modeButtons[mode] = el('button', {
        className: 'mode-btn' + (mode === 'object' ? ' active' : ''),
        on: { click: () => this.setEditMode(mode) }
      }, mode.charAt(0).toUpperCase() + mode.slice(1));
      modeGroup.appendChild(this.modeButtons[mode]);
    }
    this.element.appendChild(modeGroup);

    // Brush controls
    const brushGroup = el('div', { className: 'brush-group' });
    brushGroup.append(el('span', {}, 'Brush:'));

    for (const type of ['draw', 'smooth', 'grab', 'inflate'] as const) {
      this.brushTypeButtons[type] = el('button', {
        className: 'brush-btn' + (type === 'draw' ? ' active' : ''),
        on: { click: () => this.setBrushType(type) }
      }, type.charAt(0).toUpperCase() + type.slice(1));
      brushGroup.appendChild(this.brushTypeButtons[type]);
    }
    this.element.appendChild(brushGroup);

    // Modeling operations
    const modelingGroup = el('div', { className: 'modeling-group' });
    modelingGroup.append(el('span', {}, 'Operations:'));

    this.modelingButtons.extrude = el('button', {
      className: 'modeling-btn',
      on: { click: () => this.applyModelingOperation('extrude', 0.5) }
    }, 'Extrude');
    this.modelingButtons.inset = el('button', {
      className: 'modeling-btn',
      on: { click: () => this.applyModelingOperation('inset', 0.2) }
    }, 'Inset');
    this.modelingButtons.bevel = el('button', {
      className: 'modeling-btn',
      on: { click: () => this.applyModelingOperation('bevel', 0.1) }
    }, 'Bevel');
    this.modelingButtons.subdivide = el('button', {
      className: 'modeling-btn',
      on: { click: () => this.applyModelingOperation('subdivide') }
    }, 'Subdivide');

    modelingGroup.append(
      this.modelingButtons.extrude,
      this.modelingButtons.inset,
      this.modelingButtons.bevel,
      this.modelingButtons.subdivide
    );
    this.element.appendChild(modelingGroup);

    // Mirror modifier
    const mirrorGroup = el('div', { className: 'mirror-group' });
    mirrorGroup.append(el('span', {}, 'Mirror:'));

    const mirrorX = el('button', {
      className: 'mirror-btn',
      on: { click: () => this.applyMirror('x') }
    }, 'X');
    const mirrorY = el('button', {
      className: 'mirror-btn',
      on: { click: () => this.applyMirror('y') }
    }, 'Y');
    const mirrorZ = el('button', {
      className: 'mirror-btn',
      on: { click: () => this.applyMirror('z') }
    }, 'Z');

    mirrorGroup.append(mirrorX, mirrorY, mirrorZ);
    this.element.appendChild(mirrorGroup);
  }

  private setEditMode(mode: EditMode): void {
    for (const btn of Object.values(this.modeButtons)) btn.classList.remove('active');
    this.modeButtons[mode].classList.add('active');
    this.engine.meshEditor.setMode(mode, this.engine.graph.selected);
  }

  private setBrushType(type: string): void {
    for (const btn of Object.values(this.brushTypeButtons)) btn.classList.remove('active');
    this.brushTypeButtons[type].classList.add('active');
    this.engine.sculpting.setBrushType(type as any);
  }

  private applyModelingOperation(operation: string, amount?: number): void {
    const selected = this.engine.graph.selected;
    if (!selected) {
      alert('No object selected');
      return;
    }

    if (!(selected.three instanceof THREE.Mesh)) {
      alert('Selected object is not a mesh');
      return;
    }

    try {
      switch (operation) {
        case 'extrude':
          this.engine.saveState('extrude', {
            id: selected.meta.id,
            originalGeometry: selected.three.geometry.clone()
          });
          this.engine.extrude(selected, amount || 0.5);
          break;
        case 'inset':
          this.engine.saveState('inset', {
            id: selected.meta.id,
            originalGeometry: selected.three.geometry.clone()
          });
          // TODO: Implement actual inset
          console.warn('Inset not implemented yet');
          break;
        case 'bevel':
          this.engine.saveState('bevel', {
            id: selected.meta.id,
            originalGeometry: selected.three.geometry.clone()
          });
          // TODO: Implement actual bevel
          console.warn('Bevel not implemented yet');
          break;
        case 'subdivide':
          this.engine.saveState('subdivide', {
            id: selected.meta.id,
            originalGeometry: selected.three.geometry.clone()
          });
          this.engine.subdivide(selected);
          break;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Modeling operation failed:', error);
      alert('Modeling operation failed: ' + message);
    }
  }

  private applyMirror(axis: 'x' | 'y' | 'z'): void {
    const selected = this.engine.graph.selected;
    if (!selected) {
      alert('No object selected');
      return;
    }

    try {
      this.engine.modifiers.applyMirror(selected, axis);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Mirror operation failed:', error);
      alert('Mirror operation failed: ' + message);
    }
  }
}