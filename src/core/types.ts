///
/// Type definitions for core types used in the AI 3D Creator project.
///

import * as THREE from 'three';
import { Mesh } from 'three';

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
    [key: string]: any;
  };
  applyMaterial?: (material: THREE.Material) => void;
  clone?: () => SceneObject;
  [key: string]: any;
}

// --- Scene Type ---
export interface Scene {
  three: THREE.Scene;
  [key: string]: any;
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
  userData?: any;
  [key: string]: any;
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
  [key: string]: any;
}