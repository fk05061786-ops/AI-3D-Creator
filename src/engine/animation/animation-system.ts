import * as THREE from 'three';
import type { SceneGraph } from '../core/scene-graph';
import type { SceneObject } from '../core/object-model';
import type { SkeletonRig } from '../rigging/skeleton';

export type AnimatedProperty = 'position' | 'rotation' | 'scale';
export type AnimationTargetKind = 'object' | 'bone';

export interface SerializedAnimationTrack {
  property: AnimatedProperty;
  targetKind: AnimationTargetKind;
  targetId: string;
  times: number[];
  values: number[];
}

export interface SerializedAnimationClip {
  name: string;
  duration: number;
  fps: number;
  loop: boolean;
  tracks: SerializedAnimationTrack[];
}

interface Keyframe {
  time: number;
  value: number[];
}

interface TrackData {
  property: AnimatedProperty;
  targetKind: AnimationTargetKind;
  targetId: string;
  keyframes: Keyframe[];
}

interface ClipData {
  name: string;
  duration: number;
  fps: number;
  loop: boolean;
  tracks: TrackData[];
}

const VALUE_SIZE: Record<AnimatedProperty, number> = { position: 3, rotation: 4, scale: 3 };

/**
 * Keyframe animation system built on THREE.AnimationMixer / AnimationClip /
 * KeyframeTrack. Tracks bind to nodes by uuid so meshes and bones share one
 * code path, and every clip serializes into the project document.
 */
export class AnimationSystem {
  readonly mixer: THREE.AnimationMixer;

  private readonly clips = new Map<string, ClipData>();
  private readonly built = new Map<string, THREE.AnimationClip>();
  private readonly changeHandlers = new Set<() => void>();
  private action: THREE.AnimationAction | null = null;
  private currentClipName: string | null = null;
  private playing = false;
  private loop = true;

  constructor(
    private readonly root: THREE.Object3D,
    private readonly graph: SceneGraph,
    private readonly rig: SkeletonRig | null
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    this.mixer.addEventListener('finished', (event) => {
      if (event.action !== this.action) return;
      this.playing = false;
      this.emitChange();
    });
  }

  get clipNames(): string[] {
    return [...this.clips.keys()];
  }

  get currentClip(): string | null {
    return this.currentClipName;
  }

  get currentTime(): number {
    return this.action?.time ?? 0;
  }

  get duration(): number {
    return this.currentClipData?.duration ?? 0;
  }

