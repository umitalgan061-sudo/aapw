import { CommandEnvelope, NetworkSnapshot, RuntimeSnapshot, Tick, asTick, checksumObject } from './domain.ts';

export type WorkerChannel = 'simulation' | 'streaming' | 'pathfinding' | 'save' | 'decode';
export type WorkerMessageKind = 'command' | 'snapshot' | 'response' | 'error' | 'cancel' | 'ready';

export interface WorkerMessage<T = unknown> {
  readonly version: 5;
  readonly channel: WorkerChannel;
  readonly kind: WorkerMessageKind;
  readonly requestId: string;
  readonly tick: Tick;
  readonly payload: T;
}

export interface WorkerResponse<T = unknown> {
  readonly requestId: string;
  readonly ok: boolean;
  readonly payload?: T;
  readonly error?: string;
}

export interface WorkerTransport {
  postMessage(message: WorkerMessage, transfer?: Transferable[]): void;
  terminate?(): void;
}

export interface PendingRequest<T> {
  readonly requestId: string;
  readonly promise: Promise<T>;
  readonly cancel: () => void;
}

export class WorkerBridgeV5 {
  readonly #pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>();
  readonly #handlers = new Map<WorkerChannel, Set<(message: WorkerMessage) => void>>();
  #sequence = 0;

  constructor(private readonly transport: WorkerTransport, readonly defaultTimeoutMs = 15_000) {}

  request<T>(channel: WorkerChannel, tick: Tick, payload: unknown, timeoutMs = this.defaultTimeoutMs): PendingRequest<T> {
    const requestId = `${channel}:${Number(tick)}:${++this.#sequence}:${checksumObject(payload)}`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const promise = new Promise<T>((resolve, reject) => {
      this.#pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject });
      this.transport.postMessage({ version: 5, channel, kind: 'command', requestId, tick, payload });
      timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(`worker request timed out: ${requestId}`));
      }, Math.max(1, timeoutMs));
    }).finally(() => { if (timer) clearTimeout(timer); });
    return { requestId, promise, cancel: () => this.cancel(requestId, tick, channel) };
  }

  handle<T>(message: WorkerMessage<T>): void {
    if (message.version !== 5) return;
    const pending = this.#pending.get(message.requestId);
    if (message.kind === 'response' || message.kind === 'error') {
      this.#pending.delete(message.requestId);
      if (pending) {
        if (message.kind === 'response') pending.resolve(message.payload);
        else pending.reject(new Error(String(message.payload ?? 'worker-error')));
      }
    }
    for (const handler of this.#handlers.get(message.channel) ?? []) handler(message as WorkerMessage);
  }

  subscribe(channel: WorkerChannel, handler: (message: WorkerMessage) => void): () => void {
    const handlers = this.#handlers.get(channel) ?? new Set();
    handlers.add(handler);
    this.#handlers.set(channel, handlers);
    return () => handlers.delete(handler);
  }

  cancel(requestId: string, tick: Tick, channel: WorkerChannel): void {
    if (!this.#pending.has(requestId)) return;
    this.#pending.delete(requestId);
    this.transport.postMessage({ version: 5, channel, kind: 'cancel', requestId, tick, payload: null });
  }

  broadcastSnapshot(channel: WorkerChannel, tick: Tick, snapshot: NetworkSnapshot | RuntimeSnapshot): void {
    const requestId = `snapshot:${Number(tick)}:${++this.#sequence}`;
    this.transport.postMessage({ version: 5, channel, kind: 'snapshot', requestId, tick, payload: snapshot });
  }

  pendingCount(): number { return this.#pending.size; }
  terminate(): void { this.transport.terminate?.(); for (const pending of this.#pending.values()) pending.reject(new Error('worker bridge terminated')); this.#pending.clear(); }
}

export class LocalWorkerLoop {
  readonly #queue: WorkerMessage[] = [];
  readonly #listeners = new Set<(message: WorkerMessage) => void>();
  #running = false;

  enqueue(message: WorkerMessage): void { this.#queue.push(message); }
  onMessage(listener: (message: WorkerMessage) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }

  async drain(handler: (message: WorkerMessage) => WorkerMessage | Promise<WorkerMessage> | null): Promise<number> {
    if (this.#running) return 0;
    this.#running = true;
    let processed = 0;
    try {
      while (this.#queue.length > 0) {
        const message = this.#queue.shift()!;
        const response = await handler(message);
        if (response) for (const listener of this.#listeners) listener(response);
        processed += 1;
      }
      return processed;
    } finally { this.#running = false; }
  }
}

export const workerMessage = <T>(channel: WorkerChannel, kind: WorkerMessageKind, requestId: string, tick: Tick | number, payload: T): WorkerMessage<T> => ({
  version: 5, channel, kind, requestId, tick: asTick(Number(tick)), payload,
});

export const isCommandMessage = (message: WorkerMessage): boolean => message.kind === 'command';
export const isSnapshotMessage = (message: WorkerMessage): boolean => message.kind === 'snapshot';
export const isTerminalMessage = (message: WorkerMessage): boolean => message.kind === 'response' || message.kind === 'error' || message.kind === 'cancel';
