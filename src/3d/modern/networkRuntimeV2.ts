import { deterministicStateHash } from './types.ts';
import type { PlayerState } from './playerAuthority.ts';
import type { RuntimeIntegrationMetrics } from './runtimeIntegrationV2.ts';

export interface NetworkEntityState {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly health: number;
  readonly revision: number;
}

export interface WorldSnapshotV2 {
  readonly protocol: 2;
  readonly sessionId: string;
  readonly tick: number;
  readonly ack: number;
  readonly createdAt: number;
  readonly entities: readonly NetworkEntityState[];
  readonly player: PlayerState;
  readonly checksum: string;
}

export interface WorldDeltaV2 {
  readonly protocol: 2;
  readonly sessionId: string;
  readonly fromTick: number;
  readonly toTick: number;
  readonly added: readonly NetworkEntityState[];
  readonly changed: readonly NetworkEntityState[];
  readonly removed: readonly string[];
  readonly player?: PlayerState;
  readonly checksum: string;
}

export interface SnapshotBufferOptions {
  readonly capacity?: number;
  readonly maxEntities?: number;
  readonly maxBytes?: number;
}

export interface SnapshotBufferMetrics {
  readonly snapshots: number;
  readonly bytesEstimated: number;
  readonly dropped: number;
  readonly newestTick: number;
  readonly oldestTick: number;
}

const bytesOf = (value: unknown): number => {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.MAX_SAFE_INTEGER; }
};

const sameEntity = (a: NetworkEntityState, b: NetworkEntityState): boolean =>
  a.revision === b.revision && a.x === b.x && a.y === b.y && a.z === b.z && a.yaw === b.yaw && a.health === b.health;

export const encodeSnapshot = (snapshot: Omit<WorldSnapshotV2, 'checksum'>): WorldSnapshotV2 => Object.freeze({
  ...snapshot,
  checksum: deterministicStateHash({ ...snapshot }),
});

export const decodeSnapshot = (input: unknown, options: { readonly maxEntities?: number } = {}): WorldSnapshotV2 => {
  if (!input || typeof input !== 'object') throw new Error('Invalid snapshot.');
  const value = input as WorldSnapshotV2;
  if (value.protocol !== 2 || typeof value.sessionId !== 'string' || !Array.isArray(value.entities) || !value.player) throw new Error('Unsupported snapshot protocol.');
  const maxEntities = Math.max(1, Math.floor(options.maxEntities ?? 50_000));
  if (value.entities.length > maxEntities) throw new Error('Snapshot entity limit exceeded.');
  const { checksum, ...withoutChecksum } = value;
  if (checksum !== deterministicStateHash(withoutChecksum)) throw new Error('Snapshot checksum mismatch.');
  return Object.freeze({ ...value, entities: [...value.entities].slice(0, maxEntities) });
};

export const createDelta = (previous: WorldSnapshotV2, next: WorldSnapshotV2, maxEntities = 50_000): WorldDeltaV2 => {
  if (previous.sessionId !== next.sessionId) throw new Error('Cannot diff different sessions.');
  const previousMap = new Map(previous.entities.map((entity) => [entity.id, entity]));
  const nextMap = new Map(next.entities.slice(0, maxEntities).map((entity) => [entity.id, entity]));
  const added: NetworkEntityState[] = [];
  const changed: NetworkEntityState[] = [];
  const removed: string[] = [];
  for (const entity of nextMap.values()) {
    const prior = previousMap.get(entity.id);
    if (!prior) added.push(entity);
    else if (!sameEntity(prior, entity)) changed.push(entity);
  }
  for (const entity of previousMap.values()) if (!nextMap.has(entity.id)) removed.push(entity.id);
  added.sort((a, b) => a.id.localeCompare(b.id));
  changed.sort((a, b) => a.id.localeCompare(b.id));
  removed.sort();
  const draft = Object.freeze({ protocol: 2 as const, sessionId: next.sessionId, fromTick: previous.tick, toTick: next.tick, added, changed, removed, player: next.player });
  return Object.freeze({ ...draft, checksum: deterministicStateHash(draft) });
};

export const applyDelta = (base: WorldSnapshotV2, delta: WorldDeltaV2): WorldSnapshotV2 => {
  if (base.protocol !== 2 || delta.protocol !== 2 || base.sessionId !== delta.sessionId) throw new Error('Protocol/session mismatch.');
  if (delta.fromTick !== base.tick || delta.toTick <= base.tick) throw new Error('Delta sequence mismatch.');
  const entities = new Map(base.entities.map((entity) => [entity.id, entity]));
  for (const id of delta.removed) entities.delete(id);
  for (const entity of delta.added) entities.set(entity.id, entity);
  for (const entity of delta.changed) entities.set(entity.id, entity);
  return encodeSnapshot({ protocol: 2, sessionId: base.sessionId, tick: delta.toTick, ack: base.ack, createdAt: base.createdAt, entities: [...entities.values()].sort((a, b) => a.id.localeCompare(b.id)), player: delta.player ?? base.player });
};

