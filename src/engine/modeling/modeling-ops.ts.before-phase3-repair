import * as THREE from 'three';
import { BufferGeometry } from 'three';
import { SceneObject } from '../core/object-model';

/**
 * Helper class for modeling operations.
 */
export class ModelingOps {
  /**
   * Extrude selected faces along their normals.
   * @param object The object to modify.
   * @param amount Distance to extrude.
   */
  extrude(object: SceneObject, amount: number): void {
    if (!(object.three instanceof THREE.Mesh)) return;
    const geometry = object.three.geometry;
    if (!geometry.attributes.position) return;

    const mesh = object.three as THREE.Mesh;
    const originalGeometry = mesh.geometry;

    // Create a new geometry with the extruded faces
    const extrudedGeometry = this.createExtrudedGeometry(originalGeometry, amount);

    // Replace the geometry
    if (mesh.geometry) mesh.geometry = extrudedGeometry;
    mesh.geometry.computeVertexNormals();
  }

  /**
   * Create extruded geometry from the original.
   */
  private createExtrudedGeometry(originalGeometry: THREE.BufferGeometry, amount: number): THREE.BufferGeometry {
    const geometry = originalGeometry.clone();
    const posAttr = geometry.attributes.position;
    const indexAttr = geometry.index;
    // Remove unused Face3 reference

    // Get all faces
    const indices: number[] = indexAttr ? Array.from(indexAttr.array) : [];
    if (indexAttr) {
      // Indexed geometry
      for (let i = 0; i < indexAttr.count; i++) {
        indices.push(indexAttr.getX(i));
      }
    } else {
      // Non-indexed geometry
      for (let i = 0; i < posAttr.count; i++) {
        indices.push(i);
      }
    }

    // Create a new geometry with the extruded vertices
    const extrudedPositions: number[] = [];
    const extrudedIndices: number[] = [];
    const vertexMap: Map<number, number> = new Map();

    // Copy original vertices
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const z = posAttr.getZ(i);
      extrudedPositions.push(x, y, z);
      vertexMap.set(i, i);
    }

