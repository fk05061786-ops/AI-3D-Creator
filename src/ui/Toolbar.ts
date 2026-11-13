import { el } from './UILite';
import { EditorEngine } from '../engine/core/editor-engine';
import type { ExportFormat } from '../engine/export/export-manager';

interface Actions {
  engine: EditorEngine;
  onExport: (format: ExportFormat) => void;
  onClear: () => void;
  onImport: () => void;
  onToggleEditMode: () => void;
}

const FORMATS: { format: ExportFormat; label: string }[] = [
  { format: 'glb', label: 'GLB (binary)' },
  { format: 'gltf', label: 'GLTF (json)' },
  { format: 'obj', label: 'OBJ' },
  { format: 'stl', label: 'STL' },
];

/**
 * Top toolbar: add primitives, camera reset, export menu, clear.
 * Mobile-first: horizontal scroll row of large tap targets.
 */
export function buildToolbar({
  engine,
  onExport,
  onClear,
  onImport,
  onToggleEditMode,
}: Actions): HTMLElement {
  const add = (type: 'cube' | 'sphere' | 'cylinder' | 'plane', label: string) =>
    el('button', { on: { click: () => engine.addPrimitive(type) } }, label);

  const nav = el(
    'nav',
    { className: 'toolbar' },
    add('cube', 'Cube'),
    add('sphere', 'Sphere'),
    add('cylinder', 'Cylinder'),
    add('plane', 'Plane'),
    el('button', { on: { click: () => engine.resetCamera() } }, 'Reset view'),
    el('button', { className: 'modeling-btn', on: { click: onToggleEditMode } }, 'Edit Mode'),
    el('button', { on: { click: onImport } }, 'Import GLB'),
    buildExportMenu(onExport),
    el('button', { className: 'danger', on: { click: onClear } }, 'Clear')
  );
  return nav;
}

/**
 * Export dropdown. The menu is fixed-positioned and appended to the body so
 * the toolbar's horizontal overflow cannot clip it on narrow screens.
 */
function buildExportMenu(onExport: (format: ExportFormat) => void): HTMLElement {
  const menu = el('div', { className: 'export-menu' });
  for (const item of FORMATS) {
    menu.appendChild(
      el(
        'button',
        {
          on: {
            click: () => {
              close();
              onExport(item.format);
            },
          },
        },
        item.label
      )
    );
  }
  document.body.appendChild(menu);

  const button = el('button', { className: 'export-btn' }, 'Export ▾');

  const close = (): void => {
    menu.classList.remove('open');
  };

  const open = (): void => {
    const rect = button.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 200))}px`;
    menu.classList.add('open');
  };

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (menu.classList.contains('open')) close();
    else open();
  });

  document.addEventListener('click', (event) => {
    if (!menu.classList.contains('open')) return;
    if (menu.contains(event.target as Node)) return;
    close();
  });

  return button;
}
