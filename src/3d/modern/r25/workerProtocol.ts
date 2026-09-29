import type { Result } from './contracts.ts';
import { fail, ok, stableHash } from './contracts.ts';

export type WorkerMessageKindR25 =
  | 'request'
  | 'response'
  | 'event'
  | 'cancel'
  | 'heartbeat'
  | 'error';

export interface WorkerRequestR25<T = unknown> {
  readonly kind: 'request';
  readonly id: string;
  readonly method: string;
  readonly payload: T;
  readonly sentAtMs: number;
  readonly sequence: number;
}

export interface WorkerResponseR25<T = unknown> {
  readonly kind: 'response';
  readonly id: string;
  readonly ok: boolean;
  readonly result?: T;
  readonly error?: string;
  readonly respondedAtMs: number;
  readonly sequence: number;
}

export interface WorkerEventR25<T = unknown> {
  readonly kind: 'event';
  readonly event: string;
  readonly payload: T;
  readonly sentAtMs: number;
  readonly sequence: number;
}

export interface WorkerCancelR25 {
  readonly kind: 'cancel';
  readonly id: string;
  readonly sentAtMs: number;
  readonly sequence: number;
}

export interface WorkerHeartbeatR25 {
  readonly kind: 'heartbeat';
  readonly sentAtMs: number;
  readonly sequence: number;
}

export interface WorkerErrorR25 {
  readonly kind: 'error';
  readonly id?: string;
  readonly code: string;
  readonly message: string;
  readonly sentAtMs: number;
  readonly sequence: number;
}

export type WorkerMessageR25<T = unknown> =
  | WorkerRequestR25<T>
  | WorkerResponseR25<T>
  | WorkerEventR25<T>
  | WorkerCancelR25
  | WorkerHeartbeatR25
  | WorkerErrorR25;

export interface WorkerTransportR25 {
  postMessage(message: WorkerMessageR25, transfer?: readonly Transferable[]): void;
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: EventListener,
  ): void;
  removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: EventListener,
  ): void;
}

export interface WorkerProtocolOptionsR25 {
  readonly maxPending?: number;
  readonly maxMessageBytes?: number;
  readonly requestTimeoutMs?: number;
  readonly clock?: () => number;
}

interface PendingRequest<T> {
  readonly id: string;
  readonly startedAtMs: number;
  readonly timeoutMs: number;
  readonly resolve: (value: Result<T, WorkerProtocolErrorR25>) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface WorkerProtocolErrorR25 {
  readonly code:
    | 'QUEUE_FULL'
    | 'TIMEOUT'
    | 'MESSAGE_TOO_LARGE'
    | 'INVALID_MESSAGE'
    | 'DISCONNECTED'
    | 'REMOTE_ERROR'
    | 'DUPLICATE_ID';
  readonly message: string;
}

export interface WorkerProtocolSnapshotR25 {
  readonly sequence: number;
  readonly pending: number;
  readonly sent: number;
  readonly received: number;
  readonly failed: number;
  readonly timeouts: number;
  readonly disconnected: boolean;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function normalizeId(value: string): string {
  const id = value.trim();
  if (!id) throw new Error('R25_WORKER_ID_EMPTY');
  return id.slice(0, 96);
}

function normalizeMethod(value: string): string {
  const method = value.trim();
  if (!method) throw new Error('R25_WORKER_METHOD_EMPTY');
  return method.slice(0, 128);
}

export class WorkerProtocolR25 {
  readonly #transport: WorkerTransportR25;
  readonly #maxPending: number;
  readonly #maxMessageBytes: number;
  readonly #requestTimeoutMs: number;
  readonly #clock: () => number;
  readonly #pending = new Map<string, PendingRequest<unknown>>();
  #sequence = 0;
  #sent = 0;
  #received = 0;
  #failed = 0;
  #timeouts = 0;
  #disconnected = false;

  public constructor(
    transport: WorkerTransportR25,
    options: WorkerProtocolOptionsR25 = {},
  ) {
    this.#transport = transport;
    this.#maxPending = Math.max(1, Math.trunc(options.maxPending ?? 128));
    this.#maxMessageBytes = Math.max(1024, Math.trunc(options.maxMessageBytes ?? 64 * 1024));
    this.#requestTimeoutMs = Math.max(50, finite(options.requestTimeoutMs, 5000));
    this.#clock = options.clock ?? (() => globalThis.performance?.now?.() ?? Date.now());

    this.#transport.addEventListener('message', this.#handleMessage);
    this.#transport.addEventListener('messageerror', this.#handleMessageError);
    this.#transport.addEventListener('error', this.#handleError);
  }

