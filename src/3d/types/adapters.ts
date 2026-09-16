import type { AssetDescriptor, AssetProvider, DeviceCapabilities, FramePlan, RuntimeState, SaveEnvelope, SaveSlot } from './platform.js';
import { asAssetId, asNodeId, asTick, asWorldId, normalizeBackend, normalizeQuality } from './platform.js';

export interface LegacyRuntimeRecord {
  worldId?: unknown;
  tick?: unknown;
  quality?: unknown;
  backend?: unknown;
  mode?: unknown;
  budgets?: Partial<RuntimeState['budgets']>;
  capabilities?: Partial<DeviceCapabilities>;
}

export interface LegacyFrameRecord {
  frameId?: unknown; width?: unknown; height?: unknown; scale?: unknown; passes?: unknown;
  visibleObjectIds?: unknown; shadowObjectIds?: unknown; animatedObjectIds?: unknown;
  estimatedGpuMs?: unknown; cpuUploadMs?: unknown;
}

export interface LegacySaveRecord { slot?: unknown; envelope?: unknown; snapshot?: unknown; }

const finite = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const stringValue = (value: unknown, fallback: string): string => typeof value === 'string' && value.trim() ? value : fallback;
const bool = (value: unknown, fallback = false): boolean => typeof value === 'boolean' ? value : fallback;

export function adaptLegacyRuntime(input: LegacyRuntimeRecord): Pick<RuntimeState, 'worldId' | 'tick' | 'quality' | 'backend' | 'mode' | 'budgets' | 'capabilities'> {
  const budgets: RuntimeState['budgets'] = {
    frameMs: finite(input.budgets?.frameMs, 16.67), simulationMs: finite(input.budgets?.simulationMs, 5),
    renderMs: finite(input.budgets?.renderMs, 10), uploadMs: finite(input.budgets?.uploadMs, 2), streamingMs: finite(input.budgets?.streamingMs, 2),
    maxVisibleObjects: Math.max(1, Math.floor(finite(input.budgets?.maxVisibleObjects, 2200))),
    maxAnimatedObjects: Math.max(1, Math.floor(finite(input.budgets?.maxAnimatedObjects, 420))),
    maxShadowCasters: Math.max(1, Math.floor(finite(input.budgets?.maxShadowCasters, 360))),
  };
  const backend = normalizeBackend(input.backend);
  const capabilities: DeviceCapabilities = {
    backend,
    maxTextureDimension2D: Math.max(1024, Math.floor(finite(input.capabilities?.maxTextureDimension2D, 8192))),
    maxBindGroups: Math.max(1, Math.floor(finite(input.capabilities?.maxBindGroups, 4))),
    maxUniformBufferBindingSize: Math.max(256, Math.floor(finite(input.capabilities?.maxUniformBufferBindingSize, 65536))),
    supportsTimestampQueries: bool(input.capabilities?.supportsTimestampQueries),
    supportsStorageTextures: bool(input.capabilities?.supportsStorageTextures),
    supportsFloat16: bool(input.capabilities?.supportsFloat16),
    supportsMultiview: bool(input.capabilities?.supportsMultiview),
    deviceLost: bool(input.capabilities?.deviceLost),
  };
  return {
    worldId: asWorldId(stringValue(input.worldId, 'unknown-world')),
    tick: asTick(Math.max(0, Math.floor(finite(input.tick, 0)))), quality: normalizeQuality(input.quality), backend,
    mode: input.mode === 'headless' || input.mode === 'replay' ? input.mode : 'interactive', budgets, capabilities,
  };
}

