import type { Backend, QualityTier, RuntimeMode, Tick, WorldId } from '../../types/platform.js';

export const V3_SCHEMA = 'aapw.runtime.v3' as const;
export const V3_SCHEMA_VERSION = 1 as const;
export const V3_FIXED_STEP_MS = 1000 / 60;
export const V3_MAX_DELTA_MS = 250;
export const V3_MAX_CATCH_UP_STEPS = 6;

export type V3Host = 'browser' | 'dedicated-worker' | 'shared-worker' | 'headless' | 'replay';
export type V3InputSource = 'keyboard' | 'mouse' | 'touch' | 'gamepad' | 'xr' | 'replay' | 'programmatic';
export type V3MigrationStage = 'observe' | 'bridge' | 'typed' | 'native';
export type V3RecoveryStage = 'healthy' | 'degraded' | 'recovering' | 'fallback' | 'failed';
export type V3RuntimeEventName =
  | 'runtime/created'
  | 'runtime/started'
  | 'runtime/paused'
  | 'runtime/resumed'
  | 'runtime/stopped'
  | 'runtime/tick'
  | 'runtime/error'
  | 'runtime/recovery'
  | 'runtime/quality'
  | 'runtime/legacy-bridge'
  | 'input/action'
  | 'render/frame'
  | 'stream/region'
  | 'save/request'
  | 'save/complete';

export interface V3Vec3 { readonly x: number; readonly y: number; readonly z: number; }
export interface V3Quat { readonly x: number; readonly y: number; readonly z: number; readonly w: number; }
export interface V3Transform { readonly position: V3Vec3; readonly rotation: V3Quat; readonly scale: V3Vec3; }
export interface V3CameraState { readonly position: V3Vec3; readonly target: V3Vec3; readonly fov: number; readonly near: number; readonly far: number; readonly dpr: number; }
export interface V3Viewport { readonly width: number; readonly height: number; readonly dpr: number; }

export interface V3FrameBudget {
  readonly totalMs: number;
  readonly simulationMs: number;
  readonly inputMs: number;
  readonly streamingMs: number;
  readonly presentationMs: number;
  readonly saveMs: number;
}

export const DEFAULT_V3_BUDGET: V3FrameBudget = Object.freeze({
  totalMs: 16.6667,
  simulationMs: 5,
  inputMs: 1,
  streamingMs: 2,
  presentationMs: 7,
  saveMs: 1,
});

export interface V3RuntimeConfig {
  readonly worldId: WorldId;
  readonly seed: number;
  readonly host: V3Host;
  readonly mode: RuntimeMode;
  readonly backend: Backend;
  readonly quality: QualityTier;
  readonly fixedStepMs: number;
  readonly maxDeltaMs: number;
  readonly maxCatchUpSteps: number;
  readonly budget: V3FrameBudget;
  readonly enableLegacyAdapter: boolean;
  readonly enablePersistence: boolean;
  readonly enableWorkers: boolean;
}

export interface V3Health {
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly presentationMs: number;
  readonly memoryBytes: number;
  readonly memoryBudgetBytes: number;
  readonly droppedFrames: number;
  readonly tickDriftMs: number;
  readonly recoveryStage: V3RecoveryStage;
  readonly legacyCalls: number;
}

export interface V3RuntimeSnapshot {
  readonly schema: typeof V3_SCHEMA;
  readonly schemaVersion: typeof V3_SCHEMA_VERSION;
  readonly frame: number;
  readonly tick: Tick;
  readonly simulationTimeMs: number;
  readonly host: V3Host;
  readonly backend: Backend;
  readonly quality: QualityTier;
  readonly running: boolean;
  readonly paused: boolean;
  readonly recoveryStage: V3RecoveryStage;
  readonly camera: V3CameraState;
  readonly viewport: V3Viewport;
  readonly health: V3Health;
  readonly digest: string;
}

export interface V3Action {
  readonly action: string;
  readonly value: number;
  readonly phase: 'pressed' | 'released' | 'value';
  readonly source: V3InputSource;
  readonly timestamp: number;
  readonly frame: number;
  readonly repeat: boolean;
}

export interface V3RenderPacket {
  readonly frame: number;
  readonly backend: Backend;
  readonly quality: QualityTier;
  readonly viewport: V3Viewport;
  readonly camera: V3CameraState;
  readonly visibleIds: readonly string[];
  readonly shadowIds: readonly string[];
  readonly estimatedGpuMs: number;
  readonly uploadBytes: number;
}

export interface V3StreamIntent {
  readonly regionId: string;
  readonly priority: number;
  readonly desired: 'resident' | 'queued' | 'unload';
  readonly distance: number;
  readonly frame: number;
}

export interface V3SaveIntent {
  readonly slot: string;
  readonly reason: 'manual' | 'autosave' | 'checkpoint' | 'shutdown';
  readonly frame: number;
  readonly snapshot: Readonly<Record<string, unknown>>;
}

