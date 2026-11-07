import * as THREE from 'three';
import { SceneObject, PrimitiveType } from './object-model';
import { PrimitiveFactory } from '../modeling/primitives';

export type SelectionChangeHandler = (object: SceneObject | null) => void;
export type ObjectsChangeHandler = () => void;

/**
 * Owns the root Group in the scene and the list of SceneObjects.
 * Selection, hierarchy, add/duplicate/delete all flow through here so the
 * UI and the 3D engine stay in sync with a single source of truth.
 */
export class SceneGraph {
  readonly root = new THREE.Group();
  readonly objects: SceneObject[] = [];

  private _selected: SceneObject | null = null;
  private _selectionHandlers = new Set<SelectionChangeHandler>();
  private _changeHandlers = new Set<ObjectsChangeHandler>();

  get selected(): SceneObject | null {
    return this._selected;
  }

  add(obj: SceneObject, parentId: string | null = null): void {
    const parent = parentId ? this.find(parentId) : null;
    if (parent) {
      parent.three.add(obj.three);
      obj.meta.parentId = parent.meta.id;
    } else {
      this.root.add(obj.three);
      obj.meta.parentId = null;
    }
    this.objects.push(obj);
    this.emitChange();
  }

  addPrimitive(type: PrimitiveType, name?: string, parentId: string | null = null): SceneObject | null {
    const factory = new PrimitiveFactory();
    const obj = factory.create(type, name);
    this.add(obj, parentId);
    return obj;
  }

  remove(obj: SceneObject): void {
    const idx = this.objects.indexOf(obj);
    if (idx === -1) return;

    const parent = obj.three.parent;
    if (parent) parent.remove(obj.three);

    // Re-parent any children of the removed object to the root so we
    // never silently lose objects when deleting a container.
    for (const child of this.objects) {
      if (child.meta.parentId === obj.meta.id) {
        this.root.add(child.three);
        child.meta.parentId = null;
      }
    }

    this.objects.splice(idx, 1);
    if (this._selected === obj) this.select(null);
    this.emitChange();
  }

  /** Deep clone the object (and its children) into the root. */
  duplicate(obj: SceneObject): SceneObject | null {
    const clone = obj.clone();
    const clonedNode = clone.three;
    clonedNode.position.copy(obj.three.position);
    clonedNode.rotation.copy(obj.three.rotation);
    clonedNode.scale.copy(obj.three.scale);
    clonedNode.position.x += 0.4;
    this.add(clone, obj.meta.parentId);
    return clone;
  }

  find(id: string): SceneObject | undefined {
    return this.objects.find((o) => o.meta.id === id);
  }

  select(obj: SceneObject | null): void {
    if (this._selected === obj) return;
    this._selected = obj;
    for (const h of this._selectionHandlers) h(obj);
  }

  onSelectionChange(h: SelectionChangeHandler): () => void {
    this._selectionHandlers.add(h);
    return () => this._selectionHandlers.delete(h);
  }

  onChange(h: ObjectsChangeHandler): () => void {
    this._changeHandlers.add(h);
    return () => this._changeHandlers.delete(h);
  }

  private emitChange(): void {
    for (const h of this._changeHandlers) h();
  }

  /** Serialize the whole graph to a plain JSON structure. */
  toJSON(): unknown {
    return {
      version: 1,
      objects: this.objects.map((o) => ({
        id: o.meta.id,
        name: o.meta.name,
        primitive: o.meta.primitive,
        color: o.meta.color,
        roughness: o.meta.roughness,
        metalness: o.meta.metalness,
        visible: o.meta.visible,
        locked: o.meta.locked,
        parentId: o.meta.parentId,
        position: [o.three.position.x, o.three.position.y, o.three.position.z],
        rotation: [o.three.rotation.x, o.three.rotation.y, o.three.rotation.z],
        scale: [o.three.scale.x, o.three.scale.y, o.three.scale.z],
      })),
    };
  }

  /** Rebuild the graph from a previously serialized structure. */
  fromJSON(data: any): void {
    this.root.clear();
    this.objects.length = 0;
    this._selected = null;

    const map = new Map<string, SceneObject>();
    const items: any[] = Array.isArray(data?.objects) ? data.objects : [];

    // First pass: create every object (geometry only for primitives).
    for (const item of items) {
      const factory = new PrimitiveFactory();
      const node =
        item.primitive != null
          ? factory.create(item.primitive as PrimitiveType, item.name).three
          : new THREE.Object3D();
      const obj = new SceneObject(node, {
        id: item.id,
        name: item.name,
        primitive: item.primitive,
        color: item.color,
        roughness: item.roughness,
        metalness: item.metalness,
        visible: item.visible,
        locked: item.locked,
        parentId: item.parentId,
      });
      if (item.position) node.position.fromArray(item.position);
      if (item.rotation) node.rotation.fromArray(item.rotation);
      if (item.scale) node.scale.fromArray(item.scale);
      map.set(item.id, obj);
    }

    // Second pass: re-link parents.
    for (const obj of map.values()) {
      const parent = obj.meta.parentId ? map.get(obj.meta.parentId) : null;
      if (parent) {
        parent.three.add(obj.three);
      } else {
        this.root.add(obj.three);
      }
      this.objects.push(obj);
    }
    this.emitChange();
  }
}