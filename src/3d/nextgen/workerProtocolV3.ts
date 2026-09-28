/** Typed worker protocol for moving simulation-heavy jobs off the render thread. */

export type WorkerDomain = 'navigation' | 'terrain' | 'streaming' | 'simulation' | 'serialization';
export type WorkerMessageKind = 'request' | 'response' | 'cancel' | 'heartbeat' | 'error';

export interface WorkerRequest<T = unknown> { kind: 'request'; id: number; domain: WorkerDomain; operation: string; payload: T; issuedTick: number; deadlineTick: number }
export interface WorkerResponse<T = unknown> { kind: 'response'; id: number; domain: WorkerDomain; operation: string; payload: T; startedTick: number; completedTick: number }
export interface WorkerError { kind: 'error'; id: number; domain: WorkerDomain; operation: string; message: string; retryable: boolean }
export interface WorkerCancel { kind: 'cancel'; id: number; domain: WorkerDomain }
export interface WorkerHeartbeat { kind: 'heartbeat'; tick: number; inflight: number }
export type WorkerMessage = WorkerRequest | WorkerResponse | WorkerCancel | WorkerError | WorkerHeartbeat;

export interface WorkerHandler<T = unknown, R = unknown> { domain: WorkerDomain; operation: string; handle(payload: T, request: WorkerRequest<T>): Promise<R> | R }
export interface BrokerStats { pending: number; completed: number; cancelled: number; failed: number; averageLatencyTicks: number }

function assertId(id: number): void { if (!Number.isInteger(id) || id <= 0) throw new RangeError('worker message id must be a positive integer'); }

export function encodeWorkerMessage(message: WorkerMessage): string {
  if ('id' in message) assertId(message.id);
  return JSON.stringify(message);
}

export function decodeWorkerMessage(text: string): WorkerMessage {
  const value = JSON.parse(text) as WorkerMessage;
  if (!value || typeof value !== 'object' || !('kind' in value)) throw new Error('invalid worker message');
  if (value.kind === 'heartbeat') return value;
  if (!('id' in value) || !('domain' in value)) throw new Error('worker message missing identity');
  assertId(value.id);
  return value;
}

export class WorkerTaskBroker {
  #nextId = 1;
  #pending = new Map<number, { request: WorkerRequest; startedAt: number }>();
  #handlers = new Map<string, WorkerHandler>();
  #completed = 0;
  #cancelled = 0;
  #failed = 0;
  #latencyTicks = 0;

  register<T, R>(handler: WorkerHandler<T, R>): void {
    const key = this.key(handler.domain, handler.operation);
    if (this.#handlers.has(key)) throw new Error(`duplicate worker handler ${key}`);
    this.#handlers.set(key, handler as WorkerHandler);
  }

  async request<T, R>(domain: WorkerDomain, operation: string, payload: T, issuedTick: number, deadlineTick: number): Promise<WorkerResponse<R>> {
    const handler = this.#handlers.get(this.key(domain, operation));
    if (!handler) throw new Error(`worker handler unavailable: ${domain}/${operation}`);
    if (deadlineTick < issuedTick) throw new RangeError('deadlineTick must be >= issuedTick');
    const id = this.#nextId++;
    const request: WorkerRequest<T> = { kind: 'request', id, domain, operation, payload, issuedTick, deadlineTick };
    this.#pending.set(id, { request, startedAt: issuedTick });
    try {
      const result = await handler.handle(payload, request);
      const response: WorkerResponse<R> = { kind: 'response', id, domain, operation, payload: result as R, startedTick: issuedTick, completedTick: deadlineTick };
      this.#pending.delete(id); this.#completed += 1; this.#latencyTicks += Math.max(0, response.completedTick - response.startedTick);
      return response;
    } catch (error) {
      this.#pending.delete(id); this.#failed += 1;
      throw error;
    }
  }

  cancel(id: number): WorkerCancel | null {
    assertId(id);
    const pending = this.#pending.get(id);
    if (!pending) return null;
    this.#pending.delete(id); this.#cancelled += 1;
    return { kind: 'cancel', id, domain: pending.request.domain };
  }

  heartbeat(tick: number): WorkerHeartbeat { return { kind: 'heartbeat', tick, inflight: this.#pending.size }; }
  stats(): BrokerStats { return { pending: this.#pending.size, completed: this.#completed, cancelled: this.#cancelled, failed: this.#failed, averageLatencyTicks: this.#completed ? this.#latencyTicks / this.#completed : 0 }; }
  pendingIds(): number[] { return [...this.#pending.keys()].sort((a, b) => a - b); }
  private key(domain: WorkerDomain, operation: string): string { return `${domain}:${operation}`; }
}

export interface WorkChunk<T> { index: number; total: number; payload: T }
export function chunkWork<T>(items: readonly T[], chunkSize: number): WorkChunk<T[]>[] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new RangeError('chunkSize must be a positive integer');
  const chunks: WorkChunk<T[]>[] = [];
  const total = Math.ceil(items.length / chunkSize);
  for (let index = 0; index < total; index += 1) chunks.push({ index, total, payload: items.slice(index * chunkSize, (index + 1) * chunkSize) });
  return chunks;
}

export function mergeWorkChunks<T>(chunks: readonly WorkChunk<T[]>[]): T[] {
  if (chunks.length === 0) return [];
  const ordered = [...chunks].sort((a, b) => a.index - b.index);
  const total = ordered[0]!.total;
  if (ordered.length !== total || ordered.some((chunk, index) => chunk.index !== index || chunk.total !== total)) throw new Error('incomplete or inconsistent work chunks');
  return ordered.flatMap((chunk) => chunk.payload);
}
