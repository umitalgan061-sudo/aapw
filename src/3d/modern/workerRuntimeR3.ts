import type { PortResult, WorkerPort, WorkerStats } from './portsR3.ts';

export type WorkerDomain = 'terrain' | 'navigation' | 'asset-decode' | 'pathfinding' | 'telemetry' | 'generic';

export interface WorkerRequest<TPayload = unknown> {
  readonly requestId: string;
  readonly domain: WorkerDomain;
  readonly payload: TPayload;
  readonly frame: number;
  readonly deadlineMs: number;
}

export interface WorkerResponse<TPayload = unknown> {
  readonly requestId: string;
  readonly domain: WorkerDomain;
  readonly frame: number;
  readonly ok: boolean;
  readonly payload?: TPayload;
  readonly error?: string;
}

export interface WorkerTask<TRequest, TResponse> {
  readonly domain: WorkerDomain;
  readonly execute: (request: WorkerRequest<TRequest>, signal: AbortSignal) => Promise<TResponse> | TResponse;
}

export interface WorkerRuntimeOptions {
  readonly concurrency?: number;
  readonly maxQueue?: number;
  readonly maxTasksPerTick?: number;
}

interface QueueEntry<TRequest, TResponse> {
  readonly request: WorkerRequest<TRequest>;
  readonly task: WorkerTask<TRequest, TResponse>;
  readonly resolve: (result: PortResult<TResponse>) => void;
  readonly signal: AbortSignal;
}

const makeController = (signal: AbortSignal): AbortController => {
  const controller = new AbortController();
  if (signal.aborted) controller.abort(signal.reason);
  else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  return controller;
};

export class WorkerRuntimeR3<TRequest = unknown, TResponse = unknown> implements WorkerPort<TRequest, TResponse> {
  readonly #tasks = new Map<WorkerDomain, WorkerTask<TRequest, TResponse>>();
  readonly #queue: QueueEntry<TRequest, TResponse>[] = [];
  readonly #active = new Map<string, AbortController>();
  readonly #options: Required<WorkerRuntimeOptions>;
  #completed = 0;
  #failed = 0;
  #cancelled = 0;
  #sequence = 0;
  #closed = false;