export interface V3RuntimeEventMap {
  'runtime/created': { readonly config: V3RuntimeConfig };
  'runtime/started': { readonly at: number };
  'runtime/paused': { readonly reason: string };
  'runtime/resumed': { readonly reason: string };
  'runtime/stopped': { readonly reason: string };
  'runtime/tick': { readonly frame: number; readonly tick: Tick; readonly deltaMs: number };
  'runtime/error': { readonly code: string; readonly message: string; readonly recoverable: boolean };
  'runtime/recovery': { readonly from: V3RecoveryStage; readonly to: V3RecoveryStage; readonly reason: string };
  'runtime/quality': { readonly previous: QualityTier; readonly next: QualityTier; readonly reason: string };
  'runtime/legacy-bridge': { readonly operation: string; readonly durationMs: number; readonly succeeded: boolean };
  'input/action': V3Action;
  'render/frame': V3RenderPacket;
  'stream/region': V3StreamIntent;
  'save/request': V3SaveIntent;
  'save/complete': { readonly slot: string; readonly frame: number; readonly digest: string; readonly bytes: number };
}

export type V3Listener<K extends V3RuntimeEventName> = (payload: V3RuntimeEventMap[K]) => void;

export interface V3ClockSnapshot { readonly nowMs: number; readonly tick: Tick; readonly deltaMs: number; readonly accumulatorMs: number; readonly alpha: number; }
export interface V3Clock {
  reset(nowMs: number, tick?: Tick): void;
  advance(nowMs: number, step: (deltaMs: number, tick: Tick) => void): V3ClockSnapshot;
  snapshot(): V3ClockSnapshot;
}

export interface V3LegacyAdapter {
  load(): Promise<boolean>;
  unload(): Promise<void>;
  isLoaded(): boolean;
  invoke(operation: string, action: () => void | Promise<void>): Promise<boolean>;
}

export interface V3FrameSource {
  now(): number;
  viewport(): V3Viewport;
  camera(): V3CameraState;
}

export interface V3RuntimeDependencies {
  readonly clock?: V3Clock;
  readonly now?: () => number;
  readonly frameSource?: V3FrameSource;
  readonly legacy?: V3LegacyAdapter;
}

export interface V3RuntimeController {
  start(): Promise<boolean>;
  pause(reason?: string): void;
  resume(reason?: string): void;
  stop(reason?: string): Promise<void>;
  tick(nowMs?: number): V3RuntimeSnapshot;
  dispatch(action: V3Action): boolean;
  snapshot(): V3RuntimeSnapshot;
  renderPacket(): V3RenderPacket;
  health(): V3Health;
  dispose(): Promise<void>;
}

export const finiteNumber = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
export const integer = (value: unknown, fallback = 0): number => Math.trunc(finiteNumber(value, fallback));
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
export const makeTick = (value: number): Tick => Math.max(0, Math.trunc(value)) as Tick;
export const cloneVec3 = (value: V3Vec3): V3Vec3 => Object.freeze({ x: finiteNumber(value.x), y: finiteNumber(value.y), z: finiteNumber(value.z) });
export const cloneCamera = (value: V3CameraState): V3CameraState => Object.freeze({ position: cloneVec3(value.position), target: cloneVec3(value.target), fov: clamp(value.fov, 1, 179), near: Math.max(0.001, value.near), far: Math.max(value.near + 1, value.far), dpr: clamp(value.dpr, 0.5, 4) });
export const cloneViewport = (value: V3Viewport): V3Viewport => Object.freeze({ width: Math.max(1, integer(value.width, 1)), height: Math.max(1, integer(value.height, 1)), dpr: clamp(value.dpr, 0.5, 4) });

export const V3_ACTIONS = Object.freeze([
  'move.forward', 'move.backward', 'move.left', 'move.right', 'move.sprint', 'move.jump',
  'camera.orbit.left', 'camera.orbit.right', 'camera.zoom.in', 'camera.zoom.out',
  'interaction.primary', 'interaction.secondary', 'ui.pause', 'ui.inventory', 'ui.map', 'ui.settings',
] as const);

export type V3ActionName = typeof V3_ACTIONS[number];

export function isKnownV3Action(value: string): value is V3ActionName {
  return (V3_ACTIONS as readonly string[]).includes(value);
}

export function normalizeV3Action(input: Partial<V3Action> & Pick<V3Action, 'action'>, now: number, frame: number): V3Action {
  const action = input.action.trim().slice(0, 128);
  if (!action) throw new TypeError('V3 action must not be empty');
  const phase = input.phase === 'pressed' || input.phase === 'released' ? input.phase : 'value';
  const source: V3InputSource = ['keyboard','mouse','touch','gamepad','xr','replay','programmatic'].includes(input.source ?? '') ? input.source as V3InputSource : 'programmatic';
  return Object.freeze({ action, value: clamp(finiteNumber(input.value), -1, 1), phase, source, timestamp: Math.max(0, finiteNumber(input.timestamp, now)), frame: Math.max(0, integer(input.frame, frame)), repeat: Boolean(input.repeat) });
}
