import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

/**
 * Wraps three.js TransformControls so the editor can move/rotate/scale
 * a selected object. Pointer events are captured on the renderer's
 * canvas so touch + mouse both work, and OrbitControls is disabled
 * while a transform is in progress (otherwise the two fight over the
 * same pointer).
 */
export class TransformControlsEx {
  readonly controls: TransformControls;
  private _dragging = false;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.controls = new TransformControls(camera, dom);
    this.controls.addEventListener('mouseDown', () => (this._dragging = true));
    this.controls.addEventListener('mouseUp', () => (this._dragging = false));
  }

  get dragging(): boolean {
    return this._dragging;
  }

  attach(object: THREE.Object3D | null): void {
    this.controls.detach();
    if (object) this.controls.attach(object);
  }

  setMode(mode: 'translate' | 'rotate' | 'scale'): void {
    this.controls.setMode(mode);
  }

  set enabled(value: boolean) {
    this.controls.enabled = value;
  }

  get enabled(): boolean {
    return this.controls.enabled;
  }

  get object(): THREE.Object3D | null {
    return this.controls.object;
  }

  dispose(): void {
    this.controls.dispose();
  }
}