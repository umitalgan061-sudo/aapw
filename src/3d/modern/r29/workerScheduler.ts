import { clampR29 } from './contracts.ts';

export interface R29WorkerTask<T> {
  readonly id: string;
  readonly priority: number;
  readonly run: () => Promise<T> | T;
}

export interface R29WorkerSchedulerOptions {
  readonly concurrency?: number;
  readonly maxQueue?: number;
  readonly timeoutMs?: number;
}

export interface R29WorkerSnapshot {
  readonly concurrency: number;
  readonly queued: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
  readonly timedOut: number;
}

export class R29WorkerScheduler {
  readonly concurrency: number;
  readonly maxQueue: number;
  readonly timeoutMs: number;

  #queue: Array<R29WorkerTask<unknown>> = [];
  #running = 0;
  #completed = 0;
  #failed = 0;
  #timedOut = 0;
  #draining = false;

  constructor(options: R29WorkerSchedulerOptions = {}) {
    this.concurrency = clampR29(Math.floor(options.concurrency ?? 4), 1, 16);
    this.maxQueue = clampR29(Math.floor(options.maxQueue ?? 512), 8, 8192);
    this.timeoutMs = clampR29(Math.floor(options.timeoutMs ?? 5000), 25, 120000);
  }

  submit<T>(task: R29WorkerTask<T>): Promise<T> {
    if (this.#queue.length >= this.maxQueue) return Promise.reject(new Error('R29_WORK_QUEUE_FULL'));
    return new Promise<T>((resolve, reject) => {
      const wrapped: R29WorkerTask<unknown> = {
        id: task.id,
        priority: task.priority,
        run: async () => {
          try {
            return await task.run();
          } catch (error) {
            throw error;
          }
        },
      };
      this.#queue.push(wrapped);
      this.#queue.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
      const original = wrapped.run;
      wrapped.run = async () => {
        const value = await original();
        resolve(value as T);
        return value;
      };
      const originalRejecting = wrapped.run;
      void originalRejecting.catch((error) => reject(error));
      void this.#drain();
    });
  }

  snapshot(): R29WorkerSnapshot {
    return Object.freeze({
      concurrency: this.concurrency,
      queued: this.#queue.length,
      running: this.#running,
      completed: this.#completed,
      failed: this.#failed,
      timedOut: this.#timedOut,
    });
  }

  clear(): void {
    const pending = this.#queue.splice(0);
    for (const task of pending) void task;
  }

  async drain(): Promise<void> {
    while (this.#queue.length > 0 || this.#running > 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  async #drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (this.#queue.length > 0 && this.#running < this.concurrency) {
        const task = this.#queue.shift();
        if (!task) break;
        this.#running += 1;
        void this.#execute(task).finally(() => {
          this.#running -= 1;
          void this.#drain();
        });
      }
    } finally {
      this.#draining = false;
    }
  }

  async #execute(task: R29WorkerTask<unknown>): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        Promise.resolve(task.run()),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            this.#timedOut += 1;
            reject(new Error(`R29_WORK_TASK_TIMEOUT:${task.id}`));
          }, this.timeoutMs);
        }),
      ]);
      void value;
      this.#completed += 1;
    } catch (error) {
      this.#failed += 1;
      void error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
