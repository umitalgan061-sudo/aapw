import { assetId, clamp, freeze, type AssetId, type Result, err, ok } from '../domain/contracts.ts';

export type AssetKind = 'model' | 'texture' | 'audio' | 'font' | 'data' | 'shader' | 'material';
export type AssetState = 'declared' | 'loading' | 'ready' | 'failed' | 'disposed';

export interface AssetDescriptor {
  readonly id: AssetId;
  readonly kind: AssetKind;
  readonly url: string;
  readonly bytes?: number;
  readonly hash?: string;
  readonly critical?: boolean;
  readonly preload?: boolean;
  readonly dependencies?: readonly AssetId[];
  readonly tags?: readonly string[];
}

export interface AssetRecord<T = unknown> {
  readonly descriptor: AssetDescriptor;
  readonly state: AssetState;
  readonly value: T | null;
  readonly error: string | null;
  readonly startedAt: number | null;
  readonly readyAt: number | null;
  readonly generation: number;
}

export interface AssetLoader<T = unknown> {
  load(descriptor: AssetDescriptor, signal: AbortSignal): Promise<T>;
  dispose?(value: T): void;
}

export interface AssetMetrics {
  readonly declared: number;
  readonly loading: number;
  readonly ready: number;
  readonly failed: number;
  readonly disposed: number;
  readonly bytesDeclared: number;
  readonly bytesReady: number;
}

const normalizeDescriptor = (input: AssetDescriptor): AssetDescriptor => freeze({
  id: assetId(String(input.id)),
  kind: input.kind,
  url: input.url.trim(),
  bytes: input.bytes === undefined ? undefined : Math.max(0, Math.floor(input.bytes)),
  hash: input.hash?.trim() || undefined,
  critical: input.critical ?? false,
  preload: input.preload ?? false,
  dependencies: [...(input.dependencies ?? [])],
  tags: [...new Set(input.tags ?? [])].slice(0, 32),
});

export class AssetRegistry {
  readonly #records = new Map<AssetId, AssetRecord>();
  readonly #loaders = new Map<AssetKind, AssetLoader>();
  readonly #controllers = new Map<AssetId, AbortController>();
  readonly #now: () => number;
  #generation = 0;

