/** Browser-facing loop adapter: deterministic simulation cadence plus interpolation hooks. */

import { FixedStepControllerV3, type FixedStepConfig, type FixedStepResult } from './fixedStepControllerV3';
import { NextGenRuntimeV3 } from './runtimeFacadeV3';

export interface RuntimeLoopHooks {
  beforeStep?(tick: number): void;
  afterStep?(tick: number): void;
  render?(alpha: number, tick: number): void;
  frame?(result: FixedStepResult): void;
  onError?(error: unknown): void;
}

export interface RuntimeLoopState { running: boolean; frameCount: number; simulationSteps: number; droppedSeconds: number; lastTick: number }

export class RuntimeLoopV3 {
  readonly runtime: NextGenRuntimeV3;
  readonly fixedStep: FixedStepControllerV3;
  readonly hooks: RuntimeLoopHooks;
  #state: RuntimeLoopState = { running: false, frameCount: 0, simulationSteps: 0, droppedSeconds: 0, lastTick: 0 };
  #raf: number | null = null;
  #lastNow: number | null = null;

  constructor(runtime: NextGenRuntimeV3, fixedStepConfig?: Partial<FixedStepConfig>, hooks?: RuntimeLoopHooks) {
    this.runtime = runtime;
    this.fixedStep = new FixedStepControllerV3(fixedStepConfig);
    this.hooks = hooks ?? {};
  }

  get state(): RuntimeLoopState { return { ...this.#state }; }
  start(now = this.now()): void {
    if (this.#state.running) return;
    this.#state.running = true;
    this.#lastNow = now;
    this.schedule();
  }

  stop(): void {
    this.#state.running = false;
    if (this.#raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.#raf);
    this.#raf = null;
    this.#lastNow = null;
  }

  async frame(now = this.now()): Promise<FixedStepResult> {
    if (!this.#state.running) this.#state.running = true;
    const previous = this.#lastNow ?? now;
    const deltaSeconds = Math.max(0, (now - previous) / 1000);
    this.#lastNow = now;
    let stepCount = 0;
    const result = this.fixedStep.consume(deltaSeconds, () => {
      const nextTick = this.runtime.kernel.clock.tick + 1;
      try {
        this.hooks.beforeStep?.(nextTick);
        this.runtime.kernel.step();
        this.hooks.afterStep?.(nextTick);
        stepCount += 1;
      } catch (error) {
        this.hooks.onError?.(error);
        throw error;
      }
    });
    this.#state.frameCount += 1;
    this.#state.simulationSteps += stepCount;
    this.#state.droppedSeconds = result.droppedSeconds;
    this.#state.lastTick = this.runtime.kernel.clock.tick;
    this.hooks.render?.(this.fixedStep.interpolationAlpha(), this.#state.lastTick);
    this.hooks.frame?.(result);
    return result;
  }

  schedule(): void {
    if (!this.#state.running || typeof requestAnimationFrame !== 'function') return;
    this.#raf = requestAnimationFrame((timestamp) => { void this.frame(timestamp).catch((error) => this.hooks.onError?.(error)).finally(() => this.schedule()); });
  }

  private now(): number { return typeof performance !== 'undefined' ? performance.now() : 0; }
}

export function attachRuntimeLoop(runtime: NextGenRuntimeV3, hooks?: RuntimeLoopHooks): RuntimeLoopV3 { return new RuntimeLoopV3(runtime, undefined, hooks); }
