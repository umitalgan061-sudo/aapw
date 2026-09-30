import type { Disposable, Result } from './coreTypes.ts';
import { clamp, err, ok, stableSort } from './coreTypes.ts';

export type WorkerTaskKind = 'terrain' | 'pathfinding' | 'navmesh' | 'asset-parse' | 'world-query' | 'procedural' | 'generic';

export interface WorkerTask<TPayload = unknown> {
  readonly id: string;
  readonly kind: WorkerTaskKind;
  readonly payload: TPayload;
  readonly priority: number;
  readonly costMs: number;
  readonly deadlineMs?: number;
  readonly transferable?: readonly Transferable[];
}

export interface WorkerTaskResult<TResult = unknown> {
  readonly id: string;
  readonly ok: boolean;
  readonly value?: TResult;
  readonly error?: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly workerId: number;
}

export interface WorkerExecutor<TPayload = unknown, TResult = unknown> {
  execute(task: WorkerTask<TPayload>, signal: AbortSignal): Promise<TResult>;
}

export interface WorkerPoolOptions {
  readonly concurrency?: number;
  readonly maxQueue?: number;
  readonly taskTimeoutMs?: number;
  readonly clock?: () => number;
}

interface QueuedTask {
  readonly task: WorkerTask;
  readonly resolve: (result: WorkerTaskResult) => void;
}

export class TypedWorkerPool<TPayload = unknown, TResult = unknown> implements Disposable {
  private readonly queue: QueuedTask[] = [];
  private readonly active = new Map<number, { task: WorkerTask; controller: AbortController }>();
  private readonly executor: WorkerExecutor<TPayload, TResult>;
  private readonly concurrency: number;
  private readonly maxQueue: number;
  private readonly timeoutMs: number;
  private readonly clock: () => number;
  private workerSequence = 0;
  private disposed = false;

  constructor(executor: WorkerExecutor<TPayload, TResult>, options: WorkerPoolOptions = {}) {
    this.executor = executor;
    this.concurrency = Math.max(1, Math.trunc(options.concurrency ?? 4));
    this.maxQueue = Math.max(8, Math.trunc(options.maxQueue ?? 256));
    this.timeoutMs = Math.max(50, Math.trunc(options.taskTimeoutMs ?? 15_000));
    this.clock = options.clock ?? (() => typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  submit(task: WorkerTask<TPayload>): Promise<WorkerTaskResult<TResult>> {
    if (this.disposed) return Promise.resolve({ id: task.id, ok: false, error: 'worker pool disposed', startedAt: this.clock(), finishedAt: this.clock(), workerId: -1 });
    if (this.queue.length >= this.maxQueue) return Promise.resolve({ id: task.id, ok: false, error: 'worker queue is full', startedAt: this.clock(), finishedAt: this.clock(), workerId: -1 });
    if (!task.id || !task.kind) return Promise.resolve({ id: task.id, ok: false, error: 'invalid worker task', startedAt: this.clock(), finishedAt: this.clock(), workerId: -1 });
    return new Promise(resolve => {
      this.queue.push({ task: Object.freeze({ ...task, priority: Math.trunc(task.priority), costMs: Math.max(0, task.costMs) }), resolve });
      this.pump();
    }) as Promise<WorkerTaskResult<TResult>>;
  }

  cancel(taskId: string): boolean {
    const queuedIndex = this.queue.findIndex(entry => entry.task.id === taskId);
    if (queuedIndex >= 0) {
      const [entry] = this.queue.splice(queuedIndex, 1);
      entry?.resolve({ id: taskId, ok: false, error: 'task cancelled before execution', startedAt: this.clock(), finishedAt: this.clock(), workerId: -1 });
      return true;
    }
    for (const [workerId, active] of this.active) {
      if (active.task.id === taskId) { active.controller.abort(); this.active.delete(workerId); this.pump(); return true; }
    }
    return false;
  }

  cancelAll(): void {
    for (const [workerId, active] of this.active) { active.controller.abort(); this.active.delete(workerId); }
    while (this.queue.length) {
      const entry = this.queue.shift()!;
      entry.resolve({ id: entry.task.id, ok: false, error: 'task cancelled', startedAt: this.clock(), finishedAt: this.clock(), workerId: -1 });
    }
  }

  queueSnapshot(): readonly WorkerTask[] { return this.queue.map(entry => entry.task); }
  get activeCount(): number { return this.active.size; }
  get queuedCount(): number { return this.queue.length; }

  stats(): Readonly<{ queued: number; active: number; capacity: number; saturation: number }> {
    return Object.freeze({ queued: this.queue.length, active: this.active.size, capacity: this.concurrency, saturation: this.active.size / this.concurrency });
  }

  dispose(): void { if (this.disposed) return; this.disposed = true; this.cancelAll(); }

  private pump(): void {
    if (this.disposed) return;
    while (this.active.size < this.concurrency && this.queue.length) {
      const ordered = stableSort(this.queue, (left, right) => this.score(right.task) - this.score(left.task) || left.task.id.localeCompare(right.task.id));
      const next = ordered[0];
      if (!next) break;
      const queueIndex = this.queue.indexOf(next);
      if (queueIndex >= 0) this.queue.splice(queueIndex, 1);
      this.execute(next);
    }
  }

  private score(task: WorkerTask): number {
    const deadlineBoost = task.deadlineMs !== undefined && task.deadlineMs - this.clock() < 500 ? 100_000 : 0;
    return task.priority * 1000 + deadlineBoost - task.costMs;
  }

  private execute(entry: QueuedTask): void {
    const workerId = ++this.workerSequence;
    const controller = new AbortController();
    const startedAt = this.clock();
    this.active.set(workerId, { task: entry.task, controller });
    const timeout = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, entry.task.deadlineMs ? Math.max(50, entry.task.deadlineMs - startedAt) : this.timeoutMs));
    this.executor.execute(entry.task as WorkerTask<TPayload>, controller.signal).then(value => {
      entry.resolve({ id: entry.task.id, ok: true, value, startedAt, finishedAt: this.clock(), workerId });
    }).catch(cause => {
      const error = controller.signal.aborted ? 'worker task timed out or was cancelled' : cause instanceof Error ? cause.message : 'worker task failed';
      entry.resolve({ id: entry.task.id, ok: false, error, startedAt, finishedAt: this.clock(), workerId });
    }).finally(() => {
      clearTimeout(timeout);
      this.active.delete(workerId);
      this.pump();
    });
  }
}

