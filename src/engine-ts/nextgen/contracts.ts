export type EntityId = number & { readonly __entityId: unique symbol };
export type Tick = number & { readonly __tick: unique symbol };
export type SimSeconds = number & { readonly __simSeconds: unique symbol };

export const asEntityId = (value: number): EntityId => Math.max(1, Math.floor(value)) as EntityId;
export const asTick = (value: number): Tick => Math.max(0, Math.floor(value)) as Tick;
export const asSimSeconds = (value: number): SimSeconds => Math.max(0, Number.isFinite(value) ? value : 0) as SimSeconds;

export type DeviceTier = 'low' | 'balanced' | 'high' | 'ultra';
export type RuntimeMode = 'booting' | 'running' | 'degraded' | 'paused' | 'recovering' | 'stopping' | 'stopped';
export type RenderPassKind = 'depth' | 'shadow' | 'opaque' | 'transparent' | 'post' | 'ui' | 'debug';
export type TaskLane = 'simulation' | 'gameplay' | 'streaming' | 'render' | 'telemetry' | 'background';
export type AssetKind = 'gltf' | 'texture' | 'audio' | 'data' | 'shader' | 'binary';
export type AssetPriority = 'critical' | 'near' | 'normal' | 'far' | 'background';
export type NetworkMode = 'offline' | 'client' | 'host' | 'server';
export type InputAction =
  | 'move'
  | 'look'
  | 'jump'
  | 'sprint'
  | 'dodge'
  | 'lightAttack'
  | 'heavyAttack'
  | 'block'
  | 'interact'
  | 'inventory'
  | 'map'
  | 'pause';

export interface Vec2 { readonly x: number; readonly y: number }
export interface Vec3 { readonly x: number; readonly y: number; readonly z: number }
export interface Quat { readonly x: number; readonly y: number; readonly z: number; readonly w: number }
export interface Aabb { readonly min: Vec3; readonly max: Vec3 }

export const ZERO_VEC2: Vec2 = Object.freeze({ x: 0, y: 0 });
export const ZERO_VEC3: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
export const IDENTITY_QUAT: Quat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

export interface TransformState {
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly scale: Vec3;
}

export interface VelocityState {
  readonly linear: Vec3;
  readonly angular: Vec3;
}

export interface HealthState {
  readonly current: number;
  readonly maximum: number;
  readonly regenerationPerSecond: number;
  readonly invulnerableUntilTick: Tick;
}

export interface OwnershipState {
  readonly owner: string;
  readonly authority: 'local' | 'remote' | 'server' | 'predicted';
  readonly revision: number;
}

export interface SimulationState {
  readonly tick: Tick;
  readonly elapsed: SimSeconds;
  readonly accumulator: number;
  readonly droppedSteps: number;
  readonly stepBudgetMs: number;
}

export interface RuntimeClockState {
  readonly tick: Tick;
  readonly elapsedSeconds: SimSeconds;
  readonly realDeltaSeconds: number;
  readonly simulationDeltaSeconds: number;
  readonly timeScale: number;
  readonly paused: boolean;
}

export interface RuntimeBudgets {
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly streamingMs: number;
  readonly networkMs: number;
  readonly telemetryMs: number;
  readonly backgroundMs: number;
}

export interface RuntimeConfig {
  readonly deviceTier: DeviceTier;
  readonly mode: RuntimeMode;
  readonly networkMode: NetworkMode;
  readonly fixedStepMs: number;
  readonly maxCatchUpSteps: number;
  readonly budgets: RuntimeBudgets;
  readonly maxEntities: number;
  readonly maxCommandsPerTick: number;
  readonly maxNetworkBytesPerTick: number;
  readonly maxAssetBytes: number;
  readonly maxStreamingJobs: number;
  readonly renderScale: number;
  readonly shadowMapSize: number;
  readonly postProcessQuality: number;
}

export const DEFAULT_BUDGETS: RuntimeBudgets = Object.freeze({
  frameMs: 16.6,
  simulationMs: 5.5,
  renderMs: 7.5,
  streamingMs: 2.0,
  networkMs: 1.0,
  telemetryMs: 0.4,
  backgroundMs: 0.8,
});

