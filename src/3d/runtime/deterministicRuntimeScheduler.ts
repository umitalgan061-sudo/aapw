// @ts-nocheck
/**
 * Deterministic fixed-step scheduler.
 *
 * The scheduler owns no game state. It only turns variable browser frame time into bounded
 * simulation slices and presentation interpolation alpha. This makes replays, low-FPS devices,
 * tab suspension and debug stepping predictable.
 */

import { clamp, finiteOr, integerOr, createMonotonicSequence } from './modernRuntimeContract.js';

const DEFAULT_FIXED_STEP_MS = 1000 / 60;
const DEFAULT_MAX_CATCHUP_MS = 100;
const DEFAULT_MAX_STEPS = 6;

export function createDeterministicRuntimeScheduler(options = {}) {
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

  function frame(deltaMs, callbacks = {}) {
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
        alpha: accumulatorMs / fixedStepMs,
        droppedMs,
        paused: true,
        spiralGuard: false,
      });
    }

    accumulatorMs += boundedDelta;
    let steps = 0;
    while (accumulatorMs >= fixedStepMs && steps < maxStepsPerFrame) {
      const tickContext = Object.freeze({
        tick,
        stepMs: fixedStepMs,
        stepSeconds: fixedStepMs / 1000,
        simulationTimeMs,
        sequence: sequence(),
      });
      if (typeof callbacks.simulate === 'function') callbacks.simulate(tickContext);
      accumulatorMs -= fixedStepMs;
      simulationTimeMs += fixedStepMs;
      tick += 1;
      steps += 1;
      totalSteps += 1;
    }

    let spiralGuard = false;
    if (accumulatorMs >= fixedStepMs) {
      spiralGuard = true;
      accumulatorMs = Math.min(accumulatorMs, fixedStepMs);
      if (typeof callbacks.onSpiralGuard === 'function') callbacks.onSpiralGuard({ tick, droppedMs });
    }

    const alpha = clamp(accumulatorMs / fixedStepMs, 0, 1);
    if (typeof callbacks.present === 'function') {
      callbacks.present(Object.freeze({ tick, simulationTimeMs, alpha, steps }));
    }

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
  }

  function step(callbacks = {}) {
    const wasPaused = paused;
    paused = false;
    const result = frame(fixedStepMs, callbacks);
    paused = wasPaused;
    return result;
  }

  function pause() { paused = true; }
  function resume() { paused = false; }
  function reset({ timeMs = 0, startTick = 0 } = {}) {
    accumulatorMs = 0;
    simulationTimeMs = Math.max(0, finiteOr(timeMs, 0));
    tick = Math.max(0, integerOr(startTick, 0));
    droppedMs = 0;
    totalFrames = 0;
    totalSteps = 0;
    lastDeltaMs = 0;
  }

  function seek(timeMs, callbacks = {}) {
    const target = Math.max(0, finiteOr(timeMs, simulationTimeMs));
    if (target < simulationTimeMs) throw new RangeError('Scheduler cannot seek backwards without a full state restore.');
    let remaining = target - simulationTimeMs;
    let steps = 0;
    while (remaining >= fixedStepMs) {
      if (typeof callbacks.simulate === 'function') callbacks.simulate(Object.freeze({
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
    return Object.freeze({ tick, simulationTimeMs, alpha: accumulatorMs / fixedStepMs, steps });
  }

  function snapshot() {
    return Object.freeze({
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
    });
  }

  return Object.freeze({
    frame,
    step,
    pause,
    resume,
    reset,
    seek,
    snapshot,
    get tick() { return tick; },
    get simulationTimeMs() { return simulationTimeMs; },
    get paused() { return paused; },
  });
}

export function createSimulationAccumulator(options = {}) {
  const scheduler = createDeterministicRuntimeScheduler(options);
  const events = [];
  return Object.freeze({
    update(deltaMs, simulate) {
      return scheduler.frame(deltaMs, {
        simulate(context) {
          const result = simulate?.(context);
          if (result !== undefined) events.push(Object.freeze({ tick: context.tick, result }));
        },
      });
    },
    consumeEvents() {
      const output = events.slice();
      events.length = 0;
      return output;
    },
    scheduler,
  });
}

export function validateSchedulerSnapshot(snapshot) {
  const required = ['fixedStepMs', 'maxCatchupMs', 'maxStepsPerFrame', 'accumulatorMs', 'simulationTimeMs', 'tick'];
  const missing = required.filter((key) => snapshot?.[key] === undefined);
  const valid = missing.length === 0
    && snapshot.fixedStepMs > 0
    && snapshot.maxCatchupMs >= snapshot.fixedStepMs
    && snapshot.maxStepsPerFrame >= 1
    && snapshot.accumulatorMs >= 0
    && snapshot.simulationTimeMs >= 0
    && snapshot.tick >= 0;
  return Object.freeze({ valid, missing });
}

export function partitionElapsed(elapsedMs, stepMs = DEFAULT_FIXED_STEP_MS, maxSteps = DEFAULT_MAX_STEPS) {
  const safeStep = clamp(stepMs, 1, 1000);
  const safeMax = clamp(integerOr(maxSteps, DEFAULT_MAX_STEPS), 1, 128);
  let remaining = Math.max(0, finiteOr(elapsedMs, 0));
  const chunks = [];
  for (let index = 0; index < safeMax && remaining >= safeStep; index += 1) {
    chunks.push(safeStep);
    remaining -= safeStep;
  }
  return Object.freeze({ chunks, remainderMs: remaining });
}
