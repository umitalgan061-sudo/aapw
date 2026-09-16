/**
 * V3 core contracts.
 *
 * The runtime deliberately uses data-oriented records at boundaries. Each contract is serializable,
 * cheap to clone, and stable enough to cross a Worker, MessagePort or future server process.
 */

export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type EntityId = Brand<string, 'V3EntityId'>;
export type ComponentType = Brand<string, 'V3ComponentType'>;
export type Tick = Brand<number, 'V3Tick'>;
export type Sequence = Brand<number, 'V3Sequence'>;
export type AssetKey = Brand<string, 'V3AssetKey'>;

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface Aabb {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface Sphere {
  readonly center: Vec3;
  readonly radius: number;
}

export interface Transform {
  readonly position: Vec3;
  readonly rotation: Quaternion;
  readonly scale: Vec3;
}

export interface Velocity {
  readonly linear: Vec3;
  readonly angular: Vec3;
}

export type RuntimePhase =
  | 'boot'
  | 'input'
  | 'simulation'
  | 'network'
  | 'streaming'
  | 'animation'
  | 'render'
  | 'persistence'
  | 'teardown';

export type RuntimeMode = 'local' | 'client' | 'server' | 'replay' | 'headless';
export type ExecutionLane = 'main' | 'worker' | 'server';
export type TaskPriority = 0 | 1 | 2 | 3 | 4 | 5;
export type QualityTier = 'potato' | 'low' | 'medium' | 'high' | 'ultra';
export type RenderBackend = 'webgpu' | 'webgl2' | 'headless';

export interface RuntimeBudget {
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly streamingMs: number;
  readonly networkMs: number;
  readonly persistenceMs: number;
  readonly maxTasks: number;
  readonly maxEntityUpdates: number;
}

export interface RuntimeClockState {
  readonly tick: Tick;
  readonly simulationSeconds: number;
  readonly wallSeconds: number;
  readonly deltaSeconds: number;
  readonly fixedDeltaSeconds: number;
}

export interface InputFrame {
  readonly sequence: Sequence;
  readonly tick: Tick;
  readonly moveX: number;
  readonly moveZ: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly buttons: number;
  readonly analog: Readonly<Record<string, number>>;
}

export interface SimulationContext {
  readonly clock: RuntimeClockState;
  readonly input: readonly InputFrame[];
  readonly budget: RuntimeBudget;
  readonly mode: RuntimeMode;
}

export interface SystemContext extends SimulationContext {
  readonly phase: RuntimePhase;
  readonly lane: ExecutionLane;
}

export interface SystemMetrics {
  readonly id: string;
  readonly updates: number;
  readonly skipped: number;
  readonly lastDurationMs: number;
  readonly totalDurationMs: number;
  readonly avgDurationMs: number;
}

export interface RuntimeEventMap {
  'runtime:phase': { readonly phase: RuntimePhase };
  'runtime:tick': RuntimeClockState;
  'runtime:error': RuntimeError;
  'entity:created': { readonly id: EntityId };
  'entity:destroyed': { readonly id: EntityId };
  'network:snapshot': { readonly tick: Tick; readonly sequence: Sequence };
  'network:rollback': { readonly from: Tick; readonly to: Tick };
  'render:quality': { readonly from: QualityTier; readonly to: QualityTier; readonly reason: string };
  'asset:state': { readonly key: AssetKey; readonly state: AssetState };
  'save:committed': { readonly slot: number; readonly revision: number };
}

export interface RuntimeError {
  readonly code: string;
  readonly message: string;
  readonly phase: RuntimePhase;
  readonly fatal: boolean;
  readonly cause?: unknown;
}

export type AssetState = 'unknown' | 'queued' | 'loading' | 'ready' | 'failed' | 'evicted';

export interface AssetManifestEntry {
  readonly key: AssetKey;
  readonly url: string;
  readonly kind: 'mesh' | 'texture' | 'material' | 'animation' | 'audio' | 'shader' | 'json';
  readonly bytes?: number;
  readonly sha256?: string;
  readonly tags: readonly string[];
}

export interface AssetRecord<T = unknown> {
  readonly manifest: AssetManifestEntry;
  readonly state: AssetState;
  readonly value?: T;
  readonly error?: string;
  readonly refCount: number;
  readonly lastUsedTick: Tick;
  readonly residentBytes: number;
}

export interface ComponentDefinition<T> {
  readonly type: ComponentType;
  readonly clone: (value: T) => T;
  readonly validate: (value: unknown) => value is T;
  readonly defaultValue: () => T;
  readonly estimatedBytes: number;
}

export interface EntitySnapshot {
  readonly id: EntityId;
  readonly components: Readonly<Record<string, unknown>>;
}

export interface WorldSnapshot {
  readonly tick: Tick;
  readonly revision: number;
  readonly checksum: string;
  readonly entities: readonly EntitySnapshot[];
}

export interface RenderView {
  readonly id: string;
  readonly position: Vec3;
  readonly forward: Vec3;
  readonly up: Vec3;
  readonly fovRadians: number;
  readonly near: number;
  readonly far: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

export interface RenderableState {
  readonly entity: EntityId;
  readonly bounds: Sphere | Aabb;
  readonly transform: Transform;
  readonly materialKey: string;
  readonly meshKey: string;
  readonly layer: number;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
  readonly lodBias?: number;
}

export interface RenderItem {
  readonly entity: EntityId;
  readonly distance: number;
  readonly lod: number;
  readonly pipelineKey: string;
  readonly sortKey: number;
  readonly visible: boolean;
}

export interface RenderPlan {
  readonly frame: number;
  readonly backend: RenderBackend;
  readonly quality: QualityTier;
  readonly passes: readonly RenderPassPlan[];
  readonly visibleCount: number;
  readonly culledCount: number;
  readonly drawCount: number;
}

export interface RenderPassPlan {
  readonly id: string;
  readonly kind: 'shadow' | 'depth' | 'opaque' | 'transparent' | 'post' | 'ui' | 'compute';
  readonly enabled: boolean;
  readonly items: readonly RenderItem[];
  readonly budgetMs: number;
}

export interface NetworkInputCommand {
  readonly sequence: Sequence;
  readonly tick: Tick;
  readonly clientTimeMs: number;
  readonly payload: InputFrame;
}

export interface NetworkEntityState {
  readonly entity: EntityId;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly rotation: Quaternion;
  readonly flags: number;
}

export interface NetworkSnapshot {
  readonly sequence: Sequence;
  readonly tick: Tick;
  readonly serverTimeMs: number;
  readonly acknowledgedInput: Sequence;
  readonly entities: readonly NetworkEntityState[];
  readonly checksum: number;
}

export interface SnapshotDelta {
  readonly sequence: Sequence;
  readonly tick: Tick;
  readonly baseSequence: Sequence;
  readonly added: readonly NetworkEntityState[];
  readonly removed: readonly EntityId[];
  readonly changed: readonly NetworkEntityState[];
}

export interface SaveRecord<T> {
  readonly slot: number;
  readonly revision: number;
  readonly schema: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly playtimeMs: number;
  readonly checksum: string;
  readonly payload: T;
}

export interface SaveMigration<TFrom, TTo> {
  readonly from: number;
  readonly to: number;
  readonly migrate: (value: TFrom) => TTo;
}

export interface MetricSample {
  readonly timestampMs: number;
  readonly tick: Tick;
  readonly name: string;
  readonly value: number;
  readonly unit: 'ms' | 'count' | 'bytes' | 'ratio' | 'hz' | 'score';
  readonly tags: Readonly<Record<string, string>>;
}

export interface TraceSpan {
  readonly id: string;
  readonly parentId?: string;
  readonly name: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly phase: RuntimePhase;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface BudgetSnapshot {
  readonly tick: Tick;
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly streamingMs: number;
  readonly networkMs: number;
  readonly persistenceMs: number;
  readonly budgetMisses: number;
}

export interface RuntimeHealth {
  readonly score: number;
  readonly grade: 'A' | 'B' | 'C' | 'D' | 'E';
  readonly frameTimeP95Ms: number;
  readonly memoryPressure: number;
  readonly networkPressure: number;
  readonly streamingPressure: number;
  readonly recommendations: readonly string[];
}

export interface RuntimeConfig {
  readonly mode: RuntimeMode;
  readonly lane: ExecutionLane;
  readonly fixedDeltaSeconds: number;
  readonly maxCatchUpSteps: number;
  readonly rollbackWindowTicks: number;
  readonly snapshotHistory: number;
  readonly inputHistory: number;
  readonly quality: QualityTier;
  readonly backend: RenderBackend;
  readonly budget: RuntimeBudget;
}

export interface RuntimeDiagnosticReport {
  readonly generatedAtMs: number;
  readonly clock: RuntimeClockState;
  readonly health: RuntimeHealth;
  readonly budgets: BudgetSnapshot;
  readonly systems: readonly SystemMetrics[];
  readonly assets: {
    readonly residentBytes: number;
    readonly ready: number;
    readonly failed: number;
    readonly evicted: number;
  };
  readonly network: {
    readonly rttMs: number;
    readonly lossRatio: number;
    readonly snapshots: number;
    readonly rollbacks: number;
  };
}

export const asEntityId = (value: string): EntityId => value as EntityId;
export const asComponentType = (value: string): ComponentType => value as ComponentType;
export const asTick = (value: number): Tick => value as Tick;
export const asSequence = (value: number): Sequence => value as Sequence;
export const asAssetKey = (value: string): AssetKey => value as AssetKey;

export const ZERO_VEC3: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
export const UNIT_QUATERNION: Quaternion = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
export const UNIT_SCALE: Vec3 = Object.freeze({ x: 1, y: 1, z: 1 });

export function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeUnit(value: number, fallback = 0): number {
  return Number.isFinite(value) && value >= 0 ? Math.min(1, value) : fallback;
}
