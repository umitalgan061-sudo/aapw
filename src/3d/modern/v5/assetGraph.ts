import { AssetId, checksumObject, asAssetId } from './domain.ts';

export type AssetKind = 'texture' | 'material' | 'model' | 'animation' | 'audio' | 'shader' | 'data';
export type AssetState = 'declared' | 'loading' | 'ready' | 'failed' | 'stale' | 'evicted';

export interface AssetDescriptor {
  readonly id: AssetId;
  readonly kind: AssetKind;
  readonly url: string;
  readonly bytes: number;
  readonly hash?: string;
  readonly dependencies: readonly AssetId[];
  readonly optional: boolean;
  readonly priority: number;
  readonly lod: number;
  readonly tags: readonly string[];
}

export interface AssetRecord extends AssetDescriptor {
  state: AssetState;
  loadedBytes: number;
  lastUsedFrame: number;
  useCount: number;
  error: string | null;
}

export interface AssetPolicy {
  readonly maxBytes: number;
  readonly maxConcurrentLoads: number;
  readonly maxAssetSize: number;
  readonly allowCrossOrigin: readonly string[];
  readonly requireHashForRemote: boolean;
}

export const DEFAULT_ASSET_POLICY: AssetPolicy = Object.freeze({
  maxBytes: 256 * 1024 * 1024,
  maxConcurrentLoads: 8,
  maxAssetSize: 64 * 1024 * 1024,
  allowCrossOrigin: [],
  requireHashForRemote: false,
});

export interface AssetFetchResult {
  readonly id: AssetId;
  readonly ok: boolean;
  readonly bytes: number;
  readonly checksum: string | null;
  readonly status: number;
  readonly error: string | null;
}

export interface AssetLoader {
  load(descriptor: AssetDescriptor, signal?: AbortSignal): Promise<AssetFetchResult>;
}

const normalizeUrl = (value: string): string => {
  const url = new URL(value, typeof location !== 'undefined' ? location.href : 'http://localhost/');
  if (!['http:', 'https:', 'blob:', 'data:'].includes(url.protocol)) throw new Error(`Unsupported asset protocol: ${url.protocol}`);
  return url.href;
};

export class MemoryAssetLoader implements AssetLoader {
  async load(descriptor: AssetDescriptor, signal?: AbortSignal): Promise<AssetFetchResult> {
    if (signal?.aborted) return { id: descriptor.id, ok: false, bytes: 0, checksum: null, status: 499, error: 'aborted' };
    const url = normalizeUrl(descriptor.url);
    try {
      const response = await fetch(url, { signal });
      const bytes = Number(response.headers.get('content-length') ?? 0);
      return {
        id: descriptor.id,
        ok: response.ok,
        bytes,
        checksum: null,
        status: response.status,
        error: response.ok ? null : `HTTP ${response.status}`,
      };
    } catch (error) {
      return { id: descriptor.id, ok: false, bytes: 0, checksum: null, status: 0, error: error instanceof Error ? error.message : 'fetch-failed' };
    }
  }
}

export class AssetGraphV5 {
  readonly #records = new Map<AssetId, AssetRecord>();
  readonly #reverseDependencies = new Map<AssetId, Set<AssetId>>();
  readonly #policy: AssetPolicy;
  #residentBytes = 0;
  #activeLoads = 0;

