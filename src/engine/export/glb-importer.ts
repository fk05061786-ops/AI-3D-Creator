import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SceneGraph } from '../core/scene-graph';
import { SceneObject } from '../core/object-model';

/**
 * GLB/GLTF importer. Loads models into the scene graph.
 */
export class GLBImporter {
  private readonly loader: GLTFLoader;

  constructor() {
    this.loader = new GLTFLoader();
  }

  /**
   * Import a GLB/GLTF file into the scene graph.
   * @param file The file to import.
   * @param graph The scene graph to add objects to.
   * @returns Promise resolving to the imported SceneObject or null on error.
   */
  async import(file: File, graph: SceneGraph): Promise<THREE.Object3D | null> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const arrayBuffer = reader.result as ArrayBuffer;
          const header = new Uint8Array(arrayBuffer, 0, Math.min(4, arrayBuffer.byteLength));
          const isGlb =
            header[0] === 0x67 && header[1] === 0x6c && header[2] === 0x54 && header[3] === 0x46;
          const payload: ArrayBuffer | string = isGlb
            ? arrayBuffer
            : new TextDecoder().decode(arrayBuffer);
          this.loader.parse(payload, '', (gltf) => {
            const root = gltf.scene;
            if (!root) {
              reject(new Error('No scene found in GLB/GLTF file.'));
              return;
            }
            this.processGLTF(root, graph);
            resolve(root);
          }, (error) => {
            reject(new Error('Failed to load GLB/GLTF: ' + (error?.message || error)));
          });
        } catch (err) {
          reject(new Error('Error reading file: ' + (err as Error).message));
        }
      };
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Process a GLTF scene and add its objects to the scene graph.
   * @param root The root object of the GLTF scene.
   * @param graph The scene graph to add objects to.
   */
  private processGLTF(root: THREE.Object3D, graph: SceneGraph): void {
    // Keep the loaded hierarchy intact. Wrapping each mesh while traversing
    // detaches children mid-traversal and corrupts the imported model.
    const meta = {
      id: crypto.randomUUID(),
      name: root.name || 'Imported Model',
      primitive: undefined,
      color: '#ffffff',
      roughness: 0.6,
      metalness: 0,
      visible: root.visible,
      locked: false,
      parentId: null,
    };
    graph.add(new SceneObject(root, meta));
  }
}