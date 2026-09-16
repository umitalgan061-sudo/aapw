import type { Disposable } from './types.js';
import { clamp, stableSort } from './deterministic.js';

export type AssetKind = 'texture' | 'mesh' | 'material' | 'animation' | 'audio' | 'json' | 'shader' | 'font' | 'binary';
export type AssetState = 'registered' | 'loading' | 'resident' | 'failed' | 'evicted' | 'disposed';
export type AssetPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

export interface AssetDescriptor {
  readonly id: string;
  readonly url: string;
  readonly kind: AssetKind;
  readonly bytes?: number;
  readonly dependencies?: readonly string[];
  readonly priority?: AssetPriority;
  readonly immutable?: boolean;
  readonly integrity?: string;
  readonly tags?: readonly string[];
}

export interface AssetRecord extends AssetDescriptor {
  readonly state: AssetState;
  readonly refs: number;
  readonly bytesResident: number;
  readonly createdRevision: number;
  readonly lastUsedTick: number;
  readonly loadCount: number;
  readonly failCount: number;
  readonly error?: string;
}

export interface AssetBudget {
  readonly maxBytes: number;
  readonly maxResidentAssets: number;
  readonly maxInFlight: number;
}

export interface AssetStats {
  readonly registered: number;
  readonly loading: number;
  readonly resident: number;
  readonly failed: number;
  readonly evicted: number;
  readonly disposed: number;
  readonly refs: number;
  readonly bytesResident: number;
  readonly budget: AssetBudget;
  readonly utilization: number;
}

export interface AssetLoadResult<T = unknown> {
  readonly id: string;
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: string;
  readonly bytes: number;
  readonly durationMs: number;
}

export interface AssetAdapter<T = unknown> {
  load(descriptor: AssetDescriptor, signal: AbortSignal): Promise<T>;
  dispose?(value: T): void;
  estimateBytes?(value: T, descriptor: AssetDescriptor): number;
}

export interface AssetRegistryOptions {
  readonly budget?: Partial<AssetBudget>;
  readonly maxHistory?: number;
  readonly baseUrl?: string;
  readonly allowedProtocols?: readonly string[];
  readonly sameOriginOnly?: boolean;
  readonly maxUrlLength?: number;
}

export interface AssetEviction {
  readonly id: string;
  readonly freedBytes: number;
  readonly reason: string;
}

const DEFAULT_BUDGET = Object.freeze({ maxBytes: 768 * 1024 * 1024, maxResidentAssets: 4096, maxInFlight: 8 });
const DEFAULT_PROTOCOLS = Object.freeze(['https:', 'http:']);
const PRIORITY_WEIGHT: Readonly<Record<AssetPriority, number>> = Object.freeze({ critical: 100, high: 50, normal: 20, low: 5, background: 0 });

interface InternalRecord extends AssetRecord { value?: unknown; abort?: AbortController; }

export class AssetRegistry implements Disposable {
  private readonly records = new Map<string, InternalRecord>();
  private readonly adapters = new Map<AssetKind, AssetAdapter>();
  private readonly history: AssetRecord[] = [];
  private readonly maxHistory: number;
  private readonly budgetValue: AssetBudget;
  private readonly baseUrl?: string;
  private readonly allowedProtocols: readonly string[];
  private readonly sameOriginOnly: boolean;
  private readonly maxUrlLength: number;
  private revision = 0;
  private tickValue = 0;
  private disposedValue = false;
  private bytesResidentValue = 0;
  private inFlight = 0;

  public constructor(options: AssetRegistryOptions = {}) {
    this.budgetValue = Object.freeze({ maxBytes: Math.max(1, Math.trunc(options.budget?.maxBytes ?? DEFAULT_BUDGET.maxBytes)), maxResidentAssets: Math.max(1, Math.trunc(options.budget?.maxResidentAssets ?? DEFAULT_BUDGET.maxResidentAssets)), maxInFlight: Math.max(1, Math.trunc(options.budget?.maxInFlight ?? DEFAULT_BUDGET.maxInFlight)) });
    this.maxHistory = Math.max(64, Math.trunc(options.maxHistory ?? 2048));
    this.baseUrl = options.baseUrl;
    this.allowedProtocols = Object.freeze([...(options.allowedProtocols ?? DEFAULT_PROTOCOLS)]);
    this.sameOriginOnly = options.sameOriginOnly ?? false;
    this.maxUrlLength = Math.max(128, Math.trunc(options.maxUrlLength ?? 4096));
  }

