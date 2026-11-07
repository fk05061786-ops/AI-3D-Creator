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
          this.loader.parse(arrayBuffer, '', (gltf) => {
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
    // Traverse the GLTF scene and add each object to the scene graph.
    root.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.Light || node instanceof THREE.Camera) {
        const meta = {
          id: crypto.randomUUID(),
          name: node.name || 'Imported Object',
          primitive: undefined,
          color: '#ffffff',
          roughness: 0.6,
          metalness: 0,
          visible: node.visible,
          locked: false,
          parentId: null,
        };
        const sceneObject = new THREE.Object3D();
        sceneObject.name = meta.name;
        sceneObject.visible = meta.visible;
        sceneObject.userData = { meta };
        node.traverse((child) => {
          sceneObject.add(child);
        });
        graph.root.add(sceneObject);
            graph.objects.push(new SceneObject(sceneObject, meta));
      }
    });
  }
}