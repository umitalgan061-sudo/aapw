/**
 * R24 next-generation runtime vocabulary.
 *
 * This package is framework-neutral: no DOM, Three.js, WebAudio, Firebase or wall-clock access.
 * It is designed to be the deterministic decision layer underneath the existing browser renderer.
 */

export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type EntityId = Brand<string, 'R24EntityId'>;
export type AssetId = Brand<string, 'R24AssetId'>;
export type QuestId = Brand<string, 'R24QuestId'>;
export type EventId = Brand<number, 'R24EventId'>;

export type RuntimeMode = 'boot' | 'live' | 'paused' | 'degraded' | 'recovering' | 'stopped' | 'failed';
export type QualityTier = 'minimal' | 'low' | 'medium' | 'high' | 'ultra';
export type RenderBackend = 'webgpu' | 'webgl2' | 'headless';
export type StreamTier = 'critical' | 'near' | 'mid' | 'far' | 'dormant';
export type LODLevel = 0 | 1 | 2 | 3;
export type InputSource = 'keyboard' | 'mouse' | 'touch' | 'gamepad' | 'xr' | 'synthetic';

export const asEntityId = (value: string): EntityId => value.trim() as EntityId;
export const asAssetId = (value: string): AssetId => value.trim() as AssetId;
export const asQuestId = (value: string): QuestId => value.trim() as QuestId;
export const asEventId = (value: number): EventId => Math.max(0, Math.floor(value)) as EventId;

export interface Vec2 { readonly x: number; readonly y: number; }
export interface Vec3 { readonly x: number; readonly y: number; readonly z: number; }
export interface InputAxis { readonly x: number; readonly y: number; readonly magnitude: number; }
export interface ColorRGBA { readonly r: number; readonly g: number; readonly b: number; readonly a: number; }

export const vec2 = (x = 0, y = 0): Vec2 => Object.freeze({ x: finite(x), y: finite(y) });
export const vec3 = (x = 0, y = 0, z = 0): Vec3 => Object.freeze({ x: finite(x), y: finite(y), z: finite(z) });
export const add3 = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub3 = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale3 = (a: Vec3, s: number): Vec3 => vec3(a.x * s, a.y * s, a.z * s);
export const length3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const lengthXZ = (a: Vec3): number => Math.hypot(a.x, a.z);
export const normalize3 = (a: Vec3): Vec3 => {
  const length = length3(a);
  return length < 1e-9 ? vec3() : scale3(a, 1 / length);
};

export const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, finite(value, min)));
export const clamp01 = (value: number): number => clamp(value, 0, 1);
export const dampAlpha = (dt: number, responseHz: number): number => 1 - Math.exp(-Math.max(0, dt) * Math.max(0, responseHz) * Math.PI * 2);
export const radialAxis = (x: number, y: number, deadzone = 0.12): InputAxis => {
  const nx = finite(x);
  const ny = finite(y);
  const magnitude = Math.min(1, Math.hypot(nx, ny));
  if (magnitude <= deadzone || magnitude <= 1e-9) return Object.freeze({ x: 0, y: 0, magnitude: 0 });
  const mapped = (magnitude - deadzone) / Math.max(1e-9, 1 - deadzone);
  const factor = mapped / magnitude;
  return Object.freeze({ x: nx * factor, y: ny * factor, magnitude: mapped });
};

export interface Result<T, E = RuntimeFault> {
  readonly ok: true;
  readonly value: T;
}
export interface Failure<E = RuntimeFault> {
  readonly ok: false;
  readonly error: E;
}
export type Outcome<T, E = RuntimeFault> = Result<T, E> | Failure<E>;
export const success = <T>(value: T): Result<T> => Object.freeze({ ok: true, value });
export const failure = <T = never>(error: RuntimeFault): Failure<RuntimeFault> => Object.freeze({ ok: false, error });

export type RuntimeFaultCode =
  | 'invalid'
  | 'disposed'
  | 'budget'
  | 'sequence'
  | 'transition'
  | 'capacity'
  | 'collision'
  | 'asset'
  | 'network'
  | 'checksum'
  | 'recovery';

