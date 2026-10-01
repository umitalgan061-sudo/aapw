export interface ClockConfig {
  readonly fixedDeltaSeconds: number;
  readonly maxCatchUpSteps: number;
  readonly maxFrameDeltaSeconds: number;
}

export interface ClockStep {
  readonly stepIndex: number;
  readonly tick: number;
  readonly deltaSeconds: number;
  readonly simulationTimeSeconds: number;
}

export interface ClockAdvanceResult {
  readonly consumedSeconds: number;
  readonly droppedSeconds: number;
  readonly steps: readonly ClockStep[];
  readonly accumulatorSeconds: number;
  readonly alpha: number;
}

export class R35DeterministicClock {
  readonly config: ClockConfig;
  #tick = 0;
  #simulationTimeSeconds = 0;
  #accumulatorSeconds = 0;

  constructor(config: ClockConfig) {
    if (!(config.fixedDeltaSeconds > 0)) throw new RangeError('fixedDeltaSeconds must be positive');
    if (!Number.isInteger(config.maxCatchUpSteps) || config.maxCatchUpSteps < 1) throw new RangeError('maxCatchUpSteps must be >= 1');
    if (!(config.maxFrameDeltaSeconds >= config.fixedDeltaSeconds)) throw new RangeError('maxFrameDeltaSeconds must cover one fixed step');
    this.config = { ...config };
  }

  get tick(): number {
    return this.#tick;
  }

  get simulationTimeSeconds(): number {
    return this.#simulationTimeSeconds;
  }

  get accumulatorSeconds(): number {
    return this.#accumulatorSeconds;
  }

  reset(tick = 0, simulationTimeSeconds = tick * this.config.fixedDeltaSeconds): void {
    if (!Number.isInteger(tick) || tick < 0) throw new RangeError('tick must be non-negative');
    if (!Number.isFinite(simulationTimeSeconds) || simulationTimeSeconds < 0) throw new RangeError('invalid simulation time');
    this.#tick = tick;
    this.#simulationTimeSeconds = simulationTimeSeconds;
    this.#accumulatorSeconds = 0;
  }

  advance(frameDeltaSeconds: number, step: (context: ClockStep) => void): ClockAdvanceResult {
    const boundedFrame = Math.min(
      this.config.maxFrameDeltaSeconds,
      Math.max(0, Number.isFinite(frameDeltaSeconds) ? frameDeltaSeconds : 0),
    );
    this.#accumulatorSeconds += boundedFrame;

    const steps: ClockStep[] = [];
    let stepIndex = 0;
    while (this.#accumulatorSeconds + 1e-12 >= this.config.fixedDeltaSeconds && stepIndex < this.config.maxCatchUpSteps) {
      this.#accumulatorSeconds -= this.config.fixedDeltaSeconds;
      this.#tick += 1;
      this.#simulationTimeSeconds += this.config.fixedDeltaSeconds;
      const context: ClockStep = {
        stepIndex,
        tick: this.#tick,
        deltaSeconds: this.config.fixedDeltaSeconds,
        simulationTimeSeconds: this.#simulationTimeSeconds,
      };
      step(context);
      steps.push(context);
      stepIndex += 1;
    }

    const theoreticalRemaining = this.#accumulatorSeconds;
    let droppedSeconds = 0;
    if (this.#accumulatorSeconds >= this.config.fixedDeltaSeconds) {
      droppedSeconds = this.#accumulatorSeconds;
      this.#accumulatorSeconds = 0;
    }

    const consumedSeconds = boundedFrame - droppedSeconds;
    const alpha = this.#accumulatorSeconds / this.config.fixedDeltaSeconds;
    return Object.freeze({
      consumedSeconds: Math.max(0, consumedSeconds),
      droppedSeconds,
      steps: Object.freeze(steps),
      accumulatorSeconds: this.#accumulatorSeconds,
      alpha: Math.min(1, Math.max(0, alpha)),
    });
  }

  snapshot(): { readonly tick: number; readonly simulationTimeSeconds: number; readonly accumulatorSeconds: number } {
    return {
      tick: this.#tick,
      simulationTimeSeconds: this.#simulationTimeSeconds,
      accumulatorSeconds: this.#accumulatorSeconds,
    };
  }

  restore(snapshot: { readonly tick: number; readonly simulationTimeSeconds: number; readonly accumulatorSeconds: number }): void {
    if (!Number.isInteger(snapshot.tick) || snapshot.tick < 0) throw new RangeError('invalid clock tick');
    if (!Number.isFinite(snapshot.simulationTimeSeconds) || snapshot.simulationTimeSeconds < 0) throw new RangeError('invalid simulation time');
    if (!Number.isFinite(snapshot.accumulatorSeconds) || snapshot.accumulatorSeconds < 0) throw new RangeError('invalid accumulator');
    if (snapshot.accumulatorSeconds >= this.config.fixedDeltaSeconds) throw new RangeError('accumulator exceeds fixed step');
    this.#tick = snapshot.tick;
    this.#simulationTimeSeconds = snapshot.simulationTimeSeconds;
    this.#accumulatorSeconds = snapshot.accumulatorSeconds;
  }
}

export function createR35Clock(overrides: Partial<ClockConfig> = {}): R35DeterministicClock {
  return new R35DeterministicClock({
    fixedDeltaSeconds: 1 / 60,
    maxCatchUpSteps: 4,
    maxFrameDeltaSeconds: 0.25,
    ...overrides,
  });
}