  public get pending(): number {
    return this.#pending.size;
  }

  public async request<TRequest, TResponse>(
    method: string,
    payload: TRequest,
    options: {
      readonly timeoutMs?: number;
      readonly transfer?: readonly Transferable[];
      readonly id?: string;
    } = {},
  ): Promise<Result<TResponse, WorkerProtocolErrorR25>> {
    if (this.#disconnected) {
      return fail({ code: 'DISCONNECTED', message: 'worker transport is disconnected' });
    }

    if (this.#pending.size >= this.#maxPending) {
      this.#failed += 1;
      return fail({ code: 'QUEUE_FULL', message: 'worker request queue is full' });
    }

    const id = normalizeId(options.id ?? this.#nextId());
    if (this.#pending.has(id)) {
      this.#failed += 1;
      return fail({ code: 'DUPLICATE_ID', message: 'request id already exists' });
    }

    const message: WorkerRequestR25<TRequest> = freeze({
      kind: 'request',
      id,
      method: normalizeMethod(method),
      payload,
      sentAtMs: this.#clock(),
      sequence: ++this.#sequence,
    });

    if (bytes(message) > this.#maxMessageBytes) {
      this.#failed += 1;
      return fail({
        code: 'MESSAGE_TOO_LARGE',
        message: 'worker request exceeds configured message budget',
      });
    }

    const timeoutMs = Math.max(
      50,
      Math.trunc(finite(options.timeoutMs, this.#requestTimeoutMs)),
    );

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.#pending.delete(id)) return;
        this.#timeouts += 1;
        resolve(fail({
          code: 'TIMEOUT',
          message: `worker request timed out: ${id}`,
        }));
      }, timeoutMs);

      this.#pending.set(id, {
        id,
        startedAtMs: this.#clock(),
        timeoutMs,
        resolve: resolve as (value: Result<unknown, WorkerProtocolErrorR25>) => void,
        timer,
      });

      try {
        this.#transport.postMessage(message, options.transfer);
        this.#sent += 1;
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        this.#failed += 1;
        resolve(fail({
          code: 'DISCONNECTED',
          message: error instanceof Error ? error.message : String(error),
        }));
      }
    });
  }

  public emit<T>(
    event: string,
    payload: T,
    transfer: readonly Transferable[] = [],
  ): Result<true, WorkerProtocolErrorR25> {
    if (this.#disconnected) {
      return fail({ code: 'DISCONNECTED', message: 'worker transport is disconnected' });
    }

    const message: WorkerEventR25<T> = freeze({
      kind: 'event',
      event: normalizeMethod(event),
      payload,
      sentAtMs: this.#clock(),
      sequence: ++this.#sequence,
    });

    if (bytes(message) > this.#maxMessageBytes) {
      this.#failed += 1;
      return fail({
        code: 'MESSAGE_TOO_LARGE',
        message: 'worker event exceeds configured message budget',
      });
    }

    try {
      this.#transport.postMessage(message, transfer);
      this.#sent += 1;
      return ok(true);
    } catch (error) {
      this.#failed += 1;
      return fail({
        code: 'DISCONNECTED',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public heartbeat(): Result<true, WorkerProtocolErrorR25> {
    if (this.#disconnected) {
      return fail({ code: 'DISCONNECTED', message: 'worker transport is disconnected' });
    }

    const message: WorkerHeartbeatR25 = freeze({
      kind: 'heartbeat',
      sentAtMs: this.#clock(),
      sequence: ++this.#sequence,
    });

    try {
      this.#transport.postMessage(message);
      this.#sent += 1;
      return ok(true);
    } catch {
      this.#failed += 1;
      return fail({
        code: 'DISCONNECTED',
        message: 'heartbeat could not be sent',
      });
    }
  }

  public cancel(id: string): boolean {
    const key = normalizeId(id);
    const pending = this.#pending.get(key);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.#pending.delete(key);

    try {
      this.#transport.postMessage(freeze({
        kind: 'cancel',
        id: key,
        sentAtMs: this.#clock(),
        sequence: ++this.#sequence,
      }));
      this.#sent += 1;
    } catch {
      this.#failed += 1;
    }

    pending.resolve(fail({
      code: 'TIMEOUT',
      message: `worker request cancelled: ${key}`,
    }));

    return true;
  }

  public disconnect(reason = 'manual'): void {
    if (this.#disconnected) return;
    this.#disconnected = true;

    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve(fail({
        code: 'DISCONNECTED',
        message: reason,
      }));
    }

    this.#pending.clear();
  }

  public snapshot(): WorkerProtocolSnapshotR25 {
    return freeze({
      sequence: this.#sequence,
      pending: this.#pending.size,
      sent: this.#sent,
      received: this.#received,
      failed: this.#failed,
      timeouts: this.#timeouts,
      disconnected: this.#disconnected,
    });
  }

  public dispose(): void {
    this.disconnect('disposed');
    this.#transport.removeEventListener('message', this.#handleMessage);
    this.#transport.removeEventListener('messageerror', this.#handleMessageError);
    this.#transport.removeEventListener('error', this.#handleError);
  }

  #handleMessage = (event: Event): void => {
    const candidate = (event as MessageEvent<unknown>).data;

    if (bytes(candidate) > this.#maxMessageBytes || !candidate || typeof candidate !== 'object') {
      this.#failed += 1;
      return;
    }

    const message = candidate as Partial<WorkerResponseR25>;
    if (message.kind !== 'response' || typeof message.id !== 'string') {
      return;
    }

    const pending = this.#pending.get(message.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.#pending.delete(message.id);
    this.#received += 1;

    if (message.ok) {
      pending.resolve(ok(message.result));
    } else {
      pending.resolve(fail({
        code: 'REMOTE_ERROR',
        message: message.error ?? 'worker returned an unspecified error',
      }));
    }
  };

  #handleMessageError = (): void => {
    this.#failed += 1;
  };

  #handleError = (event: Event): void => {
    this.#failed += 1;
    this.#disconnected = true;
    const detail = (event as ErrorEvent).message || 'worker transport error';
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve(fail({
        code: 'DISCONNECTED',
        message: detail,
      }));
    }
    this.#pending.clear();
  };

  #nextId(): string {
    const entropy = stableHash({
      sequence: this.#sequence,
      time: this.#clock(),
    });
    return `r25-${this.#sequence.toString(36)}-${entropy}`;
  }
}

