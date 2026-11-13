///
/// Type definitions for core types used in the AI 3D Creator project.
///

import * as THREE from 'three';

// --- Scene and SceneObject Types ---

export interface SceneObject {
  three: THREE.Object3D<THREE.Object3DEventMap>;
  meta: {
    id: string;
    name: string;
    primitive?: string;
    color: string;
    roughness: number;
    metalness: number;
    visible: boolean;
    locked: boolean;
    parentId: string | null;
    userData?: THREE.Object3D['userData'];
    [key: string]: unknown;
  };
  applyMaterial?: (material: THREE.Material) => void;
  clone?: () => SceneObject;
  [key: string]: unknown;
}

// --- Scene Type ---
export interface Scene {
  three: THREE.Scene;
  [key: string]: unknown;
}

// --- Object3D Type ---
export interface ObjectMeta {
  id: string;
  name: string;
  primitive?: string;
  color: string;
  roughness: number;
  metalness: number;
  visible: boolean;
  locked: boolean;
  parentId: string | null;
  userData?: unknown;
  [key: string]: unknown;
}

// --- SceneGraph Type ---
export interface SceneGraph {
  root: THREE.Object3D;
  objects: SceneObject[];
  selected: SceneObject | null;
  onSelectionChange: (callback: (obj: SceneObject | null) => void) => void;
  onChange: (callback: () => void) => void;
  add: (obj: SceneObject) => void;
  remove: (obj: SceneObject) => void;
  find: (id: string) => SceneObject | null;
  duplicate: (obj: SceneObject) => SceneObject | null;
  select: (obj: SceneObject) => void;
  [key: string]: unknown;
}