    // Process each face
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];

      // Get original vertices
      const pA = new THREE.Vector3().fromBufferAttribute(posAttr, a);
      const pB = new THREE.Vector3().fromBufferAttribute(posAttr, b);
      const pC = new THREE.Vector3().fromBufferAttribute(posAttr, c);

      // Calculate face normal
      const normal = new THREE.Vector3();
      normal.subVectors(pB, pA).cross(pC.clone().sub(pA)).normalize();

      // Extrude vertices
      const eA = pA.clone().add(normal.clone().multiplyScalar(amount));
      const eB = pB.clone().add(normal.clone().multiplyScalar(amount));
      const eC = pC.clone().add(normal.clone().multiplyScalar(amount));

      // Add extruded vertices to the new geometry
      const eAIndex = extrudedPositions.length / 3;
      const eBIndex = eAIndex + 1;
      const eCIndex = eBIndex + 1;

      extrudedPositions.push(eA.x, eA.y, eA.z);
      extrudedPositions.push(eB.x, eB.y, eB.z);
      extrudedPositions.push(eC.x, eC.y, eC.z);

      // Add indices for the original face and the extruded face
      extrudedIndices.push(a, b, c);
      extrudedIndices.push(eAIndex, eBIndex, eCIndex);
    }

    // Create the new geometry
    const newGeometry = new THREE.BufferGeometry();
    newGeometry.setAttribute('position', new THREE.Float32BufferAttribute(extrudedPositions, 3));
    newGeometry.setIndex(extrudedIndices);

    return newGeometry;
  }

  /**
   * Inset selected faces.
   * @param object The object to modify.
   * @param amount Inset distance.
   */
  inset(object: SceneObject, amount: number): void {
    if (!(object.three instanceof THREE.Mesh)) return;
    const geometry = object.three.geometry;
    if (!geometry.attributes.position) return;

    const mesh = object.three as THREE.Mesh;
    const originalGeometry = mesh.geometry;

    // Create inset geometry
    const insetGeometry = this.createInsetGeometry(originalGeometry, amount);

    // Replace the geometry
    mesh.geometry = insetGeometry;
    mesh.geometry.computeVertexNormals();
  }

  /**
   * Create inset geometry from the original.
   */
  private createInsetGeometry(originalGeometry: THREE.BufferGeometry, amount: number): THREE.BufferGeometry {
    const geometry = originalGeometry.clone();
    const posAttr = geometry.attributes.position;
    const indexAttr = geometry.index;


    // Build new geometry data
    const newPositions: number[] = [];
    const newIndices: number[] = [];
    const vertexMap: Map<string, number> = new Map();

    // Build face indices from the geometry's index attribute
    const indices: number[] = indexAttr ? Array.from(indexAttr.array) : [];
    for (let i = 0; i < posAttr.count; i++) indices.push(i);

    // Process each face and create inset
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];

      // Get original vertices
      const pA = new THREE.Vector3().fromBufferAttribute(posAttr, a);
      const pB = new THREE.Vector3().fromBufferAttribute(posAttr, b);
      const pC = new THREE.Vector3().fromBufferAttribute(posAttr, c);

      // Calculate face normal
      const normal = new THREE.Vector3();
      normal.subVectors(pB, pA).cross(pC.clone().sub(pA)).normalize();

      // Calculate inset vertices (move inward along normal)
      const insetAmount = Math.max(0.01, amount);
      const pA_inset = pA.clone().add(normal.clone().multiplyScalar(-insetAmount));
      const pB_inset = pB.clone().add(normal.clone().multiplyScalar(-insetAmount));
      const pC_inset = pC.clone().add(normal.clone().multiplyScalar(-insetAmount));

      // Add original vertices if not already in map
      const addVertex = (v: THREE.Vector3): number => {
        const key = `${v.x},${v.y},${v.z}`;
        if (!vertexMap.has(key)) {
          const idx = newPositions.length / 3;
          newPositions.push(v.x, v.y, v.z);
          vertexMap.set(key, idx);
          return idx;
        }
        return vertexMap.get(key)!;
      }

      // Add inset vertices if not already in map
      const addInsetVertex = (v: THREE.Vector3): number => {
        const key = `${v.x},${v.y},${v.z}`;
        if (!vertexMap.has(key)) {
          const idx = newPositions.length / 3;
          newPositions.push(v.x, v.y, v.z);
          vertexMap.set(key, idx);
          return idx;
        }
        return vertexMap.get(key)!;
      }

      const ia = addVertex(pA);
      const ib = addVertex(pB);
      const ic = addVertex(pC);
      const ia_inset = addInsetVertex(pA_inset);
      const ib_inset = addInsetVertex(pB_inset);
      const ic_inset = addInsetVertex(pC_inset);

      // Original face
      newIndices.push(ia, ib, ic);

      // Inset face
      newIndices.push(ia_inset, ib_inset, ic_inset);

      // Side faces (connecting original to inset)
      newIndices.push(ib, ia, ib_inset, ia_inset);
      newIndices.push(ic, ib, ic_inset, ib_inset);
      newIndices.push(ia, ic, ia_inset, ic_inset);
    }

    // Create the new geometry
    const newGeometry = new THREE.BufferGeometry();
    newGeometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    newGeometry.setIndex(newIndices);
    newGeometry.computeVertexNormals();

    return newGeometry;
  }

  /**
   * Bevel supported edges.
   * @param object The object to modify.
   * @param width Bevel width.
   * @param segments Number of segments around the bevel.
   */
  bevel(object: SceneObject, width: number, segments: number = 1): void {
    const mesh = object.three as THREE.Mesh;
    if (!mesh.geometry) return;

    try {
      // Create a new BufferGeometry for the beveled result
      const bevelGeometry = new THREE.BufferGeometry();

      // Get the original geometry attributes
      const positionAttr = mesh.geometry.attributes.position;
      const indexAttr = mesh.geometry.index;

      // Create arrays for new positions and indices
      const positions: number[] = [];
      const indices: number[] = indexAttr ? Array.from(indexAttr.array) : [];

      // Process each face and create beveled edges
      if (indexAttr) {
        for (let i = 0; i < indexAttr.count; i += 3) {
          const a = indexAttr.getX(i);
          const b = indexAttr.getX(i + 1);
          const c = indexAttr.getX(i + 2);

          // Get original vertices
          const pA = new THREE.Vector3().fromBufferAttribute(positionAttr, a);
          const pB = new THREE.Vector3().fromBufferAttribute(positionAttr, b);
          const pC = new THREE.Vector3().fromBufferAttribute(positionAttr, c);

          // Calculate face normal
          const normal = new THREE.Vector3();
          normal.subVectors(pB, pA).cross(pC.clone().sub(pA)).normalize();

          // Create beveled vertices
          const bevelOffset = normal.clone().multiplyScalar(width);
          const pA_bevel = pA.clone().add(bevelOffset);
          const pB_bevel = pB.clone().add(bevelOffset);
          const pC_bevel = pC.clone().add(bevelOffset);

          // Add vertices to positions array
          const baseIndex = positions.length / 3;
          positions.push(pA.x, pA.y, pA.z);
          positions.push(pB.x, pB.y, pB.z);
          positions.push(pC.x, pC.y, pC.z);
          positions.push(pA_bevel.x, pA_bevel.y, pA_bevel.z);
          positions.push(pB_bevel.x, pB_bevel.y, pB_bevel.z);
          positions.push(pC_bevel.x, pC_bevel.y, pC_bevel.z);

          // Add indices for the original and beveled faces
          indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
          indices.push(baseIndex + 3, baseIndex + 4, baseIndex + 5);

          // Add indices for the side faces
          indices.push(baseIndex, baseIndex + 1, baseIndex + 4);
          indices.push(baseIndex, baseIndex + 4, baseIndex + 3);
          indices.push(baseIndex + 1, baseIndex + 2, baseIndex + 5);
          indices.push(baseIndex + 1, baseIndex + 5, baseIndex + 4);
          indices.push(baseIndex + 2, baseIndex, baseIndex + 3);
          indices.push(baseIndex + 2, baseIndex + 3, baseIndex + 5);
        }
      } else {
        // Non-indexed geometry
        for (let i = 0; i < positionAttr.count; i += 3) {
          const a = i;
          const b = i + 1;
          const c = i + 2;

          // Get original vertices
          const pA = new THREE.Vector3().fromBufferAttribute(positionAttr, a);
          const pB = new THREE.Vector3().fromBufferAttribute(positionAttr, b);
          const pC = new THREE.Vector3().fromBufferAttribute(positionAttr, c);

          // Calculate face normal
          const normal = new THREE.Vector3();
          normal.subVectors(pB, pA).cross(pC.clone().sub(pA)).normalize();

          // Create beveled vertices
          const bevelOffset = normal.clone().multiplyScalar(width);
          const pA_bevel = pA.clone().add(bevelOffset);
          const pB_bevel = pB.clone().add(bevelOffset);
          const pC_bevel = pC.clone().add(bevelOffset);

          // Add vertices to positions array
          const baseIndex = positions.length / 3;
          positions.push(pA.x, pA.y, pA.z);
          positions.push(pB.x, pB.y, pB.z);
          positions.push(pC.x, pC.y, pC.z);
          positions.push(pA_bevel.x, pA_bevel.y, pA_bevel.z);
          positions.push(pB_bevel.x, pB_bevel.y, pB_bevel.z);
          positions.push(pC_bevel.x, pC_bevel.y, pC_bevel.z);

          // Add indices for the original and beveled faces
          indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
          indices.push(baseIndex + 3, baseIndex + 4, baseIndex + 5);

          // Add indices for the side faces
          indices.push(baseIndex, baseIndex + 1, baseIndex + 4);
          indices.push(baseIndex, baseIndex + 4, baseIndex + 3);
          indices.push(baseIndex + 1, baseIndex + 2, baseIndex + 5);
          indices.push(baseIndex + 1, baseIndex + 5, baseIndex + 4);
          indices.push(baseIndex + 2, baseIndex, baseIndex + 3);
          indices.push(baseIndex + 2, baseIndex + 3, baseIndex + 5);
        }
      }

      // Set the new geometry attributes
      bevelGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      bevelGeometry.setIndex(indices);
      bevelGeometry.computeVertexNormals();

      // Replace the mesh geometry
      mesh.geometry = bevelGeometry;
    } catch (error: unknown) {
      console.warn('Bevel operation failed, using stub:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Subdivide geometry.
   * @param object The object to modify.
   * @param level Subdivision level (1-3 recommended for mobile).
   */
  subdivide(object: SceneObject, level: number = 1): void {
    const mesh = object.three as THREE.Mesh;
    if (!mesh.geometry) return;
    // Use custom midpoint subdivision implementation for compatibility with Three.js 0.187.0
    this.subdivideMidpoint(mesh.geometry, level);
    mesh.geometry.computeVertexNormals();
  }

  /**
   * Remove subdivision modifier and restore original geometry.
   */
  removeSubdivision(object: SceneObject): void {
    if (object.meta.userData?.subdivisionLevel && object.meta.userData.subdivisionLevel > 0) {
      console.warn('Subdivision removal not fully implemented, manual restore needed');
      object.meta.userData.subdivisionLevel = 0;
    }
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