import type { PriorityBand, R35AssetNode } from './contracts';

export interface AssetRequest {
  readonly key: string;
  readonly uri: string;
  readonly byteSize?: number;
  readonly priority?: PriorityBand;
  readonly dependencies?: readonly string[];
  readonly tags?: readonly string[];
  readonly tick?: number;
}

export interface AssetFetchResult {
  readonly key: string;
  readonly bytes: number;
  readonly ok: boolean;
  readonly error: string | null;
}

export interface AssetOrchestratorConfig {
  readonly maxBytes: number;
  readonly maxConcurrent: number;
  readonly retryLimit: number;
  readonly retryBaseTicks: number;
}

export interface AssetStats {
  readonly nodes: number;
  readonly queued: number;
  readonly loading: number;
  readonly ready: number;
  readonly failed: number;
  readonly residentBytes: number;
  readonly budgetBytes: number;
  readonly utilization: number;
  readonly cacheHits: number;
  readonly evictions: number;
}

const PRIORITY_SCORE: Record<PriorityBand, number> = {
  critical: 100,
  high: 75,
  normal: 50,
  low: 25,
  background: 5,
};

function cloneNode(node: R35AssetNode): R35AssetNode {
  return { ...node, dependencies: [...node.dependencies], tags: [...node.tags] };
}

export class R35AssetOrchestrator {
  readonly config: AssetOrchestratorConfig;
  #nodes = new Map<string, R35AssetNode>();
  #queue = new Set<string>();
  #loading = new Set<string>();
  #residentBytes = 0;
  #tick = 0;
  #cacheHits = 0;
  #evictions = 0;

  constructor(config?: Partial<AssetOrchestratorConfig>) {
    this.config = {
      maxBytes: 512 * 1024 * 1024,
      maxConcurrent: 6,
      retryLimit: 3,
      retryBaseTicks: 30,
      ...config,
    };
    if (this.config.maxBytes <= 0 || this.config.maxConcurrent < 1) throw new RangeError('invalid asset orchestrator config');
  }

  declare(request: AssetRequest): R35AssetNode {
    if (!request.key || !request.uri) throw new Error('asset key and uri are required');
    const current = this.#nodes.get(request.key);
    if (current) {
      this.#cacheHits += current.state === 'ready' ? 1 : 0;
      return cloneNode(current);
    }
    const node: R35AssetNode = Object.freeze({
      key: request.key,
      uri: request.uri,
      byteSize: Math.max(1, Math.floor(request.byteSize ?? 1)),
      priority: request.priority ?? 'normal',
      dependencies: Object.freeze([...(request.dependencies ?? [])]),
      tags: Object.freeze([...(request.tags ?? [])]),
      state: 'idle',
      refs: 0,
      attempts: 0,
      lastUsedTick: request.tick ?? this.#tick,
    });
    this.#nodes.set(request.key, node);
    return cloneNode(node);
  }

  acquire(key: string, tick = this.#tick): R35AssetNode {
    const node = this.require(key);
    this.#nodes.set(key, Object.freeze({ ...node, refs: node.refs + 1, lastUsedTick: tick }));
    return this.snapshot(key)!;
  }

  release(key: string, tick = this.#tick): R35AssetNode | null {
    const node = this.#nodes.get(key);
    if (!node) return null;
    this.#nodes.set(key, Object.freeze({ ...node, refs: Math.max(0, node.refs - 1), lastUsedTick: tick }));
    return this.snapshot(key);
  }

