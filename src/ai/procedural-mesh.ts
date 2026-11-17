import * as THREE from "three";
import type { ImageInput } from "./types";

export interface ProceduralResult {
  mesh: THREE.Object3D;
  name: string;
}

export function buildProceduralMesh(prompt: string, image?: ImageInput): ProceduralResult {
  const group = new THREE.Group();
  const lowerPrompt = prompt.toLowerCase();
  
  // Choose color based on prompt or image
  let baseColor = 0x3b82f6; // Blue default
  if (lowerPrompt.includes("red") || lowerPrompt.includes("fire") || lowerPrompt.includes("car")) baseColor = 0xef4444;
  else if (lowerPrompt.includes("green") || lowerPrompt.includes("tree") || lowerPrompt.includes("nature")) baseColor = 0x10b981;
  else if (lowerPrompt.includes("gold") || lowerPrompt.includes("yellow") || lowerPrompt.includes("sun")) baseColor = 0xf59e0b;
  else if (lowerPrompt.includes("dark") || lowerPrompt.includes("ninja") || lowerPrompt.includes("metal")) baseColor = 0x475569;

  const mat = new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.3,
    metalness: 0.4,
  });

  // If image is provided, extract average tone
  if (image && image.pixels && image.pixels.length > 0) {
    const avg = image.pixels.reduce((a, b) => a + b, 0) / image.pixels.length;
    mat.color.setHSL((avg % 360) / 360, 0.6, 0.5);
  }

  // Build composite realistic 3D geometry structure based on intent
  if (lowerPrompt.includes("car") || lowerPrompt.includes("vehicle") || lowerPrompt.includes("bike")) {
    // Chassis
    const geomBox = new THREE.BoxGeometry(2, 0.6, 1);
    const boxMesh = new THREE.Mesh(geomBox, mat);
    boxMesh.position.y = 0.3;
    group.add(boxMesh);

    // Cabin
    const geomCabin = new THREE.BoxGeometry(1, 0.5, 0.9);
    const cabinMesh = new THREE.Mesh(geomCabin, new THREE.MeshStandardMaterial({ color: 0x93c5fd, roughness: 0.1 }));
    cabinMesh.position.set(-0.2, 0.8, 0);
    group.add(cabinMesh);

    // Wheels
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
    const wheelGeom = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 16);
    wheelGeom.rotateX(Math.PI / 2);
    [-0.6, 0.6].forEach(x => {
      [-0.55, 0.55].forEach(z => {
        const wheel = new THREE.Mesh(wheelGeom, wheelMat);
        wheel.position.set(x, 0.3, z);
        group.add(wheel);
      });
    });
  } else if (lowerPrompt.includes("tree") || lowerPrompt.includes("plant") || lowerPrompt.includes("nature")) {
    // Trunk
    const trunkGeom = new THREE.CylinderGeometry(0.15, 0.2, 1.2, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 });
    const trunk = new THREE.Mesh(trunkGeom, trunkMat);
    trunk.position.y = 0.6;
    group.add(trunk);

    // Foliage
    const leavesGeom = new THREE.ConeGeometry(0.8, 1.8, 8);
    const leavesMat = new THREE.MeshStandardMaterial({ color: 0x059669, roughness: 0.5 });
    const leaves = new THREE.Mesh(leavesGeom, leavesMat);
    leaves.position.y = 1.8;
    group.add(leaves);
  } else {
    // Default multi-tiered futuristic sculpture / object
    const coreGeom = new THREE.BoxGeometry(1, 1, 1);
    const core = new THREE.Mesh(coreGeom, mat);
    core.position.y = 0.5;
    group.add(core);

    const topGeom = new THREE.OctahedronGeometry(0.7);
    const top = new THREE.Mesh(topGeom, new THREE.MeshStandardMaterial({ color: 0x6366f1, metalness: 0.8 }));
    top.position.y = 1.5;
    group.add(top);
  }

  return {
    mesh: group,
    name: prompt ? prompt.slice(0, 20) : "Procedural 3D Model",
  };
}
