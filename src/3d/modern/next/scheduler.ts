import { simTime, tick, type SchedulerTask, type SchedulerTaskContext, type SimulationClockState, type SimTime, type Tick } from './types.ts';

export interface FixedStepConfig {
  readonly stepSeconds: number;
  readonly maxStepsPerFrame: number;
  readonly maxFrameDeltaSeconds: number;
}

export interface AdvanceResult {
  readonly steps: number;
  readonly simulatedSeconds: number;
  readonly alpha: number;
  readonly spiralPrevented: boolean;
}

interface TaskEntry {
  readonly id: number;
  readonly name: string;
  readonly intervalTicks: number;
  readonly priority: number;
  readonly task: SchedulerTask;
  nextTick: number;
  enabled: boolean;
}

interface BudgetQueueEntry {
  readonly task: SchedulerTask;
  readonly priority: number;
  readonly estimatedCostMs: number;
  readonly serial: number;
}
