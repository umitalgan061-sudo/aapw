/** Converts variable render-frame time into deterministic bounded simulation steps. */

export interface FixedStepConfig { fixedDeltaSeconds: number; maxCatchUpSteps: number; maxAccumulatedSeconds: number }
export interface FixedStepResult { steps: number; simulatedSeconds: number; remainingAccumulator: number; droppedSeconds: number }

const DEFAULTS: FixedStepConfig = { fixedDeltaSeconds: 1 / 60, maxCatchUpSteps: 4, maxAccumulatedSeconds: 0.25 };

export class FixedStepControllerV3 {
  readonly config: FixedStepConfig;
  #accumulator = 0;
  #droppedSeconds = 0;

  constructor(config?: Partial<FixedStepConfig>) {
    this.config = { ...DEFAULTS, ...config };
    if (this.config.fixedDeltaSeconds <= 0) throw new RangeError('fixedDeltaSeconds must be > 0');
    if (!Number.isInteger(this.config.maxCatchUpSteps) || this.config.maxCatchUpSteps < 1) throw new RangeError('maxCatchUpSteps must be >= 1');
    if (this.config.maxAccumulatedSeconds < this.config.fixedDeltaSeconds) throw new RangeError('maxAccumulatedSeconds must be >= fixedDeltaSeconds');
  }

  consume(frameDeltaSeconds: number, step: (deltaSeconds: number) => void): FixedStepResult {
    if (!Number.isFinite(frameDeltaSeconds) || frameDeltaSeconds < 0) throw new RangeError('frameDeltaSeconds must be finite and >= 0');
    this.#accumulator += Math.min(frameDeltaSeconds, this.config.maxAccumulatedSeconds);
    if (this.#accumulator > this.config.maxAccumulatedSeconds) {
      this.#droppedSeconds += this.#accumulator - this.config.maxAccumulatedSeconds;
      this.#accumulator = this.config.maxAccumulatedSeconds;
    }
    let steps = 0;
    while (this.#accumulator >= this.config.fixedDeltaSeconds && steps < this.config.maxCatchUpSteps) {
      step(this.config.fixedDeltaSeconds);
      this.#accumulator -= this.config.fixedDeltaSeconds;
      steps += 1;
    }
    if (this.#accumulator >= this.config.fixedDeltaSeconds) {
      const before = this.#accumulator;
      this.#accumulator = Math.min(this.#accumulator, this.config.fixedDeltaSeconds * 0.999999);
      this.#droppedSeconds += Math.max(0, before - this.#accumulator);
    }
    return { steps, simulatedSeconds: steps * this.config.fixedDeltaSeconds, remainingAccumulator: this.#accumulator, droppedSeconds: this.#droppedSeconds };
  }

  reset(): void { this.#accumulator = 0; this.#droppedSeconds = 0; }
  get accumulator(): number { return this.#accumulator; }
  get droppedSeconds(): number { return this.#droppedSeconds; }
  interpolationAlpha(): number { return this.#accumulator / this.config.fixedDeltaSeconds; }
}

export function createFixedStepController(overrides?: Partial<FixedStepConfig>): FixedStepControllerV3 { return new FixedStepControllerV3(overrides); }
