import { clamp, stableHash } from './kernelTypes.ts';

export interface ClockPolicy {
  readonly fixedStepSeconds: number;
  readonly maxDeltaSeconds: number;
  readonly maxSubSteps: number;
  readonly maxAccumulatorSeconds: number;
  readonly timeScaleMin: number;
  readonly timeScaleMax: number;
}

export const DEFAULT_CLOCK_POLICY: ClockPolicy = Object.freeze({
  fixedStepSeconds: 1 / 60,
  maxDeltaSeconds: 0.25,
  maxSubSteps: 8,
  maxAccumulatorSeconds: 0.25,
  timeScaleMin: 0,
  timeScaleMax: 2,
});

export interface ClockStep {
  readonly tick: number;
  readonly frame: number;
  readonly deltaSeconds: number;
  readonly fixedSteps: number;
  readonly droppedSeconds: number;
  readonly simulationSeconds: number;
  readonly alpha: number;
}

export interface ClockDiagnostics {
  readonly tick: number;
  readonly frame: number;
  readonly accumulatorSeconds: number;
  readonly simulatedSeconds: number;
  readonly droppedSeconds: number;
  readonly timeScale: number;
  readonly paused: boolean;
  readonly digest: string;
}

export class DeterministicClock {
  readonly policy: ClockPolicy;
  #tick = 0;
  #frame = 0;
  #accumulator = 0;
  #simulatedSeconds = 0;
  #droppedSeconds = 0;
  #timeScale = 1;
  #paused = false;
  #disposed = false;

  constructor(policy: ClockPolicy = DEFAULT_CLOCK_POLICY) {
    this.policy = Object.freeze({
      ...policy,
      fixedStepSeconds: Math.max(1 / 240, policy.fixedStepSeconds),
      maxDeltaSeconds: Math.max(policy.fixedStepSeconds, policy.maxDeltaSeconds),
      maxSubSteps: Math.max(1, Math.floor(policy.maxSubSteps)),
      maxAccumulatorSeconds: Math.max(policy.fixedStepSeconds, policy.maxAccumulatorSeconds),
    });
  }

  tick(deltaSeconds: number): ClockStep {
    if (this.#disposed) {
      return Object.freeze({
        tick: this.#tick,
        frame: this.#frame,
        deltaSeconds: 0,
        fixedSteps: 0,
        droppedSeconds: 0,
        simulationSeconds: 0,
        alpha: 0,
      });
    }

    this.#frame += 1;
    const safeDelta = clamp(
      this.#paused ? 0 : deltaSeconds,
      0,
      this.policy.maxDeltaSeconds,
    );
    this.#accumulator = Math.min(
      this.policy.maxAccumulatorSeconds,
      this.#accumulator + safeDelta * this.#timeScale,
    );

    let fixedSteps = 0;
    while (this.#accumulator + 1e-12 >= this.policy.fixedStepSeconds && fixedSteps < this.policy.maxSubSteps) {
      this.#accumulator -= this.policy.fixedStepSeconds;
      this.#tick += 1;
      this.#simulatedSeconds += this.policy.fixedStepSeconds;
      fixedSteps += 1;
    }

    let droppedSeconds = 0;
    if (this.#accumulator >= this.policy.fixedStepSeconds) {
      droppedSeconds = this.#accumulator - (this.#accumulator % this.policy.fixedStepSeconds);
      this.#accumulator -= droppedSeconds;
      this.#droppedSeconds += droppedSeconds;
    }

    return Object.freeze({
      tick: this.#tick,
      frame: this.#frame,
      deltaSeconds: safeDelta,
      fixedSteps,
      droppedSeconds,
      simulationSeconds: fixedSteps * this.policy.fixedStepSeconds,
      alpha: this.#accumulator / this.policy.fixedStepSeconds,
    });
  }

  setPaused(paused: boolean): void { this.#paused = Boolean(paused); }
  paused(): boolean { return this.#paused; }

  setTimeScale(scale: number): void {
    this.#timeScale = clamp(scale, this.policy.timeScaleMin, this.policy.timeScaleMax);
  }

  timeScale(): number { return this.#timeScale; }
  tickId(): number { return this.#tick; }
  frameId(): number { return this.#frame; }
  accumulatorSeconds(): number { return this.#accumulator; }
  simulatedSeconds(): number { return this.#simulatedSeconds; }

  seek(tick: number): void {
    const target = Math.max(0, Math.floor(tick));
    if (target >= this.#tick) {
      this.#tick = target;
      this.#simulatedSeconds = target * this.policy.fixedStepSeconds;
      this.#accumulator = 0;
      return;
    }
    this.#tick = target;
    this.#simulatedSeconds = target * this.policy.fixedStepSeconds;
    this.#accumulator = 0;
  }

  diagnostics(): ClockDiagnostics {
    const data = {
      tick: this.#tick,
      frame: this.#frame,
      accumulatorSeconds: this.#accumulator,
      simulatedSeconds: this.#simulatedSeconds,
      droppedSeconds: this.#droppedSeconds,
      timeScale: this.#timeScale,
      paused: this.#paused,
    };
    return Object.freeze({ ...data, digest: stableHash(data) });
  }

  reset(): void {
    this.#tick = 0;
    this.#frame = 0;
    this.#accumulator = 0;
    this.#simulatedSeconds = 0;
    this.#droppedSeconds = 0;
    this.#timeScale = 1;
    this.#paused = false;
  }

  dispose(): void {
    this.#disposed = true;
    this.reset();
  }
}

export const predictTicks = (
  currentTick: number,
  seconds: number,
  policy: ClockPolicy = DEFAULT_CLOCK_POLICY,
): number => {
  return Math.max(
    0,
    Math.floor(currentTick + Math.max(0, seconds) / Math.max(1 / 240, policy.fixedStepSeconds)),
  );
};

export const tickDeltaSeconds = (
  fromTick: number,
  toTick: number,
  fixedStepSeconds = DEFAULT_CLOCK_POLICY.fixedStepSeconds,
): number => Math.max(0, Math.floor(toTick) - Math.floor(fromTick)) * fixedStepSeconds;
