import type { PriorityBand } from './contracts';

export interface WorkerTask<T = unknown, R = unknown> {
  readonly id: string;
  readonly priority: PriorityBand;
  readonly payload: T;
  readonly execute: (payload: T, signal: AbortSignal) => Promise<R> | R;
}

export interface WorkerResult<R = unknown> {
  readonly id: string;
  readonly ok: boolean;
  readonly value: R | null;
  readonly error: string | null;
  readonly durationMs: number;
}

export interface WorkerPoolStats {
  readonly capacity: number;
  readonly running: number;
  readonly queued: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
}

const SCORE: Record<PriorityBand, number> = {
  critical: 100,
  high: 75,
  normal: 50,
  low: 25,
  background: 5,
};

interface InternalTask<T, R> {
  task: WorkerTask<T, R>;
  controller: AbortController;
  resolve: (result: WorkerResult<R>) => void;
}

export class R35WorkerPool {
  readonly capacity: number;
  #queue: InternalTask<unknown, unknown>[] = [];
  #running = new Map<string, InternalTask<unknown, unknown>>();
  #completed = 0;
  #failed = 0;
  #cancelled = 0;
  #sequence = 0;

  constructor(capacity = 4) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('worker pool capacity must be >= 1');
    this.capacity = capacity;
  }

  submit<T, R>(task: Omit<WorkerTask<T, R>, 'id'> & { readonly id?: string }): Promise<WorkerResult<R>> {
    const id = task.id ?? 'worker-' + (++this.#sequence);
    if (this.#queue.some((entry) => entry.task.id === id) || this.#running.has(id)) {
      return Promise.resolve({
        id,
        ok: false,
        value: null,
        error: 'duplicate task id',
        durationMs: 0,
      });
    }

    return new Promise<WorkerResult<R>>((resolve) => {
      this.#queue.push({
        task: { ...task, id },
        controller: new AbortController(),
        resolve: resolve as (result: WorkerResult<unknown>) => void,
      });
      this.#pump();
    });
  }

  cancel(id: string): boolean {
    const queuedIndex = this.#queue.findIndex((entry) => entry.task.id === id);
    if (queuedIndex >= 0) {
      const [entry] = this.#queue.splice(queuedIndex, 1);
      entry?.controller.abort();
      this.#cancelled += 1;
      entry?.resolve({
        id,
        ok: false,
        value: null,
        error: 'cancelled',
        durationMs: 0,
      });
      return true;
    }
    const running = this.#running.get(id);
    if (!running) return false;
    running.controller.abort();
    return true;
  }

  clearQueued(): number {
    const count = this.#queue.length;
    for (const entry of this.#queue) {
      entry.controller.abort();
      this.#cancelled += 1;
      entry.resolve({
        id: entry.task.id,
        ok: false,
        value: null,
        error: 'cancelled',
        durationMs: 0,
      });
    }
    this.#queue.length = 0;
    return count;
  }

  pending(): readonly string[] {
    return this.#queue
      .slice()
      .sort((a, b) => SCORE[b.task.priority] - SCORE[a.task.priority])
      .map((entry) => entry.task.id);
  }

  stats(): WorkerPoolStats {
    return {
      capacity: this.capacity,
      running: this.#running.size,
      queued: this.#queue.length,
      completed: this.#completed,
      failed: this.#failed,
      cancelled: this.#cancelled,
    };
  }

  async drain(): Promise<void> {
    while (this.#queue.length > 0 || this.#running.size > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  private #pump(): void {
    this.#queue.sort((a, b) => SCORE[b.task.priority] - SCORE[a.task.priority] || a.task.id.localeCompare(b.task.id));
    while (this.#running.size < this.capacity && this.#queue.length > 0) {
      const entry = this.#queue.shift();
      if (!entry) break;
      this.#running.set(entry.task.id, entry);
      void this.#run(entry);
    }
  }

  private async #run(entry: InternalTask<unknown, unknown>): Promise<void> {
    const started = performance.now();
    try {
      const value = await entry.task.execute(entry.task.payload, entry.controller.signal);
      if (entry.controller.signal.aborted) {
        this.#cancelled += 1;
        entry.resolve({
          id: entry.task.id,
          ok: false,
          value: null,
          error: 'cancelled',
          durationMs: Math.max(0, performance.now() - started),
        });
      } else {
        this.#completed += 1;
        entry.resolve({
          id: entry.task.id,
          ok: true,
          value,
          error: null,
          durationMs: Math.max(0, performance.now() - started),
        });
      }
    } catch (error) {
      this.#failed += 1;
      entry.resolve({
        id: entry.task.id,
        ok: false,
        value: null,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Math.max(0, performance.now() - started),
      });
    } finally {
      this.#running.delete(entry.task.id);
      this.#pump();
    }
  }
}
