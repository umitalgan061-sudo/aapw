import type { Backend, QualityTier } from '../../types/platform.js';
import type { V3Action, V3RenderPacket, V3RuntimeSnapshot, V3Viewport } from './runtimeContracts.js';
import {
  V3_WORKER_PROTOCOL,
  type V3WorkerCapabilities,
  type V3WorkerDeviceState,
  type V3WorkerError,
  type V3WorkerMessage,
  type V3WorkerReady,
  type V3WorkerSnapshot,
  type V3WorkerRenderPacket,
  assertDirection,
  canTransferOffscreenCanvas,
  createAction,
  createHandshake,
  createLifecycle,
  createTick,
  detectWorkerCapabilities,
  isV3WorkerMessage,
  makeWorkerHeader,
} from './workerProtocol.js';

export interface V3WorkerHostOptions {
  readonly workerUrl: string | URL;
  readonly backend: Backend;
  readonly quality: QualityTier;
  readonly seed: number;
  readonly viewport: V3Viewport;
  readonly maxStartupMs?: number;
  readonly maxRestarts?: number;
  readonly workerFactory?: (url: string | URL, options: WorkerOptions) => Worker;
  readonly onSnapshot?: (snapshot: V3RuntimeSnapshot) => void;
  readonly onRenderPacket?: (packet: V3RenderPacket) => void;
  readonly onError?: (error: { readonly code: string; readonly message: string; readonly recoverable: boolean }) => void;
}

export interface V3WorkerHostState {
  readonly active: boolean;
  readonly ready: boolean;
  readonly fallback: boolean;
  readonly restartCount: number;
  readonly lastSequence: number;
  readonly workerId?: string;
  readonly capabilities: V3WorkerCapabilities;
  readonly lastError?: string;
}

export class V3WorkerHost implements Disposable {
  readonly #options: V3WorkerHostOptions;
  readonly #caps: V3WorkerCapabilities;
  #worker: Worker | null = null;
  #active = false;
  #ready = false;
  #fallback = false;
  #restartCount = 0;
  #sequence = 0;
  #workerId: string | undefined;
  #lastError: string | undefined;
  #startupTimer: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;

  constructor(options: V3WorkerHostOptions) {
    this.#options = Object.freeze({ ...options });
    this.#caps = detectWorkerCapabilities(options.backend);
  }

