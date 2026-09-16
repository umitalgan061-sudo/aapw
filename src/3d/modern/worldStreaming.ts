import type { AssetDescriptor, AssetId, TimestampMs } from './types';
import { asTimestampMs } from './types';
import { AssetRegistry } from './assetRegistry';

export interface StreamManifestEntry extends AssetDescriptor {
  readonly preloadDistance?: number;
  readonly unloadDistance?: number;
  readonly critical?: boolean;
}

export interface StreamObserver {
  readonly position: { x: number; y: number; z: number };
  readonly velocity?: { x: number; y: number; z: number };
}

export interface StreamingDecision {
  readonly load: readonly AssetId[];
  readonly unload: readonly AssetId[];
  readonly retain: readonly AssetId[];
  readonly timestamp: TimestampMs;
}

interface ResidentMeta {
  readonly descriptor: StreamManifestEntry;
  lastDecision: TimestampMs;
  handle?: { dispose(): void };
}

/** Distance-aware world streaming coordinator built on top of AssetRegistry. */
export class WorldStreamingCoordinator {
  private readonly registry: AssetRegistry;
  private readonly entries = new Map<AssetId, StreamManifestEntry>();
  private readonly resident = new Map<AssetId, ResidentMeta>();
  private readonly now: () => TimestampMs;
  private disposed = false;

  public constructor(registry: AssetRegistry, now: () => TimestampMs = () => asTimestampMs(performance.now())) {
    this.registry = registry;
    this.now = now;
  }

  public register(entries: readonly StreamManifestEntry[]): void {
    this.ensureActive();
    for (const entry of entries) {
      if (this.entries.has(entry.id)) throw new Error(`STREAM_ENTRY_REDEFINED:${entry.id}`);
      this.entries.set(entry.id, { ...entry });
    }
  }

  public async update(observer: StreamObserver): Promise<StreamingDecision> {
    this.ensureActive();
    const load: AssetId[] = [];
    const unload: AssetId[] = [];
    const retain: AssetId[] = [];
    const now = this.now();
    for (const entry of this.entries.values()) {
      const distance = distanceTo(observer.position, entry as unknown as { x: number; y: number; z: number });
      const preload = entry.preloadDistance ?? 160;
      const unloadDistance = Math.max(preload, entry.unloadDistance ?? preload * 1.35);
      const isResident = this.resident.has(entry.id);
      if (!isResident && (entry.critical || distance <= preload)) {
        const handle = await this.registry.acquire(entry);
        this.resident.set(entry.id, { descriptor: entry, lastDecision: now, handle });
        load.push(entry.id);
      } else if (isResident && distance <= unloadDistance) {
        retain.push(entry.id);
        const meta = this.resident.get(entry.id);
        if (meta) meta.lastDecision = now;
      } else if (isResident && distance > unloadDistance) {
        const meta = this.resident.get(entry.id);
        meta?.handle?.dispose();
        this.resident.delete(entry.id);
        unload.push(entry.id);
      }
    }
    return { load: load.sort(), unload: unload.sort(), retain: retain.sort(), timestamp: now };
  }

  public residentIds(): readonly AssetId[] { return [...this.resident.keys()].sort(); }
  public size(): number { return this.entries.size; }
  public residentSize(): number { return this.resident.size; }
  public clear(): void { for (const meta of this.resident.values()) meta.handle?.dispose(); this.resident.clear(); }
  private ensureActive(): void { if (this.disposed) throw new Error('STREAMING_COORDINATOR_DISPOSED'); }
  public dispose(): void { if (this.disposed) return; this.clear(); this.entries.clear(); this.disposed = true; }
}

export interface ChunkCoordinate { readonly x: number; readonly y: number; readonly z: number; }
export const chunkKey = (coordinate: ChunkCoordinate): string => `${Math.floor(coordinate.x)}:${Math.floor(coordinate.y)}:${Math.floor(coordinate.z)}`;

export const visibleChunks = (center: ChunkCoordinate, radius: number): readonly ChunkCoordinate[] => {
  const r = Math.max(0, Math.floor(radius));
  const chunks: ChunkCoordinate[] = [];
  for (let x = -r; x <= r; x += 1) for (let y = -r; y <= r; y += 1) for (let z = -r; z <= r; z += 1) {
    const distance = Math.sqrt(x * x + y * y + z * z);
    if (distance <= r) chunks.push({ x: center.x + x, y: center.y + y, z: center.z + z });
  }
  return chunks.sort((a, b) => chunkKey(a).localeCompare(chunkKey(b)));
};

const distanceTo = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
