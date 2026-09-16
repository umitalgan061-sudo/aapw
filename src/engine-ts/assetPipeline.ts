import type { Disposable, Result } from './coreTypes.ts';
import { err, ok } from './coreTypes.ts';

export type AssetKind = 'texture' | 'model' | 'animation' | 'audio' | 'shader' | 'data' | 'wasm';
export type AssetPriority = 0 | 1 | 2 | 3 | 4;
export type AssetResidency = 'cold' | 'warm' | 'resident' | 'evicted' | 'failed';

export interface AssetDescriptor {
  readonly id: string;
  readonly url: string;
  readonly kind: AssetKind;
  readonly bytes: number;
  readonly priority: AssetPriority;
  readonly version: string;
  readonly dependencies?: readonly string[];
  readonly tags?: readonly string[];
  readonly integrity?: string;
  readonly optional?: boolean;
}

export interface AssetRecord {
  readonly descriptor: AssetDescriptor;
  state: AssetResidency;
  lastUsedTick: number;
  useCount: number;
  loadedBytes: number;
  value: unknown;
  error: string | null;
}

export interface AssetFetchResult {
  readonly id: string;
  readonly bytes: number;
  readonly value: unknown;
}

export interface AssetFetcher {
  fetch(descriptor: AssetDescriptor, signal: AbortSignal): Promise<AssetFetchResult>;
}

export interface AssetPipelineBudget {
  readonly maxResidentBytes: number;
  readonly maxConcurrentFetches: number;
  readonly maxQueueLength: number;
  readonly maxPrefetchPerFrame: number;
}

const clampInt = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.trunc(Number.isFinite(value) ? value : min)));
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const positive = (value: number): number => Math.max(0, finite(value));

export class AssetManifestRegistry {
  private readonly descriptors = new Map<string, AssetDescriptor>();

  register(descriptor: AssetDescriptor): Result<void, string> {
    if (!descriptor.id || !descriptor.url) return err('asset id and url are required');
    if (this.descriptors.has(descriptor.id)) return err(`asset already registered: ${descriptor.id}`);
    if (!Number.isFinite(descriptor.bytes) || descriptor.bytes < 0) return err(`invalid byte estimate: ${descriptor.id}`);
    this.descriptors.set(descriptor.id, Object.freeze({ ...descriptor, dependencies: Object.freeze([...(descriptor.dependencies ?? [])]), tags: Object.freeze([...(descriptor.tags ?? [])]) }));
    return ok(undefined);
  }

  replace(descriptor: AssetDescriptor): Result<void, string> {
    if (!descriptor.id || !descriptor.url) return err('asset id and url are required');
    if (!Number.isFinite(descriptor.bytes) || descriptor.bytes < 0) return err(`invalid byte estimate: ${descriptor.id}`);
    this.descriptors.set(descriptor.id, Object.freeze({ ...descriptor, dependencies: Object.freeze([...(descriptor.dependencies ?? [])]), tags: Object.freeze([...(descriptor.tags ?? [])]) }));
    return ok(undefined);
  }

  get(id: string): AssetDescriptor | null { return this.descriptors.get(id) ?? null; }
  has(id: string): boolean { return this.descriptors.has(id); }
  values(): readonly AssetDescriptor[] { return Object.freeze([...this.descriptors.values()]); }
  size(): number { return this.descriptors.size; }

  validateGraph(): readonly string[] {
    const failures: string[] = [];
    for (const descriptor of this.descriptors.values()) {
      for (const dependency of descriptor.dependencies ?? []) if (!this.descriptors.has(dependency)) failures.push(`${descriptor.id}: missing dependency ${dependency}`);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string, path: string[]): void => {
      if (visiting.has(id)) { failures.push(`dependency cycle: ${[...path, id].join(' -> ')}`); return; }
      if (visited.has(id)) return;
      visiting.add(id);
      const descriptor = this.descriptors.get(id);
      for (const dependency of descriptor?.dependencies ?? []) visit(dependency, [...path, id]);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of this.descriptors.keys()) visit(id, []);
    return Object.freeze(failures);
  }
}

