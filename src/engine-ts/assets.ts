import type { Disposable, Result } from './coreTypes.ts';
import { clamp, err, ok, stableSort } from './coreTypes.ts';

export type AssetKind = 'texture' | 'model' | 'audio' | 'shader' | 'data' | 'font';
export type AssetState = 'cold' | 'queued' | 'loading' | 'resident' | 'stale' | 'evicting' | 'failed';
export type AssetPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';

export interface AssetDescriptor {
  readonly id: string;
  readonly url: string;
  readonly kind: AssetKind;
  readonly byteLength?: number;
  readonly compressedBytes?: number;
  readonly priority?: AssetPriority;
  readonly dependencies?: readonly string[];
  readonly tags?: readonly string[];
  readonly version?: string;
  readonly mipLevels?: number;
  readonly width?: number;
  readonly height?: number;
}

export interface AssetRecord extends AssetDescriptor {
  readonly state: AssetState;
  readonly priority: AssetPriority;
  readonly requestedAt: number;
  readonly lastUsedAt: number;
  readonly residentAt?: number;
  readonly failureCount: number;
  readonly retryAt?: number;
  readonly bytesResident: number;
  readonly refCount: number;
}

export interface AssetCacheEntry<T = unknown> {
  readonly record: AssetRecord;
  readonly value: T;
}

export interface AssetLoaderContext {
  readonly signal: AbortSignal;
  readonly dependencies: ReadonlyMap<string, unknown>;
  readonly descriptor: AssetDescriptor;
}

export type AssetLoader<T = unknown> = (context: AssetLoaderContext) => Promise<T>;

export interface AssetBudget {
  readonly maxResidentBytes: number;
  readonly maxResidentAssets: number;
  readonly softPressureRatio: number;
  readonly hardPressureRatio: number;
}

const PRIORITY_SCORE: Readonly<Record<AssetPriority, number>> = Object.freeze({ critical: 1000, high: 700, normal: 450, low: 200, background: 50 });

const nowMs = (): number => typeof performance !== 'undefined' ? performance.now() : Date.now();

export const estimateTextureBytes = (width: number, height: number, mipLevels = 1, bytesPerPixel = 4): number => {
  const pixels = Math.max(1, width) * Math.max(1, height);
  const normalizedMips = Math.max(1, Math.trunc(mipLevels));
  const mipFactor = normalizedMips > 1 ? (1 - (1 / Math.pow(4, normalizedMips))) / (1 - 1 / 4) : 1;
  return Math.ceil(pixels * bytesPerPixel * mipFactor);
};

export const estimateAssetBytes = (asset: AssetDescriptor): number => {
  if (Number.isFinite(asset.compressedBytes) && (asset.compressedBytes ?? 0) > 0) return Math.trunc(asset.compressedBytes!);
  if (Number.isFinite(asset.byteLength) && (asset.byteLength ?? 0) > 0) return Math.trunc(asset.byteLength!);
  if (asset.kind === 'texture' && asset.width && asset.height) return estimateTextureBytes(asset.width, asset.height, asset.mipLevels ?? 1);
  return 64 * 1024;
};

export class AssetRegistry implements Disposable {
  private readonly descriptors = new Map<string, AssetDescriptor>();
  private readonly loaders = new Map<string, AssetLoader>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly records = new Map<string, AssetRecord>();
  private disposed = false;

  register<T>(descriptor: AssetDescriptor, loader: AssetLoader<T>): void {
    if (this.disposed) throw new Error('asset registry disposed');
    if (!descriptor.id || !descriptor.url) throw new Error('asset id and url are required');
    if (this.descriptors.has(descriptor.id)) throw new Error(`asset id collision: ${descriptor.id}`);
    const normalized: AssetDescriptor = Object.freeze({ ...descriptor, priority: descriptor.priority ?? 'normal', dependencies: [...descriptor.dependencies ?? []], tags: [...descriptor.tags ?? []] });
    this.descriptors.set(normalized.id, normalized);
    this.loaders.set(normalized.id, loader);
    this.records.set(normalized.id, this.createRecord(normalized, 'cold'));
  }

  registerManifest<T extends AssetLoader>(entries: readonly { descriptor: AssetDescriptor; loader: T }[]): void {
    const sorted = stableSort(entries, (left, right) => left.descriptor.id.localeCompare(right.descriptor.id));
    for (const entry of sorted) this.register(entry.descriptor, entry.loader);
  }

  descriptor(id: string): AssetDescriptor | undefined { return this.descriptors.get(id); }
  record(id: string): AssetRecord | undefined { return this.records.get(id); }
  list(): readonly AssetRecord[] { return [...this.records.values()].sort((a, b) => a.id.localeCompare(b.id)); }

  markUsed(id: string, refDelta = 0): void {
    const record = this.records.get(id);
    if (!record) return;
    this.records.set(id, Object.freeze({ ...record, lastUsedAt: nowMs(), refCount: Math.max(0, record.refCount + Math.trunc(refDelta)) }));
  }

