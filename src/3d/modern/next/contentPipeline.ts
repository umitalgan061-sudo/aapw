import { ResourceCache, estimateObjectBytes, type ResourceLoader } from './resourceCache.ts';

export type ContentPriority = 'critical' | 'near' | 'normal' | 'background';

export interface ContentRequest<T> {
  readonly key: string;
  readonly priority: ContentPriority;
  readonly estimatedBytes: number;
  readonly loader: ResourceLoader<T>;
}

export interface ContentResult<T> {
  readonly key: string;
  readonly priority: ContentPriority;
  readonly bytes: number;
  readonly loaded: boolean;
  readonly value?: T;
  readonly error?: string;
}

const PRIORITY_RANK: Record<ContentPriority, number> = { critical: 0, near: 1, normal: 2, background: 3 };

export class ContentHydrationPipeline<T = unknown> {
  readonly cache: ResourceCache<T>;
  readonly maxRequestsPerPump: number;
  #queue: Array<ContentRequest<T>> = [];
  #queuedKeys = new Set<string>();
  #completed = 0;
  #failed = 0;

  constructor(cache: ResourceCache<T>, maxRequestsPerPump = 4) {
    this.cache = cache;
    this.maxRequestsPerPump = Math.max(1, Math.floor(maxRequestsPerPump));
  }

  enqueue(request: ContentRequest<T>): boolean {
    const key = request.key.trim();
    if (!key || this.#queuedKeys.has(key)) return false;
    if (this.cache.records(0).some((record) => record.handle.key === key && record.state === 'ready')) return false;
    this.#queue.push({ ...request, key, estimatedBytes: Math.max(0, request.estimatedBytes) });
    this.#queuedKeys.add(key);
    this.#sort();
    return true;
  }

  cancel(key: string): boolean {
    const normalized = key.trim();
    const before = this.#queue.length;
    this.#queue = this.#queue.filter((request) => request.key !== normalized);
    this.#queuedKeys.delete(normalized);
    return before !== this.#queue.length;
  }

  pending(): readonly ContentRequest<T>[] { return [...this.#queue]; }
  stats(): { queued: number; completed: number; failed: number; cache: ReturnType<ResourceCache<T>['stats']> } { return { queued: this.#queue.length, completed: this.#completed, failed: this.#failed, cache: this.cache.stats() }; }

  async pump(currentTick: number): Promise<ContentResult<T>[]> {
    const batch = this.#queue.splice(0, this.maxRequestsPerPump);
    batch.forEach((request) => this.#queuedKeys.delete(request.key));
    const results: ContentResult<T>[] = [];
    for (const request of batch) {
      try {
        const handle = await this.cache.acquire(request.key, currentTick as never, request.loader);
        const value = this.cache.get(handle, currentTick as never);
        const bytes = value === undefined ? request.estimatedBytes : estimateObjectBytes(value);
        this.#completed += 1;
        results.push({ key: request.key, priority: request.priority, bytes, loaded: true, value });
      } catch (error) {
        this.#failed += 1;
        results.push({ key: request.key, priority: request.priority, bytes: 0, loaded: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return results;
  }

  #sort(): void { this.#queue.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.estimatedBytes - a.estimatedBytes || a.key.localeCompare(b.key)); }
}

export function prioritizeContentDistance(distanceMeters: number, criticalDistance = 25, nearDistance = 120): ContentPriority {
  const distance = Math.max(0, distanceMeters);
  if (distance <= criticalDistance) return 'critical';
  if (distance <= nearDistance) return 'near';
  if (distance <= nearDistance * 4) return 'normal';
  return 'background';
}
