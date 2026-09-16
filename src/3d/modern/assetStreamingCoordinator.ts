import type { AssetManifestEntry } from './assetPolicy';
import type { ResourceRegistry } from './resourceRegistry';
import type { Result, UnixMillis } from './types';

export type Residency = 'cold' | 'queued' | 'loading' | 'resident' | 'evicting' | 'failed';
export type AssetPriority = 0 | 1 | 2 | 3 | 4 | 5;

export interface AssetRequest {
  readonly id: string;
  readonly distance: number;
  readonly priority: AssetPriority;
  readonly required: boolean;
  readonly reason: 'bootstrap' | 'proximity' | 'gameplay' | 'prefetch' | 'recovery';
}

export interface AssetRuntimeState {
  readonly id: string;
  readonly residency: Residency;
  readonly requests: number;
  readonly lastRequestedAt: UnixMillis;
  readonly lastResidentAt: UnixMillis | null;
  readonly bytes: number;
  readonly failures: number;
  readonly priority: AssetPriority;
}

export interface AssetStreamingOptions {
  readonly now?: () => UnixMillis;
  readonly maxConcurrent?: number;
  readonly maxBytes?: number;
  readonly softBytes?: number;
  readonly evictionGraceMs?: number;
  readonly maxFailures?: number;
}

interface QueueItem {
  readonly request: AssetRequest;
  readonly sequence: number;
}

function clampPriority(value: number): AssetPriority {
  return Math.max(0, Math.min(5, Math.trunc(value))) as AssetPriority;
}

function score(item: QueueItem): number {
  const distance = Math.max(0, item.request.distance);
  const requirement = item.request.required ? 100_000 : 0;
  return requirement + Number(item.request.priority) * 10_000 - distance * 100 - item.sequence * 0.001;
}

/**
 * Bounded streaming scheduler around ResourceRegistry.
 * It never decides how an asset is rendered; it only governs when resources become resident and when
 * they can be evicted. The scheduler is deterministic for a fixed request sequence and clock.
 */
export class AssetStreamingCoordinator<T = unknown> {
  readonly maxConcurrent: number;
  readonly maxBytes: number;
  readonly softBytes: number;
  readonly evictionGraceMs: number;
  readonly maxFailures: number;
  #now: () => UnixMillis;
  #registry: ResourceRegistry<T>;
  #states = new Map<string, AssetRuntimeState>();
  #queue: QueueItem[] = [];
  #active = new Set<string>();
  #sequence = 0;
  #bytes = 0;

  constructor(registry: ResourceRegistry<T>, options: AssetStreamingOptions = {}) {
    this.#registry = registry;
    this.maxConcurrent = Math.max(1, Math.min(32, Math.trunc(options.maxConcurrent ?? 4)));
    this.maxBytes = Math.max(16 * 1024 * 1024, Math.trunc(options.maxBytes ?? 512 * 1024 * 1024));
    this.softBytes = Math.max(8 * 1024 * 1024, Math.min(this.maxBytes, Math.trunc(options.softBytes ?? this.maxBytes * 0.8)));
    this.evictionGraceMs = Math.max(1000, Math.trunc(options.evictionGraceMs ?? 15_000));
    this.maxFailures = Math.max(1, Math.min(10, Math.trunc(options.maxFailures ?? 3)));
    this.#now = options.now ?? (() => Date.now() as UnixMillis);
  }

  enqueue(request: AssetRequest): Result<AssetRuntimeState> {
    const normalized = { ...request, distance: Math.max(0, request.distance), priority: clampPriority(request.priority) };
    const now = this.#now();
    const current = this.#states.get(request.id);
    if (current?.residency === 'resident') {
      const next = Object.freeze({ ...current, requests: current.requests + 1, lastRequestedAt: now, priority: Math.max(current.priority, normalized.priority) as AssetPriority });
      this.#states.set(request.id, next);
      return { ok: true, value: next };
    }
    const next = Object.freeze({
      id: request.id,
      residency: 'queued' as const,
      requests: (current?.requests ?? 0) + 1,
      lastRequestedAt: now,
      lastResidentAt: current?.lastResidentAt ?? null,
      bytes: current?.bytes ?? 0,
      failures: current?.failures ?? 0,
      priority: normalized.priority,
    });
    this.#states.set(request.id, next);
    this.#queue.push(Object.freeze({ request: normalized, sequence: this.#sequence++ }));
    return { ok: true, value: next };
  }

