import type { PlatformError, ResourceDescriptor, ResourceRecord, Result, TaskPriority, UnixMillis } from './types';
import { platformEvents } from './eventBus';

export interface ResourceLoader<T> {
  readonly load: (descriptor: ResourceDescriptor, signal: AbortSignal) => Promise<T>;
  readonly dispose?: (value: T) => void;
  readonly sizeOf?: (value: T, descriptor: ResourceDescriptor) => number;
}

function toError(cause: unknown): PlatformError {
  return {
    code: 'RESOURCE_LOAD_FAILED',
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
    retryable: true,
  };
}

/** Reference-counted resource registry with priority-aware loading and deterministic eviction. */
export class ResourceRegistry<T = unknown> {
  #records = new Map<string, ResourceRecord<T>>();
  #loaders = new Map<ResourceDescriptor['kind'], ResourceLoader<T>>();
  #now: () => UnixMillis;
  #budgetBytes: number;
  #residentBytes = 0;

  constructor(options: { readonly budgetBytes?: number; readonly now?: () => UnixMillis } = {}) {
    this.#budgetBytes = Math.max(1, options.budgetBytes ?? 512 * 1024 * 1024);
    this.#now = options.now ?? (() => Date.now() as UnixMillis);
  }

  registerLoader(kind: ResourceDescriptor['kind'], loader: ResourceLoader<T>): void {
    this.#loaders.set(kind, loader);
  }

  register(descriptor: ResourceDescriptor): void {
    if (!descriptor.id || !descriptor.url) throw new TypeError('Resource requires id and url');
    const existing = this.#records.get(descriptor.id);
    if (existing?.state === 'ready') return;
    this.#records.set(descriptor.id, {
      descriptor: { ...descriptor, tags: [...descriptor.tags] },
      state: 'registered',
      lastUsedAt: this.#now(),
      residentBytes: 0,
      refCount: 0,
    });
    platformEvents.emit('resource:state', { id: descriptor.id, state: 'registered' });
  }

  async acquire(id: string, signal?: AbortSignal): Promise<Result<T>> {
    const record = this.#records.get(id);
    if (!record) return { ok: false, error: { code: 'RESOURCE_UNKNOWN', message: `Unknown resource ${id}`, retryable: false } };
    if (record.state === 'ready' && record.value !== undefined) {
      this.#records.set(id, { ...record, refCount: record.refCount + 1, lastUsedAt: this.#now() });
      return { ok: true, value: record.value };
    }
    const loader = this.#loaders.get(record.descriptor.kind);
    if (!loader) return { ok: false, error: { code: 'RESOURCE_LOADER_MISSING', message: `No loader for ${record.descriptor.kind}`, retryable: false } };
    this.#records.set(id, { ...record, state: 'loading', lastUsedAt: this.#now() });
    platformEvents.emit('resource:state', { id, state: 'loading' });
    try {
      const value = await loader.load(record.descriptor, signal ?? new AbortController().signal);
      const residentBytes = Math.max(0, Math.floor(loader.sizeOf?.(value, record.descriptor) ?? record.descriptor.bytes ?? 0));
      this.#residentBytes += residentBytes;
      const ready: ResourceRecord<T> = {
        ...record,
        state: 'ready',
        value,
        residentBytes,
        refCount: 1,
        lastUsedAt: this.#now(),
      };
      this.#records.set(id, ready);
      this.#evictToBudget();
      platformEvents.emit('resource:state', { id, state: 'ready' });
      return { ok: true, value };
    } catch (cause) {
      const failed: ResourceRecord<T> = { ...record, state: 'failed', error: toError(cause), lastUsedAt: this.#now() };
      this.#records.set(id, failed);
      platformEvents.emit('resource:state', { id, state: 'failed' });
      return { ok: false, error: failed.error! };
    }
  }

  release(id: string): boolean {
    const record = this.#records.get(id);
    if (!record || record.state !== 'ready' || record.refCount <= 0) return false;
    this.#records.set(id, { ...record, refCount: record.refCount - 1, lastUsedAt: this.#now() });
    return true;
  }

  evict(id: string): boolean {
    const record = this.#records.get(id);
    if (!record || record.state !== 'ready' || record.refCount > 0 || record.value === undefined) return false;
    this.#disposeRecord(record);
    this.#records.set(id, { ...record, state: 'evicted', value: undefined, residentBytes: 0, refCount: 0, lastUsedAt: this.#now() });
    platformEvents.emit('resource:state', { id, state: 'evicted' });
    return true;
  }

  get(id: string): ResourceRecord<T> | undefined {
    const value = this.#records.get(id);
    return value ? { ...value, descriptor: { ...value.descriptor, tags: [...value.descriptor.tags] } } : undefined;
  }

  stats(): { readonly count: number; readonly residentBytes: number; readonly budgetBytes: number; readonly ready: number } {
    let ready = 0;
    for (const record of this.#records.values()) if (record.state === 'ready') ready += 1;
    return { count: this.#records.size, residentBytes: this.#residentBytes, budgetBytes: this.#budgetBytes, ready };
  }

  clear(): void {
    for (const record of this.#records.values()) if (record.state === 'ready') this.#disposeRecord(record);
    this.#records.clear();
    this.#residentBytes = 0;
  }

  #disposeRecord(record: ResourceRecord<T>): void {
    if (record.value === undefined) return;
    const loader = this.#loaders.get(record.descriptor.kind);
    loader?.dispose?.(record.value);
    this.#residentBytes = Math.max(0, this.#residentBytes - record.residentBytes);
  }

  #evictToBudget(): void {
    if (this.#residentBytes <= this.#budgetBytes) return;
    const candidates = [...this.#records.values()]
      .filter((record) => record.state === 'ready' && record.refCount === 0)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt || (a.descriptor.priority as number) - (b.descriptor.priority as number));
    for (const record of candidates) {
      if (this.#residentBytes <= this.#budgetBytes) break;
      this.evict(record.descriptor.id);
    }
  }
}

export function priorityWeight(priority: TaskPriority): number {
  return Math.pow(2, priority);
}
