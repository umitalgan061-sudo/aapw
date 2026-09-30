import { clampR31, finiteR31 } from './applicationTypesR31.ts';

export interface ClockSnapshotR31 {
  readonly tick: number;
  readonly elapsedSeconds: number;
  readonly accumulatorSeconds: number;
  readonly timeScale: number;
  readonly fixedStepSeconds: number;
  readonly droppedSeconds: number;
}

export interface AdvanceResultR31 {
  readonly steps: number;
  readonly alpha: number;
  readonly deltaSeconds: number;
  readonly droppedSeconds: number;
  readonly tick: number;
}

export class DeterministicClockR31 {
  #fixedStepSeconds: number;
  #maxDeltaSeconds: number;
  #maxCatchUpSteps: number;
  #timeScale = 1;
  #tick = 0;
  #elapsedSeconds = 0;
  #accumulatorSeconds = 0;
  #droppedSeconds = 0;
  #paused = false;

  constructor(options?: {
    fixedStepSeconds?: number;
    maxDeltaSeconds?: number;
    maxCatchUpSteps?: number;
  }) {
    const fixed = options?.fixedStepSeconds ?? 1 / 60;
    const maxDelta = options?.maxDeltaSeconds ?? 0.25;
    const maxCatchUp = options?.maxCatchUpSteps ?? 8;
    if (!(fixed > 0 && Number.isFinite(fixed))) throw new Error('fixedStepSeconds must be > 0');
    if (!(maxDelta > 0 && Number.isFinite(maxDelta))) throw new Error('maxDeltaSeconds must be > 0');
    if (!Number.isInteger(maxCatchUp) || maxCatchUp < 1) throw new Error('maxCatchUpSteps must be >= 1');
    this.#fixedStepSeconds = fixed;
    this.#maxDeltaSeconds = maxDelta;
    this.#maxCatchUpSteps = maxCatchUp;
  }

  setTimeScale(scale: number): void {
    this.#timeScale = clampR31(finiteR31(scale, 1), 0, 4);
  }

  pause(): void {
    this.#paused = true;
  }

  resume(): void {
    this.#paused = false;
  }

  reset(tick = 0): void {
    this.#tick = Math.max(0, Math.floor(finiteR31(tick, 0)));
    this.#elapsedSeconds = 0;
    this.#accumulatorSeconds = 0;
    this.#droppedSeconds = 0;
  }

  advance(rawDeltaSeconds: number, step: (deltaSeconds: number, tick: number) => void): AdvanceResultR31 {
    const raw = Math.max(0, finiteR31(rawDeltaSeconds, 0));
    const delta = this.#paused ? 0 : Math.min(raw, this.#maxDeltaSeconds) * this.#timeScale;
    this.#elapsedSeconds += delta;
    this.#accumulatorSeconds += delta;

    if (this.#paused) {
      return Object.freeze({
        steps: 0,
        alpha: this.#accumulatorSeconds / this.#fixedStepSeconds,
        deltaSeconds: 0,
        droppedSeconds: 0,
        tick: this.#tick,
      });
    }

    let steps = 0;
    let dropped = 0;
    while (this.#accumulatorSeconds >= this.#fixedStepSeconds && steps < this.#maxCatchUpSteps) {
      this.#accumulatorSeconds -= this.#fixedStepSeconds;
      this.#tick++;
      steps++;
      step(this.#fixedStepSeconds, this.#tick);
    }

    if (this.#accumulatorSeconds >= this.#fixedStepSeconds) {
      const wholeSteps = Math.floor(this.#accumulatorSeconds / this.#fixedStepSeconds);
      const skipped = wholeSteps * this.#fixedStepSeconds;
      this.#accumulatorSeconds -= skipped;
      dropped = skipped;
      this.#droppedSeconds += skipped;
    }

    return Object.freeze({
      steps,
      alpha: clampR31(this.#accumulatorSeconds / this.#fixedStepSeconds, 0, 1),
      deltaSeconds: delta,
      droppedSeconds: dropped,
      tick: this.#tick,
    });
  }

  snapshot(): ClockSnapshotR31 {
    return Object.freeze({
      tick: this.#tick,
      elapsedSeconds: this.#elapsedSeconds,
      accumulatorSeconds: this.#accumulatorSeconds,
      timeScale: this.#timeScale,
      fixedStepSeconds: this.#fixedStepSeconds,
      droppedSeconds: this.#droppedSeconds,
    });
  }

  restore(snapshot: ClockSnapshotR31): void {
    this.#tick = Math.max(0, Math.floor(finiteR31(snapshot.tick, 0)));
    this.#elapsedSeconds = Math.max(0, finiteR31(snapshot.elapsedSeconds, 0));
    this.#accumulatorSeconds = clampR31(finiteR31(snapshot.accumulatorSeconds, 0), 0, this.#fixedStepSeconds);
    this.#timeScale = clampR31(finiteR31(snapshot.timeScale, 1), 0, 4);
    this.#droppedSeconds = Math.max(0, finiteR31(snapshot.droppedSeconds, 0));
  }

  get tick(): number { return this.#tick; }
  get elapsedSeconds(): number { return this.#elapsedSeconds; }
  get fixedStepSeconds(): number { return this.#fixedStepSeconds; }
}