  async load<T>(id: string, stack: readonly string[] = []): Promise<Result<T, string>> {
    if (this.disposed) return err('asset registry disposed');
    const descriptor = this.descriptors.get(id);
    const loader = this.loaders.get(id);
    if (!descriptor || !loader) return err(`unknown asset: ${id}`);
    if (stack.includes(id)) return err(`asset dependency cycle: ${[...stack, id].join(' -> ')}`);
    const existing = this.records.get(id);
    if (existing?.state === 'loading') return err(`asset already loading: ${id}`);
    const controller = new AbortController();
    this.controllers.set(id, controller);
    this.updateRecord(id, { state: 'loading', requestedAt: nowMs() });
    try {
      const dependencies = new Map<string, unknown>();
      for (const dependency of descriptor.dependencies ?? []) {
        const result = await this.load<unknown>(dependency, [...stack, id]);
        if (!result.ok) throw new Error(`dependency ${dependency}: ${result.error}`);
        dependencies.set(dependency, result.value);
      }
      const value = await loader({ signal: controller.signal, dependencies, descriptor });
      this.controllers.delete(id);
      const bytesResident = estimateAssetBytes(descriptor);
      this.updateRecord(id, { state: 'resident', residentAt: nowMs(), lastUsedAt: nowMs(), failureCount: 0, retryAt: undefined, bytesResident });
      return ok(value as T);
    } catch (cause) {
      this.controllers.delete(id);
      const previous = this.records.get(id);
      const failures = (previous?.failureCount ?? 0) + 1;
      const backoff = Math.min(60_000, 250 * Math.pow(2, Math.min(8, failures - 1)));
      this.updateRecord(id, { state: controller.signal.aborted ? 'stale' : 'failed', failureCount: failures, retryAt: nowMs() + backoff });
      return err(cause instanceof Error ? cause.message : `asset load failed: ${id}`);
    }
  }

  cancel(id: string): boolean {
    const controller = this.controllers.get(id);
    if (!controller) return false;
    controller.abort();
    this.controllers.delete(id);
    this.updateRecord(id, { state: 'stale' });
    return true;
  }

  release(id: string): void { this.markUsed(id, -1); }

  private createRecord(descriptor: AssetDescriptor, state: AssetState): AssetRecord {
    const time = nowMs();
    return Object.freeze({ ...descriptor, state, priority: descriptor.priority ?? 'normal', requestedAt: time, lastUsedAt: time, failureCount: 0, bytesResident: 0, refCount: 0 });
  }

  private updateRecord(id: string, patch: Partial<AssetRecord>): void {
    const current = this.records.get(id);
    if (!current) return;
    const next = { ...current, ...patch } as AssetRecord;
    if ('retryAt' in patch && patch.retryAt === undefined) delete (next as { retryAt?: number }).retryAt;
    if ('residentAt' in patch && patch.residentAt === undefined) delete (next as { residentAt?: number }).residentAt;
    this.records.set(id, Object.freeze(next));
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.descriptors.clear();
    this.loaders.clear();
    this.records.clear();
  }
}

export class ResidencyController implements Disposable {
  private readonly registry: AssetRegistry;
  private budget: AssetBudget;
  private disposed = false;

  constructor(registry: AssetRegistry, budget: Partial<AssetBudget> = {}) {
    this.registry = registry;
    this.budget = this.normalizeBudget(budget);
  }

  setBudget(budget: Partial<AssetBudget>): void { this.budget = this.normalizeBudget({ ...this.budget, ...budget }); }
  get currentBudget(): AssetBudget { return this.budget; }

  usage(): { assets: number; bytes: number; ratio: number } {
    const records = this.registry.list().filter(record => record.state === 'resident');
    const bytes = records.reduce((sum, record) => sum + record.bytesResident, 0);
    return { assets: records.length, bytes, ratio: bytes / Math.max(1, this.budget.maxResidentBytes) };
  }

  evictionCandidates(now = nowMs()): readonly AssetRecord[] {
    const records = this.registry.list().filter(record => record.state === 'resident' && record.refCount === 0);
    return stableSort(records, (left, right) => this.evictionScore(left, now) - this.evictionScore(right, now));
  }

  planEviction(requiredBytes: number, now = nowMs()): readonly string[] {
    let freed = 0;
    const ids: string[] = [];
    for (const record of this.evictionCandidates(now)) {
      ids.push(record.id);
      freed += record.bytesResident;
      if (freed >= Math.max(0, requiredBytes)) break;
    }
    return ids;
  }

  shouldTrim(now = nowMs()): boolean {
    const usage = this.usage();
    return usage.ratio >= this.budget.softPressureRatio || usage.assets >= this.budget.maxResidentAssets;
  }

  hardPressure(now = nowMs()): boolean { return this.usage().ratio >= this.budget.hardPressureRatio; }
  dispose(): void { this.disposed = true; }

