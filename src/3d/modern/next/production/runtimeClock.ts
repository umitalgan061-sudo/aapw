import { clampP, finiteP, integerP } from './contracts.ts';

export interface ProductionClockConfigP {
  readonly hz: number;
  readonly maxDeltaSeconds: number;
  readonly maxStepsPerFrame: number;
  readonly maxCatchUpSeconds: number;
}

export interface ProductionClockStateP {
  readonly tick: number;
  readonly simulationSeconds: number;
  readonly accumulatorSeconds: number;
  readonly alpha: number;
  readonly droppedSeconds: number;
  readonly timeScale: number;
  readonly paused: boolean;
  readonly stepSeconds: number;
}

export interface ClockAdvanceResultP {
  readonly steps: number;
  readonly alpha: number;
  readonly spiralPrevented: boolean;
  readonly droppedSeconds: number;
  readonly tick: number;
}

const DEFAULT_CLOCK: ProductionClockConfigP = Object.freeze({ hz: 60, maxDeltaSeconds: 0.25, maxStepsPerFrame: 8, maxCatchUpSeconds: 0.5 });

export class ProductionClock {
  readonly config: ProductionClockConfigP;
  #tick = 0;
  #simulationSeconds = 0;
  #accumulatorSeconds = 0;
  #droppedSeconds = 0;
  #timeScale = 1;
  #paused = false;
  #lastRealTimeMs: number | undefined;

  constructor(config: Partial<ProductionClockConfigP> = {}) {
    const hz = Math.max(10, Math.min(240, integerP(config.hz ?? DEFAULT_CLOCK.hz, DEFAULT_CLOCK.hz)));
    this.config = Object.freeze({
      hz,
      maxDeltaSeconds: clampP(config.maxDeltaSeconds ?? DEFAULT_CLOCK.maxDeltaSeconds, 0.016, 1),
      maxStepsPerFrame: Math.max(1, Math.min(32, integerP(config.maxStepsPerFrame ?? DEFAULT_CLOCK.maxStepsPerFrame, DEFAULT_CLOCK.maxStepsPerFrame))),
      maxCatchUpSeconds: clampP(config.maxCatchUpSeconds ?? DEFAULT_CLOCK.maxCatchUpSeconds, 0.05, 2),
    });
  }

  get stepSeconds(): number { return 1 / this.config.hz; }
  get state(): ProductionClockStateP {
    return Object.freeze({
      tick: this.#tick,
      simulationSeconds: this.#simulationSeconds,
      accumulatorSeconds: this.#accumulatorSeconds,
      alpha: this.#accumulatorSeconds / this.stepSeconds,
      droppedSeconds: this.#droppedSeconds,
      timeScale: this.#timeScale,
      paused: this.#paused,
      stepSeconds: this.stepSeconds,
    });
  }

  reset(tick = 0, simulationSeconds = 0): void {
    this.#tick = Math.max(0, integerP(tick));
    this.#simulationSeconds = Math.max(0, finiteP(simulationSeconds));
    this.#accumulatorSeconds = 0;
    this.#droppedSeconds = 0;
    this.#lastRealTimeMs = undefined;
  }

  setPaused(paused: boolean): void { this.#paused = Boolean(paused); this.#lastRealTimeMs = undefined; }
  pause(): void { this.setPaused(true); }
  resume(): void { this.setPaused(false); }
  setTimeScale(value: number): void { this.#timeScale = clampP(value, 0, 4); }
  get timeScale(): number { return this.#timeScale; }
  get paused(): boolean { return this.#paused; }
  get tick(): number { return this.#tick; }

  advanceRealTime(nowMs: number, onStep: (tick: number, dtSeconds: number, simulationSeconds: number) => void): ClockAdvanceResultP {
    const now = Math.max(0, finiteP(nowMs));
    if (this.#lastRealTimeMs === undefined) {
      this.#lastRealTimeMs = now;
      return { steps: 0, alpha: this.#accumulatorSeconds / this.stepSeconds, spiralPrevented: false, droppedSeconds: 0, tick: this.#tick };
    }
    const deltaSeconds = Math.max(0, Math.min(this.config.maxDeltaSeconds, (now - this.#lastRealTimeMs) / 1000));
    this.#lastRealTimeMs = now;
    return this.advance(deltaSeconds, onStep);
  }

  advance(deltaSeconds: number, onStep: (tick: number, dtSeconds: number, simulationSeconds: number) => void): ClockAdvanceResultP {
    if (this.#paused) return { steps: 0, alpha: this.#accumulatorSeconds / this.stepSeconds, spiralPrevented: false, droppedSeconds: 0, tick: this.#tick };
    const scaled = Math.max(0, Math.min(this.config.maxDeltaSeconds, finiteP(deltaSeconds))) * this.#timeScale;
    this.#accumulatorSeconds = Math.min(this.#accumulatorSeconds + scaled, this.config.maxCatchUpSeconds);
    let steps = 0;
    let spiralPrevented = false;
    const beforeDropped = this.#droppedSeconds;
    while (this.#accumulatorSeconds >= this.stepSeconds && steps < this.config.maxStepsPerFrame) {
      this.#accumulatorSeconds -= this.stepSeconds;
      this.#tick += 1;
      this.#simulationSeconds += this.stepSeconds;
      steps += 1;
      onStep(this.#tick, this.stepSeconds, this.#simulationSeconds);
    }
    if (this.#accumulatorSeconds >= this.stepSeconds) {
      spiralPrevented = true;
      const retained = Math.min(this.#accumulatorSeconds, this.stepSeconds * 0.999);
      this.#droppedSeconds += Math.max(0, this.#accumulatorSeconds - retained);
      this.#accumulatorSeconds = retained;
    }
    return Object.freeze({ steps, alpha: this.#accumulatorSeconds / this.stepSeconds, spiralPrevented, droppedSeconds: this.#droppedSeconds - beforeDropped, tick: this.#tick });
  }

  stepOnce(onStep: (tick: number, dtSeconds: number, simulationSeconds: number) => void): ClockAdvanceResultP {
    if (this.#paused) return { steps: 0, alpha: this.#accumulatorSeconds / this.stepSeconds, spiralPrevented: false, droppedSeconds: 0, tick: this.#tick };
    this.#tick += 1;
    this.#simulationSeconds += this.stepSeconds;
    onStep(this.#tick, this.stepSeconds, this.#simulationSeconds);
    return { steps: 1, alpha: this.#accumulatorSeconds / this.stepSeconds, spiralPrevented: false, droppedSeconds: 0, tick: this.#tick };
  }

  seek(targetTick: number, onStep?: (tick: number, dtSeconds: number, simulationSeconds: number) => void): number {
    const target = Math.max(0, integerP(targetTick));
    if (target < this.#tick) throw new Error('ProductionClock cannot seek backwards without an explicit restore');
    let advanced = 0;
    while (this.#tick < target) {
      this.#tick += 1;
      this.#simulationSeconds += this.stepSeconds;
      advanced += 1;
      onStep?.(this.#tick, this.stepSeconds, this.#simulationSeconds);
    }
    this.#accumulatorSeconds = 0;
    return advanced;
  }
}
