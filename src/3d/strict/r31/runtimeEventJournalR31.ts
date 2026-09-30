import type { RuntimeEventR31 } from './applicationTypesR31.ts';
import { canonicalDigestR31 } from './snapshotR31.ts';

export interface JournalEntryR31 {
  readonly sequence: number;
  readonly tick: number;
  readonly type: string;
  readonly payload: unknown;
  readonly digest: string;
}

export interface JournalQueryR31 {
  readonly fromTick?: number;
  readonly toTick?: number;
  readonly type?: string;
  readonly limit?: number;
}

export interface JournalDiagnosticsR31 {
  readonly entries: number;
  readonly dropped: number;
  readonly firstSequence: number | null;
  readonly lastSequence: number | null;
  readonly digest: string;
}

export class RuntimeEventJournalR31 {
  readonly #capacity: number;
  readonly #entries: JournalEntryR31[] = [];
  #dropped = 0;

  constructor(capacity = 4096) {
    if (!Number.isInteger(capacity) || capacity < 64) throw new Error('Journal capacity must be >= 64');
    this.#capacity = capacity;
  }

  append<T>(event: RuntimeEventR31<T>): JournalEntryR31 {
    const entry = Object.freeze({
      sequence: event.sequence,
      tick: event.tick,
      type: event.type,
      payload: event.payload,
      digest: canonicalDigestR31(event.payload),
    });
    this.#entries.push(entry);
    if (this.#entries.length > this.#capacity) {
      this.#entries.splice(0, this.#entries.length - this.#capacity);
      this.#dropped++;
    }
    return entry;
  }

  appendRaw(tick: number, type: string, payload: unknown): JournalEntryR31 {
    const sequence = (this.#entries[this.#entries.length - 1]?.sequence ?? 0) + 1;
    return this.append({ type, payload, tick: Math.max(0, Math.floor(tick)), sequence });
  }

  query(query: JournalQueryR31 = {}): readonly JournalEntryR31[] {
    const fromTick = query.fromTick ?? 0;
    const toTick = query.toTick ?? Infinity;
    const type = query.type?.trim();
    const limit = Math.max(0, Math.floor(query.limit ?? this.#capacity));
    const result = this.#entries
      .filter((entry) => entry.tick >= fromTick && entry.tick <= toTick && (!type || entry.type === type))
      .slice(-limit);
    return Object.freeze(result);
  }

  replay(fromTick: number, callback: (entry: JournalEntryR31) => void): number {
    let count = 0;
    for (const entry of this.query({ fromTick })) {
      callback(entry);
      count++;
    }
    return count;
  }

  diagnostics(): JournalDiagnosticsR31 {
    return Object.freeze({
      entries: this.#entries.length,
      dropped: this.#dropped,
      firstSequence: this.#entries[0]?.sequence ?? null,
      lastSequence: this.#entries[this.#entries.length - 1]?.sequence ?? null,
      digest: canonicalDigestR31(this.#entries.map((entry) => ({
        sequence: entry.sequence,
        tick: entry.tick,
        type: entry.type,
        digest: entry.digest,
      }))),
    });
  }

  clear(): void {
    this.#entries.length = 0;
    this.#dropped = 0;
  }
}