  capabilities(): V3WorkerCapabilities { return this.#caps; }

  state(): V3WorkerHostState {
    return Object.freeze({ active: this.#active, ready: this.#ready, fallback: this.#fallback, restartCount: this.#restartCount, lastSequence: this.#sequence, workerId: this.#workerId, capabilities: this.#caps, lastError: this.#lastError });
  }

  async start(canvas?: HTMLCanvasElement): Promise<boolean> {
    this.assertAlive();
    if (this.#active) return this.#ready;
    if (!this.#caps.dedicatedWorker) return this.failover('WORKER_UNAVAILABLE', 'Dedicated Worker API is unavailable');
    if (canvas && !canTransferOffscreenCanvas(canvas) && this.#options.workerUrl.toString().includes('render')) return this.failover('OFFSCREEN_UNAVAILABLE', 'Canvas cannot be transferred to a worker');
    const factory = this.#options.workerFactory ?? ((url, workerOptions) => new Worker(url, workerOptions));
    try {
      const worker = factory(this.#options.workerUrl, { type: 'module', name: 'aapw-v3-runtime', credentials: 'same-origin' });
      this.#worker = worker;
      this.#active = true;
      this.#ready = false;
      worker.onmessage = event => this.#onMessage(event.data);
      worker.onerror = event => this.#onFailure('WORKER_RUNTIME_ERROR', event.message || 'Worker execution failed');
      worker.onmessageerror = () => this.#onFailure('WORKER_MESSAGE_ERROR', 'Worker message could not be deserialized');
      const handshake = createHandshake({ seq: this.nextSequence(), nowMs: this.now(), seed: this.#options.seed, fixedStepMs: 1000 / 60, backend: this.#options.backend, quality: this.#options.quality, viewport: this.#options.viewport, supportsOffscreenCanvas: this.#caps.offscreenCanvas });
      worker.postMessage(handshake);
      if (canvas && canTransferOffscreenCanvas(canvas)) {
        const offscreen = canvas.transferControlToOffscreen();
        worker.postMessage({ ...handshake, type: 'handshake', offscreenCanvas: offscreen }, [offscreen]);
      }
      await this.waitForReady();
      return true;
    } catch (error) {
      this.#onFailure('WORKER_START_FAILED', error instanceof Error ? error.message : String(error));
      return this.failover('WORKER_START_FAILED', this.#lastError ?? 'worker startup failed');
    }
  }

  tick(nowMs = this.now(), deltaHintMs = 1000 / 60): boolean {
    if (!this.#worker || !this.#active || !this.#ready) return false;
    this.#worker.postMessage(createTick(nowMs, deltaHintMs, this.nextSequence()));
    return true;
  }

  dispatch(action: V3Action): boolean {
    if (!this.#worker || !this.#active || !this.#ready) return false;
    this.#worker.postMessage(createAction(action, this.nextSequence()));
    return true;
  }

  pause(reason = 'manual'): void { this.postLifecycle('pause', reason); }
  resume(reason = 'manual'): void { this.postLifecycle('resume', reason); }
  stop(reason = 'manual'): void { this.postLifecycle('stop', reason); this.closeWorker(); }

  async restart(canvas?: HTMLCanvasElement): Promise<boolean> {
    if (this.#disposed) return false;
    this.closeWorker();
    this.#restartCount += 1;
    const max = Math.max(0, Math.trunc(this.#options.maxRestarts ?? 2));
    if (this.#restartCount > max) return this.failover('WORKER_RESTART_LIMIT', 'Worker restart budget exhausted');
    return this.start(canvas);
  }

  dispose(): void { if (this.#disposed) return; this.#disposed = true; this.postLifecycle('dispose', 'host-dispose'); this.closeWorker(); }

  private async waitForReady(): Promise<boolean> {
    const timeout = Math.max(250, Math.trunc(this.#options.maxStartupMs ?? 5000));
    return new Promise<boolean>((resolve, reject) => {
      this.#startupTimer = setTimeout(() => reject(new Error('WORKER_READY_TIMEOUT')), timeout);
      const poll = (): void => { if (!this.#active) { reject(new Error('WORKER_STOPPED')); return; } if (this.#ready) { this.clearStartupTimer(); resolve(true); return; } setTimeout(poll, 10); };
      poll();
    });
  }

  private #onMessage(raw: unknown): void {
    if (!isV3WorkerMessage(raw)) { this.#onFailure('WORKER_PROTOCOL_ERROR', `Unexpected ${V3_WORKER_PROTOCOL} message`); return; }
    try { assertDirection(raw, 'worker-to-main'); } catch (error) { this.#onFailure('WORKER_DIRECTION_ERROR', error instanceof Error ? error.message : String(error)); return; }
    this.#sequence = Math.max(this.#sequence, raw.header.seq);
    switch (raw.type) {
      case 'ready': this.#onReady(raw); break;
      case 'snapshot': this.#options.onSnapshot?.(raw.snapshot); break;
      case 'render-packet': this.#options.onRenderPacket?.(raw.packet); break;
      case 'device-state': this.#onDeviceState(raw); break;
      case 'error': this.#onError(raw); break;
      case 'handshake':
      case 'tick':
      case 'action':
      case 'pause':
      case 'resume':
      case 'stop':
      case 'dispose':
        this.#onFailure('WORKER_PROTOCOL_UNEXPECTED', `Unexpected worker message type ${raw.type}`);
        break;
    }
  }

  private #onReady(message: V3WorkerReady): void { this.#ready = true; this.#workerId = message.workerId; this.clearStartupTimer(); }
  private #onDeviceState(message: V3WorkerDeviceState): void { if (message.lost) { this.#ready = false; this.#lastError = message.reason ?? 'worker-device-lost'; } }
  private #onError(message: V3WorkerError): void { this.#lastError = message.message; this.#options.onError?.({ code: message.code, message: message.message, recoverable: message.recoverable }); }
  private #onFailure(code: string, message: string): void { this.#lastError = message; this.#ready = false; this.#options.onError?.({ code, message, recoverable: this.#restartCount < (this.#options.maxRestarts ?? 2) }); }

  private postLifecycle(type: Parameters<typeof createLifecycle>[0], reason: string): void { if (this.#worker && this.#active) this.#worker.postMessage(createLifecycle(type, reason, this.nextSequence(), this.now())); }
  private nextSequence(): number { this.#sequence += 1; return this.#sequence; }
  private now(): number { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
  private failover(code: string, message: string): false { this.#fallback = true; this.#active = false; this.#ready = false; this.#lastError = `${code}:${message}`; this.#options.onError?.({ code, message, recoverable: false }); return false; }
  private closeWorker(): void { this.clearStartupTimer(); this.#worker?.terminate(); this.#worker = null; this.#active = false; this.#ready = false; }
  private clearStartupTimer(): void { if (this.#startupTimer !== undefined) clearTimeout(this.#startupTimer); this.#startupTimer = undefined; }
  private assertAlive(): void { if (this.#disposed) throw new Error('V3 worker host disposed'); }
}

export const createV3WorkerHost = (options: V3WorkerHostOptions): V3WorkerHost => new V3WorkerHost(options);
