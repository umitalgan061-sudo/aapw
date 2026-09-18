import type { ExecutionLane, RuntimePhase } from './coreContracts';

export type WorkerMessage =
  | { readonly kind: 'boot'; readonly runtime: string; readonly version: number }
  | { readonly kind: 'tick'; readonly tick: number; readonly deltaSeconds: number }
  | { readonly kind: 'input'; readonly sequence: number; readonly payload: unknown }
  | { readonly kind: 'snapshot'; readonly tick: number; readonly payload: unknown }
  | { readonly kind: 'dispose' };

export type WorkerReply =
  | { readonly kind: 'ready'; readonly lane: ExecutionLane }
  | { readonly kind: 'ack'; readonly sequence: number }
  | { readonly kind: 'result'; readonly tick: number; readonly payload: unknown }
  | { readonly kind: 'error'; readonly code: string; readonly message: string };

export interface MessageEndpoint {
  postMessage(message: WorkerMessage): void;
  addEventListener(type: 'message', listener: (event: { data: WorkerMessage }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: WorkerMessage }) => void): void;
}

export interface WorkerBridgeConfig {
  readonly lane: ExecutionLane;
  readonly maxMessageBytes: number;
  readonly protocolVersion: number;
}

export interface WorkerBridgeMetrics {
  readonly sent: number;
  readonly received: number;
  readonly rejected: number;
  readonly lastSequence: number;
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export class WorkerBridgeV3 {
  readonly config: WorkerBridgeConfig;
  #endpoint?: MessageEndpoint;
  #handler?: (message: WorkerMessage) => void;
  #metrics: WorkerBridgeMetrics = { sent: 0, received: 0, rejected: 0, lastSequence: 0 };
  #boundListener?: (event: { data: WorkerMessage }) => void;
  #started = false;

  constructor(config: WorkerBridgeConfig) {
    if (config.maxMessageBytes < 256) throw new Error('worker message budget is too small');
    this.config = { ...config };
  }

  attach(endpoint: MessageEndpoint, handler: (message: WorkerMessage) => void): void {
    this.detach();
    this.#endpoint = endpoint;
    this.#handler = handler;
    this.#boundListener = (event) => this.#receive(event.data);
    endpoint.addEventListener('message', this.#boundListener);
    this.#started = true;
  }

  detach(): void {
    if (this.#endpoint && this.#boundListener) this.#endpoint.removeEventListener('message', this.#boundListener);
    this.#endpoint = undefined;
    this.#handler = undefined;
    this.#boundListener = undefined;
    this.#started = false;
  }

  send(message: WorkerMessage): boolean {
    if (!this.#endpoint || !this.#started) return false;
    if (!this.#validate(message)) {
      this.#metrics = { ...this.#metrics, rejected: this.#metrics.rejected + 1 };
      return false;
    }
    this.#endpoint.postMessage(structuredClone(message));
    this.#metrics = { ...this.#metrics, sent: this.#metrics.sent + 1, lastSequence: 'sequence' in message ? message.sequence : this.#metrics.lastSequence };
    return true;
  }

  tick(tick: number, deltaSeconds: number): boolean {
    return this.send({ kind: 'tick', tick, deltaSeconds });
  }

  input(sequence: number, payload: unknown): boolean {
    return this.send({ kind: 'input', sequence, payload });
  }

  metrics(): WorkerBridgeMetrics {
    return { ...this.#metrics };
  }

  phase(): RuntimePhase {
    return this.#started ? 'simulation' : 'boot';
  }

  #receive(message: WorkerMessage): void {
    if (!this.#validate(message)) {
      this.#metrics = { ...this.#metrics, rejected: this.#metrics.rejected + 1 };
      return;
    }
    this.#metrics = { ...this.#metrics, received: this.#metrics.received + 1 };
    this.#handler?.(structuredClone(message));
  }

  #validate(message: WorkerMessage): boolean {
    const bytes = serializedBytes(message);
    if (bytes > this.config.maxMessageBytes) return false;
    switch (message.kind) {
      case 'boot': return Number.isInteger(message.version) && message.version > 0 && message.runtime.length > 0 && message.runtime.length < 64;
      case 'tick': return Number.isFinite(message.deltaSeconds) && message.deltaSeconds >= 0 && message.deltaSeconds <= 0.25 && Number.isInteger(message.tick) && message.tick >= 0;
      case 'input': return Number.isInteger(message.sequence) && message.sequence >= 0;
      case 'snapshot': return Number.isInteger(message.tick) && message.tick >= 0;
      case 'dispose': return true;
    }
  }
}

export interface MainThreadWorkerFactory {
  create(): MessageEndpoint;
}

export class LoopbackEndpoint implements MessageEndpoint {
  #listeners = new Set<(event: { data: WorkerMessage }) => void>();
  #peer?: LoopbackEndpoint;

  connect(peer: LoopbackEndpoint): void {
    this.#peer = peer;
  }

  postMessage(message: WorkerMessage): void {
    const peer = this.#peer;
    if (!peer) return;
    for (const listener of peer.#listeners) listener({ data: structuredClone(message) });
  }

  addEventListener(_type: 'message', listener: (event: { data: WorkerMessage }) => void): void {
    this.#listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: { data: WorkerMessage }) => void): void {
    this.#listeners.delete(listener);
  }
}

export function createLoopbackPair(): readonly [LoopbackEndpoint, LoopbackEndpoint] {
  const a = new LoopbackEndpoint();
  const b = new LoopbackEndpoint();
  a.connect(b);
  b.connect(a);
  return [a, b];
}
