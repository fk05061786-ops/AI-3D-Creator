import * as THREE from 'three';
import { SceneObject, PrimitiveType } from '../core/object-model';

/**
 * Primitive factory. Each primitive is built with a sensible default
 * transform (sitting on the ground plane at y=0) so newly created
 * objects are immediately visible and selectable.
 */
export class PrimitiveFactory {
  create(type: PrimitiveType, name?: string): SceneObject {
    const mesh = this.buildMesh(type);
    const obj = new SceneObject(mesh, { primitive: type, name: name ?? this.defaultName(type) });
    this.positionOnGround(mesh, type);
    return obj;
  }

  private buildMesh(type: PrimitiveType): THREE.Mesh {
    let geometry: THREE.BufferGeometry;
    let material: THREE.MeshStandardMaterial;

    switch (type) {
      case 'cube':
        geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
        break;
      case 'sphere':
        geometry = new THREE.SphereGeometry(0.8, 32, 24);
        break;
      case 'cylinder':
        geometry = new THREE.CylinderGeometry(0.7, 0.7, 1.4, 32);
        break;
      case 'plane':
        geometry = new THREE.PlaneGeometry(3, 3);
        break;
    }

    material = new THREE.MeshStandardMaterial({
      color: this.defaultColor(type),
      roughness: 0.6,
      metalness: 0,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private positionOnGround(mesh: THREE.Mesh, type: PrimitiveType): void {
    if (type === 'plane') {
      mesh.rotation.x = -Math.PI / 2; // lay flat on the ground
    } else {
      // Drop the primitive so its base sits on y = 0.
      const box = new THREE.Box3().setFromObject(mesh);
      mesh.position.y = -box.min.y;
    }
  }

  private defaultName(type: PrimitiveType): string {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  private defaultColor(type: PrimitiveType): number {
    switch (type) {
      case 'cube':
        return 0xff8844;
      case 'sphere':
        return 0x44bbff;
      case 'cylinder':
        return 0x88dd44;
      case 'plane':
        return 0xcccccc;
    }
  }

  /** Ground plane helper used for reference and shadow catching. */
  groundPlane(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(60, 60);
    const material = new THREE.MeshStandardMaterial({
      color: 0x1b2738,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.85,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    mesh.visible = false; // grid helper is the visible ground
    return mesh;
  }
}