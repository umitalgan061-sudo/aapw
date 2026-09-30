export type AssetStateR26 =
  | 'declared'
  | 'queued'
  | 'loading'
  | 'ready'
  | 'stale'
  | 'failed'
  | 'cancelled';

export type AssetPriorityR26 =
  | 'critical'
  | 'high'
  | 'normal'
  | 'low'
  | 'background';

export interface AssetSpecR26 {
  readonly id: string;
  readonly url: string;
  readonly kind: string;
  readonly dependencies: readonly string[];
  readonly priority: AssetPriorityR26;
  readonly estimatedBytes: number;
  readonly optional: boolean;
  readonly tags: readonly string[];
}

export interface AssetRecordR26 extends AssetSpecR26 {
  readonly state: AssetStateR26;
  readonly attempts: number;
  readonly residentBytes: number;
  readonly lastAccessFrame: number;
  readonly revision: number;
  readonly error: string | null;
}

export interface AssetLoadContextR26 {
  readonly signal: AbortSignal;
  readonly attempt: number;
  readonly priority: AssetPriorityR26;
}

export interface AssetLoadResultR26 {
  readonly bytes: number;
  readonly payload: unknown;
}

export type AssetLoaderR26 = (
  spec: AssetSpecR26,
  context: AssetLoadContextR26,
) => Promise<AssetLoadResultR26>;

export interface AssetBudgetR26 {
  readonly maxResidentBytes: number;
  readonly maxInFlightBytes: number;
  readonly maxConcurrent: number;
  readonly maxRetries: number;
}

export interface AssetPlanR26 {
  readonly start: readonly string[];
  readonly blocked: readonly string[];
  readonly evict: readonly string[];
  readonly pressure: number;
}

const priorityWeight = (value: AssetPriorityR26): number =>
  ({ critical: 5, high: 4, normal: 3, low: 2, background: 1 })[value];

const clean = (value: string): string => value.trim().slice(0, 128);
const bytes = (value: number): number =>
  Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0);

export class AssetPipelineR26 {
  readonly #records = new Map<string, AssetRecordR26>();
  readonly #controllers = new Map<string, AbortController>();
  readonly #budget: AssetBudgetR26;
  #residentBytes = 0;
  #inFlightBytes = 0;
  #inFlight = 0;
  #revision = 0;
  #frame = 0;
  #disposed = false;

