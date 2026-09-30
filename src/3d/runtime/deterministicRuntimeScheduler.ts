/**
 * Strict deterministic fixed-step scheduler.
 *
 * Variable browser frame time is converted into bounded simulation steps and presentation alpha.
 * All mutable state remains encapsulated; snapshots are immutable and replay-friendly.
 */
import { clamp, finiteOr, integerOr, createMonotonicSequence } from './modernRuntimeContract.ts';

const DEFAULT_FIXED_STEP_MS = 1000 / 60;
const DEFAULT_MAX_CATCHUP_MS = 100;
const DEFAULT_MAX_STEPS = 6;

export interface RuntimeSchedulerOptions {
  readonly fixedStepMs?: number;
  readonly maxCatchupMs?: number;
  readonly maxStepsPerFrame?: number;
  readonly startTimeMs?: number;
  readonly startTick?: number;
  readonly paused?: boolean;
}
export interface SimulationTickContext {
  readonly tick: number;
  readonly stepMs: number;
  readonly stepSeconds: number;
  readonly simulationTimeMs: number;
  readonly sequence: number;
  readonly seek?: boolean;
}
export interface PresentationContext {
  readonly tick: number;
  readonly simulationTimeMs: number;
  readonly alpha: number;
  readonly steps: number;
}
export interface SpiralGuardContext {
  readonly tick: number;
  readonly droppedMs: number;
}
export interface RuntimeSchedulerCallbacks {
  readonly simulate?: (context: SimulationTickContext) => void;
  readonly present?: (context: PresentationContext) => void;
  readonly onSpiralGuard?: (context: SpiralGuardContext) => void;
}
export interface RuntimeSchedulerResult {
  readonly sequence: number;
  readonly steps: number;
  readonly tick: number;
  readonly simulationTimeMs: number;
  readonly alpha: number;
  readonly droppedMs: number;
  readonly paused: boolean;
  readonly spiralGuard: boolean;
}
export interface RuntimeSchedulerSnapshot extends RuntimeSchedulerResult {
  readonly fixedStepMs: number;
  readonly maxCatchupMs: number;
  readonly maxStepsPerFrame: number;
  readonly accumulatorMs: number;
  readonly totalFrames: number;
  readonly totalSteps: number;
  readonly lastDeltaMs: number;
}
export interface SimulationAccumulatorEvent<T> {
  readonly tick: number;
  readonly result: T;
}
export interface DeterministicRuntimeScheduler {
  frame(deltaMs: number, callbacks?: RuntimeSchedulerCallbacks): RuntimeSchedulerResult;
  step(callbacks?: RuntimeSchedulerCallbacks): RuntimeSchedulerResult;
  pause(): void;
  resume(): void;
  reset(options?: { readonly timeMs?: number; readonly startTick?: number }): void;
  seek(timeMs: number, callbacks?: RuntimeSchedulerCallbacks): Readonly<{ tick: number; simulationTimeMs: number; alpha: number; steps: number }>;
  snapshot(): RuntimeSchedulerSnapshot;
  readonly tick: number;
  readonly simulationTimeMs: number;
  readonly paused: boolean;
}

