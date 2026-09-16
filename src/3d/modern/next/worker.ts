export type WorkerTaskKind = 'terrain' | 'pathfinding' | 'visibility' | 'compression' | 'serialization';

export interface WorkerTask<TPayload = unknown> {
  readonly id: number;
  readonly kind: WorkerTaskKind;
  readonly priority: number;
  readonly payload: TPayload;
  readonly createdTick: number;
  readonly estimatedCostMs: number;
}

export interface WorkerResult<TResult = unknown> {
  readonly taskId: number;
  readonly ok: boolean;
  readonly result?: TResult;
  readonly error?: string;
  readonly durationMs: number;
}

export interface WorkerHandler<TPayload = unknown, TResult = unknown> {
  readonly kind: WorkerTaskKind;
  execute(payload: TPayload): TResult | Promise<TResult>;
}

export interface WorkerPoolOptions { readonly concurrency: number; readonly maxQueue: number; }

export class LocalWorkerPool {
  readonly options: WorkerPoolOptions;
  #handlers = new Map<WorkerTaskKind, WorkerHandler<unknown, unknown>>();
  #queue: WorkerTask[] = [];
  #running = 0;
  #nextId = 1;
  #completed = 0;
  #failed = 0;

  constructor(options: Partial<WorkerPoolOptions> = {}) {
    this.options = { concurrency: Math.max(1, Math.floor(options.concurrency ?? 2)), maxQueue: Math.max(16, Math.floor(options.maxQueue ?? 256)) };
  }

  register<TPayload, TResult>(handler: WorkerHandler<TPayload, TResult>): void {
    if (this.#handlers.has(handler.kind)) throw new Error(`worker handler already registered: ${handler.kind}`);
    this.#handlers.set(handler.kind, handler as WorkerHandler<unknown, unknown>);
  }

  enqueue<TPayload>(kind: WorkerTaskKind, payload: TPayload, options: { priority?: number; createdTick?: number; estimatedCostMs?: number } = {}): Promise<WorkerResult> {
    if (this.#queue.length >= this.options.maxQueue) return Promise.reject(new Error('worker queue capacity exceeded'));
    if (!this.#handlers.has(kind)) return Promise.reject(new Error(`worker handler missing: ${kind}`));
    const task: WorkerTask<TPayload> = { id: this.#nextId++, kind, priority: options.priority ?? 0, payload, createdTick: options.createdTick ?? 0, estimatedCostMs: Math.max(0, options.estimatedCostMs ?? 0) };
    return new Promise<WorkerResult>((resolve) => {
      (task as WorkerTask & { resolve?: (result: WorkerResult) => void }).resolve = resolve;
      this.#queue.push(task);
      this.#sortQueue();
      this.#drain();
    });
  }

  pending(): number { return this.#queue.length; }
  running(): number { return this.#running; }
  stats(): { pending: number; running: number; completed: number; failed: number } { return { pending: this.#queue.length, running: this.#running, completed: this.#completed, failed: this.#failed }; }

  async #execute(task: WorkerTask): Promise<void> {
    const handler = this.#handlers.get(task.kind);
    const start = globalThis.performance?.now?.() ?? 0;
    this.#running += 1;
    try {
      const value = await handler!.execute(task.payload);
      this.#completed += 1;
      (task as WorkerTask & { resolve?: (result: WorkerResult) => void }).resolve?.({ taskId: task.id, ok: true, result: value, durationMs: Math.max(0, (globalThis.performance?.now?.() ?? start) - start) });
    } catch (error) {
      this.#failed += 1;
      (task as WorkerTask & { resolve?: (result: WorkerResult) => void }).resolve?.({ taskId: task.id, ok: false, error: error instanceof Error ? error.message : String(error), durationMs: Math.max(0, (globalThis.performance?.now?.() ?? start) - start) });
    } finally {
      this.#running = Math.max(0, this.#running - 1);
      this.#drain();
    }
  }

  #drain(): void {
    while (this.#running < this.options.concurrency && this.#queue.length) {
      const task = this.#queue.shift()!;
      void this.#execute(task);
    }
  }

  #sortQueue(): void { this.#queue.sort((a, b) => a.priority - b.priority || a.estimatedCostMs - b.estimatedCostMs || a.id - b.id); }
}

export function createDefaultWorkerPool(concurrency = 2): LocalWorkerPool {
  const pool = new LocalWorkerPool({ concurrency });
  pool.register({ kind: 'compression', execute: (payload: unknown) => JSON.stringify(payload) });
  pool.register({ kind: 'serialization', execute: (payload: unknown) => JSON.stringify(payload) });
  pool.register({ kind: 'terrain', execute: (payload: { seed: number; count: number }) => {
    const count = Math.max(0, Math.min(1_000_000, Math.floor(payload.count)));
    const values = new Float32Array(count);
    let state = payload.seed >>> 0;
    for (let index = 0; index < count; index += 1) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; values[index] = (state >>> 0) / 0xffffffff; }
    return values;
  } });
  pool.register({ kind: 'pathfinding', execute: (payload: { points: Array<{ x: number; z: number }> }) => payload.points.slice().sort((a, b) => a.x - b.x || a.z - b.z) });
  pool.register({ kind: 'visibility', execute: (payload: { values: readonly boolean[] }) => payload.values.reduce((count, visible) => count + (visible ? 1 : 0), 0) });
  return pool;
}
