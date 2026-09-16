import { WorkerMessage, WorkerResponse, hashString, stableStringify } from './types.ts';

export const WORKER_PROTOCOL_VERSION = 1;
export const MAX_WORKER_PAYLOAD_BYTES = 1024 * 1024;

export type WorkerChannel = WorkerMessage['channel'];

export interface WorkerEnvelope<T = unknown> extends WorkerMessage<T> {
  checksum: number;
}

export interface WorkerErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
}

export function createWorkerMessage<T>(channel: WorkerChannel, requestId: string, payload: T): WorkerEnvelope<T> {
  assertRequestId(requestId);
  const body = { channel, requestId, version: WORKER_PROTOCOL_VERSION, payload };
  const serialized = stableStringify(body);
  assertSize(serialized);
  return { ...body, checksum: hashString(serialized) };
}

export function createWorkerResponse<T>(request: WorkerMessage, ok: boolean, payload: T): WorkerResponse<T> {
  return {
    channel: request.channel,
    requestId: request.requestId,
    version: WORKER_PROTOCOL_VERSION,
    payload,
    ok,
  };
}

export function validateWorkerMessage(message: unknown): message is WorkerEnvelope {
  if (!isRecord(message)) return false;
  if (message.version !== WORKER_PROTOCOL_VERSION) return false;
  if (!isChannel(message.channel) || typeof message.requestId !== 'string') return false;
  if (typeof message.checksum !== 'number') return false;
  const body = { channel: message.channel, requestId: message.requestId, version: message.version, payload: message.payload };
  if (message.checksum !== hashString(stableStringify(body))) return false;
  try {
    assertSize(stableStringify(message.payload));
  } catch {
    return false;
  }
  return true;
}

export class WorkerRequestTable<TResponse = unknown> {
  readonly #pending = new Map<string, { resolve: (value: TResponse) => void; reject: (error: Error) => void; createdAt: number }>();
  readonly #timeoutMs: number;

  constructor(timeoutMs = 10_000) {
    this.#timeoutMs = Math.max(100, timeoutMs);
  }

  register<TPayload>(request: WorkerEnvelope<TPayload>): Promise<TResponse> {
    if (this.#pending.has(request.requestId)) throw new Error(`Duplicate worker request: ${request.requestId}`);
    return new Promise<TResponse>((resolve, reject) => {
      this.#pending.set(request.requestId, { resolve, reject, createdAt: Date.now() });
    });
  }

  resolve(requestId: string, value: TResponse): boolean {
    const entry = this.#pending.get(requestId);
    if (!entry) return false;
    this.#pending.delete(requestId);
    entry.resolve(value);
    return true;
  }

  reject(requestId: string, reason: unknown): boolean {
    const entry = this.#pending.get(requestId);
    if (!entry) return false;
    this.#pending.delete(requestId);
    entry.reject(reason instanceof Error ? reason : new Error(String(reason)));
    return true;
  }

  expire(now = Date.now()): string[] {
    const expired: string[] = [];
    for (const [requestId, entry] of this.#pending) {
      if (now - entry.createdAt >= this.#timeoutMs) {
        this.#pending.delete(requestId);
        entry.reject(new Error(`Worker request timed out: ${requestId}`));
        expired.push(requestId);
      }
    }
    return expired;
  }

  clear(reason = new Error('Worker request table cleared')): void {
    for (const [requestId, entry] of this.#pending) {
      entry.reject(reason);
      this.#pending.delete(requestId);
    }
  }

  get size(): number { return this.#pending.size; }
}

export function makeRequestId(prefix = 'req'): string {
  const safe = prefix.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'req';
  return `${safe}-${Math.trunc(Date.now()).toString(36)}-${Math.trunc(Math.random() * 0x1000000).toString(36)}`;
}

function assertRequestId(requestId: string): void {
  if (!/^[a-zA-Z0-9._:-]{1,96}$/.test(requestId)) throw new Error('Invalid worker request id');
}

function assertSize(value: string): void {
  if (new TextEncoder().encode(value).byteLength > MAX_WORKER_PAYLOAD_BYTES) throw new Error('Worker payload exceeds size limit');
}

function isChannel(value: unknown): value is WorkerChannel {
  return value === 'simulation' || value === 'streaming' || value === 'pathfinding' || value === 'asset';
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}
