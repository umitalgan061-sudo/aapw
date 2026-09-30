import { ResourceDescriptor, ResourceState, Revision, Tick, hashString, revisionValue, tickValue } from './types.ts';

export interface ResourceLoader<T> {
  load: (descriptor: ResourceDescriptor, signal: AbortSignal) => Promise<T>;
  dispose?: (value: T) => void;
}

interface ResourceEntry<T> {
  state: ResourceState;
  value?: T;
  promise?: Promise<T>;
  controller?: AbortController;
  failures: number;
}

export interface ResourceCacheConfig {
  maxBytes: number;
  maxEntries: number;
  retryLimit: number;
  retryBackoffTicks: number;
}

const DEFAULT_CONFIG: ResourceCacheConfig = {
  maxBytes: 128 * 1024 * 1024,
  maxEntries: 1024,
  retryLimit: 2,
  retryBackoffTicks: 30,
};

export interface CacheMetrics {
  entries: number;
  ready: number;
  loading: number;
  failed: number;
  evicted: number;
  bytes: number;
  capacityBytes: number;
}

export class BudgetedResourceCache<T> {
  readonly #config: ResourceCacheConfig;
  readonly #loader: ResourceLoader<T>;
  readonly #entries = new Map<string, ResourceEntry<T>>();
  #tick: Tick = tickValue(0);
  #bytes = 0;
  #revision: Revision = revisionValue(0);
  #evicted = 0;

