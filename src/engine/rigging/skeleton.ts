import * as THREE from 'three';
import { SceneObject } from '../core/object-model';
import type { SceneGraph } from '../core/scene-graph';

export interface SerializedBone {
  name: string;
  parent: string | null;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface SerializedWeights {
  skinIndex: number[];
  skinWeight: number[];
}

export interface SerializedRig {
  version: 1;
  name: string;
  targetId: string | null;
  bones: SerializedBone[];
  weights: SerializedWeights | null;
}

interface RestTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

interface BoneSegment {
  index: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
}

/**
 * Single-mesh skeleton rig. Owns bones, skinning, weights, visualization
 * and serialization. Reuses three.js SkinnedMesh/Skeleton so GLB export
 * carries the rig without custom exporter code.
 */
export class SkeletonRig {
  readonly bones: THREE.Bone[] = [];
  target: SceneObject | null = null;
  targetMesh: THREE.SkinnedMesh | null = null;
  activeBone: THREE.Bone | null = null;
  paintEnabled = false;
  brushRadius = 0.4;
  brushStrength = 0.35;
  name = 'Rig';

  private readonly boneMap = new Map<string, THREE.Bone>();
  private skeleton: THREE.Skeleton | null = null;
  private helper: THREE.SkeletonHelper | null = null;
  private restPose = new Map<string, RestTransform>();
  private readonly changeHandlers = new Set<() => void>();

  constructor(private readonly scene: THREE.Scene) {}

  get rootBone(): THREE.Bone | null {
    return this.bones.length > 0 ? this.bones[0] : null;
  }

  /** The live THREE.Skeleton bound to the target mesh (null while unbound). */
  get skeletonInstance(): THREE.Skeleton | null {
    return this.skeleton;
  }

  onChange(handler: () => void): () => void {
    this.changeHandlers.add(handler);
    return () => this.changeHandlers.delete(handler);
  }

  private emitChange(): void {
    for (const handler of this.changeHandlers) handler();
  }

  createHumanoidRig(fitTo?: SceneObject | null): void {
    this.clear();

    let scale = 1;
    let centerX = 0;
    let centerZ = 0;
    let floorY = 0;

    if (fitTo && fitTo.three instanceof THREE.Mesh) {
      fitTo.three.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(fitTo.three);
      const size = new THREE.Vector3();
      box.getSize(size);
      scale = Math.max(0.4, size.y / 1.8);
      const center = new THREE.Vector3();
      box.getCenter(center);
      centerX = center.x;
      centerZ = center.z;
      floorY = box.min.y;
    }

    const p = (x: number, y: number, z: number): [number, number, number] => [
      x * scale,
      y * scale,
      z * scale,
    ];

    const hips = this.createBone('hips', null, [centerX, floorY + 0.95 * scale, centerZ]);
    const spine = this.createBone('spine', hips, p(0, 0.12, 0));
    const chest = this.createBone('chest', spine, p(0, 0.22, 0));
    const neck = this.createBone('neck', chest, p(0, 0.18, 0));
    this.createBone('head', neck, p(0, 0.12, 0));

    for (const side of ['left', 'right'] as const) {
      const sign = side === 'left' ? 1 : -1;
      const shoulder = this.createBone(`${side}Shoulder`, chest, p(0.12 * sign, 0.14, 0));
      const upperArm = this.createBone(`${side}UpperArm`, shoulder, p(0.14 * sign, 0, 0));
      const lowerArm = this.createBone(`${side}LowerArm`, upperArm, p(0.28 * sign, 0, 0));
      this.createBone(`${side}Hand`, lowerArm, p(0.26 * sign, 0, 0));

      const upperLeg = this.createBone(`${side}UpperLeg`, hips, p(0.11 * sign, -0.05, 0));
      const lowerLeg = this.createBone(`${side}LowerLeg`, upperLeg, p(0, -0.45, 0));
      const foot = this.createBone(`${side}Foot`, lowerLeg, p(0, -0.42, 0));
      this.createBone(`${side}Toe`, foot, p(0, -0.07, 0.12));
    }

    this.activeBone = hips;
    this.captureRestPose();
    this.emitChange();
  }

  createBone(
    name?: string,
    parent: THREE.Bone | null = null,
    position: [number, number, number] = [0, 0.2, 0]
  ): THREE.Bone {
    const boneName = this.uniqueName(name ?? 'bone');
    const bone = new THREE.Bone();
    bone.name = boneName;
    bone.position.set(position[0], position[1], position[2]);

    if (parent) parent.add(bone);
    else this.scene.add(bone);

    this.bones.push(bone);
    this.boneMap.set(boneName, bone);
    if (!this.activeBone) this.activeBone = bone;
    this.refreshHelper();
    this.emitChange();
    return bone;
  }

