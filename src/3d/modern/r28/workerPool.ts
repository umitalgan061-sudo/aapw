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

interface QueueTask<T> extends WorkerTask<T> {
  readonly resolve: (result: WorkerTaskResult<T>) => void;
}

export class BoundedWorkerPool {
  readonly concurrency: number;
  readonly queueLimit: number;
  #queue: QueueTask<unknown>[] = [];
  #running = 0;
  #nextId = 1;

  constructor(concurrency = 2, queueLimit = 128) {
    this.concurrency = Math.max(1, Math.floor(concurrency));
    this.queueLimit = Math.max(this.concurrency, Math.floor(queueLimit));
  }

  enqueue<T>(priority: number, run: () => Promise<T>): Promise<WorkerTaskResult<T>> {
    if (this.#queue.length >= this.queueLimit) return Promise.reject(new Error('Worker queue limit exceeded'));
    const id = this.#nextId++;
    return new Promise<WorkerTaskResult<T>>((resolve) => {
      const task: QueueTask<T> = { id, priority, run, resolve };
      this.#queue.push(task as QueueTask<unknown>);
      this.#queue.sort((a, b) => b.priority - a.priority || a.id - b.id);
      this.#pump();
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
        .then((value) => task.resolve({ id: task.id, value }))
        .catch((error) => task.resolve({ id: task.id, error: error instanceof Error ? error.message : String(error) }))
        .finally(() => {
          this.#running--;
          this.#pump();
        });
    }
  }
}
