/**
 * Deterministic fixed-step clock for R42.
 * Production TypeScript owner. Never reads wall clock or ambient randomness.
 */

import type { ClockSnapshot } from './types.ts';
import { clamp, finite } from './types.ts';

export interface ClockOptions {
  readonly fixedStepSeconds?: number;
  readonly maxCatchUpSteps?: number;
  readonly maxFrameDeltaSeconds?: number;
}

export interface AdvanceResult {
  readonly steps: number;
  readonly droppedSteps: number;
  readonly simulatedSeconds: number;
  readonly tick: number;
  readonly alpha: number;
}

export class DeterministicClockR42 {
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
    this.maxCatchUpSteps = Math.max(1, Math.trunc(finite(options.maxCatchUpSteps, 8)));
    this.maxFrameDeltaSeconds = clamp(
      finite(options.maxFrameDeltaSeconds, 0.25),
      this.fixedStepSeconds,
      1,
    );
  }

  get tick(): number {
    return this.#tick;
  }

  get elapsedSeconds(): number {
    return this.#elapsedSeconds;
  }

  get paused(): boolean {
    return this.#paused;
  }

  get timeScale(): number {
    return this.#timeScale;
  }

  setPaused(paused: boolean): void {
    this.#paused = Boolean(paused);
  }

  setTimeScale(scale: number): void {
    this.#timeScale = clamp(scale, 0, 4);
  }

  reset(tick = 0): void {
    this.#tick = Math.max(0, Math.trunc(finite(tick)));
    this.#elapsedSeconds = this.#tick * this.fixedStepSeconds;
    this.#accumulatorSeconds = 0;
    this.#droppedSteps = 0;
  }

  advance(frameDeltaSeconds: number, step: (tick: number, deltaSeconds: number) => void): AdvanceResult {
    if (this.#paused) return Object.freeze({
      steps: 0,
      droppedSteps: 0,
      simulatedSeconds: 0,
      tick: this.#tick,
      alpha: this.alpha,
    });

    const clampedDelta = clamp(
      finite(frameDeltaSeconds, 0),
      0,
      this.maxFrameDeltaSeconds,
    );
    this.#accumulatorSeconds += clampedDelta * this.#timeScale;

    let steps = 0;
    while (this.#accumulatorSeconds + Number.EPSILON >= this.fixedStepSeconds && steps < this.maxCatchUpSteps) {
      this.#accumulatorSeconds -= this.fixedStepSeconds;
      this.#tick += 1;
      this.#elapsedSeconds += this.fixedStepSeconds;
      step(this.#tick, this.fixedStepSeconds);
      steps += 1;
    }

    let droppedSteps = 0;
    if (this.#accumulatorSeconds >= this.fixedStepSeconds) {
      droppedSteps = Math.floor(this.#accumulatorSeconds / this.fixedStepSeconds);
      this.#accumulatorSeconds -= droppedSteps * this.fixedStepSeconds;
      this.#droppedSteps += droppedSteps;
    }

    return Object.freeze({
      steps,
      droppedSteps,
      simulatedSeconds: steps * this.fixedStepSeconds,
      tick: this.#tick,
      alpha: this.alpha,
    });
  }

  get alpha(): number {
    return clamp(this.#accumulatorSeconds / this.fixedStepSeconds, 0, 1);
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

  restore(snapshot: ClockSnapshot): void {
    if (snapshot.fixedStepSeconds !== this.fixedStepSeconds) {
      throw new Error('R42 clock snapshot uses an incompatible fixed step.');
    }
    this.#tick = Math.max(0, Math.trunc(finite(snapshot.tick)));
    this.#elapsedSeconds = Math.max(0, finite(snapshot.elapsedSeconds));
    this.#accumulatorSeconds = clamp(finite(snapshot.accumulatorSeconds), 0, this.fixedStepSeconds);
    this.#timeScale = clamp(finite(snapshot.timeScale, 1), 0, 4);
    this.#droppedSteps = Math.max(0, Math.trunc(finite(snapshot.droppedSteps)));
    this.#paused = Boolean(snapshot.paused);
  }
}
