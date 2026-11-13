import { SceneGraph, SerializedScene } from './scene-graph';
import type { SerializedRig } from '../rigging/skeleton';
import type { SerializedAnimationClip } from '../animation/animation-system';

/**
 * Project persistence. A project is a plain JSON document with the
 * scene graph serialized by SceneGraph.toJSON(). This keeps the format
 * independent of the file system and trivially portable to a future
 * server-backed save system.
 */
export interface Project {
  version: 1;
  name: string;
  createdAt: number;
  updatedAt: number;
  scene: SerializedScene;
  rig?: SerializedRig | null;
  animations?: SerializedAnimationClip[] | null;
}

export interface ProjectExtras {
  rig?: SerializedRig | null;
  animations?: SerializedAnimationClip[] | null;
}

export class ProjectManager {
  private readonly prefix = 'ai3d:projects';

  /** Serialize the current scene graph into a Project document. */
  createProject(name: string, graph: SceneGraph, extras: ProjectExtras = {}): Project {
    const now = Date.now();
    return {
      version: 1,
      name: name || 'Untitled',
      createdAt: now,
      updatedAt: now,
      scene: graph.toJSON(),
      rig: extras.rig ?? null,
      animations: extras.animations ?? null,
    };
  }

  /** Persist a project to localStorage under its name. */
  save(project: Project): void {
    project.updatedAt = Date.now();
    try {
      const all = this.list();
      all[project.name] = project;
      localStorage.setItem(this.prefix, JSON.stringify(all));
    } catch (err) {
      const error = new Error('Could not save project: ' + (err as Error).message);
      Object.assign(error, { cause: err });
      throw error;
    }
  }

  /** Load a saved project by name. Returns null if it does not exist. */
  load(name: string): Project | null {
    const all = this.list();
    return all[name] || null;
  }

  /** List the names of all saved projects. */
  listNames(): string[] {
    return Object.keys(this.list()).sort();
  }

  /** Delete a saved project. */
  delete(name: string): void {
    const all = this.list();
    delete all[name];
    localStorage.setItem(this.prefix, JSON.stringify(all));
  }

  /** Download a project as a .json file. */
  download(project: Project, filename?: string): void {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || project.name.replace(/\s+/g, '_').toLowerCase() + '.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  /** Import a project from a JSON file. */
  async import(file: File): Promise<Project> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result)) as Project;
          if (data.version !== 1 || !data.scene) throw new Error('Invalid project file');
          resolve(data);
        } catch (err) {
          reject(new Error('Could not import project: ' + (err as Error).message));
        }
      };
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsText(file);
    });
  }

  private list(): Record<string, Project> {
    try {
      const raw = localStorage.getItem(this.prefix);
      return raw ? (JSON.parse(raw) as Record<string, Project>) : {};
    } catch {
      return {};
    }
  }
}