  get fps(): number {
    return this.currentClipData?.fps ?? 30;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get loopEnabled(): boolean {
    return this.loop;
  }

  get currentFrame(): number {
    return Math.round(this.currentTime * this.fps);
  }

  get totalFrames(): number {
    return Math.round(this.duration * this.fps);
  }

  onChange(handler: () => void): () => void {
    this.changeHandlers.add(handler);
    return () => this.changeHandlers.delete(handler);
  }

  private get currentClipData(): ClipData | null {
    return this.currentClipName ? (this.clips.get(this.currentClipName) ?? null) : null;
  }

  private emitChange(): void {
    for (const handler of this.changeHandlers) handler();
  }

  createClip(name?: string, duration = 2, fps = 30): string {
    let clipName = (name ?? '').trim() || `Clip ${this.clips.size + 1}`;
    let suffix = 2;
    while (this.clips.has(clipName)) clipName = `${name ?? 'Clip'} ${suffix++}`;
    const clip: ClipData = {
      name: clipName,
      duration: Math.max(0.1, duration),
      fps: Math.max(1, fps),
      loop: this.loop,
      tracks: [],
    };
    this.clips.set(clip.name, clip);
    this.rebuild(clip);
    this.selectClip(clip.name);
    this.emitChange();
    return clip.name;
  }

  removeClip(name: string): void {
    const clip = this.clips.get(name);
    if (!clip) return;
    if (this.currentClipName === name) {
      this.mixer.stopAllAction();
      this.action = null;
      this.currentClipName = null;
      this.playing = false;
    }
    this.clips.delete(name);
    this.built.delete(name);
    this.emitChange();
  }

  selectClip(name: string | null): void {
    this.mixer.stopAllAction();
    this.action = null;
    this.currentClipName = name;
    this.playing = false;
    const built = name ? this.built.get(name) : undefined;
    if (built) {
      const action = this.mixer.clipAction(built);
      action.setLoop(this.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = !this.loop;
      action.play();
      action.paused = true;
      this.action = action;
    }
    this.emitChange();
  }

  play(name?: string): void {
    const clipName = name ?? this.currentClipName;
    if (!clipName) return;
    if (this.currentClipName !== clipName || !this.action) this.selectClip(clipName);
    const action = this.action;
    if (!action) return;
    action.paused = false;
    action.play();
    this.playing = true;
    this.emitChange();
  }

  pause(): void {
    if (!this.action) return;
    this.action.paused = true;
    this.playing = false;
    this.emitChange();
  }

  stop(): void {
    const action = this.action;
    if (!action) return;
    action.stop();
    action.reset();
    action.paused = true;
    action.time = 0;
    this.mixer.update(0);
    this.playing = false;
    this.emitChange();
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    const clip = this.currentClipData;
    if (clip) clip.loop = loop;
    if (this.action) {
      this.action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      this.action.clampWhenFinished = !loop;
    }
    this.emitChange();
  }

  /** Move the playhead without changing the play/pause state. */
  scrub(time: number): void {
    const action = this.action;
    if (!action) return;
    const t = THREE.MathUtils.clamp(time, 0, this.duration);
    const wasPaused = action.paused;
    action.paused = true;
    action.time = t;
    this.mixer.update(0);
    action.paused = wasPaused;
    this.emitChange();
  }

  update(deltaTime: number): void {
    if (this.playing) this.mixer.update(deltaTime);
  }

  /** Resolve a scene object or bone into an animatable target. */
  resolveTarget(target: SceneObject | THREE.Bone): {
    kind: AnimationTargetKind;
    id: string;
    node: THREE.Object3D;
  } | null {
    if (target instanceof THREE.Bone) {
      return { kind: 'bone', id: target.name, node: target };
    }
    return { kind: 'object', id: target.meta.id, node: target.three };
  }

  private resolveNode(kind: AnimationTargetKind, id: string): THREE.Object3D | null {
    if (kind === 'bone') return this.rig?.getBone(id) ?? null;
    return this.graph.find(id)?.three ?? null;
  }

  addKeyframe(
    target: SceneObject | THREE.Bone,
    property: AnimatedProperty,
    time: number
  ): boolean {
    const clip = this.currentClipData;
    if (!clip) return false;
    const resolved = this.resolveTarget(target);
    if (!resolved) return false;

    let track = clip.tracks.find(
      (t) =>
        t.property === property && t.targetKind === resolved.kind && t.targetId === resolved.id
    );
    if (!track) {
      track = { property, targetKind: resolved.kind, targetId: resolved.id, keyframes: [] };
      clip.tracks.push(track);
    }

    const t = THREE.MathUtils.clamp(time, 0, clip.duration);
    const value = this.readValue(resolved.node, property);
    const existing = track.keyframes.find((k) => Math.abs(k.time - t) < 1e-4);
    if (existing) existing.value = value;
    else track.keyframes.push({ time: t, value });
    track.keyframes.sort((a, b) => a.time - b.time);

    this.rebuild(clip);
    this.emitChange();
    return true;
  }

  removeKeyframe(
    target: SceneObject | THREE.Bone,
    property: AnimatedProperty,
    time: number
  ): boolean {
    const clip = this.currentClipData;
    if (!clip) return false;
    const resolved = this.resolveTarget(target);
    if (!resolved) return false;
    const track = clip.tracks.find(
      (t) =>
        t.property === property && t.targetKind === resolved.kind && t.targetId === resolved.id
    );
    if (!track) return false;
    const before = track.keyframes.length;
    track.keyframes = track.keyframes.filter((k) => Math.abs(k.time - time) >= 1e-4);
    if (track.keyframes.length === before) return false;
    if (track.keyframes.length === 0) {
      clip.tracks = clip.tracks.filter((t) => t !== track);
    }
    this.rebuild(clip);
    this.emitChange();
    return true;
  }

  keyframeTimes(): number[] {
    const clip = this.currentClipData;
    if (!clip) return [];
    const times = new Set<number>();
    for (const track of clip.tracks) {
      for (const key of track.keyframes) times.add(Number(key.time.toFixed(4)));
    }
    return [...times].sort((a, b) => a - b);
  }

  /** Built three.js clips, ready for GLTF export. */
  getClips(): THREE.AnimationClip[] {
    return [...this.built.values()];
  }

  private readValue(node: THREE.Object3D, property: AnimatedProperty): number[] {
    if (property === 'rotation') {
      const q = node.quaternion;
      return [q.x, q.y, q.z, q.w];
    }
    if (property === 'scale') return [node.scale.x, node.scale.y, node.scale.z];
    return [node.position.x, node.position.y, node.position.z];
  }

  private rebuild(clip: ClipData): void {
    const tracks: THREE.KeyframeTrack[] = [];
    for (const track of clip.tracks) {
      const built = this.buildTrack(track);
      if (built) tracks.push(built);
    }
    this.built.set(clip.name, new THREE.AnimationClip(clip.name, clip.duration, tracks));

    if (this.currentClipName !== clip.name) return;
    const time = this.action?.time ?? 0;
    const wasPlaying = this.playing;
    this.mixer.stopAllAction();
    this.action = null;
    this.selectClip(clip.name);
    this.scrub(time);
    if (wasPlaying) this.play(clip.name);
  }

  private buildTrack(track: TrackData): THREE.KeyframeTrack | null {
    const node = this.resolveNode(track.targetKind, track.targetId);
    if (!node || track.keyframes.length === 0) return null;
    const times = track.keyframes.map((k) => k.time);
    const values: number[] = [];
    for (const key of track.keyframes) values.push(...key.value);
    // GLTFExporter only maps the "quaternion" property to a rotation channel.
    const name = `${node.uuid}.${track.property === 'rotation' ? 'quaternion' : track.property}`;
    if (track.property === 'rotation') {
      return new THREE.QuaternionKeyframeTrack(name, times, values);
    }
    return new THREE.VectorKeyframeTrack(name, times, values);
  }

  serialize(): SerializedAnimationClip[] {
    return [...this.clips.values()].map((clip) => ({
      name: clip.name,
      duration: clip.duration,
      fps: clip.fps,
      loop: clip.loop,
      tracks: clip.tracks.map((track) => ({
        property: track.property,
        targetKind: track.targetKind,
        targetId: track.targetId,
        times: track.keyframes.map((k) => k.time),
        values: track.keyframes.flatMap((k) => k.value),
      })),
    }));
  }

  load(data: SerializedAnimationClip[] | null | undefined): boolean {
    this.mixer.stopAllAction();
    this.action = null;
    this.clips.clear();
    this.built.clear();
    this.currentClipName = null;
    this.playing = false;
    if (!Array.isArray(data)) {
      this.emitChange();
      return false;
    }

    for (const item of data) {
      if (!item || !Array.isArray(item.tracks)) continue;
      const clip: ClipData = {
        name: item.name || 'Clip',
        duration: Math.max(0.1, item.duration || 2),
        fps: Math.max(1, item.fps || 30),
        loop: item.loop !== false,
        tracks: item.tracks.map((track) => {
          const size = VALUE_SIZE[track.property] ?? 3;
          const keyframes: Keyframe[] = [];
          const times = Array.isArray(track.times) ? track.times : [];
          const values = Array.isArray(track.values) ? track.values : [];
          for (let i = 0; i < times.length; i++) {
            keyframes.push({
              time: times[i],
              value: values.slice(i * size, i * size + size),
            });
          }
          return {
            property: track.property,
            targetKind: track.targetKind,
            targetId: track.targetId,
            keyframes,
          };
        }),
      };
      this.clips.set(clip.name, clip);
      this.rebuild(clip);
    }

    this.emitChange();
    return true;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.clips.clear();
    this.built.clear();
    this.changeHandlers.clear();
  }
}

export const ANIMATION_STATUS = 'implemented';
