import { R29Runtime } from './runtime.ts';
import type { R29RawInput } from './inputRuntime.ts';
import type { R29RuntimeHooks, R29RuntimeOptions, R29RuntimeSnapshot } from './contracts.ts';

export interface R29BrowserBridgeOptions extends R29RuntimeOptions {
  readonly canvas?: HTMLCanvasElement;
  readonly autoStart?: boolean;
  readonly maxDeltaSeconds?: number;
  readonly onSnapshot?: (snapshot: R29RuntimeSnapshot) => void;
  readonly onError?: (error: unknown) => void;
}

export class R29BrowserBridge {
  readonly runtime: R29Runtime;
  readonly canvas?: HTMLCanvasElement;
  readonly maxDeltaSeconds: number;

  #running = false;
  #raf = 0;
  #lastNow = 0;
  #listeners: Array<() => void> = [];
  #sequence = 0;
  #onError?: (error: unknown) => void;

  constructor(options: R29BrowserBridgeOptions = {}) {
    const hooks: R29RuntimeHooks = {
      onSnapshot: options.onSnapshot,
      onError: options.onError,
    };
    this.runtime = new R29Runtime(options, hooks);
    this.canvas = options.canvas;
    this.maxDeltaSeconds = Math.max(0.001, Math.min(1, options.maxDeltaSeconds ?? 0.25));
    this.#onError = options.onError;
    if (options.autoStart) void this.start();
  }

  async start(): Promise<void> {
    if (this.#running) return;
    if (typeof window === 'undefined') return;
    await this.runtime.start();
    this.#running = true;
    this.#lastNow = performance.now();
    this.#bindVisibility();
    this.#raf = requestAnimationFrame(this.#frame);
  }

  async step(deltaSeconds: number): Promise<void> {
    try {
      await this.runtime.frame(Math.max(0, Math.min(this.maxDeltaSeconds, deltaSeconds)));
    } catch (error) {
      this.#onError?.(error);
      throw error;
    }
  }

  enqueue(raw: Omit<R29RawInput, 'sequence'> & { readonly sequence?: number }): boolean {
    const sequence = Math.max(this.#sequence + 1, Math.floor(raw.sequence ?? this.#sequence + 1));
    this.#sequence = sequence;
    return this.runtime.enqueueInput({ ...raw, sequence });
  }

  async stop(): Promise<void> {
    this.#running = false;
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    await this.runtime.stop();
  }

  dispose(): void {
    this.#running = false;
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    for (const remove of this.#listeners.splice(0)) remove();
    this.runtime.dispose();
  }

  snapshot(): R29RuntimeSnapshot {
    return this.runtime.snapshot();
  }

  #frame = (now: number): void => {
    if (!this.#running) return;
    const delta = Math.max(0, Math.min(this.maxDeltaSeconds, (now - this.#lastNow) / 1000));
    this.#lastNow = now;
    void this.step(delta).then(() => {
      if (this.#running) this.#raf = requestAnimationFrame(this.#frame);
    }).catch(() => {
      this.#running = false;
    });
  };

  #bindVisibility(): void {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        void this.runtime.pause();
      } else if (this.#running) {
        this.runtime.resume();
      }
    };
    const onPageHide = (): void => {
      void this.stop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    this.#listeners.push(
      () => document.removeEventListener('visibilitychange', onVisibility),
      () => window.removeEventListener('pagehide', onPageHide),
    );
  }
}
