import { el, modal, text } from './UILite';
import { ProjectManager } from '../engine/core/project-manager';
import type { Project } from '../engine/core/project-manager';
import { EditorEngine } from '../engine/core/editor-engine';

type ProjectAction = 'save' | 'load' | 'import';

/**
 * Project persistence UI. Handles saving/loading from localStorage,
 * importing a JSON file, and downloading/uploading projects via localStorage.
 * The low-level ProjectManager is used for the JSON operations.
 */
export class ProjectManagerUI {
  readonly element: HTMLElement;
  private readonly pm = new ProjectManager();
  private readonly nameInput: HTMLInputElement;
  private readonly statusEl: HTMLElement;
  private showState: Record<ProjectAction, boolean> = { save: false, load: false, import: false };
  private currentAction: ProjectAction | null = null;

  constructor(private readonly engine: EditorEngine) {
    this.element = el('div', { className: 'project-bar' });
    this.nameInput = el('input', { type: 'text', placeholder: 'Project name' }) as HTMLInputElement;
    this.statusEl = el('span', { className: 'status' }, 'Ready');
    this.element.append(this.setupHeader(), this.setupModal());

    let lastCheck = Date.now();
    const checkProjects = () => {
      if (Date.now() - lastCheck >= 1000) {
        this.render();
        lastCheck = Date.now();
      }
      requestAnimationFrame(checkProjects);
    };
    requestAnimationFrame(checkProjects);
  }

  private setupHeader(): HTMLElement {
    const header = el('div', { className: 'header-actions' });
    header.appendChild(el('button', { className: 'ghost', on: { click: () => this.open('load') } }, 'Load'));
    header.appendChild(el('button', { className: 'ghost', on: { click: () => this.open('save') } }, 'Save'));
    header.append(el('label', { className: 'import-btn' }, '⬇', el('input', { type: 'file', accept: 'application/json,.json' })));
    header.append(this.statusEl);
    return header;
  }

  private setupModal(): HTMLElement {
    return el('div', { id: 'project-modal' });
  }

  private open(action: ProjectAction): void {
    if (action === 'save') {
      this.nameInput.value = 'Untitled';
      this.currentAction = 'save';
      this.showProjectModal();
    } else {
      this.currentAction = action;
      this.showProjectModal();
    }
  }

  private showProjectModal(): void {
    const modalEl = this.element.querySelector('#project-modal') as HTMLElement;
    if (!modalEl) return;

    let content: Node = el('p', { className: 'empty' }, 'No project action selected.');
    const projects = this.pm.listNames();

    if (this.currentAction === 'save') {
      content = el('div', {}, this.nameInput, el('button', { on: { click: () => this.doSave() } }, 'Save'));
    } else if (this.currentAction === 'load') {
      const list = el('ul', { className: 'project-list' });
      for (const name of projects) {
        const li = el('li', {});
        li.appendChild(el('button', { on: { click: () => this.doLoad(name) } }, name));
        li.appendChild(
          el('button', {
            className: 'ghost danger',
            on: { click: () => this.doDelete(name) },
          })
        );
        list.appendChild(li);
      }
      content = el('div', {}, projects.length ? list : el('p', { className: 'empty' }, 'No saved projects.'), el('label', { className: 'import-btn' }, 'Import .json'));
    } else if (this.currentAction === 'import') {
      content = el('p', { className: 'empty' }, 'Select a file and click Import.');
    }

    const modalElement = modal(this.currentAction === 'save' ? 'Save project' : 'Load project', content, () => this.hideModal());
    modalEl.replaceChildren(modalElement);
  }

  private hideModal(): void {
    this.showProjectModal();
  }

  private async doSave(): Promise<void> {
    const project = this.pm.createProject(this.nameInput.value, this.engine.graph, {
      rig: this.engine.rig.serialize(),
      animations: this.engine.animation.serialize(),
    });
    this.pm.save(project);
    this.updateStatus('Saved "' + project.name + '"');
    this.hideModal();
  }

  private async doLoad(name: string): Promise<void> {
    const project = this.pm.load(name);
    if (!project) {
      this.updateStatus('Project not found');
      return;
    }
    this.restore(project);
    this.updateStatus('Loaded "' + name + '"');
    this.hideModal();
  }

  private async doDelete(name: string): Promise<void> {
    this.pm.delete(name);
    this.updateStatus('Deleted "' + name + '"');
    this.hideModal();
  }

  private async doImport(file: File): Promise<void> {
    const project = await this.pm.import(file);
    this.restore(project);
    this.updateStatus('Imported "' + project.name + '"');
    this.hideModal();
  }

  /** Rebuild the scene, then re-attach the rig and animation clips. */
  private restore(project: Project): void {
    this.engine.graph.fromJSON(project.scene);
    if (project.rig) this.engine.rig.load(project.rig, this.engine.graph);
    this.engine.animation.load(project.animations ?? []);
    this.engine.resetCamera();
  }

  private updateStatus(msg: string): void {
    text(this.statusEl, msg);
  }

  render(): void {
    // Called by the check loop for projects modal list updates if open.
    if (this.currentAction === 'load') this.showProjectModal();
  }
}