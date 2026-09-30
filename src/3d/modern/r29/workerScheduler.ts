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

interface PendingTask<T> extends R29WorkerTask<T> {
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
  readonly enqueueOrder: number;
}

export class R29WorkerScheduler {
  readonly concurrency: number;
  readonly maxQueue: number;
  readonly timeoutMs: number;

  #queue: Array<PendingTask<unknown>> = [];
  #running = 0;
  #completed = 0;
  #failed = 0;
  #timedOut = 0;
  #drainScheduled = false;
  #enqueueOrder = 0;

  constructor(options: R29WorkerSchedulerOptions = {}) {
    this.concurrency = clampR29(Math.floor(options.concurrency ?? 4), 1, 16);
    this.maxQueue = clampR29(Math.floor(options.maxQueue ?? 512), 8, 8192);
    this.timeoutMs = clampR29(Math.floor(options.timeoutMs ?? 5000), 25, 120000);
  }

  submit<T>(task: R29WorkerTask<T>): Promise<T> {
    if (!task.id.trim()) return Promise.reject(new Error('R29_WORK_TASK_ID_EMPTY'));
    if (this.#queue.length >= this.maxQueue) return Promise.reject(new Error('R29_WORK_QUEUE_FULL'));
    return new Promise<T>((resolve, reject) => {
      this.#queue.push({
        id: task.id,
        priority: Number.isFinite(task.priority) ? task.priority : 0,
        run: task.run,
        resolve,
        reject,
        enqueueOrder: this.#enqueueOrder++,
      });
      this.#scheduleDrain();
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
    for (const task of pending) task.reject(new Error('R29_WORK_QUEUE_CLEARED'));
  }

  async drain(): Promise<void> {
    while (this.#queue.length > 0 || this.#running > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  #scheduleDrain(): void {
    if (this.#drainScheduled) return;
    this.#drainScheduled = true;
    queueMicrotask(() => {
      this.#drainScheduled = false;
      void this.#drain();
    });
  }

  async #drain(): Promise<void> {
    this.#queue.sort((a, b) =>
      b.priority - a.priority ||
      a.enqueueOrder - b.enqueueOrder ||
      a.id.localeCompare(b.id),
    );
    while (this.#queue.length > 0 && this.#running < this.concurrency) {
      const task = this.#queue.shift();
      if (!task) break;
      this.#running += 1;
      void this.#execute(task).finally(() => {
        this.#running -= 1;
        this.#scheduleDrain();
      });
    }
  }

  async #execute(task: PendingTask<unknown>): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        Promise.resolve(task.run()),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            this.#timedOut += 1;
            reject(new Error('R29_WORK_TASK_TIMEOUT:' + task.id));
          }, this.timeoutMs);
        }),
      ]);
      this.#completed += 1;
      task.resolve(value);
    } catch (error) {
      this.#failed += 1;
      if (error instanceof Error && error.message.startsWith('R29_WORK_TASK_TIMEOUT:')) task.reject(error);
      else task.reject(error);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
