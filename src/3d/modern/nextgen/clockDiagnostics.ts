import { Tick, clamp, tickValue } from './types.ts';

export interface ClockDiagnostics {
  tick: Tick;
  stepSeconds: number;
  accumulatorSeconds: number;
  interpolationAlpha: number;
  simulatedTicks: number;
  droppedSeconds: number;
  catchUpLimited: boolean;
}

export function inspectClock(input: {
  tick: Tick;
  stepSeconds: number;
  accumulatorSeconds: number;
  simulatedTicks: number;
  droppedSeconds: number;
  maxCatchUpTicks: number;
}): ClockDiagnostics {
  const stepSeconds = Math.max(Number.EPSILON, input.stepSeconds);
  return {
    tick: tickValue(Math.max(0, Math.trunc(input.tick))),
    stepSeconds,
    accumulatorSeconds: Math.max(0, input.accumulatorSeconds),
    interpolationAlpha: clamp(input.accumulatorSeconds / stepSeconds, 0, 1),
    simulatedTicks: Math.max(0, Math.trunc(input.simulatedTicks)),
    droppedSeconds: Math.max(0, input.droppedSeconds),
    catchUpLimited: input.simulatedTicks >= input.maxCatchUpTicks,
  };
}

export function isHealthyClock(diagnostics: ClockDiagnostics, maxDroppedSeconds = 1): boolean {
  return diagnostics.stepSeconds > 0
    && diagnostics.interpolationAlpha >= 0
    && diagnostics.interpolationAlpha <= 1
    && diagnostics.droppedSeconds <= maxDroppedSeconds;
}
