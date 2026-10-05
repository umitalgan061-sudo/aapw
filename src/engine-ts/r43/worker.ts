import { stableDigest, type Result, type WorkPriority } from './contracts.ts';

export interface WorkItem<T> {
  readonly id: string;
  readonly priority: WorkPriority;
  readonly payload: T;
  readonly budgetMs: number;
  readonly createdAtFrame: number;
}

export interface WorkResult<R> {
  readonly id: string;
  readonly ok: boolean;
  readonly value?: R;
  readonly error?: string;
  readonly elapsedMs: number;
}

const PRIORITY: Record<WorkPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
};

export class CooperativeWorkQueue<T, R> {
  readonly capacity: number;
  #queue: WorkItem<T>[] = [];
  #completed: WorkResult<R>[] = [];

  constructor(capacity = 512) {
    this.capacity = Math.max(16, Math.trunc(capacity));
  }

  enqueue(item: WorkItem<T>): Result<true> {
    if (this.#queue.length >= this.capacity) {
      return { ok: false, error: { code: 'WORK_QUEUE_FULL', message: 'Cooperative work queue is full.', retryable: true } };
    }
    if (this.#queue.some((entry) => entry.id === item.id)) {
      return { ok: false, error: { code: 'WORK_DUPLICATE_ID', message: 'Work id already queued.', retryable: false } };
    }
    this.#queue.push(Object.freeze({
      ...item,
      id: String(item.id).slice(0, 128),
      budgetMs: Math.max(0.1, Number.isFinite(item.budgetMs) ? item.budgetMs : 1),
    }));
    this.#queue.sort((a, b) => {
      const priority = PRIORITY[a.priority] - PRIORITY[b.priority];
      return priority !== 0 ? priority : a.id.localeCompare(b.id);
    });
    return { ok: true, value: true };
  }

  drain(budgetMs: number, executor: (payload: T) => R): readonly WorkResult<R>[] {
    let remaining = Math.max(0.1, Number.isFinite(budgetMs) ? budgetMs : 0.1);
    const completed: WorkResult<R>[] = [];
    while (this.#queue.length > 0 && remaining > 0) {
      const item = this.#queue.shift();
      if (!item) break;
      const before = typeof performance !== 'undefined' ? performance.now() : 0;
      try {
        const value = executor(item.payload);
        const elapsedMs = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : 0) - before);
        const result = Object.freeze({ id: item.id, ok: true, value, elapsedMs });
        completed.push(result);
        this.#completed.push(result);
        remaining -= Math.max(elapsedMs, item.budgetMs);
      } catch (error) {
        const elapsedMs = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : 0) - before);
        const result = Object.freeze({ id: item.id, ok: false, error: String(error), elapsedMs });
        completed.push(result);
        this.#completed.push(result);
        remaining -= Math.max(elapsedMs, item.budgetMs);
      }
    }
    while (this.#completed.length > 1024) this.#completed.shift();
    return Object.freeze(completed);
  }

  queued(): number {
    return this.#queue.length;
  }

  completed(): number {
    return this.#completed.length;
  }

  completedDigest(): string {
    return stableDigest(this.#completed);
  }

  clear(): void {
    this.#queue = [];
    this.#completed = [];
  }
}

export class DeterministicWorkerPool<T, R> {
  readonly workers: number;
  readonly queue: CooperativeWorkQueue<T, R>;

  constructor(workers = 2, queueCapacity = 512) {
    this.workers = Math.max(1, Math.min(16, Math.trunc(workers)));
    this.queue = new CooperativeWorkQueue<T, R>(queueCapacity);
  }

  submit(item: WorkItem<T>): Result<true> {
    return this.queue.enqueue(item);
  }

  runFrame(frameBudgetMs: number, executor: (payload: T) => R): readonly WorkResult<R>[] {
    return this.queue.drain(Math.max(0.1, frameBudgetMs) * this.workers, executor);
  }
}