  constructor(policy: Partial<AssetPolicy> = {}, private readonly loader: AssetLoader = new MemoryAssetLoader()) {
    this.#policy = { ...DEFAULT_ASSET_POLICY, ...policy };
    if (this.#policy.maxBytes <= 0 || this.#policy.maxAssetSize <= 0) throw new RangeError('Asset budgets must be positive');
  }

  declare(descriptor: Omit<AssetDescriptor, 'id'> & { id: string }): AssetId {
    const normalizedId = asAssetId(descriptor.id);
    if (!normalizedId) throw new Error('asset id is required');
    const bytes = Math.max(0, Math.trunc(descriptor.bytes));
    if (bytes > this.#policy.maxAssetSize) throw new Error(`Asset ${normalizedId} exceeds max asset size`);
    if (this.#records.has(normalizedId)) throw new Error(`Asset already declared: ${normalizedId}`);
    const record: AssetRecord = {
      ...descriptor,
      id: normalizedId,
      url: normalizeUrl(descriptor.url),
      bytes,
      dependencies: [...new Set(descriptor.dependencies)],
      tags: [...new Set(descriptor.tags)],
      state: 'declared',
      loadedBytes: 0,
      lastUsedFrame: 0,
      useCount: 0,
      error: null,
    };
    this.#records.set(normalizedId, record);
    for (const dependency of record.dependencies) {
      const consumers = this.#reverseDependencies.get(dependency) ?? new Set<AssetId>();
      consumers.add(normalizedId);
      this.#reverseDependencies.set(dependency, consumers);
    }
    return normalizedId;
  }

  get(id: AssetId): AssetRecord | undefined {
    const record = this.#records.get(id);
    return record ? { ...record, dependencies: [...record.dependencies], tags: [...record.tags] } : undefined;
  }

  list(kind?: AssetKind): readonly AssetRecord[] {
    return [...this.#records.values()]
      .filter((record) => !kind || record.kind === kind)
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
      .map((record) => ({ ...record, dependencies: [...record.dependencies], tags: [...record.tags] }));
  }

  async load(id: AssetId, frame: number, signal?: AbortSignal): Promise<AssetFetchResult> {
    const root = this.#records.get(id);
    if (!root) return { id, ok: false, bytes: 0, checksum: null, status: 404, error: 'unknown-asset' };
    if (root.state === 'ready') {
      root.lastUsedFrame = frame;
      root.useCount += 1;
      return { id, ok: true, bytes: root.loadedBytes, checksum: root.hash ?? checksumObject(root), status: 200, error: null };
    }
    if (this.#activeLoads >= this.#policy.maxConcurrentLoads) return { id, ok: false, bytes: 0, checksum: null, status: 429, error: 'load-concurrency-cap' };
    for (const dependency of root.dependencies) {
      const dependencyResult = await this.load(dependency, frame, signal);
      if (!dependencyResult.ok) {
        root.state = 'failed';
        root.error = `dependency:${dependency}`;
        return { id, ok: false, bytes: 0, checksum: null, status: 424, error: root.error };
      }
    }
    this.#activeLoads += 1;
    root.state = 'loading';
    root.error = null;
    try {
      const result = await this.loader.load(root, signal);
      if (result.ok) {
        this.#ensureResidentCapacity(result.bytes, root.priority);
        root.state = 'ready';
        root.loadedBytes = result.bytes;
        root.lastUsedFrame = frame;
        root.useCount += 1;
        this.#residentBytes += Math.max(0, result.bytes);
      } else {
        root.state = 'failed';
        root.error = result.error ?? 'asset-load-failed';
      }
      return result;
    } finally {
      this.#activeLoads -= 1;
    }
  }

  touch(id: AssetId, frame: number): boolean {
    const record = this.#records.get(id);
    if (!record || record.state !== 'ready') return false;
    record.lastUsedFrame = frame;
    record.useCount += 1;
    return true;
  }

  evict(id: AssetId): boolean {
    const record = this.#records.get(id);
    if (!record || record.state !== 'ready') return false;
    record.state = 'evicted';
    this.#residentBytes = Math.max(0, this.#residentBytes - record.loadedBytes);
    record.loadedBytes = 0;
    for (const dependent of this.#reverseDependencies.get(id) ?? []) {
      const dependentRecord = this.#records.get(dependent);
      if (dependentRecord?.state === 'ready') this.evict(dependent);
    }
    return true;
  }

  recoverFailed(): number {
    let count = 0;
    for (const record of this.#records.values()) {
      if (record.state === 'failed') {
        record.state = 'declared';
        record.error = null;
        count += 1;
      }
    }
    return count;
  }

  residentBytes(): number {
    return this.#residentBytes;
  }

  activeLoads(): number {
    return this.#activeLoads;
  }

  validateGraph(): readonly string[] {
    const errors: string[] = [];
    for (const record of this.#records.values()) {
      const ids = new Set<AssetId>();
      for (const dependency of record.dependencies) {
        if (dependency === record.id) errors.push(`${record.id}: self dependency`);
        if (!this.#records.has(dependency)) errors.push(`${record.id}: missing dependency ${dependency}`);
        if (ids.has(dependency)) errors.push(`${record.id}: duplicate dependency ${dependency}`);
        ids.add(dependency);
      }
      if (record.bytes < 0) errors.push(`${record.id}: negative size`);
    }
    errors.push(...this.#detectCycles());
    return errors;
  }

  snapshot(): readonly AssetRecord[] {
    return this.list();
  }

  stats(): { declared: number; ready: number; failed: number; residentBytes: number; activeLoads: number } {
    let declared = 0, ready = 0, failed = 0;
    for (const record of this.#records.values()) {
      if (record.state === 'declared' || record.state === 'loading' || record.state === 'stale') declared += 1;
      if (record.state === 'ready') ready += 1;
      if (record.state === 'failed') failed += 1;
    }
    return { declared, ready, failed, residentBytes: this.#residentBytes, activeLoads: this.#activeLoads };
  }

  private #ensureResidentCapacity(bytes: number, incomingPriority: number): void {
    if (this.#residentBytes + bytes <= this.#policy.maxBytes) return;
    const candidates = [...this.#records.values()]
      .filter((record) => record.state === 'ready')
      .sort((a, b) => a.priority - b.priority || a.lastUsedFrame - b.lastUsedFrame || a.useCount - b.useCount);
    for (const candidate of candidates) {
      if (this.#residentBytes + bytes <= this.#policy.maxBytes) break;
      if (candidate.priority > incomingPriority) continue;
      this.evict(candidate.id);
    }
    if (this.#residentBytes + bytes > this.#policy.maxBytes) throw new Error('Asset resident memory budget exhausted');
  }

  private #detectCycles(): string[] {
    const errors: string[] = [];
    const visiting = new Set<AssetId>();
    const visited = new Set<AssetId>();
    const visit = (id: AssetId, path: AssetId[]): void => {
      if (visiting.has(id)) {
        errors.push(`Asset dependency cycle: ${[...path, id].join(' -> ')}`);
        return;
      }
      if (visited.has(id)) return;
      visiting.add(id);
      const record = this.#records.get(id);
      for (const dependency of record?.dependencies ?? []) visit(dependency, [...path, id]);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of this.#records.keys()) visit(id, []);
    return errors;
  }
}
