import type { PlatformError, Result } from './types';

export interface WorkerRequest<T = unknown> {
  readonly id: string;
  readonly method: string;
  readonly payload: T;
}

export interface WorkerResponse<T = unknown> {
  readonly id: string;
  readonly ok: boolean;
  readonly payload?: T;
  readonly error?: PlatformError;
}

export interface WorkerTransport {
  readonly postMessage: (message: WorkerRequest) => void;
  readonly addMessageListener: (listener: (message: WorkerResponse) => void) => () => void;
  readonly terminate?: () => void;
}

function timeoutError(id: string): PlatformError {
  return { code: 'WORKER_TIMEOUT', message: `Worker request ${id} timed out`, retryable: true };
}

/** Request/response bridge suitable for Web Workers, OffscreenCanvas workers and future ECS jobs. */
export class WorkerBridge {
  #transport: WorkerTransport;
  #pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
  #sequence = 0;
  #defaultTimeoutMs: number;
  #unsubscribe: (() => void) | null;

  constructor(transport: WorkerTransport, options: { readonly timeoutMs?: number } = {}) {
    this.#transport = transport;
    this.#defaultTimeoutMs = Math.max(50, Math.floor(options.timeoutMs ?? 5_000));
    this.#unsubscribe = transport.addMessageListener((message) => this.#handle(message));
  }

  request<TPayload, TResult>(method: string, payload: TPayload, timeoutMs = this.#defaultTimeoutMs): Promise<Result<TResult>> {
    const id = `req-${this.#sequence++}-${method}`;
    return new Promise<Result<TResult>>((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        resolve({ ok: false, error: timeoutError(id) });
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => resolve(value as Result<TResult>),
        reject: (reason) => resolve({ ok: false, error: { code: 'WORKER_ERROR', message: String(reason), retryable: true, cause: reason } }),
        timer,
      });
      this.#transport.postMessage({ id, method, payload });
    });
  }

  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    for (const pending of this.#pending.values()) clearTimeout(pending.timer);
    this.#pending.clear();
    this.#transport.terminate?.();
  }

  #handle(message: WorkerResponse): void {
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve({ ok: true, value: message.payload });
    else pending.resolve({ ok: false, error: message.error ?? { code: 'WORKER_ERROR', message: 'Worker rejected request', retryable: true } });
  }
}

export function createDedicatedWorkerTransport(worker: Worker): WorkerTransport {
  const listeners = new Set<(message: WorkerResponse) => void>();
  const handler = (event: MessageEvent<WorkerResponse>) => {
    for (const listener of [...listeners]) listener(event.data);
  };
  worker.addEventListener('message', handler);
  return {
    postMessage: (message) => worker.postMessage(message),
    addMessageListener(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    terminate: () => {
      worker.removeEventListener('message', handler);
      worker.terminate();
      listeners.clear();
    },
  };
}
