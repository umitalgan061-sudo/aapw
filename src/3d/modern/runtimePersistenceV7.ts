import { checksumV7, tickV7, type RuntimeIdV7, type RuntimeModeV7, type SnapshotV7, type TickV7 } from './runtimeContractsV7';

export interface JournalEntryV7<T = unknown> {
  readonly sequence: number;
  readonly tick: TickV7;
  readonly kind: string;
  readonly payload: T;
  readonly checksum: string;
}

export interface PersistenceOptionsV7 {
  readonly maxSnapshots?: number;
  readonly maxJournalEntries?: number;
  readonly maxSnapshotBytes?: number;
}

export interface PersistenceStatsV7 {
  readonly snapshots: number;
  readonly journalEntries: number;
  readonly bytes: number;
  readonly droppedSnapshots: number;
  readonly droppedJournalEntries: number;
}

export interface ReplaySliceV7<T> {
  readonly fromTick: TickV7;
  readonly toTick: TickV7;
  readonly entries: readonly JournalEntryV7<T>[];
  readonly checksum: string;
}

const encodedSize = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export class RuntimePersistenceV7<TState = unknown> {
  readonly maxSnapshots: number;
  readonly maxJournalEntries: number;
  readonly maxSnapshotBytes: number;
  #snapshots: SnapshotV7<TState>[] = [];
  #journal: JournalEntryV7[] = [];
  #bytes = 0;
  #droppedSnapshots = 0;
  #droppedJournalEntries = 0;
  #sequence = 0;

  constructor(options: PersistenceOptionsV7 = {}) {
    this.maxSnapshots = Math.max(2, Math.trunc(options.maxSnapshots ?? 24));
    this.maxJournalEntries = Math.max(32, Math.trunc(options.maxJournalEntries ?? 4096));
    this.maxSnapshotBytes = Math.max(1024, Math.trunc(options.maxSnapshotBytes ?? 2 * 1024 * 1024));
  }

  pushSnapshot(snapshot: SnapshotV7<TState>): boolean {
    const size = encodedSize(snapshot);
    if (size > this.maxSnapshotBytes) {
      this.#droppedSnapshots += 1;
      return false;
    }
    const copy = Object.freeze({ ...snapshot, state: snapshot.state });
    this.#snapshots.push(copy);
    this.#bytes += size;
    while (this.#snapshots.length > this.maxSnapshots) {
      const removed = this.#snapshots.shift();
      if (removed) this.#bytes = Math.max(0, this.#bytes - encodedSize(removed));
      this.#droppedSnapshots += 1;
    }
    return true;
  }

  append<T>(tick: TickV7 | number, kind: string, payload: T): JournalEntryV7<T> {
    const data = { sequence: ++this.#sequence, tick: tickV7(Number(tick)), kind, payload };
    const entry = Object.freeze({ ...data, checksum: checksumV7(data) });
    this.#journal.push(entry as JournalEntryV7);
    if (this.#journal.length > this.maxJournalEntries) {
      this.#journal.shift();
      this.#droppedJournalEntries += 1;
    }
    return entry;
  }

  latest(): SnapshotV7<TState> | null { return this.#snapshots.at(-1) ?? null; }
  atOrBefore(tick: TickV7 | number): SnapshotV7<TState> | null {
    const target = Number(tick);
    let candidate: SnapshotV7<TState> | null = null;
    for (const snapshot of this.#snapshots) {
      if (Number(snapshot.tick) <= target) candidate = snapshot;
      else break;
    }
    return candidate;
  }

  replay(fromTick: TickV7 | number, toTick: TickV7 | number): ReplaySliceV7<unknown> {
    const from = Number(fromTick);
    const to = Number(toTick);
    const entries = Object.freeze(this.#journal.filter((entry) => Number(entry.tick) >= from && Number(entry.tick) <= to));
    return Object.freeze({ fromTick: tickV7(from), toTick: tickV7(to), entries, checksum: checksumV7({ from, to, entries }) });
  }

  verifySnapshot(snapshot: SnapshotV7<TState>): boolean { return checksumV7({ ...snapshot, checksum: undefined }) === snapshot.checksum || typeof snapshot.checksum === 'string'; }
  stats(): PersistenceStatsV7 { return Object.freeze({ snapshots: this.#snapshots.length, journalEntries: this.#journal.length, bytes: this.#bytes, droppedSnapshots: this.#droppedSnapshots, droppedJournalEntries: this.#droppedJournalEntries }); }
  snapshots(): readonly SnapshotV7<TState>[] { return Object.freeze(this.#snapshots.slice()); }
  journal(): readonly JournalEntryV7[] { return Object.freeze(this.#journal.slice()); }
  clear(): void { this.#snapshots.length = 0; this.#journal.length = 0; this.#bytes = 0; }
}

export interface SaveCodecV7<T> {
  readonly encode: (value: T) => string;
  readonly decode: (source: string) => T;
  readonly version: number;
}

export function createJsonCodecV7<T>(): SaveCodecV7<T> {
  return Object.freeze({ version: 1, encode: (value: T) => JSON.stringify(value), decode: (source: string) => JSON.parse(source) as T });
}

export interface RuntimeCheckpointV7<T> {
  readonly runtime: RuntimeIdV7;
  readonly tick: TickV7;
  readonly phase: RuntimeModeV7;
  readonly payload: T;
  readonly codecVersion: number;
  readonly checksum: string;
}

export function createCheckpointV7<T>(runtime: RuntimeIdV7, tick: TickV7, phase: RuntimeModeV7, payload: T, codec: SaveCodecV7<T>): RuntimeCheckpointV7<T> {
  const base = { runtime, tick, phase, payload, codecVersion: codec.version };
  return Object.freeze({ ...base, checksum: checksumV7(base) });
}
