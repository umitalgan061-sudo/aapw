import type { Disposable, RuntimeError, TimestampMs, WorkerMessage, WorkerResponse, WorkerTransport } from './types';
import { asTimestampMs } from './types';

interface PendingRequest<T> {
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export interface WorkerBridgeOptions {
  readonly timeoutMs?: number;
  readonly maxInflight?: number;
  readonly now?: () => TimestampMs;
}

/** Promise-based worker RPC with cancellation, timeouts and stale-response protection. */
export class WorkerBridge implements Disposable {
  private readonly transport: WorkerTransport;
  private readonly timeoutMs: number;
  private readonly maxInflight: number;
  private readonly now: () => TimestampMs;
  private readonly pending = new Map<string, PendingRequest<unknown>>();
  private sequence = 0;
  private disposed = false;
  private subscription: Disposable;

  public constructor(transport: WorkerTransport, options: WorkerBridgeOptions = {}) {
    this.transport = transport;
    this.timeoutMs = Math.max(50, options.timeoutMs ?? 5000);
    this.maxInflight = Math.max(1, options.maxInflight ?? 128);
    this.now = options.now ?? (() => asTimestampMs(performance.now()));
    this.subscription = transport.subscribe((message) => this.handle(message));
  }

  public request<TInput, TOutput>(kind: string, payload: TInput, transfer: Transferable[] = [], signal?: AbortSignal): Promise<TOutput> {
    this.ensureActive();
    if (this.pending.size >= this.maxInflight) return Promise.reject(new Error('WORKER_INFLIGHT_LIMIT'));
    const id = `${kind}:${++this.sequence}`;
    return new Promise<TOutput>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(this.error('WORKER_TIMEOUT', `worker request timed out: ${kind}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout });
      if (signal) {
        const onAbort = () => {
          clearTimeout(timeout);
          this.pending.delete(id);
          reject(this.error('WORKER_ABORTED', `worker request aborted: ${kind}`));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }
      const message: WorkerMessage<TInput> = { id, kind, payload, timestamp: this.now() };
      try { this.transport.post(message, transfer); }
      catch (cause) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(this.error('WORKER_POST_FAILED', 'worker message could not be posted', cause));
      }
    });
  }

  public cancelAll(reason = 'worker bridge disposed'): void {
    for (const [id, request] of this.pending) {
      clearTimeout(request.timeout);
      request.reject(this.error('WORKER_REQUEST_CANCELLED', reason));
      this.pending.delete(id);
    }
  }

  public inflight(): number { return this.pending.size; }

  private handle(message: WorkerResponse): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.ok) pending.resolve(message.payload);
    else pending.reject(message.error ?? this.error('WORKER_UNKNOWN_ERROR', 'worker returned an unknown error'));
  }

  private error(code: string, message: string, cause?: unknown): RuntimeError { return { code, message, recoverable: true, cause }; }
  private ensureActive(): void { if (this.disposed) throw new Error('WORKER_BRIDGE_DISPOSED'); }

  public dispose(): void {
    if (this.disposed) return;
    this.cancelAll();
    this.subscription.dispose();
    this.disposed = true;
  }
}

export interface WorkerPortTransportOptions {
  readonly target: Pick<Worker, 'postMessage' | 'addEventListener' | 'removeEventListener'>;
}

export class WorkerPortTransport implements WorkerTransport {
  private readonly target: WorkerPortTransportOptions['target'];
  private readonly handlers = new Set<(message: WorkerResponse) => void>();
  private disposed = false;
  private readonly listener = (event: MessageEvent<WorkerResponse>) => {
    const message = event.data;
    if (!message || typeof message.id !== 'string') return;
    for (const handler of [...this.handlers]) handler(message);
  };

  public constructor(options: WorkerPortTransportOptions) {
    this.target = options.target;
    this.target.addEventListener('message', this.listener as EventListener);
  }

  public post<T>(message: WorkerMessage<T>, transfer: Transferable[] = []): void {
    if (this.disposed) throw new Error('WORKER_TRANSPORT_DISPOSED');
    this.target.postMessage(message, transfer);
  }

  public subscribe(handler: (message: WorkerResponse) => void): Disposable {
    if (this.disposed) throw new Error('WORKER_TRANSPORT_DISPOSED');
    this.handlers.add(handler);
    return { dispose: () => this.handlers.delete(handler) && undefined };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.target.removeEventListener('message', this.listener as EventListener);
    this.handlers.clear();
    this.disposed = true;
  }
}

export interface InlineWorkerTask<TInput, TOutput> {
  readonly kind: string;
  readonly run: (payload: TInput, signal: AbortSignal) => Promise<TOutput> | TOutput;
}

export class InlineWorkerTransport implements WorkerTransport, Disposable {
  private readonly handlers = new Set<(message: WorkerResponse) => void>();
  private readonly tasks = new Map<string, InlineWorkerTask<any, any>>();
  private disposed = false;

  public register<TInput, TOutput>(task: InlineWorkerTask<TInput, TOutput>): Disposable {
    if (this.tasks.has(task.kind)) throw new Error(`INLINE_TASK_REDEFINED:${task.kind}`);
    this.tasks.set(task.kind, task as InlineWorkerTask<any, any>);
    return { dispose: () => this.tasks.delete(task.kind) && undefined };
  }

  public post<T>(message: WorkerMessage<T>): void {
    if (this.disposed) throw new Error('INLINE_TRANSPORT_DISPOSED');
    const task = this.tasks.get(message.kind);
    if (!task) {
      this.publish({ id: message.id, ok: false, error: { code: 'WORKER_TASK_MISSING', message: `task ${message.kind} is not registered`, recoverable: true } });
      return;
    }
    const controller = new AbortController();
    queueMicrotask(async () => {
      try {
        const payload = await task.run(message.payload, controller.signal);
        this.publish({ id: message.id, ok: true, payload });
      } catch (cause) {
        this.publish({ id: message.id, ok: false, error: { code: 'WORKER_TASK_FAILED', message: `task ${message.kind} failed`, recoverable: true, cause } });
      }
    });
  }

  public subscribe(handler: (message: WorkerResponse) => void): Disposable {
    this.handlers.add(handler);
    return { dispose: () => this.handlers.delete(handler) && undefined };
  }

  private publish(message: WorkerResponse): void { for (const handler of [...this.handlers]) handler(message); }
  public dispose(): void { this.disposed = true; this.tasks.clear(); this.handlers.clear(); }
}
