import {
  AssetGraphRuntime,
  type AssetNodeState,
  type AssetLoader,
} from '../r27/assetPipeline.ts';
import type { AssetDefinition, AssetId } from '../r27/contracts.ts';

export interface AssetCoordinatorOptions {
  readonly maxConcurrent: number;
  readonly maxWeight: number;
  readonly requestTimeoutMs: number;
}

export interface AssetRequestResult {
  readonly requested: readonly AssetId[];
  readonly ready: readonly AssetId[];
  readonly failed: readonly AssetId[];
  readonly evicted: readonly AssetId[];
}

export class RuntimeAssetCoordinator {
  readonly graph: AssetGraphRuntime;
  readonly options: AssetCoordinatorOptions;
  #requested = new Set<AssetId>();

  constructor(options: Partial<AssetCoordinatorOptions> = {}) {
    this.options = Object.freeze({
      maxConcurrent: Math.max(1, Math.floor(options.maxConcurrent ?? 6)),
      maxWeight: Math.max(1, options.maxWeight ?? 1024),
      requestTimeoutMs: Math.max(250, Math.floor(options.requestTimeoutMs ?? 15_000)),
    });
    this.graph = new AssetGraphRuntime({
      maxConcurrent: this.options.maxConcurrent,
      maxWeight: this.options.maxWeight,
    });
  }

  register(definition: AssetDefinition): void {
    this.graph.register(definition);
  }

  registerMany(definitions: readonly AssetDefinition[]): void {
    for (const definition of definitions) this.register(definition);
  }

  request(ids: readonly AssetId[]): void {
    for (const id of ids) this.#requested.add(id);
  }

  release(ids: readonly AssetId[]): void {
    for (const id of ids) this.#requested.delete(id);
  }

  async sync(loader: AssetLoader, tick: number, signal?: AbortSignal): Promise<AssetRequestResult> {
    const localController = new AbortController();
    const timeout = setTimeout(() => localController.abort('asset-coordinator-timeout'), this.options.requestTimeoutMs);
    const abortParent = (): void => localController.abort(signal?.reason);
    signal?.addEventListener('abort', abortParent, { once: true });

    try {
      const states = await this.graph.execute(tick, [...this.#requested], loader, localController.signal);
      return summarizeAssetStates([...this.#requested], states);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortParent);
    }
  }

  touch(id: AssetId, tick: number): void {
    this.graph.touch(id, tick);
  }

  state(id: AssetId): AssetNodeState | undefined {
    return this.graph.get(id);
  }

  snapshot(): readonly AssetNodeState[] {
    return this.graph.snapshot();
  }
}

function summarizeAssetStates(
  requested: readonly AssetId[],
  states: readonly AssetNodeState[],
): AssetRequestResult {
  const ready = states.filter((state) => state.state === 'ready').map((state) => state.definition.id);
  const failed = states.filter((state) => state.state === 'failed').map((state) => state.definition.id);
  const evicted = states.filter((state) => state.state === 'evicted').map((state) => state.definition.id);
  return {
    requested: [...requested].sort((a, b) => String(a).localeCompare(String(b))),
    ready: ready.sort((a, b) => String(a).localeCompare(String(b))),
    failed: failed.sort((a, b) => String(a).localeCompare(String(b))),
    evicted: evicted.sort((a, b) => String(a).localeCompare(String(b))),
  };
}
