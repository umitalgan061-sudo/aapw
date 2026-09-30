export type AssetState = 'unknown' | 'queued' | 'loading' | 'ready' | 'stale' | 'failed' | 'disposed';
export type AssetPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

export interface AssetRecord {
  key: string;
  url: string;
  state: AssetState;
  priority: AssetPriority;
  bytes: number;
  references: number;
  version: number;
  createdTick: number;
  lastUsedTick: number;
  failureCount: number;
  error?: string;
}

export interface AssetBudget {
  maxBytes: number;
  maxRecords: number;
  maxConcurrentLoads: number;
  maxRetries: number;
  staleAfterTicks: number;
}

export interface AssetOperation {
  type: 'queue' | 'start' | 'ready' | 'fail' | 'retain' | 'release' | 'evict' | 'dispose';
  key: string;
  tick: number;
  bytes?: number;
  reason?: string;
}

export interface AssetStats {
  total: number;
  loading: number;
  ready: number;
  stale: number;
  failed: number;
  bytes: number;
  referenced: number;
  queue: number;
}

const PRIORITY_WEIGHT: Record<AssetPriority, number> = {
  critical: 1000,
  high: 700,
  normal: 400,
  low: 150,
  background: 25,
};

const DEFAULT_BUDGET: AssetBudget = {
  maxBytes: 512 * 1024 * 1024,
  maxRecords: 8192,
  maxConcurrentLoads: 6,
  maxRetries: 3,
  staleAfterTicks: 3600,
};

export class AssetLifecycleManagerV2 {
  readonly #budget: AssetBudget;
  readonly #assets = new Map<string, AssetRecord>();
  readonly #queue = new Set<string>();
  readonly #operations: AssetOperation[] = [];
  #activeLoads = 0;
  #tick = 0;

