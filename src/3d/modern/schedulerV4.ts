import {
  type TickId,
  type RuntimePhaseV4,
  type RuntimeStatsV4,
  tickId,
  clampV4,
  type RuntimeSourceV4,
} from './runtimeContractsV4';

export type SchedulerLaneV4 = 'input' | 'simulation' | 'world' | 'network' | 'assets' | 'audio' | 'render' | 'telemetry';

export interface SchedulerTaskV4<TContext = unknown> {
  readonly id: string;
  readonly lane: SchedulerLaneV4;
  readonly priority: number;
  readonly intervalTicks: number;
  readonly maxRuntimeMs: number;
  readonly run: (context: TContext) => void | Promise<void>;
  readonly enabled?: (context: TContext) => boolean;
}

export interface SchedulerContextV4 {
  readonly tick: TickId;
  readonly deltaMs: number;
  readonly phase: RuntimePhaseV4;
  readonly source: RuntimeSourceV4;
  readonly frame: number;
}

export interface SchedulerBudgetV4 {
  readonly lane: SchedulerLaneV4;
  readonly budgetMs: number;
  readonly overrunToleranceMs: number;
}

export interface SchedulerExecutionV4 {
  readonly id: string;
  readonly lane: SchedulerLaneV4;
  readonly tick: TickId;
  readonly durationMs: number;
  readonly skipped: boolean;
  readonly overBudget: boolean;
  readonly error: string | null;
}

export interface SchedulerMetricsV4 {
  readonly ticks: number;
  readonly frames: number;
  readonly taskCount: number;
  readonly executions: number;
  readonly skipped: number;
  readonly overruns: number;
  readonly errors: number;
  readonly averageTickMs: number;
  readonly maxTickMs: number;
}

const LANES: readonly SchedulerLaneV4[] = ['input', 'simulation', 'world', 'network', 'assets', 'audio', 'render', 'telemetry'];
const defaultLaneBudget = (lane: SchedulerLaneV4): number => ({ input: 1, simulation: 4, world: 3, network: 1.5, assets: 2, audio: 1, render: 2, telemetry: 0.5 }[lane]);
const defaultPriority = (lane: SchedulerLaneV4): number => ({ input: 100, simulation: 95, world: 80, network: 75, assets: 55, audio: 60, render: 50, telemetry: 10 }[lane]);

export class SchedulerV4<TContext = SchedulerContextV4> {
  readonly fixedStepMs: number;
  readonly maxCatchUpSteps: number;
  #now: () => number;
  #tasks = new Map<string, SchedulerTaskV4<TContext>>();
  #laneBudgets = new Map<SchedulerLaneV4, SchedulerBudgetV4>();
  #lastFrameAt = 0;
  #accumulator = 0;
  #tick = 0;
  #frame = 0;
  #draining = false;
  #executions: SchedulerExecutionV4[] = [];
  #metrics = { ticks: 0, frames: 0, executions: 0, skipped: 0, overruns: 0, errors: 0, totalTickMs: 0, maxTickMs: 0 };

  constructor(options: { readonly fixedStepMs?: number; readonly maxCatchUpSteps?: number; readonly now?: () => number } = {}) {
    this.fixedStepMs = Math.max(1, options.fixedStepMs ?? 1000 / 60);
    this.maxCatchUpSteps = Math.max(1, Math.trunc(options.maxCatchUpSteps ?? 4));
    this.#now = options.now ?? (() => performance.now());
    this.#lastFrameAt = this.#now();
    for (const lane of LANES) this.#laneBudgets.set(lane, { lane, budgetMs: defaultLaneBudget(lane), overrunToleranceMs: 1 });
  }

