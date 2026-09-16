import { RuntimeBudgets, TaskLane, clamp, stableNumber } from './contracts.ts';

export interface ScheduledTaskContext {
  readonly frame: number;
  readonly tick: number;
  readonly lane: TaskLane;
  readonly budgetMs: number;
  readonly signal: AbortSignal;
}

export interface ScheduledTask {
  readonly id: string;
  readonly lane: TaskLane;
  readonly priority: number;
  readonly intervalFrames: number;
  readonly maxRuntimeMs: number;
  readonly run: (context: ScheduledTaskContext) => void | Promise<void>;
}

export interface TaskTelemetry {
  readonly id: string;
  readonly lane: TaskLane;
  readonly frame: number;
  readonly durationMs: number;
  readonly budgetMs: number;
  readonly overBudget: boolean;
  readonly skipped: boolean;
}

export interface SchedulerMetrics {
  readonly frame: number;
  readonly runs: number;
  readonly skipped: number;
  readonly failures: number;
  readonly totalMs: number;
  readonly overBudget: number;
  readonly laneMs: Readonly<Record<TaskLane, number>>;
}

const LANES: readonly TaskLane[] = ['simulation', 'gameplay', 'streaming', 'render', 'telemetry', 'background'];
const emptyLaneMs = (): Record<TaskLane, number> => ({ simulation: 0, gameplay: 0, streaming: 0, render: 0, telemetry: 0, background: 0 });

export class FrameScheduler {
  readonly #tasks = new Map<string, ScheduledTask>();
  readonly #abort = new AbortController();
  readonly #telemetry: TaskTelemetry[] = [];
  readonly #laneMs = emptyLaneMs();
  #frame = 0;
  #runs = 0;
  #skipped = 0;
  #failures = 0;
  #totalMs = 0;
  #overBudget = 0;

