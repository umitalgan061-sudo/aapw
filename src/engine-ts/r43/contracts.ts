export type EntityId = number;
export type ComponentKey = string;
export type SystemId = string;
export type FrameNumber = number;
export type SimulationTick = number;
export type Milliseconds = number;

export type SystemPhase =
  | 'input'
  | 'simulation'
  | 'gameplay'
  | 'navigation'
  | 'streaming'
  | 'network'
  | 'animation'
  | 'render-prep'
  | 'render'
  | 'post-frame';

export type WorkPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';
export type QualityTier = 'ultra' | 'high' | 'medium' | 'low' | 'safe';

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Aabb {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface RuntimeFrame {
  readonly frame: FrameNumber;
  readonly tick: SimulationTick;
  readonly simTimeSeconds: number;
  readonly deltaSeconds: number;
  readonly interpolationAlpha: number;
  readonly droppedSteps: number;
  readonly cpuBudgetMs: number;
}

export interface FrameBudget {
  readonly targetFrameMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly streamingMs: number;
  readonly networkMs: number;
  readonly scriptingMs: number;
}

export interface RuntimeLimits {
  readonly maxEntities: number;
  readonly maxCommandsPerFrame: number;
  readonly maxEventsPerFrame: number;
  readonly maxSnapshots: number;
  readonly maxAssetBytes: number;
  readonly maxNetworkPayloadBytes: number;
  readonly maxSaveBytes: number;
}

export interface RuntimeHealth {
  readonly score: number;
  readonly grade: 'A' | 'B' | 'C' | 'D' | 'F';
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly memoryPressure: number;
  readonly networkPressure: number;
  readonly assetPressure: number;
  readonly recommendations: readonly string[];
}

export interface Result<T, E = RuntimeError> {
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: E;
}

export interface RuntimeError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: unknown;
}

export interface SystemContext {
  readonly frame: RuntimeFrame;
  readonly budget: FrameBudget;
  readonly phase: SystemPhase;
  readonly commands: readonly RuntimeCommand[];
  readonly emit: (event: RuntimeEvent) => void;
}

export interface SystemDefinition {
  readonly id: SystemId;
  readonly phase: SystemPhase;
  readonly priority: WorkPriority;
  readonly dependencies?: readonly SystemId[];
  readonly budgetMs?: number;
  readonly enabled?: () => boolean;
  readonly update: (context: SystemContext) => void;
}

export interface SystemReport {
  readonly id: SystemId;
  readonly phase: SystemPhase;
  readonly elapsedMs: number;
  readonly budgetMs: number;
  readonly overBudget: boolean;
  readonly skipped: boolean;
  readonly reason?: string;
}

export type RuntimeCommand =
  | {
      readonly type: 'spawn';
      readonly entity: EntityId;
    }
  | {
      readonly type: 'despawn';
      readonly entity: EntityId;
    }
  | {
      readonly type: 'set-quality';
      readonly tier: QualityTier;
    }
  | {
      readonly type: 'pause';
      readonly reason: string;
    }
  | {
      readonly type: 'resume';
    }
  | {
      readonly type: 'custom';
      readonly name: string;
      readonly payload: unknown;
    };

export interface RuntimeEvent {
  readonly type: string;
  readonly frame: number;
  readonly tick: number;
  readonly payload?: unknown;
}

export interface SnapshotEntity {
  readonly id: EntityId;
  readonly components: Readonly<Record<ComponentKey, unknown>>;
}

export interface RuntimeSnapshot {
  readonly version: number;
  readonly frame: number;
  readonly tick: number;
  readonly simTimeSeconds: number;
  readonly entities: readonly SnapshotEntity[];
  readonly digest: string;
}

export interface AssetDescriptor {
  readonly key: string;
  readonly url: string;
  readonly bytes: number;
  readonly hash?: string;
  readonly priority: WorkPriority;
  readonly tags?: readonly string[];
}

export interface SaveEnvelope<T> {
  readonly schema: string;
  readonly version: number;
  readonly createdAtTick: number;
  readonly checksum: string;
  readonly payload: T;
}

export interface QualityDecision {
  readonly tier: QualityTier;
  readonly renderScale: number;
  readonly particleScale: number;
  readonly shadowScale: number;
  readonly reason: string;
}

export interface NetworkEnvelope<T> {
  readonly sessionId: string;
  readonly sequence: number;
  readonly acknowledgedSequence: number;
  readonly tick: number;
  readonly sentAtMs: number;
  readonly payload: T;
}

export interface InputIntent {
  readonly moveX: number;
  readonly moveY: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly actions: ReadonlySet<string>;
  readonly pressed: ReadonlySet<string>;
  readonly released: ReadonlySet<string>;
}

export interface RawInputSnapshot {
  readonly axes?: Readonly<Record<string, number>>;
  readonly buttons?: Readonly<Record<string, boolean>>;
  readonly pointer?: Readonly<{ x: number; y: number; buttons: number }>;
  readonly wheel?: number;
}

export interface R43Config {
  readonly fixedStepHz: number;
  readonly maxSubSteps: number;
  readonly maxFrameDeltaSeconds: number;
  readonly frameBudget: FrameBudget;
  readonly limits: RuntimeLimits;
  readonly initialQuality: QualityTier;
  readonly networkSnapshotHz: number;
  readonly saveSchema: string;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeVec2(x: number, y: number): Vec2 {
  const safeX = finiteOr(x, 0);
  const safeY = finiteOr(y, 0);
  const length = Math.hypot(safeX, safeY);
  if (length <= Number.EPSILON) return { x: 0, y: 0 };
  const scale = Math.min(1, 1 / length);
  return { x: safeX * scale, y: safeY * scale };
}

export function normalizeVec3(x: number, y: number, z: number): Vec3 {
  const safeX = finiteOr(x, 0);
  const safeY = finiteOr(y, 0);
  const safeZ = finiteOr(z, 0);
  const length = Math.hypot(safeX, safeY, safeZ);
  if (length <= Number.EPSILON) return { x: 0, y: 0, z: 0 };
  const scale = Math.min(1, 1 / length);
  return { x: safeX * scale, y: safeY * scale, z: safeZ * scale };
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableStringify(object[key])).join(',') + '}';
}

export function stableDigest(value: unknown): string {
  const source = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function success<T>(value: T): Result<T> {
  return Object.freeze({ ok: true, value });
}

export function failure<T = never>(error: RuntimeError): Result<T> {
  return Object.freeze({ ok: false, error });
}
