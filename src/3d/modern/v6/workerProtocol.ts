/**
 * V6 worker protocol.
 * Typed command envelopes for moving simulation/streaming work off the main thread.
 * The protocol is runtime-neutral and safe to loop back in tests.
 */

export type WorkerChannel = 'simulation' | 'streaming' | 'navigation' | 'assets' | 'telemetry';
export type WorkerRequestKind = 'tick' | 'preload' | 'path' | 'decode' | 'flush';
export type WorkerResponseKind = 'tick' | 'progress' | 'result' | 'error' | 'ack';

export interface WorkerRequest<T = unknown> {
  readonly channel: WorkerChannel;
  readonly kind: WorkerRequestKind;
  readonly id: number;
  readonly tick: number;
  readonly payload: T;
}
export interface WorkerResponse<T = unknown> {
  readonly channel: WorkerChannel;
  readonly kind: WorkerResponseKind;
  readonly id: number;
  readonly tick: number;
  readonly payload: T;
}
export interface WorkerError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}
export interface WorkerBudget {
  readonly maxQueue: number;
  readonly maxPayloadBytes: number;
  readonly maxOutstanding: number;
  readonly perTickBudget: number;
}

const DEFAULT_BUDGET: WorkerBudget = { maxQueue: 256, maxPayloadBytes: 128 * 1024, maxOutstanding: 64, perTickBudget: 8 };

function cleanText(value: unknown, max: number): string { return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max); }
function stable(value: unknown, depth = 0): string {
  if (depth > 7) return '"[depth]"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.slice(0, 64).map((item) => stable(item, depth + 1)).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().slice(0, 64).map((key) => `${JSON.stringify(key)}:${stable(object[key], depth + 1)}`).join(',')}}`;
}
function byteSize(value: unknown): number { return stable(value).length; }

export function validateRequest(request: WorkerRequest, budget: WorkerBudget = DEFAULT_BUDGET): void {
  if (!Number.isSafeInteger(request.id) || request.id < 1) throw new RangeError('invalid worker request id');
  if (!Number.isSafeInteger(request.tick) || request.tick < 0) throw new RangeError('invalid worker tick');
  if (!request.channel || !request.kind) throw new TypeError('worker request identity is required');
  if (byteSize(request.payload) > budget.maxPayloadBytes) throw new RangeError('worker request payload too large');
}

export function validateResponse(response: WorkerResponse, budget: WorkerBudget = DEFAULT_BUDGET): void {
  if (!Number.isSafeInteger(response.id) || response.id < 1) throw new RangeError('invalid worker response id');
  if (!Number.isSafeInteger(response.tick) || response.tick < 0) throw new RangeError('invalid worker tick');
  if (!response.channel || !response.kind) throw new TypeError('worker response identity is required');
  if (byteSize(response.payload) > budget.maxPayloadBytes) throw new RangeError('worker response payload too large');
}

export class WorkerQueue {
  readonly #budget: WorkerBudget;
  readonly #queue: WorkerRequest[] = [];
  readonly #outstanding = new Map<number, WorkerRequest>();
  #nextId = 0;

