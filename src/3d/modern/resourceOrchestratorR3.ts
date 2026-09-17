import type { AssetPort, LoggerPort, RuntimeDiagnosticsPort, RuntimePolicyPort, RuntimeTask, ScheduledTaskResult } from './portsR3.ts';
import type { WorkerPort } from './portsR3.ts';

export interface ResourceWorkItem<T = unknown> {
  readonly id: string;
  readonly priority: 0 | 1 | 2 | 3 | 4;
  readonly affinity: 'render' | 'simulation' | 'streaming' | 'input' | 'persistence' | 'any';
  readonly estimatedMs: number;
  readonly resourceIds: readonly string[];
  readonly execute: (signal: AbortSignal) => T | Promise<T>;
}

export interface ResourceOrchestratorOptions {
  readonly maxPerFrame?: number;
  readonly maxConcurrent?: number;
  readonly queueLimit?: number;
  readonly starvationFrames?: number;
}

export interface ResourceOrchestratorSnapshot {
  readonly queued: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly frame: number;
  readonly budgetMs: number;
}

interface QueueEntry<T> {
  readonly work: ResourceWorkItem<T>;
  readonly queuedFrame: number;
  readonly resolve: (result: ScheduledTaskResult<T>) => void;
  readonly reject: (error: unknown) => void;
}

const DEFAULTS = {
  maxPerFrame: 8,
  maxConcurrent: 2,
  queueLimit: 256,
  starvationFrames: 120,
} as const;

export class ResourceOrchestratorR3 {
  readonly #assets: AssetPort;
  readonly #worker: WorkerPort<unknown, unknown>;
  readonly #diagnostics?: RuntimeDiagnosticsPort;
  readonly #policy?: RuntimePolicyPort;
  readonly #logger: LoggerPort;
  readonly #options: Required<ResourceOrchestratorOptions>;
  readonly #queue: QueueEntry<unknown>[] = [];
  readonly #active = new Set<string>();
  #frame = 0;
  #completed = 0;
  #failed = 0;
  #skipped = 0;

  constructor(
    assets: AssetPort,
    worker: WorkerPort<unknown, unknown>,
    logger: LoggerPort,
    diagnostics?: RuntimeDiagnosticsPort,
    policy?: RuntimePolicyPort,
    options: ResourceOrchestratorOptions = {},
  ) {
    this.#assets = assets;
    this.#worker = worker;
    this.#logger = logger;
    this.#diagnostics = diagnostics;
    this.#policy = policy;
    this.#options = {
      maxPerFrame: Math.max(1, Math.floor(options.maxPerFrame ?? DEFAULTS.maxPerFrame)),
      maxConcurrent: Math.max(1, Math.floor(options.maxConcurrent ?? DEFAULTS.maxConcurrent)),
      queueLimit: Math.max(16, Math.floor(options.queueLimit ?? DEFAULTS.queueLimit)),
      starvationFrames: Math.max(8, Math.floor(options.starvationFrames ?? DEFAULTS.starvationFrames)),
    };
  }

  enqueue<T>(work: ResourceWorkItem<T>): Promise<ScheduledTaskResult<T>> {
    if (this.#queue.length >= this.#options.queueLimit) {
      return Promise.resolve({ id: work.id, completed: false, durationMs: 0, error: new Error('Resource queue limit reached.') });
    }
    return new Promise((resolve, reject) => {
      this.#queue.push({ work: work as ResourceWorkItem<unknown>, queuedFrame: this.#frame, resolve: resolve as (result: ScheduledTaskResult<unknown>) => void, reject });
      this.#sortQueue();
    });
  }

  enqueueTask<T>(task: RuntimeTask<T>): Promise<ScheduledTaskResult<T>> {
    return this.enqueue({
      id: task.id,
      priority: task.priority,
      affinity: task.affinity,
      estimatedMs: task.estimatedMs,
      resourceIds: [],
      execute: (signal) => task.run({ now: 0 as never, frame: 0 as never, signal, budget: { cpuMs: 2, gpuMs: 2, maxTasks: this.#options.maxPerFrame } }),
    });
  }

  frame(budgetMs: number, frame = this.#frame + 1): number {
    this.#frame = Math.max(this.#frame, Math.floor(frame));
    const safeBudget = Math.max(0.1, Number.isFinite(budgetMs) ? budgetMs : 0.1);
    const effectiveBudget = this.#policy?.shouldThrottle('streaming') ? safeBudget * 0.5 : safeBudget;
    let started = 0;
    while (started < this.#options.maxPerFrame && this.#active.size < this.#options.maxConcurrent && this.#queue.length > 0) {
      const entry = this.#queue.shift();
      if (!entry) break;
      if (!this.#canStart(entry.work, effectiveBudget, started)) {
        this.#queue.unshift(entry);
        this.#skipped += 1;
        break;
      }
      started += 1;
      this.#start(entry);
    }
    this.#diagnostics?.mark('runtime.resourceQueue', this.#queue.length);
    this.#diagnostics?.mark('runtime.resourceActive', this.#active.size);
    return started;
  }

  cancel(id: string): void {
    for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
      const entry = this.#queue[index];
      if (entry?.work.id !== id) continue;
      this.#queue.splice(index, 1);
      entry.resolve({ id, completed: false, durationMs: 0, error: new Error('Resource task cancelled before execution.') });
    }
    if (this.#active.has(id)) {
      this.#worker.cancel(id);
      this.#active.delete(id);
    }
  }

  snapshot(): ResourceOrchestratorSnapshot {
    return {
      queued: this.#queue.length,
      active: this.#active.size,
      completed: this.#completed,
      failed: this.#failed,
      skipped: this.#skipped,
      frame: this.#frame,
      budgetMs: this.#policy?.maxStreamingMs() ?? 4,
    };
  }

  #canStart(work: ResourceWorkItem<unknown>, budgetMs: number, started: number): boolean {
    if (work.estimatedMs <= budgetMs && started === 0) return true;
    const age = this.#frame - (this.#queue[0] ? this.#frame : this.#frame);
    if (age >= this.#options.starvationFrames) return true;
    if (started >= this.#options.maxPerFrame) return false;
    if (this.#policy?.shouldThrottle(work.affinity === 'render' ? 'rendering' : work.affinity === 'simulation' ? 'simulation' : 'streaming')) return false;
    return work.estimatedMs <= budgetMs * 0.8;
  }

  #start(entry: QueueEntry<unknown>): void {
    const { work } = entry;
    this.#active.add(work.id);
    const start = performance.now();
    const controller = new AbortController();
    for (const resourceId of work.resourceIds) this.#assets.retain(resourceId);
    Promise.resolve()
      .then(() => work.execute(controller.signal))
      .then((value) => {
        this.#completed += 1;
        entry.resolve({ id: work.id, completed: true, durationMs: performance.now() - start, value });
      })
      .catch((error) => {
        this.#failed += 1;
        this.#logger.error(`[resource] ${work.id} failed`, error);
        entry.resolve({ id: work.id, completed: false, durationMs: performance.now() - start, error });
      })
      .finally(() => {
        for (const resourceId of work.resourceIds) this.#assets.release(resourceId);
        this.#active.delete(work.id);
        this.frame(0, this.#frame);
      });
  }

  #sortQueue(): void {
    this.#queue.sort((a, b) => b.work.priority - a.work.priority || a.work.estimatedMs - b.work.estimatedMs || a.work.id.localeCompare(b.work.id));
  }
}