  async pump(load: (id: string) => Promise<{ readonly value: T; readonly bytes: number }>): Promise<void> {
    while (this.#active.size < this.maxConcurrent) {
      const next = this.#nextQueue();
      if (!next) break;
      const id = next.request.id;
      if (this.#active.has(id)) continue;
      this.#active.add(id);
      this.#setResidency(id, 'loading');
      void this.#loadOne(id, load);
    }
    await Promise.resolve();
  }

  async drain(load: (id: string) => Promise<{ readonly value: T; readonly bytes: number }>, guard = 10_000): Promise<void> {
    let loops = 0;
    while ((this.#queue.length || this.#active.size) && loops++ < guard) {
      await this.pump(load);
      await Promise.resolve();
    }
  }

  async evict(now = this.#now(), targetBytes = this.softBytes): Promise<readonly string[]> {
    if (this.#bytes <= targetBytes) return [];
    const candidates = [...this.#states.values()]
      .filter((state) => state.residency === 'resident' && !this.#active.has(state.id) && now - Number(state.lastRequestedAt) >= this.evictionGraceMs)
      .sort((a, b) => (Number(a.lastRequestedAt) - Number(b.lastRequestedAt)) || (b.bytes - a.bytes));
    const evicted: string[] = [];
    for (const state of candidates) {
      if (this.#bytes <= targetBytes) break;
      this.#setResidency(state.id, 'evicting');
      try {
        this.#registry.release(state.id);
        this.#bytes = Math.max(0, this.#bytes - state.bytes);
        this.#states.set(state.id, Object.freeze({ ...state, residency: 'cold', bytes: 0 }));
        evicted.push(state.id);
      } catch {
        this.#setResidency(state.id, 'failed');
      }
    }
    return Object.freeze(evicted);
  }

  state(id: string): AssetRuntimeState | null { return this.#states.get(id) ?? null; }

  states(): readonly AssetRuntimeState[] { return Object.freeze([...this.#states.values()]); }

  stats(): Readonly<Record<string, number>> {
    let resident = 0;
    let queued = 0;
    let loading = 0;
    let failed = 0;
    for (const state of this.#states.values()) {
      if (state.residency === 'resident') resident += 1;
      if (state.residency === 'queued') queued += 1;
      if (state.residency === 'loading') loading += 1;
      if (state.residency === 'failed') failed += 1;
    }
    return Object.freeze({ tracked: this.#states.size, resident, queued, loading, failed, active: this.#active.size, bytes: this.#bytes });
  }

  resetFailures(): void {
    for (const [id, state] of this.#states) {
      if (state.failures) this.#states.set(id, Object.freeze({ ...state, failures: 0, residency: state.residency === 'failed' ? 'cold' : state.residency }));
    }
  }

  prioritize(id: string, priority: AssetPriority): boolean {
    const state = this.#states.get(id);
    if (!state) return false;
    this.#states.set(id, Object.freeze({ ...state, priority: clampPriority(priority) }));
    for (const item of this.#queue) if (item.request.id === id) (item.request as { priority: AssetPriority }).priority = clampPriority(priority);
    return true;
  }

  queueLength(): number { return this.#queue.length; }

  #nextQueue(): QueueItem | null {
    if (!this.#queue.length) return null;
    this.#queue.sort((a, b) => score(b) - score(a));
    return this.#queue.shift() ?? null;
  }

  async #loadOne(id: string, load: (id: string) => Promise<{ readonly value: T; readonly bytes: number }>): Promise<void> {
    try {
      const result = await load(id);
      const bytes = Math.max(0, Math.trunc(result.bytes));
      if (this.#bytes + bytes > this.maxBytes) {
        await this.evict(this.#now(), Math.max(0, this.maxBytes - bytes));
      }
      if (this.#bytes + bytes > this.maxBytes) throw new Error('Asset residency budget exceeded');
      this.#registry.acquire(id);
      this.#bytes += bytes;
      const state = this.#states.get(id);
      if (state) this.#states.set(id, Object.freeze({ ...state, residency: 'resident', bytes, lastResidentAt: this.#now() }));
    } catch {
      const state = this.#states.get(id);
      if (state) {
        const failures = state.failures + 1;
        this.#states.set(id, Object.freeze({ ...state, residency: failures >= this.maxFailures ? 'failed' : 'cold', failures }));
      }
    } finally {
      this.#active.delete(id);
    }
  }

  #setResidency(id: string, residency: Residency): void {
    const state = this.#states.get(id);
    if (state) this.#states.set(id, Object.freeze({ ...state, residency }));
  }
}

export interface ManifestPlan {
  readonly entries: readonly AssetManifestEntry[];
  readonly totalBytes: number;
  readonly requiredBytes: number;
  readonly optionalBytes: number;
  readonly groups: Readonly<Record<string, number>>;
}

export function planManifest(entries: readonly AssetManifestEntry[]): ManifestPlan {
  let totalBytes = 0;
  let requiredBytes = 0;
  const groups: Record<string, number> = {};
  for (const entry of entries) {
    const bytes = Math.max(0, Number((entry as AssetManifestEntry & { bytes?: number }).bytes ?? 0));
    totalBytes += bytes;
    if ((entry as AssetManifestEntry & { required?: boolean }).required !== false) requiredBytes += bytes;
    const key = String((entry as AssetManifestEntry & { kind?: string }).kind ?? 'unknown');
    groups[key] = (groups[key] ?? 0) + bytes;
  }
  return Object.freeze({ entries: Object.freeze([...entries]), totalBytes, requiredBytes, optionalBytes: Math.max(0, totalBytes - requiredBytes), groups: Object.freeze(groups) });
}
