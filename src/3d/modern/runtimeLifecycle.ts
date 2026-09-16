import type { PlatformError, RuntimeSnapshot, UnixMillis } from './types';
import { checksum, stableStringify } from './deterministic';
import { Diagnostics } from './diagnostics';
import { TypedEventBus } from './eventBus';
import { RuntimeKernel, type KernelFrameInput } from './runtimeKernel';

export type LifecyclePhase = 'created' | 'starting' | 'running' | 'suspending' | 'suspended' | 'stopping' | 'stopped' | 'failed';

export interface LifecycleClock {
  now(): UnixMillis;
}

export interface RuntimeLifecycleOptions {
  readonly kernel: RuntimeKernel;
  readonly clock?: LifecycleClock;
  readonly visibilityTarget?: Document;
  readonly maxFrameGapMs?: number;
  readonly onSnapshot?: (snapshot: RuntimeSnapshot) => void;
}

export interface LifecycleState {
  readonly phase: LifecyclePhase;
  readonly session: string;
  readonly frames: number;
  readonly lastFrameAt: UnixMillis;
  readonly lastError: PlatformError | null;
}

export interface RuntimeLifecycleEvents {
  readonly 'lifecycle:phase': { readonly previous: LifecyclePhase; readonly next: LifecyclePhase; readonly reason: string };
  readonly 'lifecycle:frame': { readonly frame: number; readonly snapshot: RuntimeSnapshot };
  readonly 'lifecycle:error': PlatformError;
  readonly 'lifecycle:visibility': { readonly state: DocumentVisibilityState };
}

const DEFAULT_MAX_GAP_MS = 250;

function browserClock(): LifecycleClock {
  return {
    now: () => Math.max(0, Math.trunc(typeof performance !== 'undefined' ? performance.timeOrigin + performance.now() : Date.now())) as UnixMillis,
  };
}

/**
 * Owns application-level lifecycle without owning the browser render loop.
 * It converts visibility/page lifecycle events into deterministic kernel state transitions and
 * guarantees teardown listeners are removed exactly once.
 */
export class RuntimeLifecycle {
  readonly kernel: RuntimeKernel;
  readonly diagnostics: Diagnostics;
  readonly events = new TypedEventBus<RuntimeLifecycleEvents>({ maxListeners: 128 });

  #clock: LifecycleClock;
  #target: Document | null;
  #phase: LifecyclePhase = 'created';
  #session: string;
  #frames = 0;
  #lastFrameAt: UnixMillis = 0 as UnixMillis;
  #lastError: PlatformError | null = null;
  #maxGapMs: number;
  #unsubscribers: Array<() => void> = [];
  #onSnapshot?: (snapshot: RuntimeSnapshot) => void;

  constructor(options: RuntimeLifecycleOptions) {
    this.kernel = options.kernel;
    this.diagnostics = options.kernel.diagnostics;
    this.#clock = options.clock ?? browserClock();
    this.#target = options.visibilityTarget ?? (typeof document !== 'undefined' ? document : null);
    this.#maxGapMs = Math.max(16, options.maxFrameGapMs ?? DEFAULT_MAX_GAP_MS);
    this.#session = checksum({ seed: this.kernel.seed, created: Number(this.#clock.now()) });
    this.#onSnapshot = options.onSnapshot;
  }

  get state(): LifecycleState {
    return Object.freeze({
      phase: this.#phase,
      session: this.#session,
      frames: this.#frames,
      lastFrameAt: this.#lastFrameAt,
      lastError: this.#lastError,
    });
  }

