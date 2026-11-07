import * as THREE from 'three';
import { SceneObject } from '../core/object-model';

export type EditMode = 'object' | 'vertex' | 'edge' | 'face';

export class MeshEditor {
  private _mode: EditMode = 'object';
  private _selectedVertices: number[] = [];
  private _selectedEdges: [number, number][] = [];
  private _selectedFaces: number[] = [];
  private _selectionHelper: THREE.Group | null = null;
  private _raycaster = new THREE.Raycaster();
  private _mouse = new THREE.Vector2();

  constructor(private readonly scene: THREE.Scene) {}

  get mode() { return this._mode; }
  setMode(mode: EditMode, object: SceneObject | null) {
    this._mode = mode;
    this.updateVisuals(object);
  }

  updateVisuals(object: SceneObject | null): void {
    if (!object || !(object.three instanceof THREE.Mesh)) return;

    if (this._selectionHelper) {
      this.scene.remove(this._selectionHelper);
      this._selectionHelper = null;
    }

    if (this._mode === 'vertex' && this._selectedVertices.length > 0) {
      this._selectionHelper = this.createVertexSelectionHelper(object, this._selectedVertices);
      this.scene.add(this._selectionHelper);
    } else if (this._mode === 'edge' && this._selectedEdges.length > 0) {
      this._selectionHelper = this.createEdgeSelectionHelper(object, this._selectedEdges);
      this.scene.add(this._selectionHelper);
    } else if (this._mode === 'face' && this._selectedFaces.length > 0) {
      this._selectionHelper = this.createFaceSelectionHelper(object, this._selectedFaces);
      this.scene.add(this._selectionHelper);
    }
  }

  selectComponents(object: SceneObject, mousePosition: THREE.Vector2, camera: THREE.PerspectiveCamera): void {
    if (!(object.three instanceof THREE.Mesh)) return;
    const geometry = (object.three as THREE.Mesh).geometry;
    if (!geometry) return;

    this._mouse.copy(mousePosition);
    this._raycaster.setFromCamera(this._mouse, camera);

    this._selectedVertices = [];
    this._selectedEdges = [];
    this._selectedFaces = [];

    switch (this._mode) {
      case 'vertex':
        this.selectVertices(object, geometry);
        break;
      case 'edge':
        this.selectEdges(object, geometry);
        break;
      case 'face':
        this.selectFaces(object, geometry);
        break;
    }

    this.updateVisuals(object);
  }

  private selectVertices(object: SceneObject, geometry: THREE.BufferGeometry): void {
    const positions = geometry.attributes.position;
    const threshold = 0.1;

    for (let i = 0; i < positions.count; i++) {
      const vertex = new THREE.Vector3();
      vertex.fromBufferAttribute(positions, i);
      vertex.applyMatrix4(object.three.matrixWorld);

      const screenSpace = vertex.clone().project(this._raycaster.camera);
      const mouseDist = new THREE.Vector2(screenSpace.x, screenSpace.y).distanceTo(this._mouse);

      if (mouseDist < 0.05) {
        this._selectedVertices.push(i);
      }
    }
  }

  private selectEdges(object: SceneObject, geometry: THREE.BufferGeometry): void {
    const posAttr = geometry.attributes.position;
    const indexAttr = geometry.index || null;
    const threshold = 0.1;

    // Create a temporary geometry with edges
    const edgeGeometry = new THREE.BufferGeometry();
    const edgePositions: number[] = [];

    // Get all edges (for indexed geometry)
    if (indexAttr) {
      const edges = this.getEdgesFromIndexedGeometry(geometry);
      for (const [v1, v2] of edges) {
        const p1 = new THREE.Vector3().fromBufferAttribute(posAttr, v1).applyMatrix4(object.three.matrixWorld);
        const p2 = new THREE.Vector3().fromBufferAttribute(posAttr, v2).applyMatrix4(object.three.matrixWorld);

        // Check if this edge is close to the mouse position
        const edgeCenter = p1.clone().add(p2).multiplyScalar(0.5);
        const screenSpace = edgeCenter.clone().project(this._raycaster.camera);
        const mouseDist = new THREE.Vector2(screenSpace.x, screenSpace.y).distanceTo(this._mouse);

        if (mouseDist < threshold) {
          this._selectedEdges.push([v1, v2]);
        }
      }
    } else {
      // Non-indexed geometry - process triangles
      for (let i = 0; i < posAttr.count; i += 3) {
        const p1 = new THREE.Vector3().fromBufferAttribute(posAttr, i).applyMatrix4(object.three.matrixWorld);
        const p2 = new THREE.Vector3().fromBufferAttribute(posAttr, i + 1).applyMatrix4(object.three.matrixWorld);
        const p3 = new THREE.Vector3().fromBufferAttribute(posAttr, i + 2).applyMatrix4(object.three.matrixWorld);

        // Check each edge of the triangle
        const edges = [
          [p1, p2],
          [p2, p3],
          [p3, p1]
        ];

        for (const [pA, pB] of edges) {
          const edgeCenter = pA.clone().add(pB).multiplyScalar(0.5);
          const screenSpace = edgeCenter.clone().project(this._raycaster.camera);
          const mouseDist = new THREE.Vector2(screenSpace.x, screenSpace.y).distanceTo(this._mouse);

          if (mouseDist < threshold) {
            this._selectedEdges.push([i, i + 1]); // Store vertex indices
          }
        }
      }
    }
  }

