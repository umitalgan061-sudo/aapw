import { compareNumbers, compareStrings, err, ok, stableDigest, stableStringify, type Result } from "./contracts.ts";

export interface JournalEvent<T = unknown> {
  readonly type: string;
  readonly tick: number;
  readonly payload: T;
  readonly id?: string;
  readonly source?: string;
}

export interface JournalRecord<T = unknown> {
  readonly sequence: number;
  readonly eventId: string;
  readonly type: string;
  readonly tick: number;
  readonly payload: T;
  readonly source: string;
  readonly previousDigest: string;
  readonly digest: string;
}

export interface JournalCheckpoint<T = unknown> {
  readonly sequence: number;
  readonly tick: number;
  readonly state: T;
  readonly journalDigest: string;
}

export interface JournalVerification {
  readonly valid: boolean;
  readonly firstInvalidSequence: number | null;
  readonly recordsChecked: number;
  readonly finalDigest: string;
  readonly reason: string | null;
}

export interface JournalExport<T = unknown, C = unknown> {
  readonly schema: "aapw.r44.journal";
  readonly version: 1;
  readonly anchorDigest: string;
  readonly nextSequence: number;
  readonly records: readonly JournalRecord<T>[];
  readonly checkpoints: readonly JournalCheckpoint<C>[];
  readonly digest: string;
}

/**
 * A bounded append-only audit/event journal. Each record binds its payload to
 * the prior digest. This detects accidental corruption and replay gaps; it is
 * not a cryptographic signature and must not be used as one.
 */
export class HashChainJournal<T = unknown, C = unknown> {
  readonly capacity: number;
  readonly checkpointCapacity: number;
  #records: JournalRecord<T>[] = [];
  #checkpoints: JournalCheckpoint<C>[] = [];
  #anchorDigest = "00000000";
  #nextSequence = 1;
  #recentEventIds = new Set<string>();
  #recentEventOrder: string[] = [];

  constructor(options: { readonly capacity?: number; readonly checkpointCapacity?: number } = {}) {
    this.capacity = Math.max(8, Math.trunc(options.capacity ?? 2048));
    this.checkpointCapacity = Math.max(1, Math.trunc(options.checkpointCapacity ?? 32));
  }

  get size(): number {
    return this.#records.length;
  }

  get nextSequence(): number {
    return this.#nextSequence;
  }

  get headDigest(): string {
    return this.#records.at(-1)?.digest ?? this.#anchorDigest;
  }