export function adaptLegacyFrame(input: LegacyFrameRecord): FramePlan {
  const asIds = (value: unknown): ReturnType<typeof asNodeId>[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(asNodeId) : [];
  const allowed = new Set<FramePlan['passes'][number]>(['depth','shadow','opaque','transparent','water','foliage','effects','post','ui']);
  const passes = Array.isArray(input.passes) ? input.passes.filter((item): item is FramePlan['passes'][number] => typeof item === 'string' && allowed.has(item as FramePlan['passes'][number])) : ['depth', 'opaque', 'post'] as const;
  return {
    frameId: Math.max(0, Math.floor(finite(input.frameId, 0))),
    resolution: { width: Math.max(1, Math.floor(finite(input.width, 1))), height: Math.max(1, Math.floor(finite(input.height, 1))), scale: Math.max(0.25, Math.min(1, finite(input.scale, 1))) },
    passes, visibleObjectIds: asIds(input.visibleObjectIds), shadowObjectIds: asIds(input.shadowObjectIds), animatedObjectIds: asIds(input.animatedObjectIds),
    estimatedGpuMs: Math.max(0, finite(input.estimatedGpuMs, 0)), cpuUploadMs: Math.max(0, finite(input.cpuUploadMs, 0)),
  };
}

export function adaptLegacySave(input: LegacySaveRecord): { slot: SaveSlot; envelope: SaveEnvelope } {
  const slot: SaveSlot = input.slot === 'manual-1' || input.slot === 'manual-2' || input.slot === 'manual-3' || input.slot === 'checkpoint' ? input.slot : 'autosave';
  if (!input.envelope || typeof input.envelope !== 'object') throw new TypeError('Legacy save envelope is invalid');
  const value = input.envelope as Record<string, unknown>;
  if (!value.header || typeof value.header !== 'object') throw new TypeError('Legacy save header is missing');
  const h = value.header as Record<string, unknown>;
  const version = stringValue(h.version, '1.0.0') as `${number}.${number}.${number}`;
  return {
    slot,
    envelope: {
      header: { format: 'aapw-save', version, schemaHash: stringValue(h.schemaHash, 'legacy-adapter'), createdAt: finite(h.createdAt, Date.now()), updatedAt: finite(h.updatedAt, Date.now()), playTimeSeconds: Math.max(0, finite(h.playTimeSeconds, 0)), worldId: asWorldId(stringValue(h.worldId, 'unknown-world')), tick: asTick(Math.max(0, Math.floor(finite(h.tick, 0)))) },
      compression: value.compression === 'brotli' ? 'brotli' : value.compression === 'gzip' ? 'gzip' : 'none',
      checksum: stringValue(value.checksum, 'legacy'), payload: stringValue(value.payload, JSON.stringify(input.snapshot ?? {})),
    },
  };
}

export interface LegacyAssetRecord { id: unknown; uri?: unknown; kind?: unknown; bytes?: unknown; importance?: unknown; compression?: unknown; }

export function adaptLegacyAsset(input: LegacyAssetRecord): AssetDescriptor {
  const kindValues = new Set<AssetDescriptor['kind']>(['mesh','texture','material','animation','audio','shader','environment']);
  const compressionValues = new Set<AssetDescriptor['compression']>(['ktx2','basis','draco','meshopt','webp','avif']);
  const kind = kindValues.has(input.kind as AssetDescriptor['kind']) ? input.kind as AssetDescriptor['kind'] : 'mesh';
  const compression = compressionValues.has(input.compression as AssetDescriptor['compression']) ? input.compression as AssetDescriptor['compression'] : 'none';
  return { id: asAssetId(stringValue(input.id, 'legacy-asset')), kind, uri: stringValue(input.uri, ''), bytes: Math.max(0, finite(input.bytes, 0)), compressedBytes: Math.max(0, finite(input.bytes, 0)), compression, importance: Math.max(0, Math.min(1, finite(input.importance, 0.5))), tags: [], minQuality: 'safe', immutable: false };
}

export function assertAssetProvider(value: unknown): asserts value is AssetProvider {
  if (!value || typeof value !== 'object') throw new TypeError('Asset provider must be an object');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.load !== 'function' || typeof candidate.release !== 'function' || typeof candidate.has !== 'function') throw new TypeError('Asset provider does not satisfy typed contract');
}
