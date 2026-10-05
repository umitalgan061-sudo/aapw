import { clamp, type RuntimeFrame } from './contracts.ts';

export interface FixedStepClockOptions {
  readonly hz: number;
  readonly maxSubSteps: number;
  readonly maxDeltaSeconds: number;
}

export interface ClockAdvance {
  readonly steps: number;
  readonly stepDeltaSeconds: number;
  readonly interpolationAlpha: number;
  readonly droppedSteps: number;
  readonly frame: number;
  readonly tick: number;
  readonly simTimeSeconds: number;
}

export class FixedStepClock {
  readonly stepDeltaSeconds: number;
  readonly maxSubSteps: number;
  readonly maxDeltaSeconds: number;

  #accumulator = 0;
  #frame = 0;
  #tick = 0;
  #simTimeSeconds = 0;
  #droppedSteps = 0;

  constructor(options: FixedStepClockOptions) {
    const hz = clamp(Math.trunc(options.hz), 1, 240);
    this.stepDeltaSeconds = 1 / hz;
    this.maxSubSteps = Math.max(1, Math.trunc(options.maxSubSteps));
    this.maxDeltaSeconds = clamp(options.maxDeltaSeconds, this.stepDeltaSeconds, 2);
  }

  advance(deltaSeconds: number): ClockAdvance {
    const safeDelta = clamp(deltaSeconds, 0, this.maxDeltaSeconds);
    this.#frame += 1;
    this.#accumulator += safeDelta;
    let steps = 0;
    while (this.#accumulator + Number.EPSILON >= this.stepDeltaSeconds && steps < this.maxSubSteps) {
      this.#accumulator -= this.stepDeltaSeconds;
      this.#tick += 1;
      this.#simTimeSeconds += this.stepDeltaSeconds;
      steps += 1;
    }
    if (this.#accumulator >= this.stepDeltaSeconds) {
      const dropped = Math.floor(this.#accumulator / this.stepDeltaSeconds);
      this.#droppedSteps += dropped;
      this.#accumulator -= dropped * this.stepDeltaSeconds;
    }
    return Object.freeze({
      steps,
      stepDeltaSeconds: this.stepDeltaSeconds,
      interpolationAlpha: clamp(this.#accumulator / this.stepDeltaSeconds, 0, 1),
      droppedSteps: this.#droppedSteps,
      frame: this.#frame,
      tick: this.#tick,
      simTimeSeconds: this.#simTimeSeconds,
    });
  }

  reset(frame = 0, tick = 0, simTimeSeconds = 0): void {
    this.#accumulator = 0;
    this.#frame = Math.max(0, Math.trunc(frame));
    this.#tick = Math.max(0, Math.trunc(tick));
    this.#simTimeSeconds = Math.max(0, simTimeSeconds);
    this.#droppedSteps = 0;
  }

  frame(): number {
    return this.#frame;
  }

  tick(): number {
    return this.#tick;
  }

  simTimeSeconds(): number {
    return this.#simTimeSeconds;
  }

  droppedSteps(): number {
    return this.#droppedSteps;
  }

  interpolationAlpha(): number {
    return clamp(this.#accumulator / this.stepDeltaSeconds, 0, 1);
  }

  snapshot(): Pick<RuntimeFrame, 'frame' | 'tick' | 'simTimeSeconds' | 'interpolationAlpha' | 'droppedSteps'> {
    return Object.freeze({
      frame: this.#frame,
      tick: this.#tick,
      simTimeSeconds: this.#simTimeSeconds,
      interpolationAlpha: this.interpolationAlpha(),
      droppedSteps: this.#droppedSteps,
    });
  }
}

export interface FrameBudgetSample {
  readonly frameMs: number;
  readonly targetFrameMs: number;
  readonly overBudget: boolean;
  readonly pressure: number;
}

export class FrameBudgetMeter {
  #samples: number[] = [];
  readonly windowSize: number;

  constructor(windowSize = 120) {
    this.windowSize = Math.max(8, Math.trunc(windowSize));
  }

  observe(frameMs: number, targetFrameMs: number): FrameBudgetSample {
    const safeFrameMs = Math.max(0, Number.isFinite(frameMs) ? frameMs : targetFrameMs * 2);
    const safeTarget = Math.max(1, Number.isFinite(targetFrameMs) ? targetFrameMs : 16.67);
    this.#samples.push(safeFrameMs);
    while (this.#samples.length > this.windowSize) this.#samples.shift();
    const average = this.#samples.reduce((sum, sample) => sum + sample, 0) / this.#samples.length;
    const pressure = clamp(average / safeTarget - 1, 0, 1);
    return Object.freeze({
      frameMs: safeFrameMs,
      targetFrameMs: safeTarget,
      overBudget: safeFrameMs > safeTarget,
      pressure,
    });
  }

  average(): number {
    return this.#samples.length === 0 ? 0 : this.#samples.reduce((sum, sample) => sum + sample, 0) / this.#samples.length;
  }

  p95(): number {
    if (this.#samples.length === 0) return 0;
    const values = [...this.#samples].sort((a, b) => a - b);
    const index = Math.min(values.length - 1, Math.floor(values.length * 0.95));
    return values[index] ?? 0;
  }

  clear(): void {
    this.#samples = [];
  }
}
