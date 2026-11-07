import * as THREE from 'three';
import { SceneObject } from '../core/object-model';

export type SculptBrushType = 'draw' | 'smooth' | 'grab' | 'inflate';

export class SculptingEngine {
  private _brushType: SculptBrushType = 'draw';
  private _radius: number = 0.5;
  private _strength: number = 0.2;

  get brushType() { return this._brushType; }
  setBrushType(type: SculptBrushType) { this._brushType = type; }

  get radius() { return this._radius; }
  setRadius(r: number) { this._radius = Math.max(0.05, r); }

  get strength() { return this._strength; }
  setStrength(s: number) { this._strength = Math.max(0.01, Math.min(1.0, s)); }

  /**
   * Apply sculpting stroke to the target object at the hit point.
   */
  applyStroke(object: SceneObject, hitPoint: THREE.Vector3, normal: THREE.Vector3): void {
    if (!(object.three instanceof THREE.Mesh)) return;
    const geometry = object.three.geometry;
    if (!geometry || !geometry.attributes.position) return;

    const posAttr = geometry.attributes.position;
    const worldMatrix = object.three.matrixWorld;
    const inverseMatrix = new THREE.Matrix4().copy(worldMatrix).invert();

    // Transform hit point to local space
    const localHit = hitPoint.clone().applyMatrix4(inverseMatrix);
    const localRadius = this._radius;

    const vertex = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i++) {
      vertex.fromBufferAttribute(posAttr, i);
      const dist = vertex.distanceTo(localHit);

      if (dist < localRadius) {
        // Falloff calculation (smooth step)
        const factor = (1 - (dist / localRadius)) * this._strength;

        switch (this._brushType) {
          case 'draw':
            // Push along normal
            vertex.addScaledVector(normal, factor);
            break;
          case 'smooth':
            // Simple averaging towards neighbors (simplified as pulling toward hit)
            vertex.lerp(localHit, factor * 0.1);
            break;
          case 'grab':
            // Pull towards hit point
            vertex.lerp(localHit, factor);
            break;
          case 'inflate':
            // Push outwards from center
            const dir = vertex.clone().sub(localHit).normalize();
            vertex.addScaledVector(dir, factor * 0.5);
            break;
        }

        posAttr.setXYZ(i, vertex.x, vertex.y, vertex.z);
      }
    }

    posAttr.needsUpdate = true;
    geometry.computeVertexNormals();
  }
}