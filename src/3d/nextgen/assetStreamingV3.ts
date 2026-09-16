/** Priority-aware asset streaming with deduplication, cancellation and memory budgets. */

export type AssetKind = 'texture' | 'model' | 'audio' | 'shader' | 'json' | 'binary';
export type AssetPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';
export type AssetState = 'queued' | 'loading' | 'ready' | 'failed' | 'cancelled';

export interface AssetRequest<T = unknown> {
  id: string;
  url: string;
  kind: AssetKind;
  priority: AssetPriority;
  estimatedBytes: number;
  retries?: number;
  decode?: (payload: ArrayBuffer) => Promise<T> | T;
}

export interface AssetRecord<T = unknown> {
  id: string;
  url: string;
  kind: AssetKind;
  priority: AssetPriority;
  state: AssetState;
  bytes: number;
  attempts: number;
  value?: T;
  error?: string;
  queuedAtTick: number;
  completedAtTick?: number;
}

export interface StreamingBudget {
  maxResidentBytes: number;
  maxConcurrent: number;
  maxQueue: number;
  perAssetBytes: number;
}

export interface StreamingStats { queued: number; loading: number; ready: number; failed: number; residentBytes: number; inflight: number }

const PRIORITY_WEIGHT: Record<AssetPriority, number> = { critical: 1000, high: 700, normal: 400, low: 180, background: 40 };

function assertUrl(url: string): void {
  const parsed = new URL(url, 'https://aapw.invalid');
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error(`unsupported asset protocol: ${parsed.protocol}`);
}

function safeDecodeFallback(kind: AssetKind, payload: ArrayBuffer): unknown {
  if (kind === 'json') return JSON.parse(new TextDecoder().decode(payload));
  return payload;
}

export class AssetStreamingV3 {
  readonly budget: StreamingBudget;
  #records = new Map<string, AssetRecord>();
  #requests = new Map<string, AssetRequest>();
  #queue = new Set<string>();
  #resident = new Map<string, AssetRecord>();
  #controllers = new Map<string, AbortController>();
  #tick = 0;

  constructor(budget?: Partial<StreamingBudget>) {
    this.budget = {
      maxResidentBytes: 256 * 1024 * 1024,
      maxConcurrent: 6,
      maxQueue: 256,
      perAssetBytes: 64 * 1024 * 1024,
      ...budget,
    };
  }