export interface WorkerMessage<T = unknown> {
  readonly protocol: 'aapw-worker-v1';
  readonly kind: 'request' | 'response' | 'cancel' | 'ready' | 'error';
  readonly requestId: string;
  readonly taskKind: WorkerTaskKind;
  readonly payload?: T;
  readonly error?: string;
}

export const createWorkerRequest = <T>(requestId: string, taskKind: WorkerTaskKind, payload: T): WorkerMessage<T> => Object.freeze({ protocol: 'aapw-worker-v1', kind: 'request', requestId, taskKind, payload });
export const createWorkerCancel = (requestId: string, taskKind: WorkerTaskKind): WorkerMessage => Object.freeze({ protocol: 'aapw-worker-v1', kind: 'cancel', requestId, taskKind });
export const createWorkerResponse = <T>(requestId: string, taskKind: WorkerTaskKind, payload: T): WorkerMessage<T> => Object.freeze({ protocol: 'aapw-worker-v1', kind: 'response', requestId, taskKind, payload });
export const createWorkerError = (requestId: string, taskKind: WorkerTaskKind, message: string): WorkerMessage => Object.freeze({ protocol: 'aapw-worker-v1', kind: 'error', requestId, taskKind, error: message });

export interface WorkerTransport {
  postMessage(message: WorkerMessage, transfer?: readonly Transferable[]): void;
  addMessageListener(listener: (message: WorkerMessage) => void): () => void;
}

export class WorkerRequestRouter<T = unknown> implements Disposable {
  private readonly pending = new Map<string, { resolve: (value: Result<T, string>) => void; reject: (reason: string) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(private readonly transport: WorkerTransport, private readonly timeoutMs = 10_000) {
    this.unsubscribe = transport.addMessageListener(message => this.handle(message));
  }

  request(requestId: string, taskKind: WorkerTaskKind, payload: T, transfer: readonly Transferable[] = []): Promise<Result<T, string>> {
    if (this.disposed) return Promise.resolve(err('worker router disposed'));
    if (this.pending.has(requestId)) return Promise.resolve(err(`request collision: ${requestId}`));
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(err(`worker request timeout: ${requestId}`));
      }, Math.max(50, this.timeoutMs));
      this.pending.set(requestId, { resolve, reject: reason => resolve(err(reason)), timer });
      this.transport.postMessage(createWorkerRequest(requestId, taskKind, payload), transfer);
    });
  }

  cancel(requestId: string, taskKind: WorkerTaskKind): boolean {
    if (!this.pending.has(requestId)) return false;
    this.transport.postMessage(createWorkerCancel(requestId, taskKind));
    return true;
  }

  pendingCount(): number { return this.pending.size; }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    for (const [requestId, pending] of this.pending) { clearTimeout(pending.timer); pending.reject(`worker router disposed: ${requestId}`); }
    this.pending.clear();
  }

  private handle(message: WorkerMessage): void {
    if (message.protocol !== 'aapw-worker-v1' || (message.kind !== 'response' && message.kind !== 'error')) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.kind === 'error') pending.resolve(err(message.error ?? 'worker returned an error'));
    else pending.resolve(ok(message.payload as T));
  }
}

export const boundedWorkerConcurrency = (hardwareConcurrency: number, mobile: boolean): number => clamp(Math.trunc(mobile ? hardwareConcurrency / 2 : hardwareConcurrency - 1), 1, 8);
