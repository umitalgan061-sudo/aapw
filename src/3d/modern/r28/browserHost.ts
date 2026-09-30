import { R27Runtime, type R27RuntimeConfig } from '../r27/runtime.ts';
import type { InputFrame, RuntimeEvent, RuntimeSnapshot } from '../r27/contracts.ts';
import { RuntimeSecurityBoundary } from '../r27/security.ts';
import { DomInputSampler } from './inputDom.ts';
import { profileRuntimeEnvironment, readBrowserCapabilities, type RuntimeEnvironmentProfile } from './environment.ts';

export interface BrowserHostOptions extends Partial<R27RuntimeConfig> {
  readonly canvas?: HTMLCanvasElement;
  readonly maxFrameDeltaSeconds?: number;
  readonly input?: DomInputSampler;
  readonly onSnapshot?: (snapshot: RuntimeSnapshot) => void;
  readonly onEvents?: (events: readonly RuntimeEvent[]) => void;
  readonly onError?: (error: unknown) => void;
}

export interface BrowserHostState {
  readonly running: boolean;
  readonly hidden: boolean;
  readonly tick: number;
  readonly frameCount: number;
  readonly lastFrameMs: number;
  readonly environment: RuntimeEnvironmentProfile;
}

export class BrowserRuntimeHost {
  readonly runtime: R27Runtime;
  readonly environment: RuntimeEnvironmentProfile;
  readonly input: DomInputSampler;
  readonly security = new RuntimeSecurityBoundary();
  readonly maxFrameDeltaSeconds: number;
  readonly canvas?: HTMLCanvasElement;

  #onSnapshot?: (snapshot: RuntimeSnapshot) => void;
  #onEvents?: (events: readonly RuntimeEvent[]) => void;
  #onError?: (error: unknown) => void;
  #running = false;
  #hidden = false;
  #frameCount = 0;
  #lastNow = 0;
  #lastFrameMs = 0;
  #raf = 0;
  #listeners: Array<() => void> = [];

  constructor(options: BrowserHostOptions = {}) {
    this.environment = profileRuntimeEnvironment(readBrowserCapabilities());
    this.runtime = new R27Runtime({
      tickRate: options.tickRate ?? 60,
      maxStepsPerFrame: options.maxStepsPerFrame ?? 5,
      budget: options.budget ?? {},
      qualityLevel: options.qualityLevel ?? this.environment.qualityHint,
    });
    this.input = options.input ?? new DomInputSampler();
    this.maxFrameDeltaSeconds = Math.max(0.001, options.maxFrameDeltaSeconds ?? 0.25);
    this.canvas = options.canvas;
    this.#onSnapshot = options.onSnapshot;
    this.#onEvents = options.onEvents;
    this.#onError = options.onError;
  }

  mount(): void {
    if (typeof window === 'undefined') return;
    if (this.canvas) {
      this.input.bind(this.canvas);
      this.canvas.addEventListener('pointerdown', this.#requestPointerLock);
      this.#listeners.push(() => this.canvas?.removeEventListener('pointerdown', this.#requestPointerLock));
    }
    const visibility = (): void => {
      this.#hidden = document.visibilityState === 'hidden';
      if (this.#hidden) this.runtime.setInput(this.input.sample(this.runtime.currentTick()));
    };
    const pagehide = (): void => this.stop();
    const error = (event: ErrorEvent): void => this.#onError?.(event.error ?? event.message);
    const rejection = (event: PromiseRejectionEvent): void => this.#onError?.(event.reason);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('error', error);
    window.addEventListener('unhandledrejection', rejection);
    this.#listeners.push(
      () => document.removeEventListener('visibilitychange', visibility),
      () => window.removeEventListener('pagehide', pagehide),
      () => window.removeEventListener('error', error),
      () => window.removeEventListener('unhandledrejection', rejection),
    );
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#lastNow = performance.now();
    this.#raf = requestAnimationFrame(this.#frame);
  }

  stop(): void {
    this.#running = false;
    if (this.#raf) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  dispose(): void {
    this.stop();
    for (const remove of this.#listeners.splice(0)) remove();
    this.input.dispose();
  }

  step(deltaSeconds: number, explicitInput?: InputFrame): BrowserHostState {
    const safeDelta = Math.max(0, Math.min(this.maxFrameDeltaSeconds, deltaSeconds));
    if (explicitInput) {
      const verdict = this.security.validateInput(explicitInput);
      if (verdict.sanitizedInput) this.runtime.setInput(verdict.sanitizedInput);
    } else if (!this.#hidden) {
      this.runtime.setInput(this.input.sample(this.runtime.currentTick()));
    }

    const before = performance.now();
    const result = this.runtime.runFrame(safeDelta);
    this.#lastFrameMs = performance.now() - before;
    this.#frameCount++;
    this.#onSnapshot?.(result.snapshot);
    this.#onEvents?.(result.events);
    return this.state();
  }

  state(): BrowserHostState {
    return Object.freeze({
      running: this.#running,
      hidden: this.#hidden,
      tick: this.runtime.currentTick(),
      frameCount: this.#frameCount,
      lastFrameMs: this.#lastFrameMs,
      environment: this.environment,
    });
  }

  #requestPointerLock = (): void => {
    void this.input.requestPointerLock().catch((error) => this.#onError?.(error));
  };

  #frame = (now: number): void => {
    if (!this.#running) return;
    const delta = Math.max(0, Math.min(this.maxFrameDeltaSeconds, (now - this.#lastNow) / 1000));
    this.#lastNow = now;
    try {
      this.step(delta);
    } catch (error) {
      this.#onError?.(error);
      this.stop();
      return;
    }
    this.#raf = requestAnimationFrame(this.#frame);
  };
}
