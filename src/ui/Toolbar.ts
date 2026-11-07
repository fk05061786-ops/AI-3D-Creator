import { el } from './UILite';
import { EditorEngine } from '../engine/core/editor-engine';

interface Actions {
  engine: EditorEngine;
  onExport: () => void;
  onClear: () => void;
  onImport: () => void;
  onToggleEditMode: () => void;
}

/**
 * Top toolbar: add primitives, camera reset, export, clear.
 * Mobile-first: horizontal scroll row of large tap targets.
 */
export function buildToolbar({ engine, onExport, onClear, onImport, onToggleEditMode }: Actions): HTMLElement {
  const add = (type: 'cube' | 'sphere' | 'cylinder' | 'plane', label: string) =>
    el('button', { on: { click: () => engine.addPrimitive(type) } }, label);

  return el(
    'nav',
    { className: 'toolbar' },
    add('cube', 'Cube'),
    add('sphere', 'Sphere'),
    add('cylinder', 'Cylinder'),
    add('plane', 'Plane'),
    el('button', { on: { click: () => engine.resetCamera() } }, 'Reset view'),
    el('button', { className: 'modeling-btn', on: { click: onToggleEditMode } }, 'Edit Mode'),
    el('button', { on: { click: onImport } }, 'Import GLB'),
    el('button', { on: { click: onExport } }, 'Export GLB'),
    el('button', { className: 'danger', on: { click: onClear } }, 'Clear')
  );
}