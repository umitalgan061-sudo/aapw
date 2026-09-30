import { checksum } from './deterministic';
import { RuntimeSecurityBoundary } from './runtimeSecurity';
import type { PlatformError, Result, UnixMillis } from './types';

export type TransportState = 'idle' | 'connecting' | 'open' | 'closing' | 'closed' | 'faulted';
export type TransportKind = 'loopback' | 'websocket' | 'webtransport' | 'broadcast';
export type MessagePriority = 0 | 1 | 2 | 3 | 4;

export interface TransportEnvelope<T = unknown> {
  readonly id: string;
  readonly sequence: number;
  readonly sentAt: UnixMillis;
  readonly kind: string;
  readonly priority: MessagePriority;
  readonly reliable: boolean;
  readonly payload: T;
  readonly checksum: string;
}

export interface TransportStats {
  readonly state: TransportState;
  readonly sent: number;
  readonly received: number;
  readonly dropped: number;
  readonly rejected: number;
  readonly bytesSent: number;
  readonly bytesReceived: number;
  readonly pending: number;
  readonly rttMs: number;
}

export interface TransportAdapter {
  readonly kind: TransportKind;
  connect(): Promise<void>;
  send(data: string): Promise<void>;
  close(): Promise<void>;
  onMessage(listener: (data: string) => void): () => void;
  onError(listener: (error: unknown) => void): () => void;
}

export interface TransportOptions {
  readonly now?: () => UnixMillis;
  readonly maxPending?: number;
  readonly maxMessageBytes?: number;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly security?: RuntimeSecurityBoundary;
}

function priority(value: number): MessagePriority { return Math.max(0, Math.min(4, Math.trunc(value))) as MessagePriority; }
function encodedBytes(value: string): number { return new TextEncoder().encode(value).byteLength; }

export class RuntimeTransport<T = unknown> {
  readonly adapter: TransportAdapter;
  readonly maxPending: number;
  readonly maxMessageBytes: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly security: RuntimeSecurityBoundary;
  #now: () => UnixMillis;
  #state: TransportState = 'idle';
  #sequence = 0;
  #pending: Array<{ envelope: TransportEnvelope<T>; attempts: number }> = [];
  #sent = 0;
  #received = 0;
  #dropped = 0;
  #rejected = 0;
  #bytesSent = 0;
  #bytesReceived = 0;
  #rttSamples: number[] = [];
  #listeners = new Set<(envelope: TransportEnvelope<T>) => void>();
  #disposers: Array<() => void> = [];

