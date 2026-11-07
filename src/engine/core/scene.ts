import * as THREE from 'three';

/**
 * The 3D scene: world container with lighting and grid.
 * Mobile note: keep lights cheap (1 sun + 1 hemisphere) so mid-range
 * Android GPUs stay at 60fps.
 */
export class Scene {
  readonly three = new THREE.Scene();
  readonly grid: THREE.GridHelper;
  readonly hemisphere: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;

  constructor() {
    this.three.background = new THREE.Color(0x182235);
    this.three.fog = new THREE.Fog(0x182235, 22, 60);

    this.grid = new THREE.GridHelper(24, 24, 0x557799, 0x2c3a52);
    this.grid.position.y = 0.001; // z-fighting guard vs. ground plane
    this.three.add(this.grid);

    this.hemisphere = new THREE.HemisphereLight(0xffffff, 0x445566, 1.6);
    this.three.add(this.hemisphere);

    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.position.set(6, 10, 5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 40;
    this.sun.shadow.camera.left = -12;
    this.sun.shadow.camera.right = 12;
    this.sun.shadow.camera.top = 12;
    this.sun.shadow.camera.bottom = -12;
    this.three.add(this.sun);
  }

  /** Clear every user-created object but keep lights/grid/fog. */
  clearObjects(root: THREE.Group): void {
    const keep = new Set<THREE.Object3D>([this.grid, this.hemisphere, this.sun]);
    for (const child of [...root.children]) {
      if (!keep.has(child)) root.remove(child);
    }
  }
}