
import type { ClockSnapshot, ClockStep } from './types.ts';
import { clamp, finite } from './types.ts';

export interface ClockOptions {
  readonly fixedStepSeconds?: number;
  readonly maxCatchUpSteps?: number;
  readonly maxFrameDeltaSeconds?: number;
  readonly timeScale?: number;
}

export class DeterministicClockR41 {
  readonly fixedStepSeconds: number;
  readonly maxCatchUpSteps: number;
  readonly maxFrameDeltaSeconds: number;

  #tick = 0;
  #elapsedSeconds = 0;
  #accumulatorSeconds = 0;
  #timeScale = 1;
  #droppedSteps = 0;
  #paused = false;

  constructor(options: ClockOptions = {}) {
    this.fixedStepSeconds = clamp(finite(options.fixedStepSeconds, 1 / 60), 1 / 240, 0.25);
    this.maxCatchUpSteps = Math.max(1, Math.trunc(finite(options.maxCatchUpSteps, 6)));
    this.maxFrameDeltaSeconds = clamp(finite(options.maxFrameDeltaSeconds, 0.25), this.fixedStepSeconds, 1);
    this.#timeScale = clamp(finite(options.timeScale, 1), 0, 4);
  }

  get tick(): number { return this.#tick; }
  get elapsedSeconds(): number { return this.#elapsedSeconds; }
  get accumulatorSeconds(): number { return this.#accumulatorSeconds; }
  get timeScale(): number { return this.#timeScale; }
  get paused(): boolean { return this.#paused; }

  setTimeScale(value: number): void { this.#timeScale = clamp(value, 0, 4); }
  pause(): void { this.#paused = true; }
  resume(): void { this.#paused = false; }

  reset(tick = 0): void {
    this.#tick = Math.max(0, Math.trunc(finite(tick)));
    this.#elapsedSeconds = this.#tick * this.fixedStepSeconds;
    this.#accumulatorSeconds = 0;
    this.#droppedSteps = 0;
  }

  pushFrameDelta(frameDeltaSeconds: number, onStep: (step: ClockStep) => void): number {
    if (this.#paused) return 0;
    const delta = clamp(finite(frameDeltaSeconds), 0, this.maxFrameDeltaSeconds) * this.#timeScale;
    this.#accumulatorSeconds += delta;
    let stepped = 0;

    while (this.#accumulatorSeconds + Number.EPSILON >= this.fixedStepSeconds && stepped < this.maxCatchUpSteps) {
      this.#accumulatorSeconds -= this.fixedStepSeconds;
      this.#tick += 1;
      this.#elapsedSeconds += this.fixedStepSeconds;
      stepped += 1;
      onStep(Object.freeze({ tick: this.#tick, deltaSeconds: this.fixedStepSeconds }));
    }

    if (this.#accumulatorSeconds + Number.EPSILON >= this.fixedStepSeconds) {
      const missed = Math.floor(this.#accumulatorSeconds / this.fixedStepSeconds);
      this.#droppedSteps += missed;
      this.#accumulatorSeconds %= this.fixedStepSeconds;
    }
    return stepped;
  }

  stepOnce(onStep: (step: ClockStep) => void): void {
    if (this.#paused) return;
    this.#tick += 1;
    this.#elapsedSeconds += this.fixedStepSeconds;
    onStep(Object.freeze({ tick: this.#tick, deltaSeconds: this.fixedStepSeconds }));
  }

  alpha(): number {
    return clamp(this.#accumulatorSeconds / this.fixedStepSeconds, 0, 0.999999);
  }

  snapshot(): ClockSnapshot {
    return Object.freeze({
      tick: this.#tick,
      elapsedSeconds: this.#elapsedSeconds,
      accumulatorSeconds: this.#accumulatorSeconds,
      fixedStepSeconds: this.fixedStepSeconds,
      timeScale: this.#timeScale,
      droppedSteps: this.#droppedSteps,
      maxCatchUpSteps: this.maxCatchUpSteps,
      paused: this.#paused,
    });
  }
}

export function createClockR41(options?: ClockOptions): DeterministicClockR41 {
  return new DeterministicClockR41(options);
}

export function replayClockR41(
  deltas: readonly number[],
  options: ClockOptions = {},
): ClockSnapshot {
  const clock = new DeterministicClockR41(options);
  for (const delta of deltas) clock.pushFrameDelta(delta, () => undefined);
  return clock.snapshot();
}