interface QueueEntry {
  readonly descriptor: AssetDescriptor;
  readonly requestedAtTick: number;
  readonly sequence: number;
  readonly distance: number;
  cancelled: boolean;
}

export class AssetResidencyStore implements Disposable {
  private readonly records = new Map<string, AssetRecord>();
  private residentBytesValue = 0;
  private disposed = false;

  upsert(descriptor: AssetDescriptor): AssetRecord {
    this.ensureLive();
    const existing = this.records.get(descriptor.id);
    if (existing) return existing;
    const record: AssetRecord = { descriptor, state: 'cold', lastUsedTick: 0, useCount: 0, loadedBytes: 0, value: null, error: null };
    this.records.set(descriptor.id, record);
    return record;
  }

  markWarm(id: string, tick: number): void { const record = this.require(id); if (record.state === 'cold' || record.state === 'evicted') record.state = 'warm'; record.lastUsedTick = Math.max(record.lastUsedTick, tick); }
  markResident(id: string, tick: number, value: unknown, bytes: number): void {
    const record = this.require(id);
    this.residentBytesValue += Math.max(0, bytes - record.loadedBytes);
    record.loadedBytes = Math.max(0, bytes);
    record.state = 'resident';
    record.value = value;
    record.error = null;
    record.lastUsedTick = tick;
    record.useCount += 1;
  }
  markFailed(id: string, message: string): void { const record = this.require(id); record.state = 'failed'; record.error = message; record.value = null; }
  touch(id: string, tick: number): void { const record = this.require(id); record.lastUsedTick = Math.max(record.lastUsedTick, tick); record.useCount += 1; }
  get(id: string): AssetRecord | null { return this.records.get(id) ?? null; }
  values(): readonly AssetRecord[] { return Object.freeze([...this.records.values()]); }
  residentBytes(): number { return this.residentBytesValue; }
  residentCount(): number { return [...this.records.values()].filter(record => record.state === 'resident').length; }

  evict(id: string): boolean {
    const record = this.records.get(id);
    if (!record || record.state !== 'resident') return false;
    this.residentBytesValue = Math.max(0, this.residentBytesValue - record.loadedBytes);
    record.state = 'evicted';
    record.value = null;
    record.loadedBytes = 0;
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.records.clear();
    this.residentBytesValue = 0;
  }

  private require(id: string): AssetRecord { const record = this.records.get(id); if (!record) throw new Error(`unknown asset ${id}`); return record; }
  private ensureLive(): void { if (this.disposed) throw new Error('asset residency store disposed'); }
}

export interface ResidencyDecision {
  readonly evictIds: readonly string[];
  readonly residentBytes: number;
  readonly protectedIds: readonly string[];
}

export const planResidency = (records: readonly AssetRecord[], budgetBytes: number, protectedIds: ReadonlySet<string> = new Set()): ResidencyDecision => {
  const cap = Math.max(0, finite(budgetBytes));
  const residents = records.filter(record => record.state === 'resident').map(record => ({ record, protected: protectedIds.has(record.descriptor.id) }));
  let bytes = residents.reduce((sum, item) => sum + positive(item.record.loadedBytes), 0);
  const candidates = residents.filter(item => !item.protected).sort((left, right) => {
    const score = (item: { record: AssetRecord }): number => positive(item.record.lastUsedTick) * 100 + positive(item.record.useCount) * 10 + item.record.descriptor.priority * 1000;
    return score(left) - score(right) || left.record.descriptor.id.localeCompare(right.record.descriptor.id);
  });
  const evictIds: string[] = [];
  for (const item of candidates) {
    if (bytes <= cap) break;
    bytes -= positive(item.record.loadedBytes);
    evictIds.push(item.record.descriptor.id);
  }
  return Object.freeze({ evictIds: Object.freeze(evictIds), residentBytes: Math.max(0, bytes), protectedIds: Object.freeze([...protectedIds]) });
};