export interface RuntimeFault {
  readonly code: RuntimeFaultCode;
  readonly message: string;
  readonly recoverable: boolean;
  readonly details?: Readonly<Record<string, string | number | boolean>>;
}
export const fault = (
  code: RuntimeFaultCode,
  message: string,
  recoverable = true,
  details?: Readonly<Record<string, string | number | boolean>>,
): RuntimeFault => Object.freeze({ code, message, recoverable, ...(details ? { details } : {}) });

export const stableSerialize = (value: unknown): string => {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableSerialize).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().map((key) => JSON.stringify(key) + ':' + stableSerialize(record[key])).join(',') + '}';
};

export const stableHash = (value: unknown): string => {
  const text = stableSerialize(value);
  let a = 2166136261;
  let b = 2654435761;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a ^= code;
    a = Math.imul(a, 16777619);
    b ^= code + i;
    b = Math.imul(b, 2246822519);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
};

export interface InputIntent {
  readonly source: InputSource;
  readonly move: InputAxis;
  readonly look: InputAxis;
  readonly zoom: number;
  readonly held: ReadonlySet<string>;
  readonly pressed: ReadonlySet<string>;
  readonly released: ReadonlySet<string>;
  readonly sequence: number;
  readonly sampleTime: number;
}

export interface CharacterState {
  readonly entity: EntityId;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly grounded: boolean;
  readonly groundY: number;
  readonly stamina: number;
  readonly health: number;
  readonly heading: number;
}

export interface CameraState {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly distance: number;
  readonly pitch: number;
  readonly yaw: number;
  readonly fov: number;
  readonly mode: 'follow' | 'combat' | 'lock-on' | 'cinematic';
}

export interface RenderCandidate {
  readonly entity: EntityId;
  readonly distance: number;
  readonly importance: number;
  readonly triangles: number;
  readonly instances: number;
  readonly castsShadow: boolean;
  readonly transparent: boolean;
}

export interface StreamRegion {
  readonly key: string;
  readonly x: number;
  readonly z: number;
  readonly distance: number;
  readonly tier: StreamTier;
  readonly priority: number;
  readonly estimatedBytes: number;
}

export interface RuntimeBudget {
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly inputMs: number;
  readonly streamingMs: number;
  readonly telemetryMs: number;
  readonly memoryBytes: number;
  readonly maxMemoryBytes: number;
}

export interface RuntimeSnapshot {
  readonly tick: number;
  readonly frame: number;
  readonly mode: RuntimeMode;
  readonly character: CharacterState;
  readonly camera: CameraState;
  readonly quality: QualityTier;
  readonly backend: RenderBackend;
  readonly budget: RuntimeBudget;
  readonly digest: string;
}

export interface RuntimeEvent<T = unknown> {
  readonly id: EventId;
  readonly tick: number;
  readonly type: string;
  readonly payload: T;
}

export interface EntityRecord {
  readonly id: EntityId;
  readonly position: Vec3;
  readonly importance: number;
  readonly lod: LODLevel;
  readonly streamTier: StreamTier;
  readonly residentBytes: number;
  readonly updateCostMs: number;
  readonly active: boolean;
  readonly tags: readonly string[];
}

export interface AssetRecord {
  readonly id: AssetId;
  readonly url: string;
  readonly kind: 'model' | 'texture' | 'audio' | 'shader' | 'data';
  readonly priority: number;
  readonly estimatedBytes: number;
  readonly residentBytes: number;
  readonly attempts: number;
  readonly state: 'queued' | 'loading' | 'resident' | 'stale' | 'failed' | 'evicted';
  readonly queuedTick: number;
  readonly lastUsedTick: number;
  readonly retryAtTick?: number;
}

export interface BudgetPolicy {
  readonly maxFrameMs: number;
  readonly maxSimulationMs: number;
  readonly maxRenderMs: number;
  readonly maxInputMs: number;
  readonly maxStreamingMs: number;
  readonly maxMemoryBytes: number;
  readonly maxEntities: number;
  readonly maxResidentAssets: number;
}