  constructor(budget: Partial<AssetBudget> = {}) {
    this.#budget = { ...DEFAULT_BUDGET, ...budget };
    if (this.#budget.maxBytes <= 0 || this.#budget.maxRecords <= 0 || this.#budget.maxConcurrentLoads <= 0) throw new RangeError('Invalid asset budget');
  }

  declare(key: string, url: string, priority: AssetPriority = 'normal'): AssetRecord {
    const normalized = this.#normalizeKey(key);
    const existing = this.#assets.get(normalized);
    if (existing) return { ...existing };
    const record: AssetRecord = {
      key: normalized,
      url: this.#normalizeUrl(url),
      state: 'unknown',
      priority,
      bytes: 0,
      references: 0,
      version: 1,
      createdTick: this.#tick,
      lastUsedTick: this.#tick,
      failureCount: 0,
    };
    this.#assets.set(normalized, record);
    this.#trimRecords();
    return { ...record };
  }

  request(key: string, priority?: AssetPriority): boolean {
    const asset = this.#assets.get(key);
    if (!asset || asset.state === 'disposed') return false;
    if (priority) asset.priority = priority;
    if (asset.state === 'ready' || asset.state === 'loading') return true;
    asset.state = 'queued';
    this.#queue.add(key);
    this.#op('queue', asset);
    return true;
  }

  startNext(tick = this.#tick): AssetRecord | undefined {
    this.#tick = tick;
    if (this.#activeLoads >= this.#budget.maxConcurrentLoads || this.#queue.size === 0) return undefined;
    const candidate = [...this.#queue]
      .map((key) => this.#assets.get(key)!)
      .sort((a, b) => (PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]) || (a.lastUsedTick - b.lastUsedTick) || a.key.localeCompare(b.key))[0];
    if (!candidate) return undefined;
    this.#queue.delete(candidate.key);
    candidate.state = 'loading';
    candidate.lastUsedTick = tick;
    this.#activeLoads += 1;
    this.#op('start', candidate);
    return { ...candidate };
  }

  ready(key: string, bytes: number, tick = this.#tick): AssetRecord | undefined {
    const asset = this.#assets.get(key);
    if (!asset || asset.state === 'disposed') return undefined;
    if (!Number.isInteger(bytes) || bytes < 0) throw new RangeError('Asset byte count must be a non-negative integer');
    this.#activeLoads = Math.max(0, this.#activeLoads - 1);
    asset.bytes = bytes;
    asset.state = 'ready';
    asset.failureCount = 0;
    asset.error = undefined;
    asset.lastUsedTick = tick;
    asset.version += 1;
    this.#op('ready', asset, bytes);
    this.#enforceBudget();
    return { ...asset };
  }

  fail(key: string, reason: string, tick = this.#tick): AssetRecord | undefined {
    const asset = this.#assets.get(key);
    if (!asset || asset.state === 'disposed') return undefined;
    this.#activeLoads = Math.max(0, this.#activeLoads - 1);
    asset.failureCount += 1;
    asset.lastUsedTick = tick;
    asset.error = reason.slice(0, 512);
    if (asset.failureCount <= this.#budget.maxRetries) {
      asset.state = 'queued';
      this.#queue.add(key);
    } else {
      asset.state = 'failed';
    }
    this.#op('fail', asset, 0, reason);
    return { ...asset };
  }

  retain(key: string, tick = this.#tick): boolean {
    const asset = this.#assets.get(key);
    if (!asset || asset.state === 'disposed') return false;
    asset.references += 1;
    asset.lastUsedTick = tick;
    this.#op('retain', asset);
    return true;
  }

  release(key: string, tick = this.#tick): boolean {
    const asset = this.#assets.get(key);
    if (!asset || asset.state === 'disposed') return false;
    asset.references = Math.max(0, asset.references - 1);
    asset.lastUsedTick = tick;
    this.#op('release', asset);
    return true;
  }

  markStale(tick = this.#tick): number {
    this.#tick = tick;
    let count = 0;
    for (const asset of this.#assets.values()) {
      if (asset.state !== 'ready' || asset.references > 0) continue;
      if (tick - asset.lastUsedTick < this.#budget.staleAfterTicks) continue;
      asset.state = 'stale';
      count += 1;
    }
    return count;
  }

  evict(maxBytesToFree: number, tick = this.#tick): AssetRecord[] {
    this.#tick = tick;
    let remaining = Math.max(0, maxBytesToFree);
    const evicted: AssetRecord[] = [];
    const candidates = [...this.#assets.values()]
      .filter((asset) => asset.references === 0 && (asset.state === 'ready' || asset.state === 'stale' || asset.state === 'failed'))
      .sort((a, b) => this.#evictionScore(a) - this.#evictionScore(b));
    for (const asset of candidates) {
      if (remaining <= 0) break;
      remaining -= asset.bytes;
      asset.state = 'disposed';
      this.#assets.delete(asset.key);
      this.#queue.delete(asset.key);
      evicted.push({ ...asset });
      this.#op('evict', asset);
    }
    return evicted;
  }

  get(key: string): AssetRecord | undefined { const asset = this.#assets.get(key); return asset ? { ...asset } : undefined; }
  records(): AssetRecord[] { return [...this.#assets.values()].sort((a, b) => (b.lastUsedTick - a.lastUsedTick) || a.key.localeCompare(b.key)).map((asset) => ({ ...asset })); }

  update(tick: number): AssetStats {
    this.#tick = tick;
    this.markStale(tick);
    this.#enforceBudget();
    return this.stats();
  }

  stats(): AssetStats {
    let loading = 0;
    let ready = 0;
    let stale = 0;
    let failed = 0;
    let bytes = 0;
    let referenced = 0;
    for (const asset of this.#assets.values()) {
      if (asset.state === 'loading') loading += 1;
      if (asset.state === 'ready') ready += 1;
      if (asset.state === 'stale') stale += 1;
      if (asset.state === 'failed') failed += 1;
      bytes += asset.bytes;
      referenced += asset.references;
    }
    return { total: this.#assets.size, loading, ready, stale, failed, bytes, referenced, queue: this.#queue.size };
  }

  operations(): AssetOperation[] { return this.#operations.map((operation) => ({ ...operation })); }

  digest(): number {
    let hash = 2166136261;
    for (const asset of this.records()) {
      const text = `${asset.key}|${asset.url}|${asset.state}|${asset.priority}|${asset.bytes}|${asset.references}|${asset.version}|${asset.failureCount}`;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
    }
    return hash >>> 0;
  }

  #normalizeKey(key: string): string {
    const value = key.trim();
    if (!value || value.length > 256) throw new RangeError('Invalid asset key');
    return value;
  }

  #normalizeUrl(url: string): string {
    const value = url.trim();
    if (!value) throw new RangeError('Asset URL cannot be empty');
    const parsed = new URL(value, 'https://aapw.invalid');
    if (!['http:', 'https:', 'blob:', 'data:'].includes(parsed.protocol)) throw new RangeError('Unsupported asset URL protocol');
    if (parsed.protocol === 'data:' && value.length > 1024) throw new RangeError('Data URL exceeds safety limit');
    return value;
  }

  #evictionScore(asset: AssetRecord): number {
    const age = Math.max(0, this.#tick - asset.lastUsedTick);
    const priority = PRIORITY_WEIGHT[asset.priority];
    const statePenalty = asset.state === 'stale' ? -200 : asset.state === 'failed' ? -100 : 0;
    return priority + statePenalty - age * 0.25 + asset.references * 10000;
  }

  #enforceBudget(): void {
    let bytes = this.stats().bytes;
    if (bytes <= this.#budget.maxBytes && this.#assets.size <= this.#budget.maxRecords) return;
    const candidates = [...this.#assets.values()]
      .filter((asset) => asset.references === 0 && asset.state !== 'loading' && asset.state !== 'queued')
      .sort((a, b) => this.#evictionScore(a) - this.#evictionScore(b));
    for (const asset of candidates) {
      if (bytes <= this.#budget.maxBytes && this.#assets.size <= this.#budget.maxRecords) break;
      bytes -= asset.bytes;
      this.#assets.delete(asset.key);
      this.#op('evict', asset, 0, 'budget');
    }
  }

  #trimRecords(): void {
    if (this.#assets.size <= this.#budget.maxRecords) return;
    this.#enforceBudget();
  }

  #op(type: AssetOperation['type'], asset: AssetRecord, bytes?: number, reason?: string): void {
    this.#operations.push({ type, key: asset.key, tick: this.#tick, bytes, reason });
    if (this.#operations.length > 4096) this.#operations.splice(0, this.#operations.length - 4096);
  }
}