  public get disposed(): boolean { return this.disposedValue; }
  public get revisionNumber(): number { return this.revision; }
  public get budget(): AssetBudget { return this.budgetValue; }
  public get stats(): AssetStats {
    let registered = 0; let loading = 0; let resident = 0; let failed = 0; let evicted = 0; let disposed = 0; let refs = 0;
    for (const record of this.records.values()) {
      if (record.state === 'registered') registered += 1;
      if (record.state === 'loading') loading += 1;
      if (record.state === 'resident') resident += 1;
      if (record.state === 'failed') failed += 1;
      if (record.state === 'evicted') evicted += 1;
      if (record.state === 'disposed') disposed += 1;
      refs += record.refs;
    }
    return Object.freeze({ registered, loading, resident, failed, evicted, disposed, refs, bytesResident: this.bytesResidentValue, budget: this.budgetValue, utilization: clamp(this.bytesResidentValue / this.budgetValue.maxBytes, 0, 1) });
  }

  public register(descriptor: AssetDescriptor): boolean {
    if (this.disposedValue || !this.isValidDescriptor(descriptor) || this.records.has(descriptor.id)) return false;
    const priority = descriptor.priority ?? 'normal';
    const record: InternalRecord = { ...descriptor, url: this.normalizeUrl(descriptor.url), state: 'registered', refs: 0, bytesResident: 0, createdRevision: this.revision + 1, lastUsedTick: this.tickValue, loadCount: 0, failCount: 0, ...(descriptor.priority ? {} : { priority }) };
    this.records.set(descriptor.id, record);
    this.revision += 1;
    this.remember(record);
    return true;
  }

  public registerMany(descriptors: readonly AssetDescriptor[]): number {
    let accepted = 0;
    for (const descriptor of descriptors) if (this.register(descriptor)) accepted += 1;
    return accepted;
  }

  public installAdapter(kind: AssetKind, adapter: AssetAdapter): boolean {
    if (this.disposedValue || !adapter?.load) return false;
    this.adapters.set(kind, adapter);
    this.revision += 1;
    return true;
  }

  public acquire(id: string, tick = this.tickValue): AssetRecord | undefined {
    const record = this.records.get(id);
    if (!record || this.disposedValue || record.state === 'disposed') return undefined;
    record.refs += 1;
    record.lastUsedTick = Math.max(0, Math.trunc(tick));
    this.revision += 1;
    this.remember(record);
    return snapshotRecord(record);
  }

  public release(id: string, tick = this.tickValue): boolean {
    const record = this.records.get(id);
    if (!record || record.refs <= 0 || this.disposedValue) return false;
    record.refs -= 1;
    record.lastUsedTick = Math.max(0, Math.trunc(tick));
    this.revision += 1;
    this.remember(record);
    return true;
  }

  public touch(id: string, tick = this.tickValue): boolean {
    const record = this.records.get(id);
    if (!record || this.disposedValue) return false;
    record.lastUsedTick = Math.max(0, Math.trunc(tick));
    return true;
  }