  constructor(
    private readonly loader: AssetLoaderR26,
    budget: Partial<AssetBudgetR26> = {},
  ) {
    this.#budget = Object.freeze({
      maxResidentBytes: Math.max(1024 * 1024, bytes(budget.maxResidentBytes ?? 512 * 1024 * 1024)),
      maxInFlightBytes: Math.max(1024 * 1024, bytes(budget.maxInFlightBytes ?? 128 * 1024 * 1024)),
      maxConcurrent: Math.max(1, Math.floor(budget.maxConcurrent ?? 6)),
      maxRetries: Math.max(0, Math.floor(budget.maxRetries ?? 2)),
    });
  }

  declare(spec: AssetSpecR26): AssetRecordR26 {
    this.#assertLive();
    const id = clean(spec.id);
    if (!id) throw new Error('R26_ASSET_ID_EMPTY');
    if (this.#records.has(id)) throw new Error(`R26_ASSET_DUPLICATE:${id}`);
    const normalized = Object.freeze({
      id,
      url: spec.url.trim().slice(0, 2048),
      kind: spec.kind.trim().slice(0, 64),
      dependencies: Object.freeze([...new Set(spec.dependencies.map(clean).filter(Boolean))].sort()),
      priority: spec.priority,
      estimatedBytes: bytes(spec.estimatedBytes),
      optional: spec.optional === true,
      tags: Object.freeze([...new Set(spec.tags.map((tag) => tag.trim().slice(0, 48)).filter(Boolean))].sort()),
      state: 'declared' as const,
      attempts: 0,
      residentBytes: 0,
      lastAccessFrame: 0,
      revision: ++this.#revision,
      error: null,
    });
    this.#records.set(id, normalized);
    this.#detectCycle(id);
    return normalized;
  }

  registerMany(specs: readonly AssetSpecR26[]): void {
    for (const spec of specs) this.declare(spec);
  }

  get(id: string): AssetRecordR26 | undefined {
    return this.#records.get(clean(id));
  }

  all(): readonly AssetRecordR26[] {
    return Object.freeze([...this.#records.values()].sort((a, b) =>
      priorityWeight(b.priority) - priorityWeight(a.priority) || a.id.localeCompare(b.id),
    ));
  }

  plan(frame: number, memoryReserveBytes = 0): AssetPlanR26 {
    this.#assertLive();
    this.#frame = Math.max(this.#frame, Math.floor(frame));
    const start: string[] = [];
    const blocked: string[] = [];
    const pressure = this.#residentBytes / Math.max(1, this.#budget.maxResidentBytes);

    for (const record of this.all()) {
      if (!['declared', 'queued', 'stale'].includes(record.state)) continue;
      const missing = record.dependencies.filter((dependency) => this.#records.get(dependency)?.state !== 'ready');
      if (missing.length) {
        blocked.push(record.id);
        continue;
      }
      if (this.#inFlight >= this.#budget.maxConcurrent) continue;
      if (this.#inFlightBytes + record.estimatedBytes > this.#budget.maxInFlightBytes) continue;
      if (this.#residentBytes + memoryReserveBytes + record.estimatedBytes > this.#budget.maxResidentBytes && record.optional) continue;
      start.push(record.id);
    }

    const evictionCandidates = this.all()
      .filter((record) => record.state === 'ready' && !record.optional === false)
      .sort((a, b) =>
        a.lastAccessFrame - b.lastAccessFrame ||
        priorityWeight(a.priority) - priorityWeight(b.priority) ||
        b.residentBytes - a.residentBytes ||
        a.id.localeCompare(b.id),
      );

    const evict = pressure > 0.9
      ? evictionCandidates.slice(0, Math.max(1, Math.ceil(evictionCandidates.length * 0.25))).map((record) => record.id)
      : [];

    return Object.freeze({
      start: Object.freeze(start),
      blocked: Object.freeze(blocked),
      evict: Object.freeze(evict),
      pressure,
    });
  }

  touch(id: string, frame = this.#frame): boolean {
    const record = this.#records.get(clean(id));
    if (!record) return false;
    this.#records.set(record.id, Object.freeze({
      ...record,
      lastAccessFrame: Math.max(record.lastAccessFrame, Math.floor(frame)),
      revision: ++this.#revision,
    }));
    return true;
  }

  async load(id: string, frame = this.#frame): Promise<AssetRecordR26 | null> {
    this.#assertLive();
    const current = this.#records.get(clean(id));
    if (!current || !['declared', 'queued', 'stale'].includes(current.state)) return null;
    if (!this.#dependenciesReady(current)) {
      this.#replace(current, { state: 'queued', error: 'dependencies-not-ready' });
      return null;
    }
    if (this.#inFlight >= this.#budget.maxConcurrent) return null;
    if (this.#inFlightBytes + current.estimatedBytes > this.#budget.maxInFlightBytes) return null;

    const controller = new AbortController();
    this.#controllers.set(current.id, controller);
    this.#inFlight += 1;
    this.#inFlightBytes += current.estimatedBytes;
    const loading = this.#replace(current, {
      state: 'loading',
      attempts: current.attempts + 1,
      error: null,
    });

    try {
      const result = await this.loader(current, {
        signal: controller.signal,
        attempt: loading.attempts,
        priority: loading.priority,
      });
      const actualBytes = bytes(result.bytes || current.estimatedBytes);
      const budgetFailure = this.#residentBytes + actualBytes > this.#budget.maxResidentBytes && !current.optional;
      if (budgetFailure) {
        return this.#replace(current, {
          state: 'failed',
          error: 'resident-budget-exceeded',
          residentBytes: 0,
        });
      }
      this.#residentBytes += actualBytes;
      this.#frame = Math.max(this.#frame, Math.floor(frame));
      return this.#replace(current, {
        state: 'ready',
        residentBytes: actualBytes,
        lastAccessFrame: this.#frame,
        error: null,
      });
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error).slice(0, 512);
      const retry = loading.attempts <= this.#budget.maxRetries && !controller.signal.aborted;
      return this.#replace(current, {
        state: retry ? 'queued' : 'failed',
        error: message,
      });
    } finally {
      this.#controllers.delete(current.id);
      this.#inFlight = Math.max(0, this.#inFlight - 1);
      this.#inFlightBytes = Math.max(0, this.#inFlightBytes - current.estimatedBytes);
    }
  }

  queue(id: string): boolean {
    const current = this.#records.get(clean(id));
    if (!current || !['declared', 'failed', 'cancelled', 'stale'].includes(current.state)) return false;
    this.#replace(current, { state: 'queued', error: null });
    return true;
  }

  cancel(id: string): boolean {
    const key = clean(id);
    const current = this.#records.get(key);
    if (!current || !['queued', 'loading'].includes(current.state)) return false;
    this.#controllers.get(key)?.abort();
    this.#replace(current, { state: 'cancelled', error: 'cancelled-by-runtime' });
    return true;
  }

  invalidate(id: string): readonly AssetRecordR26[] {
    const root = this.#records.get(clean(id));
    if (!root) return Object.freeze([]);
    const affected = new Set<string>([root.id]);
    const queue = [root.id];
    while (queue.length) {
      const current = queue.shift()!;
      for (const record of this.#records.values()) {
        if (!record.dependencies.includes(current) || affected.has(record.id)) continue;
        affected.add(record.id);
        queue.push(record.id);
      }
    }
    return Object.freeze([...affected].sort().map((assetId) => {
      const record = this.#records.get(assetId)!;
      const resident = record.state === 'ready' ? this.#releaseBytes(record.residentBytes) : 0;
      return this.#replace(record, {
        state: record.optional ? 'declared' : 'queued',
        residentBytes: Math.max(0, record.residentBytes - resident),
        error: null,
      });
    }));
  }

  evict(id: string): boolean {
    const record = this.#records.get(clean(id));
    if (!record || record.state !== 'ready') return false;
    if ([...this.#records.values()].some((candidate) =>
      candidate.dependencies.includes(record.id) && candidate.state === 'ready')) return false;
    this.#releaseBytes(record.residentBytes);
    this.#replace(record, {
      state: 'declared',
      residentBytes: 0,
      error: null,
    });
    return true;
  }

  snapshot(): Readonly<{
    frame: number;
    revision: number;
    residentBytes: number;
    inFlightBytes: number;
    inFlight: number;
    maxResidentBytes: number;
    records: readonly AssetRecordR26[];
  }> {
    return Object.freeze({
      frame: this.#frame,
      revision: this.#revision,
      residentBytes: this.#residentBytes,
      inFlightBytes: this.#inFlightBytes,
      inFlight: this.#inFlight,
      maxResidentBytes: this.#budget.maxResidentBytes,
      records: this.all(),
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const controller of this.#controllers.values()) controller.abort();
    this.#controllers.clear();
    this.#records.clear();
    this.#residentBytes = 0;
    this.#inFlightBytes = 0;
    this.#inFlight = 0;
  }

  #dependenciesReady(record: AssetRecordR26): boolean {
    return record.dependencies.every((dependency) => this.#records.get(dependency)?.state === 'ready');
  }

  #replace(record: AssetRecordR26, patch: Partial<AssetRecordR26>): AssetRecordR26 {
    const next = Object.freeze({
      ...record,
      ...patch,
      revision: ++this.#revision,
    });
    this.#records.set(record.id, next);
    return next;
  }

  #releaseBytes(amount: number): number {
    const released = bytes(amount);
    this.#residentBytes = Math.max(0, this.#residentBytes - released);
    return released;
  }

  #detectCycle(start: string): void {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new Error(`R26_ASSET_CYCLE:${id}`);
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dependency of this.#records.get(id)?.dependencies ?? []) {
        if (this.#records.has(dependency)) visit(dependency);
      }
      visiting.delete(id);
      visited.add(id);
    };
    visit(start);
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('R26_ASSET_DISPOSED');
  }
}

export const createNoopAssetLoaderR26 = (): AssetLoaderR26 =>
  async (spec, context) => ({
    bytes: spec.estimatedBytes,
    payload: { id: spec.id, attempt: context.attempt },
  });
