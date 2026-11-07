import * as THREE from 'three';

export type PrimitiveType = 'cube' | 'sphere' | 'cylinder' | 'plane';

export interface ObjectMeta {
  id: string;
  name: string;
  primitive?: PrimitiveType;
  /** User-set material color as a hex string, e.g. "#ff8844". */
  color: string;
  roughness: number;
  metalness: number;
  visible: boolean;
  locked: boolean;
  parentId: string | null;
  userData?: THREE.Object3D['userData'];
}

/**
 * A typed wrapper around a THREE.Object3D. The wrapper owns the metadata
 * (name, color, lock state, parent link) while the THREE node owns the
 * transform and geometry. Keeping them in one place makes save/load and
 * the hierarchy panel trivial.
 */
export class SceneObject {
  readonly three: THREE.Object3D;
  readonly meta: ObjectMeta;

  constructor(three: THREE.Object3D, meta: Partial<ObjectMeta> = {}) {
    this.three = three;
    this.meta = {
      id: meta.id ?? crypto.randomUUID(),
      name: meta.name ?? 'Object',
      primitive: meta.primitive,
      color: meta.color ?? '#ffffff',
      roughness: meta.roughness ?? 0.6,
      metalness: meta.metalness ?? 0,
      visible: meta.visible ?? true,
      locked: meta.locked ?? false,
      parentId: meta.parentId ?? null,
      userData: meta.userData ?? {},
    };
    three.visible = this.meta.visible;
    three.name = this.meta.name;
  }


  applyMaterial(): void {
    const mesh = this.three as THREE.Mesh;
    if (!mesh.material) return;
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (!(mat instanceof THREE.MeshStandardMaterial)) return;
    mat.color.set(this.meta.color);
    mat.roughness = this.meta.roughness;
    mat.metalness = this.meta.metalness;
  }

  clone(): SceneObject {
    const node = this.three.clone(true);
    const meta: ObjectMeta = {
      ...this.meta,
      id: crypto.randomUUID(),
      name: this.meta.name + ' copy',
      parentId: null,
    };
    return new SceneObject(node, meta);
  }
}