export interface WorkerTaskDefinitionR25<TRequest = unknown, TResult = unknown> {
  readonly method: string;
  readonly run: (payload: TRequest, signal: AbortSignal) => TResult | Promise<TResult>;
}

export class WorkerTaskRouterR25 {
  readonly #tasks = new Map<string, WorkerTaskDefinitionR25>();
  readonly #controllers = new Map<string, AbortController>();

  public register<TRequest, TResult>(
    definition: WorkerTaskDefinitionR25<TRequest, TResult>,
  ): void {
    const method = normalizeMethod(definition.method);
    if (this.#tasks.has(method)) throw new Error(`R25_WORKER_METHOD_DUPLICATE:${method}`);
    if (typeof definition.run !== 'function') throw new Error(`R25_WORKER_HANDLER_MISSING:${method}`);
    this.#tasks.set(method, definition);
  }

  public async handle(
    message: WorkerRequestR25,
  ): Promise<WorkerResponseR25> {
    const definition = this.#tasks.get(message.method);
    if (!definition) {
      return freeze({
        kind: 'response',
        id: message.id,
        ok: false,
        error: 'R25_WORKER_METHOD_NOT_FOUND',
        respondedAtMs: message.sentAtMs,
        sequence: message.sequence,
      });
    }

    const controller = new AbortController();
    this.#controllers.set(message.id, controller);

    try {
      const result = await definition.run(
        message.payload,
        controller.signal,
      );

      return freeze({
        kind: 'response',
        id: message.id,
        ok: true,
        result,
        respondedAtMs: message.sentAtMs,
        sequence: message.sequence,
      });
    } catch (error) {
      return freeze({
        kind: 'response',
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        respondedAtMs: message.sentAtMs,
        sequence: message.sequence,
      });
    } finally {
      this.#controllers.delete(message.id);
    }
  }

  public cancel(id: string): boolean {
    const controller = this.#controllers.get(normalizeId(id));
    if (!controller) return false;
    controller.abort();
    return true;
  }

  public clear(): void {
    for (const controller of this.#controllers.values()) controller.abort();
    this.#controllers.clear();
    this.#tasks.clear();
  }
}

export function createMessageDigest(message: WorkerMessageR25): string {
  return stableHash({
    kind: message.kind,
    id: 'id' in message ? message.id : null,
    sequence: message.sequence,
    payload: 'payload' in message ? message.payload : null,
  });
}

export function isTransferableBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer;
}

export function cloneTransferable(
  value: ArrayBuffer,
): ArrayBuffer {
  return value.slice(0);
}
