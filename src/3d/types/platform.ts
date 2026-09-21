export type Backend = 'webgpu' | 'webgl2';
export type QualityTier = 'ultra' | 'high' | 'medium' | 'low' | 'safe';
export type RuntimeMode = 'interactive' | 'headless' | 'replay';
export type AssetKind = 'mesh' | 'texture' | 'material' | 'animation' | 'audio' | 'shader' | 'environment';
export type Residency = 'cold' | 'queued' | 'loading' | 'resident' | 'stale' | 'evicting';
export type Compression = 'none' | 'ktx2' | 'basis' | 'draco' | 'meshopt' | 'webp' | 'avif';
export type SaveSlot = 'autosave' | 'manual-1' | 'manual-2' | 'manual-3' | 'checkpoint';
export type RenderPassName = 'depth' | 'shadow' | 'opaque' | 'transparent' | 'water' | 'foliage' | 'effects' | 'post' | 'ui';
export type RiskClass = 'low' | 'medium' | 'high' | 'critical';
export type MigrationStage = 'observe' | 'typecheck' | 'bridge' | 'native';

export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type NodeId = Brand<string, 'NodeId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type WorldId = Brand<string, 'WorldId'>;
export type Tick = Brand<number, 'Tick'>;
export type SnapshotVersion = `${number}.${number}.${number}`;

export interface Vec2 { readonly x: number; readonly y: number; }
export interface Vec3 { readonly x: number; readonly y: number; readonly z: number; }
export interface Quaternion { readonly x: number; readonly y: number; readonly z: number; readonly w: number; }
export interface Transform { readonly position: Vec3; readonly rotation: Quaternion; readonly scale: Vec3; }
export interface Bounds { readonly min: Vec3; readonly max: Vec3; readonly radius: number; }

export interface DeviceCapabilities {
  readonly backend: Backend;
  readonly maxTextureDimension2D: number;
  readonly maxBindGroups: number;
  readonly maxUniformBufferBindingSize: number;
  readonly supportsTimestampQueries: boolean;
  readonly supportsStorageTextures: boolean;
  readonly supportsFloat16: boolean;
  readonly supportsMultiview: boolean;
  readonly deviceLost: boolean;
}

export interface RuntimeBudgets {
  readonly frameMs: number;
  readonly simulationMs: number;
  readonly renderMs: number;
  readonly uploadMs: number;
  readonly streamingMs: number;
  readonly maxVisibleObjects: number;
  readonly maxAnimatedObjects: number;
  readonly maxShadowCasters: number;
}

export interface RuntimeState {
  readonly worldId: WorldId;
  readonly tick: Tick;
  readonly mode: RuntimeMode;
  readonly backend: Backend;
  readonly quality: QualityTier;
  readonly budgets: RuntimeBudgets;
  readonly capabilities: DeviceCapabilities;
}

export interface RuntimeHealth {
  readonly frameTimeMs: number;
  readonly droppedFrames: number;
  readonly memoryBytes: number;
  readonly gpuMemoryBytes: number;
  readonly assetQueueDepth: number;
  readonly simulationQueueDepth: number;
  readonly recoveredDeviceCount: number;
  readonly lastErrorCode?: string;
}

export interface AssetDescriptor {
  readonly id: AssetId;
  readonly kind: AssetKind;
  readonly uri: string;
  readonly bytes: number;
  readonly compressedBytes: number;
  readonly compression: Compression;
  readonly bounds?: Bounds;
  readonly worldPosition?: Vec3;
  readonly importance: number;
  readonly tags: readonly string[];
  readonly minQuality: QualityTier;
  readonly immutable: boolean;
}

export interface AssetBudget {
  readonly gpuBytes: number;
  readonly cpuBytes: number;
  readonly concurrentLoads: number;
  readonly perFrameUploads: number;
}

export interface ResidencyRecord {
  readonly descriptor: AssetDescriptor;
  readonly state: Residency;
  readonly lastUsedTick: number;
  readonly priority: number;
  readonly estimatedGpuBytes: number;
  readonly estimatedCpuBytes: number;
  readonly retryCount: number;
  readonly failure?: string;
}

export interface AssetRequest {
  readonly asset: AssetDescriptor;
  readonly priority: number;
  readonly deadlineTick?: number;
  readonly signal?: AbortSignal;
}

export interface AssetProvider {
  load<T>(request: AssetRequest): Promise<T>;
  release(assetId: AssetId): void;
  has(assetId: AssetId): boolean;
}

export interface RenderResolution { readonly width: number; readonly height: number; readonly scale: number; }
export interface RenderFeatures {
  readonly backend: Backend;
  readonly hdr: boolean;
  readonly mrt: boolean;
  readonly temporalHistory: boolean;
  readonly compute: boolean;
  readonly ssao: boolean;
  readonly ssgi: boolean;
  readonly bloom: boolean;
  readonly depthOfField: boolean;
  readonly volumetricFog: boolean;
  readonly antiAliasing: 'none' | 'fxaa' | 'taa';
  readonly toneMapping: 'none' | 'neutral' | 'aces' | 'agx';
}

export interface RenderObject {
  readonly nodeId: NodeId;
  readonly materialClass: string;
  readonly instanceGroup?: string;
  readonly distance: number;
  readonly screenCoverage: number;
  readonly castsShadow: boolean;
  readonly animated: boolean;
  readonly transparent: boolean;
  readonly visible: boolean;
}

