import * as THREE from 'three';
import { SceneObject } from '../core/object-model';

/**
 * Modifier system that preserves the original mesh.
 */
export class ModifierSystem {
  private _mirroredObjects: Map<string, {mesh: THREE.Mesh, axis: 'x' | 'y' | 'z'}> = new Map();
  private _originalGeometries: Map<string, THREE.BufferGeometry> = new Map();
  private _subdividedObjects: Map<string, {mesh: THREE.Mesh, level: number}> = new Map();

  /**
   * Apply a Mirror modifier to an object.
   * The original mesh remains unchanged; a mirrored copy is added to the parent.
   */
  applyMirror(object: SceneObject, axis: 'x' | 'y' | 'z' = 'x'): void {
    if (!(object.three instanceof THREE.Mesh)) return;
    if (this._mirroredObjects.has(object.meta.id)) return; // already applied

    // Store original geometry for potential removal
    const originalGeo = object.three.geometry.clone();
    this._originalGeometries.set(object.meta.id, originalGeo);

    // Mirror vertex positions
    const geometry = object.three.geometry.clone();
    const posAttr = geometry.attributes.position;

    // Handle indexed and non-indexed geometry
    const mirroredGeo = this.mirrorGeometry(geometry, axis);

    const mirroredMesh = new THREE.Mesh(mirroredGeo, object.three.material);
    mirroredMesh.position.copy(object.three.position);
    mirroredMesh.rotation.copy(object.three.rotation);
    mirroredMesh.scale.copy(object.three.scale);

    // Position the mirrored copy adjacent to the original
    const offset = new THREE.Vector3();
    offset.set(0, 0, 0);
    if (axis === 'x') offset.x = -1;
    if (axis === 'y') offset.y = -1;
    if (axis === 'z') offset.z = -1;
    mirroredMesh.position.add(offset);

    if (object.three.parent) {
      object.three.parent.add(mirroredMesh);
    }

    this._mirroredObjects.set(object.meta.id, { mesh: mirroredMesh, axis });
  }

  /**
   * Remove a previously applied Mirror modifier.
   */
  removeMirror(object: SceneObject): void {
    const data = this._mirroredObjects.get(object.meta.id);
    if (data) {
      if (data.mesh.parent) data.mesh.parent.remove(data.mesh);
      this._mirroredObjects.delete(object.meta.id);
    }

    // Restore original geometry
    if (this._originalGeometries.has(object.meta.id) && object.three instanceof THREE.Mesh) {
      object.three.geometry = this._originalGeometries.get(object.meta.id)!;
      this._originalGeometries.delete(object.meta.id);
    }
  }

  /**
   * Mirror geometry along the specified axis.
   */
  private mirrorGeometry(geometry: THREE.BufferGeometry, axis: 'x' | 'y' | 'z'): THREE.BufferGeometry {
    const mirroredGeo = geometry.clone();
    const posAttr = mirroredGeo.attributes.position;

    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);

