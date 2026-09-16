/**
 * V6 asset graph and residency controller.
 * Provides typed dependency ordering, cancellation-safe loading, retry backoff,
 * memory accounting and explicit release semantics without owning a loader.
 */

export type AssetId = string & { readonly __brand: 'AssetId' };
export type AssetKind = 'texture' | 'model' | 'audio' | 'shader' | 'data' | 'font' | 'scene';
export type Residency = 'unrequested' | 'queued' | 'loading' | 'resident' | 'failed' | 'released';

export interface AssetDescriptor {
  readonly id: AssetId;
  readonly kind: AssetKind;
  readonly uri: string;
  readonly bytes: number;
  readonly dependencies: readonly AssetId[];
  readonly priority: number;
  readonly tags: readonly string[];
  readonly critical?: boolean;
}

export interface AssetRecord extends AssetDescriptor {
  residency: Residency;
  attempts: number;
  generation: number;
  lastError?: string;
  consumers: number;
}

export interface AssetLoadResult {
  readonly id: AssetId;
  readonly bytesLoaded: number;
  readonly generation: number;
  readonly value: unknown;
}

export interface AssetLoader {
  load(descriptor: AssetDescriptor, signal: AbortSignal): Promise<unknown>;
  release?(descriptor: AssetDescriptor, value: unknown): void;
}

export interface AssetGraphConfig {
  maxResidentBytes: number;
  maxConcurrentLoads: number;
  maxRetries: number;
  retryBaseSeconds: number;
}

export interface AssetBudget {
  readonly maxResidentBytes: number;
  readonly residentBytes: number;
  readonly queuedCount: number;
  readonly loadingCount: number;
  readonly residentCount: number;
}

export interface AssetGraphSnapshot {
  readonly frame: number;
  readonly descriptors: readonly AssetRecord[];
  readonly residentBytes: number;
}

const DEFAULT_CONFIG: AssetGraphConfig = {
  maxResidentBytes: 512 * 1024 * 1024,
  maxConcurrentLoads: 8,
  maxRetries: 2,
  retryBaseSeconds: 0.5,
};

function validateId(value: string): AssetId {
  if (!/^[a-zA-Z0-9._:/-]{1,160}$/.test(value)) throw new TypeError(`invalid asset id: ${value}`);
  return value as AssetId;
}

function validateUri(value: string): string {
  if (value.length === 0 || value.length > 1024) throw new TypeError('invalid asset URI length');
  if (/^(javascript|data):/i.test(value)) throw new TypeError('unsafe asset URI scheme');
  return value;
}

function validateDescriptor(input: AssetDescriptor): AssetDescriptor {
  const id = validateId(input.id);
  const uri = validateUri(input.uri);
  if (!Number.isSafeInteger(input.bytes) || input.bytes < 0) throw new RangeError(`invalid byte size: ${id}`);
  if (!Number.isFinite(input.priority)) throw new RangeError(`invalid priority: ${id}`);
  const tags = [...new Set(input.tags.map((tag) => String(tag).trim()).filter(Boolean))].slice(0, 32);
  const dependencies = [...new Set(input.dependencies)].map(validateId);
  return { ...input, id, uri, bytes: input.bytes, dependencies, tags };
}

interface PendingRequest {
  readonly id: AssetId;
  readonly enqueuedAt: number;
  readonly priority: number;
  readonly generation: number;
}

interface ActiveLoad {
  readonly controller: AbortController;
  readonly promise: Promise<void>;
}

export class AssetGraph {
  readonly #config: AssetGraphConfig;
  readonly #loader: AssetLoader;
  readonly #records = new Map<AssetId, AssetRecord>();
  readonly #values = new Map<AssetId, unknown>();
  readonly #pending = new Map<AssetId, PendingRequest>();
  readonly #active = new Map<AssetId, ActiveLoad>();
  readonly #dependents = new Map<AssetId, Set<AssetId>>();
  #residentBytes = 0;
  #frame = 0;