export interface FramePlan {
  readonly frameId: number;
  readonly resolution: RenderResolution;
  readonly passes: readonly RenderPassName[];
  readonly visibleObjectIds: readonly NodeId[];
  readonly shadowObjectIds: readonly NodeId[];
  readonly animatedObjectIds: readonly NodeId[];
  readonly estimatedGpuMs: number;
  readonly cpuUploadMs: number;
}

export interface SaveHeader {
  readonly format: 'aapw-save';
  readonly version: SnapshotVersion;
  readonly schemaHash: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly playTimeSeconds: number;
  readonly worldId: WorldId;
  readonly tick: Tick;
}

export interface PlayerSnapshot {
  readonly id: string;
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  readonly health: number;
  readonly stamina: number;
  readonly inventory: readonly { readonly id: string; readonly quantity: number }[];
  readonly quests: readonly { readonly id: string; readonly state: string; readonly progress: number }[];
}

export interface WorldSnapshot {
  readonly seed: number;
  readonly regionStates: readonly { readonly id: string; readonly state: string; readonly version: number }[];
  readonly discoveredLocations: readonly string[];
  readonly defeatedEncounters: readonly string[];
  readonly worldFlags: Readonly<Record<string, boolean>>;
}

export interface GameplaySnapshot {
  readonly header: SaveHeader;
  readonly player: PlayerSnapshot;
  readonly world: WorldSnapshot;
  readonly rngState: readonly number[];
  readonly customState: Readonly<Record<string, unknown>>;
}

export interface SaveEnvelope {
  readonly header: SaveHeader;
  readonly compression: 'none' | 'gzip' | 'brotli';
  readonly checksum: string;
  readonly payload: string;
}

export interface MigrationStep<From extends SnapshotVersion, To extends SnapshotVersion> {
  readonly from: From;
  readonly to: To;
  readonly migrate: (input: GameplaySnapshot) => GameplaySnapshot;
}

export interface ModuleMigrationRecord {
  readonly path: string;
  readonly language: 'javascript' | 'typescript';
  readonly stage: MigrationStage;
  readonly risk: RiskClass;
  readonly runtimeCritical: boolean;
  readonly hasExternalSideEffects: boolean;
  readonly testCoverage: number;
  readonly dependencyCount: number;
  readonly blockers: readonly string[];
}

export interface MigrationGateResult {
  readonly passed: boolean;
  readonly migratedModules: number;
  readonly bridgeModules: number;
  readonly blockedModules: number;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface RuntimeEventMap {
  readonly 'runtime:start': { readonly worldId: string; readonly backend: Backend };
  readonly 'runtime:stop': { readonly reason: string };
  readonly 'runtime:tick': { readonly tick: number; readonly deltaMs: number };
  readonly 'runtime:quality': { readonly from: QualityTier; readonly to: QualityTier; readonly reason: string };
  readonly 'runtime:memory-pressure': { readonly level: 'normal' | 'warning' | 'critical'; readonly usedBytes: number; readonly budgetBytes: number };
  readonly 'runtime:device-lost': { readonly message: string; readonly recoverable: boolean };
  readonly 'runtime:device-restored': { readonly backend: Backend; readonly downtimeMs: number };
  readonly 'asset:queued': { readonly assetId: string; readonly priority: number };
  readonly 'asset:ready': { readonly assetId: string; readonly bytes: number };
  readonly 'asset:evicted': { readonly assetId: string; readonly reason: string };
  readonly 'save:begin': { readonly slot: SaveSlot; readonly version: SnapshotVersion };
  readonly 'save:complete': { readonly slot: SaveSlot; readonly bytes: number };
  readonly 'save:failed': { readonly slot: SaveSlot; readonly code: string };
  readonly 'world:stream': { readonly regionId: string; readonly state: 'queued' | 'loading' | 'ready' | 'unloading' };
  readonly 'input:action': { readonly action: string; readonly value: number; readonly source: string };
}

export type RuntimeEventName = keyof RuntimeEventMap;
export type RuntimeListener<K extends RuntimeEventName> = (payload: RuntimeEventMap[K]) => void;
export type Unsubscribe = () => void;

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
export interface Failure {
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
  readonly recoverable: boolean;
  readonly timestamp: number;
  readonly context: Readonly<Record<string, string | number | boolean>>;
}

export const BACKENDS = ['webgpu', 'webgl2'] as const;
export const QUALITY_TIERS = ['ultra', 'high', 'medium', 'low', 'safe'] as const;

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export function normalizeQuality(value: unknown): QualityTier {
  return typeof value === 'string' && (QUALITY_TIERS as readonly string[]).includes(value) ? value as QualityTier : 'safe';
}

export function normalizeBackend(value: unknown): Backend {
  return value === 'webgpu' ? 'webgpu' : 'webgl2';
}

export function asNodeId(value: string): NodeId {
  if (!value.trim()) throw new TypeError('NodeId must not be empty');
  return value as NodeId;
}

export function asAssetId(value: string): AssetId {
  if (!value.trim()) throw new TypeError('AssetId must not be empty');
  return value as AssetId;
}

export function asWorldId(value: string): WorldId {
  if (!value.trim()) throw new TypeError('WorldId must not be empty');
  return value as WorldId;
}

export function asTick(value: number): Tick {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Tick must be a non-negative safe integer');
  return value as Tick;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
