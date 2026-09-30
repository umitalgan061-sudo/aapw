export type WorkerPriority = 'critical' | 'high' | 'normal' | 'low' | 'background';
export type WorkerTaskState = 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';

export interface WorkerTask<T = unknown> {
  id: string;
  channel: 'simulation' | 'streaming' | 'pathfinding' | 'asset';
  priority: WorkerPriority;
  cost: number;
  run(signal: AbortSignal): Promise<T>;
}

export interface WorkerTaskResult<T = unknown> {
  id: string;
  state: WorkerTaskState;
  value?: T;
  error?: string;
  elapsedMs: number;
}

export interface WorkerBudget {
  maxConcurrent: number;
  maxQueued: number;
  budgetMsPerTick: number;
  maxTaskCost: number;
}

export interface WorkerStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  spentCost: number;
}

const PRIORITY_WEIGHT: Record<WorkerPriority, number> = {
  critical: 1000,
  high: 700,
  normal: 400,
  low: 150,
  background: 20,
};

const DEFAULT_BUDGET: WorkerBudget = {
  maxConcurrent: 4,
  maxQueued: 256,
  budgetMsPerTick: 4,
  maxTaskCost: 16,
};

interface InternalTask {
  task: WorkerTask;
  controller: AbortController;
  state: WorkerTaskState;
  queuedAt: number;
  result?: WorkerTaskResult;
}

export class WorkerSchedulerV2 {
  readonly #budget: WorkerBudget;
  readonly #tasks = new Map<string, InternalTask>();
  #spentCost = 0;
  #completed = 0;
  #failed = 0;
  #cancelled = 0;

  constructor(budget: Partial<WorkerBudget> = {}) {
    this.#budget = { ...DEFAULT_BUDGET, ...budget };
    if (this.#budget.maxConcurrent <= 0 || this.#budget.maxQueued <= 0 || this.#budget.budgetMsPerTick <= 0 || this.#budget.maxTaskCost <= 0) throw new RangeError('Invalid worker budget');
  }

  enqueue<T>(task: WorkerTask<T>): boolean {
    if (!task.id.trim() || this.#tasks.has(task.id)) return false;
    if (task.cost < 0 || task.cost > this.#budget.maxTaskCost) return false;
    if (this.queuedCount() >= this.#budget.maxQueued) return false;
    const controller = new AbortController();
    this.#tasks.set(task.id, { task, controller, state: 'queued', queuedAt: performance.now() });
    return true;
  }

  cancel(id: string): boolean {
    const internal = this.#tasks.get(id);
    if (!internal || internal.state === 'completed' || internal.state === 'failed' || internal.state === 'cancelled') return false;
    internal.controller.abort();
    internal.state = 'cancelled';
    this.#cancelled += 1;
    internal.result = { id, state: 'cancelled', elapsedMs: 0 };
    return true;
  }

  async pump(): Promise<WorkerTaskResult[]> {
    const results: WorkerTaskResult[] = [];
    this.#spentCost = 0;
    const running = new Map<string, Promise<void>>();
    const startable = this.#selectStartable();
    for (const internal of startable) {
      if (running.size >= this.#budget.maxConcurrent || this.#spentCost + internal.task.cost > this.#budget.budgetMsPerTick) break;
      this.#spentCost += internal.task.cost;
      internal.state = 'running';
      const promise = this.#execute(internal, results).then(() => undefined);
      running.set(internal.task.id, promise);
    }
    await Promise.all(running.values());
    return results;
  }

  result(id: string): WorkerTaskResult | undefined {
    const result = this.#tasks.get(id)?.result;
    return result ? { ...result } : undefined;
  }

  cleanup(maxAgeMs = 60000): number {
    const now = performance.now();
    let removed = 0;
    for (const [id, internal] of this.#tasks) {
      if (!['completed', 'failed', 'cancelled'].includes(internal.state)) continue;
      const finished = internal.result ? internal.queuedAt + internal.result.elapsedMs : internal.queuedAt;
      if (now - finished <= maxAgeMs) continue;
      this.#tasks.delete(id);
      removed += 1;
    }
    return removed;
  }

  queuedCount(): number { return [...this.#tasks.values()].filter((internal) => internal.state === 'queued').length; }
  runningCount(): number { return [...this.#tasks.values()].filter((internal) => internal.state === 'running').length; }

  stats(): WorkerStats {
    return {
      queued: this.queuedCount(),
      running: this.runningCount(),
      completed: this.#completed,
      failed: this.#failed,
      cancelled: this.#cancelled,
      spentCost: this.#spentCost,
    };
  }

  tasks(): WorkerTaskResult[] { return [...this.#tasks.values()].filter((internal) => internal.result).map((internal) => ({ ...internal.result! })); }

  digest(): number {
    let hash = 2166136261;
    for (const internal of [...this.#tasks.values()].sort((a, b) => a.task.id.localeCompare(b.task.id))) {
      const text = `${internal.task.id}|${internal.task.channel}|${internal.task.priority}|${internal.task.cost}|${internal.state}`;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
    }
    return hash >>> 0;
  }

  #selectStartable(): InternalTask[] {
    return [...this.#tasks.values()]
      .filter((internal) => internal.state === 'queued')
      .sort((a, b) => (PRIORITY_WEIGHT[b.task.priority] - PRIORITY_WEIGHT[a.task.priority]) || (a.queuedAt - b.queuedAt) || a.task.id.localeCompare(b.task.id));
  }

  async #execute(internal: InternalTask, results: WorkerTaskResult[]): Promise<void> {
    const started = performance.now();
    try {
      if (internal.controller.signal.aborted) throw new DOMException('Task cancelled', 'AbortError');
      const value = await internal.task.run(internal.controller.signal);
      if (internal.controller.signal.aborted) {
        internal.state = 'cancelled';
        this.#cancelled += 1;
        internal.result = { id: internal.task.id, state: 'cancelled', elapsedMs: performance.now() - started };
      } else {
        internal.state = 'completed';
        this.#completed += 1;
        internal.result = { id: internal.task.id, state: 'completed', value, elapsedMs: performance.now() - started };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (internal.controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        internal.state = 'cancelled';
        this.#cancelled += 1;
        internal.result = { id: internal.task.id, state: 'cancelled', error: message, elapsedMs: performance.now() - started };
      } else {
        internal.state = 'failed';
        this.#failed += 1;
        internal.result = { id: internal.task.id, state: 'failed', error: message.slice(0, 512), elapsedMs: performance.now() - started };
      }
    }
    results.push({ ...internal.result! });
  }
}