  register(task: SchedulerTaskV4<TContext>): void {
    if (!task.id.trim()) throw new Error('Scheduler task id is required');
    if (this.#tasks.has(task.id)) throw new Error(`Scheduler task already exists: ${task.id}`);
    this.#tasks.set(task.id, Object.freeze({ ...task, priority: Number.isFinite(task.priority) ? task.priority : defaultPriority(task.lane), intervalTicks: Math.max(1, Math.trunc(task.intervalTicks || 1)), maxRuntimeMs: Math.max(0, task.maxRuntimeMs) }));
  }

  replace(task: SchedulerTaskV4<TContext>): void {
    if (!task.id.trim()) throw new Error('Scheduler task id is required');
    this.#tasks.set(task.id, Object.freeze({ ...task, priority: Number.isFinite(task.priority) ? task.priority : defaultPriority(task.lane), intervalTicks: Math.max(1, Math.trunc(task.intervalTicks || 1)), maxRuntimeMs: Math.max(0, task.maxRuntimeMs) }));
  }

  unregister(id: string): boolean {
    return this.#tasks.delete(id);
  }

  setLaneBudget(lane: SchedulerLaneV4, budgetMs: number, overrunToleranceMs = 1): void {
    this.#laneBudgets.set(lane, { lane, budgetMs: Math.max(0, budgetMs), overrunToleranceMs: Math.max(0, overrunToleranceMs) });
  }

  laneBudgets(): readonly SchedulerBudgetV4[] {
    return Object.freeze([...this.#laneBudgets.values()].sort((a, b) => LANES.indexOf(a.lane) - LANES.indexOf(b.lane)));
  }

  taskCount(): number {
    return this.#tasks.size;
  }

  metrics(): SchedulerMetricsV4 {
    const average = this.#metrics.ticks > 0 ? this.#metrics.totalTickMs / this.#metrics.ticks : 0;
    return Object.freeze({ ticks: this.#metrics.ticks, frames: this.#metrics.frames, taskCount: this.#tasks.size, executions: this.#metrics.executions, skipped: this.#metrics.skipped, overruns: this.#metrics.overruns, errors: this.#metrics.errors, averageTickMs: average, maxTickMs: this.#metrics.maxTickMs });
  }

  recentExecutions(): readonly SchedulerExecutionV4[] {
    return Object.freeze(this.#executions.slice());
  }

  get tick(): TickId {
    return tickId(this.#tick);
  }

  get frame(): number {
    return this.#frame;
  }

  advance(contextFactory: (context: SchedulerContextV4) => TContext, forcedDeltaMs?: number): Promise<readonly SchedulerExecutionV4[]> {
    if (this.#draining) return Promise.resolve(Object.freeze([]));
    this.#draining = true;
    const now = this.#now();
    const delta = clampV4(forcedDeltaMs ?? now - this.#lastFrameAt, 0, 250);
    this.#lastFrameAt = now;
    this.#accumulator += delta;
    this.#frame += 1;
    this.#metrics.frames += 1;
    let steps = 0;
    const work: SchedulerExecutionV4[] = [];
    while (this.#accumulator >= this.fixedStepMs && steps < this.maxCatchUpSteps) {
      this.#accumulator -= this.fixedStepMs;
      this.#tick += 1;
      const context = contextFactory({ tick: tickId(this.#tick), deltaMs: this.fixedStepMs, phase: 'running', source: 'system', frame: this.#frame });
      const started = this.#now();
      work.push(...this.#runTick(context, tickId(this.#tick)));
      const elapsed = Math.max(0, this.#now() - started);
      this.#metrics.totalTickMs += elapsed;
      this.#metrics.maxTickMs = Math.max(this.#metrics.maxTickMs, elapsed);
      this.#metrics.ticks += 1;
      steps += 1;
    }
    if (steps === this.maxCatchUpSteps && this.#accumulator >= this.fixedStepMs) this.#accumulator = 0;
    this.#draining = false;
    this.#pushExecutions(work);
    return Promise.resolve(Object.freeze(work));
  }

  async runOneTick(contextFactory: (context: SchedulerContextV4) => TContext): Promise<readonly SchedulerExecutionV4[]> {
    const context = contextFactory({ tick: tickId(++this.#tick), deltaMs: this.fixedStepMs, phase: 'running', source: 'system', frame: this.#frame });
    const started = this.#now();
    const result = await this.#runTickAsync(context, tickId(this.#tick));
    const elapsed = Math.max(0, this.#now() - started);
    this.#metrics.totalTickMs += elapsed;
    this.#metrics.maxTickMs = Math.max(this.#metrics.maxTickMs, elapsed);
    this.#metrics.ticks += 1;
    this.#pushExecutions(result);
    return Object.freeze(result);
  }

  reset(): void {
    this.#accumulator = 0;
    this.#tick = 0;
    this.#frame = 0;
    this.#executions.length = 0;
    this.#metrics = { ticks: 0, frames: 0, executions: 0, skipped: 0, overruns: 0, errors: 0, totalTickMs: 0, maxTickMs: 0 };
    this.#lastFrameAt = this.#now();
  }

  #runTick(context: TContext, tick: TickId): SchedulerExecutionV4[] {
    const tasks = [...this.#tasks.values()].filter((task) => this.#tick % task.intervalTicks === 0).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    const laneTime = new Map<SchedulerLaneV4, number>();
    const executions: SchedulerExecutionV4[] = [];
    for (const task of tasks) {
      if (task.enabled && !task.enabled(context)) {
        const record: SchedulerExecutionV4 = { id: task.id, lane: task.lane, tick, durationMs: 0, skipped: true, overBudget: false, error: null };
        executions.push(record);
        this.#metrics.skipped += 1;
        continue;
      }
      const budget = this.#laneBudgets.get(task.lane)!;
      const used = laneTime.get(task.lane) ?? 0;
      if (used >= budget.budgetMs + budget.overrunToleranceMs && task.lane !== 'input') {
        const record: SchedulerExecutionV4 = { id: task.id, lane: task.lane, tick, durationMs: 0, skipped: true, overBudget: true, error: null };
        executions.push(record);
        this.#metrics.skipped += 1;
        continue;
      }
      const started = this.#now();
      let error: string | null = null;
      try {
        const result = task.run(context);
        if (result && typeof (result as Promise<void>).then === 'function') {
          const record: SchedulerExecutionV4 = { id: task.id, lane: task.lane, tick, durationMs: 0, skipped: false, overBudget: false, error: 'ASYNC_TASK_ON_SYNC_PATH' };
          executions.push(record);
          this.#metrics.errors += 1;
          continue;
        }
      } catch (cause) {
        error = cause instanceof Error ? cause.message.slice(0, 300) : 'Task failed';
        this.#metrics.errors += 1;
      }
      const duration = Math.max(0, this.#now() - started);
      laneTime.set(task.lane, used + duration);
      const overBudget = duration > task.maxRuntimeMs || laneTime.get(task.lane)! > budget.budgetMs + budget.overrunToleranceMs;
      if (overBudget) this.#metrics.overruns += 1;
      executions.push({ id: task.id, lane: task.lane, tick, durationMs: duration, skipped: false, overBudget, error });
      this.#metrics.executions += 1;
    }
    return executions;
  }

  async #runTickAsync(context: TContext, tick: TickId): Promise<SchedulerExecutionV4[]> {
    const tasks = [...this.#tasks.values()].filter((task) => this.#tick % task.intervalTicks === 0).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    const laneTime = new Map<SchedulerLaneV4, number>();
    const executions: SchedulerExecutionV4[] = [];
    for (const task of tasks) {
      if (task.enabled && !task.enabled(context)) {
        executions.push({ id: task.id, lane: task.lane, tick, durationMs: 0, skipped: true, overBudget: false, error: null });
        this.#metrics.skipped += 1;
        continue;
      }
      const budget = this.#laneBudgets.get(task.lane)!;
      const used = laneTime.get(task.lane) ?? 0;
      if (used >= budget.budgetMs + budget.overrunToleranceMs && task.lane !== 'input') {
        executions.push({ id: task.id, lane: task.lane, tick, durationMs: 0, skipped: true, overBudget: true, error: null });
        this.#metrics.skipped += 1;
        continue;
      }
      const started = this.#now();
      let error: string | null = null;
      try {
        await task.run(context);
      } catch (cause) {
        error = cause instanceof Error ? cause.message.slice(0, 300) : 'Task failed';
        this.#metrics.errors += 1;
      }
      const duration = Math.max(0, this.#now() - started);
      laneTime.set(task.lane, used + duration);
      const overBudget = duration > task.maxRuntimeMs || laneTime.get(task.lane)! > budget.budgetMs + budget.overrunToleranceMs;
      if (overBudget) this.#metrics.overruns += 1;
      executions.push({ id: task.id, lane: task.lane, tick, durationMs: duration, skipped: false, overBudget, error });
      this.#metrics.executions += 1;
    }
    return executions;
  }

  #pushExecutions(executions: readonly SchedulerExecutionV4[]): void {
    this.#executions.push(...executions);
    while (this.#executions.length > 512) this.#executions.shift();
  }
}

export function createDefaultSchedulerV4<TContext = SchedulerContextV4>(now?: () => number): SchedulerV4<TContext> {
  return new SchedulerV4<TContext>({ fixedStepMs: 1000 / 60, maxCatchUpSteps: 4, now });
}

export function schedulerStatsV4(scheduler: SchedulerV4): RuntimeStatsV4 {
  const metrics = scheduler.metrics();
  return { frame: scheduler.frame, tick: scheduler.tick, deltaMs: scheduler.fixedStepMs, cpuMs: metrics.averageTickMs, gpuMs: 0, entityCount: 0, visibleCount: 0, queuedCommands: 0, queuedAssets: 0 };
}
