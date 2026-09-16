import { checksumV5, type AssetDescriptorV5, type AssetStateV5, type OutcomeV5, okV5, failV5 } from './runtimeContractV5';

export interface AssetGraphOptionsV5 {
  readonly maxNodes?: number;
  readonly maxDependencies?: number;
  readonly maxConcurrent?: number;
  readonly maxBytesInFlight?: number;
}
export interface AssetLoadRequestV5 { readonly id: string; readonly priority: number; readonly deadlineTick?: number; }
export interface AssetGraphMetricsV5 { readonly declared: number; readonly ready: number; readonly failed: number; readonly queued: number; readonly bytesInFlight: number; readonly cacheHits: number; readonly cacheMisses: number; }

const states = new Set<AssetStateV5['status']>(['declared', 'queued', 'loading', 'ready', 'failed', 'evicted']);

export class AssetDependencyGraphV5 {
  readonly maxNodes: number;
  readonly maxDependencies: number;
  readonly maxConcurrent: number;
  readonly maxBytesInFlight: number;
  #descriptors = new Map<string, AssetDescriptorV5>();
  #states = new Map<string, AssetStateV5>();
  #queue: AssetLoadRequestV5[] = [];
  #inFlight = new Set<string>();
  #bytesInFlight = 0;
  #cache = new Set<string>();
  #hits = 0;
  #misses = 0;

  constructor(options: AssetGraphOptionsV5 = {}) {
    this.maxNodes = Math.max(1, Math.min(100_000, Math.floor(options.maxNodes ?? 20_000)));
    this.maxDependencies = Math.max(1, Math.min(512, Math.floor(options.maxDependencies ?? 64)));
    this.maxConcurrent = Math.max(1, Math.min(128, Math.floor(options.maxConcurrent ?? 8)));
    this.maxBytesInFlight = Math.max(1, options.maxBytesInFlight ?? 128 * 1024 * 1024);
  }

