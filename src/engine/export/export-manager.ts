import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from './obj-exporter';
import { STLExporter } from './stl-exporter';
import { downloadBlob } from './file-download';
import type { SkeletonRig } from '../rigging/skeleton';
import type { AnimationSystem } from '../animation/animation-system';

export type ExportFormat = 'glb' | 'gltf' | 'obj' | 'stl';

export interface ExportResult {
  format: ExportFormat;
  filename: string;
  blob: Blob;
}

const EXTENSION: Record<ExportFormat, string> = {
  glb: '.glb',
  gltf: '.gltf',
  obj: '.obj',
  stl: '.stl',
};

/**
 * Single entry point for every supported 3D format. GLB/GLTF carry meshes,
 * materials, skeletons and animations; OBJ and STL are geometry-only.
 */
export class ExportManager {
  private readonly gltf = new GLTFExporter();
  private readonly obj = new OBJExporter();
  private readonly stl = new STLExporter();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly rig: SkeletonRig | null = null,
    private readonly animation: AnimationSystem | null = null
  ) {}

  async export(format: ExportFormat, filename?: string): Promise<ExportResult> {
    const name = this.withExtension(filename || 'AI-3D-Creator', format);
    this.rig?.beginExport();
    try {
      const blob = await this.buildBlob(format);
      return { format, filename: name, blob };
    } finally {
      this.rig?.endExport();
    }
  }

  async download(format: ExportFormat, filename?: string): Promise<string> {
    const result = await this.export(format, filename);
    await downloadBlob(result.blob, result.filename);
    return result.filename;
  }

  private withExtension(filename: string, format: ExportFormat): string {
    const base = filename.replace(/\.(glb|gltf|obj|stl)$/i, '');
    return base + EXTENSION[format];
  }

  private buildBlob(format: ExportFormat): Promise<Blob> {
    if (format === 'obj') return Promise.resolve(this.obj.export(this.scene));
    if (format === 'stl') return Promise.resolve(this.stl.export(this.scene));
    return this.buildGltfBlob(format === 'glb');
  }

  private buildGltfBlob(binary: boolean): Promise<Blob> {
    const animations = this.animation?.getClips() ?? [];
    return new Promise((resolve, reject) => {
      this.gltf.parse(
        this.scene,
        (result) => {
          if (binary) {
            resolve(new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' }));
            return;
          }
          const json = JSON.stringify(result, null, 2);
          resolve(new Blob([json], { type: 'model/gltf+json' }));
        },
        (error) => reject(new Error('Export failed: ' + (error?.message || error))),
        { binary, animations }
      );
    });
  }
}

export const EXPORT_STATUS = 'implemented';
