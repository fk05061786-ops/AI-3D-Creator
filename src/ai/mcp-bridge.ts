import type { AnimatedProperty } from '../engine/animation/animation-system';
import type { ExportFormat } from '../engine/export/export-manager';
import type { EditorEngine } from '../engine/core/editor-engine';

/**
 * MCP (Model Context Protocol) bridge for the 3D editor.
 *
 * This module holds two things:
 *   1. the tool catalogue and the pure tool executor, shared by the browser
 *      bridge and the Node MCP server, and
 *   2. McpBridge, the browser transport that connects the running editor to
 *      the local MCP server over HTTP/SSE (default port 3333).
 *
 * Everything here is DOM free at import time so the Node server can reuse the
 * tool catalogue without pulling in browser APIs.
 */

export const MCP_BRIDGE_PORT = 3333;
export const MCP_DEFAULT_URL = `http://127.0.0.1:${MCP_BRIDGE_PORT}`;

export type McpPrimitiveType = 'cube' | 'sphere' | 'cylinder' | 'plane';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

export interface McpObjectLike {
  meta: { id: string; name: string; parentId: string | null; visible: boolean };
  three: {
    name?: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: { x: number; y: number; z: number };
    isMesh?: boolean;
    updateMatrixWorld?: (force?: boolean) => void;
  };
}

/**
 * The slice of EditorEngine the MCP tools need. Keeping it structural lets
 * the headless self-test drive the same code with a fake editor.
 */
export interface McpEditorAdapter {
  graph: {
    objects: McpObjectLike[];
    selected: McpObjectLike | null;
    find(id: string): McpObjectLike | undefined;
  };
  addPrimitive(type: McpPrimitiveType): McpObjectLike | null;
  rig: {
    bones: { name: string }[];
    activeBone: { name: string } | null;
    createHumanoidRig(target?: McpObjectLike | null): void;
    bind(target: McpObjectLike, autoWeights?: boolean): boolean;
  };
  animation: {
    clipNames: string[];
    currentClip: string | null;
    currentTime: number;
    isPlaying: boolean;
    createClip(name?: string, duration?: number, fps?: number): string;
    addKeyframe(target: unknown, property: AnimatedProperty, time: number): boolean;
    play(name?: string): void;
    pause(): void;
    stop(): void;
  };
  exporter: {
    export(format: ExportFormat, filename?: string): Promise<{ filename: string; blob: { size: number } }>;
  };
}

/** Adapt the live editor engine to the tool interface. */
export function createEditorAdapter(engine: EditorEngine): McpEditorAdapter {
  return engine as unknown as McpEditorAdapter;
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'list_scene_objects',
    description: 'List every object in the current 3D scene with id, name and transform.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_primitive',
    description: 'Add a primitive mesh (cube, sphere, cylinder or plane) to the scene.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['cube', 'sphere', 'cylinder', 'plane'] },
        name: { type: 'string', description: 'Optional object name.' },
      },
      required: ['type'],
    },
  },
  {
    name: 'transform_object',
    description: 'Move, rotate or scale a scene object by id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Scene object id from list_scene_objects.' },
        position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        rotation: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
        scale: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
      },
      required: ['id'],
    },
  },
  {
    name: 'bind_humanoid_rig',
    description: 'Create a 21 bone humanoid skeleton and bind it to a mesh (selected object when id is omitted).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Scene object id to bind. Defaults to the selected object.' },
      },
    },
  },
  {
    name: 'add_animation_keyframe',
    description: 'Record a position, rotation or scale keyframe for an object or a bone.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Scene object id. Defaults to the selected object.' },
        bone: { type: 'string', description: 'Bone name instead of an object id.' },
        property: { type: 'string', enum: ['position', 'rotation', 'scale'] },
        time: { type: 'number', description: 'Keyframe time in seconds. Defaults to the playhead.' },
        clip: { type: 'string', description: 'Clip name. Defaults to the current clip.' },
      },
      required: ['property'],
    },
  },
  {
    name: 'play_stop_animation',
    description: 'Play, pause or stop the animation timeline.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['play', 'pause', 'stop'] },
        clip: { type: 'string', description: 'Clip name to play. Defaults to the current clip.' },
      },
      required: ['action'],
    },
  },
  {
    name: 'export_scene_glb_obj_stl',
    description: 'Export the scene as GLB, GLTF, OBJ or STL and report the generated file name and size.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['glb', 'gltf', 'obj', 'stl'] },
        filename: { type: 'string', description: 'Optional file name without extension.' },
      },
      required: ['format'],
    },
  },
];