  constructor(loader: AssetLoader, config: Partial<AssetGraphConfig> = {}) {
    this.#loader = loader;
    const merged = { ...DEFAULT_CONFIG, ...config };
    this.#config = {
      maxResidentBytes: Math.max(1, Math.floor(merged.maxResidentBytes)),
      maxConcurrentLoads: Math.max(1, Math.floor(merged.maxConcurrentLoads)),
      maxRetries: Math.max(0, Math.floor(merged.maxRetries)),
      retryBaseSeconds: Math.max(0.01, merged.retryBaseSeconds),
    };
  }

  register(descriptor: AssetDescriptor): AssetRecord {
    const safe = validateDescriptor(descriptor);
    const existing = this.#records.get(safe.id);
    if (existing) {
      if (existing.uri !== safe.uri || existing.bytes !== safe.bytes || existing.kind !== safe.kind) {
        throw new Error(`asset descriptor conflict: ${safe.id}`);
      }
      return { ...existing, dependencies: [...existing.dependencies], tags: [...existing.tags] };
    }
    const record: AssetRecord = {
      ...safe,
      residency: 'unrequested',
      attempts: 0,
      generation: 1,
      consumers: 0,
    };
    this.#records.set(safe.id, record);
    for (const dependency of safe.dependencies) {
      const owners = this.#dependents.get(dependency) ?? new Set<AssetId>();
      owners.add(safe.id);
      this.#dependents.set(dependency, owners);
    }
    this.#assertNoDependencyCycle(safe.id);
    return { ...record, dependencies: [...record.dependencies], tags: [...record.tags] };
  }

  registerMany(descriptors: readonly AssetDescriptor[]): readonly AssetRecord[] {
    return descriptors.map((descriptor) => this.register(descriptor));
  }

  get(id: AssetId): AssetRecord | undefined {
    const record = this.#records.get(id);
    return record ? { ...record, dependencies: [...record.dependencies], tags: [...record.tags] } : undefined;
  }

  request(id: AssetId, consumerWeight = 1): void {
    const record = this.#records.get(id);
    if (!record) throw new Error(`unknown asset: ${id}`);
    record.consumers = Math.min(0x7fffffff, record.consumers + Math.max(1, Math.floor(consumerWeight)));
    if (record.residency === 'resident' || record.residency === 'loading' || record.residency === 'queued') return;
    record.residency = 'queued';
    this.#pending.set(id, {
      id,
      enqueuedAt: this.#frame,
      priority: record.priority + (record.critical ? 1000 : 0),
      generation: record.generation,
    });
    for (const dependency of record.dependencies) this.request(dependency, 1);
    this.#pump();
  }

  release(id: AssetId, consumerWeight = 1): void {
    const record = this.#records.get(id);
    if (!record) return;
    record.consumers = Math.max(0, record.consumers - Math.max(1, Math.floor(consumerWeight)));
    if (record.consumers === 0 && !record.critical && record.residency === 'resident') this.#evictIfNeeded(true);
  }

  cancel(id: AssetId): boolean {
    const pending = this.#pending.delete(id);
    const active = this.#active.get(id);
    if (active) active.controller.abort();
    const record = this.#records.get(id);
    if (record && (record.residency === 'queued' || record.residency === 'loading')) {
      record.residency = 'released';
      record.generation += 1;
      record.attempts = 0;
    }
    return pending || Boolean(active);
  }

  tick(frame = this.#frame + 1): void {
    this.#frame = Math.max(this.#frame, Math.floor(frame));
    this.#pump();
    this.#evictIfNeeded(false);
  }

  budget(): AssetBudget {
    let queuedCount = 0;
    let loadingCount = 0;
    let residentCount = 0;
    for (const record of this.#records.values()) {
      if (record.residency === 'queued') queuedCount += 1;
      if (record.residency === 'loading') loadingCount += 1;
      if (record.residency === 'resident') residentCount += 1;
    }
    return {
      maxResidentBytes: this.#config.maxResidentBytes,
      residentBytes: this.#residentBytes,
      queuedCount,
      loadingCount,
      residentCount,
    };
  }

  snapshot(): AssetGraphSnapshot {
    const descriptors = [...this.#records.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((record) => ({ ...record, dependencies: [...record.dependencies], tags: [...record.tags] }));
    return { frame: this.#frame, descriptors, residentBytes: this.#residentBytes };
  }

  async preload(ids: readonly AssetId[]): Promise<readonly AssetLoadResult[]> {
    const requested = [...new Set(ids)];
    for (const id of requested) this.request(id);
    const target = new Set<AssetId>();
    for (const id of requested) this.#collectDependencies(id, target);
    await this.#waitFor(target);
    const results: AssetLoadResult[] = [];
    for (const id of [...target].sort()) {
      const record = this.#records.get(id)!;
      if (record.residency !== 'resident') throw new Error(`asset failed to preload: ${id}`);
      results.push({ id, bytesLoaded: record.bytes, generation: record.generation, value: this.#values.get(id) });
    }
    return results;
  }

  value<T>(id: AssetId): T | undefined {
    return this.#values.get(id) as T | undefined;
  }

  manifest(): readonly AssetDescriptor[] {
    return [...this.#records.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ residency: _residency, attempts: _attempts, generation: _generation, lastError: _lastError, consumers: _consumers, ...descriptor }) => ({
        ...descriptor,
        dependencies: [...descriptor.dependencies],
        tags: [...descriptor.tags],
      }));
  }

  retryFailed(): void {
    for (const record of this.#records.values()) {
      if (record.residency !== 'failed') continue;
      if (record.attempts > this.#config.maxRetries) continue;
      record.residency = 'queued';
      this.#pending.set(record.id, {
        id: record.id,
        enqueuedAt: this.#frame + this.#retryDelayFrames(record.attempts),
        priority: record.priority + (record.critical ? 1000 : 0),
        generation: record.generation,
      });
    }
    this.#pump();
  }

  gc(): readonly AssetId[] {
    const released: AssetId[] = [];
    for (const record of this.#records.values()) {
      if (record.residency === 'resident' && record.consumers === 0 && !record.critical) {
        this.#releaseValue(record.id);
        record.residency = 'released';
        record.generation += 1;
        released.push(record.id);
      }
    }
    return released.sort();
  }

  #pump(): void {
    while (this.#active.size < this.#config.maxConcurrentLoads) {
      const next = this.#nextPending();
      if (!next) return;
      this.#beginLoad(next);
    }
  }

  #nextPending(): PendingRequest | undefined {
    const candidates = [...this.#pending.values()].filter((request) => request.enqueuedAt <= this.#frame);
    candidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.enqueuedAt !== b.enqueuedAt) return a.enqueuedAt - b.enqueuedAt;
      return a.id.localeCompare(b.id);
    });
    const request = candidates[0];
    if (request) this.#pending.delete(request.id);
    return request;
  }

  #beginLoad(request: PendingRequest): void {
    const record = this.#records.get(request.id);
    if (!record || record.generation !== request.generation) return;
    record.residency = 'loading';
    const controller = new AbortController();
    const promise = this.#loader.load(record, controller.signal)
      .then((value) => {
        const current = this.#records.get(request.id);
        if (!current || current.generation !== request.generation || controller.signal.aborted) return;
        this.#values.set(request.id, value);
        this.#residentBytes += current.bytes;
        current.residency = 'resident';
        current.lastError = undefined;
        this.#evictIfNeeded(false);
      })
      .catch((error: unknown) => {
        const current = this.#records.get(request.id);
        if (!current || current.generation !== request.generation) return;
        if (controller.signal.aborted) {
          current.residency = 'released';
          return;
        }
        current.attempts += 1;
        current.lastError = error instanceof Error ? error.message : String(error);
        if (current.attempts <= this.#config.maxRetries) {
          current.residency = 'queued';
          this.#pending.set(request.id, {
            id: request.id,
            enqueuedAt: this.#frame + this.#retryDelayFrames(current.attempts),
            priority: current.priority + (current.critical ? 1000 : 0),
            generation: current.generation,
          });
        } else {
          current.residency = 'failed';
        }
      })
      .finally(() => {
        this.#active.delete(request.id);
        this.#pump();
      });
    this.#active.set(request.id, { controller, promise });
  }

  #retryDelayFrames(attempts: number): number {
    const seconds = this.#config.retryBaseSeconds * Math.pow(2, Math.max(0, attempts - 1));
    return Math.max(1, Math.ceil(seconds * 60));
  }

  #evictIfNeeded(force: boolean): void {
    if (!force && this.#residentBytes <= this.#config.maxResidentBytes) return;
    const candidates = [...this.#records.values()]
      .filter((record) => record.residency === 'resident' && record.consumers === 0 && !record.critical)
      .sort((a, b) => {
        const scoreA = a.priority + a.bytes / Math.max(1, this.#frame + 1);
        const scoreB = b.priority + b.bytes / Math.max(1, this.#frame + 1);
        return scoreA - scoreB || a.id.localeCompare(b.id);
      });
    for (const candidate of candidates) {
      if (!force && this.#residentBytes <= this.#config.maxResidentBytes) break;
      this.#releaseValue(candidate.id);
      candidate.residency = 'released';
      candidate.generation += 1;
    }
  }

  #releaseValue(id: AssetId): void {
    const record = this.#records.get(id);
    const value = this.#values.get(id);
    if (!record || value === undefined) return;
    this.#loader.release?.(record, value);
    this.#values.delete(id);
    this.#residentBytes = Math.max(0, this.#residentBytes - record.bytes);
  }

  #collectDependencies(id: AssetId, target: Set<AssetId>): void {
    if (target.has(id)) return;
    const record = this.#records.get(id);
    if (!record) throw new Error(`unknown asset: ${id}`);
    target.add(id);
    for (const dependency of record.dependencies) this.#collectDependencies(dependency, target);
  }

  async #waitFor(ids: ReadonlySet<AssetId>): Promise<void> {
    let guard = 0;
    while (guard < 10_000) {
      guard += 1;
      this.tick(this.#frame + 1);
      let complete = true;
      for (const id of ids) {
        const state = this.#records.get(id)?.residency;
        if (state === 'failed') throw new Error(`asset load failed: ${id}`);
        if (state !== 'resident') complete = false;
      }
      if (complete) return;
      const pendingPromises = [...this.#active.values()].map((active) => active.promise);
      if (pendingPromises.length > 0) await Promise.race(pendingPromises);
      else await Promise.resolve();
    }
    throw new Error('asset preload guard exhausted');
  }

  #assertNoDependencyCycle(start: AssetId): void {
    const visiting = new Set<AssetId>();
    const visited = new Set<AssetId>();
    const visit = (id: AssetId): void => {
      if (visiting.has(id)) throw new Error(`asset dependency cycle at ${id}`);
      if (visited.has(id)) return;
      visiting.add(id);
      const record = this.#records.get(id);
      if (record) for (const dependency of record.dependencies) visit(dependency);
      visiting.delete(id);
      visited.add(id);
    };
    visit(start);
  }
}

export function sortAssetDescriptors(descriptors: readonly AssetDescriptor[]): AssetDescriptor[] {
  return [...descriptors].sort((a, b) => a.id.localeCompare(b.id));
}

export function makeAssetId(value: string): AssetId {
  return validateId(value);
}

export function normalizeAssetManifest(descriptors: readonly AssetDescriptor[]): AssetDescriptor[] {
  const graph = new Map<AssetId, AssetDescriptor>();
  for (const descriptor of descriptors) {
    const safe = validateDescriptor(descriptor);
    graph.set(safe.id, safe);
  }
  return [...graph.values()]
    .map((descriptor) => ({
      ...descriptor,
      dependencies: [...descriptor.dependencies].sort(),
      tags: [...descriptor.tags].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function estimateResidentBytes(descriptors: readonly AssetDescriptor[], ids: readonly AssetId[]): number {
  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  const seen = new Set<AssetId>();
  const visit = (id: AssetId): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const descriptor = byId.get(id);
    if (!descriptor) return 0;
    return descriptor.bytes + descriptor.dependencies.reduce((total, dependency) => total + visit(dependency), 0);
  };
  return ids.reduce((total, id) => total + visit(id), 0);
}
