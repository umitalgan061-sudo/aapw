import { type OutcomeV5, okV5, failV5, tickV5, type TickV5 } from './runtimeContractV5';

export type TaskPhaseV5 = 'input' | 'simulation' | 'animation' | 'streaming' | 'network' | 'render' | 'telemetry';
export interface TaskV5 {
  readonly id: string;
  readonly phase: TaskPhaseV5;
  readonly priority: number;
  readonly intervalTicks: number;
  readonly budgetMs: number;
  readonly run: (context: TaskContextV5) => void;
}
export interface TaskContextV5 {
  readonly tick: TickV5;
  readonly deltaSeconds: number;
  readonly phase: TaskPhaseV5;
  readonly signal: AbortSignal;
}
export interface SchedulerMetricsV5 {
  readonly tick: TickV5;
  readonly executed: number;
  readonly skipped: number;
  readonly overBudget: number;
  readonly totalMs: number;
  readonly byPhase: Readonly<Record<TaskPhaseV5, number>>;
}
export interface SchedulerOptionsV5 {
  readonly fixedDeltaSeconds?: number;
  readonly maxTasksPerTick?: number;
  readonly maxBudgetMs?: number;
  readonly now?: () => number;
}

const PHASES: readonly TaskPhaseV5[] = ['input', 'simulation', 'animation', 'streaming', 'network', 'render', 'telemetry'];
const priority = (task: TaskV5): number => Number.isFinite(task.priority) ? task.priority : 0;
const interval = (task: TaskV5): number => Math.max(1, Math.floor(task.intervalTicks || 1));

export class DeterministicSchedulerV5 {
  readonly fixedDeltaSeconds: number;
  readonly maxTasksPerTick: number;
  readonly maxBudgetMs: number;
  #now: () => number;
  #tasks = new Map<string, TaskV5>();
  #lastTick: TickV5 = tickV5(0);
  #abort = new AbortController();
  #metrics: SchedulerMetricsV5 = Object.freeze({
    tick: tickV5(0), executed: 0, skipped: 0, overBudget: 0, totalMs: 0,
    byPhase: Object.freeze({ input: 0, simulation: 0, animation: 0, streaming: 0, network: 0, render: 0, telemetry: 0 }),
  });

  constructor(options: SchedulerOptionsV5 = {}) {
    this.fixedDeltaSeconds = Math.max(1 / 240, Math.min(1 / 20, options.fixedDeltaSeconds ?? 1 / 60));
    this.maxTasksPerTick = Math.max(1, Math.min(10_000, Math.floor(options.maxTasksPerTick ?? 512)));
    this.maxBudgetMs = Math.max(1, Math.min(100, options.maxBudgetMs ?? 12));
    this.#now = options.now ?? (() => typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  register(task: TaskV5): OutcomeV5<void> {
    if (!task.id || task.id.length > 128) return failV5('TASK_ID', 'Invalid task id');
    if (this.#tasks.has(task.id)) return failV5('TASK_EXISTS', `Task already registered: ${task.id}`);
    if (!PHASES.includes(task.phase)) return failV5('TASK_PHASE', 'Unsupported task phase');
    if (typeof task.run !== 'function') return failV5('TASK_RUN', 'Task run callback is required');
    this.#tasks.set(task.id, Object.freeze({ ...task, intervalTicks: interval(task), priority: priority(task) }));
    return okV5(undefined);
  }

  unregister(id: string): boolean { return this.#tasks.delete(id); }
  clear(): void { this.#tasks.clear(); }

  run(tick: TickV5 = tickV5(this.#lastTick + 1), deltaSeconds = this.fixedDeltaSeconds): SchedulerMetricsV5 {
    if (tick < this.#lastTick) return this.#metrics;
    this.#lastTick = tick;
    const started = this.#now();
    let executed = 0;
    let skipped = 0;
    let overBudget = 0;
    const phaseCounts: Record<TaskPhaseV5, number> = { input: 0, simulation: 0, animation: 0, streaming: 0, network: 0, render: 0, telemetry: 0 };
    const tasks = [...this.#tasks.values()].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    for (const task of tasks) {
      if (executed >= this.maxTasksPerTick) { skipped += 1; continue; }
      if (Number(tick) % interval(task) !== 0) { skipped += 1; continue; }
      const before = this.#now();
      try {
        task.run(Object.freeze({ tick, deltaSeconds: Math.max(0, Math.min(0.25, deltaSeconds)), phase: task.phase, signal: this.#abort.signal }));
      } catch {
        // A task cannot abort the scheduler. Faults are isolated to the task boundary.
      }
      const elapsed = Math.max(0, this.#now() - before);
      executed += 1;
      phaseCounts[task.phase] += 1;
      if (elapsed > task.budgetMs) overBudget += 1;
      if (this.#now() - started >= this.maxBudgetMs) break;
    }
    this.#metrics = Object.freeze({ tick, executed, skipped, overBudget, totalMs: Math.max(0, this.#now() - started), byPhase: Object.freeze({ ...phaseCounts }) });
    return this.#metrics;
  }

  runPhase(tick: TickV5, phase: TaskPhaseV5, deltaSeconds = this.fixedDeltaSeconds): number {
    const tasks = [...this.#tasks.values()].filter((task) => task.phase === phase).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    let count = 0;
    for (const task of tasks) {
      if (Number(tick) % interval(task) !== 0) continue;
      try { task.run(Object.freeze({ tick, deltaSeconds, phase, signal: this.#abort.signal })); count += 1; } catch { /* isolated */ }
    }
    return count;
  }

  metrics(): SchedulerMetricsV5 { return this.#metrics; }
  taskCount(): number { return this.#tasks.size; }
  taskIds(): readonly string[] { return Object.freeze([...this.#tasks.keys()].sort()); }
  stop(): void { this.#abort.abort(); this.#abort = new AbortController(); }
  reset(tick: TickV5 = tickV5(0)): void { this.#lastTick = tick; this.#metrics = Object.freeze({ tick, executed: 0, skipped: 0, overBudget: 0, totalMs: 0, byPhase: Object.freeze({ input: 0, simulation: 0, animation: 0, streaming: 0, network: 0, render: 0, telemetry: 0 }) }); }
}

export function createPhaseTasksV5(tasks: readonly TaskV5[]): Readonly<Record<TaskPhaseV5, readonly TaskV5[]>> {
  const grouped: Record<TaskPhaseV5, TaskV5[]> = { input: [], simulation: [], animation: [], streaming: [], network: [], render: [], telemetry: [] };
  for (const task of tasks) grouped[task.phase].push(task);
  for (const phase of PHASES) grouped[phase].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return Object.freeze(Object.fromEntries(PHASES.map((phase) => [phase, Object.freeze(grouped[phase].slice())])) as Record<TaskPhaseV5, readonly TaskV5[]>);
}