  private getEdgesFromIndexedGeometry(geometry: THREE.BufferGeometry): [number, number][] {
    const indexAttr = geometry.index || null;
    const edges: Set<string> = new Set();
    const result: [number, number][] = [];

    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i += 3) {
        const a = indexAttr.getX(i);
        const b = indexAttr.getX(i + 1);
        const c = indexAttr.getX(i + 2);

        const edgeAB = [Math.min(a, b), Math.max(a, b)].join(',');
        const edgeBC = [Math.min(b, c), Math.max(b, c)].join(',');
        const edgeCA = [Math.min(c, a), Math.max(c, a)].join(',');

        if (!edges.has(edgeAB)) {
          edges.add(edgeAB);
          result.push([a, b]);
        }
        if (!edges.has(edgeBC)) {
          edges.add(edgeBC);
          result.push([b, c]);
        }
        if (!edges.has(edgeCA)) {
          edges.add(edgeCA);
          result.push([c, a]);
        }
      }
    }
    return result;
  }

  private selectFaces(object: SceneObject, geometry: THREE.BufferGeometry): void {
    const intersects = this._raycaster.intersectObject(object.three);
    if (intersects.length > 0) {
      const closest = intersects[0];
      const faceIndex = closest.faceIndex;
      if (faceIndex !== undefined && faceIndex !== null) {
        this._selectedFaces.push(faceIndex);
      }
    }
  }

  private createVertexSelectionHelper(object: SceneObject, indices: number[]): THREE.Group {
    const group = new THREE.Group();
    const positions = (object.three as THREE.Mesh).geometry.attributes.position;

    for (const index of indices) {
      const position = new THREE.Vector3();
      position.fromBufferAttribute(positions, index);
      position.applyMatrix4(object.three.matrixWorld);

      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xff0000 })
      );
      sphere.position.copy(position);
      group.add(sphere);
    }

    return group;
  }

  private createEdgeSelectionHelper(object: SceneObject, edges: [number, number][]): THREE.Group {
    const group = new THREE.Group();
    const positions = (object.three as THREE.Mesh).geometry.attributes.position;

    for (const [v1, v2] of edges) {
      const p1 = new THREE.Vector3().fromBufferAttribute(positions, v1).applyMatrix4(object.three.matrixWorld);
      const p2 = new THREE.Vector3().fromBufferAttribute(positions, v2).applyMatrix4(object.three.matrixWorld);

      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([p1, p2]),
        new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 3 })
      );
      group.add(line);
    }

    return group;
  }

  private createFaceSelectionHelper(object: SceneObject, indices: number[]): THREE.Group {
    const group = new THREE.Group();
    const geometry = (object.three as THREE.Mesh).geometry;
    const posAttr = geometry.attributes.position;
    const indexAttr = geometry.index || null;

    for (const index of indices) {
      const vertices: THREE.Vector3[] = [];
      if (indexAttr) {
        const i1 = indexAttr.getX(index * 3);
        const i2 = indexAttr.getX(index * 3 + 1);
        const i3 = indexAttr.getX(index * 3 + 2);
        vertices.push(
          new THREE.Vector3().fromBufferAttribute(posAttr, i1).applyMatrix4(object.three.matrixWorld),
          new THREE.Vector3().fromBufferAttribute(posAttr, i2).applyMatrix4(object.three.matrixWorld),
          new THREE.Vector3().fromBufferAttribute(posAttr, i3).applyMatrix4(object.three.matrixWorld)
        );
      } else {
        const start = index * 3;
        vertices.push(
          new THREE.Vector3().fromBufferAttribute(posAttr, start).applyMatrix4(object.three.matrixWorld),
          new THREE.Vector3().fromBufferAttribute(posAttr, start + 1).applyMatrix4(object.three.matrixWorld),
          new THREE.Vector3().fromBufferAttribute(posAttr, start + 2).applyMatrix4(object.three.matrixWorld)
        );
      }

      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(vertices),
        new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 3 })
      );
      group.add(line);
    }

    return group;
  }
}