export interface AssetRequestOptions { readonly tick: number; readonly distance?: number; readonly priorityBoost?: number; readonly signal?: AbortSignal; }

export class ModernAssetPipeline implements Disposable {
  readonly manifest = new AssetManifestRegistry();
  readonly residency = new AssetResidencyStore();
  private readonly queue: QueueEntry[] = [];
  private readonly inflight = new Map<string, Promise<AssetFetchResult>>();
  private readonly controllers = new Map<string, AbortController>();
  private sequence = 0;
  private disposed = false;
  private readonly fetcher: AssetFetcher;
  private readonly budget: AssetPipelineBudget;

  constructor(fetcher: AssetFetcher, budget: Partial<AssetPipelineBudget> = {}) {
    this.fetcher = fetcher;
    this.budget = Object.freeze({
      maxResidentBytes: Math.max(8 * 1024 * 1024, finite(budget.maxResidentBytes, 384 * 1024 * 1024)),
      maxConcurrentFetches: clampInt(budget.maxConcurrentFetches ?? 6, 1, 32),
      maxQueueLength: clampInt(budget.maxQueueLength ?? 2048, 16, 16384),
      maxPrefetchPerFrame: clampInt(budget.maxPrefetchPerFrame ?? 8, 1, 64),
    });
  }

  register(descriptor: AssetDescriptor): Result<void, string> {
    this.ensureLive();
    const result = this.manifest.register(descriptor);
    if (result.ok) this.residency.upsert(descriptor);
    return result;
  }

  request(id: string, options: AssetRequestOptions): Result<Promise<AssetFetchResult>, string> {
    this.ensureLive();
    const descriptor = this.manifest.get(id);
    if (!descriptor) return err(`asset not registered: ${id}`);
    const resident = this.residency.get(id);
    if (resident?.state === 'resident') { this.residency.touch(id, options.tick); return ok(Promise.resolve({ id, bytes: resident.loadedBytes, value: resident.value })); }
    const inflight = this.inflight.get(id);
    if (inflight) return ok(inflight);
    if (this.queue.length >= this.budget.maxQueueLength) return err('asset request queue is full');
    const entry: QueueEntry = { descriptor, requestedAtTick: options.tick, sequence: this.sequence++, distance: positive(options.distance ?? Number.POSITIVE_INFINITY), cancelled: false };
    this.queue.push(entry);
    this.sortQueue(options.priorityBoost ?? 0);
    const promise = this.pump(options.signal);
    this.inflight.set(id, promise.then(() => {
      const latest = this.residency.get(id);
      return { id, bytes: latest?.loadedBytes ?? 0, value: latest?.value ?? null };
    }).finally(() => { this.inflight.delete(id); }));
    return ok(this.inflight.get(id)!);
  }

  cancel(id: string): boolean {
    let changed = false;
    for (const entry of this.queue) if (entry.descriptor.id === id) { entry.cancelled = true; changed = true; }
    const controller = this.controllers.get(id);
    if (controller) { controller.abort(); changed = true; }
    return changed;
  }

  async flush(tick: number): Promise<readonly AssetFetchResult[]> {
    this.ensureLive();
    const outputs: AssetFetchResult[] = [];
    while (this.queue.length > 0 || this.inflight.size > 0) {
      const start = this.inflight.size;
      await this.pump();
      if (start === 0 && this.queue.length > 0) await Promise.resolve();
      for (const record of this.residency.values()) if (record.state === 'resident' && record.lastUsedTick === tick) outputs.push({ id: record.descriptor.id, bytes: record.loadedBytes, value: record.value });
      if (this.inflight.size === 0 && this.queue.every(entry => entry.cancelled)) this.queue.length = 0;
    }
    return Object.freeze(outputs);
  }