  public async load<T = unknown>(id: string, signal?: AbortSignal): Promise<AssetLoadResult<T>> {
    const started = now();
    const record = this.records.get(id);
    if (!record || this.disposedValue) return { id, ok: false, error: 'ASSET_NOT_REGISTERED', bytes: 0, durationMs: now() - started };
    const adapter = this.adapters.get(record.kind) as AssetAdapter<T> | undefined;
    if (!adapter) return { id, ok: false, error: 'ASSET_ADAPTER_MISSING', bytes: 0, durationMs: now() - started };
    if (this.inFlight >= this.budgetValue.maxInFlight) return { id, ok: false, error: 'ASSET_INFLIGHT_LIMIT', bytes: 0, durationMs: now() - started };
    if (record.state === 'resident' && record.value !== undefined) { record.lastUsedTick = this.tickValue; return { id, ok: true, value: record.value as T, bytes: record.bytesResident, durationMs: 0 }; }
    if (!this.canReserve(record.bytes ?? 0, record.priority ?? 'normal')) {
      this.evictUntil(record.bytes ?? 0);
      if (!this.canReserve(record.bytes ?? 0, record.priority ?? 'normal')) return { id, ok: false, error: 'ASSET_BUDGET_EXHAUSTED', bytes: 0, durationMs: now() - started };
    }
    this.inFlight += 1;
    record.state = 'loading';
    record.loadCount += 1;
    record.error = undefined;
    record.abort = new AbortController();
    const combined = mergeSignals(signal, record.abort.signal);
    try {
      const value = await adapter.load(record, combined.signal);
      const bytes = Math.max(0, Math.trunc(adapter.estimateBytes?.(value, record) ?? record.bytes ?? 0));
      this.bytesResidentValue += bytes;
      record.value = value;
      record.bytesResident = bytes;
      record.state = 'resident';
      record.lastUsedTick = this.tickValue;
      this.revision += 1;
      this.remember(record);
      return { id, ok: true, value, bytes, durationMs: now() - started };
    } catch (error) {
      record.failCount += 1;
      record.state = 'failed';
      record.error = error instanceof Error ? error.message : String(error);
      this.revision += 1;
      this.remember(record);
      return { id, ok: false, error: record.error, bytes: 0, durationMs: now() - started };
    } finally {
      this.inFlight -= 1;
      record.abort = undefined;
      combined.dispose();
    }
  }

  public cancel(id: string): boolean {
    const record = this.records.get(id);
    if (!record?.abort) return false;
    record.abort.abort();
    return true;
  }

  public evictUntil(requiredBytes = 0): readonly AssetEviction[] {
    if (this.disposedValue) return [];
    const evictions: AssetEviction[] = [];
    while (!this.canReserve(requiredBytes, 'background')) {
      const candidate = this.evictionCandidates()[0];
      if (!candidate) break;
      const freed = this.evict(candidate.id, 'budget-pressure');
      if (freed <= 0) break;
      evictions.push(Object.freeze({ id: candidate.id, freedBytes: freed, reason: 'budget-pressure' }));
    }
    return Object.freeze(evictions);
  }

  public evict(id: string, reason = 'manual'): number {
    const record = this.records.get(id);
    if (!record || record.state !== 'resident' || record.refs > 0 || record.immutable) return 0;
    const adapter = this.adapters.get(record.kind);
    try { adapter?.dispose?.(record.value); } catch { /* resource teardown isolation */ }
    const freed = record.bytesResident;
    this.bytesResidentValue = Math.max(0, this.bytesResidentValue - freed);
    record.value = undefined;
    record.bytesResident = 0;
    record.state = 'evicted';
    record.error = reason;
    this.revision += 1;
    this.remember(record);
    return freed;
  }

  public record(id: string): AssetRecord | undefined { const record = this.records.get(id); return record ? snapshotRecord(record) : undefined; }
  public recordsSnapshot(): readonly AssetRecord[] { return Object.freeze(stableSort([...this.records.values()].map(snapshotRecord), (a, b) => a.id.localeCompare(b.id))); }
  public historySnapshot(): readonly AssetRecord[] { return Object.freeze(this.history.map(snapshotRecord)); }
  public setTick(tick: number): void { if (!this.disposedValue && Number.isFinite(tick)) this.tickValue = Math.max(0, Math.trunc(tick)); }

  public remove(id: string, force = false): boolean {
    const record = this.records.get(id);
    if (!record || this.disposedValue || (!force && record.refs > 0)) return false;
    if (record.state === 'resident') this.evict(id, force ? 'forced-remove' : 'remove');
    record.state = 'disposed';
    this.records.delete(id);
    this.revision += 1;
    return true;
  }

  public validateUrl(url: string): { readonly ok: boolean; readonly code: string; readonly normalized?: string } {
    if (!url || url.length > this.maxUrlLength) return { ok: false, code: 'URL_LENGTH' };
    try {
      const parsed = new URL(url, this.baseUrl ?? (typeof location !== 'undefined' ? location.href : 'http://localhost/'));
      if (!this.allowedProtocols.includes(parsed.protocol)) return { ok: false, code: 'URL_PROTOCOL' };
      if (this.sameOriginOnly && typeof location !== 'undefined' && parsed.origin !== location.origin) return { ok: false, code: 'URL_ORIGIN' };
      if (parsed.username || parsed.password) return { ok: false, code: 'URL_CREDENTIALS' };
      return { ok: true, code: 'URL_VALID', normalized: parsed.href };
    } catch { return { ok: false, code: 'URL_PARSE' }; }
  }