      if (axis === 'x') posAttr.setXYZ(i, -x, y, z);
      if (axis === 'y') posAttr.setXYZ(i, x, -y, z);
      if (axis === 'z') posAttr.setXYZ(i, x, y, -z);
    }

    mirroredGeo.computeVertexNormals();
    return mirroredGeo;
  }

  /**
   * Apply a Subdivision modifier to an object.
   * The original mesh remains unchanged; a subdivided copy is added to the parent.
   */
  applySubdivision(object: SceneObject, level: number = 1): void {
    if (!(object.three instanceof THREE.Mesh)) return;
    if (this._subdividedObjects.has(object.meta.id)) return; // already applied

    // Store original geometry for potential removal
    const originalGeo = object.three.geometry.clone();
    this._originalGeometries.set(object.meta.id, originalGeo);

    // Create subdivided geometry
    const subdividedGeo = this.subdivideGeometry(object.three.geometry, level);

    const subdividedMesh = new THREE.Mesh(subdividedGeo, object.three.material);
    subdividedMesh.position.copy(object.three.position);
    subdividedMesh.rotation.copy(object.three.rotation);
    subdividedMesh.scale.copy(object.three.scale);

    if (object.three.parent) {
      object.three.parent.add(subdividedMesh);
    }

    this._subdividedObjects.set(object.meta.id, { mesh: subdividedMesh, level });
  }

  /**
   * Remove a previously applied Subdivision modifier.
   */
  removeSubdivision(object: SceneObject): void {
    const data = this._subdividedObjects.get(object.meta.id);
    if (data) {
      if (data.mesh.parent) data.mesh.parent.remove(data.mesh);
      this._subdividedObjects.delete(object.meta.id);
    }

    // Restore original geometry
    if (this._originalGeometries.has(object.meta.id) && object.three instanceof THREE.Mesh) {
      object.three.geometry = this._originalGeometries.get(object.meta.id)!;
      this._originalGeometries.delete(object.meta.id);
    }
  }

  /**
   * Subdivide geometry using Three.js's built-in capabilities.
   */
  private subdivideGeometry(geometry: THREE.BufferGeometry, level: number): THREE.BufferGeometry {
    // Use custom midpoint subdivision implementation
    const subdividedGeo = this.subdivideMidpoint(geometry, level);
    subdividedGeo.computeVertexNormals();
    return subdividedGeo;
  }

  /**
   * Midpoint subdivision implementation.
   */
  private subdivideMidpoint(geometry: THREE.BufferGeometry, level: number): THREE.BufferGeometry {
    const posAttr = geometry.attributes.position;
    const indexAttr = geometry.index;

    for (let l = 0; l < level; l++) {
      const newPositions: number[] = [];
      const newIndices: number[] = [];
      const vertexMap: Map<string, number> = new Map();

      if (indexAttr) {
        for (let i = 0; i < indexAttr.count; i += 3) {
          const a = indexAttr.getX(i);
          const b = indexAttr.getX(i + 1);
          const c = indexAttr.getX(i + 2);

          const pA = new THREE.Vector3().fromBufferAttribute(posAttr, a);
          const pB = new THREE.Vector3().fromBufferAttribute(posAttr, b);
          const pC = new THREE.Vector3().fromBufferAttribute(posAttr, c);

          const pAB = pA.clone().add(pB).multiplyScalar(0.5);
          const pBC = pB.clone().add(pC).multiplyScalar(0.5);
          const pCA = pC.clone().add(pA).multiplyScalar(0.5);

          const keyAB = `${pAB.x},${pAB.y},${pAB.z}`;
          const keyBC = `${pBC.x},${pBC.y},${pBC.z}`;
          const keyCA = `${pCA.x},${pCA.y},${pCA.z}`;

          const idxAB = vertexMap.get(keyAB) ?? vertexMap.size;
          const idxBC = vertexMap.get(keyBC) ?? vertexMap.size + 1;
          const idxCA = vertexMap.get(keyCA) ?? vertexMap.size + 2;

          vertexMap.set(keyAB, idxAB);
          vertexMap.set(keyBC, idxBC);
          vertexMap.set(keyCA, idxCA);

          newPositions.push(pAB.x, pAB.y, pAB.z);
          newPositions.push(pBC.x, pBC.y, pBC.z);
          newPositions.push(pCA.x, pCA.y, pCA.z);

          newIndices.push(a, idxAB, idxCA);
          newIndices.push(b, idxBC, idxAB);
          newIndices.push(c, idxCA, idxBC);
          newIndices.push(idxAB, idxBC, idxCA);
        }
      } else {
        for (let i = 0; i < posAttr.count; i += 3) {
          const a = i;
          const b = i + 1;
          const c = i + 2;

          const pA = new THREE.Vector3().fromBufferAttribute(posAttr, a);
          const pB = new THREE.Vector3().fromBufferAttribute(posAttr, b);
          const pC = new THREE.Vector3().fromBufferAttribute(posAttr, c);

          const pAB = pA.clone().add(pB).multiplyScalar(0.5);
          const pBC = pB.clone().add(pC).multiplyScalar(0.5);
          const pCA = pC.clone().add(pA).multiplyScalar(0.5);

          const keyAB = `${pAB.x},${pAB.y},${pAB.z}`;
          const keyBC = `${pBC.x},${pBC.y},${pBC.z}`;
          const keyCA = `${pCA.x},${pCA.y},${pCA.z}`;

          const idxAB = vertexMap.get(keyAB) ?? vertexMap.size;
          const idxBC = vertexMap.get(keyBC) ?? vertexMap.size + 1;
          const idxCA = vertexMap.get(keyCA) ?? vertexMap.size + 2;

          vertexMap.set(keyAB, idxAB);
          vertexMap.set(keyBC, idxBC);
          vertexMap.set(keyCA, idxCA);

          newPositions.push(pAB.x, pAB.y, pAB.z);
          newPositions.push(pBC.x, pBC.y, pBC.z);
          newPositions.push(pCA.x, pCA.y, pCA.z);

          newIndices.push(a, idxAB, idxCA);
          newIndices.push(b, idxBC, idxAB);
          newIndices.push(c, idxCA, idxBC);
          newIndices.push(idxAB, idxBC, idxCA);
        }
      }

      geometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
      if (indexAttr) {
        geometry.setIndex(newIndices);
      }
    }

    return geometry;
  }

}