  constructor(loader: ResourceLoader<T>, config: Partial<ResourceCacheConfig> = {}) {
    this.#loader = loader;
    this.#config = { ...DEFAULT_CONFIG, ...config };
    if (this.#config.maxBytes <= 0) throw new RangeError('maxBytes must be positive');
    if (this.#config.maxEntries < 1) throw new RangeError('maxEntries must be positive');
  }

  get tick(): Tick { return this.#tick; }
  get revision(): Revision { return this.#revision; }

  advanceTick(tick: Tick): void {
    if (tick < this.#tick) throw new Error('Resource cache tick cannot move backwards');
    this.#tick = tick;
    for (const entry of this.#entries.values()) {
      if (entry.state.state === 'failed' && entry.failures <= this.#config.retryLimit) entry.state = { ...entry.state, state: 'queued' };
    }
  }

  async acquire(descriptor: ResourceDescriptor): Promise<T> {
    validateDescriptor(descriptor);
    let entry = this.#entries.get(descriptor.key) as ResourceEntry<T> | undefined;
    if (entry?.value !== undefined && entry.state.state === 'ready') {
      entry.state = { ...entry.state, lastUsedTick: this.#tick };
      return entry.value;
    }
    if (entry?.promise) return entry.promise;
    if (entry && entry.failures > this.#config.retryLimit) throw new Error(entry.state.error ?? `Resource permanently failed: ${descriptor.key}`);
    entry ??= this.#createEntry(descriptor);
    this.#entries.set(descriptor.key, entry);
    entry.state = { ...entry.state, state: 'loading', lastUsedTick: this.#tick };
    const controller = new AbortController();
    entry.controller = controller;
    entry.promise = this.#loader.load(descriptor, controller.signal)
      .then((value) => {
        entry!.value = value;
        entry!.state = { ...entry!.state, state: 'ready', bytes: descriptor.bytes, revision: revisionValue(entry!.state.revision + 1), lastUsedTick: this.#tick };
        this.#bytes += descriptor.bytes;
        this.#revision = revisionValue(this.#revision + 1);
        this.#fitBudget(descriptor.key);
        return value;
      })
      .catch((error: unknown) => {
        entry!.failures += 1;
        entry!.state = { ...entry!.state, state: 'failed', error: error instanceof Error ? error.message : String(error), revision: revisionValue(entry!.state.revision + 1) };
        throw error;
      })
      .finally(() => {
        entry!.promise = undefined;
        entry!.controller = undefined;
      });
    return entry.promise;
  }

  has(key: string): boolean {
    return this.#entries.get(key)?.state.state === 'ready';
  }

  get(key: string): T | undefined {
    const entry = this.#entries.get(key);
    if (!entry || entry.state.state !== 'ready') return undefined;
    entry.state = { ...entry.state, lastUsedTick: this.#tick };
    return entry.value;
  }

  release(key: string): boolean {
    const entry = this.#entries.get(key);
    if (!entry) return false;
    entry.state = { ...entry.state, priority: Math.max(-1000, entry.state.priority - 1) };
    return true;
  }

  abort(key: string): boolean {
    const entry = this.#entries.get(key);
    if (!entry?.controller) return false;
    entry.controller.abort();
    return true;
  }

  evict(key: string): boolean {
    const entry = this.#entries.get(key);
    if (!entry || !entry.state.evictable || entry.promise) return false;
    if (entry.value !== undefined) this.#loader.dispose?.(entry.value);
    if (entry.state.state === 'ready') this.#bytes -= entry.state.bytes;
    this.#entries.delete(key);
    this.#evicted += 1;
    this.#revision = revisionValue(this.#revision + 1);
    return true;
  }

  metrics(): CacheMetrics {
    let ready = 0;
    let loading = 0;
    let failed = 0;
    for (const entry of this.#entries.values()) {
      if (entry.state.state === 'ready') ready += 1;
      if (entry.state.state === 'loading') loading += 1;
      if (entry.state.state === 'failed') failed += 1;
    }
    return { entries: this.#entries.size, ready, loading, failed, evicted: this.#evicted, bytes: Math.max(0, this.#bytes), capacityBytes: this.#config.maxBytes };
  }

  describe(): ResourceState[] {
    return [...this.#entries.values()].map((entry) => ({ ...entry.state })).sort((a, b) => a.key.localeCompare(b.key));
  }

  clear(): void {
    for (const entry of this.#entries.values()) {
      entry.controller?.abort();
      if (entry.value !== undefined) this.#loader.dispose?.(entry.value);
    }
    this.#entries.clear();
    this.#bytes = 0;
    this.#revision = revisionValue(this.#revision + 1);
  }

  #createEntry(descriptor: ResourceDescriptor): ResourceEntry<T> {
    return {
      state: {
        ...descriptor,
        state: 'queued',
        lastUsedTick: this.#tick,
        revision: revisionValue(0),
      },
      failures: 0,
    };
  }

  #fitBudget(protectedKey: string): void {
    while (this.#bytes > this.#config.maxBytes || this.#entries.size > this.#config.maxEntries) {
      const candidates = [...this.#entries.entries()]
        .filter(([key, entry]) => key !== protectedKey && entry.state.evictable && entry.state.state === 'ready' && !entry.promise)
        .sort(([, a], [, b]) => evictionScore(a.state, this.#tick) - evictionScore(b.state, this.#tick));
      const candidate = candidates[0];
      if (!candidate) break;
      this.evict(candidate[0]);
    }
  }
}

function validateDescriptor(descriptor: ResourceDescriptor): void {
  if (!descriptor.key.trim()) throw new Error('Resource key is required');
  if (!Number.isFinite(descriptor.bytes) || descriptor.bytes < 0) throw new RangeError(`Invalid byte size for ${descriptor.key}`);
  if (!Number.isFinite(descriptor.cost) || descriptor.cost < 0) throw new RangeError(`Invalid resource cost for ${descriptor.key}`);
}

function evictionScore(state: ResourceState, now: Tick): number {
  const age = Math.max(0, Number(now) - Number(state.lastUsedTick));
  const priority = state.priority * 100;
  const cost = state.cost * 10;
  const critical = state.tags.includes('critical') ? 100000 : 0;
  return age - priority - cost + critical;
}

export function resourceKey(namespace: string, name: string, variant = 'default'): string {
  return `${namespace}:${name}:${variant}`;
}

export function resourceDescriptor(namespace: string, name: string, bytes: number, options: Partial<ResourceDescriptor> = {}): ResourceDescriptor {
  const key = resourceKey(namespace, name, String(options.tags?.join('.') ?? 'default'));
  return {
    key,
    bytes,
    cost: options.cost ?? Math.max(1, bytes / 1024),
    tags: options.tags ?? [],
    priority: options.priority ?? 0,
    evictable: options.evictable ?? true,
  };
}

export function cacheDigest<T>(cache: BudgetedResourceCache<T>): number {
  return hashString(JSON.stringify(cache.describe()));
}
