import { TaskLane, clamp, stableNumber } from './contracts.ts';

export interface WorkerJob<T> {
  readonly id: number;
  readonly lane: TaskLane;
  readonly priority: number;
  readonly createdFrame: number;
  readonly run: (signal: AbortSignal) => Promise<T> | T;
}

export interface WorkerResult<T> { readonly id: number; readonly lane: TaskLane; readonly ok: boolean; readonly value?: T; readonly error?: string; readonly durationMs: number }
export interface WorkerMetrics { readonly queued: number; readonly active: number; readonly completed: number; readonly failed: number; readonly cancelled: number; readonly totalMs: number }

export class DeterministicWorkerPool {
  readonly #concurrency: number;
  readonly #queue: WorkerJob<unknown>[] = [];
  readonly #active = new Map<number, AbortController>();
  #nextId = 1;
  #completed = 0;
  #failed = 0;
  #cancelled = 0;
  #totalMs = 0;

  constructor(concurrency = 4) { this.#concurrency = Math.max(1, Math.floor(concurrency)); }

  enqueue<T>(job: Omit<WorkerJob<T>, 'id' | 'createdFrame'> & { readonly createdFrame?: number }): number {
    const id = this.#nextId++;
    this.#queue.push(Object.freeze({ ...job, id, createdFrame: job.createdFrame ?? 0 }) as WorkerJob<unknown>);
    this.#queue.sort((a, b) => b.priority - a.priority || a.createdFrame - b.createdFrame || a.id - b.id);
    return id;
  }

  cancel(id: number): boolean {
    const index = this.#queue.findIndex((job) => job.id === id);
    if (index >= 0) { this.#queue.splice(index, 1); this.#cancelled += 1; return true; }
    const controller = this.#active.get(id);
    if (!controller) return false;
    controller.abort();
    this.#cancelled += 1;
    return true;
  }

  async pump(now: () => number = performance.now()): Promise<readonly WorkerResult<unknown>[]> {
    const started: Promise<WorkerResult<unknown>>[] = [];
    while (this.#active.size < this.#concurrency && this.#queue.length > 0) {
      const job = this.#queue.shift()!;
      const controller = new AbortController();
      this.#active.set(job.id, controller);
      const begin = now();
      started.push(Promise.resolve().then(() => job.run(controller.signal)).then((value) => {
        const duration = stableNumber(Math.max(0, now() - begin));
        this.#completed += 1; this.#totalMs += duration;
        return Object.freeze({ id: job.id, lane: job.lane, ok: true, value, durationMs: duration });
      }).catch((error) => {
        const duration = stableNumber(Math.max(0, now() - begin));
        if (controller.signal.aborted) this.#cancelled += 1; else this.#failed += 1;
        return Object.freeze({ id: job.id, lane: job.lane, ok: false, error: String(error), durationMs: duration });
      }).finally(() => this.#active.delete(job.id)));
    }
    return Object.freeze(await Promise.all(started));
  }

  metrics(): WorkerMetrics { return Object.freeze({ queued: this.#queue.length, active: this.#active.size, completed: this.#completed, failed: this.#failed, cancelled: this.#cancelled, totalMs: stableNumber(this.#totalMs) }); }
  shutdown(): void { for (const controller of this.#active.values()) controller.abort(); this.#queue.length = 0; }
}

export interface ParallelBatch<T, R> { readonly items: readonly T[]; readonly worker: (item: T, index: number, signal: AbortSignal) => Promise<R> | R; readonly concurrency?: number }

export const mapParallel = async <T, R>({ items, worker, concurrency = 4 }: ParallelBatch<T, R>): Promise<readonly R[]> => {
  const output = Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(items.length, Math.max(1, Math.floor(concurrency))) }, async () => {
    const controller = new AbortController();
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index]!, index, controller.signal);
    }
  });
  await Promise.all(runners);
  return Object.freeze(output);
};

export const boundedConcurrency = (requested: number, hardwareConcurrency = 4): number => clamp(Math.floor(requested), 1, Math.max(1, Math.floor(hardwareConcurrency)));