  start(): void {
    if (this.#phase === 'running' || this.#phase === 'starting') return;
    if (this.#phase === 'stopped' || this.#phase === 'failed') throw new Error(`Runtime cannot start from ${this.#phase}`);
    this.#transition('starting', 'start');
    try {
      this.kernel.start();
      this.#bindLifecycleEvents();
      this.#frames = 0;
      this.#lastFrameAt = this.#clock.now();
      this.#transition('running', 'started');
    } catch (cause) {
      this.#fail({ code: 'LIFECYCLE_START_FAILED', message: String(cause), retryable: true, cause });
      throw cause;
    }
  }

  async frame(input: KernelFrameInput): Promise<RuntimeSnapshot> {
    if (this.#phase !== 'running') throw new Error(`Runtime frame rejected while ${this.#phase}`);
    const now = this.#clock.now();
    const gap = Math.max(0, Number(now) - Number(this.#lastFrameAt));
    const guardedInput: KernelFrameInput = gap > this.#maxGapMs
      ? { ...input, frameMs: Math.min(input.frameMs, this.#maxGapMs) }
      : input;
    try {
      const result = await this.kernel.tick(guardedInput);
      this.#frames += 1;
      this.#lastFrameAt = now;
      this.events.emit('lifecycle:frame', { frame: this.#frames, snapshot: result.snapshot });
      this.#onSnapshot?.(result.snapshot);
      return result.snapshot;
    } catch (cause) {
      const error = { code: 'LIFECYCLE_FRAME_FAILED', message: String(cause), retryable: true, cause } satisfies PlatformError;
      this.#fail(error);
      throw cause;
    }
  }

  suspend(reason = 'manual'): void {
    if (this.#phase !== 'running') return;
    this.#transition('suspending', reason);
    this.kernel.stop();
    this.#transition('suspended', reason);
  }

  resume(reason = 'manual'): void {
    if (this.#phase !== 'suspended') return;
    this.#transition('starting', reason);
    try {
      this.kernel.start();
      this.#lastFrameAt = this.#clock.now();
      this.#transition('running', reason);
    } catch (cause) {
      const error = { code: 'LIFECYCLE_RESUME_FAILED', message: String(cause), retryable: true, cause } satisfies PlatformError;
      this.#fail(error);
      throw cause;
    }
  }

  stop(reason = 'manual'): void {
    if (this.#phase === 'stopped' || this.#phase === 'stopping') return;
    this.#transition('stopping', reason);
    try {
      this.#unbindLifecycleEvents();
      this.kernel.stop();
      this.#transition('stopped', reason);
    } catch (cause) {
      const error = { code: 'LIFECYCLE_STOP_FAILED', message: String(cause), retryable: false, cause } satisfies PlatformError;
      this.#fail(error);
      throw cause;
    }
  }

  report(): Readonly<Record<string, unknown>> {
    const kernel = this.kernel.diagnosticsSnapshot();
    return Object.freeze({
      session: this.#session,
      phase: this.#phase,
      frames: this.#frames,
      lastFrameAt: Number(this.#lastFrameAt),
      lastError: this.#lastError,
      kernel,
      digest: checksum(stableStringify({ session: this.#session, phase: this.#phase, frames: this.#frames, kernel })),
    });
  }

  dispose(): void {
    this.#unbindLifecycleEvents();
    this.kernel.stop();
    this.events.clear();
  }

  #transition(next: LifecyclePhase, reason: string): void {
    const previous = this.#phase;
    this.#phase = next;
    this.events.emit('lifecycle:phase', { previous, next, reason });
  }

  #fail(error: PlatformError): void {
    this.#lastError = error;
    this.#phase = 'failed';
    this.diagnostics.error(error.code, error.message, 'lifecycle', { cause: String(error.cause ?? '') });
    this.events.emit('lifecycle:error', error);
  }

  #bindLifecycleEvents(): void {
    if (!this.#target || this.#unsubscribers.length) return;
    const onVisibility = (): void => {
      const state = this.#target?.visibilityState ?? 'visible';
      this.events.emit('lifecycle:visibility', { state });
      if (state === 'hidden') this.suspend('visibility:hidden');
      else if (state === 'visible') this.resume('visibility:visible');
    };
    const onPageHide = (): void => this.suspend('pagehide');
    const onPageShow = (): void => this.resume('pageshow');
    this.#target.addEventListener('visibilitychange', onVisibility, { passive: true });
    globalThis.addEventListener?.('pagehide', onPageHide, { passive: true });
    globalThis.addEventListener?.('pageshow', onPageShow, { passive: true });
    this.#unsubscribers.push(
      () => this.#target?.removeEventListener('visibilitychange', onVisibility),
      () => globalThis.removeEventListener?.('pagehide', onPageHide),
      () => globalThis.removeEventListener?.('pageshow', onPageShow),
    );
  }

  #unbindLifecycleEvents(): void {
    const removers = this.#unsubscribers.splice(0).reverse();
    for (const remove of removers) remove();
  }
}

export function createLifecycleForKernel(kernel: RuntimeKernel, target?: Document): RuntimeLifecycle {
  return new RuntimeLifecycle({ kernel, visibilityTarget: target });
}
