/**
 * Main application entry. Creates the EditorEngine, wires the UI
 * (toolbar, inspector, hierarchy, project manager), and starts the
 * WebGL render loop.
 */

import { EditorEngine } from './engine/core/editor-engine';
import { GLBImporter } from './engine/export/glb-importer';
import type { ExportFormat } from './engine/export/export-manager';
import { buildToolbar } from './ui/Toolbar';
import { Inspector } from './ui/Inspector';
import { Hierarchy } from './ui/Hierarchy';
import { EditModePanel } from './ui/modeling/EditModePanel';
import { AIGeneratorPanel } from './ui/AIGeneratorPanel';
import { APIManagerPanel } from './ui/APIManagerPanel';
import { APIManager } from './ai/api-manager';
import { ProjectManagerUI } from './ui/ProjectManager';
import { RiggingPanel } from './ui/RiggingPanel';
import { AnimationPanel } from './ui/AnimationPanel';

function init(): void {
  const app = document.getElementById('app')!;

  // Create the 3D engine.
  const engine = new EditorEngine(app.querySelector('#viewport')!);

  // Mount project manager controls
  new ProjectManagerUI(engine);

  // Build the UI.
  const toolbar = buildToolbar({ engine, onExport: handleExport, onClear: handleClear, onImport: handleImport, onToggleEditMode: () => {
    engine.toggleEditMode();
  } });
  app.prepend(toolbar);

  const sidebar = document.getElementById('sidebar')!;

  // Provider configuration and generation share one API manager.
  const apiManager = new APIManager();
  const apiPanel = new APIManagerPanel(apiManager, engine);
  sidebar.appendChild(apiPanel.element);

  // Add AI Generator Panel
  const aiPanel = new AIGeneratorPanel(engine, apiManager);
  sidebar.appendChild(aiPanel.element);

  // Add Edit Mode / Modeling Panel
  const editModePanel = new EditModePanel(engine);
  sidebar.appendChild(editModePanel.element);

  const rigPanel = new RiggingPanel(engine);
  sidebar.appendChild(rigPanel.element);

  const animationPanel = new AnimationPanel(engine);
  sidebar.appendChild(animationPanel.element);

  const inspector = new Inspector(engine);
  sidebar.appendChild(inspector.element);

  const hierarchy = new Hierarchy(engine);
  sidebar.appendChild(hierarchy.element);

  const statusEl = app.querySelector('.project-bar .status') as HTMLElement;

  async function handleExport(format: ExportFormat = 'glb'): Promise<void> {
    if (!statusEl) return;
    statusEl.textContent = 'Exporting…';
    try {
      const filename = await engine.exporter.download(format);
      statusEl.textContent = 'Exported ' + filename;
    } catch (err) {
      statusEl.textContent = 'Export failed: ' + (err as Error).message;
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
  window.ai3d = { engine, statusEl };
  console.log('AI 3D Creator initialized. Open DevTools for engine access.');
}

declare global {
  interface Window {
    ai3d: {
      engine: EditorEngine;
      statusEl: HTMLElement;
    };
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}