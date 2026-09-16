export type Brand<T, B extends string> = T & { readonly __brand: B };

export type NodeId = Brand<string, 'NodeId'>;
export type AssetId = Brand<string, 'AssetId'>;
export type WorldId = Brand<string, 'WorldId'>;
export type Tick = Brand<number, 'Tick'>;

export type Backend = 'webgpu' | 'webgl2';
export type QualityTier = 'ultra' | 'high' | 'medium' | 'low' | 'safe';
export type RuntimeMode = 'interactive' | 'headless' | 'replay';

export interface Vec2 { readonly x: number; readonly y: number; }
export interface Vec3 { readonly x: number; readonly y: number; readonly z: number; }
export interface Quaternion { readonly x: number; readonly y: number; readonly z: number; readonly w: number; }
export interface Transform {
  readonly position: Vec3;
  readonly rotation: Quaternion;
  readonly scale: Vec3;
}

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
  readonly radius: number;
}

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

export type NumericRange = readonly [min: number, max: number];
export type EnumOf<T extends readonly string[]> = T[number];

export const QUALITY_TIERS = ['ultra', 'high', 'medium', 'low', 'safe'] as const;
export const BACKENDS = ['webgpu', 'webgl2'] as const;
export const RUNTIME_MODES = ['interactive', 'headless', 'replay'] as const;

export function clamp(value: number, range: NumericRange): number {
  if (!Number.isFinite(value)) return range[0];
  return Math.min(range[1], Math.max(range[0], value));
}

export function normalizeQuality(value: unknown): QualityTier {
  return typeof value === 'string' && (QUALITY_TIERS as readonly string[]).includes(value)
    ? value as QualityTier
    : 'safe';
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
