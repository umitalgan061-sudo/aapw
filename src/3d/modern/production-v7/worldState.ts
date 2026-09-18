import { ContentHashV7, EntityIdV7, EntityRecordV7, RuntimeModeV7, TickV7, WorldSnapshotV7, hashV7, revisionV7, tickV7 } from './types.ts';
import { checksumV7 } from './deterministic.ts';
import { EntityStoreV7 } from './entityStore.ts';
import { RuntimeCodecV7 } from './codec.ts';

export interface WorldStateV7 {
  readonly version: 7;
  readonly tick: TickV7;
  readonly revision: number;
  readonly mode: RuntimeModeV7;
  readonly entities: readonly EntityRecordV7[];
}

export interface WorldStateDigestV7 {
  readonly checksum: ContentHashV7;
  readonly entities: number;
  readonly bytes: number;
  readonly tick: TickV7;
  readonly revision: number;
}

export interface WorldStateApplyReportV7 {
  readonly applied: number;
  readonly removed: number;
  readonly skipped: number;
  readonly checksum: ContentHashV7;
}

export class WorldStateRuntimeV7 {
  readonly #entities: EntityStoreV7;
  readonly #codec: RuntimeCodecV7;
  #mode: RuntimeModeV7 = 'full';
  #tick: TickV7 = tickV7(0);
  #revision = 0;

  constructor(entities: EntityStoreV7, codec = new RuntimeCodecV7()) {
    this.#entities = entities;
    this.#codec = codec;
  }

  get tick(): TickV7 { return this.#tick; }
  get revision(): number { return this.#revision; }
  get mode(): RuntimeModeV7 { return this.#mode; }

  setMode(mode: RuntimeModeV7): void { this.#mode = mode; }
  setClock(tick: TickV7, revision: number): void { this.#tick = tick; this.#revision = Math.max(0, Math.trunc(revision)); }

  snapshot(): WorldSnapshotV7 {
    const entities = this.#entities.snapshot();
    const base = Object.freeze({
      tick: this.#tick,
      revision: revisionV7(this.#revision),
      baseline: null,
      entities,
      deltas: Object.freeze([]),
    });
    return Object.freeze({ ...base, checksum: checksumV7(base) });
  }

  digest(): WorldStateDigestV7 {
    const snapshot = this.snapshot();
    const encoded = this.#codec.encodeSnapshot(snapshot);
    return Object.freeze({ checksum: snapshot.checksum, entities: snapshot.entities.length, bytes: encoded.bytes, tick: snapshot.tick, revision: Number(snapshot.revision) });
  }

  applySnapshot(snapshot: WorldSnapshotV7): WorldStateApplyReportV7 {
    if (checksumV7({
      tick: snapshot.tick,
      revision: snapshot.revision,
      baseline: snapshot.baseline,
      entities: snapshot.entities,
      deltas: snapshot.deltas,
    }) !== snapshot.checksum) throw new Error('world snapshot checksum mismatch');
    let applied = 0; let skipped = 0;
    const incoming = new Map<number, EntityRecordV7>();
    for (const entity of snapshot.entities) {
      if (!incoming.has(Number(entity.id))) incoming.set(Number(entity.id), entity);
      else skipped += 1;
    }
    const current = new Map(this.#entities.list().map((entity) => [Number(entity.id), entity] as const));
    for (const [id, entity] of incoming) {
      this.#entities.upsert(entity);
      current.delete(id);
      applied += 1;
    }
    let removed = 0;
    for (const entity of current.values()) {
      if (this.#entities.remove(entity.id)) removed += 1;
    }
    this.#tick = tickV7(Number(snapshot.tick));
    this.#revision = Number(snapshot.revision);
    return Object.freeze({ applied, removed, skipped, checksum: checksumV7({ applied, removed, skipped, tick: this.#tick, revision: this.#revision }) });
  }

  delta(before: WorldSnapshotV7, after = this.snapshot()): readonly { readonly id: EntityIdV7; readonly changed: Partial<EntityRecordV7> }[] {
    const beforeMap = new Map(before.entities.map((entity) => [Number(entity.id), entity] as const));
    const result: { id: EntityIdV7; changed: Partial<EntityRecordV7> }[] = [];
    for (const entity of after.entities) {
      const prior = beforeMap.get(Number(entity.id));
      if (!prior) result.push({ id: entity.id, changed: entity });
      else if (checksumV7(prior) !== checksumV7(entity)) result.push({ id: entity.id, changed: { components: entity.components, archetype: entity.archetype } });
    }
    return Object.freeze(result);
  }

  cloneState(): WorldStateV7 {
    return Object.freeze({ version: 7, tick: this.#tick, revision: this.#revision, mode: this.#mode, entities: this.#entities.snapshot() });
  }

  checksum(): string { return checksumV7(this.cloneState()); }
}
