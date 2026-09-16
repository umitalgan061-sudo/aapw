/*
 * Westeros AAPW modern runtime — shared type system.
 *
 * The legacy game is intentionally not rewritten in-place in one risky change.
 * New runtime code is TypeScript-first and talks to legacy JavaScript through
 * small structural contracts. That lets the project migrate subsystem-by-subsystem
 * without changing gameplay behavior while gaining compile-time guarantees.
 */

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type EntityId = Brand<string, 'EntityId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type SaveId = Brand<string, 'SaveId'>;
export type FrameId = Brand<number, 'FrameId'>;
export type TimestampMs = Brand<number, 'TimestampMs'>;
export type WorldRevision = Brand<number, 'WorldRevision'>;

export const asEntityId = (value: string): EntityId => value as EntityId;
export const asAssetId = (value: string): AssetId => value as AssetId;
export const asSaveId = (value: string): SaveId => value as SaveId;
export const asFrameId = (value: number): FrameId => value as FrameId;
export const asTimestampMs = (value: number): TimestampMs => value as TimestampMs;
export const asWorldRevision = (value: number): WorldRevision => value as WorldRevision;

export type Result<T, E = RuntimeError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export interface RuntimeError {
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
  readonly cause?: unknown;
  readonly context?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface Disposable {
  dispose(): void;
}

export interface AsyncDisposable {
  dispose(): void | Promise<void>;
}

export interface Clock {
  now(): TimestampMs;
  delta(): number;
}

export interface Vector2Like {
  x: number;
  y: number;
}

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

export interface QuaternionLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Bounds3Like {
  min: Vector3Like;
  max: Vector3Like;
}

export interface TransformState {
  readonly position: Vector3Like;
  readonly rotation: QuaternionLike;
  readonly scale: Vector3Like;
}

export interface EntitySnapshot {
  readonly id: EntityId;
  readonly active: boolean;
  readonly transform: TransformState;
  readonly tags: readonly string[];
  readonly components: Readonly<Record<string, unknown>>;
}

export interface WorldSnapshot {
  readonly schemaVersion: number;
  readonly revision: WorldRevision;
  readonly capturedAt: TimestampMs;
  readonly seed: number;
  readonly entities: readonly EntitySnapshot[];
  readonly globals: Readonly<Record<string, unknown>>;
}

export type RuntimePhase =
  | 'boot'
  | 'loading'
  | 'ready'
  | 'running'
  | 'paused'
  | 'degraded'
  | 'stopping'
  | 'stopped';

export type QualityTier = 'cinematic' | 'ultra' | 'high' | 'medium' | 'low' | 'safe';
export type RendererBackend = 'webgpu' | 'webgl2';
export type PowerPreference = 'high-performance' | 'low-power' | 'default';

export interface DeviceCapabilities {
  readonly webgpu: boolean;
  readonly webgl2: boolean;
  readonly offscreenCanvas: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly crossOriginIsolated: boolean;
  readonly deviceMemoryGb: number | null;
  readonly hardwareConcurrency: number;
  readonly maxTextureSize: number | null;
  readonly maxSamples: number | null;
  readonly powerPreference: PowerPreference;
}

export interface RendererSelection {
  readonly backend: RendererBackend;
  readonly tier: QualityTier;
  readonly reason: string;
  readonly capabilities: DeviceCapabilities;
}

export interface RenderBudget {
  readonly gpuMs: number;
  readonly cpuMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly texturesBytes: number;
  readonly instances: number;
}

export interface FrameMetrics {
  readonly frameId: FrameId;
  readonly timestamp: TimestampMs;
  readonly deltaMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number | null;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly visibleObjects: number;
  readonly activeAnimations: number;
  readonly residentBytes: number;
  readonly droppedTasks: number;
}

export interface AdaptiveQualityState {
  readonly tier: QualityTier;
  readonly resolutionScale: number;
  readonly shadowDistance: number;
  readonly foliageDensity: number;
  readonly effectsLevel: number;
  readonly reason: string;
}

export interface AssetDescriptor {
  readonly id: AssetId;
  readonly uri: string;
  readonly kind: 'texture' | 'model' | 'audio' | 'shader' | 'data' | 'unknown';
  readonly sizeBytes?: number;
  readonly priority?: number;
  readonly tags?: readonly string[];
  readonly dependencies?: readonly AssetId[];
  readonly optional?: boolean;
}

export interface AssetResidency {
  readonly id: AssetId;
  readonly state: 'unloaded' | 'loading' | 'resident' | 'evicting' | 'failed';
  readonly bytes: number;
  readonly refs: number;
  readonly lastUsed: TimestampMs;
  readonly priority: number;
}

export interface AssetRuntime<T = unknown> extends AssetResidency {
  readonly value?: T;
  readonly error?: RuntimeError;
}

export interface AssetLoaderContext {
  readonly signal: AbortSignal;
  readonly reportProgress: (ratio: number) => void;
  readonly resolveDependency: <T>(id: AssetId) => Promise<T>;
}

export type AssetLoader<T> = (
  descriptor: AssetDescriptor,
  context: AssetLoaderContext,
) => Promise<T>;

export interface AssetRegistryOptions {
  readonly byteBudget: number;
  readonly entryBudget: number;
  readonly now?: () => TimestampMs;
}

export interface AssetRegistryStats {
  readonly totalEntries: number;
  readonly residentEntries: number;
  readonly loadingEntries: number;
  readonly failedEntries: number;
  readonly residentBytes: number;
  readonly budgetBytes: number;
  readonly pinnedEntries: number;
}

export type SchedulerPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

export interface ScheduledTask<T = void> {
  readonly id: string;
  readonly priority: SchedulerPriority;
  readonly budgetMs: number;
  readonly run: (context: TaskContext) => T | Promise<T>;
  readonly signal?: AbortSignal;
  readonly label?: string;
}

export interface TaskContext {
  readonly frameId: FrameId;
  readonly elapsedMs: number;
  readonly remainingBudgetMs: number;
  readonly shouldYield: () => boolean;
  readonly yieldToBrowser: () => Promise<void>;
}

export interface SchedulerStats {
  readonly queued: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly deferred: number;
  readonly lastFrameBudgetMs: number;
}

export interface SaveEnvelope<T = unknown> {
  readonly magic: 'AAPW_SAVE';
  readonly schemaVersion: number;
  readonly saveId: SaveId;
  readonly createdAt: TimestampMs;
  readonly updatedAt: TimestampMs;
  readonly checksum: string;
  readonly payload: T;
}

export interface SaveMetadata {
  readonly saveId: SaveId;
  readonly label: string;
  readonly createdAt: TimestampMs;
  readonly updatedAt: TimestampMs;
  readonly bytes: number;
  readonly schemaVersion: number;
}

export interface SaveStoreAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  list(prefix: string): Promise<readonly string[]>;
}

