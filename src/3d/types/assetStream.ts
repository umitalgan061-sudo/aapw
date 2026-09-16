import type { AssetDescriptor, AssetId, AssetProvider, Residency } from './platform.js';

export type StreamPriority = 'critical' | 'visible' | 'nearby' | 'background' | 'prefetch';
export type StreamState = 'queued' | 'loading' | 'resident' | 'failed' | 'cancelled';

export interface StreamRequest<T = unknown> {
  readonly id: string;
  readonly asset: AssetDescriptor;
  readonly priority: StreamPriority;
  readonly expectedBytes: number;
  readonly deadlineTick?: number;
  readonly maxRetries: number;
  readonly decode: (value: unknown) => Promise<T> | T;
}

export interface StreamRecord<T = unknown> {
  readonly request: StreamRequest<T>;
  readonly state: StreamState;
  readonly attempts: number;
  readonly queuedAt: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly bytesTransferred: number;
  readonly result?: T;
  readonly error?: unknown;
}

export interface StreamBudget {
  readonly maxConcurrent: number;
  readonly maxBytesPerFrame: number;
  readonly maxRetriesPerFrame: number;
}

export interface StreamMetrics {
  readonly queued: number;
  readonly loading: number;
  readonly resident: number;
  readonly failed: number;
  readonly bytesThisFrame: number;
  readonly averageLatencyMs: number;
}

const weight: Record<StreamPriority, number> = { critical: 5, visible: 4, nearby: 3, background: 2, prefetch: 1 };

export class AssetStreamScheduler {
  readonly #budget: StreamBudget;
  readonly #provider: AssetProvider;
  readonly #records = new Map<string, StreamRecord>();
  readonly #queue: string[] = [];
  #active = 0;
  #frameBytes = 0;
  #frameRetries = 0;
  #latencyTotal = 0;
  #completed = 0;

  constructor(provider: AssetProvider, budget: StreamBudget) {
    this.#provider = provider;
    this.#budget = Object.freeze({ ...budget });
  }

  enqueue<T>(request: StreamRequest<T>): boolean {
    if (!request.id.trim() || this.#records.has(request.id)) return false;
    if (!Number.isFinite(request.expectedBytes) || request.expectedBytes < 0) return false;
    const now = performance.now();
    this.#records.set(request.id, { request, state: 'queued', attempts: 0, queuedAt: now, bytesTransferred: 0 });
    this.#queue.push(request.id);
    this.#sort();
    this.#pump();
    return true;
  }

  #sort(): void {
    this.#queue.sort((a, b) => {
      const left = this.#records.get(a)?.request;
      const right = this.#records.get(b)?.request;
      if (!left || !right) return 0;
      return weight[right.priority] - weight[left.priority] || (left.deadlineTick ?? Number.MAX_SAFE_INTEGER) - (right.deadlineTick ?? Number.MAX_SAFE_INTEGER) || a.localeCompare(b);
    });
  }

  #pump(): void {
    while (this.#active < this.#budget.maxConcurrent && this.#queue.length > 0) {
      const id = this.#queue.shift();
      if (!id) continue;
      void this.#run(id);
    }
  }

  async #run(id: string): Promise<void> {
    const record = this.#records.get(id);
    if (!record || record.state !== 'queued') return;
    const startedAt = performance.now();
    this.#records.set(id, { ...record, state: 'loading', startedAt, attempts: record.attempts + 1 });
    this.#active += 1;
    try {
      if (this.#provider.has(record.request.asset.id)) {
        this.#records.set(id, { ...record, state: 'resident', startedAt, completedAt: performance.now(), attempts: record.attempts, bytesTransferred: 0 });
        return;
      }
      const raw = await this.#provider.load({ asset: record.request.asset, priority: weight[record.request.priority] });
      const result = await record.request.decode(raw);
      const completedAt = performance.now();
      const bytes = Math.max(0, record.request.expectedBytes);
      this.#frameBytes += bytes;
      this.#latencyTotal += completedAt - startedAt;
      this.#completed += 1;
      this.#records.set(id, { ...record, state: 'resident', startedAt, completedAt, attempts: record.attempts + 1, bytesTransferred: bytes, result });
    } catch (error) {
      this.#frameRetries += 1;
      if (record.attempts < record.request.maxRetries && this.#frameRetries <= this.#budget.maxRetriesPerFrame) {
        this.#records.set(id, { ...record, state: 'queued', attempts: record.attempts + 1, bytesTransferred: 0, error });
        this.#queue.push(id);
        this.#sort();
      } else {
        this.#records.set(id, { ...record, state: 'failed', attempts: record.attempts + 1, completedAt: performance.now(), error });
      }
    } finally {
      this.#active -= 1;
      this.#pump();
    }
  }

  beginFrame(): void { this.#frameBytes = 0; this.#frameRetries = 0; }

  cancel(id: string): boolean {
    const record = this.#records.get(id);
    if (!record || record.state !== 'queued') return false;
    const index = this.#queue.indexOf(id);
    if (index >= 0) this.#queue.splice(index, 1);
    this.#records.set(id, { ...record, state: 'cancelled', completedAt: performance.now() });
    return true;
  }

  reprioritize(id: string, priority: StreamPriority): boolean {
    const record = this.#records.get(id);
    if (!record || record.state !== 'queued') return false;
    this.#records.set(id, { ...record, request: { ...record.request, priority } });
    this.#sort();
    return true;
  }

  get(id: string): StreamRecord | undefined { return this.#records.get(id); }
  list(): readonly StreamRecord[] { return [...this.#records.values()]; }

  metrics(): StreamMetrics {
    let queued = 0; let loading = 0; let resident = 0; let failed = 0;
    for (const record of this.#records.values()) {
      if (record.state === 'queued') queued += 1;
      else if (record.state === 'loading') loading += 1;
      else if (record.state === 'resident') resident += 1;
      else if (record.state === 'failed') failed += 1;
    }
    return { queued, loading, resident, failed, bytesThisFrame: this.#frameBytes, averageLatencyMs: this.#completed === 0 ? 0 : this.#latencyTotal / this.#completed };
  }

  residency(assetId: AssetId): Residency {
    for (const record of this.#records.values()) if (record.request.asset.id === assetId) {
      if (record.state === 'resident') return 'resident';
      if (record.state === 'loading') return 'loading';
      if (record.state === 'queued') return 'queued';
      if (record.state === 'failed') return 'stale';
    }
    return 'cold';
  }

  dispose(): void { this.#queue.length = 0; this.#records.clear(); this.#active = 0; }
}