  register(task: ScheduledTask): void {
    if (!task.id.trim()) throw new Error('task id required');
    if (this.#tasks.has(task.id)) throw new Error(`duplicate task: ${task.id}`);
    if (task.intervalFrames < 1) throw new Error('intervalFrames must be >= 1');
    this.#tasks.set(task.id, Object.freeze({ ...task }));
  }

  replace(task: ScheduledTask): void { this.#tasks.set(task.id, Object.freeze({ ...task })); }
  remove(taskId: string): boolean { return this.#tasks.delete(taskId); }

  async runFrame(tick: number, budgets: RuntimeBudgets, now: () => number = performance.now): Promise<readonly TaskTelemetry[]> {
    this.#frame += 1;
    const candidates = [...this.#tasks.values()]
      .filter((task) => this.#frame % task.intervalFrames === 0 || task.intervalFrames === 1)
      .sort((a, b) => b.priority - a.priority || a.lane.localeCompare(b.lane) || a.id.localeCompare(b.id));
    const frameTelemetry: TaskTelemetry[] = [];
    const used = emptyLaneMs();
    for (const task of candidates) {
      const budget = budgets[`${task.lane}Ms` as keyof RuntimeBudgets] as number;
      const remaining = Math.max(0, budget - used[task.lane]);
      if (remaining <= 0 && task.priority < 100) {
        this.#skipped += 1;
        frameTelemetry.push(Object.freeze({ id: task.id, lane: task.lane, frame: this.#frame, durationMs: 0, budgetMs: budget, overBudget: false, skipped: true }));
        continue;
      }
      const started = now();
      try {
        await task.run(Object.freeze({ frame: this.#frame, tick, lane: task.lane, budgetMs: Math.min(remaining || budget, task.maxRuntimeMs), signal: this.#abort.signal }));
        const duration = stableNumber(Math.max(0, now() - started));
        const over = duration > task.maxRuntimeMs || duration > budget;
        used[task.lane] += duration;
        this.#laneMs[task.lane] += duration;
        this.#totalMs += duration;
        this.#runs += 1;
        if (over) this.#overBudget += 1;
        const sample = Object.freeze({ id: task.id, lane: task.lane, frame: this.#frame, durationMs: duration, budgetMs: budget, overBudget: over, skipped: false });
        this.#telemetry.push(sample);
        frameTelemetry.push(sample);
      } catch (error) {
        this.#failures += 1;
        const duration = stableNumber(Math.max(0, now() - started));
        const sample = Object.freeze({ id: task.id, lane: task.lane, frame: this.#frame, durationMs: duration, budgetMs: budget, overBudget: true, skipped: false });
        this.#telemetry.push(sample);
        frameTelemetry.push(sample);
      }
      if (this.#telemetry.length > 2048) this.#telemetry.splice(0, this.#telemetry.length - 2048);
    }
    return Object.freeze(frameTelemetry);
  }

  runSyncFrame(tick: number, budgets: RuntimeBudgets, now: () => number = performance.now): readonly TaskTelemetry[] {
    this.#frame += 1;
    const candidates = [...this.#tasks.values()].filter((task) => this.#frame % task.intervalFrames === 0 || task.intervalFrames === 1).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    const samples: TaskTelemetry[] = [];
    const used = emptyLaneMs();
    for (const task of candidates) {
      const budget = budgets[`${task.lane}Ms` as keyof RuntimeBudgets] as number;
      if (used[task.lane] >= budget && task.priority < 100) {
        this.#skipped += 1;
        samples.push(Object.freeze({ id: task.id, lane: task.lane, frame: this.#frame, durationMs: 0, budgetMs: budget, overBudget: false, skipped: true }));
        continue;
      }
      const started = now();
      try {
        task.run(Object.freeze({ frame: this.#frame, tick, lane: task.lane, budgetMs: Math.min(Math.max(0, budget - used[task.lane]), task.maxRuntimeMs), signal: this.#abort.signal }));
        const duration = stableNumber(Math.max(0, now() - started));
        const over = duration > budget || duration > task.maxRuntimeMs;
        used[task.lane] += duration;
        this.#laneMs[task.lane] += duration;
        this.#totalMs += duration;
        this.#runs += 1;
        if (over) this.#overBudget += 1;
        const sample = Object.freeze({ id: task.id, lane: task.lane, frame: this.#frame, durationMs: duration, budgetMs: budget, overBudget: over, skipped: false });
        this.#telemetry.push(sample);
        samples.push(sample);
      } catch {
        this.#failures += 1;
        const sample = Object.freeze({ id: task.id, lane: task.lane, frame: this.#frame, durationMs: 0, budgetMs: budget, overBudget: true, skipped: false });
        this.#telemetry.push(sample);
        samples.push(sample);
      }
    }
    return Object.freeze(samples);
  }

  telemetry(): readonly TaskTelemetry[] { return Object.freeze([...this.#telemetry]); }

  metrics(): SchedulerMetrics {
    const laneMs = Object.freeze({ ...this.#laneMs });
    return Object.freeze({ frame: this.#frame, runs: this.#runs, skipped: this.#skipped, failures: this.#failures, totalMs: stableNumber(this.#totalMs), overBudget: this.#overBudget, laneMs });
  }

  budgetHeadroom(budgets: RuntimeBudgets): Readonly<Record<TaskLane, number>> {
    const result = emptyLaneMs();
    for (const lane of LANES) result[lane] = stableNumber(Math.max(0, budgets[`${lane}Ms` as keyof RuntimeBudgets] as number - this.#laneMs[lane]));
    return Object.freeze(result);
  }

  shutdown(): void { this.#abort.abort(); this.#tasks.clear(); }
}

export interface AdaptiveBudgetState {
  readonly budgets: RuntimeBudgets;
  readonly pressure: number;
  readonly adjustments: number;
}

export class AdaptiveBudgetController {
  #budgets: RuntimeBudgets;
  #pressure = 0;
  #adjustments = 0;

  constructor(initial: RuntimeBudgets) { this.#budgets = Object.freeze({ ...initial }); }

  observe(frameMs: number): AdaptiveBudgetState {
    const ratio = frameMs / Math.max(1, this.#budgets.frameMs);
    this.#pressure = clamp(this.#pressure * 0.85 + Math.max(0, ratio - 1), 0, 4);
    if (ratio > 1.12) this.#rebalance(-0.05);
    else if (ratio < 0.82) this.#rebalance(0.025);
    return this.state();
  }

  private #rebalance(delta: number): void {
    this.#budgets = Object.freeze({
      ...this.#budgets,
      simulationMs: clamp(this.#budgets.simulationMs * (1 + delta), 2, 12),
      renderMs: clamp(this.#budgets.renderMs * (1 + delta), 3, 16),
      streamingMs: clamp(this.#budgets.streamingMs * (1 + delta), 0.5, 5),
      backgroundMs: clamp(this.#budgets.backgroundMs * (1 + delta), 0.1, 2),
    });
    this.#adjustments += 1;
  }

  state(): AdaptiveBudgetState { return Object.freeze({ budgets: this.#budgets, pressure: stableNumber(this.#pressure), adjustments: this.#adjustments }); }
}
