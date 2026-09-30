import type { AssetDefinition, AssetId, AssetState } from './contracts.ts';

export interface AssetNodeState {
  readonly definition: AssetDefinition;
  readonly state: AssetState;
  readonly attempts: number;
  readonly nextRetryTick: number;
  readonly error?: string;
  readonly lastUsedTick: number;
  readonly loadedWeight: number;
}

export interface AssetLoader {
  load(definition: AssetDefinition, signal: AbortSignal): Promise<number>;
  unload(definition: AssetDefinition): Promise<void> | void;
}

export interface AssetOperation {
  readonly asset: AssetId;
  readonly type: 'load' | 'unload';
  readonly priority: number;
  readonly scheduledTick: number;
}

export interface AssetPipelineConfig {
  readonly maxConcurrent: number;
  readonly maxWeight: number;
  readonly maxAttempts: number;
  readonly baseRetryTicks: number;
}

export class AssetGraphRuntime {
  readonly config: AssetPipelineConfig;
  #nodes = new Map<AssetId, AssetNodeState>();
  #inFlight = new Set<AssetId>();

  constructor(config: Partial<AssetPipelineConfig> = {}) {
    this.config = Object.freeze({
      maxConcurrent: Math.max(1, Math.floor(config.maxConcurrent ?? 6)),
      maxWeight: Math.max(1, config.maxWeight ?? 1024),
      maxAttempts: Math.max(1, Math.floor(config.maxAttempts ?? 3)),
      baseRetryTicks: Math.max(1, Math.floor(config.baseRetryTicks ?? 30)),
    });
  }

  register(definition: AssetDefinition): void {
    if (definition.weight < 0 || definition.priority < 0) throw new RangeError('Invalid asset weight/priority');
    this.#nodes.set(definition.id, {
      definition,
      state: 'queued',
      attempts: 0,
      nextRetryTick: 0,
      lastUsedTick: 0,
      loadedWeight: 0,
    });
  }

  registerMany(definitions: readonly AssetDefinition[]): void {
    for (const definition of definitions) this.register(definition);
  }

  get(id: AssetId): AssetNodeState | undefined {
    return this.#nodes.get(id);
  }

  plan(tick: number, requested: readonly AssetId[]): readonly AssetOperation[] {
    const operations: AssetOperation[] = [];
    const visited = new Set<string>();

    const visit = (id: AssetId, priority: number): void => {
      const key = String(id);
      if (visited.has(key)) return;
      visited.add(key);
      const node = this.#nodes.get(id);
      if (!node) return;
      for (const dependency of [...node.definition.dependencies].sort((a, b) => String(a).localeCompare(String(b)))) {
        visit(dependency, Math.max(0, priority - 1));
      }
      if (node.state === 'ready' || node.state === 'loading') {
        return;
      }
      if (node.state === 'failed' && node.nextRetryTick > tick) return;
      operations.push({
        asset: id,
        type: 'load',
        priority: Math.max(priority, node.definition.priority),
        scheduledTick: tick,
      });
    };

    for (const id of requested) visit(id, this.#nodes.get(id)?.definition.priority ?? 0);
    return operations.sort((a, b) => b.priority - a.priority || String(a.asset).localeCompare(String(b.asset)));
  }

  async execute(
    tick: number,
    requested: readonly AssetId[],
    loader: AssetLoader,
    signal: AbortSignal,
  ): Promise<readonly AssetNodeState[]> {
    const plan = this.plan(tick, requested).slice(0, this.config.maxConcurrent);
    const results: AssetNodeState[] = [];
    for (const operation of plan) {
      if (signal.aborted) break;
      const node = this.#nodes.get(operation.asset);
      if (!node || this.#inFlight.has(operation.asset)) continue;
      this.#inFlight.add(operation.asset);
      this.#nodes.set(operation.asset, { ...node, state: 'loading' });
      try {
        const loadedWeight = await loader.load(node.definition, signal);
        if (signal.aborted) {
          this.#nodes.set(operation.asset, { ...node, state: 'cancelled', attempts: node.attempts, lastUsedTick: tick, loadedWeight: 0 });
          continue;
        }
        const next = {
          ...node,
          state: 'ready' as const,
          attempts: node.attempts + 1,
          nextRetryTick: 0,
          lastUsedTick: tick,
          loadedWeight: Math.max(0, loadedWeight),
        };
        this.#nodes.set(operation.asset, next);
        results.push(next);
      } catch (error) {
        const attempts = node.attempts + 1;
        const failed = {
          ...node,
          state: 'failed' as const,
          attempts,
          nextRetryTick: tick + this.config.baseRetryTicks * Math.max(1, 2 ** Math.max(0, attempts - 1)),
          error: error instanceof Error ? error.message : String(error),
          lastUsedTick: tick,
        };
        this.#nodes.set(operation.asset, failed);
        results.push(failed);
      } finally {
        this.#inFlight.delete(operation.asset);
      }
    }
    await this.#evictIfNeeded(loader);
    return results;
  }

  touch(id: AssetId, tick: number): void {
    const node = this.#nodes.get(id);
    if (node) this.#nodes.set(id, { ...node, lastUsedTick: tick });
  }

  loadedWeight(): number {
    return [...this.#nodes.values()].reduce((sum, node) => sum + (node.state === 'ready' ? node.loadedWeight : 0), 0);
  }

  snapshot(): readonly AssetNodeState[] {
    return [...this.#nodes.values()]
      .sort((a, b) => String(a.definition.id).localeCompare(String(b.definition.id)));
  }

  async #evictIfNeeded(loader: AssetLoader): Promise<void> {
    let weight = this.loadedWeight();
    if (weight <= this.config.maxWeight) return;

    const candidates = [...this.#nodes.values()]
      .filter((node) => node.state === 'ready')
      .sort((a, b) => a.definition.priority - b.definition.priority || a.lastUsedTick - b.lastUsedTick || String(a.definition.id).localeCompare(String(b.definition.id)));

    for (const node of candidates) {
      if (weight <= this.config.maxWeight) break;
      await loader.unload(node.definition);
      weight -= node.loadedWeight;
      this.#nodes.set(node.definition.id, { ...node, state: 'evicted', loadedWeight: 0 });
    }
  }
}