  constructor(now = () => performance.now()) { this.#now = now; }

  register<T>(descriptor: AssetDescriptor, loader: AssetLoader<T>): Result<AssetDescriptor> {
    const normalized = normalizeDescriptor(descriptor);
    if (!normalized.url) return err({ code: 'ASSET_URL_MISSING', message: `Asset ${normalized.id} has no URL.` });
    if (this.#records.has(normalized.id)) return err({ code: 'ASSET_DUPLICATE', message: `Asset ${normalized.id} already exists.` });
    this.#records.set(normalized.id, freeze({ descriptor: normalized, state: 'declared', value: null, error: null, startedAt: null, readyAt: null, generation: ++this.#generation }));
    this.#loaders.set(normalized.kind, loader as AssetLoader);
    return ok(normalized);
  }

  registerBatch(descriptors: readonly AssetDescriptor[], loaderFor: (descriptor: AssetDescriptor) => AssetLoader): number {
    let added = 0;
    for (const descriptor of descriptors) if (this.register(descriptor, loaderFor(descriptor)).ok) added += 1;
    return added;
  }

  async load<T>(id: AssetId): Promise<Result<T>> {
    const record = this.#records.get(id);
    if (!record) return err({ code: 'ASSET_UNKNOWN', message: `Unknown asset ${id}.` });
    if (record.state === 'ready') return ok(record.value as T);
    if (record.state === 'loading') return err({ code: 'ASSET_ALREADY_LOADING', message: `Asset ${id} is already loading.` });
    const loader = this.#loaders.get(record.descriptor.kind);
    if (!loader) return err({ code: 'ASSET_LOADER_MISSING', message: `No loader for ${record.descriptor.kind}.` });

    for (const dependency of record.descriptor.dependencies ?? []) {
      const dependencyResult = await this.load(dependency);
      if (!dependencyResult.ok) {
        this.#fail(id, dependencyResult.error?.message ?? 'Dependency failed.');
        return err({ code: 'ASSET_DEPENDENCY_FAILED', message: `Dependency ${dependency} failed for ${id}.` });
      }
    }

    const controller = new AbortController();
    this.#controllers.set(id, controller);
    const startedAt = this.#now();
    this.#records.set(id, freeze({ ...record, state: 'loading', startedAt, error: null }));
    try {
      const value = await loader.load(record.descriptor, controller.signal);
      const current = this.#records.get(id);
      if (!current || current.state === 'disposed') {
        loader.dispose?.(value);
        return err({ code: 'ASSET_DISPOSED', message: `Asset ${id} was disposed during load.` });
      }
      this.#records.set(id, freeze({ ...current, state: 'ready', value, readyAt: this.#now(), generation: ++this.#generation }));
      return ok(value as T);
    } catch (error) {
      this.#fail(id, error instanceof Error ? error.message : String(error));
      return err({ code: 'ASSET_LOAD_FAILED', message: `Asset ${id} failed: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      this.#controllers.delete(id);
    }
  }

  async preloadCritical(): Promise<Readonly<{ loaded: number; failed: number }>> {
    let loaded = 0;
    let failed = 0;
    for (const record of this.#records.values()) {
      if (!record.descriptor.preload && !record.descriptor.critical) continue;
      const result = await this.load(record.descriptor.id);
      if (result.ok) loaded += 1; else failed += 1;
    }
    return freeze({ loaded, failed });
  }

  abort(id: AssetId): boolean {
    const controller = this.#controllers.get(id);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  dispose(id?: AssetId): void {
    const ids = id ? [id] : [...this.#records.keys()];
    for (const asset of ids) {
      const record = this.#records.get(asset);
      if (!record) continue;
      this.#controllers.get(asset)?.abort();
      const loader = this.#loaders.get(record.descriptor.kind);
      if (record.value !== null) loader?.dispose?.(record.value);
      this.#records.set(asset, freeze({ ...record, state: 'disposed', value: null, generation: ++this.#generation }));
    }
  }

  evictNonCritical(maxReady = 128): number {
    const ready = [...this.#records.values()].filter((record) => record.state === 'ready' && !record.descriptor.critical)
      .sort((a, b) => (a.readyAt ?? 0) - (b.readyAt ?? 0));
    const count = Math.max(0, ready.length - Math.floor(maxReady));
    for (const record of ready.slice(0, count)) this.dispose(record.descriptor.id);
    return count;
  }

  get<T>(id: AssetId): AssetRecord<T> | undefined { return this.#records.get(id) as AssetRecord<T> | undefined; }
  has(id: AssetId): boolean { return this.#records.has(id); }
  descriptors(): readonly AssetDescriptor[] { return [...this.#records.values()].map((record) => record.descriptor); }

  metrics(): AssetMetrics {
    let loading = 0; let ready = 0; let failed = 0; let disposed = 0; let bytesDeclared = 0; let bytesReady = 0;
    for (const record of this.#records.values()) {
      bytesDeclared += record.descriptor.bytes ?? 0;
      bytesReady += record.state === 'ready' ? record.descriptor.bytes ?? 0 : 0;
      if (record.state === 'loading') loading += 1;
      if (record.state === 'ready') ready += 1;
      if (record.state === 'failed') failed += 1;
      if (record.state === 'disposed') disposed += 1;
    }
    return freeze({ declared: this.#records.size, loading, ready, failed, disposed, bytesDeclared, bytesReady });
  }

  #fail(id: AssetId, message: string): void {
    const record = this.#records.get(id);
    if (!record) return;
    this.#records.set(id, freeze({ ...record, state: 'failed', error: message, generation: ++this.#generation }));
  }
}

export const createFetchJsonLoader = <T>(): AssetLoader<T> => ({
  async load(descriptor, signal) {
    const response = await fetch(descriptor.url, { signal, credentials: 'same-origin', cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  },
});

export const createFetchTextLoader = (): AssetLoader<string> => ({
  async load(descriptor, signal) {
    const response = await fetch(descriptor.url, { signal, credentials: 'same-origin', cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  },
});

export const createImageLoader = (): AssetLoader<HTMLImageElement> => ({
  async load(descriptor, signal) {
    if (typeof Image === 'undefined') throw new Error('Image API unavailable.');
    const image = new Image();
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
      const abort = () => { image.src = ''; reject(new DOMException('Aborted', 'AbortError')); };
      signal.addEventListener('abort', abort, { once: true });
      image.onload = () => { signal.removeEventListener('abort', abort); resolve(image); };
      image.onerror = () => { signal.removeEventListener('abort', abort); reject(new Error(`Image load failed: ${descriptor.url}`)); };
    });
    image.src = descriptor.url;
    return loaded;
  },
  dispose(image) { image.src = ''; },
});

export const normalizedProgress = (loaded: number, total: number): number => total > 0 ? clamp(loaded / total, 0, 1) : 0;
