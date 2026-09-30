/**
 * Structured worker protocol for AAPW v3.
 *
 * Messages use a small discriminated union with explicit request ids. The protocol can be transported
 * through Worker, SharedWorker, MessagePort, WebSocket or an in-process test adapter. Payloads are
 * cloned into plain data before dispatch so platform objects cannot leak across the authority boundary.
 */

export type WorkerChannelV3 = 'simulation' | 'streaming' | 'render' | 'audio' | 'telemetry';
export type WorkerMessageKindV3 = 'hello' | 'tick' | 'load' | 'unload' | 'snapshot' | 'command' | 'ack' | 'error' | 'shutdown';

export interface WorkerEnvelopeV3<T extends object = Record<string, unknown>> {
  readonly version: 3;
  readonly channel: WorkerChannelV3;
  readonly kind: WorkerMessageKindV3;
  readonly requestId: string;
  readonly tick: number;
  readonly payload: T;
}

export interface WorkerHelloPayloadV3 { runtime: string; capabilities: readonly string[]; }
export interface WorkerTickPayloadV3 { dt: number; input: Readonly<Record<string, number | boolean>>; }
export interface WorkerLoadPayloadV3 { assetId: string; url: string; kind: string; }
export interface WorkerUnloadPayloadV3 { assetId: string; }
export interface WorkerSnapshotPayloadV3 { checksum: string; entities: readonly Record<string, unknown>[]; }
export interface WorkerCommandPayloadV3 { name: string; args: readonly unknown[]; }
export interface WorkerAckPayloadV3 { accepted: boolean; result?: unknown; }
export interface WorkerErrorPayloadV3 { code: string; message: string; retryable: boolean; }

export interface WorkerPortV3 {
  postMessage(message: unknown): void;
  start?(): void;
  close?(): void;
  addEventListener?(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener?(type: 'message', listener: (event: MessageEvent) => void): void;
}

export interface WorkerRouterMetricsV3 {
  received: number;
  dispatched: number;
  rejected: number;
  errors: number;
  openRequests: number;
}

const allowedKinds = new Set<WorkerMessageKindV3>(['hello', 'tick', 'load', 'unload', 'snapshot', 'command', 'ack', 'error', 'shutdown']);
const allowedChannels = new Set<WorkerChannelV3>(['simulation', 'streaming', 'render', 'audio', 'telemetry']);

function cleanId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,96}$/.test(id)) throw new Error('Invalid worker request id');
  return id;
}

export function validateWorkerEnvelopeV3(value: unknown): asserts value is WorkerEnvelopeV3 {
  if (!value || typeof value !== 'object') throw new Error('Worker message must be an object');
  const message = value as Record<string, unknown>;
  if (message.version !== 3) throw new Error('Unsupported worker protocol version');
  if (typeof message.channel !== 'string' || !allowedChannels.has(message.channel as WorkerChannelV3)) throw new Error('Invalid worker channel');
  if (typeof message.kind !== 'string' || !allowedKinds.has(message.kind as WorkerMessageKindV3)) throw new Error('Invalid worker message kind');
  if (typeof message.requestId !== 'string') throw new Error('Missing worker request id');
  cleanId(message.requestId);
  if (!Number.isInteger(message.tick) || Number(message.tick) < 0) throw new Error('Invalid worker tick');
  if (!message.payload || typeof message.payload !== 'object' || Array.isArray(message.payload)) throw new Error('Invalid worker payload');
}

export const workerEnvelopeV3 = <T extends object>(
  channel: WorkerChannelV3,
  kind: WorkerMessageKindV3,
  requestId: string,
  tick: number,
  payload: T,
): WorkerEnvelopeV3<T> => {
  const id = cleanId(requestId);
  if (!Number.isInteger(tick) || tick < 0) throw new RangeError('tick must be a non-negative integer');
  return Object.freeze({ version: 3, channel, kind, requestId: id, tick, payload: structuredClone(payload) });
};

type Handler = (message: WorkerEnvelopeV3) => void | Promise<void>;

export class WorkerRouterV3 {
  #port: WorkerPortV3;
  #handlers = new Map<string, Handler>();
  #open = new Set<string>();
  #metrics: WorkerRouterMetricsV3 = { received: 0, dispatched: 0, rejected: 0, errors: 0, openRequests: 0 };
  #listener: ((event: MessageEvent) => void) | null = null;

  constructor(port: WorkerPortV3) { this.#port = port; }

  start(): void {
    if (!this.#port.addEventListener) return;
    this.#listener = (event: MessageEvent): void => { void this.receive(event.data); };
    this.#port.addEventListener('message', this.#listener);
    this.#port.start?.();
  }

  stop(): void {
    if (this.#listener && this.#port.removeEventListener) this.#port.removeEventListener('message', this.#listener);
    this.#listener = null;
    this.#port.close?.();
  }

  register(kind: WorkerMessageKindV3, channel: WorkerChannelV3, handler: Handler): void {
    this.#handlers.set(`${channel}:${kind}`, handler);
  }

  async receive(value: unknown): Promise<boolean> {
    this.#metrics.received += 1;
    try {
      validateWorkerEnvelopeV3(value);
      const message = value as WorkerEnvelopeV3;
      const handler = this.#handlers.get(`${message.channel}:${message.kind}`) ?? this.#handlers.get(`*:${message.kind}`);
      if (!handler) {
        this.#metrics.rejected += 1;
        this.reply(workerEnvelopeV3('telemetry', 'error', message.requestId, message.tick, {
          code: 'NO_HANDLER', message: `No handler for ${message.channel}:${message.kind}`, retryable: false,
        } satisfies WorkerErrorPayloadV3));
        return false;
      }
      if (message.kind !== 'hello' && message.kind !== 'ack' && message.kind !== 'error') this.#open.add(message.requestId);
      this.#metrics.openRequests = this.#open.size;
      await handler(message);
      this.#metrics.dispatched += 1;
      if (message.kind !== 'tick') this.#open.delete(message.requestId);
      this.#metrics.openRequests = this.#open.size;
      return true;
    } catch (error) {
      this.#metrics.errors += 1;
      return false;
    }
  }

  reply<T extends object>(message: WorkerEnvelopeV3<T>): void {
    validateWorkerEnvelopeV3(message);
    this.#open.delete(message.requestId);
    this.#metrics.openRequests = this.#open.size;
    this.#port.postMessage(message);
  }

  metrics(): WorkerRouterMetricsV3 { return { ...this.#metrics }; }
}

export class LoopbackWorkerPortV3 implements WorkerPortV3 {
  #listeners = new Set<(event: MessageEvent) => void>();
  #peer: LoopbackWorkerPortV3 | null = null;
  #closed = false;

  connect(peer: LoopbackWorkerPortV3): void { this.#peer = peer; peer.#peer = this; }

  postMessage(message: unknown): void {
    if (this.#closed || !this.#peer) return;
    const event = { data: structuredClone(message) } as MessageEvent;
    for (const listener of this.#peer.#listeners) listener(event);
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void): void { this.#listeners.add(listener); }
  removeEventListener(_type: 'message', listener: (event: MessageEvent) => void): void { this.#listeners.delete(listener); }
  start(): void { /* Loopback delivery is immediate. */ }
  close(): void { this.#closed = true; this.#listeners.clear(); }
}