  addChildBone(parentName?: string | null): THREE.Bone {
    const parent = (parentName ? this.boneMap.get(parentName) : this.activeBone) ?? this.rootBone;
    return this.createBone(undefined, parent, [0, 0.18, 0]);
  }

  removeBone(name: string): void {
    const bone = this.boneMap.get(name);
    if (!bone) return;

    if (bone.parent instanceof THREE.Bone) {
      for (const child of [...bone.children]) {
        if (child instanceof THREE.Bone) {
          bone.parent.add(child);
          child.position.add(bone.position);
        }
      }
    }

    bone.parent?.remove(bone);
    this.bones.splice(this.bones.indexOf(bone), 1);
    this.boneMap.delete(name);
    if (this.activeBone === bone) this.activeBone = this.rootBone;

    if (this.targetMesh) this.refreshSkin();
    this.refreshHelper();
    this.emitChange();
  }

  getBone(name: string): THREE.Bone | null {
    return this.boneMap.get(name) ?? null;
  }

  getBoneNames(): string[] {
    return this.bones.map((bone) => bone.name);
  }

  selectBone(name: string): THREE.Bone | null {
    const bone = this.getBone(name);
    if (!bone) return null;
    this.activeBone = bone;
    this.emitChange();
    return bone;
  }

  captureRestPose(): void {
    this.restPose.clear();
    for (const bone of this.bones) {
      this.restPose.set(bone.name, {
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone(),
      });
    }
  }

  resetPose(): void {
    for (const bone of this.bones) {
      const rest = this.restPose.get(bone.name);
      if (!rest) continue;
      bone.position.copy(rest.position);
      bone.quaternion.copy(rest.quaternion);
      bone.scale.copy(rest.scale);
    }
    this.emitChange();
  }

  /** Bind the selected mesh as a SkinnedMesh and compute automatic weights. */
  bind(object: SceneObject, autoWeights = true): boolean {
    if (!(object.three instanceof THREE.Mesh)) return false;
    if (this.bones.length === 0) this.createBone('root', null, [0, 0, 0]);
    if (this.targetMesh && this.target && this.target !== object) this.unbind();

    const old = object.three;
    const geometry = old.geometry;
    const skinned = new THREE.SkinnedMesh(geometry, old.material);
    skinned.name = old.name;
    skinned.position.copy(old.position);
    skinned.quaternion.copy(old.quaternion);
    skinned.scale.copy(old.scale);
    skinned.visible = old.visible;
    skinned.castShadow = old.castShadow;
    skinned.receiveShadow = old.receiveShadow;
    skinned.userData = { ...old.userData, rigName: this.name };

    const parent = old.parent ?? this.scene;
    const index = parent.children.indexOf(old);
    parent.remove(old);
    parent.add(skinned);
    if (index >= 0) {
      parent.children.splice(parent.children.indexOf(skinned), 1);
      parent.children.splice(index, 0, skinned);
    }

    this.target = object;
    this.targetMesh = skinned;
    object.three = skinned;

    if (autoWeights) this.autoAssignWeights();
    else this.initWeights();

    this.refreshSkin();
    this.captureRestPose();
    this.refreshHelper();
    this.emitChange();
    return true;
  }

  unbind(): void {
    if (!this.targetMesh || !this.target) return;
    const old = this.targetMesh;
    const geometry = old.geometry;
    geometry.deleteAttribute('skinIndex');
    geometry.deleteAttribute('skinWeight');

    const mesh = new THREE.Mesh(geometry, old.material);
    mesh.name = old.name;
    mesh.position.copy(old.position);
    mesh.quaternion.copy(old.quaternion);
    mesh.scale.copy(old.scale);
    mesh.visible = old.visible;
    mesh.castShadow = old.castShadow;
    mesh.receiveShadow = old.receiveShadow;

    const parent = old.parent ?? this.scene;
    const index = parent.children.indexOf(old);
    parent.remove(old);
    parent.add(mesh);
    if (index >= 0) {
      parent.children.splice(parent.children.indexOf(mesh), 1);
      parent.children.splice(index, 0, mesh);
    }
    this.target.three = mesh;
    this.target = null;
    this.targetMesh = null;
    this.skeleton = null;
    this.emitChange();
  }