  private evictionScore(record: AssetRecord, now: number): number {
    const ageSeconds = Math.max(0, now - record.lastUsedAt) / 1000;
    const priorityPenalty = PRIORITY_SCORE[record.priority];
    const refsPenalty = Math.min(500, record.refCount * 1000);
    return ageSeconds * 100 + record.bytesResident / (1024 * 1024) * 0.5 - priorityPenalty * 0.15 - refsPenalty;
  }

  private normalizeBudget(value: Partial<AssetBudget>): AssetBudget {
    const maxResidentBytes = Math.max(16 * 1024 * 1024, Math.trunc(value.maxResidentBytes ?? 512 * 1024 * 1024));
    const maxResidentAssets = Math.max(32, Math.trunc(value.maxResidentAssets ?? 2048));
    const softPressureRatio = clamp(value.softPressureRatio ?? 0.82, 0.5, 0.95);
    const hardPressureRatio = clamp(value.hardPressureRatio ?? 0.95, softPressureRatio + 0.02, 1.2);
    return Object.freeze({ maxResidentBytes, maxResidentAssets, softPressureRatio, hardPressureRatio });
  }
}

export interface StreamRequest {
  readonly id: string;
  readonly priority: AssetPriority;
  readonly distance: number;
  readonly importance: number;
  readonly deadlineMs?: number;
}

export interface StreamDecision {
  readonly id: string;
  readonly score: number;
  readonly admitted: boolean;
  readonly reason: 'critical' | 'budget' | 'distance' | 'quota' | 'dependency';
}

export class AssetStreamDirector {
  private readonly inFlight = new Set<string>();
  private readonly maxConcurrent: number;
  private readonly maxDistance: number;

  constructor(options: { maxConcurrent?: number; maxDistance?: number } = {}) {
    this.maxConcurrent = Math.max(1, Math.trunc(options.maxConcurrent ?? 6));
    this.maxDistance = Math.max(1, options.maxDistance ?? 4000);
  }

  decide(requests: readonly StreamRequest[], now = nowMs()): readonly StreamDecision[] {
    const ordered = stableSort(requests, (left, right) => this.score(right, now) - this.score(left, now) || left.id.localeCompare(right.id));
    const slots = Math.max(0, this.maxConcurrent - this.inFlight.size);
    return ordered.map((request, index) => {
      const score = this.score(request, now);
      if (request.priority === 'critical') return { id: request.id, score, admitted: true, reason: 'critical' as const };
      if (request.distance > this.maxDistance && request.priority !== 'high') return { id: request.id, score, admitted: false, reason: 'distance' as const };
      if (index >= slots) return { id: request.id, score, admitted: false, reason: 'quota' as const };
      return { id: request.id, score, admitted: true, reason: 'budget' as const };
    });
  }

  begin(id: string): boolean {
    if (this.inFlight.has(id) || this.inFlight.size >= this.maxConcurrent) return false;
    this.inFlight.add(id);
    return true;
  }

  end(id: string): void { this.inFlight.delete(id); }
  clear(): void { this.inFlight.clear(); }
  get activeCount(): number { return this.inFlight.size; }

  private score(request: StreamRequest, now: number): number {
    const priority = PRIORITY_SCORE[request.priority];
    const distanceTerm = 1 / Math.max(1, request.distance) * 100_000;
    const importanceTerm = clamp(request.importance, 0, 1) * 500;
    const deadlineTerm = request.deadlineMs ? Math.max(0, request.deadlineMs - now) < 250 ? 1000 : 0 : 0;
    return priority + distanceTerm + importanceTerm + deadlineTerm;
  }
}

export const createFetchLoader = <T>(decoder: (response: Response, signal: AbortSignal) => Promise<T>): AssetLoader<T> =>
  async ({ descriptor, signal }) => {
    const response = await fetch(descriptor.url, { signal, cache: 'force-cache' });
    if (!response.ok) throw new Error(`asset HTTP ${response.status}: ${descriptor.url}`);
    return decoder(response, signal);
  };

export const textLoader = createFetchLoader(async response => response.text());
export const jsonLoader = createFetchLoader(async response => response.json() as Promise<unknown>);

export const imageBitmapLoader = createFetchLoader(async response => {
  const blob = await response.blob();
  return createImageBitmap(blob);
});

export const arrayBufferLoader = createFetchLoader(async response => response.arrayBuffer());

export interface AssetIntegrityRecord { readonly id: string; readonly expectedChecksum: string; readonly actualChecksum: string; readonly valid: boolean; }

const digestText = async (value: string): Promise<string> => {
  if (globalThis.crypto?.subtle && typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
  return hash.toString(16).padStart(8, '0');
};

export const verifyAssetText = async (id: string, text: string, expectedChecksum: string): Promise<AssetIntegrityRecord> => {
  const actualChecksum = await digestText(text);
  return Object.freeze({ id, expectedChecksum, actualChecksum, valid: actualChecksum === expectedChecksum });
};