  constructor(options: WorkerRuntimeOptions = {}) {
    this.#options = {
      concurrency: Math.max(1, Math.floor(options.concurrency ?? 2)),
      maxQueue: Math.max(16, Math.floor(options.maxQueue ?? 256)),
      maxTasksPerTick: Math.max(1, Math.floor(options.maxTasksPerTick ?? 8)),
    };
  }

  register(task: WorkerTask<TRequest, TResponse>): void {
    if (this.#closed) throw new Error('Worker runtime is closed.');
    this.#tasks.set(task.domain, task);
  }

  unregister(domain: WorkerDomain): void {
    this.#tasks.delete(domain);
  }

  request(request: TRequest, signal?: AbortSignal): Promise<PortResult<TResponse>> {
    const controller = makeController(signal ?? new AbortController().signal);
    return new Promise((resolve) => {
      if (this.#closed) {
        resolve({ ok: false, error: { code: 'WORKER_CLOSED', message: 'Worker runtime is closed.', retryable: false } });
        return;
      }
      const envelope = this.#normalizeRequest(request);
      const task = this.#tasks.get(envelope.domain);
      if (!task) {
        resolve({ ok: false, error: { code: 'WORKER_DOMAIN', message: `No worker registered for domain ${envelope.domain}.`, retryable: false } });
        return;
      }
      if (this.#queue.length >= this.#options.maxQueue) {
        resolve({ ok: false, error: { code: 'WORKER_QUEUE', message: 'Worker queue is full.', retryable: true } });
        return;
      }
      this.#queue.push({ request: envelope, task, resolve, signal: controller.signal });
      queueMicrotask(() => this.#drain());
    });
  }

  requestTyped<TLocalRequest, TLocalResponse>(
    domain: WorkerDomain,
    payload: TLocalRequest,
    frame: number,
    deadlineMs: number,
    executor: WorkerTask<TLocalRequest, TLocalResponse>['execute'],
    signal?: AbortSignal,
  ): Promise<PortResult<TLocalResponse>> {
    const task = {
      domain,
      execute: executor as unknown as WorkerTask<TRequest, TResponse>['execute'],
    };
    this.#tasks.set(domain, task);
    return this.request({
      requestId: '',
      domain,
      payload,
      frame,
      deadlineMs,
    } as unknown as TRequest, signal) as unknown as Promise<PortResult<TLocalResponse>>;
  }

  cancel(requestId: string): void {
    const active = this.#active.get(requestId);
    if (active) {
      active.abort('cancelled');
      this.#active.delete(requestId);
      this.#cancelled += 1;
    }
    const retained = this.#queue.filter((entry) => entry.request.requestId !== requestId);
    if (retained.length !== this.#queue.length) {
      this.#queue.length = 0;
      this.#queue.push(...retained);
      this.#cancelled += 1;
    }
  }

  close(): void {
    this.#closed = true;
    for (const [id, controller] of this.#active) {
      controller.abort('closed');
      this.#active.delete(id);
    }
    for (const entry of this.#queue.splice(0)) {
      entry.resolve({ ok: false, error: { code: 'WORKER_CLOSED', message: 'Worker runtime closed before task execution.', retryable: true } });
    }
  }

  tick(): void {
    this.#drain();
  }

  stats(): WorkerStats {
    return {
      queued: this.#queue.length,
      active: this.#active.size,
      completed: this.#completed,
      failed: this.#failed,
      cancelled: this.#cancelled,
    };
  }

  #normalizeRequest(value: unknown): WorkerRequest<TRequest> {
    const candidate = value as Partial<WorkerRequest<TRequest>>;
    this.#sequence += 1;
    const requestId = typeof candidate.requestId === 'string' && candidate.requestId.length > 0
      ? candidate.requestId
      : `r3-${this.#sequence}`;
    const domain: WorkerDomain = this.#tasks.has(candidate.domain as WorkerDomain)
      ? candidate.domain as WorkerDomain
      : 'generic';
    return {
      requestId,
      domain,
      payload: candidate.payload as TRequest,
      frame: Number.isInteger(candidate.frame) ? Math.max(0, candidate.frame as number) : 0,
      deadlineMs: Number.isFinite(candidate.deadlineMs) ? Math.max(0, candidate.deadlineMs as number) : 1000,
    };
  }

  #drain(): void {
    if (this.#closed) return;
    let started = 0;
    while (this.#active.size < this.#options.concurrency && this.#queue.length > 0 && started < this.#options.maxTasksPerTick) {
      const entry = this.#queue.shift();
      if (!entry) break;
      started += 1;
      this.#run(entry);
    }
  }

  #run(entry: QueueEntry<TRequest, TResponse>): void {
    const controller = makeController(entry.signal);
    this.#active.set(entry.request.requestId, controller);
    const deadline = Math.max(0, entry.request.deadlineMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (deadline > 0) timer = setTimeout(() => controller.abort('deadline'), deadline);

    Promise.resolve()
      .then(() => entry.task.execute(entry.request, controller.signal))
      .then((value) => {
        if (controller.signal.aborted) {
          this.#cancelled += 1;
          entry.resolve({ ok: false, error: { code: 'WORKER_CANCELLED', message: `Worker request ${entry.request.requestId} cancelled.`, retryable: true } });
          return;
        }
        this.#completed += 1;
        entry.resolve({ ok: true, value });
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          this.#cancelled += 1;
          entry.resolve({ ok: false, error: { code: 'WORKER_CANCELLED', message: error instanceof Error ? error.message : String(error), retryable: true } });
        } else {
          this.#failed += 1;
          entry.resolve({ ok: false, error: { code: 'WORKER_EXECUTION', message: error instanceof Error ? error.message : String(error), retryable: true } });
        }
      })
      .finally(() => {
        if (timer) clearTimeout(timer);
        this.#active.delete(entry.request.requestId);
        this.#drain();
      });
  }
}

export function createSynchronousWorkerRuntime(): WorkerRuntimeR3 {
  return new WorkerRuntimeR3({ concurrency: 1, maxQueue: 64, maxTasksPerTick: 1 });
}
