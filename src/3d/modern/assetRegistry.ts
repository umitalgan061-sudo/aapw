import type {
  AssetDescriptor,
  AssetId,
  AssetLoader,
  AssetLoaderContext,
  AssetRegistryOptions,
  AssetRegistryStats,
  AssetRuntime,
  Disposable,
  RuntimeError,
  TimestampMs,
} from './types';
import { asTimestampMs } from './types';

interface Entry<T = unknown> {
  descriptor: AssetDescriptor;
  state: AssetRuntime<T>;
  promise?: Promise<T>;
  controller?: AbortController;
  pinCount: number;
}

export interface AssetHandle<T> extends Disposable {
  readonly id: AssetId;
  readonly value: Promise<T>;
}

export interface AssetEvictionReport {
  readonly evicted: readonly AssetId[];
  readonly bytesFreed: number;
  readonly skippedPinned: number;
}

export interface AssetRegistryEvents {
  onState?(asset: AssetRuntime): void;
  onEviction?(report: AssetEvictionReport): void;
}

/**
 * Dependency-aware, budgeted asset residency manager.
 *
 * The registry owns lifetime, reference counting and eviction policy while
 * loaders remain format-specific. Failed optional assets are isolated; failed
 * dependency chains surface a structured RuntimeError instead of corrupting
 * the residency graph.
 */
export class AssetRegistry implements Disposable {
  private readonly byteBudget: number;
  private readonly entryBudget: number;
  private readonly now: () => TimestampMs;
  private readonly entries = new Map<AssetId, Entry>();
  private readonly loaders = new Map<AssetDescriptor['kind'], AssetLoader<any>>();
  private readonly events: AssetRegistryEvents;
  private disposed = false;

  public constructor(options: AssetRegistryOptions, events: AssetRegistryEvents = {}) {
    this.byteBudget = Math.max(1, Math.floor(options.byteBudget));
    this.entryBudget = Math.max(1, Math.floor(options.entryBudget));
    this.now = options.now ?? (() => asTimestampMs(performance.now()));
    this.events = events;
  }

  public register<T>(kind: AssetDescriptor['kind'], loader: AssetLoader<T>): Disposable {
    if (this.disposed) throw new Error('ASSET_REGISTRY_DISPOSED');
    if (typeof loader !== 'function') throw new TypeError('ASSET_LOADER_REQUIRED');
    this.loaders.set(kind, loader as AssetLoader<any>);
    return { dispose: () => this.unregister(kind, loader) };
  }

  private unregister(kind: AssetDescriptor['kind'], loader: AssetLoader<any>): void {
    if (this.loaders.get(kind) === loader) this.loaders.delete(kind);
  }

  public define(descriptor: AssetDescriptor): void {
    if (this.disposed) throw new Error('ASSET_REGISTRY_DISPOSED');
    const current = this.entries.get(descriptor.id);
    if (current && current.descriptor.uri !== descriptor.uri) throw new Error(`ASSET_REDEFINE_CONFLICT:${descriptor.id}`);
    if (current) {
      current.descriptor = { ...current.descriptor, ...descriptor };
      return;
    }
    const now = this.now();
    this.entries.set(descriptor.id, {
      descriptor,
      pinCount: 0,
      state: {
        id: descriptor.id,
        state: 'unloaded',
        bytes: descriptor.sizeBytes ?? 0,
        refs: 0,
        lastUsed: now,
        priority: descriptor.priority ?? 0,
      },
    });
  }

  public async acquire<T>(descriptor: AssetDescriptor): Promise<AssetHandle<T>> {
    this.define(descriptor);
    const entry = this.entries.get(descriptor.id) as Entry<T>;
    entry.state = this.nextState(entry, { refs: entry.state.refs + 1, lastUsed: this.now() });
    this.notify(entry);
    const value = this.ensureLoaded(entry);
    return {
      id: descriptor.id,
      value,
      dispose: () => this.release(descriptor.id),
    };
  }

