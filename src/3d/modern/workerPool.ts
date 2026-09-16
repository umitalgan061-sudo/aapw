import type { PlatformError, Result, TaskAffinity, TaskPriority } from './types';
import { checksum } from './deterministic';
import { Diagnostics } from './diagnostics';
import { WorkerBridge, type WorkerTransport } from './workerBridge';

export interface WorkerPoolJob<T = unknown, R = unknown> {
  readonly id: string;
  readonly method: string;
  readonly payload: T;
  readonly priority: TaskPriority;
  readonly affinity: TaskAffinity;
  readonly timeoutMs?: number;
}

export interface WorkerPoolOptions {
  readonly size?: number;
  readonly maxQueued?: number;
  readonly diagnostics?: Diagnostics;
  readonly transportFactory: (index: number) => WorkerTransport;
}

export interface WorkerPoolStats {
  readonly workers: number;
  readonly busy: number;
  readonly queued: number;
  readonly completed: number;
  readonly failed: number;
  readonly timedOut: number;
  readonly digest: string;
}

interface PendingJob {
  readonly job: WorkerPoolJob;
  readonly resolve: (result: Result<unknown>) => void;
}

interface Slot {
  readonly index: number;
  readonly bridge: WorkerBridge;
  busy: boolean;
  current: string | null;
}

/** Deterministic bounded worker pool for terrain/nav/asset jobs. */
export class WorkerPool {
  readonly diagnostics: Diagnostics;

  #slots: Slot[] = [];
  #queue: PendingJob[] = [];
  #maxQueued: number;
  #completed = 0;
  #failed = 0;
  #timedOut = 0;

  constructor(options: WorkerPoolOptions) {
    const size = Math.max(1, Math.min(16, Math.floor(options.size ?? 2)));
    this.#maxQueued = Math.max(size, Math.floor(options.maxQueued ?? 64));
    this.diagnostics = options.diagnostics ?? new Diagnostics();
    for (let index = 0; index < size; index += 1) {
      this.#slots.push({ index, bridge: new WorkerBridge(options.transportFactory(index), { timeoutMs: 10_000 }), busy: false, current: null });
    }
  }

  get size(): number {
    return this.#slots.length;
  }

  stats(): WorkerPoolStats {
    const busy = this.#slots.filter((slot) => slot.busy).length;
    const digest = checksum({ workers: this.#slots.length, busy, queued: this.#queue.length, completed: this.#completed, failed: this.#failed, timedOut: this.#timedOut });
    return Object.freeze({ workers: this.#slots.length, busy, queued: this.#queue.length, completed: this.#completed, failed: this.#failed, timedOut: this.#timedOut, digest });
  }

  submit<T, R>(job: WorkerPoolJob<T, R>): Promise<Result<R>> {
    if (!job.id || !job.method) return Promise.resolve({ ok: false, error: this.error('WORKER_JOB_INVALID', 'Worker job id and method are required') });
    if (this.#queue.length >= this.#maxQueued && !this.#slots.some((slot) => !slot.busy)) {
      return Promise.resolve({ ok: false, error: this.error('WORKER_QUEUE_FULL', 'Worker queue capacity exceeded') });
    }
    return new Promise<Result<R>>((resolve) => {
      this.#queue.push({ job, resolve: resolve as (result: Result<unknown>) => void });
      this.#queue.sort((a, b) => b.job.priority - a.job.priority || a.job.id.localeCompare(b.job.id));
      this.#pump();
    });
  }

  cancel(jobId: string): boolean {
    const index = this.#queue.findIndex((entry) => entry.job.id === jobId);
    if (index < 0) return false;
    this.#queue.splice(index, 1);
    return true;
  }

  async shutdown(): Promise<void> {
    const queued = this.#queue.splice(0);
    for (const entry of queued) entry.resolve({ ok: false, error: this.error('WORKER_POOL_SHUTDOWN', 'Worker pool shut down') });
    for (const slot of this.#slots) slot.bridge.dispose();
    this.#slots = [];
  }

  #pump(): void {
    for (const slot of this.#slots) {
      if (slot.busy) continue;
      const pending = this.#queue.shift();
      if (!pending) break;
      slot.busy = true;
      slot.current = pending.job.id;
      void this.#run(slot, pending);
    }
  }

  async #run(slot: Slot, pending: PendingJob): Promise<void> {
    try {
      const result = await slot.bridge.request(pending.job.method, pending.job.payload, pending.job.timeoutMs ?? 10_000);
      if (!result.ok && result.error.code === 'WORKER_TIMEOUT') this.#timedOut += 1;
      if (result.ok) this.#completed += 1;
      else this.#failed += 1;
      pending.resolve(result);
    } catch (cause) {
      this.#failed += 1;
      pending.resolve({ ok: false, error: this.error('WORKER_POOL_ERROR', String(cause), true, cause) });
    } finally {
      slot.busy = false;
      slot.current = null;
      this.#pump();
    }
  }

  error(code: string, message: string, retryable = false, cause?: unknown): PlatformError {
    return { code, message, retryable, cause };
  }
}
