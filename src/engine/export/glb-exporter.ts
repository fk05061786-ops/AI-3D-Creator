import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

/**
 * GLB/GLTF export. Wraps the async exporter in a Promise so callers can
 * `await` and get a Blob they can download.
 */
export class GLBExporter {
  private readonly exporter = new GLTFExporter();

  async export(scene: THREE.Scene, options: { binary?: boolean } = {}): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.exporter.parse(
        scene,
        (result) => {
          const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
          resolve(blob);
        },
        (error) => reject(new Error('GLB export failed: ' + (error?.message || error))),
        { binary: options.binary ?? true }
      );
    });
  }

  /** Download the current scene as a .glb file. */
  async download(scene: THREE.Scene, filename = 'AI-3D-Creator.glb'): Promise<void> {
    const blob = await this.export(scene);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
}

