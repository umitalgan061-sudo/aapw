import type { AssetId, EntityId } from './contracts.ts';

export type WorkerRequest =
  | { readonly type: 'generate-chunk'; readonly requestId: number; readonly x: number; readonly z: number; readonly seed: number }
  | { readonly type: 'pathfind'; readonly requestId: number; readonly start: readonly [number, number]; readonly goal: readonly [number, number] }
  | { readonly type: 'build-asset-manifest'; readonly requestId: number; readonly assets: readonly AssetId[] };

export type WorkerResponse =
  | { readonly type: 'chunk-ready'; readonly requestId: number; readonly vertices: readonly number[]; readonly indices: readonly number[] }
  | { readonly type: 'path-ready'; readonly requestId: number; readonly points: readonly (readonly [number, number])[] }
  | { readonly type: 'asset-manifest-ready'; readonly requestId: number; readonly assets: readonly AssetId[] }
  | { readonly type: 'error'; readonly requestId: number; readonly message: string };

export interface WorkerTransport {
  send(message: WorkerRequest): void;
  onMessage(listener: (message: WorkerResponse) => void): () => void;
}

interface Pending<T> {
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
}

export class TypedWorkerBroker {
  #nextRequestId = 1;
  #pending = new Map<number, Pending<WorkerResponse>>();
  #unsubscribe: (() => void) | null = null;

  constructor(private readonly transport: WorkerTransport) {
    this.#unsubscribe = transport.onMessage((message) => this.#handle(message));
  }

  request<T extends WorkerResponse = WorkerResponse>(request: Omit<WorkerRequest, 'requestId'>): Promise<T> {
    const requestId = this.#nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(requestId, { resolve: resolve as (value: WorkerResponse) => void, reject });
      this.transport.send({ ...request, requestId } as WorkerRequest);
    });
  }

  cancelAll(reason = 'worker broker disposed'): void {
    const error = new Error(reason);
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  dispose(): void {
    this.cancelAll();
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  pendingCount(): number {
    return this.#pending.size;
  }

  #handle(message: WorkerResponse): void {
    const pending = this.#pending.get(message.requestId);
    if (!pending) return;
    this.#pending.delete(message.requestId);
    if (message.type === 'error') {
      pending.reject(new Error(message.message));
      return;
    }
    pending.resolve(message);
  }
}

export interface EntityTransferRecord {
  readonly entity: EntityId;
  readonly archetype: string;
  readonly fields: Readonly<Record<string, number | string | boolean>>;
}

export function toTransferableEntities(
  records: readonly EntityTransferRecord[],
): readonly Readonly<EntityTransferRecord>[] {
  return [...records]
    .sort((a, b) => Number(a.entity) - Number(b.entity))
    .map((record) => ({
      entity: record.entity,
      archetype: record.archetype,
      fields: Object.fromEntries(
        Object.entries(record.fields).sort(([a], [b]) => a.localeCompare(b)),
      ),
    }));
}
