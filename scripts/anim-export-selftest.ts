/**
 * Headless self-check for the animation and export systems.
 * shortcut: uses the esbuild binary shipped with Vite; move to a real test
 * runner when the project adds one.
 */
import * as THREE from 'three';
import { SkeletonRig } from '../src/engine/rigging/skeleton';
import { AnimationSystem } from '../src/engine/animation/animation-system';
import { ExportManager } from '../src/engine/export/export-manager';
import { SceneGraph } from '../src/engine/core/scene-graph';
import { ProjectManager } from '../src/engine/core/project-manager';
import { blobToBase64 } from '../src/engine/export/file-download';

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
assert(rig.bind(body), 'mesh bound to rig');
assert(body.isSkinned, 'SceneObject reports skinned state');

const animation = new AnimationSystem(scene, graph, rig);
const clipName = animation.createClip('Walk', 2, 30);
assert(animation.currentClip === clipName, 'clip created and selected');

body.three.position.set(0, 0, 0);
assert(animation.addKeyframe(body, 'position', 0), 'object position key added');
body.three.position.set(2, 0, 0);
assert(animation.addKeyframe(body, 'position', 1), 'object position key added at 1s');

const arm = rig.getBone('leftUpperArm')!;
arm.quaternion.identity();
assert(animation.addKeyframe(arm, 'rotation', 0), 'bone rotation key added');
arm.quaternion.setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
assert(animation.addKeyframe(arm, 'rotation', 1), 'bone rotation key added at 1s');

assert(animation.keyframeTimes().length === 2, 'two keyframe times recorded');

animation.scrub(0.5);
assert(Math.abs(body.three.position.x - 1) < 1e-3, 'position interpolated at 0.5s');
const halfTurn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 4));
assert(arm.quaternion.angleTo(halfTurn) < 1e-3, 'bone rotation interpolated at 0.5s');

animation.scrub(1);
assert(Math.abs(body.three.position.x - 2) < 1e-3, 'position reaches last key');
assert(arm.quaternion.angleTo(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2))) < 1e-3, 'bone reaches last key');

animation.play();
for (let i = 0; i < 15; i++) animation.update(1 / 30);
assert(animation.currentTime > 1.4 && animation.currentTime < 1.6, 'playback advances the clock');

animation.pause();
const pausedTime = animation.currentTime;
animation.update(0.5);
assert(Math.abs(animation.currentTime - pausedTime) < 1e-6, 'pause freezes the clock');

animation.stop();
assert(animation.currentTime === 0, 'stop rewinds the clock');

animation.setLoop(false);
assert(animation.loopEnabled === false, 'loop toggled off');
animation.setLoop(true);
assert(animation.loopEnabled === true, 'loop toggled on');

const serialized = animation.serialize();
assert(serialized.length === 1, 'one clip serialized');
assert(serialized[0].tracks.length === 2, 'two tracks serialized');
assert(serialized[0].tracks[0].values.length === 6, 'position track stores two vectors');

const animation2 = new AnimationSystem(scene, graph, rig);
assert(animation2.load(JSON.parse(JSON.stringify(serialized))), 'clips loaded');
assert(animation2.clipNames.length === 1, 'clip restored');
animation2.selectClip('Walk');
animation2.scrub(0.5);
assert(Math.abs(body.three.position.x - 1) < 1e-3, 'restored clip scrubs correctly');

const project = new ProjectManager().createProject(
  'RigProject',
  graph,
  { rig: rig.serialize(), animations: animation.serialize() }
);
assert(project.rig !== null && project.rig.bones.length === 21, 'rig stored in project');
assert(project.animations !== null && project.animations.length === 1, 'animations stored in project');

const exporter = new ExportManager(scene, rig, animation);
const glb = await exporter.export('glb');
assert(glb.blob.size > 1000, 'GLB export produced data');
const glbText = new TextDecoder().decode(new Uint8Array(await glb.blob.arrayBuffer()));
assert(glbText.includes('"skins"') && glbText.includes('JOINTS_0'), 'GLB contains skin data');
assert(glbText.includes('"animations"'), 'GLB contains animation data');
assert(glb.filename.endsWith('.glb'), 'GLB filename has extension');

const gltf = await exporter.export('gltf');
const gltfJson = JSON.parse(await gltf.blob.text()) as {
  animations?: unknown[];
  skins?: unknown[];
  nodes?: unknown[];
};
assert(Array.isArray(gltfJson.animations) && gltfJson.animations.length === 1, 'GLTF has one animation');
assert(Array.isArray(gltfJson.skins) && gltfJson.skins.length === 1, 'GLTF has one skin');
assert(Array.isArray(gltfJson.nodes) && gltfJson.nodes.length > 0, 'GLTF has nodes');

const obj = await exporter.export('obj');
const objText = await obj.blob.text();
assert(objText.includes('v '), 'OBJ contains vertices');
assert(objText.includes('f '), 'OBJ contains faces');

const stl = await exporter.export('stl');
assert(stl.blob.size > 84, 'binary STL produced data');
const stlBytes = new Uint8Array(await stl.blob.arrayBuffer());
assert(stlBytes.byteLength >= 84, 'STL header present');

const base64 = await blobToBase64(new Blob([new Uint8Array([1, 2, 3])]));
assert(base64 === 'AQID', 'blob base64 encoding');

console.log('ANIMATION + EXPORT SELFTEST PASS');