  append(event: JournalEvent<T>): Result<JournalRecord<T>> {
    const type = event.type.trim();
    if (!type) return err("JOURNAL_EVENT_TYPE", "Journal event type must not be empty.");
    const tick = Math.max(0, Math.trunc(event.tick));
    if (!Number.isFinite(event.tick)) return err("JOURNAL_TICK", "Journal tick must be finite.");
    const source = (event.source ?? "runtime").trim().slice(0, 96) || "runtime";
    let payload: T;
    let eventId: string;
    try {
      // Cloning through stable serialization ensures the record is detached from mutable caller data.
      payload = JSON.parse(stableStringify(event.payload)) as T;
      eventId = event.id?.trim() || stableDigest({ type, tick, source, payload, sequence: this.#nextSequence });
    } catch (cause) {
      return err("JOURNAL_PAYLOAD_INVALID", cause instanceof Error ? cause.message : String(cause));
    }
    if (this.#recentEventIds.has(eventId)) return err("JOURNAL_DUPLICATE_EVENT", "Event identifier was recently appended.", false, { eventId });
    const previousDigest = this.headDigest;
    const body = {
      sequence: this.#nextSequence,
      eventId,
      type,
      tick,
      payload,
      source,
      previousDigest,
    };
    const record: JournalRecord<T> = Object.freeze({ ...body, digest: stableDigest(body) });
    this.#records.push(record);
    this.#nextSequence += 1;
    this.#rememberEventId(eventId);
    this.#compactOverflow();
    return ok(record);
  }

  checkpoint(tick: number, state: C): Result<JournalCheckpoint<C>> {
    let clone: C;
    try {
      clone = JSON.parse(stableStringify(state)) as C;
    } catch (cause) {
      return err("JOURNAL_CHECKPOINT_INVALID", cause instanceof Error ? cause.message : String(cause));
    }
    const checkpoint: JournalCheckpoint<C> = Object.freeze({
      sequence: this.#nextSequence - 1,
      tick: Math.max(0, Math.trunc(tick)),
      state: clone,
      journalDigest: this.headDigest,
    });
    const last = this.#checkpoints.at(-1);
    if (last && checkpoint.sequence < last.sequence) {
      return err("JOURNAL_CHECKPOINT_ORDER", "Checkpoint sequence cannot move backward.");
    }
    this.#checkpoints.push(checkpoint);
    while (this.#checkpoints.length > this.checkpointCapacity) this.#checkpoints.shift();
    return ok(checkpoint);
  }

  compactThrough(sequence: number): Result<number> {
    const target = Math.trunc(sequence);
    if (target <= 0) return ok(0);
    const checkpoint = [...this.#checkpoints].reverse().find((item) => item.sequence >= target);
    if (!checkpoint) return err("JOURNAL_CHECKPOINT_REQUIRED", "Cannot compact without a checkpoint at or beyond the target.");
    const removable = this.#records.filter((record) => record.sequence <= target);
    if (removable.length === 0) return ok(0);
    const lastRemoved = removable.at(-1);
    if (!lastRemoved) return ok(0);
    this.#records = this.#records.filter((record) => record.sequence > target);
    this.#anchorDigest = lastRemoved.digest;
    // Keep the dedupe cache bounded; compaction advances the replay horizon.
    this.#recentEventIds.clear();
    this.#recentEventOrder = [];
    for (const record of this.#records) this.#rememberEventId(record.eventId);
    return ok(removable.length);
  }

  records(fromSequence = 1, toSequence = Number.MAX_SAFE_INTEGER): readonly JournalRecord<T>[] {
    const from = Math.max(1, Math.trunc(fromSequence));
    const to = Math.max(from, Math.trunc(toSequence));
    return Object.freeze(this.#records.filter((record) => record.sequence >= from && record.sequence <= to));
  }

  checkpoints(): readonly JournalCheckpoint<C>[] {
    return Object.freeze([...this.#checkpoints]);
  }

  latestCheckpoint(atOrBeforeTick = Number.MAX_SAFE_INTEGER): JournalCheckpoint<C> | undefined {
    return [...this.#checkpoints]
      .filter((checkpoint) => checkpoint.tick <= atOrBeforeTick)
      .sort((a, b) => compareNumbers(b.sequence, a.sequence))[0];
  }

  verify(): JournalVerification {
    let previous = this.#anchorDigest;
    let expectedSequence = this.#records[0]?.sequence ?? this.#nextSequence;
    for (const record of this.#records) {
      if (record.sequence !== expectedSequence) {
        return Object.freeze({
          valid: false,
          firstInvalidSequence: record.sequence,
          recordsChecked: Math.max(0, expectedSequence - (this.#records[0]?.sequence ?? expectedSequence)),
          finalDigest: previous,
          reason: "sequence gap",
        });
      }
      if (record.previousDigest !== previous) {
        return Object.freeze({ valid: false, firstInvalidSequence: record.sequence, recordsChecked: record.sequence - (this.#records[0]?.sequence ?? record.sequence), finalDigest: previous, reason: "previous digest mismatch" });
      }
      const body = {
        sequence: record.sequence,
        eventId: record.eventId,
        type: record.type,
        tick: record.tick,
        payload: record.payload,
        source: record.source,
        previousDigest: record.previousDigest,
      };
      let digest: string;
      try {
        digest = stableDigest(body);
      } catch {
        return Object.freeze({ valid: false, firstInvalidSequence: record.sequence, recordsChecked: 0, finalDigest: previous, reason: "payload is no longer serializable" });
      }
      if (digest !== record.digest) {
        return Object.freeze({ valid: false, firstInvalidSequence: record.sequence, recordsChecked: record.sequence - (this.#records[0]?.sequence ?? record.sequence), finalDigest: previous, reason: "record digest mismatch" });
      }
      previous = record.digest;
      expectedSequence += 1;
    }
    if (this.#records.length > 0 && this.#records.at(-1)?.sequence !== this.#nextSequence - 1) {
      return Object.freeze({ valid: false, firstInvalidSequence: this.#nextSequence - 1, recordsChecked: this.#records.length, finalDigest: previous, reason: "next sequence does not follow journal tail" });
    }
    return Object.freeze({
      valid: true,
      firstInvalidSequence: null,
      recordsChecked: this.#records.length,
      finalDigest: previous,
      reason: null,
    });
  }

  replay<R>(apply: (current: R, record: JournalRecord<T>) => R, initial: R, fromSequence = 1): Result<R> {
    const verification = this.verify();
    if (!verification.valid) {
      return err("JOURNAL_CORRUPT", "Cannot replay a journal with an invalid hash chain.", false, {
        sequence: verification.firstInvalidSequence ?? -1,
        reason: verification.reason ?? "unknown",
      });
    }
    let current = initial;
    for (const record of this.#records) {
      if (record.sequence < fromSequence) continue;
      try {
        current = apply(current, record);
      } catch (cause) {
        return err("JOURNAL_REPLAY_FAILED", cause instanceof Error ? cause.message : String(cause), false, { sequence: record.sequence });
      }
    }
    return ok(current);
  }

  export(): JournalExport<T, C> {
    const body = {
      schema: "aapw.r44.journal" as const,
      version: 1 as const,
      anchorDigest: this.#anchorDigest,
      nextSequence: this.#nextSequence,
      records: Object.freeze([...this.#records]),
      checkpoints: Object.freeze([...this.#checkpoints]),
    };
    return Object.freeze({ ...body, digest: stableDigest(body) });
  }

  import(snapshot: JournalExport<T, C>): Result<true> {
    if (snapshot.schema !== "aapw.r44.journal" || snapshot.version !== 1) {
      return err("JOURNAL_SCHEMA", "Unsupported journal schema.");
    }
    let bodyDigest: string;
    try {
      bodyDigest = stableDigest({
        schema: snapshot.schema,
        version: snapshot.version,
        anchorDigest: snapshot.anchorDigest,
        nextSequence: snapshot.nextSequence,
        records: snapshot.records,
        checkpoints: snapshot.checkpoints,
      });
    } catch (cause) {
      return err("JOURNAL_IMPORT_INVALID", cause instanceof Error ? cause.message : String(cause));
    }
    if (bodyDigest !== snapshot.digest) return err("JOURNAL_EXPORT_DIGEST", "Export digest mismatch.");
    if (snapshot.records.length > this.capacity || snapshot.checkpoints.length > this.checkpointCapacity) {
      return err("JOURNAL_IMPORT_LIMIT", "Imported journal exceeds configured capacity.");
    }
    if (!Number.isSafeInteger(snapshot.nextSequence) || snapshot.nextSequence < 1) {
      return err("JOURNAL_SEQUENCE_INVALID", "Imported sequence is invalid.");
    }
    const candidate = new HashChainJournal<T, C>({ capacity: this.capacity, checkpointCapacity: this.checkpointCapacity });
    candidate.#anchorDigest = snapshot.anchorDigest;
    candidate.#nextSequence = snapshot.nextSequence;
    candidate.#records = snapshot.records.map((record) => Object.freeze({ ...record }));
    candidate.#checkpoints = snapshot.checkpoints.map((checkpoint) => Object.freeze({ ...checkpoint }));
    for (const record of candidate.#records) candidate.#rememberEventId(record.eventId);
    const verification = candidate.verify();
    if (!verification.valid) return err("JOURNAL_CHAIN_INVALID", verification.reason ?? "Hash chain invalid.");
    this.#anchorDigest = candidate.#anchorDigest;
    this.#nextSequence = candidate.#nextSequence;
    this.#records = candidate.#records;
    this.#checkpoints = candidate.#checkpoints;
    this.#recentEventIds = candidate.#recentEventIds;
    this.#recentEventOrder = candidate.#recentEventOrder;
    return ok(true);
  }

  clear(): void {
    this.#records = [];
    this.#checkpoints = [];
    this.#anchorDigest = "00000000";
    this.#nextSequence = 1;
    this.#recentEventIds.clear();
    this.#recentEventOrder = [];
  }

  #compactOverflow(): void {
    while (this.#records.length > this.capacity) {
      const removed = this.#records.shift();
      if (removed) this.#anchorDigest = removed.digest;
    }
    // When automatic capacity eviction is needed, discard checkpoints outside the retained horizon.
    const firstSequence = this.#records[0]?.sequence ?? this.#nextSequence;
    this.#checkpoints = this.#checkpoints.filter((checkpoint) => checkpoint.sequence >= firstSequence - 1);
  }

  #rememberEventId(id: string): void {
    this.#recentEventIds.add(id);
    this.#recentEventOrder.push(id);
    const limit = Math.max(32, this.capacity * 2);
    while (this.#recentEventOrder.length > limit) {
      const removed = this.#recentEventOrder.shift();
      if (removed) this.#recentEventIds.delete(removed);
    }
  }
}

/** Helper for a command/event reader that refuses to apply the same sequence twice. */
export class SequenceCursor {
  #lastSequence: number;
  constructor(lastSequence = 0) {
    this.#lastSequence = Math.max(0, Math.trunc(lastSequence));
  }
  get lastSequence(): number {
    return this.#lastSequence;
  }
  accept(sequence: number): Result<true> {
    if (!Number.isSafeInteger(sequence) || sequence <= this.#lastSequence) {
      return err("JOURNAL_STALE_SEQUENCE", "Sequence is stale or invalid.", false, { received: sequence, last: this.#lastSequence });
    }
    if (sequence !== this.#lastSequence + 1) {
      return err("JOURNAL_SEQUENCE_GAP", "Sequence gap requires a checkpoint or resync.", true, { received: sequence, expected: this.#lastSequence + 1 });
    }
    this.#lastSequence = sequence;
    return ok(true);
  }
  reset(sequence = 0): void {
    this.#lastSequence = Math.max(0, Math.trunc(sequence));
  }
}