  clear(): void {
    this.unbind();
    for (const bone of [...this.bones].reverse()) bone.parent?.remove(bone);
    this.bones.length = 0;
    this.boneMap.clear();
    this.restPose.clear();
    this.activeBone = null;
    this.skeleton = null;
    this.removeHelper();
    this.emitChange();
  }

  private initWeights(): void {
    if (!this.targetMesh || this.bones.length === 0) return;
    const count = this.targetMesh.geometry.attributes.position.count;
    const indices = new Uint16Array(count * 4);
    const weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) weights[i * 4] = 1;
    this.setWeightAttributes(indices, weights);
  }

  autoAssignWeights(): void {
    if (!this.targetMesh || this.bones.length === 0) return;
    this.scene.updateMatrixWorld(true);
    this.targetMesh.updateWorldMatrix(true, true);

    const geometry = this.targetMesh.geometry;
    const position = geometry.attributes.position;
    const count = position.count;
    const indices = new Uint16Array(count * 4);
    const weights = new Float32Array(count * 4);
    const segments = this.boneSegments();
    const vertex = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(this.targetMesh.matrixWorld);
      const ranked = segments
        .map((segment) => {
          const closest = new THREE.Vector3();
          this.closestPointOnSegment(vertex, segment.a, segment.b, closest);
          return { bone: segment.index, distance: vertex.distanceTo(closest) };
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 4);

      let total = 0;
      for (const entry of ranked) total += 1 / (entry.distance * entry.distance + 0.0001);
      for (let slot = 0; slot < ranked.length; slot++) {
        const entry = ranked[slot];
        indices[i * 4 + slot] = entry.bone;
        weights[i * 4 + slot] = (1 / (entry.distance * entry.distance + 0.0001)) / total;
      }
    }

    this.setWeightAttributes(indices, weights);
  }

  paint(
    hitPoint: THREE.Vector3,
    add: boolean,
    boneName?: string | null,
    radius = this.brushRadius,
    strength = this.brushStrength
  ): number {
    if (!this.targetMesh) return 0;
    const bone = boneName ? this.getBone(boneName) : this.activeBone;
    if (!bone) return 0;
    const boneIndex = this.bones.indexOf(bone);
    if (boneIndex < 0) return 0;

    const mesh = this.targetMesh;
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const indexAttr = geometry.attributes.skinIndex;
    const weightAttr = geometry.attributes.skinWeight;
    if (!position || !indexAttr || !weightAttr) return 0;

    // shortcut: paint samples bind-pose vertices; posed meshes need a rest-pose repaint.
    const localHit = hitPoint.clone().applyMatrix4(mesh.matrixWorld.clone().invert());
    const vertex = new THREE.Vector3();
    let painted = 0;

    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position, i);
      const distance = vertex.distanceTo(localHit);
      if (distance > radius) continue;

      const falloff = Math.pow(1 - distance / radius, 2) * strength;
      const slots: number[] = [];
      for (let slot = 0; slot < 4; slot++) {
        slots.push(indexAttr.getComponent(i, slot));
      }

      let found = -1;
      for (let slot = 0; slot < 4; slot++) {
        if (slots[slot] === boneIndex) {
          found = slot;
          break;
        }
      }

      if (found >= 0) {
        const next = weightAttr.getComponent(i, found) + (add ? falloff : -falloff);
        weightAttr.setComponent(i, found, THREE.MathUtils.clamp(next, 0, 1));
      } else if (add) {
        let weakest = 0;
        for (let slot = 1; slot < 4; slot++) {
          if (weightAttr.getComponent(i, slot) < weightAttr.getComponent(i, weakest)) weakest = slot;
        }
        indexAttr.setComponent(i, weakest, boneIndex);
        weightAttr.setComponent(i, weakest, Math.min(falloff, 1));
      }

