export type CacheClass = 'critical' | 'near' | 'far' | 'background';

export interface CacheEntry {
  readonly key: string;
  readonly bytes: number;
  readonly className: CacheClass;
  readonly lastUsedFrame: number;
  readonly pinned: boolean;
  readonly generation: number;
}

export interface CachePolicy {
  readonly maxBytes: number;
  readonly maxEntries: number;
  readonly reserveCriticalBytes: number;
  readonly reserveNearBytes: number;
}

export interface CacheMetrics {
  readonly entries: number;
  readonly bytes: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly rejected: number;
  readonly criticalBytes: number;
  readonly nearBytes: number;
}

const classWeight: Record<CacheClass, number> = { critical: 4, near: 3, far: 2, background: 1 };

export class StreamingCachePolicyV2 {
  readonly #policy: CachePolicy;
  readonly #entries = new Map<string, CacheEntry>();
  #hits = 0;
  #misses = 0;
  #evictions = 0;
  #rejected = 0;
  #generation = 0;

  constructor(policy: Partial<CachePolicy> = {}) {
    const maxBytes = Math.max(1, Math.floor(policy.maxBytes ?? 512 * 1024 * 1024));
    this.#policy = Object.freeze({
      maxBytes,
      maxEntries: Math.max(1, Math.floor(policy.maxEntries ?? 4096)),
      reserveCriticalBytes: Math.min(maxBytes, Math.max(0, Math.floor(policy.reserveCriticalBytes ?? maxBytes * 0.2))),
      reserveNearBytes: Math.min(maxBytes, Math.max(0, Math.floor(policy.reserveNearBytes ?? maxBytes * 0.35))),
    });
  }

  touch(key: string, frame: number): CacheEntry | undefined {
    const current = this.#entries.get(key);
    if (!current) { this.#misses += 1; return undefined; }
    const next = Object.freeze({ ...current, lastUsedFrame: Math.max(0, Math.floor(frame)) });
    this.#entries.set(key, next);
    this.#hits += 1;
    return next;
  }

  reserve(entry: Omit<CacheEntry, 'generation'>): boolean {
    const key = entry.key.trim().slice(0, 160);
    const bytes = Math.max(0, Math.floor(entry.bytes));
    if (!key || bytes > this.#policy.maxBytes) { this.#rejected += 1; return false; }
    const current = this.#entries.get(key);
    if (current) {
      this.#entries.set(key, Object.freeze({ ...entry, key, bytes, generation: ++this.#generation }));
      return true;
    }
    if (!this.#makeRoom(bytes, entry.className)) { this.#rejected += 1; return false; }
    this.#entries.set(key, Object.freeze({ ...entry, key, bytes, generation: ++this.#generation }));
    return true;
  }

  release(key: string): boolean { return this.#entries.delete(key); }
  pin(key: string, pinned = true): boolean {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    this.#entries.set(key, Object.freeze({ ...entry, pinned }));
    return true;
  }

  has(key: string): boolean { return this.#entries.has(key); }
  get(key: string): CacheEntry | undefined { return this.#entries.get(key); }
  entries(): readonly CacheEntry[] { return [...this.#entries.values()].sort((a, b) => a.key.localeCompare(b.key)); }

  metrics(): CacheMetrics {
    let bytes = 0; let criticalBytes = 0; let nearBytes = 0;
    for (const entry of this.#entries.values()) {
      bytes += entry.bytes;
      if (entry.className === 'critical') criticalBytes += entry.bytes;
      if (entry.className === 'near') nearBytes += entry.bytes;
    }
    return Object.freeze({ entries: this.#entries.size, bytes, hits: this.#hits, misses: this.#misses, evictions: this.#evictions, rejected: this.#rejected, criticalBytes, nearBytes });
  }

  evict(frame: number, targetBytes: number): number {
    const before = this.metrics().bytes;
    const target = Math.max(0, Math.floor(targetBytes));
    if (before <= target) return 0;
    const candidates = [...this.#entries.values()]
      .filter((entry) => !entry.pinned && entry.className !== 'critical')
      .sort((a, b) => classWeight[a.className] - classWeight[b.className] || a.lastUsedFrame - b.lastUsedFrame || a.generation - b.generation || a.key.localeCompare(b.key));
    for (const entry of candidates) {
      if (this.metrics().bytes <= target) break;
      this.#entries.delete(entry.key);
      this.#evictions += 1;
    }
    void frame;
    return Math.max(0, before - this.metrics().bytes);
  }

  clear(): void { this.#entries.clear(); }

  #makeRoom(bytes: number, className: CacheClass): boolean {
    const current = this.metrics();
    const required = current.bytes + bytes;
    if (this.#entries.size + 1 <= this.#policy.maxEntries && required <= this.#policy.maxBytes && this.#reserveAllows(className, bytes, current)) return true;
    const target = Math.max(this.#policy.reserveCriticalBytes, Math.min(this.#policy.maxBytes - bytes, this.#policy.maxBytes * 0.8));
    this.evict(0, target);
    const refreshed = this.metrics();
    return refreshed.bytes + bytes <= this.#policy.maxBytes && this.#entries.size + 1 <= this.#policy.maxEntries && this.#reserveAllows(className, bytes, refreshed);
  }

  #reserveAllows(className: CacheClass, bytes: number, current: CacheMetrics): boolean {
    if (className === 'critical') return current.bytes + bytes <= this.#policy.maxBytes;
    if (className === 'near') return current.criticalBytes + current.nearBytes + bytes <= this.#policy.reserveNearBytes || current.nearBytes + bytes <= this.#policy.maxBytes * 0.75;
    if (className === 'far') return current.criticalBytes + bytes <= this.#policy.maxBytes * 0.95;
    return current.criticalBytes + current.nearBytes + bytes <= this.#policy.maxBytes;
  }
}

export interface AdmissionRequest { readonly key: string; readonly bytes: number; readonly className: CacheClass; readonly distance: number; readonly priority: number; readonly pinned?: boolean; }
export interface AdmissionDecision { readonly admitted: boolean; readonly score: number; readonly reason: string; }

export const scoreStreamingAdmission = (request: AdmissionRequest): AdmissionDecision => {
  const distancePenalty = Math.min(1, Math.max(0, request.distance / 5000));
  const priorityBoost = Math.min(1, Math.max(0, request.priority / 10));
  const classBoost = classWeight[request.className] / 4;
  const memoryPenalty = Math.min(1, Math.max(0, request.bytes / (256 * 1024 * 1024)));
  const score = Math.max(0, Math.min(1, 0.45 * classBoost + 0.35 * priorityBoost + 0.2 * (1 - distancePenalty) - memoryPenalty * 0.2));
  const admitted = request.pinned === true || request.className === 'critical' || score >= 0.35;
  return Object.freeze({ admitted, score, reason: admitted ? 'admission-threshold' : 'distance-or-budget' });
};
