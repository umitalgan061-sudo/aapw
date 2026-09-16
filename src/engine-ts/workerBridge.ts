import type { Disposable, EngineResult, TickId } from './types.js';
import { ProtocolCodec, SequenceWindow, type EngineMessage } from './protocol.js';

export interface WorkerLike { postMessage(message: unknown): void; terminate?(): void; addEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: MessageEvent | ErrorEvent) => void): void; removeEventListener?(type: 'message' | 'error' | 'messageerror', listener: (event: MessageEvent | ErrorEvent) => void): void; }
export interface WorkerBridgeOptions { readonly queueLimit?: number; readonly timeoutMs?: number; readonly protocolClient?: string; }
export interface BridgeStats { readonly sent: number; readonly received: number; readonly rejected: number; readonly timeouts: number; readonly queueDepth: number; readonly nextSequence: number; readonly ready: boolean; }

type Pending = { readonly sequence: number; readonly resolve: (value: EngineMessage | undefined) => void; readonly timer: ReturnType<typeof setTimeout> };

export class WorkerBridge implements Disposable {
  private readonly worker: WorkerLike;
  private readonly codec = new ProtocolCodec();
  private readonly window = new SequenceWindow(512);
  private readonly queueLimit: number;
  private readonly timeoutMs: number;
  private readonly pending = new Map<number, Pending>();
  private readonly outbound: EngineMessage[] = [];
  private readonly onMessageBound: (event: MessageEvent | ErrorEvent) => void;
  private readonly onErrorBound: (event: MessageEvent | ErrorEvent) => void;
  private _disposed = false;
  private _ready = false;
  private sent = 0;
  private received = 0;
  private rejected = 0;
  private timeouts = 0;
  private nextSequence = 1;

  public constructor(worker: WorkerLike, options: WorkerBridgeOptions = {}) {
    this.worker = worker;
    this.queueLimit = Math.max(8, Math.trunc(options.queueLimit ?? 256));
    this.timeoutMs = Math.max(50, Math.trunc(options.timeoutMs ?? 2000));
    this.onMessageBound = event => this.onMessage(event);
    this.onErrorBound = () => { this._ready = false; this.rejectAll(); };
    worker.addEventListener('message', this.onMessageBound);
    worker.addEventListener('messageerror', this.onErrorBound);
    worker.addEventListener('error', this.onErrorBound);
    this.send('hello', { client: options.protocolClient ?? 'aapw-engine-ts', protocol: 1, capabilities: ['snapshot', 'command', 'event'] }, 0);
  }

  public get disposed(): boolean { return this._disposed; }
  public get ready(): boolean { return this._ready; }
  public get stats(): BridgeStats { return Object.freeze({ sent: this.sent, received: this.received, rejected: this.rejected, timeouts: this.timeouts, queueDepth: this.outbound.length, nextSequence: this.nextSequence, ready: this._ready }); }

  public async request<T = unknown>(message: EngineMessage<T>): Promise<EngineMessage | undefined> {
    if (this._disposed || this.outbound.length >= this.queueLimit) { this.rejected += 1; return undefined; }
    const sequence = Number(message.sequence);
    this.outbound.push(message);
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.pending.delete(sequence); this.timeouts += 1; resolve(undefined); }, this.timeoutMs);
      this.pending.set(sequence, { sequence, resolve, timer });
      this.flush();
    });
  }

  public send<T>(message: EngineMessage['message'], payload: T, tick: TickId): EngineResult<number> {
    if (this._disposed) return { ok: false, meta: { status: 'disposed', code: 'BRIDGE_DISPOSED' } };
    if (this.outbound.length >= this.queueLimit) { this.rejected += 1; return { ok: false, meta: { status: 'overflow', code: 'BRIDGE_BACKPRESSURE' } }; }
    const sequence = this.nextSequence++;
    const envelope = this.codec.message(message, sequence, Number(tick), payload);
    this.outbound.push(envelope);
    this.flush();
    return { ok: true, value: sequence, meta: { status: 'ok', code: 'SENT' } };
  }

  public sendJson(encoded: string): boolean {
    if (this._disposed || this.outbound.length >= this.queueLimit) return false;
    const decoded = this.codec.decode(encoded);
    if (!decoded.ok || !decoded.value) return false;
    this.outbound.push(decoded.value);
    this.flush();
    return true;
  }

  public markReady(): void { if (!this._disposed) this._ready = true; }
  public clearPending(): void { this.rejectAll(); }

  public dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.rejectAll();
    this.outbound.length = 0;
    this.worker.removeEventListener?.('message', this.onMessageBound);
    this.worker.removeEventListener?.('messageerror', this.onErrorBound);
    this.worker.removeEventListener?.('error', this.onErrorBound);
    try { this.worker.terminate?.(); } catch { /* isolation */ }
  }

  private flush(): void {
    if (this._disposed) return;
    while (this.outbound.length > 0) {
      const message = this.outbound.shift()!;
      try { this.worker.postMessage(this.codec.encode(message)); this.sent += 1; }
      catch { this.rejected += 1; }
    }
  }

  private onMessage(event: MessageEvent | ErrorEvent): void {
    if (this._disposed || !('data' in event)) return;
    const raw = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
    const decoded = this.codec.decode(raw);
    if (!decoded.ok || !decoded.value) { this.rejected += 1; return; }
    const message = decoded.value;
    if (!this.window.accept(Number(message.sequence))) { this.rejected += 1; return; }
    this.received += 1;
    if (message.message === 'ready') this._ready = true;
    const pending = this.pending.get(Number(message.sequence));
    if (pending) { clearTimeout(pending.timer); this.pending.delete(Number(message.sequence)); pending.resolve(message); }
  }

  private rejectAll(): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.resolve(undefined); }
    this.pending.clear();
  }
}