export const TIER_CONFIG: Readonly<Record<DeviceTier, Omit<RuntimeConfig, 'deviceTier' | 'mode' | 'networkMode'>>> = Object.freeze({
  low: Object.freeze({
    fixedStepMs: 33.333,
    maxCatchUpSteps: 3,
    budgets: Object.freeze({ ...DEFAULT_BUDGETS, frameMs: 33.3, simulationMs: 7, renderMs: 18, streamingMs: 2, networkMs: 0.8 }),
    maxEntities: 3000,
    maxCommandsPerTick: 128,
    maxNetworkBytesPerTick: 48_000,
    maxAssetBytes: 64 * 1024 * 1024,
    maxStreamingJobs: 2,
    renderScale: 0.7,
    shadowMapSize: 1024,
    postProcessQuality: 0.35,
  }),
  balanced: Object.freeze({
    fixedStepMs: 16.667,
    maxCatchUpSteps: 5,
    budgets: DEFAULT_BUDGETS,
    maxEntities: 10_000,
    maxCommandsPerTick: 256,
    maxNetworkBytesPerTick: 96_000,
    maxAssetBytes: 160 * 1024 * 1024,
    maxStreamingJobs: 4,
    renderScale: 0.9,
    shadowMapSize: 2048,
    postProcessQuality: 0.65,
  }),
  high: Object.freeze({
    fixedStepMs: 16.667,
    maxCatchUpSteps: 6,
    budgets: Object.freeze({ ...DEFAULT_BUDGETS, simulationMs: 6.5, renderMs: 8.5, streamingMs: 2.5, backgroundMs: 1 }),
    maxEntities: 25_000,
    maxCommandsPerTick: 512,
    maxNetworkBytesPerTick: 160_000,
    maxAssetBytes: 384 * 1024 * 1024,
    maxStreamingJobs: 6,
    renderScale: 1,
    shadowMapSize: 4096,
    postProcessQuality: 0.9,
  }),
  ultra: Object.freeze({
    fixedStepMs: 16.667,
    maxCatchUpSteps: 8,
    budgets: Object.freeze({ ...DEFAULT_BUDGETS, simulationMs: 7.5, renderMs: 9.5, streamingMs: 3, networkMs: 1.5, backgroundMs: 1.2 }),
    maxEntities: 50_000,
    maxCommandsPerTick: 1024,
    maxNetworkBytesPerTick: 256_000,
    maxAssetBytes: 768 * 1024 * 1024,
    maxStreamingJobs: 8,
    renderScale: 1.15,
    shadowMapSize: 8192,
    postProcessQuality: 1,
  }),
});

export interface InputFrame {
  readonly tick: Tick;
  readonly sequence: number;
  readonly move: Vec2;
  readonly look: Vec2;
  readonly held: ReadonlySet<InputAction>;
  readonly pressed: ReadonlySet<InputAction>;
  readonly released: ReadonlySet<InputAction>;
}

export interface InputCommand {
  readonly sequence: number;
  readonly tick: Tick;
  readonly action: InputAction;
  readonly value: number;
  readonly x?: number;
  readonly y?: number;
}

export interface ReplayFrame {
  readonly tick: Tick;
  readonly commands: readonly InputCommand[];
  readonly checksum: string;
}

export interface StreamCell {
  readonly key: string;
  readonly x: number;
  readonly z: number;
  readonly distance: number;
  readonly priority: AssetPriority;
}

export interface StreamingJob {
  readonly id: string;
  readonly cell: StreamCell;
  readonly estimatedBytes: number;
  readonly createdAtTick: Tick;
  readonly deadlineTick: Tick;
  readonly status: 'queued' | 'loading' | 'ready' | 'failed' | 'cancelled';
}

export interface AssetDescriptor {
  readonly id: string;
  readonly url: string;
  readonly kind: AssetKind;
  readonly priority: AssetPriority;
  readonly bytes: number;
  readonly sha256?: string;
  readonly version: number;
  readonly dependencies: readonly string[];
}