  public dispose(): void {
    if (this.disposedValue) return;
    for (const record of this.records.values()) {
      record.abort?.abort();
      if (record.state === 'resident') {
        try { this.adapters.get(record.kind)?.dispose?.(record.value); } catch { /* isolation */ }
      }
      record.value = undefined;
      record.state = 'disposed';
      record.bytesResident = 0;
    }
    this.records.clear();
    this.adapters.clear();
    this.history.length = 0;
    this.bytesResidentValue = 0;
    this.disposedValue = true;
  }

  private isValidDescriptor(descriptor: AssetDescriptor): boolean {
    if (!descriptor.id || descriptor.id.length > 256 || !descriptor.kind || !descriptor.url) return false;
    if (descriptor.bytes !== undefined && (!Number.isFinite(descriptor.bytes) || descriptor.bytes < 0)) return false;
    return this.validateUrl(descriptor.url).ok;
  }
  private normalizeUrl(url: string): string { return this.validateUrl(url).normalized ?? url; }
  private canReserve(bytes: number, priority: AssetPriority): boolean { const residentCount = [...this.records.values()].filter(record => record.state === 'resident').length; return this.bytesResidentValue + Math.max(0, bytes) <= this.budgetValue.maxBytes && residentCount < this.budgetValue.maxResidentAssets || priority === 'critical'; }
  private evictionCandidates(): AssetRecord[] { return stableSort([...this.records.values()].filter(record => record.state === 'resident' && record.refs === 0 && !record.immutable).map(snapshotRecord), (a, b) => evictionScore(a, this.tickValue) - evictionScore(b, this.tickValue) || a.id.localeCompare(b.id)); }
  private remember(record: InternalRecord): void { this.history.push(snapshotRecord(record)); while (this.history.length > this.maxHistory) this.history.shift(); }
}

const evictionScore = (record: AssetRecord, tick: number): number => {
  const age = Math.max(0, tick - record.lastUsedTick);
  return age * 10 - PRIORITY_WEIGHT[record.priority ?? 'normal'] * 100 - (record.immutable ? 100000 : 0) - Math.min(1000, record.bytesResident / 1024);
};

const snapshotRecord = (record: AssetRecord): AssetRecord => Object.freeze({ ...record, ...(record.error ? { error: record.error } : {}) });
const now = (): number => typeof performance !== 'undefined' ? performance.now() : Date.now();

const mergeSignals = (external: AbortSignal | undefined, internal: AbortSignal): { signal: AbortSignal; dispose: () => void } => {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (external?.aborted || internal.aborted) controller.abort();
  external?.addEventListener('abort', onAbort, { once: true });
  internal.addEventListener('abort', onAbort, { once: true });
  return { signal: controller.signal, dispose: () => { external?.removeEventListener('abort', onAbort); internal.removeEventListener('abort', onAbort); } };
};

export const createAssetDescriptor = (id: string, url: string, kind: AssetKind, options: Partial<Omit<AssetDescriptor, 'id' | 'url' | 'kind'>> = {}): AssetDescriptor => Object.freeze({ id, url, kind, ...(options.bytes === undefined ? {} : { bytes: Math.max(0, Math.trunc(options.bytes)) }), ...(options.dependencies ? { dependencies: Object.freeze([...options.dependencies]) } : {}), priority: options.priority ?? 'normal', immutable: Boolean(options.immutable), ...(options.integrity ? { integrity: options.integrity } : {}), ...(options.tags ? { tags: Object.freeze([...options.tags]) } : {}) });

export const createFetchAdapter = (): AssetAdapter<ArrayBuffer> => Object.freeze({ load: async (descriptor, signal) => { const response = await fetch(descriptor.url, { signal, credentials: 'same-origin', cache: 'force-cache' }); if (!response.ok) throw new Error(`HTTP_${response.status}`); return response.arrayBuffer(); }, estimateBytes: value => value.byteLength });
