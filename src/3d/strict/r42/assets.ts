/**
 * Bounded asset registry and request coordinator for R42.
 * Production TypeScript owner.
 */

import type { AssetRecord, AssetRequest, Priority } from './types.ts';
import { clamp, finite, deepFreeze, hashValue } from './types.ts';

export interface AssetDeclaration {
  readonly id: string;
  readonly url: string;
  readonly priority?: Priority;
  readonly dependencies?: readonly string[];
  readonly critical?: boolean;
}

export interface AssetStats {
  readonly declared: number;
  readonly queued: number;
  readonly loading: number;
  readonly ready: number;
  readonly failed: number;
  readonly evicted: number;
  readonly residentBytes: number;
  readonly maxBytes: number;
  readonly utilization: number;
  readonly checksum: number;
}

const PRIORITY_WEIGHT: Record<Priority, number> = {
  critical: 5,
  high: 4,
  normal: 3,
  low: 2,
  background: 1,
};

export class AssetRegistryR42 {
  readonly maxBytes: number;
  readonly maxEntries: number;
  #records = new Map<string, AssetRecord>();
  #queue: AssetRequest[] = [];
  #residentBytes = 0;

  constructor(maxBytes = 256 * 1024 * 1024, maxEntries = 4096) {
    this.maxBytes = Math.max(1_048_576, Math.trunc(maxBytes));
    this.maxEntries = Math.max(32, Math.trunc(maxEntries));
  }

  declare(input: AssetDeclaration): AssetRecord {
    const id = sanitizeId(input.id);
    if (!id) throw new Error('R42 asset id is empty.');
    const previous = this.#records.get(id);
    const record: AssetRecord = deepFreeze({
      id,
      url: input.url.slice(0, 2048),
      state: previous?.state ?? 'declared',
      bytes: previous?.bytes ?? 0,
      refs: previous?.refs ?? 0,
      priority: input.priority ?? previous?.priority ?? 'normal',
      dependencies: [...new Set(input.dependencies ?? previous?.dependencies ?? [])].sort(),
      lastUsedTick: previous?.lastUsedTick ?? 0,
      revision: (previous?.revision ?? 0) + 1,
      digest: previous?.digest ?? null,
      critical: input.critical ?? previous?.critical ?? false,
    });
    if (!previous && this.#records.size >= this.maxEntries) this.evictToCapacity(1);
    this.#records.set(id, record);
    return record;
  }

  request(request: AssetRequest): boolean {
    const record = this.#records.get(request.id);
    if (!record || record.state === 'ready' || record.state === 'loading') return false;
    if (this.#queue.length >= this.maxEntries) return false;
    this.#records.set(record.id, deepFreeze({ ...record, state: 'queued', lastUsedTick: request.requestedTick }));
    this.#queue.push(Object.freeze({ ...request }));
    this.#queue.sort(compareRequests);
    return true;
  }

  dequeue(limit = 8): readonly AssetRequest[] {
    const count = Math.max(0, Math.trunc(limit));
    const result = this.#queue.splice(0, count);
    for (const request of result) {
      const record = this.#records.get(request.id);
      if (record) this.#records.set(record.id, deepFreeze({ ...record, state: 'loading' }));
    }
    return Object.freeze(result);
  }

  markReady(id: string, bytes: number, digest: string | null, tick: number): boolean {
    const record = this.#records.get(id);
    if (!record) return false;
    const safeBytes = Math.max(0, Math.trunc(finite(bytes)));
    this.#residentBytes -= record.bytes;
    this.#residentBytes += safeBytes;
    this.#records.set(id, deepFreeze({
      ...record,
      state: 'ready',
      bytes: safeBytes,
      refs: Math.max(0, record.refs) + 1,
      lastUsedTick: Math.max(0, Math.trunc(tick)),
      revision: record.revision + 1,
      digest: digest?.slice(0, 128) ?? null,
    }));
    this.evictToCapacity(0);
    return true;
  }

  markFailed(id: string): boolean {
    const record = this.#records.get(id);
    if (!record) return false;
    this.#records.set(id, deepFreeze({ ...record, state: 'failed', revision: record.revision + 1 }));
    return true;
  }

  retain(id: string, tick: number): boolean {
    const record = this.#records.get(id);
    if (!record) return false;
    this.#records.set(id, deepFreeze({ ...record, refs: record.refs + 1, lastUsedTick: tick }));
    return true;
  }

  release(id: string, tick: number): boolean {
    const record = this.#records.get(id);
    if (!record) return false;
    this.#records.set(id, deepFreeze({ ...record, refs: Math.max(0, record.refs - 1), lastUsedTick: tick }));
    return true;
  }

  get(id: string): AssetRecord | null {
    const record = this.#records.get(id);
    return record ? deepFreeze({ ...record }) : null;
  }

  records(): readonly AssetRecord[] {
    return Object.freeze([...this.#records.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }

  stats(): AssetStats {
    const counts = {
      declared: 0,
      queued: 0,
      loading: 0,
      ready: 0,
      failed: 0,
      evicted: 0,
    };
    for (const record of this.#records.values()) counts[record.state] += 1;
    return Object.freeze({
      ...counts,
      residentBytes: this.#residentBytes,
      maxBytes: this.maxBytes,
      utilization: clamp(this.#residentBytes / this.maxBytes, 0, 1),
      checksum: hashValue(this.records()),
    });
  }

  evictToCapacity(requiredBytes: number): number {
    let freed = 0;
    while (this.#residentBytes + requiredBytes > this.maxBytes) {
      const candidates = [...this.#records.values()]
        .filter(record => record.state === 'ready' && record.refs === 0 && !record.critical)
        .sort((a, b) => scoreEviction(a) - scoreEviction(b) || a.id.localeCompare(b.id));
      const victim = candidates[0];
      if (!victim) break;
      this.#records.set(victim.id, deepFreeze({ ...victim, state: 'evicted', bytes: 0, revision: victim.revision + 1 }));
      this.#residentBytes -= victim.bytes;
      freed += victim.bytes;
    }
    return freed;
  }
}

function scoreEviction(record: AssetRecord): number {
  return record.lastUsedTick * 0.1 + PRIORITY_WEIGHT[record.priority] * 1000 + (record.critical ? 1_000_000 : 0);
}

function compareRequests(a: AssetRequest, b: AssetRequest): number {
  const pa = PRIORITY_WEIGHT[a.priority];
  const pb = PRIORITY_WEIGHT[b.priority];
  return pb - pa || a.requestedTick - b.requestedTick || a.id.localeCompare(b.id);
}

function sanitizeId(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 128);
}
