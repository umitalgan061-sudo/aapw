import type { R35RuntimeEvent } from './contracts';

export interface JournalEntry {
  readonly sequence: number;
  readonly tick: number;
  readonly event: R35RuntimeEvent;
  readonly checksum: string;
}

export interface JournalCursor {
  readonly sequence: number;
  readonly tick: number;
}

export interface JournalReplayResult {
  readonly requestedFromSequence: number;
  readonly applied: number;
  readonly skipped: number;
  readonly missing: boolean;
  readonly finalSequence: number;
}

function checksum(event: R35RuntimeEvent): string {
  const source = JSON.stringify(event);
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export class R35EventJournal {
  readonly capacity: number;
  #entries: JournalEntry[] = [];
  #nextSequence = 1;

  constructor(capacity = 4096) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('journal capacity must be >= 1');
    this.capacity = capacity;
  }

  append(event: R35RuntimeEvent): JournalEntry {
    const sequence = this.#nextSequence++;
    const entry: JournalEntry = Object.freeze({
      sequence,
      tick: event.tick,
      event: structuredClone(event),
      checksum: checksum(event),
    });
    this.#entries.push(entry);
    if (this.#entries.length > this.capacity) this.#entries.shift();
    return this.cloneEntry(entry);
  }

  appendUnique(event: R35RuntimeEvent): JournalEntry | null {
    const candidateChecksum = checksum(event);
    const duplicate = this.#entries.some(
      (entry) => entry.event.type === event.type && entry.tick === event.tick && entry.checksum === candidateChecksum,
    );
    return duplicate ? null : this.append(event);
  }

  cursor(): JournalCursor {
    const last = this.#entries.at(-1);
    return Object.freeze({
      sequence: last?.sequence ?? 0,
      tick: last?.tick ?? 0,
    });
  }

  fromSequence(sequence: number, limit = this.capacity): readonly JournalEntry[] {
    const start = Math.max(0, Math.floor(sequence));
    const size = Math.max(0, Math.floor(limit));
    return this.#entries
      .filter((entry) => entry.sequence >= start)
      .slice(0, size)
      .map((entry) => this.cloneEntry(entry));
  }

  fromTick(tick: number, limit = this.capacity): readonly JournalEntry[] {
    const start = Math.max(0, Math.floor(tick));
    const size = Math.max(0, Math.floor(limit));
    return this.#entries
      .filter((entry) => entry.tick >= start)
      .slice(0, size)
      .map((entry) => this.cloneEntry(entry));
  }

  verify(): readonly string[] {
    const failures: string[] = [];
    let previousSequence = 0;
    for (const entry of this.#entries) {
      if (entry.sequence <= previousSequence) failures.push('sequence order violation at ' + entry.sequence);
      if (checksum(entry.event) !== entry.checksum) failures.push('checksum mismatch at ' + entry.sequence);
      previousSequence = entry.sequence;
    }
    return Object.freeze(failures);
  }

  replay(
    fromSequence: number,
    apply: (event: R35RuntimeEvent, entry: JournalEntry) => boolean,
  ): JournalReplayResult {
    const entries = this.fromSequence(fromSequence);
    let applied = 0;
    let skipped = 0;
    for (const entry of entries) {
      if (apply(structuredClone(entry.event), this.cloneEntry(entry))) applied += 1;
      else skipped += 1;
    }
    const expectedGap = this.#entries.length > 0 && fromSequence < (this.#entries[0]?.sequence ?? fromSequence);
    return {
      requestedFromSequence: fromSequence,
      applied,
      skipped,
      missing: expectedGap,
      finalSequence: this.#entries.at(-1)?.sequence ?? 0,
    };
  }

  compact(beforeSequence: number): number {
    const target = Math.max(0, Math.floor(beforeSequence));
    const before = this.#entries.length;
    this.#entries = this.#entries.filter((entry) => entry.sequence >= target);
    return before - this.#entries.length;
  }

  clear(): void {
    this.#entries.length = 0;
    this.#nextSequence = 1;
  }

  get size(): number {
    return this.#entries.length;
  }

  private cloneEntry(entry: JournalEntry): JournalEntry {
    return {
      sequence: entry.sequence,
      tick: entry.tick,
      event: structuredClone(entry.event),
      checksum: entry.checksum,
    };
  }
}
