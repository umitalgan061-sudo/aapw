import type { AssetDescriptor, AssetId, Disposable } from './types';
import { AssetRegistry } from './assetRegistry';
import { stableHash } from './eventBus';

export interface AssetPipelineStage<TIn, TOut> {
  readonly name: string;
  readonly priority: number;
  run(input: TIn, signal: AbortSignal): Promise<TOut> | TOut;
}

export interface PipelineResult<T> {
  readonly value: T;
  readonly stages: readonly string[];
  readonly cacheKey: string;
}

export interface AssetPipelineDefinition<T> {
  readonly descriptor: AssetDescriptor;
  readonly stages: readonly AssetPipelineStage<any, any>[];
  readonly finalize?: (value: T) => T | Promise<T>;
}

/** Composable asset processing pipeline; useful for compressed textures, GLTF preprocessing and metadata extraction. */
export class AssetPipeline<T = unknown> implements Disposable {
  private readonly registry: AssetRegistry;
  private readonly definitions = new Map<AssetId, AssetPipelineDefinition<T>>();
  private readonly results = new Map<string, PipelineResult<T>>();
  private disposed = false;

  public constructor(registry: AssetRegistry) { this.registry = registry; }

  public define(definition: AssetPipelineDefinition<T>): void {
    if (this.definitions.has(definition.descriptor.id)) throw new Error(`PIPELINE_REDEFINED:${definition.descriptor.id}`);
    this.definitions.set(definition.descriptor.id, definition);
  }

  public async run(id: AssetId, signal = new AbortController().signal): Promise<PipelineResult<T>> {
    this.ensureActive();
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`PIPELINE_MISSING:${id}`);
    const ordered = [...definition.stages].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
    const cacheKey = stableHash(JSON.stringify({ id, uri: definition.descriptor.uri, stages: ordered.map((stage) => stage.name) })).toString(16);
    const cached = this.results.get(cacheKey);
    if (cached) return cached;
    const handle = await this.registry.acquire(definition.descriptor);
    try {
      let value: unknown = await handle.value;
      const stages: string[] = [];
      for (const stage of ordered) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        value = await stage.run(value, signal);
        stages.push(stage.name);
      }
      if (definition.finalize) value = await definition.finalize(value as T);
      const result: PipelineResult<T> = { value: value as T, stages, cacheKey };
      this.results.set(cacheKey, result);
      return result;
    } finally {
      handle.dispose();
    }
  }

  public invalidate(id: AssetId): number {
    let deleted = 0;
    for (const [key] of this.results) if (key.includes(stableHash(id).toString(16))) { this.results.delete(key); deleted += 1; }
    return deleted;
  }

  public clearCache(): void { this.results.clear(); }
  public size(): number { return this.definitions.size; }
  private ensureActive(): void { if (this.disposed) throw new Error('ASSET_PIPELINE_DISPOSED'); }
  public dispose(): void { this.results.clear(); this.definitions.clear(); this.disposed = true; }
}

export interface BinaryDecodeResult { readonly bytes: Uint8Array; readonly mime: string; readonly sourceBytes: number; }

export const decodeResponseBytes = async (response: Response, signal?: AbortSignal): Promise<BinaryDecodeResult> => {
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const mime = response.headers.get('content-type') ?? 'application/octet-stream';
  const buffer = new Uint8Array(await response.arrayBuffer());
  return { bytes: buffer, mime, sourceBytes: buffer.byteLength };
};

export const createIdentityStage = <T>(name: string, priority = 0): AssetPipelineStage<T, T> => ({ name, priority, run: (value) => value });

export const createMapStage = <TIn, TOut>(name: string, priority: number, map: (value: TIn) => TOut | Promise<TOut>): AssetPipelineStage<TIn, TOut> => ({ name, priority, run: map });