function ok(payload: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}

function fail(message: string): McpToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function vec(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const nums = value.map((n) => Number(n));
  return nums.every((n) => Number.isFinite(n)) ? (nums as [number, number, number]) : null;
}

function summary(object: McpObjectLike): Record<string, unknown> {
  return {
    id: object.meta.id,
    name: object.meta.name,
    parentId: object.meta.parentId,
    visible: object.meta.visible,
    isMesh: !!object.three.isMesh,
    position: [object.three.position.x, object.three.position.y, object.three.position.z],
    rotation: [object.three.rotation.x, object.three.rotation.y, object.three.rotation.z],
    scale: [object.three.scale.x, object.three.scale.y, object.three.scale.z],
  };
}

/** Resolve the object an animation tool should act on. */
function resolveAnimationTarget(
  adapter: McpEditorAdapter,
  args: Record<string, unknown>
): McpObjectLike | { name: string } | null {
  const bone = args.bone;
  if (typeof bone === 'string' && bone.length > 0) {
    const found = adapter.rig.bones.find((b) => b.name === bone);
    return found ? { name: found.name } : null;
  }
  const id = args.id;
  if (typeof id === 'string' && id.length > 0) return adapter.graph.find(id) ?? null;
  return adapter.graph.selected;
}

/**
 * Execute one MCP tool against the editor. Pure: no DOM, no network.
 */
