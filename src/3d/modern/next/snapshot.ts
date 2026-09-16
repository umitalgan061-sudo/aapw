import { canonicalize } from './save.ts';
import { deterministicChecksum, quantize, type Tick } from './determinism.ts';
import type { EntityId, SnapshotEntity, WorldSnapshot } from './types.ts';

export interface PackedEntity {
  readonly id: EntityId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly flags: number;
}

export interface PackedSnapshot {
  readonly version: 1;
  readonly tick: Tick;
  readonly entities: readonly PackedEntity[];
  readonly checksum: string;
}

export function packSnapshot(snapshot: WorldSnapshot): PackedSnapshot {
  const entities = snapshot.entities.slice().sort((a, b) => a.id - b.id).map((entity) => ({
    id: entity.id,
    x: quantize(entity.x, 0.001),
    y: quantize(entity.y, 0.001),
    z: quantize(entity.z, 0.001),
    yaw: quantize(entity.yaw, 0.0001),
    flags: entity.flags >>> 0,
  }));
  return { version: 1, tick: snapshot.tick, entities, checksum: snapshotChecksum(snapshot.tick, entities) };
}

export function unpackSnapshot(snapshot: PackedSnapshot): WorldSnapshot {
  if (snapshot.version !== 1) throw new Error('unsupported snapshot version');
  const expected = snapshotChecksum(snapshot.tick, snapshot.entities);
  if (expected !== snapshot.checksum) throw new Error('packed snapshot checksum mismatch');
  return { tick: snapshot.tick, entities: snapshot.entities.map((entity) => ({ ...entity })) };
}

export function snapshotChecksum(tick: Tick, entities: readonly SnapshotEntity[]): string {
  return deterministicChecksum([tick, canonicalize(entities.map((entity) => [entity.id, entity.x, entity.y, entity.z, entity.yaw, entity.flags]))]);
}

export function estimatePackedBytes(snapshot: PackedSnapshot): number { return 16 + snapshot.entities.length * 28 + snapshot.checksum.length; }

export function buildEntityIndex(snapshot: WorldSnapshot): Map<EntityId, number> {
  const index = new Map<EntityId, number>();
  snapshot.entities.slice().sort((a, b) => a.id - b.id).forEach((entity, i) => index.set(entity.id, i));
  return index;
}

export function interpolateSnapshots(a: WorldSnapshot, b: WorldSnapshot, alpha: number): WorldSnapshot {
  if (a.tick > b.tick) throw new RangeError('snapshot order invalid');
  const t = Math.max(0, Math.min(1, alpha));
  const mapA = new Map(a.entities.map((entity) => [entity.id, entity]));
  const entities = b.entities.map((entity) => {
    const old = mapA.get(entity.id);
    if (!old) return { ...entity };
    return {
      id: entity.id,
      x: old.x + (entity.x - old.x) * t,
      y: old.y + (entity.y - old.y) * t,
      z: old.z + (entity.z - old.z) * t,
      yaw: old.yaw + (entity.yaw - old.yaw) * t,
      flags: entity.flags,
    };
  }).sort((x, y) => x.id - y.id);
  return { tick: a.tick, entities };
}
