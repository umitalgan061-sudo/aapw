export type WorkerTask<TInput, TOutput> = (input: TInput) => TOutput | Promise<TOutput>;

export interface TaskRequest<T> {
  readonly id: string;
  readonly priority: number;
  readonly input: T;
  readonly createdAt: number;
  readonly timeoutMs: number;
}

export interface TaskResult<T> {
  readonly id: string;
  readonly ok: boolean;
  readonly value?: T;
  readonly error?: string;
  readonly durationMs: number;
}

export interface WorkerPoolMetrics {
  readonly queued: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
  readonly timedOut: number;
  readonly cancelled: number;
  readonly concurrency: number;
}

export interface WorkerPoolOptions {
  readonly concurrency?: number;
  readonly queueCapacity?: number;
  readonly defaultTimeoutMs?: number;
  readonly now?: () => number;
}

interface InternalTask<TInput, TOutput> extends TaskRequest<TInput> {
  readonly run: WorkerTask<TInput, TOutput>;
  readonly resolve: (result: TaskResult<TOutput>) => void;
}

export class WorkerPool<TInput = unknown, TOutput = unknown> {
  readonly #concurrency: number;
  readonly #queueCapacity: number;
  readonly #defaultTimeoutMs: number;
  readonly #now: () => number;
  readonly #queue: InternalTask<TInput, TOutput>[] = [];
  readonly #running = new Set<string>();
  #completed = 0;
  #failed = 0;
  #timedOut = 0;
  #cancelled = 0;
  #sequence = 0;
  #disposed = false;

  constructor(options: WorkerPoolOptions = {}) {
    this.#concurrency = Math.max(1, Math.min(64, Math.floor(options.concurrency ?? Math.max(2, 4))));
    this.#queueCapacity = Math.max(this.#concurrency * 4, Math.floor(options.queueCapacity ?? 256));
    this.#defaultTimeoutMs = Math.max(10, Math.floor(options.defaultTimeoutMs ?? 5000));
    this.#now = options.now ?? (() => performance.now());
  }

  run(input: TInput, task: WorkerTask<TInput, TOutput>, options: { priority?: number; timeoutMs?: number } = {}): Promise<TaskResult<TOutput>> {
    if (this.#disposed) return Promise.resolve({ id: 'disposed', ok: false, error: 'Worker pool is disposed.', durationMs: 0 });
    return new Promise((resolve) => {
      if (this.#queue.length >= this.#queueCapacity) {
        this.#dropLowestPriority(resolve);
      }
      const id = `task_${(++this.#sequence).toString(36)}`;
      this.#queue.push({ id, priority: Math.floor(options.priority ?? 0), input, run: task, resolve, createdAt: this.#now(), timeoutMs: Math.max(10, Math.floor(options.timeoutMs ?? this.#defaultTimeoutMs)) });
      this.#queue.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      this.#pump();
    });
  }

  cancel(id: string): boolean {
    const index = this.#queue.findIndex((task) => task.id === id);
    if (index < 0) return false;
    const [task] = this.#queue.splice(index, 1);
    if (!task) return false;
    this.#cancelled += 1;
    task.resolve({ id: task.id, ok: false, error: 'Cancelled.', durationMs: 0 });
    return true;
  }

  clearQueued(): number {
    const count = this.#queue.length;
    for (const task of this.#queue.splice(0)) {
      this.#cancelled += 1;
      task.resolve({ id: task.id, ok: false, error: 'Queue cleared.', durationMs: 0 });
    }
    return count;
  }

  metrics(): WorkerPoolMetrics {
    return { queued: this.#queue.length, running: this.#running.size, completed: this.#completed, failed: this.#failed, timedOut: this.#timedOut, cancelled: this.#cancelled, concurrency: this.#concurrency };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clearQueued();
  }

  #dropLowestPriority(fallbackResolve: (result: TaskResult<TOutput>) => void): void {
    let index = -1;
    let priority = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.#queue.length; i += 1) {
      const candidate = this.#queue[i];
      if (candidate && (candidate.priority < priority || (candidate.priority === priority && candidate.createdAt > (this.#queue[index]?.createdAt ?? 0)))) {
        index = i;
        priority = candidate.priority;
      }
    }
    if (index >= 0) {
      const [dropped] = this.#queue.splice(index, 1);
      this.#cancelled += 1;
      if (dropped) dropped.resolve({ id: dropped.id, ok: false, error: 'Dropped because worker queue is full.', durationMs: 0 });
      return;
    }
    fallbackResolve({ id: 'queue-full', ok: false, error: 'Worker queue is full.', durationMs: 0 });
  }

  #pump(): void {
    if (this.#disposed) return;
    while (this.#running.size < this.#concurrency && this.#queue.length) {
      const task = this.#queue.shift();
      if (task) void this.#execute(task);
    }
  }

  async #execute(task: InternalTask<TInput, TOutput>): Promise<void> {
    this.#running.add(task.id);
    const started = this.#now();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          reject(new Error(`Task timeout after ${task.timeoutMs}ms.`));
        }, task.timeoutMs);
      });
      const value = await Promise.race([Promise.resolve().then(() => task.run(task.input)), timeout]);
      if (timedOut) return;
      this.#completed += 1;
      task.resolve({ id: task.id, ok: true, value: value as TOutput, durationMs: this.#now() - started });
    } catch (error) {
      if (timedOut) this.#timedOut += 1;
      else this.#failed += 1;
      task.resolve({ id: task.id, ok: false, error: error instanceof Error ? error.message : String(error), durationMs: Math.max(0, this.#now() - started) });
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      this.#running.delete(task.id);
      this.#pump();
    }
  }
}

export interface WorkerMessage<T> {
  readonly type: string;
  readonly id: string;
  readonly payload: T;
}

export class MessageMultiplexer<TIn = unknown, TOut = unknown> {
  readonly #handlers = new Map<string, Set<(payload: TIn) => void>>();
  readonly #pending = new Map<string, { readonly resolve: (value: TOut) => void; readonly reject: (error: Error) => void; readonly timer: ReturnType<typeof setTimeout> }>();
  readonly #send: (message: WorkerMessage<TIn>) => void;
  readonly #timeoutMs: number;
  #seq = 0;

  constructor(send: (message: WorkerMessage<TIn>) => void, timeoutMs = 5000) {
    this.#send = send;
    this.#timeoutMs = Math.max(20, timeoutMs);
  }

  on(type: string, handler: (payload: TIn) => void): () => void {
    const set = this.#handlers.get(type) ?? new Set<(payload: TIn) => void>();
    set.add(handler);
    this.#handlers.set(type, set);
    return () => { set.delete(handler); if (!set.size) this.#handlers.delete(type); };
  }

  request(type: string, payload: TIn): Promise<TOut> {
    const id = `rpc_${(++this.#seq).toString(36)}`;
    return new Promise<TOut>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`RPC timeout: ${type}`));
      }, this.#timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#send({ type, id, payload });
    });
  }

  receive(message: WorkerMessage<TOut>): void {
    const pending = this.#pending.get(message.id);
    if (pending) {
      clearTimeout(pending.timer);
      this.#pending.delete(message.id);
      pending.resolve(message.payload);
      return;
    }
    const handlers = this.#handlers.get(message.type);
    if (!handlers) return;
    for (const handler of [...handlers]) handler(message.payload as unknown as TIn);
  }

  dispose(): void {
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Multiplexer disposed.')); }
    this.#pending.clear();
    this.#handlers.clear();
  }
}
