/**
 * Main application entry. Creates the EditorEngine, wires the UI
 * (toolbar, inspector, hierarchy, project manager), and starts the
 * WebGL render loop.
 */

import { el } from './ui/UILite';
import { EditorEngine } from './engine/core/editor-engine';
import { GLBExporter } from './engine/export/glb-exporter';
import { GLBImporter } from './engine/export/glb-importer';
import { buildToolbar } from './ui/Toolbar';
import { Inspector } from './ui/Inspector';
import { Hierarchy } from './ui/Hierarchy';

function init(): void {
  const app = document.getElementById('app')!;

  // Create the 3D engine.
  const engine = new EditorEngine(app.querySelector('#viewport')!);

  // Build the UI.
  const toolbar = buildToolbar({ engine, onExport: handleExport, onClear: handleClear, onImport: handleImport, onToggleEditMode: () => {
  engine.toggleEditMode();
} });
  app.prepend(toolbar);

  const sidebar = document.getElementById('sidebar')!;
  const inspector = new Inspector(engine);
  sidebar.appendChild(inspector.element);

  const hierarchy = new Hierarchy(engine);
  sidebar.appendChild(hierarchy.element);

  const statusEl = app.querySelector('.project-bar .status') as HTMLElement;

  async function handleExport(): Promise<void> {
    if (!statusEl) return;
    const prev = statusEl.textContent;
    if (prev) statusEl.textContent = 'Exporting…';
    try {
      const exporter = new GLBExporter();
      await exporter.download(engine.scene.three);
      if (statusEl) statusEl.textContent = 'Exported GLB';
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Export failed: ' + (err as Error).message;
    }
  }

  async function handleImport(): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb,.gltf';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (!statusEl) return;
      const prev = statusEl.textContent;
      if (prev) statusEl.textContent = 'Importing…';
      try {
        const importer = new GLBImporter();
        await importer.import(file, engine.graph);
        if (statusEl) statusEl.textContent = 'Imported GLB';
      } catch (err) {
        if (statusEl) statusEl.textContent = 'Import failed: ' + (err as Error).message;
      }
    };
    input.click();
  }

  function handleClear(): void {
    if (confirm('Clear all objects?')) {
      engine.clear();
    }
  }

  // Start the render loop (also starts the WebGL renderer).
  engine.start();

  // Expose for testing.
  (window as any).ai3d = { engine, statusEl };
  console.log('AI 3D Creator initialized. Open DevTools for engine access.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}