export function createDeterministicRuntimeScheduler(options: RuntimeSchedulerOptions = {}): DeterministicRuntimeScheduler {
  const fixedStepMs = clamp(finiteOr(options.fixedStepMs, DEFAULT_FIXED_STEP_MS), 1, 100);
  const maxCatchupMs = clamp(finiteOr(options.maxCatchupMs, DEFAULT_MAX_CATCHUP_MS), fixedStepMs, 1000);
  const maxStepsPerFrame = clamp(integerOr(options.maxStepsPerFrame, DEFAULT_MAX_STEPS), 1, 32);
  const sequence = createMonotonicSequence();

  let accumulatorMs = 0;
  let simulationTimeMs = Math.max(0, finiteOr(options.startTimeMs, 0));
  let tick = Math.max(0, integerOr(options.startTick, 0));
  let paused = Boolean(options.paused);
  let droppedMs = 0;
  let totalFrames = 0;
  let totalSteps = 0;
  let lastDeltaMs = 0;

  const frame = (deltaMs: number, callbacks: RuntimeSchedulerCallbacks = {}): RuntimeSchedulerResult => {
    const rawDelta = Math.max(0, finiteOr(deltaMs, 0));
    const boundedDelta = Math.min(rawDelta, maxCatchupMs);
    droppedMs += Math.max(0, rawDelta - boundedDelta);
    lastDeltaMs = boundedDelta;
    totalFrames += 1;

    if (paused) {
      return Object.freeze({
        sequence: sequence(),
        steps: 0,
        tick,
        simulationTimeMs,
        alpha: clamp(accumulatorMs / fixedStepMs, 0, 1),
        droppedMs,
        paused: true,
        spiralGuard: false,
      });
    }

    accumulatorMs += boundedDelta;
    let steps = 0;
    while (accumulatorMs >= fixedStepMs && steps < maxStepsPerFrame) {
      const tickContext: SimulationTickContext = Object.freeze({
        tick,
        stepMs: fixedStepMs,
        stepSeconds: fixedStepMs / 1000,
        simulationTimeMs,
        sequence: sequence(),
      });
      callbacks.simulate?.(tickContext);
      accumulatorMs -= fixedStepMs;
      simulationTimeMs += fixedStepMs;
      tick += 1;
      steps += 1;
      totalSteps += 1;
    }

    const spiralGuard = accumulatorMs >= fixedStepMs;
    if (spiralGuard) {
      accumulatorMs = Math.min(accumulatorMs, fixedStepMs);
      callbacks.onSpiralGuard?.(Object.freeze({ tick, droppedMs }));
    }

    const alpha = clamp(accumulatorMs / fixedStepMs, 0, 1);
    callbacks.present?.(Object.freeze({ tick, simulationTimeMs, alpha, steps }));

    return Object.freeze({
      sequence: sequence(),
      steps,
      tick,
      simulationTimeMs,
      alpha,
      droppedMs,
      paused: false,
      spiralGuard,
    });
  };

  const step = (callbacks: RuntimeSchedulerCallbacks = {}): RuntimeSchedulerResult => {
    const wasPaused = paused;
    paused = false;
    const result = frame(fixedStepMs, callbacks);
    paused = wasPaused;
    return result;
  };

  const pause = (): void => { paused = true; };
  const resume = (): void => { paused = false; };
  const reset = ({ timeMs = 0, startTick = 0 }: { readonly timeMs?: number; readonly startTick?: number } = {}): void => {
    accumulatorMs = 0;
    simulationTimeMs = Math.max(0, finiteOr(timeMs, 0));
    tick = Math.max(0, integerOr(startTick, 0));
    droppedMs = 0;
    totalFrames = 0;
    totalSteps = 0;
    lastDeltaMs = 0;
  };

  const seek = (timeMs: number, callbacks: RuntimeSchedulerCallbacks = {}) => {
    const target = Math.max(0, finiteOr(timeMs, simulationTimeMs));
    if (target < simulationTimeMs) throw new RangeError('Scheduler cannot seek backwards without a full state restore.');
    let remaining = target - simulationTimeMs;
    let steps = 0;
    while (remaining >= fixedStepMs) {
      callbacks.simulate?.(Object.freeze({
        tick,
        stepMs: fixedStepMs,
        stepSeconds: fixedStepMs / 1000,
        simulationTimeMs,
        sequence: sequence(),
        seek: true,
      }));
      simulationTimeMs += fixedStepMs;
      tick += 1;
      remaining -= fixedStepMs;
      steps += 1;
    }
    accumulatorMs = remaining;
    return Object.freeze({ tick, simulationTimeMs, alpha: clamp(accumulatorMs / fixedStepMs, 0, 1), steps });
  };

  const snapshot = (): RuntimeSchedulerSnapshot => Object.freeze({
    fixedStepMs,
    maxCatchupMs,
    maxStepsPerFrame,
    accumulatorMs,
    simulationTimeMs,
    tick,
    paused,
    droppedMs,
    totalFrames,
    totalSteps,
    lastDeltaMs,
    sequence: -1,
    steps: 0,
    alpha: clamp(accumulatorMs / fixedStepMs, 0, 1),
    spiralGuard: false,
  });

  return Object.freeze({
    frame,
    step,
    pause,
    resume,
    reset,
    seek,
    snapshot,
    get tick(): number { return tick; },
    get simulationTimeMs(): number { return simulationTimeMs; },
    get paused(): boolean { return paused; },
  });
}

export interface SimulationAccumulator<T> {
  update(deltaMs: number, simulate: (context: SimulationTickContext) => T | undefined): RuntimeSchedulerResult;
  consumeEvents(): readonly SimulationAccumulatorEvent<T>[];
  readonly scheduler: DeterministicRuntimeScheduler;
}

export function createSimulationAccumulator<T>(options: RuntimeSchedulerOptions = {}): SimulationAccumulator<T> {
  const scheduler = createDeterministicRuntimeScheduler(options);
  const events: SimulationAccumulatorEvent<T>[] = [];
  return Object.freeze({
    update(deltaMs: number, simulate: (context: SimulationTickContext) => T | undefined): RuntimeSchedulerResult {
      return scheduler.frame(deltaMs, {
        simulate(context) {
          const result = simulate(context);
          if (result !== undefined) events.push(Object.freeze({ tick: context.tick, result }));
        },
      });
    },
    consumeEvents(): readonly SimulationAccumulatorEvent<T>[] {
      const output = events.slice();
      events.length = 0;
      return Object.freeze(output);
    },
    scheduler,
  });
}

export interface SchedulerSnapshotValidation {
  readonly valid: boolean;
  readonly missing: readonly string[];
}

export function validateSchedulerSnapshot(snapshot: Partial<RuntimeSchedulerSnapshot> | null | undefined): SchedulerSnapshotValidation {
  const required = ['fixedStepMs', 'maxCatchupMs', 'maxStepsPerFrame', 'accumulatorMs', 'simulationTimeMs', 'tick'] as const;
  const missing = required.filter((key) => snapshot?.[key] === undefined);
  const valid = missing.length === 0
    && Number(snapshot?.fixedStepMs) > 0
    && Number(snapshot?.maxCatchupMs) >= Number(snapshot?.fixedStepMs)
    && Number(snapshot?.maxStepsPerFrame) >= 1
    && Number(snapshot?.accumulatorMs) >= 0
    && Number(snapshot?.simulationTimeMs) >= 0
    && Number(snapshot?.tick) >= 0;
  return Object.freeze({ valid, missing });
}

export function partitionElapsed(
  elapsedMs: number,
  stepMs = DEFAULT_FIXED_STEP_MS,
  maxSteps = DEFAULT_MAX_STEPS,
): Readonly<{ chunks: readonly number[]; remainderMs: number }> {
  const safeStep = clamp(stepMs, 1, 1000);
  const safeMax = clamp(integerOr(maxSteps, DEFAULT_MAX_STEPS), 1, 128);
  let remaining = Math.max(0, finiteOr(elapsedMs, 0));
  const chunks: number[] = [];
  for (let index = 0; index < safeMax && remaining >= safeStep; index += 1) {
    chunks.push(safeStep);
    remaining -= safeStep;
  }
  return Object.freeze({ chunks: Object.freeze(chunks), remainderMs: remaining });
}