export async function executeMcpTool(
  adapter: McpEditorAdapter,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  try {
    switch (name) {
      case 'list_scene_objects': {
        return ok({ count: adapter.graph.objects.length, objects: adapter.graph.objects.map(summary) });
      }

      case 'add_primitive': {
        const type = String(args.type ?? '') as McpPrimitiveType;
        if (!['cube', 'sphere', 'cylinder', 'plane'].includes(type)) {
          return fail('type must be one of cube, sphere, cylinder, plane');
        }
        const created = adapter.addPrimitive(type);
        if (!created) return fail('Could not create the primitive.');
        const named = typeof args.name === 'string' && args.name.trim() ? args.name.trim() : null;
        if (named) {
          created.meta.name = named;
          created.three.name = named;
        }
        return ok({ created: summary(created) });
      }

      case 'transform_object': {
        const id = String(args.id ?? '');
        const object = adapter.graph.find(id);
        if (!object) return fail(`Object ${id} not found.`);
        const position = vec(args.position);
        const rotation = vec(args.rotation);
        const scale = vec(args.scale);
        if (!position && !rotation && !scale) {
          return fail('Provide at least one of position, rotation or scale.');
        }
        if (position) {
          object.three.position.x = position[0];
          object.three.position.y = position[1];
          object.three.position.z = position[2];
        }
        if (rotation) {
          object.three.rotation.x = rotation[0];
          object.three.rotation.y = rotation[1];
          object.three.rotation.z = rotation[2];
        }
        if (scale) {
          object.three.scale.x = scale[0];
          object.three.scale.y = scale[1];
          object.three.scale.z = scale[2];
        }
        object.three.updateMatrixWorld?.(true);
        return ok({ updated: summary(object) });
      }

      case 'bind_humanoid_rig': {
        const id = args.id ? String(args.id) : '';
        const target = id
          ? adapter.graph.find(id)
          : adapter.graph.selected ?? adapter.graph.objects[adapter.graph.objects.length - 1];
        if (!target) return fail('No object to bind. Add a primitive or pass an object id.');
        adapter.rig.createHumanoidRig(target);
        const bound = adapter.rig.bind(target);
        return ok({
          bound,
          target: summary(target),
          bones: adapter.rig.bones.map((bone) => bone.name),
        });
      }

      case 'add_animation_keyframe': {
        const property = String(args.property ?? '') as AnimatedProperty;
        if (!['position', 'rotation', 'scale'].includes(property)) {
          return fail('property must be one of position, rotation, scale');
        }
        if (!adapter.animation.currentClip) {
          const clip = adapter.animation.createClip(
            typeof args.clip === 'string' ? args.clip : undefined,
            2,
            30
          );
          adapter.animation.play(clip);
        }
        const target = resolveAnimationTarget(adapter, args);
        if (!target) return fail('No animation target. Pass an object id, a bone name or select an object.');
        const time = typeof args.time === 'number' ? args.time : adapter.animation.currentTime;
        const recorded = adapter.animation.addKeyframe(target, property, time);
        if (!recorded) return fail('Could not record the keyframe.');
        return ok({ recorded: true, property, time, target: 'name' in target ? target.name : target.meta.name });
      }

      case 'play_stop_animation': {
        const action = String(args.action ?? 'play');
        const clip = typeof args.clip === 'string' && args.clip ? args.clip : undefined;
        if (action === 'play') adapter.animation.play(clip);
        else if (action === 'pause') adapter.animation.pause();
        else if (action === 'stop') adapter.animation.stop();
        else return fail('action must be one of play, pause, stop');
        return ok({
          action,
          clip: adapter.animation.currentClip,
          time: adapter.animation.currentTime,
          playing: adapter.animation.isPlaying,
          clips: adapter.animation.clipNames,
        });
      }

      case 'export_scene_glb_obj_stl': {
        const format = String(args.format ?? 'glb') as ExportFormat;
        if (!['glb', 'gltf', 'obj', 'stl'].includes(format)) {
          return fail('format must be one of glb, gltf, obj, stl');
        }
        const filename = typeof args.filename === 'string' && args.filename.trim() ? args.filename.trim() : undefined;
        const result = await adapter.exporter.export(format, filename);
        return ok({ format, filename: result.filename, bytes: result.blob.size });
      }

      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return fail(`Tool ${name} failed: ${(error as Error).message}`);
  }
}

export type McpBridgeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface McpBridgeState {
  status: McpBridgeStatus;
  url: string;
  message: string;
}

export const MCP_BRIDGE_STATE_CHANGED = 'ai3d:mcp-bridge-state';

/**
 * Browser side transport: keeps an SSE connection to the local MCP server and
 * answers the tool calls the server forwards.
 */
export class McpBridge {
  private source: EventSource | null = null;
  private readonly adapter: McpEditorAdapter;
  private state: McpBridgeState;

  constructor(adapter: McpEditorAdapter, url: string = MCP_DEFAULT_URL) {
    this.adapter = adapter;
    this.state = { status: 'disconnected', url, message: 'Not connected.' };
  }

  get status(): McpBridgeStatus {
    return this.state.status;
  }

  get message(): string {
    return this.state.message;
  }

  get url(): string {
    return this.state.url;
  }

  get connected(): boolean {
    return this.state.status === 'connected';
  }

  onChange(handler: (state: McpBridgeState) => void): () => void {
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<McpBridgeState>).detail;
      handler(detail);
    };
    window.addEventListener(MCP_BRIDGE_STATE_CHANGED, listener);
    return () => window.removeEventListener(MCP_BRIDGE_STATE_CHANGED, listener);
  }

  connect(): void {
    if (this.source) return;
    this.setState('connecting', 'Connecting to the local MCP bridge…');
    const source = new EventSource(`${this.state.url}/sse`);
    this.source = source;

    source.addEventListener('hello', (event) => {
      const payload = parseEventData(event) as { tools?: number } | null;
      const count = payload?.tools ?? 0;
      this.setState('connected', `Connected to the local MCP bridge (${count} tools).`);
    });

    source.addEventListener('request', (event) => {
      const payload = parseEventData(event) as { id?: number; name?: string; args?: Record<string, unknown> } | null;
      if (!payload || typeof payload.id !== 'number') return;
      void this.handleRequest(payload.id, String(payload.name ?? ''), payload.args ?? {});
    });

    source.onerror = () => {
      if (!this.source) return;
      this.setState('error', 'MCP bridge unreachable. Is the Antigravity MCP server running?');
    };
  }

  disconnect(): void {
    this.source?.close();
    this.source = null;
    this.setState('disconnected', 'Disconnected from the local MCP bridge.');
  }

  private async handleRequest(
    id: number,
    name: string,
    args: Record<string, unknown>
  ): Promise<void> {
    const result = await executeMcpTool(this.adapter, name, args);
    try {
      await fetch(`${this.state.url}/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, result }),
      });
    } catch {
      this.setState('error', 'Could not deliver the MCP response to the server.');
    }
  }

  private setState(status: McpBridgeStatus, message: string): void {
    this.state = { status, url: this.state.url, message };
    window.dispatchEvent(new CustomEvent<McpBridgeState>(MCP_BRIDGE_STATE_CHANGED, { detail: this.state }));
  }
}

function parseEventData(event: Event): unknown {
  try {
    return JSON.parse((event as MessageEvent).data as string);
  } catch {
    return null;
  }
}
