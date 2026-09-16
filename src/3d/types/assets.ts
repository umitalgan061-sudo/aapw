import type { AssetId, Bounds, QualityTier, Vec3 } from './runtimeContract.js';

export type AssetKind = 'mesh' | 'texture' | 'material' | 'animation' | 'audio' | 'shader' | 'environment';
export type Residency = 'cold' | 'queued' | 'loading' | 'resident' | 'stale' | 'evicting';
export type Compression = 'none' | 'ktx2' | 'basis' | 'draco' | 'meshopt' | 'webp' | 'avif';

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

export interface AssetBudget {
  readonly gpuBytes: number;
  readonly cpuBytes: number;
  readonly concurrentLoads: number;
  readonly perFrameUploads: number;
}

export interface AssetEvictionCandidate {
  readonly assetId: AssetId;
  readonly score: number;
  readonly reclaimableGpuBytes: number;
  readonly reclaimableCpuBytes: number;
  readonly reason: 'distance' | 'age' | 'pressure' | 'duplicate' | 'quality-shed';
}

export const compressionPenalty = (compression: Compression): number => {
  switch (compression) {
    case 'ktx2': return 0.20;
    case 'basis': return 0.25;
    case 'draco': return 0.30;
    case 'meshopt': return 0.24;
    case 'webp': return 0.45;
    case 'avif': return 0.40;
    default: return 1;
  }
};

export function residencyScore(record: ResidencyRecord, nowTick: number): number {
  const age = Math.max(0, nowTick - record.lastUsedTick);
  const failurePenalty = record.failure ? 0.5 : 1;
  const priority = Math.max(0, Math.min(1, record.priority));
  const bytes = Math.max(1, record.estimatedGpuBytes + record.estimatedCpuBytes);
  return ((age + 1) * (1 - priority) * bytes * failurePenalty);
}

export function pickEvictions(records: readonly ResidencyRecord[], nowTick: number, bytesNeeded: number): AssetEvictionCandidate[] {
  if (bytesNeeded <= 0) return [];
  return records
    .filter((record) => record.state === 'resident' && !record.descriptor.immutable)
    .map((record) => ({
      assetId: record.descriptor.id,
      score: residencyScore(record, nowTick),
      reclaimableGpuBytes: record.estimatedGpuBytes,
      reclaimableCpuBytes: record.estimatedCpuBytes,
      reason: record.priority < 0.25 ? 'quality-shed' : 'pressure',
    } satisfies AssetEvictionCandidate))
    .sort((a, b) => b.score - a.score || String(a.assetId).localeCompare(String(b.assetId)))
    .reduce<AssetEvictionCandidate[]>((selected, candidate) => {
      if (selected.reduce((sum, item) => sum + item.reclaimableGpuBytes + item.reclaimableCpuBytes, 0) >= bytesNeeded) return selected;
      selected.push(candidate);
      return selected;
    }, []);
}