  constructor(adapter: TransportAdapter, options: TransportOptions = {}) {
    this.adapter = adapter;
    this.maxPending = Math.max(1, Math.min(2048, Math.trunc(options.maxPending ?? 256)));
    this.maxMessageBytes = Math.max(1024, Math.min(4 * 1024 * 1024, Math.trunc(options.maxMessageBytes ?? 256 * 1024)));
    this.maxRetries = Math.max(0, Math.min(8, Math.trunc(options.maxRetries ?? 3)));
    this.retryDelayMs = Math.max(0, Math.min(30_000, Math.trunc(options.retryDelayMs ?? 250)));
    this.#now = options.now ?? (() => Date.now() as UnixMillis);
    this.security = options.security ?? new RuntimeSecurityBoundary({ maxPayloadBytes: this.maxMessageBytes }, this.#now);
    this.#disposers.push(adapter.onMessage((data) => this.#onMessage(data)));
    this.#disposers.push(adapter.onError((error) => this.#onError(error)));
  }

  get state(): TransportState { return this.#state; }

  async connect(): Promise<Result<void>> {
    if (this.#state === 'open' || this.#state === 'connecting') return { ok: true, value: undefined };
    this.#state = 'connecting';
    try {
      await this.adapter.connect();
      this.#state = 'open';
      await this.flush();
      return { ok: true, value: undefined };
    } catch (cause) {
      this.#state = 'faulted';
      return { ok: false, error: this.error('TRANSPORT_CONNECT_FAILED', cause, true) };
    }
  }

  async send(kind: string, payload: T, options: { readonly priority?: number; readonly reliable?: boolean; readonly id?: string } = {}): Promise<Result<TransportEnvelope<T>>> {
    if (!kind || kind.length > 128) return { ok: false, error: this.error('TRANSPORT_KIND_INVALID', new Error('Invalid message kind'), false) };
    const guard = this.security.inspectPayload(payload, 'network', kind);
    if (!guard.ok) { this.#rejected += 1; return guard; }
    const envelope: TransportEnvelope<T> = Object.freeze({
      id: options.id ?? `m${this.#sequence + 1}`,
      sequence: ++this.#sequence,
      sentAt: this.#now(),
      kind,
      priority: priority(options.priority ?? 2),
      reliable: options.reliable ?? true,
      payload: structuredClone(payload),
      checksum: checksum(payload),
    });
    const encoded = JSON.stringify(envelope);
    const bytes = encodedBytes(encoded);
    if (bytes > this.maxMessageBytes) return { ok: false, error: this.error('TRANSPORT_MESSAGE_TOO_LARGE', new Error('message too large'), false) };
    if (this.#state !== 'open') {
      if (this.#pending.length >= this.maxPending) {
        const droppable = this.#pending.findIndex((item) => !item.envelope.reliable || item.envelope.priority <= 1);
        if (droppable >= 0) this.#pending.splice(droppable, 1);
        else { this.#dropped += 1; return { ok: false, error: this.error('TRANSPORT_BACKPRESSURE', new Error('pending queue full'), true) }; }
      }
      this.#pending.push({ envelope, attempts: 0 });
      this.#sortPending();
      return { ok: true, value: envelope };
    }
    try {
      await this.adapter.send(encoded);
      this.#sent += 1;
      this.#bytesSent += bytes;
      return { ok: true, value: envelope };
    } catch (cause) {
      this.#pending.push({ envelope, attempts: 1 });
      this.#sortPending();
      return { ok: false, error: this.error('TRANSPORT_SEND_FAILED', cause, true) };
    }
  }

  async flush(): Promise<void> {
    if (this.#state !== 'open') return;
    this.#sortPending();
    let attempts = 0;
    while (this.#pending.length && attempts++ < this.maxPending) {
      const item = this.#pending.shift()!;
      const encoded = JSON.stringify(item.envelope);
      try {
        await this.adapter.send(encoded);
        this.#sent += 1;
        this.#bytesSent += encodedBytes(encoded);
      } catch {
        item.attempts += 1;
        if (item.attempts <= this.maxRetries && item.envelope.reliable) {
          this.#pending.push(item);
          await this.#sleep(this.retryDelayMs * item.attempts);
        } else {
          this.#dropped += 1;
        }
      }
    }
  }

  onMessage(listener: (envelope: TransportEnvelope<T>) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.#state === 'closed') return;
    this.#state = 'closing';
    try { await this.adapter.close(); } finally { this.#state = 'closed'; for (const dispose of this.#disposers.splice(0)) dispose(); this.#pending.length = 0; }
  }

  stats(): TransportStats {
    const samples = this.#rttSamples;
    const rttMs = samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0;
    return Object.freeze({ state: this.#state, sent: this.#sent, received: this.#received, dropped: this.#dropped, rejected: this.#rejected, bytesSent: this.#bytesSent, bytesReceived: this.#bytesReceived, pending: this.#pending.length, rttMs });
  }

  #onMessage(data: string): void {
    const bytes = encodedBytes(data);
    this.#bytesReceived += bytes;
    if (bytes > this.maxMessageBytes) { this.#rejected += 1; return; }
    let raw: unknown;
    try { raw = JSON.parse(data); } catch { this.#rejected += 1; return; }
    const guard = this.security.inspectPayload(raw, 'network', 'transport-envelope');
    if (!guard.ok || !raw || typeof raw !== 'object') { this.#rejected += 1; return; }
    const candidate = raw as Partial<TransportEnvelope<T>>;
    if (typeof candidate.id !== 'string' || typeof candidate.sequence !== 'number' || typeof candidate.kind !== 'string' || typeof candidate.checksum !== 'string') { this.#rejected += 1; return; }
    if (checksum(candidate.payload) !== candidate.checksum) { this.#rejected += 1; return; }
    if (typeof candidate.sentAt === 'number') this.#recordRtt(Number(this.#now()) - candidate.sentAt);
    this.#received += 1;
    const envelope = Object.freeze(candidate as TransportEnvelope<T>);
    for (const listener of this.#listeners) listener(envelope);
  }

  #onError(error: unknown): void {
    this.#state = 'faulted';
    void error;
  }

  #sortPending(): void {
    this.#pending.sort((a, b) => (b.envelope.priority - a.envelope.priority) || (Number(a.envelope.sentAt) - Number(b.envelope.sentAt)) || (a.envelope.sequence - b.envelope.sequence));
  }

  #recordRtt(value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    this.#rttSamples.push(Math.min(value, 60_000));
    if (this.#rttSamples.length > 120) this.#rttSamples.shift();
  }

  #sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

  error(code: string, cause: unknown, retryable: boolean): PlatformError {
    return Object.freeze({ code, message: cause instanceof Error ? cause.message : String(cause), retryable, cause });
  }
}

export class LoopbackTransport implements TransportAdapter {
  readonly kind: TransportKind = 'loopback';
  #open = false;
  #message = new Set<(data: string) => void>();
  #errors = new Set<(error: unknown) => void>();

  async connect(): Promise<void> { this.#open = true; }
  async send(data: string): Promise<void> {
    if (!this.#open) throw new Error('loopback closed');
    queueMicrotask(() => { for (const listener of this.#message) listener(data); });
  }
  async close(): Promise<void> { this.#open = false; }
  onMessage(listener: (data: string) => void): () => void { this.#message.add(listener); return () => this.#message.delete(listener); }
  onError(listener: (error: unknown) => void): () => void { this.#errors.add(listener); return () => this.#errors.delete(listener); }
}