  declare(descriptor: AssetDescriptorV5): OutcomeV5<void> {
    if (!descriptor.id || descriptor.id.length > 256) return failV5('ASSET_ID', 'Invalid asset id');
    if (this.#descriptors.size >= this.maxNodes && !this.#descriptors.has(descriptor.id)) return failV5('ASSET_LIMIT', 'Asset graph node limit reached');
    if (!Number.isFinite(descriptor.bytes) || descriptor.bytes < 0) return failV5('ASSET_BYTES', 'Invalid asset byte count');
    if (descriptor.dependencies.length > this.maxDependencies) return failV5('ASSET_DEPS', 'Too many asset dependencies');
    if (descriptor.dependencies.includes(descriptor.id)) return failV5('ASSET_CYCLE', 'Asset cannot depend on itself');
    const normalized = Object.freeze({ ...descriptor, dependencies: Object.freeze([...new Set(descriptor.dependencies)].sort()) });
    this.#descriptors.set(descriptor.id, normalized);
    this.#states.set(descriptor.id, Object.freeze({ id: descriptor.id, status: 'declared', bytes: descriptor.bytes, attempts: 0, priority: descriptor.required ? 100 : 10 }));
    return okV5(undefined);
  }

  has(id: string): boolean { return this.#descriptors.has(id); }
  descriptor(id: string): AssetDescriptorV5 | null { return this.#descriptors.get(id) ?? null; }
  state(id: string): AssetStateV5 | null { return this.#states.get(id) ?? null; }

  enqueue(request: AssetLoadRequestV5): OutcomeV5<void> {
    const descriptor = this.#descriptors.get(request.id);
    if (!descriptor) return failV5('ASSET_NOT_FOUND', `Unknown asset: ${request.id}`);
    const state = this.#states.get(request.id)!;
    if (state.status === 'ready' || this.#inFlight.has(request.id)) return okV5(undefined);
    this.#queue = this.#queue.filter((item) => item.id !== request.id);
    this.#queue.push(Object.freeze({ id: request.id, priority: Math.max(-1000, Math.min(1000, Math.floor(request.priority))), deadlineTick: request.deadlineTick }));
    this.#states.set(request.id, Object.freeze({ ...state, status: 'queued', priority: request.priority }));
    this.#sortQueue();
    return okV5(undefined);
  }

  expandDependencies(id: string, basePriority = 0): OutcomeV5<readonly string[]> {
    const root = this.#descriptors.get(id);
    if (!root) return failV5('ASSET_NOT_FOUND', `Unknown asset: ${id}`);
    const ordered: string[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (nodeId: string, depth: number): boolean => {
      if (depth > this.maxDependencies) return false;
      if (visiting.has(nodeId)) return false;
      if (visited.has(nodeId)) return true;
      const node = this.#descriptors.get(nodeId);
      if (!node) return false;
      visiting.add(nodeId);
      const dependencies = [...node.dependencies].sort();
      for (const dependency of dependencies) if (!visit(dependency, depth + 1)) return false;
      visiting.delete(nodeId);
      visited.add(nodeId);
      if (nodeId !== id) { ordered.push(nodeId); this.enqueue({ id: nodeId, priority: basePriority + (node.required ? 100 : 0) }); }
      return true;
    };
    if (!visit(id, 0)) return failV5('ASSET_GRAPH', 'Dependency graph is cyclic, missing or too deep');
    return okV5(Object.freeze(ordered));
  }

  acquireNext(): OutcomeV5<AssetLoadRequestV5 | null> {
    this.#sortQueue();
    while (this.#queue.length > 0) {
      if (this.#inFlight.size >= this.maxConcurrent) return okV5(null);
      const request = this.#queue.shift()!;
      const descriptor = this.#descriptors.get(request.id);
      const state = this.#states.get(request.id);
      if (!descriptor || !state || state.status === 'ready') continue;
      if (this.#bytesInFlight + descriptor.bytes > this.maxBytesInFlight) { this.#queue.unshift(request); return okV5(null); }
      this.#inFlight.add(request.id);
      this.#bytesInFlight += descriptor.bytes;
      this.#states.set(request.id, Object.freeze({ ...state, status: 'loading', attempts: state.attempts + 1 }));
      return okV5(request);
    }
    return okV5(null);
  }

  complete(id: string, digest: string, cached = false): OutcomeV5<void> {
    const descriptor = this.#descriptors.get(id);
    if (!descriptor) return failV5('ASSET_NOT_FOUND', 'Unknown asset');
    if (!/^[a-f0-9]{8,128}$/i.test(digest) || descriptor.digest !== digest) return this.#fail(id, 'ASSET_DIGEST', 'Asset integrity digest mismatch');
    this.#releaseInFlight(id);
    this.#states.set(id, Object.freeze({ ...this.#states.get(id)!, status: 'ready' }));
    const key = checksumV5({ id, version: descriptor.version, digest });
    if (cached) this.#hits += 1; else this.#misses += 1;
    this.#cache.add(key);
    return okV5(undefined);
  }

  fail(id: string): OutcomeV5<void> { return this.#fail(id, 'ASSET_LOAD', 'Asset load failed'); }
  evict(id: string): boolean {
    const state = this.#states.get(id);
    if (!state || state.status !== 'ready') return false;
    this.#states.set(id, Object.freeze({ ...state, status: 'evicted' }));
    return true;
  }

  metrics(): AssetGraphMetricsV5 {
    let ready = 0; let failed = 0; let queued = 0;
    for (const state of this.#states.values()) { if (state.status === 'ready') ready += 1; if (state.status === 'failed') failed += 1; if (state.status === 'queued') queued += 1; }
    return Object.freeze({ declared: this.#descriptors.size, ready, failed, queued, bytesInFlight: this.#bytesInFlight, cacheHits: this.#hits, cacheMisses: this.#misses });
  }

  ids(): readonly string[] { return Object.freeze([...this.#descriptors.keys()].sort()); }
  clear(): void { this.#descriptors.clear(); this.#states.clear(); this.#queue.length = 0; this.#inFlight.clear(); this.#bytesInFlight = 0; this.#cache.clear(); }
  #sortQueue(): void { this.#queue.sort((a, b) => (b.priority - a.priority) || ((a.deadlineTick ?? Number.MAX_SAFE_INTEGER) - (b.deadlineTick ?? Number.MAX_SAFE_INTEGER)) || a.id.localeCompare(b.id)); }
  #releaseInFlight(id: string): void { if (!this.#inFlight.delete(id)) return; const descriptor = this.#descriptors.get(id); this.#bytesInFlight = Math.max(0, this.#bytesInFlight - (descriptor?.bytes ?? 0)); }
  #fail(id: string, code: string, message: string): OutcomeV5<void> { this.#releaseInFlight(id); const state = this.#states.get(id); if (state) this.#states.set(id, Object.freeze({ ...state, status: 'failed' })); return failV5(code, message); }
}

export function validateAssetGraphV5(graph: AssetDependencyGraphV5): readonly string[] {
  const errors: string[] = [];
  for (const id of graph.ids()) {
    const descriptor = graph.descriptor(id);
    if (!descriptor) { errors.push(`missing:${id}`); continue; }
    for (const dependency of descriptor.dependencies) if (!graph.has(dependency)) errors.push(`dependency:${id}->${dependency}`);
  }
  return Object.freeze(errors.sort());
}
