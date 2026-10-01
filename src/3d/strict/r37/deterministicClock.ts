import type { WorldClockSnapshot } from './types.ts';
import { clamp, finite } from './math.ts';

export interface DeterministicClockConfig {
  readonly fixedStepSeconds: number;
  readonly maxCatchUpSteps: number;
  readonly maxFrameDeltaSeconds: number;
}

const DEFAULT_CONFIG: DeterministicClockConfig = Object.freeze({
  fixedStepSeconds: 1 / 60,
  maxCatchUpSteps: 8,
  maxFrameDeltaSeconds: 0.25,
});

export type ClockStep = Readonly<{
  tick: number;
  simulationSeconds: number;
  deltaSeconds: number;
  alpha: number;
}>;

export class DeterministicClockR37 {
  readonly config: DeterministicClockConfig;
  #tick = 0;
  #simulationSeconds = 0;
  #accumulatorSeconds = 0;
  #droppedSteps = 0;
  #timeScale = 1;
  #lastSteps: ClockStep[] = [];

  constructor(config: Partial<DeterministicClockConfig> = {}) {
    const merged = {
      ...DEFAULT_CONFIG,
      ...config,
      fixedStepSeconds: finite(config.fixedStepSeconds, DEFAULT_CONFIG.fixedStepSeconds),
      maxCatchUpSteps: Math.max(1, Math.trunc(finite(config.maxCatchUpSteps, DEFAULT_CONFIG.maxCatchUpSteps))),
      maxFrameDeltaSeconds: Math.max(0.01, finite(config.maxFrameDeltaSeconds, DEFAULT_CONFIG.maxFrameDeltaSeconds)),
    };
    if (!(merged.fixedStepSeconds > 0)) throw new RangeError('fixedStepSeconds must be > 0');
    this.config = Object.freeze(merged);
  }

  get tick(): number {
    return this.#tick;
  }

  get simulationSeconds(): number {
    return this.#simulationSeconds;
  }

  get alpha(): number {
    return clamp(this.#accumulatorSeconds / this.config.fixedStepSeconds, 0, 1);
  }

  setTimeScale(value: number): void {
    this.#timeScale = clamp(finite(value, 1), 0, 4);
  }

  get timeScale(): number {
    return this.#timeScale;
  }

  pushFrameDelta(frameDeltaSeconds: number, step: (step: ClockStep) => void): number {
    const safeDelta = clamp(finite(frameDeltaSeconds, 0), 0, this.config.maxFrameDeltaSeconds);
    this.#accumulatorSeconds += safeDelta * this.#timeScale;
    let steps = 0;
    while (this.#accumulatorSeconds + 1e-12 >= this.config.fixedStepSeconds && steps < this.config.maxCatchUpSteps) {
      this.#accumulatorSeconds -= this.config.fixedStepSeconds;
      this.#tick += 1;
      this.#simulationSeconds += this.config.fixedStepSeconds;
      const current: ClockStep = Object.freeze({
        tick: this.#tick,
        simulationSeconds: this.#simulationSeconds,
        deltaSeconds: this.config.fixedStepSeconds,
        alpha: this.alpha,
      });
      step(current);
      this.#lastSteps.push(current);
      if (this.#lastSteps.length > 32) this.#lastSteps.shift();
      steps += 1;
    }
    if (this.#accumulatorSeconds >= this.config.fixedStepSeconds) {
      const dropped = Math.floor(this.#accumulatorSeconds / this.config.fixedStepSeconds);
      this.#droppedSteps += dropped;
      this.#accumulatorSeconds %= this.config.fixedStepSeconds;
    }
    return steps;
  }

  snapshot(): WorldClockSnapshot {
    return Object.freeze({
      tick: this.#tick,
      simulationSeconds: Number(this.#simulationSeconds.toFixed(6)),
      accumulatorSeconds: Number(this.#accumulatorSeconds.toFixed(6)),
      fixedStepSeconds: this.config.fixedStepSeconds,
      timeScale: this.#timeScale,
      droppedSteps: this.#droppedSteps,
    });
  }

  recentSteps(): readonly ClockStep[] {
    return Object.freeze([...this.#lastSteps]);
  }

  reset(tick = 0, simulationSeconds = 0): void {
    this.#tick = Math.max(0, Math.trunc(finite(tick)));
    this.#simulationSeconds = Math.max(0, finite(simulationSeconds));
    this.#accumulatorSeconds = 0;
    this.#droppedSteps = 0;
    this.#lastSteps = [];
  }
}
