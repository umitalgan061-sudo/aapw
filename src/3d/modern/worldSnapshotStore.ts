import { checksum, stableStringify } from './deterministic';
import type { FrameId, Result, UnixMillis } from './types';

export interface SnapshotRecord<T> {
  readonly id: string;
  readonly frame: FrameId;
  readonly createdAt: UnixMillis;
  readonly schema: string;
  readonly version: number;
  readonly bytes: number;
  readonly checksum: string;
  readonly payload: T;
}

export interface SnapshotStoreOptions {
  readonly schema?: string;
  readonly version?: number;
  readonly capacity?: number;
  readonly maxBytes?: number;
  readonly now?: () => UnixMillis;
}

export interface SnapshotStoreStats {
  readonly count: number;
  readonly bytes: number;
  readonly capacity: number;
  readonly maxBytes: number;
  readonly oldestFrame: FrameId | null;
  readonly newestFrame: FrameId | null;
}

function sizeOf(value: unknown): number {
  try { return new TextEncoder().encode(stableStringify(value)).byteLength; } catch { return Number.POSITIVE_INFINITY; }
}

function safeId(value: string, fallback: string): string {
  return /^[a-zA-Z0-9._:-]{1,128}$/.test(value) ? value : fallback;
}

/**
 * Bounded snapshot ring with deterministic eviction. Intended for rewind/debug/replay checkpoints,
 * not as a replacement for SaveSystem. Records are immutable and self-verifying.
 */
export class WorldSnapshotStore<T> {
  readonly schema: string;
  readonly version: number;
  readonly capacity: number;
  readonly maxBytes: number;
  #now: () => UnixMillis;
  #records: SnapshotRecord<T>[] = [];
  #bytes = 0;
  #sequence = 0;

  constructor(options: SnapshotStoreOptions = {}) {
    this.schema = options.schema ?? 'aapw.world.snapshot';
    this.version = Math.max(1, Math.trunc(options.version ?? 1));
    this.capacity = Math.max(1, Math.min(4096, Math.trunc(options.capacity ?? 120)));
    this.maxBytes = Math.max(64 * 1024, Math.min(256 * 1024 * 1024, Math.trunc(options.maxBytes ?? 64 * 1024 * 1024)));
    this.#now = options.now ?? (() => Date.now() as UnixMillis);
  }

  capture(payload: T, frame: FrameId, id?: string): SnapshotRecord<T> {
    const cloned = structuredClone(payload);
    const bytes = sizeOf(cloned);
    if (!Number.isFinite(bytes) || bytes > this.maxBytes) throw new RangeError('Snapshot exceeds storage budget');
    const record: SnapshotRecord<T> = Object.freeze({
      id: safeId(id ?? `snapshot-${++this.#sequence}`, `snapshot-${++this.#sequence}`),
      frame,
      createdAt: this.#now(),
      schema: this.schema,
      version: this.version,
      bytes,
      checksum: checksum(cloned),
      payload: cloned,
    });
    this.#records.push(record);
    this.#bytes += bytes;
    this.#evict();
    return record;
  }

  latest(): SnapshotRecord<T> | null { return this.#records[this.#records.length - 1] ?? null; }
  oldest(): SnapshotRecord<T> | null { return this.#records[0] ?? null; }

  find(id: string): SnapshotRecord<T> | null {
    for (let index = this.#records.length - 1; index >= 0; index -= 1) if (this.#records[index]!.id === id) return this.#records[index]!;
    return null;
  }

  atOrBefore(frame: FrameId): SnapshotRecord<T> | null {
    for (let index = this.#records.length - 1; index >= 0; index -= 1) {
      const record = this.#records[index]!;
      if (Number(record.frame) <= Number(frame)) return record;
    }
    return null;
  }

  list(): readonly SnapshotRecord<T>[] { return Object.freeze([...this.#records]); }

  restore(id: string): Result<T> {
    const record = this.find(id);
    if (!record) return { ok: false, error: { code: 'SNAPSHOT_NOT_FOUND', message: 'Snapshot not found', retryable: false } };
    if (record.schema !== this.schema || record.version !== this.version) return { ok: false, error: { code: 'SNAPSHOT_SCHEMA_MISMATCH', message: 'Snapshot schema mismatch', retryable: false } };
    if (checksum(record.payload) !== record.checksum) return { ok: false, error: { code: 'SNAPSHOT_INTEGRITY', message: 'Snapshot checksum mismatch', retryable: false } };
    return { ok: true, value: structuredClone(record.payload) };
  }

  remove(id: string): boolean {
    const index = this.#records.findIndex((record) => record.id === id);
    if (index < 0) return false;
    this.#bytes = Math.max(0, this.#bytes - this.#records[index]!.bytes);
    this.#records.splice(index, 1);
    return true;
  }

  clear(): void { this.#records.length = 0; this.#bytes = 0; }

  verify(): readonly string[] {
    const invalid: string[] = [];
    for (const record of this.#records) if (checksum(record.payload) !== record.checksum || record.bytes !== sizeOf(record.payload)) invalid.push(record.id);
    return Object.freeze(invalid);
  }

  stats(): SnapshotStoreStats {
    return Object.freeze({
      count: this.#records.length,
      bytes: this.#bytes,
      capacity: this.capacity,
      maxBytes: this.maxBytes,
      oldestFrame: this.oldest()?.frame ?? null,
      newestFrame: this.latest()?.frame ?? null,
    });
  }

  exportManifest(): string {
    return stableStringify({ schema: this.schema, version: this.version, count: this.#records.length, bytes: this.#bytes, records: this.#records.map(({ id, frame, createdAt, bytes, checksum: digest }) => ({ id, frame, createdAt, bytes, checksum: digest })) });
  }

  #evict(): void {
    while (this.#records.length > this.capacity || this.#bytes > this.maxBytes) {
      const removed = this.#records.shift();
      if (!removed) break;
      this.#bytes = Math.max(0, this.#bytes - removed.bytes);
    }
  }
}

export function snapshotDigest<T>(value: T): string { return checksum(value); }
