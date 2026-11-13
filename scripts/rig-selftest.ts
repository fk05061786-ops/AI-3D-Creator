/**
 * Headless Phase 6 rig self-check.
 * shortcut: uses the esbuild binary shipped with Vite; move to a real test
 * runner when the project adds one.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { SkeletonRig } from '../src/engine/rigging/skeleton';
import { SceneGraph } from '../src/engine/core/scene-graph';

class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob: Blob): void {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`;
      this.onloadend?.();
    });
  }
}
(globalThis as { FileReader?: typeof NodeFileReader }).FileReader = NodeFileReader;

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error('FAIL: ' + message);
}

const scene = new THREE.Scene();
const graph = new SceneGraph();
scene.add(graph.root);

const body = graph.addPrimitive('cube', 'Body')!;
const rig = new SkeletonRig(scene);
rig.createHumanoidRig(body);
assert(rig.bones.length === 21, 'humanoid has 21 bones');
assert(rig.rootBone?.name === 'hips', 'humanoid root is hips');

const parent = rig.createBone('extraRoot', null, [0, 0, 0]);
const child = rig.addChildBone(parent.name);
assert(child.parent === parent, 'bone parenting');
rig.removeBone('extraRoot');
assert(rig.getBone('extraRoot') === null, 'bone deletion');

assert(rig.bind(body), 'bind selected mesh');
assert(body.three instanceof THREE.SkinnedMesh, 'mesh becomes SkinnedMesh');
const geometry = (body.three as THREE.SkinnedMesh).geometry;
const skinIndex = geometry.attributes.skinIndex;
const skinWeight = geometry.attributes.skinWeight;
assert(!!skinIndex && !!skinWeight, 'skin attributes created');
for (let i = 0; i < skinWeight.count; i++) {
  let sum = 0;
  for (let slot = 0; slot < 4; slot++) sum += skinWeight.getComponent(i, slot);
  assert(Math.abs(sum - 1) < 1e-4, 'weights normalized');
}

const arm = rig.getBone('leftUpperArm')!;
assert(arm.children.length > 0, 'arm has a child bone');
const hand = arm.children[0] as THREE.Bone;
scene.updateMatrixWorld(true);
const before = hand.getWorldPosition(new THREE.Vector3());
arm.rotation.z = Math.PI / 2;
scene.updateMatrixWorld(true);
assert(before.distanceTo(hand.getWorldPosition(new THREE.Vector3())) > 0.01, 'pose transforms hierarchy');
rig.resetPose();
scene.updateMatrixWorld(true);
assert(hand.getWorldPosition(new THREE.Vector3()).distanceTo(before) < 1e-4, 'rest pose resets');

assert(rig.paint(new THREE.Vector3(0.5, 1, 0.5), true, 'leftUpperArm', 3, 0.8) > 0, 'weight painting');
assert(rig.paint(new THREE.Vector3(0.5, 1, 0.5), false, 'leftUpperArm', 3, 0.8) > 0, 'weight subtraction');

const saved = rig.serialize('TestRig');
const savedJson = JSON.stringify(saved);
assert(saved.weights !== null, 'weights serialized');

const sceneData = graph.toJSON();
const scene2 = new THREE.Scene();
const graph2 = new SceneGraph();
scene2.add(graph2.root);
graph2.fromJSON(sceneData);
const restored = graph2.objects[0];
const rig2 = new SkeletonRig(scene2);
assert(rig2.load(JSON.parse(savedJson), graph2), 'rig data loaded');
assert(rig2.target === restored, 'rig rebound to restored mesh');
assert(rig2.targetMesh !== null, 'restored mesh is skinned');
assert(rig2.bones.length === 21, 'bones restored');

const glb = await new Promise<ArrayBuffer>((resolve, reject) => {
  new GLTFExporter().parse(scene2, (result) => resolve(result as ArrayBuffer), reject, { binary: true });
});
const glbText = new TextDecoder().decode(new Uint8Array(glb));
assert(glb.byteLength > 1000, 'rigged GLB exported');
assert(glbText.includes('"skins"') && glbText.includes('JOINTS_0'), 'GLB contains skin data');

rig2.unbind();
assert(restored.three instanceof THREE.Mesh && !(restored.three instanceof THREE.SkinnedMesh), 'unbind restores Mesh');
assert(!restored.three.geometry.attributes.skinIndex, 'unbind removes skin attributes');

console.log('PHASE 6 RIG SELFTEST PASS');
