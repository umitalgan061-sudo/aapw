import type { FrameId, RuntimeTask, ScheduledTaskResult, TaskAffinity, TaskContext, SchedulerBudget, UnixMillis } from './types';
import { FixedStepClock } from './deterministic';

interface InternalTask<T> extends RuntimeTask<T> {
  sequence: number;
}

function priorityScore(task: InternalTask): number {
  return task.priority * 1_000_000 - task.estimatedMs * 1_000 + (1_000_000 - task.sequence);
}

/**
 * Cooperative scheduler for small deterministic tasks.
 *
 * It never runs an arbitrary amount of work in one frame. Tasks are ordered by explicit priority,
 * expected cost and insertion sequence, then selected under both task-count and CPU budgets.
 */
export class RuntimeScheduler {
  #queues = new Map<TaskAffinity, InternalTask[]>();
  #sequence = 0;
  #maxQueueSize: number;

  constructor(options: { readonly maxQueueSize?: number } = {}) {
    this.#maxQueueSize = Math.max(32, Math.floor(options.maxQueueSize ?? 2048));
  }

  enqueue<T>(task: RuntimeTask<T>): boolean {
    if (!task.id || !Number.isFinite(task.estimatedMs) || task.estimatedMs < 0) {
      throw new TypeError('invalid runtime task');
    }
    const queue = this.#queues.get(task.affinity) ?? [];
    if (queue.length >= this.#maxQueueSize) return false;
    queue.push({ ...task, sequence: this.#sequence++ });
    this.#queues.set(task.affinity, queue);
    return true;
  }

  cancel(id: string): number {
    let removed = 0;
    for (const [affinity, queue] of this.#queues) {
      const next = queue.filter((task) => task.id !== id);
      removed += queue.length - next.length;
      if (next.length === 0) this.#queues.delete(affinity);
      else this.#queues.set(affinity, next);
    }
    return removed;
  }

  size(affinity?: TaskAffinity): number {
    if (affinity) return this.#queues.get(affinity)?.length ?? 0;
    let total = 0;
    for (const queue of this.#queues.values()) total += queue.length;
    return total;
  }

  async runFrame(
    context: TaskContext,
    options: { readonly affinity?: TaskAffinity; readonly signal?: AbortSignal } = {},
  ): Promise<ScheduledTaskResult[]> {
    const budget: SchedulerBudget = context.budget;
    const candidates = this.#collect(options.affinity).sort((a, b) => priorityScore(b) - priorityScore(a));
    const results: ScheduledTaskResult[] = [];
    let spent = 0;

    for (const task of candidates) {
      if (results.length >= budget.maxTasks) break;
      if (spent + task.estimatedMs > budget.cpuMs && results.length > 0) continue;
      const start = performance?.now?.() ?? Date.now();
      try {
        const value = await task.run({ ...context, signal: options.signal ?? context.signal });
        const durationMs = Math.max(0, (performance?.now?.() ?? Date.now()) - start);
        spent += durationMs;
        this.cancel(task.id);
        results.push({ id: task.id, completed: true, durationMs, value });
      } catch (error) {
        const durationMs = Math.max(0, (performance?.now?.() ?? Date.now()) - start);
        spent += durationMs;
        this.cancel(task.id);
        results.push({ id: task.id, completed: false, durationMs, error });
      }
    }
    return results;
  }

  #collect(affinity?: TaskAffinity): InternalTask[] {
    if (affinity) return [...(this.#queues.get(affinity) ?? [])];
    return [...this.#queues.values()].flat();
  }
}

export interface TickFrame {
  readonly frame: FrameId;
  readonly now: UnixMillis;
  readonly deltaSeconds: number;
  readonly alpha: number;
}

export class DeterministicRuntimeLoop {
  readonly clock: FixedStepClock;
  readonly scheduler: RuntimeScheduler;
  #running = false;
  #raf = 0;
  #lastWall = 0;
  #onFrame: (frame: TickFrame) => void | Promise<void>;

  constructor(onFrame: (frame: TickFrame) => void | Promise<void>, options: { readonly stepMs?: number } = {}) {
    this.clock = new FixedStepClock({ stepMs: options.stepMs });
    this.scheduler = new RuntimeScheduler();
    this.#onFrame = onFrame;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#lastWall = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const tick = async (wallNow: number) => {
      if (!this.#running) return;
      const delta = Math.max(0, Math.min(250, wallNow - this.#lastWall));
      this.#lastWall = wallNow;
      this.clock.advance(delta);
      await this.#onFrame({
        frame: this.clock.frame(),
        now: this.clock.now(),
        deltaSeconds: delta / 1000,
        alpha: this.clock.alpha(),
      });
      if (this.#running) this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.#running = false;
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  get running(): boolean {
    return this.#running;
  }
}
