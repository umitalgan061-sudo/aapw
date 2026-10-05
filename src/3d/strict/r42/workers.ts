/**
 * Bounded worker/task execution policy for R42.
 * Production TypeScript owner. The default execution path is deterministic and testable.
 */
import type { Priority, WorkClass, WorkerResult, WorkerTask } from './types.ts';
import { finite, deepFreeze } from './types.ts';

const ORDER: Record<Priority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
};

export interface WorkerPoolOptions {
  readonly maxConcurrency?: number;
  readonly maxQueue?: number;
}

export class DeterministicWorkerPoolR42 {
  readonly maxConcurrency: number;
  readonly maxQueue: number;
  #queue: WorkerTask[] = [];
  #active = 0;
  #completed = 0;
  #failed = 0;

  constructor(options: WorkerPoolOptions = {}) {
    this.maxConcurrency = Math.max(1, Math.trunc(finite(options.maxConcurrency, 2)));
    this.maxQueue = Math.max(this.maxConcurrency, Math.trunc(finite(options.maxQueue, 128)));
  }

  enqueue<T>(task: WorkerTask<T>): boolean {
    if (this.#queue.length >= this.maxQueue) {
      if (task.priority !== 'critical') return false;
      const index = this.#queue.findIndex(value => ORDER[value.priority] > ORDER.critical);
      if (index < 0) return false;
      this.#queue.splice(index, 1);
    }
    this.#queue.push(Object.freeze({ ...task }));
    this.#queue.sort(compare);
    return true;
  }

  async drain(): Promise<readonly WorkerResult[]> {
    const results: WorkerResult[] = [];
    while (this.#queue.length > 0) {
      const batch = this.#queue.splice(0, this.maxConcurrency);
      const settled = await Promise.all(batch.map(task => this.execute(task)));
      results.push(...settled);
    }
    return Object.freeze(results);
  }

  async execute<T>(task: WorkerTask<T>): Promise<WorkerResult> {
    this.#active += 1;
    const start = performance.now();
    try {
      await task.execute(task.payload);
      this.#completed += 1;
      return deepFreeze({
        id: task.id,
        started: true,
        completed: true,
        deferred: false,
        failed: false,
        elapsedMs: Math.max(0, performance.now() - start),
        reason: null,
      });
    } catch (error) {
      this.#failed += 1;
      return deepFreeze({
        id: task.id,
        started: true,
        completed: false,
        deferred: false,
        failed: true,
        elapsedMs: Math.max(0, performance.now() - start),
        reason: error instanceof Error ? error.message.slice(0, 512) : 'worker-failure',
      });
    } finally {
      this.#active = Math.max(0, this.#active - 1);
    }
  }

  snapshot(): Readonly<{
    queued: number;
    active: number;
    completed: number;
    failed: number;
    byClass: Readonly<Record<WorkClass, number>>;
  }> {
    const byClass = {
      simulation: 0,
      gameplay: 0,
      streaming: 0,
      network: 0,
      render: 0,
      assets: 0,
      persistence: 0,
      telemetry: 0,
      background: 0,
    } satisfies Record<WorkClass, number>;
    for (const task of this.#queue) byClass[task.class] += 1;
    return deepFreeze({
      queued: this.#queue.length,
      active: this.#active,
      completed: this.#completed,
      failed: this.#failed,
      byClass,
    });
  }

  clear(): void {
    this.#queue = [];
  }
}

function compare(a: WorkerTask, b: WorkerTask): number {
  return ORDER[a.priority] - ORDER[b.priority]
    || finite(a.estimatedMs) - finite(b.estimatedMs)
    || a.id.localeCompare(b.id);
}