export interface AssetHandle<T> {
  readonly id: string;
  readonly descriptor: AssetDescriptor;
  readonly value: T;
  readonly retained: boolean;
}

export interface NetworkEntityState {
  readonly entity: EntityId;
  readonly revision: number;
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly velocity: Vec3;
  readonly flags: number;
}

export interface NetworkSnapshot {
  readonly tick: Tick;
  readonly ack: number;
  readonly serverTime: number;
  readonly entities: readonly NetworkEntityState[];
  readonly checksum: string;
}

export interface NetworkDelta {
  readonly baseTick: Tick;
  readonly targetTick: Tick;
  readonly added: readonly NetworkEntityState[];
  readonly removed: readonly EntityId[];
  readonly changed: readonly NetworkEntityState[];
  readonly unchangedCount: number;
  readonly checksum: string;
}

export interface SaveHeader {
  readonly schema: number;
  readonly build: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly tick: Tick;
  readonly checksum: string;
}

export interface SaveDocument<TState> {
  readonly header: SaveHeader;
  readonly state: TState;
}

export interface MigrationStep<TFrom, TTo> {
  readonly from: number;
  readonly to: number;
  readonly migrate: (value: TFrom) => TTo;
}

export interface RenderItem {
  readonly entity: EntityId;
  readonly pass: RenderPassKind;
  readonly materialKey: string;
  readonly distance: number;
  readonly sortKey: number;
  readonly visible: boolean;
  readonly castShadow: boolean;
}

export interface RenderPlan {
  readonly frame: number;
  readonly passes: ReadonlyMap<RenderPassKind, readonly RenderItem[]>;
  readonly culled: number;
  readonly drawCalls: number;
  readonly estimatedGpuMs: number;
}

export interface TelemetrySample {
  readonly tick: Tick;
  readonly lane: TaskLane;
  readonly durationMs: number;
  readonly budgetMs: number;
  readonly overBudget: boolean;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface RuntimeHealth {
  readonly score: number;
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly memoryBytes: number;
  readonly networkBytes: number;
  readonly activeEntities: number;
  readonly queuedStreams: number;
  readonly assetBytes: number;
  readonly overBudgetLanes: readonly TaskLane[];
  readonly warnings: readonly string[];
}

export interface RuntimeEventMap {
  tick: { readonly state: RuntimeClockState };
  mode: { readonly previous: RuntimeMode; readonly next: RuntimeMode };
  warning: { readonly code: string; readonly message: string };
  error: { readonly code: string; readonly message: string; readonly fatal: boolean };
  network: { readonly snapshot: NetworkSnapshot };
  render: { readonly plan: RenderPlan };
  health: { readonly health: RuntimeHealth };
}

export interface EventListener<T> { (event: T): void }

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
export const length2 = (value: Vec2): number => Math.hypot(value.x, value.y);
export const length3 = (value: Vec3): number => Math.hypot(value.x, value.y, value.z);
export const distance3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const normalize2 = (value: Vec2): Vec2 => { const length = length2(value); return length < 1e-8 ? ZERO_VEC2 : { x: value.x / length, y: value.y / length }; };
export const normalize3 = (value: Vec3): Vec3 => { const length = length3(value); return length < 1e-8 ? ZERO_VEC3 : { x: value.x / length, y: value.y / length, z: value.z / length }; };
export const add3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale3 = (a: Vec3, scalar: number): Vec3 => ({ x: a.x * scalar, y: a.y * scalar, z: a.z * scalar });
export const lerp3 = (a: Vec3, b: Vec3, amount: number): Vec3 => { const t = clamp01(amount); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }; };
export const stableNumber = (value: number): number => Number(value.toFixed(6));
export const stableJson = (value: unknown): string => JSON.stringify(value, (_key, item) => typeof item === 'number' ? stableNumber(item) : item);
export const hashString = (value: string): string => { let hash = 2166136261; for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0'); };
export const compareEntity = (a: EntityId, b: EntityId): number => a - b;
