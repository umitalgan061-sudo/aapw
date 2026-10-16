/**
 * Bounded append-only runtime event ledger.
 * Event sequence is authoritative; wall clock time is intentionally not stored.
 */
import {
  R44BoundaryError,
  R44InvariantError,
  type R44Fingerprint,
  type R44JsonValue,
  type R44Sequence,
  r44AsSequence,
  r44FiniteInteger,
  r44FreezeJson,
  r44NormalizeId,
  r44NormalizeLabel,
} from "./contracts.js";
import { r44Fingerprint, type R44Digest } from "./hash.js";

export interface R44LedgerEventInput {
  readonly kind: string;
  readonly source: string;
  readonly tick: number;
  readonly payload: R44JsonValue;
  readonly correlationId?: string;
  readonly tags?: readonly string[];
}

export interface R44LedgerEntry {
  readonly sequence: R44Sequence;
  readonly kind: string;
  readonly source: string;
  readonly tick: number;
  readonly payload: R44JsonValue;
  readonly correlationId: string | null;
  readonly tags: readonly string[];
  readonly previousFingerprint: R44Fingerprint;
  readonly fingerprint: R44Fingerprint;
}

export interface R44LedgerOptions {
  readonly capacity?: number;
  readonly maxPayloadBytes?: number;
  readonly includePayloadInSnapshots?: boolean;
}

export interface R44LedgerSnapshot {
  readonly version: 1;
  readonly capacity: number;
  readonly firstSequence: number | null;
  readonly lastSequence: number;
  readonly droppedEntries: number;
  readonly tipFingerprint: R44Fingerprint;
  readonly entries: readonly R44LedgerEntry[];
}

export interface R44LedgerVerification {
  readonly valid: boolean;
  readonly checkedEntries: number;
  readonly firstInvalidSequence: number | null;
  readonly expectedFingerprint: string | null;
  readonly observedFingerprint: string | null;
  readonly reason: string | null;
}

const GENESIS = "r44-ledger-genesis" as R44Fingerprint;

export class R44EventLedger {
  readonly #capacity: number;
  readonly #maxPayloadBytes: number;
  readonly #includePayloadInSnapshots: boolean;
  readonly #entries: R44LedgerEntry[] = [];
  #lastSequence = 0;
  #droppedEntries = 0;
  #tipFingerprint: R44Fingerprint = GENESIS;

  constructor(options: R44LedgerOptions = {}) {
    this.#capacity = r44FiniteInteger(options.capacity ?? 4096, "capacity", 1, 1_000_000);
    this.#maxPayloadBytes = r44FiniteInteger(options.maxPayloadBytes ?? 64 * 1024, "maxPayloadBytes", 128, 4 * 1024 * 1024);
    this.#includePayloadInSnapshots = options.includePayloadInSnapshots ?? true;
  }

  get size(): number {
    return this.#entries.length;
  }

  get capacity(): number {
    return this.#capacity;
  }

  get lastSequence(): number {
    return this.#lastSequence;
  }

  get droppedEntries(): number {
    return this.#droppedEntries;
  }

  get tipFingerprint(): R44Fingerprint {
    return this.#tipFingerprint;
  }

