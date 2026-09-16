export type WorkerTaskKindV5 = 'simulation' | 'pathfinding' | 'serialization' | 'compression' | 'asset-decode' | 'telemetry';

export interface WorkerTaskV5<TPayload = unknown> {
  readonly id: string;
  readonly kind: WorkerTaskKindV5;
  readonly priority: number;
  readonly payload: TPayload;
  readonly timeoutMs: number;
  readonly createdAt: number;
}

export interface WorkerResultV5<TResult = unknown> {
  readonly id: string;
  readonly ok: boolean;
  readonly value?: TResult;
  readonly error?: string;
  readonly durationMs: number;
}

export interface WorkerSlotV5 {
  readonly id: number;
  readonly busy: boolean;
  readonly taskId: string | null;
  readonly startedAt: number;
  readonly completed: number;
  readonly failed: number;
}

export interface WorkerPoolMetricsV5 {
  readonly workers: number;
  readonly queued: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly timeouts: number;
  readonly averageDurationMs: number;
}

export interface WorkerPoolOptionsV5 {
  readonly size?: number;
  readonly maxQueue?: number;
  readonly now?: () => number;
}

type WorkerHandlerV5 = (payload: unknown) => unknown | Promise<unknown>;

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

export class WorkerRuntimeV5 {
  readonly size: number;
  readonly maxQueue: number;
  #now: () => number;
  #handlers = new Map<WorkerTaskKindV5, WorkerHandlerV5>();
  #queue: Array<{ task: WorkerTaskV5; resolve: (result: WorkerResultV5) => void }> = [];
  #slots: WorkerSlotV5[] = [];
  #totalCompleted = 0;
  #totalFailed = 0;
  #timeouts = 0;
  #durations: number[] = [];
  #sequence = 0;

  constructor(options: WorkerPoolOptionsV5 = {}) {
    this.size = Math.max(1, Math.trunc(options.size ?? Math.min(8, typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4)));
    this.maxQueue = Math.max(16, Math.trunc(options.maxQueue ?? 1024));
    this.#now = options.now ?? (() => performance.now());
    for (let id = 0; id < this.size; id += 1) this.#slots.push({ id, busy: false, taskId: null, startedAt: 0, completed: 0, failed: 0 });
  }

  register(kind: WorkerTaskKindV5, handler: WorkerHandlerV5): void {
    if (this.#handlers.has(kind)) throw new Error(`Worker handler already registered: ${kind}`);
    this.#handlers.set(kind, handler);
  }

  replace(kind: WorkerTaskKindV5, handler: WorkerHandlerV5): void { this.#handlers.set(kind, handler); }

  dispatch<TPayload = unknown, TResult = unknown>(kind: WorkerTaskKindV5, payload: TPayload, options: { readonly priority?: number; readonly timeoutMs?: number } = {}): Promise<WorkerResultV5<TResult>> {
    if (!this.#handlers.has(kind)) return Promise.resolve({ id: 'rejected', ok: false, error: `No handler for ${kind}`, durationMs: 0 });
    if (this.#queue.length >= this.maxQueue) return Promise.resolve({ id: 'rejected', ok: false, error: 'Worker queue full', durationMs: 0 });
    const task: WorkerTaskV5<TPayload> = Object.freeze({ id: `task-${++this.#sequence}`, kind, priority: Math.trunc(options.priority ?? 0), payload, timeoutMs: Math.max(0, Math.trunc(options.timeoutMs ?? 30_000)), createdAt: this.#now() });
    return new Promise<WorkerResultV5<TResult>>((resolve) => {
      this.#queue.push({ task, resolve: resolve as (result: WorkerResultV5) => void });
      this.#queue.sort((a, b) => b.task.priority - a.task.priority || a.task.id.localeCompare(b.task.id));
      void this.pump();
    });
  }

  async pump(): Promise<number> {
    let launched = 0;
    while (this.#queue.length > 0) {
      const slot = this.#slots.find((candidate) => !candidate.busy);
      if (!slot) break;
      const item = this.#queue.shift()!;
      slotBusy(slot, item.task, this.#now());
      launched += 1;
      void this.#run(slot, item).finally(() => {
        const index = this.#slots.findIndex((candidate) => candidate.id === slot.id);
        if (index >= 0) this.#slots[index] = { ...slot, busy: false, taskId: null, startedAt: 0 };
        void this.pump();
      });
    }
    return launched;
  }

  queued(): readonly WorkerTaskV5[] { return Object.freeze(this.#queue.map((item) => item.task)); }
  slots(): readonly WorkerSlotV5[] { return Object.freeze(this.#slots.map((slot) => Object.freeze({ ...slot }))); }

  cancel(taskId: string): boolean {
    const before = this.#queue.length;
    this.#queue = this.#queue.filter((entry) => entry.task.id !== taskId);
    return this.#queue.length !== before;
  }

  metrics(): WorkerPoolMetricsV5 {
    const averageDurationMs = this.#durations.length ? this.#durations.reduce((sum, value) => sum + value, 0) / this.#durations.length : 0;
    return Object.freeze({ workers: this.size, queued: this.#queue.length, active: this.#slots.filter((slot) => slot.busy).length, completed: this.#totalCompleted, failed: this.#totalFailed, timeouts: this.#timeouts, averageDurationMs });
  }

  shutdown(): number {
    const count = this.#queue.length;
    this.#queue.length = 0;
    return count;
  }

  #run(slot: WorkerSlotV5, item: { task: WorkerTaskV5; resolve: (result: WorkerResultV5) => void }): Promise<void> {
    return new Promise<void>((resolve) => {
      const handler = this.#handlers.get(item.task.kind)!;
      const started = this.#now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const finish = (result: WorkerResultV5): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        const durationMs = Math.max(0, this.#now() - started);
        const completedResult = Object.freeze({ ...result, durationMs });
        this.#durations.push(durationMs);
        while (this.#durations.length > 120) this.#durations.shift();
        if (completedResult.ok) { this.#totalCompleted += 1; slot.completed += 1; } else { this.#totalFailed += 1; slot.failed += 1; }
        item.resolve(completedResult);
        resolve();
      };
      timer = item.task.timeoutMs > 0 ? setTimeout(() => { this.#timeouts += 1; finish({ id: item.task.id, ok: false, error: 'Worker task timeout', durationMs: item.task.timeoutMs }); }, item.task.timeoutMs) : undefined;
      Promise.resolve().then(() => handler(item.task.payload)).then((value) => finish({ id: item.task.id, ok: true, value, durationMs: 0 })).catch((cause) => finish({ id: item.task.id, ok: false, error: cause instanceof Error ? cause.message.slice(0, 300) : 'Worker task failed', durationMs: 0 }));
    });
  }
}

function slotBusy(slot: WorkerSlotV5, task: WorkerTaskV5, now: number): void {
  slot.busy = true;
  slot.taskId = task.id;
  slot.startedAt = now;
}

export function createWorkerRuntimeV5(options: WorkerPoolOptionsV5 = {}): WorkerRuntimeV5 { return new WorkerRuntimeV5(options); }