  prefetch(ids: readonly string[], tick: number): readonly string[] {
    this.ensureLive();
    const accepted: string[] = [];
    for (const id of ids.slice(0, this.budget.maxPrefetchPerFrame)) {
      const result = this.request(id, { tick, distance: Number.POSITIVE_INFINITY });
      if (result.ok) accepted.push(id);
    }
    return Object.freeze(accepted);
  }

  enforceResidency(protectedIds: ReadonlySet<string>): ResidencyDecision {
    const plan = planResidency(this.residency.values(), this.budget.maxResidentBytes, protectedIds);
    for (const id of plan.evictIds) this.residency.evict(id);
    return plan;
  }

  stats(): Readonly<{ registered: number; queued: number; inflight: number; resident: number; residentBytes: number }> {
    return Object.freeze({ registered: this.manifest.size(), queued: this.queue.filter(entry => !entry.cancelled).length, inflight: this.inflight.size, resident: this.residency.residentCount(), residentBytes: this.residency.residentBytes() });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.queue.length = 0;
    this.inflight.clear();
    this.residency.dispose();
  }

  private async pump(signal?: AbortSignal): Promise<readonly AssetFetchResult[]> {
    const outputs: AssetFetchResult[] = [];
    while (this.inflight.size < this.budget.maxConcurrentFetches) {
      const entry = this.queue.find(candidate => !candidate.cancelled && !this.inflight.has(candidate.descriptor.id));
      if (!entry) break;
      entry.cancelled = false;
      const descriptor = entry.descriptor;
      const controller = new AbortController();
      this.controllers.set(descriptor.id, controller);
      if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
      this.residency.markWarm(descriptor.id, entry.requestedAtTick);
      const task = this.fetcher.fetch(descriptor, controller.signal).then(result => {
        this.residency.markResident(descriptor.id, entry.requestedAtTick, result.value, result.bytes);
        outputs.push(result);
        return result;
      }).catch(cause => {
        this.residency.markFailed(descriptor.id, cause instanceof Error ? cause.message : 'asset fetch failed');
        throw cause;
      }).finally(() => this.controllers.delete(descriptor.id));
      this.inflight.set(descriptor.id, task);
      void task.catch(() => undefined);
      this.queue.splice(this.queue.indexOf(entry), 1);
    }
    return Object.freeze(outputs);
  }

  private sortQueue(priorityBoost: number): void {
    this.queue.sort((left, right) => {
      const leftScore = left.descriptor.priority * 1000 + priorityBoost + 1 / Math.max(1, left.distance);
      const rightScore = right.descriptor.priority * 1000 + priorityBoost + 1 / Math.max(1, right.distance);
      return rightScore - leftScore || left.requestedAtTick - right.requestedAtTick || left.sequence - right.sequence || left.descriptor.id.localeCompare(right.descriptor.id);
    });
  }

  private ensureLive(): void { if (this.disposed) throw new Error('asset pipeline disposed'); }
}

export interface AssetGraphPrefetchInput { readonly roots: readonly string[]; readonly maxDepth?: number; readonly maxAssets?: number; }

export const buildDependencyPrefetchPlan = (manifest: AssetManifestRegistry, input: AssetGraphPrefetchInput): readonly string[] => {
  const maxDepth = clampInt(input.maxDepth ?? 8, 0, 32);
  const maxAssets = clampInt(input.maxAssets ?? 128, 1, 4096);
  const seen = new Set<string>();
  const output: string[] = [];
  const visit = (id: string, depth: number): void => {
    if (depth > maxDepth || seen.has(id) || output.length >= maxAssets) return;
    const descriptor = manifest.get(id);
    if (!descriptor) return;
    seen.add(id);
    for (const dependency of descriptor.dependencies ?? []) visit(dependency, depth + 1);
    output.push(id);
  };
  for (const root of input.roots) visit(root, 0);
  return Object.freeze(output);
};
