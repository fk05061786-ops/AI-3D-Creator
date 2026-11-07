import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const viewport = document.querySelector('#viewport')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x182235);

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
camera.position.set(5, 4, 7);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.GridHelper(20, 20, 0x6688aa, 0x334455));
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2));

const light = new THREE.DirectionalLight(0xffffff, 3);
light.position.set(5, 8, 5);
scene.add(light);

const objects = new THREE.Group();
scene.add(objects);

function addCube() {
  const geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
  const material = new THREE.MeshStandardMaterial({ color: 0xff8844, roughness: 0.55 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.75;
  objects.add(mesh);
}

function addSphere() {
  const geometry = new THREE.SphereGeometry(0.8, 32, 24);
  const material = new THREE.MeshStandardMaterial({ color: 0x44bbff });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.8;
  objects.add(mesh);
}

document.querySelector('#addCube')!.addEventListener('click', addCube);
document.querySelector('#addSphere')!.addEventListener('click', addSphere);
document.querySelector('#reset')!.addEventListener('click', () => {
  objects.clear();
  camera.position.set(5, 4, 7);
  controls.target.set(0, 0, 0);
  controls.update();
});

document.querySelector('#export')!.addEventListener('click', () => {
  const exporter = new GLTFExporter();
  exporter.parse(scene, (result) => {
    const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'AI-3D-Creator.glb';
    link.click();
    URL.revokeObjectURL(url);
  }, (error) => {
    alert('Export error: ' + error);
  }, { binary: true });
});

function resize() {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

new ResizeObserver(resize).observe(viewport);
resize();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