  request<T>(request: AssetRequest<T>): AssetRecord<T> {
    assertUrl(request.url);
    if (request.estimatedBytes < 0 || request.estimatedBytes > this.budget.perAssetBytes) throw new RangeError(`asset ${request.id} exceeds per-asset budget`);
    const existing = this.#records.get(request.id) as AssetRecord<T> | undefined;
    if (existing && existing.state === 'ready') return { ...existing };
    if (existing && (existing.state === 'queued' || existing.state === 'loading')) return { ...existing };
    if (this.#queue.size >= this.budget.maxQueue) this.evictQueuedBackground();
    if (this.#queue.size >= this.budget.maxQueue) throw new Error('asset queue capacity exhausted');
    const record: AssetRecord<T> = {
      id: request.id,
      url: request.url,
      kind: request.kind,
      priority: request.priority,
      state: 'queued',
      bytes: request.estimatedBytes,
      attempts: 0,
      queuedAtTick: this.#tick,
    };
    this.#records.set(request.id, record);
    this.#requests.set(request.id, request as AssetRequest);
    this.#queue.add(request.id);
    return { ...record } as AssetRecord<T>;
  }

  cancel(id: string): boolean {
    const record = this.#records.get(id);
    if (!record) return false;
    if (record.state === 'ready' || record.state === 'failed' || record.state === 'cancelled') return false;
    this.#controllers.get(id)?.abort();
    this.#controllers.delete(id);
    this.#queue.delete(id);
    record.state = 'cancelled';
    return true;
  }

  async pump(fetcher: typeof fetch = fetch): Promise<AssetRecord[]> {
    this.#tick += 1;
    const slots = Math.max(0, this.budget.maxConcurrent - this.activeCount());
    const ids = [...this.#queue].sort((a, b) => this.compareQueue(a, b)).slice(0, slots);
    const results = await Promise.all(ids.map((id) => this.load(id, fetcher)));
    this.enforceResidentBudget();
    return results.map((record) => ({ ...record }));
  }

  get(id: string): AssetRecord | undefined {
    const record = this.#records.get(id);
    return record ? { ...record } : undefined;
  }

  stats(): StreamingStats {
    let queued = 0; let loading = 0; let ready = 0; let failed = 0; let residentBytes = 0;
    for (const record of this.#records.values()) {
      if (record.state === 'queued') queued += 1;
      if (record.state === 'loading') loading += 1;
      if (record.state === 'ready') ready += 1;
      if (record.state === 'failed') failed += 1;
      if (record.state === 'ready' && this.#resident.has(record.id)) residentBytes += record.bytes;
    }
    return { queued, loading, ready, failed, residentBytes, inflight: loading };
  }

  evict(id: string): boolean {
    const record = this.#records.get(id);
    if (!record || record.state !== 'ready') return false;
    this.#resident.delete(id);
    this.#records.delete(id);
    this.#requests.delete(id);
    return true;
  }

  listResident(): AssetRecord[] {
    return [...this.#resident.values()].sort((a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority] || b.completedAtTick! - a.completedAtTick!).map((record) => ({ ...record }));
  }

  private async load(id: string, fetcher: typeof fetch): Promise<AssetRecord> {
    const record = this.#records.get(id);
    const request = this.#requests.get(id);
    if (!record || !request) throw new Error(`missing asset request ${id}`);
    this.#queue.delete(id);
    record.state = 'loading';
    record.attempts += 1;
    const controller = new AbortController();
    this.#controllers.set(id, controller);
    try {
      const response = await fetcher(request.url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.arrayBuffer();
      if (payload.byteLength > this.budget.perAssetBytes) throw new Error(`asset payload exceeds budget (${payload.byteLength} bytes)`);
      const value = request.decode ? await request.decode(payload) : safeDecodeFallback(request.kind, payload);
      record.value = value;
      record.bytes = payload.byteLength;
      record.state = 'ready';
      record.completedAtTick = this.#tick;
      this.#resident.set(id, record);
    } catch (error) {
      if (controller.signal.aborted) record.state = 'cancelled';
      else if (record.attempts <= (request.retries ?? 2)) {
        record.state = 'queued';
        this.#queue.add(id);
      } else {
        record.state = 'failed';
        record.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      this.#controllers.delete(id);
    }
    return { ...record };
  }

  private activeCount(): number { return [...this.#records.values()].filter((record) => record.state === 'loading').length; }

  private compareQueue(a: string, b: string): number {
    const left = this.#records.get(a)!; const right = this.#records.get(b)!;
    const scoreLeft = PRIORITY_WEIGHT[left.priority] - left.queuedAtTick * 0.1;
    const scoreRight = PRIORITY_WEIGHT[right.priority] - right.queuedAtTick * 0.1;
    return scoreRight - scoreLeft || a.localeCompare(b);
  }

  private evictQueuedBackground(): void {
    const candidate = [...this.#queue].map((id) => this.#records.get(id)!).filter(Boolean).sort((a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority] || a.queuedAtTick - b.queuedAtTick)[0];
    if (candidate) this.cancel(candidate.id);
  }

  private enforceResidentBudget(): void {
    let bytes = this.stats().residentBytes;
    if (bytes <= this.budget.maxResidentBytes) return;
    const candidates = this.listResident().sort((a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority] || (a.completedAtTick ?? 0) - (b.completedAtTick ?? 0));
    for (const candidate of candidates) {
      if (bytes <= this.budget.maxResidentBytes) break;
      if (candidate.priority === 'critical') continue;
      if (this.evict(candidate.id)) bytes -= candidate.bytes;
    }
  }
}

export function createAssetRequest(id: string, url: string, kind: AssetKind, priority: AssetPriority = 'normal', estimatedBytes = 1): AssetRequest {
  return { id, url, kind, priority, estimatedBytes };
}