export interface SaveStoreOptions {
  readonly namespace: string;
  readonly schemaVersion: number;
  readonly maxBytes: number;
  readonly now?: () => TimestampMs;
  readonly adapter?: SaveStoreAdapter;
}

export interface InputFrame {
  readonly timestamp: TimestampMs;
  readonly axes: Readonly<Record<string, number>>;
  readonly buttons: Readonly<Record<string, boolean>>;
  readonly pointers: readonly PointerState[];
}

export interface PointerState {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly down: boolean;
}

export interface InputBinding {
  readonly action: string;
  readonly keys?: readonly string[];
  readonly buttons?: readonly number[];
  readonly axis?: string;
  readonly deadZone?: number;
  readonly sensitivity?: number;
}

export interface RuntimeEventMap {
  'phase:change': { from: RuntimePhase; to: RuntimePhase };
  'frame:begin': { frameId: FrameId; timestamp: TimestampMs; deltaMs: number };
  'frame:end': FrameMetrics;
  'quality:change': AdaptiveQualityState;
  'asset:state': AssetRuntime;
  'save:write': SaveMetadata;
  'save:error': RuntimeError;
  'renderer:backend': RendererSelection;
  'runtime:error': RuntimeError;
}

export type EventName = keyof RuntimeEventMap;
export type EventHandler<K extends EventName> = (payload: RuntimeEventMap[K]) => void;