export class SnapshotBuffer {
  readonly #capacity: number;
  readonly #maxBytes: number;
  readonly #snapshots: WorldSnapshotV2[] = [];
  #bytes = 0;
  #dropped = 0;

  constructor(options: SnapshotBufferOptions = {}) {
    this.#capacity = Math.max(2, Math.floor(options.capacity ?? 32));
    this.#maxBytes = Math.max(1024, Math.floor(options.maxBytes ?? 16 * 1024 * 1024));
  }

  push(snapshot: WorldSnapshotV2): boolean {
    const decoded = decodeSnapshot(snapshot, { maxEntities: 50_000 });
    const bytes = bytesOf(decoded);
    while ((this.#snapshots.length >= this.#capacity || this.#bytes + bytes > this.#maxBytes) && this.#snapshots.length) {
      const oldest = this.#snapshots.shift();
      if (oldest) this.#bytes = Math.max(0, this.#bytes - bytesOf(oldest));
      this.#dropped += 1;
    }
    if (bytes > this.#maxBytes) { this.#dropped += 1; return false; }
    this.#snapshots.push(decoded);
    this.#bytes += bytes;
    return true;
  }

  latest(): WorldSnapshotV2 | undefined { return this.#snapshots[this.#snapshots.length - 1]; }
  oldest(): WorldSnapshotV2 | undefined { return this.#snapshots[0]; }

  atOrBefore(tick: number): WorldSnapshotV2 | undefined {
    let candidate: WorldSnapshotV2 | undefined;
    for (const snapshot of this.#snapshots) {
      if (snapshot.tick > tick) break;
      candidate = snapshot;
    }
    return candidate;
  }

  range(fromTick: number, toTick: number): readonly WorldSnapshotV2[] { return this.#snapshots.filter((snapshot) => snapshot.tick >= fromTick && snapshot.tick <= toTick); }
  clear(): void { this.#snapshots.length = 0; this.#bytes = 0; }
  metrics(): SnapshotBufferMetrics { return Object.freeze({ snapshots: this.#snapshots.length, bytesEstimated: this.#bytes, dropped: this.#dropped, newestTick: this.latest()?.tick ?? -1, oldestTick: this.oldest()?.tick ?? -1 }); }
}

export interface ClientPredictionState<T> {
  readonly acknowledgedTick: number;
  readonly predictedTick: number;
  readonly state: T;
  readonly inputHistory: readonly { readonly tick: number; readonly input: unknown }[];
}

export class ClientPredictionBuffer<T> {
  readonly #capacity: number;
  readonly #history: Array<{ readonly tick: number; readonly input: unknown }> = [];
  #acknowledgedTick = -1;
  #predictedTick = -1;
  #state: T;

  constructor(initialState: T, capacity = 120) { this.#state = initialState; this.#capacity = Math.max(8, Math.floor(capacity)); }
  acknowledge(tick: number, state: T): void { this.#acknowledgedTick = Math.max(this.#acknowledgedTick, tick); this.#state = state; }
  predict(tick: number, input: unknown): void {
    this.#predictedTick = Math.max(this.#predictedTick, tick);
    this.#history.push(Object.freeze({ tick, input }));
    while (this.#history.length > this.#capacity) this.#history.shift();
  }
  state(): ClientPredictionState<T> { return Object.freeze({ acknowledgedTick: this.#acknowledgedTick, predictedTick: this.#predictedTick, state: this.#state, inputHistory: [...this.#history] }); }
  inputsAfter(tick: number): readonly { readonly tick: number; readonly input: unknown }[] { return this.#history.filter((entry) => entry.tick > tick); }
}

export const playerToNetworkEntity = (player: PlayerState): NetworkEntityState => Object.freeze({ id: player.id, x: player.transform.x, y: player.transform.y, z: player.transform.z, yaw: player.transform.yaw, health: player.stats.health, revision: player.revision });

export const metricsToNetworkHints = (metrics: RuntimeIntegrationMetrics): Readonly<{ tick: number; chunkResidentBytes: number; spatialItems: number; digest: string }> => Object.freeze({ tick: metrics.frame, chunkResidentBytes: metrics.chunkResidentBytes, spatialItems: metrics.spatialItems, digest: metrics.digest });
