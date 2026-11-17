import * as THREE from 'three';
import type { ImageInput } from './types';

/**
 * Procedural fallback geometry.
 *
 * Free Hugging Face endpoints are often cold or rate limited. When a
 * generation call fails, the app still has to put a real mesh in the scene,
 * so this module derives a mesh from the inputs it already has: the prompt
 * text shapes an extruded polygon, the source image becomes a relief.
 */

export interface ProceduralMesh {
  mesh: THREE.Mesh;
  name: string;
  description: string;
}

const IMAGE_EXTENT = 2;

export function buildProceduralMesh(prompt: string, image?: ImageInput): ProceduralMesh {
  const pixels = image?.pixels;
  if (pixels && pixels.length > 0) return fromImage(prompt, pixels, image);
  return fromPrompt(prompt);
}

function fromPrompt(prompt: string): ProceduralMesh {
  const seed = hashString(prompt || 'ai-3d');
  const random = mulberry32(seed);
  const sides = 5 + Math.floor(random() * 5);
  const radius = 0.55 + random() * 0.7;
  const depth = 0.35 + random() * 1.1;
  const jitter = 0.12 + random() * 0.28;

  const shape = new THREE.Shape();
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2;
    const r = radius * (1 - jitter * random());
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize: 0.04,
    bevelThickness: 0.04,
    bevelSegments: 2,
    curveSegments: 1,
  });
  geometry.center();
  geometry.computeVertexNormals();

  const color = new THREE.Color().setHSL((seed % 360) / 360, 0.55, 0.55);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.05,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return {
    mesh,
    name: `Procedural 3D (${shortLabel(prompt)})`,
    description: `Extruded ${sides}-sided mesh derived from the prompt.`,
  };
}

function fromImage(prompt: string, pixels: number[], image?: ImageInput): ProceduralMesh {
  const width = Math.max(2, Math.min(image?.width ?? 0, pixels.length) || pixels.length);
  const height = Math.max(2, Math.min(image?.height ?? 0, Math.floor(pixels.length / width)) || 1);
  const columns = Math.min(width, 64);
  const rows = Math.min(height, 64);
  const stepX = width / columns;
  const stepY = height / rows;

  const geometry = new THREE.PlaneGeometry(IMAGE_EXTENT, IMAGE_EXTENT, columns - 1, rows - 1);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  let sum = 0;
  for (let i = 0; i < position.count; i++) {
    const col = Math.min(columns - 1, Math.floor((i % columns) * stepX));
    const row = Math.min(rows - 1, Math.floor((Math.floor(i / columns) % rows) * stepY));
    const luminance = pixels[row * width + col] ?? 0;
    sum += luminance;
    position.setZ(i, (luminance / 255) * 0.9);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();

  const average = sum / Math.max(position.count, 1);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL((1 - average / 255) * 0.7, 0.45, 0.5),
    roughness: 0.75,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return {
    mesh,
    name: `Procedural Relief (${shortLabel(prompt || image?.name || 'image')})`,
    description: 'Relief mesh extruded from the source image luminance.',
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shortLabel(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return 'generated';
  return clean.length > 28 ? `${clean.slice(0, 28)}…` : clean;
}
