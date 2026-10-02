
import type { Priority, WorkItem, WorkResult } from './types.ts';

export interface WorkerPoolOptions {
  readonly concurrency?: number;
  readonly maxQueue?: number;
  readonly maxHistory?: number;
}

export interface WorkerTask<T = unknown> {
  readonly id: string;
  readonly priority: Priority;
  readonly payload: T;
  readonly run: (payload: T) => void | Promise<void>;
}

export interface WorkerPoolSnapshot {
  readonly concurrency: number;
  readonly running: number;
  readonly queued: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
}

const PRIORITY: Readonly<Record<Priority, number>> = Object.freeze({
  critical: 100,
  high: 80,
  normal: 60,
  low: 40,
  background: 20,
});

export class WorkerPoolR41 {
  readonly concurrency: number;
  readonly maxQueue: number;
  readonly maxHistory: number;
  #queue: WorkerTask[] = [];
  #running = 0;
  #completed = 0;
  #failed = 0;
  #cancelled = 0;
  #history: WorkResult[] = [];

  constructor(options: WorkerPoolOptions = {}) {
    this.concurrency = Math.max(1, Math.trunc(options.concurrency ?? 4));
    this.maxQueue = Math.max(this.concurrency, Math.trunc(options.maxQueue ?? 128));
    this.maxHistory = Math.max(16, Math.trunc(options.maxHistory ?? 512));
  }

  enqueue<T>(task: WorkerTask<T>): boolean {
    if (!task.id || this.#queue.length >= this.maxQueue) return false;
    if (this.#queue.some(existing => existing.id === task.id)) return false;
    this.#queue.push(Object.freeze({ ...task }) as WorkerTask);
    this.#queue.sort((a, b) => PRIORITY[b.priority] - PRIORITY[a.priority] || a.id.localeCompare(b.id));
    return true;
  }

  cancel(id: string): boolean {
    const index = this.#queue.findIndex(task => task.id === id);
    if (index < 0) return false;
    this.#queue.splice(index, 1);
    this.#cancelled += 1;
    this.record({
      id,
      class: 'background',
      started: false,
      completed: false,
      deferred: false,
      failed: false,
      reason: 'cancelled',
      elapsedMs: 0,
    });
    return true;
  }

  async drain(now: () => number = defaultNow): Promise<readonly WorkResult[]> {
    const pending: Promise<void>[] = [];
    while (this.#running < this.concurrency && this.#queue.length) {
      const task = this.#queue.shift();
      if (!task) break;
      this.#running += 1;
      const started = now();
      const run = (async (): Promise<void> => {
        try {
          await task.run(task.payload);
          this.#completed += 1;
          this.record({
            id: task.id,
            class: 'background',
            started: true,
            completed: true,
            deferred: false,
            failed: false,
            reason: null,
            elapsedMs: Math.max(0, now() - started),
          });
        } catch (error) {
          this.#failed += 1;
          this.record({
            id: task.id,
            class: 'background',
            started: true,
            completed: false,
            deferred: false,
            failed: true,
            reason: error instanceof Error ? error.message : String(error),
            elapsedMs: Math.max(0, now() - started),
          });
        } finally {
          this.#running -= 1;
        }
      })();
      pending.push(run);
    }
    await Promise.all(pending);
    if (this.#queue.length) await this.drain(now);
    return this.history();
  }

  running(): number { return this.#running; }
  queued(): number { return this.#queue.length; }
  activeCount(): number { return this.#running; }

  history(): readonly WorkResult[] {
    return Object.freeze([...this.#history]);
  }

  snapshot(): WorkerPoolSnapshot {
    return Object.freeze({
      concurrency: this.concurrency,
      running: this.#running,
      queued: this.#queue.length,
      completed: this.#completed,
      failed: this.#failed,
      cancelled: this.#cancelled,
    });
  }

  reset(): void {
    this.#queue = [];
    this.#running = 0;
    this.#completed = 0;
    this.#failed = 0;
    this.#cancelled = 0;
    this.#history = [];
  }

  private record(result: WorkResult): void {
    this.#history.push(Object.freeze(result));
    if (this.#history.length > this.maxHistory) this.#history.shift();
  }
}

export class SerialWorkerR41<T> {
  #running = false;
  readonly run: (payload: T) => void | Promise<void>;

  constructor(run: (payload: T) => void | Promise<void>) {
    this.run = run;
  }

  get running(): boolean { return this.#running; }

  async execute(payload: T): Promise<boolean> {
    if (this.#running) return false;
    this.#running = true;
    try {
      await this.run(payload);
      return true;
    } finally {
      this.#running = false;
    }
  }
}

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;
}