  append(input: R44LedgerEventInput): R44LedgerEntry {
    const kind = r44NormalizeLabel(input.kind, 96);
    const source = r44NormalizeId(input.source, "source", 128);
    const tick = r44FiniteInteger(input.tick, "tick", 0, Number.MAX_SAFE_INTEGER);
    if (tick < 0) throw new R44BoundaryError("negative-tick", "tick cannot be negative");
    const sequence = r44AsSequence(this.#lastSequence + 1);
    const normalizedPayload = r44FreezeJson(input.payload, { maxStringLength: this.#maxPayloadBytes });
    const payloadDigest = r44Fingerprint(normalizedPayload, { maxEncodedLength: this.#maxPayloadBytes });
    if (payloadDigest.byteLength > this.#maxPayloadBytes) {
      throw new R44BoundaryError("payload-too-large", "Event payload exceeds ledger limit");
    }
    const tags = Object.freeze((input.tags ?? []).map((tag) => r44NormalizeLabel(tag, 64)).slice(0, 32));
    const correlationId = input.correlationId === undefined ? null : r44NormalizeId(input.correlationId, "correlationId", 128);
    const body: R44JsonValue = Object.freeze({
      sequence,
      kind,
      source,
      tick,
      payload: normalizedPayload,
      correlationId,
      tags,
      previousFingerprint: this.#tipFingerprint,
    }) as unknown as R44JsonValue;
    const fingerprint = r44Fingerprint(body, { maxEncodedLength: this.#maxPayloadBytes + 4096 }).fingerprint;
    const entry: R44LedgerEntry = Object.freeze({
      sequence,
      kind,
      source,
      tick,
      payload: normalizedPayload,
      correlationId,
      tags,
      previousFingerprint: this.#tipFingerprint,
      fingerprint,
    });
    this.#entries.push(entry);
    this.#lastSequence = sequence;
    this.#tipFingerprint = fingerprint;
    if (this.#entries.length > this.#capacity) {
      this.#entries.shift();
      this.#droppedEntries += 1;
    }
    return entry;
  }

  get(sequence: number): R44LedgerEntry | undefined {
    r44FiniteInteger(sequence, "sequence", 1);
    const first = this.#entries[0]?.sequence;
    if (first === undefined || sequence < first) return undefined;
    const offset = sequence - Number(first);
    const candidate = this.#entries[offset];
    return candidate?.sequence === sequence ? candidate : undefined;
  }

  read(options: { afterSequence?: number; limit?: number; kind?: string; source?: string } = {}): readonly R44LedgerEntry[] {
    const after = r44FiniteInteger(options.afterSequence ?? 0, "afterSequence", 0);
    const limit = r44FiniteInteger(options.limit ?? 256, "limit", 1, this.#capacity);
    const kind = options.kind === undefined ? null : r44NormalizeLabel(options.kind, 96);
    const source = options.source === undefined ? null : r44NormalizeId(options.source, "source", 128);
    const result: R44LedgerEntry[] = [];
    for (const entry of this.#entries) {
      if (entry.sequence <= after) continue;
      if (kind !== null && entry.kind !== kind) continue;
      if (source !== null && entry.source !== source) continue;
      result.push(entry);
      if (result.length >= limit) break;
    }
    return Object.freeze(result);
  }

  verify(): R44LedgerVerification {
    let previous: R44Fingerprint | null = null;
    let checked = 0;
    for (const entry of this.#entries) {
      const payload: R44JsonValue = Object.freeze({
        sequence: entry.sequence,
        kind: entry.kind,
        source: entry.source,
        tick: entry.tick,
        payload: entry.payload,
        correlationId: entry.correlationId,
        tags: entry.tags,
        previousFingerprint: entry.previousFingerprint,
      }) as unknown as R44JsonValue;
      const observed = r44Fingerprint(payload, { maxEncodedLength: this.#maxPayloadBytes + 4096 }).fingerprint;
      checked += 1;
      if (observed !== entry.fingerprint) {
        return Object.freeze({
          valid: false,
          checkedEntries: checked,
          firstInvalidSequence: entry.sequence,
          expectedFingerprint: observed,
          observedFingerprint: entry.fingerprint,
          reason: "entry fingerprint mismatch",
        });
      }
      if (previous !== null && entry.previousFingerprint !== previous) {
        return Object.freeze({
          valid: false,
          checkedEntries: checked,
          firstInvalidSequence: entry.sequence,
          expectedFingerprint: previous,
          observedFingerprint: entry.previousFingerprint,
          reason: "previous fingerprint link mismatch",
        });
      }
      previous = entry.fingerprint;
    }
    if (this.#entries.length > 0 && previous !== this.#tipFingerprint) {
      return Object.freeze({
        valid: false,
        checkedEntries: checked,
        firstInvalidSequence: this.#entries[this.#entries.length - 1]?.sequence ?? null,
        expectedFingerprint: previous,
        observedFingerprint: this.#tipFingerprint,
        reason: "tip fingerprint mismatch",
      });
    }
    return Object.freeze({
      valid: true,
      checkedEntries: checked,
      firstInvalidSequence: null,
      expectedFingerprint: null,
      observedFingerprint: null,
      reason: null,
    });
  }

  snapshot(options: { fromSequence?: number; limit?: number } = {}): R44LedgerSnapshot {
    const fromSequence = r44FiniteInteger(options.fromSequence ?? 0, "fromSequence", 0);
    const limit = r44FiniteInteger(options.limit ?? this.#capacity, "limit", 1, this.#capacity);
    const entries = this.#entries
      .filter((entry) => entry.sequence >= fromSequence)
      .slice(-limit)
      .map((entry) => {
        if (this.#includePayloadInSnapshots) return entry;
        return Object.freeze({ ...entry, payload: null });
      });
    return Object.freeze({
      version: 1,
      capacity: this.#capacity,
      firstSequence: this.#entries[0]?.sequence ?? null,
      lastSequence: this.#lastSequence,
      droppedEntries: this.#droppedEntries,
      tipFingerprint: this.#tipFingerprint,
      entries: Object.freeze(entries),
    });
  }

  clear(options: { keepSequence?: boolean } = {}): void {
    this.#entries.length = 0;
    this.#droppedEntries = 0;
    this.#tipFingerprint = GENESIS;
    if (!options.keepSequence) this.#lastSequence = 0;
  }

  importSnapshot(snapshot: R44LedgerSnapshot): void {
    if (snapshot.version !== 1) throw new R44BoundaryError("ledger-version", "Unsupported ledger snapshot version");
    r44FiniteInteger(snapshot.lastSequence, "snapshot.lastSequence", 0);
    r44FiniteInteger(snapshot.droppedEntries, "snapshot.droppedEntries", 0);
    if (!Array.isArray(snapshot.entries) || snapshot.entries.length > this.#capacity) {
      throw new R44BoundaryError("ledger-entry-count", "Snapshot entry count exceeds capacity");
    }
    const prior = {
      entries: [...this.#entries],
      lastSequence: this.#lastSequence,
      dropped: this.#droppedEntries,
      tip: this.#tipFingerprint,
    };
    try {
      this.#entries.length = 0;
      this.#lastSequence = 0;
      this.#droppedEntries = snapshot.droppedEntries;
      this.#tipFingerprint = GENESIS;
      for (const entry of snapshot.entries) {
        const expectedSequence = this.#lastSequence + 1;
        if (entry.sequence !== expectedSequence && this.#entries.length > 0) {
          throw new R44BoundaryError("ledger-sequence-gap", "Snapshot contains a sequence gap");
        }
        const payload: R44JsonValue = Object.freeze({
          sequence: entry.sequence,
          kind: entry.kind,
          source: entry.source,
          tick: entry.tick,
          payload: entry.payload,
          correlationId: entry.correlationId,
          tags: entry.tags,
          previousFingerprint: entry.previousFingerprint,
        }) as unknown as R44JsonValue;
        const verified = r44Fingerprint(payload, { maxEncodedLength: this.#maxPayloadBytes + 4096 }).fingerprint;
        if (verified !== entry.fingerprint) throw new R44BoundaryError("ledger-hash-invalid", "Snapshot entry fingerprint mismatch");
        this.#entries.push(Object.freeze({ ...entry }));
        this.#lastSequence = entry.sequence;
        this.#tipFingerprint = entry.fingerprint;
      }
      if (this.#lastSequence !== snapshot.lastSequence) {
        throw new R44BoundaryError("ledger-sequence-tip", "Snapshot lastSequence does not match its entries");
      }
      if (snapshot.entries.length > 0 && this.#tipFingerprint !== snapshot.tipFingerprint) {
        throw new R44BoundaryError("ledger-tip-invalid", "Snapshot tip fingerprint mismatch");
      }
    } catch (error) {
      this.#entries.splice(0, this.#entries.length, ...prior.entries);
      this.#lastSequence = prior.lastSequence;
      this.#droppedEntries = prior.dropped;
      this.#tipFingerprint = prior.tip;
      throw error;
    }
  }

  assertHealthy(): void {
    const result = this.verify();
    if (!result.valid) throw new R44InvariantError("ledger-corrupt", result.reason ?? "Ledger verification failed", {
      sequence: result.firstInvalidSequence,
    });
  }

  entries(): readonly R44LedgerEntry[] {
    return Object.freeze([...this.#entries]);
  }
}