  public retain(id: AssetId): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.state = this.nextState(entry, { refs: entry.state.refs + 1, lastUsed: this.now() });
    this.notify(entry);
    return true;
  }

  public release(id: AssetId): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.state.refs <= 0) return false;
    entry.state = this.nextState(entry, { refs: entry.state.refs - 1, lastUsed: this.now() });
    this.notify(entry);
    return true;
  }

  public pin(id: AssetId): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.pinCount += 1;
    return true;
  }

  public unpin(id: AssetId): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.pinCount <= 0) return false;
    entry.pinCount -= 1;
    return true;
  }

  public async preload(descriptors: readonly AssetDescriptor[], concurrency = 4): Promise<readonly AssetId[]> {
    const queue = [...descriptors];
    const loaded: AssetId[] = [];
    const workers = Array.from({ length: Math.max(1, Math.floor(concurrency)) }, async () => {
      while (queue.length) {
        const descriptor = queue.shift();
        if (!descriptor) return;
        try {
          const handle = await this.acquire(descriptor);
          await handle.value;
          handle.dispose();
          loaded.push(descriptor.id);
        } catch (error) {
          if (!descriptor.optional) throw error;
        }
      }
    });
    await Promise.all(workers);
    return loaded;
  }

  public get<T>(id: AssetId): T | undefined {
    const entry = this.entries.get(id) as Entry<T> | undefined;
    if (!entry || entry.state.state !== 'resident') return undefined;
    entry.state = this.nextState(entry, { lastUsed: this.now() });
    return entry.state.value;
  }

  public state(id: AssetId): AssetRuntime | undefined {
    return this.entries.get(id)?.state;
  }

  public async evictUntilWithinBudget(extraBytes = 0): Promise<AssetEvictionReport> {
    const candidates = [...this.entries.values()]
      .filter((entry) => entry.state.state === 'resident' && entry.state.refs === 0 && entry.pinCount === 0)
      .sort((a, b) => {
        const priority = (a.state.priority - b.state.priority);
        if (priority !== 0) return priority;
        return Number(a.state.lastUsed) - Number(b.state.lastUsed);
      });
    const evicted: AssetId[] = [];
    let bytesFreed = 0;
    let currentBytes = this.stats().residentBytes;
    let skippedPinned = 0;
    for (const entry of this.entries.values()) if (entry.state.state === 'resident' && entry.pinCount > 0) skippedPinned += 1;
    for (const entry of candidates) {
      if (currentBytes + extraBytes <= this.byteBudget && this.entries.size <= this.entryBudget) break;
      const bytes = entry.state.bytes;
      entry.state = this.nextState(entry, { state: 'evicting' });
      this.notify(entry);
      try {
        await this.disposeValue(entry.state.value);
      } finally {
        currentBytes -= bytes;
        bytesFreed += bytes;
        evicted.push(entry.descriptor.id);
        this.entries.delete(entry.descriptor.id);
      }
    }
    const report = { evicted, bytesFreed, skippedPinned };
    if (evicted.length) this.events.onEviction?.(report);
    return report;
  }

  public stats(): AssetRegistryStats {
    let residentEntries = 0;
    let loadingEntries = 0;
    let failedEntries = 0;
    let residentBytes = 0;
    let pinnedEntries = 0;
    for (const entry of this.entries.values()) {
      if (entry.state.state === 'resident') {
        residentEntries += 1;
        residentBytes += entry.state.bytes;
      }
      if (entry.state.state === 'loading') loadingEntries += 1;
      if (entry.state.state === 'failed') failedEntries += 1;
      if (entry.pinCount > 0) pinnedEntries += 1;
    }
    return {
      totalEntries: this.entries.size,
      residentEntries,
      loadingEntries,
      failedEntries,
      residentBytes,
      budgetBytes: this.byteBudget,
      pinnedEntries,
    };
  }

  public async ensureBudget(extraBytes = 0): Promise<void> {
    const stats = this.stats();
    if (stats.residentBytes + extraBytes > this.byteBudget || stats.totalEntries > this.entryBudget) {
      await this.evictUntilWithinBudget(extraBytes);
    }
    const after = this.stats();
    if (after.residentBytes + extraBytes > this.byteBudget) throw new Error('ASSET_BYTE_BUDGET_EXCEEDED');
    if (after.totalEntries > this.entryBudget) throw new Error('ASSET_ENTRY_BUDGET_EXCEEDED');
  }

  private async ensureLoaded<T>(entry: Entry<T>): Promise<T> {
    if (entry.state.state === 'resident') {
      entry.state = this.nextState(entry, { lastUsed: this.now() });
      return entry.state.value as T;
    }
    if (entry.promise) return entry.promise;
    const loader = this.loaders.get(entry.descriptor.kind) as AssetLoader<T> | undefined;
    if (!loader) {
      const error = this.runtimeError('ASSET_LOADER_MISSING', `no loader registered for ${entry.descriptor.kind}`);
      entry.state = this.nextState(entry, { state: 'failed', error });
      this.notify(entry);
      return Promise.reject(error);
    }
    entry.controller = new AbortController();
    entry.state = this.nextState(entry, { state: 'loading', error: undefined });
    this.notify(entry);
    const context: AssetLoaderContext = {
      signal: entry.controller.signal,
      reportProgress: (ratio) => {
        if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) return;
      },
      resolveDependency: async <D>(id: AssetId) => {
        const dependency = this.entries.get(id);
        if (!dependency) throw this.runtimeError('ASSET_DEPENDENCY_MISSING', `missing dependency ${id}`);
        return this.ensureLoaded(dependency as Entry<D>);
      },
    };
    entry.promise = (async () => {
      try {
        for (const dependencyId of entry.descriptor.dependencies ?? []) await this.acquireDependency(dependencyId);
        const value = await loader(entry.descriptor, context);
        const bytes = Math.max(0, entry.descriptor.sizeBytes ?? this.estimateBytes(value));
        await this.ensureBudget(bytes);
        entry.state = this.nextState(entry, {
          state: 'resident',
          value,
          bytes,
          refs: Math.max(1, entry.state.refs),
          lastUsed: this.now(),
          error: undefined,
        });
        this.notify(entry);
        return value;
      } catch (cause) {
        const error = this.runtimeError('ASSET_LOAD_FAILED', `failed to load ${entry.descriptor.uri}`, cause);
        entry.state = this.nextState(entry, { state: 'failed', error });
        this.notify(entry);
        throw error;
      } finally {
        entry.promise = undefined;
        entry.controller = undefined;
      }
    })();
    return entry.promise;
  }

  private async acquireDependency(id: AssetId): Promise<void> {
    const dependency = this.entries.get(id);
    if (!dependency) throw this.runtimeError('ASSET_DEPENDENCY_MISSING', `missing dependency ${id}`);
    dependency.state = this.nextState(dependency, { refs: dependency.state.refs + 1, lastUsed: this.now() });
    await this.ensureLoaded(dependency);
    dependency.state = this.nextState(dependency, { refs: Math.max(0, dependency.state.refs - 1) });
  }

  private nextState<T>(entry: Entry<T>, patch: Partial<AssetRuntime<T>>): AssetRuntime<T> {
    return { ...entry.state, ...patch };
  }

  private notify(entry: Entry): void {
    this.events.onState?.(entry.state);
  }

  private estimateBytes(value: unknown): number {
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return value.size;
    return 0;
  }

  private async disposeValue(value: unknown): Promise<void> {
    if (!value) return;
    if (typeof (value as { dispose?: () => void | Promise<void> }).dispose === 'function') {
      await (value as { dispose: () => void | Promise<void> }).dispose();
    }
  }

  private runtimeError(code: string, message: string, cause?: unknown): RuntimeError {
    return { code, message, recoverable: true, cause };
  }

  public async invalidate(id: AssetId, reload = false): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.state.state === 'loading') entry.controller?.abort();
    await this.disposeValue(entry.state.value);
    entry.state = this.nextState(entry, { state: 'unloaded', value: undefined, bytes: 0, error: undefined });
    this.notify(entry);
    if (reload && entry.state.refs > 0) await this.ensureLoaded(entry);
  }

  public async clear(force = false): Promise<void> {
    const ids = [...this.entries.keys()];
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      if (!force && (entry.state.refs > 0 || entry.pinCount > 0)) continue;
      if (entry.state.state === 'loading') entry.controller?.abort();
      await this.disposeValue(entry.state.value);
      this.entries.delete(id);
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) entry.controller?.abort();
    this.loaders.clear();
    this.entries.clear();
  }
}

export const createFetchTextLoader = (): AssetLoader<string> => async (descriptor, context) => {
  const response = await fetch(descriptor.uri, { signal: context.signal, cache: 'force-cache' });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.text();
};

export const createFetchJsonLoader = <T = unknown>(): AssetLoader<T> => async (descriptor, context) => {
  const response = await fetch(descriptor.uri, { signal: context.signal, cache: 'force-cache' });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json() as Promise<T>;
};

export const createFetchArrayBufferLoader = (): AssetLoader<ArrayBuffer> => async (descriptor, context) => {
  const response = await fetch(descriptor.uri, { signal: context.signal, cache: 'force-cache' });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  const body = await response.arrayBuffer();
  context.reportProgress(contentLength > 0 ? Math.min(1, body.byteLength / contentLength) : 1);
  return body;
};
