import * as THREE from 'three';
import { STLExporter as ThreeSTLExporter } from 'three/addons/exporters/STLExporter.js';

/**
 * STL export (binary). Geometry only: STL stores triangles without
 * materials, skeletons or animation data.
 */
export class STLExporter {
  private readonly exporter = new ThreeSTLExporter();

  export(scene: THREE.Object3D): Blob {
    const data = this.exporter.parse(scene, { binary: true });
    let buffer: ArrayBuffer;
    if (data instanceof ArrayBuffer) {
      buffer = data;
    } else if (data instanceof DataView) {
      buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    } else {
      buffer = new TextEncoder().encode(String(data)).buffer as ArrayBuffer;
    }
    return new Blob([buffer], { type: 'model/stl' });
  }
}

export const STL_EXPORT_STATUS = 'implemented';