  enqueue(key: string, tick = this.#tick): void {
    const node = this.require(key);
    if (node.state === 'ready' || node.state === 'loading' || node.state === 'queued') return;
    this.#nodes.set(key, Object.freeze({ ...node, state: 'queued', lastUsedTick: tick }));
    this.#queue.add(key);
    for (const dependency of node.dependencies) {
      if (!this.#nodes.has(dependency)) continue;
      this.enqueue(dependency, tick);
    }
  }

  async pump(
    tick: number,
    fetcher: (node: R35AssetNode) => Promise<AssetFetchResult>,
  ): Promise<readonly AssetFetchResult[]> {
    this.#tick = tick;
    const results: AssetFetchResult[] = [];
    const candidates = [...this.#queue]
      .map((key) => this.#nodes.get(key))
      .filter((node): node is R35AssetNode => Boolean(node))
      .sort((a, b) => {
        const priority = PRIORITY_SCORE[b.priority] - PRIORITY_SCORE[a.priority];
        if (priority !== 0) return priority;
        if (a.lastUsedTick !== b.lastUsedTick) return b.lastUsedTick - a.lastUsedTick;
        return a.key.localeCompare(b.key);
      });

    while (this.#loading.size < this.config.maxConcurrent && candidates.length > 0) {
      const node = candidates.shift();
      if (!node) break;
      this.#queue.delete(node.key);
      this.#loading.add(node.key);
      const active = Object.freeze({ ...node, state: 'loading' as const, attempts: node.attempts + 1 });
      this.#nodes.set(node.key, active);

      if (!this.dependenciesReadyForLoad(node)) {
        this.#queue.add(node.key);
        this.#nodes.set(node.key, Object.freeze({ ...active, state: 'queued' as const }));
        this.#loading.delete(node.key);
        continue;
      }
      const result = await fetcher(active);
      this.#loading.delete(node.key);
      results.push(result);

      if (result.ok) {
        this.#nodes.set(
          node.key,
          Object.freeze({ ...active, state: 'ready' as const, lastUsedTick: tick }),
        );
        this.#residentBytes += Math.max(0, result.bytes);
      } else {
        const nextState: R35AssetNode['state'] = active.attempts >= this.config.retryLimit ? 'failed' : 'queued';
        this.#nodes.set(node.key, Object.freeze({ ...active, state: nextState }));
        if (nextState === 'queued') this.#queue.add(node.key);
      }
    }

    this.evictIfNeeded();
    return Object.freeze(results);
  }

  markEvictable(key: string, tick = this.#tick): boolean {
    const node = this.#nodes.get(key);
    if (!node || node.refs > 0 || node.state !== 'ready') return false;
    this.#nodes.set(key, Object.freeze({ ...node, lastUsedTick: Math.min(node.lastUsedTick, tick - 1_000_000) }));
    return true;
  }

  evict(key: string): boolean {
    const node = this.#nodes.get(key);
    if (!node || node.refs > 0 || node.state !== 'ready') return false;
    this.#residentBytes = Math.max(0, this.#residentBytes - node.byteSize);
    this.#nodes.set(key, Object.freeze({ ...node, state: 'evicted' as const }));
    this.#evictions += 1;
    return true;
  }

  evictIfNeeded(): number {
    let count = 0;
    while (this.#residentBytes > this.config.maxBytes) {
      const candidates = [...this.#nodes.values()]
        .filter((node) => node.state === 'ready' && node.refs === 0)
        .sort((a, b) => {
          if (a.priority !== b.priority) return PRIORITY_SCORE[a.priority] - PRIORITY_SCORE[b.priority];
          if (a.lastUsedTick !== b.lastUsedTick) return a.lastUsedTick - b.lastUsedTick;
          return a.key.localeCompare(b.key);
        });
      const candidate = candidates[0];
      if (!candidate || !this.evict(candidate.key)) break;
      count += 1;
    }
    return count;
  }

  dependencyReady(key: string): boolean {
    const node = this.#nodes.get(key);
    if (!node) return false;
    return node.dependencies.every((dependency) => this.#nodes.get(dependency)?.state === 'ready');
  }

  snapshot(key?: string): R35AssetNode | R35AssetNode[] | null {
    if (key !== undefined) {
      const node = this.#nodes.get(key);
      return node ? cloneNode(node) : null;
    }
    return [...this.#nodes.values()].sort((a, b) => a.key.localeCompare(b.key)).map(cloneNode);
  }

  stats(): AssetStats {
    let queued = 0;
    let loading = 0;
    let ready = 0;
    let failed = 0;
    for (const node of this.#nodes.values()) {
      if (node.state === 'queued') queued += 1;
      if (node.state === 'loading') loading += 1;
      if (node.state === 'ready') ready += 1;
      if (node.state === 'failed') failed += 1;
    }
    return {
      nodes: this.#nodes.size,
      queued,
      loading,
      ready,
      failed,
      residentBytes: this.#residentBytes,
      budgetBytes: this.config.maxBytes,
      utilization: this.#residentBytes / this.config.maxBytes,
      cacheHits: this.#cacheHits,
      evictions: this.#evictions,
    };
  }

  reset(): void {
    this.#nodes.clear();
    this.#queue.clear();
    this.#loading.clear();
    this.#residentBytes = 0;
    this.#tick = 0;
    this.#cacheHits = 0;
    this.#evictions = 0;
  }

  private dependenciesReadyForLoad(node: R35AssetNode): boolean {
    return node.dependencies.every((dependency) => this.#nodes.get(dependency)?.state === 'ready');
  }

  private require(key: string): R35AssetNode {
    const node = this.#nodes.get(key);
    if (!node) throw new Error('unknown asset ' + key);
    return node;
  }
}