export interface RuntimeOptions {
  readonly seed: number;
  readonly quality?: QualityTier;
  readonly byteBudget?: number;
  readonly schedulerBudgetMs?: number;
  readonly enableWorkers?: boolean;
  readonly enablePersistence?: boolean;
  readonly enableAdaptiveQuality?: boolean;
}

export interface RuntimeSnapshot {
  readonly phase: RuntimePhase;
  readonly frameId: FrameId;
  readonly world: WorldSnapshot;
  readonly renderer: RendererSelection | null;
  readonly quality: AdaptiveQualityState;
  readonly assets: AssetRegistryStats;
  readonly scheduler: SchedulerStats;
}

export interface RuntimeServices {
  readonly events: Disposable;
  readonly assets: Disposable;
  readonly scheduler: Disposable;
  readonly renderer: Disposable;
  readonly persistence: Disposable;
}

export interface WorkerMessage<T = unknown> {
  readonly id: string;
  readonly kind: string;
  readonly payload: T;
  readonly timestamp: TimestampMs;
}

export interface WorkerResponse<T = unknown> {
  readonly id: string;
  readonly ok: boolean;
  readonly payload?: T;
  readonly error?: RuntimeError;
}

export interface WorkerTransport {
  post<T>(message: WorkerMessage<T>, transfer?: Transferable[]): void;
  subscribe(handler: (message: WorkerResponse) => void): Disposable;
}

export interface SystemContext {
  readonly frame: FrameMetrics;
  readonly worldRevision: WorldRevision;
  readonly random: () => number;
  readonly events: { emit<K extends EventName>(name: K, payload: RuntimeEventMap[K]): void };
}

export interface RuntimeSystem extends Disposable {
  readonly name: string;
  readonly priority: number;
  update(context: SystemContext): void | Promise<void>;
}

export interface EntityStore {
  create(initial?: Partial<EntitySnapshot>): EntityId;
  remove(id: EntityId): boolean;
  get(id: EntityId): EntitySnapshot | undefined;
  update(id: EntityId, patch: Partial<EntitySnapshot>): boolean;
  snapshot(): WorldSnapshot;
  restore(snapshot: WorldSnapshot): void;
  clear(): void;
}

export interface ModernRuntime {
  readonly phase: RuntimePhase;
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  tick(timestamp?: number): Promise<FrameMetrics>;
  snapshot(): RuntimeSnapshot;
  dispose(): void;
}

export const DEFAULT_DEVICE_CAPABILITIES: DeviceCapabilities = Object.freeze({
  webgpu: false,
  webgl2: true,
  offscreenCanvas: false,
  sharedArrayBuffer: false,
  crossOriginIsolated: false,
  deviceMemoryGb: null,
  hardwareConcurrency: 4,
  maxTextureSize: 4096,
  maxSamples: 4,
  powerPreference: 'default',
});

export const DEFAULT_BUDGET: RenderBudget = Object.freeze({
  gpuMs: 12,
  cpuMs: 8,
  drawCalls: 1800,
  triangles: 3_000_000,
  texturesBytes: 512 * 1024 * 1024,
  instances: 8_000,
});

export const DEFAULT_ADAPTIVE_QUALITY: AdaptiveQualityState = Object.freeze({
  tier: 'high',
  resolutionScale: 1,
  shadowDistance: 180,
  foliageDensity: 1,
  effectsLevel: 1,
  reason: 'initial',
});
