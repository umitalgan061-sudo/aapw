export interface WorkerTask<T> {
  readonly id: number;
  readonly priority: number;
  readonly run: () => Promise<T>;
}

export interface WorkerTaskResult<T> {
  readonly id: number;
  readonly value?: T;
  readonly error?: string;
}

export class BoundedWorkerPool {
  readonly concurrency: number;
  readonly queueLimit: number;
  #queue: WorkerTask<unknown>[] = [];
  #running = 0;
  #nextId = 1;

  constructor(concurrency = 2, queueLimit = 128) {
    this.concurrency = Math.max(1, Math.floor(concurrency));
    this.queueLimit = Math.max(this.concurrency, Math.floor(queueLimit));
  }

  enqueue<T>(priority: number, run: () => Promise<T>): Promise<WorkerTaskResult<T>> {
    if (this.#queue.length >= this.queueLimit) return Promise.reject(new Error('Worker queue limit exceeded'));
    const id = this.#nextId++;
    const task: WorkerTask<T> = { id, priority, run };
    this.#queue.push(task as WorkerTask<unknown>);
    this.#queue.sort((a, b) => b.priority - a.priority || a.id - b.id);
    this.#pump();
    return new Promise<WorkerTaskResult<T>>((resolve) => {
      const original = task.run;
      task.run = async () => {
        try {
          const value = await original();
          resolve({ id, value });
          return value;
        } catch (error) {
          resolve({ id, error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      };
    });
  }

  running(): number {
    return this.#running;
  }

  queued(): number {
    return this.#queue.length;
  }

  #pump(): void {
    while (this.#running < this.concurrency && this.#queue.length > 0) {
      const task = this.#queue.shift();
      if (!task) break;
      this.#running++;
      void task.run()
        .catch(() => undefined)
        .finally(() => {
          this.#running--;
          this.#pump();
        });
    }
  }
}
