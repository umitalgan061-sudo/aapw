export type WorkerTaskId = string;
export type WorkerTaskPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';
export type WorkerTaskState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface WorkerTaskContext {
  readonly id: WorkerTaskId;
  readonly signal: AbortSignal;
  readonly attempt: number;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface WorkerTask<T> {
  readonly id: WorkerTaskId;
  readonly priority: WorkerTaskPriority;
  readonly timeoutMs?: number;
  readonly run: (context: WorkerTaskContext) => Promise<T> | T;
}

export interface WorkerTaskRecord<T> {
  readonly task: WorkerTask<T>;
  readonly state: WorkerTaskState;
  readonly enqueuedAt: number;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly attempts: number;
  readonly result?: T;
  readonly error?: unknown;
}

export interface WorkerPoolOptions {
  readonly concurrency: number;
  readonly defaultTimeoutMs: number;
  readonly maxQueue: number;
}

const priority: Record<WorkerTaskPriority, number> = { critical: 5, high: 4, normal: 3, low: 2, background: 1 };

export class AbortableTaskPool {
  readonly #options: WorkerPoolOptions;
  readonly #records = new Map<WorkerTaskId, WorkerTaskRecord<unknown>>();
  readonly #queue: WorkerTaskId[] = [];
  #running = 0;
  #wake: (() => void) | undefined;

  constructor(options: Partial<WorkerPoolOptions> = {}) {
    this.#options = {
      concurrency: Math.max(1, Math.floor(options.concurrency ?? 2)),
      defaultTimeoutMs: Math.max(1, options.defaultTimeoutMs ?? 15000),
      maxQueue: Math.max(1, Math.floor(options.maxQueue ?? 256)),
    };
  }

  #sortQueue(): void {
    this.#queue.sort((a, b) => {
      const left = this.#records.get(a);
      const right = this.#records.get(b);
      if (!left || !right) return 0;
      return priority[right.task.priority] - priority[left.task.priority] || left.enqueuedAt - right.enqueuedAt || a.localeCompare(b);
    });
  }

  enqueue<T>(task: WorkerTask<T>): Promise<T> {
    if (!task.id.trim()) return Promise.reject(new Error('Worker task id is required'));
    if (this.#records.has(task.id)) return Promise.reject(new Error(`Duplicate worker task: ${task.id}`));
    if (this.#queue.length >= this.#options.maxQueue) return Promise.reject(new Error('Worker task queue is full'));
    const enqueuedAt = performance.now();
    this.#records.set(task.id, { task, state: 'queued', enqueuedAt, attempts: 0 });
    this.#queue.push(task.id);
    this.#sortQueue();
    this.#pump();
    return new Promise<T>((resolve, reject) => {
      const poll = (): void => {
        const record = this.#records.get(task.id);
        if (!record) { reject(new Error('Worker task record disappeared')); return; }
        if (record.state === 'completed') { resolve(record.result as T); return; }
        if (record.state === 'failed') { reject(record.error); return; }
        if (record.state === 'cancelled') { reject(new DOMException('Task cancelled', 'AbortError')); return; }
        setTimeout(poll, 0);
      };
      poll();
    });
  }

  async #runOne(id: WorkerTaskId): Promise<void> {
    const record = this.#records.get(id);
    if (!record || record.state !== 'queued') return;
    const controller = new AbortController();
    const startedAt = performance.now();
    const running: WorkerTaskRecord<unknown> = { ...record, state: 'running', startedAt, attempts: record.attempts + 1 };
    this.#records.set(id, running);
    this.#running += 1;
    const timeoutMs = Math.max(1, record.task.timeoutMs ?? this.#options.defaultTimeoutMs);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      timeout = setTimeout(() => controller.abort(), timeoutMs);
      const result = await record.task.run({ id, signal: controller.signal, attempt: running.attempts, metadata: {} });
      if (controller.signal.aborted) throw new DOMException('Task timed out', 'TimeoutError');
      this.#records.set(id, { ...running, state: 'completed', finishedAt: performance.now(), result });
    } catch (error) {
      const state: WorkerTaskState = controller.signal.aborted ? 'cancelled' : 'failed';
      this.#records.set(id, { ...running, state, finishedAt: performance.now(), error });
    } finally {
      if (timeout) clearTimeout(timeout);
      this.#running -= 1;
      this.#wake?.();
      this.#wake = undefined;
      this.#pump();
    }
  }

  #pump(): void {
    while (this.#running < this.#options.concurrency && this.#queue.length > 0) {
      const id = this.#queue.shift();
      if (!id) continue;
      void this.#runOne(id);
    }
  }

  cancel(id: WorkerTaskId): boolean {
    const record = this.#records.get(id);
    if (!record) return false;
    if (record.state === 'queued') {
      this.#records.set(id, { ...record, state: 'cancelled', finishedAt: performance.now() });
      const index = this.#queue.indexOf(id);
      if (index >= 0) this.#queue.splice(index, 1);
      return true;
    }
    return false;
  }

  get<T>(id: WorkerTaskId): WorkerTaskRecord<T> | undefined {
    return this.#records.get(id) as WorkerTaskRecord<T> | undefined;
  }

  list(): readonly WorkerTaskRecord[] { return [...this.#records.values()]; }
  queued(): number { return this.#queue.length; }
  running(): number { return this.#running; }

  async drain(timeoutMs = 5000): Promise<boolean> {
    const deadline = performance.now() + Math.max(1, timeoutMs);
    while ((this.#running > 0 || this.#queue.length > 0) && performance.now() < deadline) {
      await new Promise<void>((resolve) => { this.#wake = resolve; setTimeout(resolve, 10); });
    }
    return this.#running === 0 && this.#queue.length === 0;
  }

  reset(): void {
    for (const id of [...this.#queue]) this.cancel(id);
    this.#records.clear();
  }
}

export function createTaskId(prefix: string, sequence: number): WorkerTaskId {
  if (!prefix.trim()) throw new TypeError('Task id prefix is required');
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new RangeError('Task id sequence is invalid');
  return `${prefix}:${sequence.toString(36)}`;
}