      let total = 0;
      for (let slot = 0; slot < 4; slot++) total += weightAttr.getComponent(i, slot);
      if (total > 0) {
        for (let slot = 0; slot < 4; slot++) {
          weightAttr.setComponent(i, slot, weightAttr.getComponent(i, slot) / total);
        }
      }
      painted++;
    }

    indexAttr.needsUpdate = true;
    weightAttr.needsUpdate = true;
    return painted;
  }

  setWeightData(skinIndex: number[], skinWeight: number[]): void {
    if (!this.targetMesh) return;
    const count = this.targetMesh.geometry.attributes.position.count;
    if (skinIndex.length < count * 4 || skinWeight.length < count * 4) return;
    this.setWeightAttributes(
      new Uint16Array(skinIndex.slice(0, count * 4)),
      new Float32Array(skinWeight.slice(0, count * 4))
    );
  }

  private setWeightAttributes(indices: Uint16Array, weights: Float32Array): void {
    if (!this.targetMesh) return;
    const geometry = this.targetMesh.geometry;
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    this.targetMesh.normalizeSkinWeights();
  }

  private refreshSkin(): void {
    if (!this.targetMesh) return;
    this.scene.updateMatrixWorld(true);
    this.targetMesh.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(this.bones);
    this.targetMesh.bind(this.skeleton, this.targetMesh.matrixWorld);
  }

  private boneSegments(): BoneSegment[] {
    return this.bones.map((bone, index) => {
      const a = bone.getWorldPosition(new THREE.Vector3());
      const child = bone.children.find((node): node is THREE.Bone => node instanceof THREE.Bone);
      const b = child ? child.getWorldPosition(new THREE.Vector3()) : a.clone();
      return { index, a, b };
    });
  }

  private closestPointOnSegment(
    point: THREE.Vector3,
    a: THREE.Vector3,
    b: THREE.Vector3,
    target: THREE.Vector3
  ): void {
    const ab = b.clone().sub(a);
    const lengthSq = ab.lengthSq();
    if (lengthSq === 0) {
      target.copy(a);
      return;
    }
    const t = THREE.MathUtils.clamp(point.clone().sub(a).dot(ab) / lengthSq, 0, 1);
    target.copy(a).addScaledVector(ab, t);
  }

  private refreshHelper(): void {
    this.removeHelper();
    const root = this.rootBone;
    if (!root) return;
    this.helper = new THREE.SkeletonHelper(root);
    const material = this.helper.material;
    const materials = Array.isArray(material) ? material : [material];
    for (const mat of materials) {
      mat.depthTest = false;
      mat.transparent = true;
      mat.opacity = 0.9;
    }
    this.scene.add(this.helper);
  }

  private removeHelper(): void {
    if (!this.helper) return;
    this.helper.parent?.remove(this.helper);
    this.helper = null;
  }

  beginExport(): void {
    if (this.helper?.parent) this.helper.parent.remove(this.helper);
  }

  endExport(): void {
    if (this.helper && !this.helper.parent) this.scene.add(this.helper);
  }

  serialize(name = this.name): SerializedRig {
    const indices = this.targetMesh?.geometry.attributes.skinIndex;
    const weights = this.targetMesh?.geometry.attributes.skinWeight;
    return {
      version: 1,
      name,
      targetId: this.target?.meta.id ?? null,
      bones: this.bones.map((bone) => ({
        name: bone.name,
        parent: bone.parent instanceof THREE.Bone ? bone.parent.name : null,
        position: [bone.position.x, bone.position.y, bone.position.z],
        rotation: [bone.rotation.x, bone.rotation.y, bone.rotation.z],
        scale: [bone.scale.x, bone.scale.y, bone.scale.z],
      })),
      weights:
        indices && weights
          ? {
              skinIndex: Array.from(indices.array as ArrayLike<number>),
              skinWeight: Array.from(weights.array as ArrayLike<number>),
            }
          : null,
    };
  }

  load(data: SerializedRig, graph: SceneGraph): boolean {
    if (!data || data.version !== 1 || !Array.isArray(data.bones)) return false;
    this.clear();
    this.name = data.name || 'Rig';

    let pending = [...data.bones];
    while (pending.length > 0) {
      const next: SerializedBone[] = [];
      for (const item of pending) {
        const parent = item.parent ? this.getBone(item.parent) : null;
        if (item.parent && !parent) {
          next.push(item);
          continue;
        }
        const bone = this.createBone(item.name, parent, item.position);
        bone.rotation.fromArray(item.rotation);
        bone.scale.fromArray(item.scale);
      }
      if (next.length === pending.length) break;
      pending = next;
    }

    const target = data.targetId ? graph.find(data.targetId) : undefined;
    if (target) {
      this.bind(target, false);
      if (data.weights) {
        this.setWeightData(data.weights.skinIndex, data.weights.skinWeight);
      }
    }

    this.captureRestPose();
    this.refreshHelper();
    this.emitChange();
    return true;
  }

  dispose(): void {
    this.clear();
    this.changeHandlers.clear();
  }

  private uniqueName(base: string): string {
    if (!this.boneMap.has(base)) return base;
    let index = 2;
    while (this.boneMap.has(`${base}.${index}`)) index++;
    return `${base}.${index}`;
  }
}

export const RIGGING_STATUS = 'implemented';
