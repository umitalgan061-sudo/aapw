export type WorkerPriorityV15 = "critical" | "high" | "normal" | "low" | "background";

export interface WorkerTaskV15<T> {
  readonly id: string;
  readonly priority: WorkerPriorityV15;
  readonly estimatedMs: number;
  readonly bytes: number;
  readonly run: () => Promise<T> | T;
}

export interface WorkerBudgetV15 {
  readonly maxConcurrent: number;
  readonly maxTasksPerFrame: number;
  readonly maxMsPerFrame: number;
  readonly maxBytesPerFrame: number;
  readonly maxQueue: number;
}

export interface WorkerExecutionV15<T> {
  readonly id: string;
  readonly priority: WorkerPriorityV15;
  readonly started: boolean;
  readonly completed: boolean;
  readonly durationMs: number;
  readonly result?: T;
  readonly error?: string;
  readonly frame: number;
}

const PRIORITY: Readonly<Record<WorkerPriorityV15, number>> = Object.freeze({
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  background: 4,
});

export class WorkerBudgetSchedulerV15 {
  readonly #budget: WorkerBudgetV15;
  readonly #queue = new Map<string, WorkerTaskV15<unknown>>();
  #active = 0;
  #frame = 0;
  #completed = 0;
  #failed = 0;
  #bytesThisFrame = 0;
  #msThisFrame = 0;

  constructor(budget: Partial<WorkerBudgetV15> = {}) {
    this.#budget = Object.freeze({
      maxConcurrent: Math.max(1, Math.floor(budget.maxConcurrent ?? 4)),
      maxTasksPerFrame: Math.max(1, Math.floor(budget.maxTasksPerFrame ?? 16)),
      maxMsPerFrame: Math.max(0.5, budget.maxMsPerFrame ?? 4),
      maxBytesPerFrame: Math.max(1_024, Math.floor(budget.maxBytesPerFrame ?? 8 * 1024 * 1024)),
      maxQueue: Math.max(1, Math.floor(budget.maxQueue ?? 2_048)),
    });
  }

  enqueue<T>(task: WorkerTaskV15<T>): boolean {
    const id = task.id.trim();
    if (!id || id.length > 128 || this.#queue.has(id) || this.#queue.size >= this.#budget.maxQueue) return false;
    if (!Number.isFinite(task.estimatedMs) || task.estimatedMs < 0 || !Number.isFinite(task.bytes) || task.bytes < 0) return false;
    this.#queue.set(id, Object.freeze({
      ...task,
      id,
      estimatedMs: Math.max(0, task.estimatedMs),
      bytes: Math.max(0, Math.floor(task.bytes)),
    }));
    return true;
  }

  cancel(id: string): boolean { return this.#queue.delete(id); }
  clear(): number { const count = this.#queue.size; this.#queue.clear(); return count; }

  async runFrame(frame: number): Promise<readonly WorkerExecutionV15<unknown>[]> {
    this.#frame = Math.max(0, Math.floor(frame));
    this.#bytesThisFrame = 0;
    this.#msThisFrame = 0;
    const executions: WorkerExecutionV15<unknown>[] = [];
    while (
      this.#active < this.#budget.maxConcurrent &&
      executions.length < this.#budget.maxTasksPerFrame &&
      this.#queue.size > 0
    ) {
      const task = this.#pick();
      if (!task) break;
      if (this.#bytesThisFrame + task.bytes > this.#budget.maxBytesPerFrame) {
        if (executions.length === 0 && task.priority === "critical") {
          // Critical work is allowed to cross the estimated byte budget only when it is the sole item.
        } else {
          break;
        }
      }
      if (this.#msThisFrame + task.estimatedMs > this.#budget.maxMsPerFrame && task.priority !== "critical") break;
      this.#queue.delete(task.id);
      this.#active += 1;
      const start = typeof performance !== "undefined" ? performance.now() : Date.now();
      try {
        const result = await task.run();
        const durationMs = Math.max(0, (typeof performance !== "undefined" ? performance.now() : Date.now()) - start);
        this.#completed += 1;
        this.#bytesThisFrame += task.bytes;
        this.#msThisFrame += durationMs;
        executions.push(Object.freeze({
          id: task.id,
          priority: task.priority,
          started: true,
          completed: true,
          durationMs,
          result,
          frame: this.#frame,
        }));
      } catch (error) {
        const durationMs = Math.max(0, (typeof performance !== "undefined" ? performance.now() : Date.now()) - start);
        this.#failed += 1;
        this.#msThisFrame += durationMs;
        executions.push(Object.freeze({
          id: task.id,
          priority: task.priority,
          started: true,
          completed: false,
          durationMs,
          error: error instanceof Error ? error.message.slice(0, 256) : String(error).slice(0, 256),
          frame: this.#frame,
        }));
      } finally {
        this.#active = Math.max(0, this.#active - 1);
      }
    }
    return Object.freeze(executions);
  }

  queuedIds(): readonly string[] {
    return Object.freeze([...this.#queue.keys()].sort());
  }

  stats(): Readonly<{ queued: number; active: number; completed: number; failed: number; frameMs: number; frameBytes: number }> {
    return Object.freeze({
      queued: this.#queue.size,
      active: this.#active,
      completed: this.#completed,
      failed: this.#failed,
      frameMs: Number(this.#msThisFrame.toFixed(3)),
      frameBytes: this.#bytesThisFrame,
    });
  }

  budget(): WorkerBudgetV15 { return this.#budget; }

  #pick(): WorkerTaskV15<unknown> | undefined {
    return [...this.#queue.values()].sort(
      (a, b) => PRIORITY[a.priority] - PRIORITY[b.priority]
        || b.estimatedMs - a.estimatedMs
        || a.id.localeCompare(b.id),
    )[0];
  }
}