  constructor(budget: Partial<WorkerBudget> = {}) {
    const merged = { ...DEFAULT_BUDGET, ...budget };
    this.#budget = {
      maxQueue: Math.max(1, Math.floor(merged.maxQueue)),
      maxPayloadBytes: Math.max(1024, Math.floor(merged.maxPayloadBytes)),
      maxOutstanding: Math.max(1, Math.floor(merged.maxOutstanding)),
      perTickBudget: Math.max(1, Math.floor(merged.perTickBudget)),
    };
  }

  enqueue<T>(channel: WorkerChannel, kind: WorkerRequestKind, tick: number, payload: T): WorkerRequest<T> {
    if (this.#queue.length >= this.#budget.maxQueue) throw new Error('worker queue capacity reached');
    if (this.#outstanding.size >= this.#budget.maxOutstanding) throw new Error('worker outstanding capacity reached');
    const request: WorkerRequest<T> = { channel, kind, id: ++this.#nextId, tick: Math.max(0, Math.floor(tick)), payload };
    validateRequest(request, this.#budget);
    this.#queue.push(Object.freeze(request));
    this.#queue.sort((a, b) => a.tick - b.tick || a.id - b.id);
    this.#outstanding.set(request.id, request);
    return request;
  }

  drain(tick: number): readonly WorkerRequest[] {
    const ready: WorkerRequest[] = [];
    let count = 0;
    while (this.#queue.length > 0 && this.#queue[0]!.tick <= tick && count < this.#budget.perTickBudget) {
      ready.push(this.#queue.shift()!);
      count += 1;
    }
    return ready;
  }

  complete(id: number): boolean { return this.#outstanding.delete(id); }
  reject(id: number): boolean { this.#queue.splice(this.#queue.findIndex((request) => request.id === id), 1); return this.#outstanding.delete(id); }
  outstanding(): readonly WorkerRequest[] { return [...this.#outstanding.values()].sort((a, b) => a.id - b.id); }
  queued(): readonly WorkerRequest[] { return this.#queue; }
  clear(): void { this.#queue.length = 0; this.#outstanding.clear(); }
}

export interface WorkerHandler<T = unknown, R = unknown> {
  readonly channel: WorkerChannel;
  readonly kind: WorkerRequestKind;
  readonly handle: (payload: T, request: WorkerRequest<T>) => R | Promise<R>;
}

export class LoopbackWorkerRuntime {
  readonly #handlers = new Map<string, WorkerHandler>();
  readonly #queue: WorkerQueue;
  readonly #responses: WorkerResponse[] = [];

  constructor(queue = new WorkerQueue()) { this.#queue = queue; }

  register<T, R>(handler: WorkerHandler<T, R>): void {
    const key = `${handler.channel}:${handler.kind}`;
    this.#handlers.set(key, handler as WorkerHandler);
  }

  async pump(tick: number): Promise<readonly WorkerResponse[]> {
    const requests = this.#queue.drain(tick);
    const results: WorkerResponse[] = [];
    for (const request of requests) {
      const handler = this.#handlers.get(`${request.channel}:${request.kind}`);
      if (!handler) {
        results.push({ channel: request.channel, kind: 'error', id: request.id, tick: request.tick, payload: { code: 'NO_HANDLER', message: 'No worker handler', retryable: false } satisfies WorkerError });
        this.#queue.complete(request.id);
        continue;
      }
      try {
        const payload = await handler.handle(request.payload, request);
        const response = { channel: request.channel, kind: 'result', id: request.id, tick: request.tick, payload } satisfies WorkerResponse;
        validateResponse(response);
        results.push(response);
      } catch (error: unknown) {
        const response = { channel: request.channel, kind: 'error', id: request.id, tick: request.tick, payload: { code: 'HANDLER_ERROR', message: cleanText(error instanceof Error ? error.message : error, 256), retryable: true } satisfies WorkerError } satisfies WorkerResponse;
        results.push(response);
      } finally {
        this.#queue.complete(request.id);
      }
    }
    this.#responses.push(...results);
    while (this.#responses.length > 512) this.#responses.shift();
    return results;
  }

  responses(): readonly WorkerResponse[] { return this.#responses; }
}

export interface NavigationRequest {
  readonly start: { x: number; z: number };
  readonly goal: { x: number; z: number };
  readonly maxNodes: number;
}
export interface NavigationResult {
  readonly path: readonly { x: number; z: number }[];
  readonly visited: number;
  readonly reached: boolean;
}

export function deterministicGridPath(request: NavigationRequest): NavigationResult {
  const maxNodes = Math.max(1, Math.floor(request.maxNodes));
  const start = { x: Math.round(request.start.x), z: Math.round(request.start.z) };
  const goal = { x: Math.round(request.goal.x), z: Math.round(request.goal.z) };
  const path = [{ ...start }];
  let current = { ...start };
  let visited = 0;
  while ((current.x !== goal.x || current.z !== goal.z) && visited < maxNodes) {
    if (current.x !== goal.x) current = { ...current, x: current.x + Math.sign(goal.x - current.x) };
    else current = { ...current, z: current.z + Math.sign(goal.z - current.z) };
    path.push({ ...current });
    visited += 1;
  }
  return { path, visited, reached: current.x === goal.x && current.z === goal.z };
}

export function workerPayloadDigest(payload: unknown): string {
  const source = stable(payload);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
