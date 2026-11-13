import * as THREE from 'three';
import { OBJExporter as ThreeOBJExporter } from 'three/addons/exporters/OBJExporter.js';

/**
 * Wavefront OBJ export. Geometry only: OBJ has no skeleton or animation
 * concept, so rigged meshes are exported in their current pose.
 */
export class OBJExporter {
  private readonly exporter = new ThreeOBJExporter();

  export(scene: THREE.Object3D): Blob {
    const text = this.exporter.parse(scene);
    return new Blob([text], { type: 'text/plain' });
  }
}

export const OBJ_EXPORT_STATUS = 'implemented';
