import { clampR29, finiteR29 } from './contracts.ts';

export interface R29ClockOptions {
  readonly tickRate?: number;
  readonly maxStepsPerFrame?: number;
  readonly maxFrameDeltaSeconds?: number;
  readonly maxAccumulatedSeconds?: number;
}

export interface R29ClockAdvanceResult {
  readonly deltaSeconds: number;
  readonly steps: number;
  readonly droppedSteps: number;
  readonly simulatedSeconds: number;
  readonly accumulatorSeconds: number;
  readonly alpha: number;
}

export interface R29ClockSnapshot {
  readonly tick: number;
  readonly frame: number;
  readonly elapsedSeconds: number;
  readonly accumulatorSeconds: number;
  readonly fixedDeltaSeconds: number;
  readonly droppedSteps: number;
}

export class R29FixedStepClock {
  readonly tickRate: number;
  readonly fixedDeltaSeconds: number;
  readonly maxStepsPerFrame: number;
  readonly maxFrameDeltaSeconds: number;
  readonly maxAccumulatedSeconds: number;

  #tick = 0;
  #frame = 0;
  #elapsedSeconds = 0;
  #accumulatorSeconds = 0;
  #droppedSteps = 0;

  constructor(options: R29ClockOptions = {}) {
    this.tickRate = clampR29(Math.floor(options.tickRate ?? 60), 10, 240);
    this.fixedDeltaSeconds = 1 / this.tickRate;
    this.maxStepsPerFrame = clampR29(Math.floor(options.maxStepsPerFrame ?? 5), 1, 32);
    this.maxFrameDeltaSeconds = clampR29(options.maxFrameDeltaSeconds ?? 0.25, 0.001, 1);
    this.maxAccumulatedSeconds = clampR29(
      options.maxAccumulatedSeconds ?? this.fixedDeltaSeconds * this.maxStepsPerFrame * 2,
      this.fixedDeltaSeconds,
      5,
    );
  }

  advance(frameDeltaSeconds: number): R29ClockAdvanceResult {
    const deltaSeconds = clampR29(finiteR29(frameDeltaSeconds), 0, this.maxFrameDeltaSeconds);
    this.#frame += 1;
    this.#elapsedSeconds += deltaSeconds;
    this.#accumulatorSeconds = Math.min(this.#accumulatorSeconds + deltaSeconds, this.maxAccumulatedSeconds);

    let steps = 0;
    while (this.#accumulatorSeconds + 1e-12 >= this.fixedDeltaSeconds && steps < this.maxStepsPerFrame) {
      this.#accumulatorSeconds -= this.fixedDeltaSeconds;
      this.#tick += 1;
      steps += 1;
    }

    let droppedSteps = 0;
    if (this.#accumulatorSeconds >= this.fixedDeltaSeconds) {
      droppedSteps = Math.floor(this.#accumulatorSeconds / this.fixedDeltaSeconds);
      this.#accumulatorSeconds -= droppedSteps * this.fixedDeltaSeconds;
      this.#droppedSteps += droppedSteps;
    }

    const alpha = clampR29(this.#accumulatorSeconds / this.fixedDeltaSeconds, 0, 0.999999);
    return Object.freeze({
      deltaSeconds,
      steps,
      droppedSteps,
      simulatedSeconds: steps * this.fixedDeltaSeconds,
      accumulatorSeconds: this.#accumulatorSeconds,
      alpha,
    });
  }

  tick(): number {
    return this.#tick;
  }

  frame(): number {
    return this.#frame;
  }

  elapsedSeconds(): number {
    return this.#elapsedSeconds;
  }

  alpha(): number {
    return clampR29(this.#accumulatorSeconds / this.fixedDeltaSeconds, 0, 0.999999);
  }

  snapshot(): R29ClockSnapshot {
    return Object.freeze({
      tick: this.#tick,
      frame: this.#frame,
      elapsedSeconds: this.#elapsedSeconds,
      accumulatorSeconds: this.#accumulatorSeconds,
      fixedDeltaSeconds: this.fixedDeltaSeconds,
      droppedSteps: this.#droppedSteps,
    });
  }

  reset(): void {
    this.#tick = 0;
    this.#frame = 0;
    this.#elapsedSeconds = 0;
    this.#accumulatorSeconds = 0;
    this.#droppedSteps = 0;
  }
}

export interface R29FramePacerOptions {
  readonly targetFps?: number;
  readonly smoothingAlpha?: number;
  readonly historySize?: number;
}

export interface R29FramePacerSnapshot {
  readonly fps: number;
  readonly frameMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly samples: number;
}

export class R29FramePacer {
  readonly targetFps: number;
  readonly targetFrameMs: number;
  readonly smoothingAlpha: number;
  readonly historySize: number;
  #smoothedMs = 16.67;
  #history: number[] = [];

  constructor(options: R29FramePacerOptions = {}) {
    this.targetFps = clampR29(Math.floor(options.targetFps ?? 60), 15, 240);
    this.targetFrameMs = 1000 / this.targetFps;
    this.smoothingAlpha = clampR29(options.smoothingAlpha ?? 0.12, 0.01, 1);
    this.historySize = clampR29(Math.floor(options.historySize ?? 240), 16, 4096);
  }

  sample(frameMs: number): R29FramePacerSnapshot {
    const safe = clampR29(frameMs, 0.01, 1000);
    this.#smoothedMs += (safe - this.#smoothedMs) * this.smoothingAlpha;
    this.#history.push(safe);
    while (this.#history.length > this.historySize) this.#history.shift();
    const sorted = [...this.#history].sort((a, b) => a - b);
    const percentile = (ratio: number): number => sorted.length === 0
      ? this.targetFrameMs
      : sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] ?? this.targetFrameMs;
    return Object.freeze({
      fps: 1000 / this.#smoothedMs,
      frameMs: this.#smoothedMs,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      samples: sorted.length,
    });
  }

  reset(): void {
    this.#smoothedMs = this.targetFrameMs;
    this.#history.length = 0;
  }
}
