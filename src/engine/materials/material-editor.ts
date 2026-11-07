import * as THREE from 'three';
import { SceneObject } from '../core/object-model';

export class MaterialEditor {
  /**
   * Apply PBR material properties to a SceneObject.
   */
  applyMaterial(object: SceneObject, props: {
    color?: string;
    roughness?: number;
    metalness?: number;
    opacity?: number;
    transparent?: boolean;
  }): void {
    if (!(object.three instanceof THREE.Mesh)) return;
    const material = object.three.material;
    if (!(material instanceof THREE.MeshStandardMaterial)) return;

    if (props.color !== undefined) material.color.set(props.color);
    if (props.roughness !== undefined) material.roughness = props.roughness;
    if (props.metalness !== undefined) material.metalness = props.metalness;
    if (props.opacity !== undefined) {
      material.opacity = props.opacity;
      material.transparent = props.opacity < 1.0 || (props.transparent ?? false);
    }
    material.needsUpdate = true;
  }
}