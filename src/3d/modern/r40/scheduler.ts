import type { CommandId, RuntimePhase, RuntimeTask, TaskBudgetReport, TaskContext, TaskLane, TaskResult, Tick } from './types';
import { stableSort } from './deterministic';

const LANES: readonly TaskLane[] = ['critical', 'interactive', 'simulation', 'background', 'idle'];
const PHASES: readonly RuntimePhase[] = ['input', 'simulation', 'navigation', 'ai', 'audio', 'streaming', 'network', 'save', 'render', 'telemetry'];
const WEIGHT: Readonly<Record<TaskLane, number>> = Object.freeze({ critical: 4, interactive: 3, simulation: 3, background: 1, idle: 1 });

export interface SchedulerLimits {
  readonly maxTasksPerFrame: number;
  readonly maxTotalUnits: number;
  readonly laneUnits: Readonly<Record<TaskLane, number>>;
  readonly phaseUnits: Readonly<Record<RuntimePhase, number>>;
  readonly starvationTicks: number;
}

function laneBudget(total: number): Record<TaskLane, number> {
  const sum = LANES.reduce((s, lane) => s + WEIGHT[lane], 0);
  const result = {} as Record<TaskLane, number>;
  let used = 0;
  for (const lane of LANES) {
    const value = lane === 'idle' ? Math.max(0, total - used) : Math.floor(total * WEIGHT[lane] / sum);
    result[lane] = value; used += value;
  }
  return result;
}
function phaseBudget(total: number): Record<RuntimePhase, number> {
  const result = {} as Record<RuntimePhase, number>;
  const per = Math.max(1, Math.floor(total / PHASES.length));
  for (const phase of PHASES) result[phase] = per;
  return result;
}
export class FrameBudgetAllocator {
  readonly limits: SchedulerLimits;
  constructor(options: Partial<SchedulerLimits> = {}) {
    const total = Math.max(16, Math.trunc(options.maxTotalUnits ?? 240));
    this.limits = Object.freeze({
      maxTasksPerFrame: Math.max(1, Math.trunc(options.maxTasksPerFrame ?? 256)),
      maxTotalUnits: total,
      laneUnits: Object.freeze(options.laneUnits ?? laneBudget(total)),
      phaseUnits: Object.freeze(options.phaseUnits ?? phaseBudget(total)),
      starvationTicks: Math.max(1, Math.trunc(options.starvationTicks ?? 30)),
    });
  }
  allocate(tasks: readonly RuntimeTask[], tick: Tick): TaskAllocation { return new TaskAllocation(tasks, tick, this.limits); }
}
export class TaskAllocation {
  readonly tick: Tick;
  readonly selected: readonly RuntimeTask[];
  readonly consumedUnits: number;
  readonly deferred: readonly RuntimeTask[];
  readonly dropped: readonly RuntimeTask[];
  constructor(tasks: readonly RuntimeTask[], tick: Tick, limits: SchedulerLimits) {
    this.tick = tick;
    const phase = { ...limits.phaseUnits };
    const lane = { ...limits.laneUnits };
    let total = limits.maxTotalUnits;
    const selected: RuntimeTask[] = []; const deferred: RuntimeTask[] = []; const dropped: RuntimeTask[] = [];
    const ordered = stableSort(tasks, (a, b) =>
      this.score(b, tick) - this.score(a, tick) || a.id.localeCompare(b.id));
    for (const task of ordered) {
      const cost = Math.max(1, Math.trunc(task.costUnits));
      if (selected.length >= limits.maxTasksPerFrame) { deferred.push(task); continue; }
      const overdue = task.deadlineTick !== null && Number(task.deadlineTick) <= Number(tick);
      const preferred = lane[task.lane] >= cost && phase[task.phase] >= cost && total >= cost;
      if (task.lane === 'critical' && total >= cost || preferred || overdue && total >= cost && task.lane !== 'idle') {
        selected.push(task); total -= cost; lane[task.lane] = Math.max(0, lane[task.lane] - cost); phase[task.phase] = Math.max(0, phase[task.phase] - cost);
      } else if (overdue && task.lane === 'idle') dropped.push(task);
      else deferred.push(task);
    }
    this.selected = Object.freeze(selected); this.deferred = Object.freeze(deferred); this.dropped = Object.freeze(dropped);
    this.consumedUnits = limits.maxTotalUnits - total;
  }
  private score(task: RuntimeTask, tick: Tick): number {
    const age = Math.max(0, Number(tick) - Number(task.enqueuedAt));
    const deadline = task.deadlineTick === null ? 0 : Math.max(0, Number(tick) - Number(task.deadlineTick) + 100);
    return WEIGHT[task.lane] * 100 + age + deadline;
  }
}

interface QueueEntry { readonly task: RuntimeTask; order: number; }
export interface SchedulerHooks {
  readonly onExecuted?: (task: RuntimeTask, result: TaskResult) => void;
  readonly onDeferred?: (task: RuntimeTask) => void;
  readonly onDropped?: (task: RuntimeTask) => void;
}

export class DeterministicTaskScheduler {
  readonly allocator: FrameBudgetAllocator;
  readonly hooks: SchedulerHooks;
  #queues = new Map<TaskLane, QueueEntry[]>();
  #order = 0;
  #age = new Map<CommandId, number>();
  constructor(options: Partial<SchedulerLimits> = {}, hooks: SchedulerHooks = {}) {
    this.allocator = new FrameBudgetAllocator(options); this.hooks = hooks;
    for (const lane of LANES) this.#queues.set(lane, []);
  }
  enqueue(task: RuntimeTask): boolean {
    if (!task.id || task.costUnits <= 0) return false;
    const queue = this.#queues.get(task.lane);
    if (!queue || queue.some((entry) => entry.task.id === task.id)) return false;
    queue.push({ task, order: this.#order++ }); return true;
  }
  cancel(id: CommandId): boolean {
    for (const lane of LANES) {
      const queue = this.#queues.get(lane)!; const index = queue.findIndex((entry) => entry.task.id === id);
      if (index >= 0) { queue.splice(index, 1); this.#age.delete(id); return true; }
    }
    return false;
  }
  pending(): number { return LANES.reduce((sum, lane) => sum + this.#queues.get(lane)!.length, 0); }
  pendingByLane(): Readonly<Record<TaskLane, number>> {
    const result = {} as Record<TaskLane, number>;
    for (const lane of LANES) result[lane] = this.#queues.get(lane)!.length;
    return Object.freeze(result);
  }
  runFrame(tick: Tick, abortSignal = new AbortController().signal): TaskBudgetReport {
    const tasks = LANES.flatMap((lane) => this.#queues.get(lane)!.map((entry) => entry.task));
    const allocation = this.allocator.allocate(tasks, tick);
    const laneUnits = {} as Record<TaskLane, number>;
    const phaseUnits = {} as Record<RuntimePhase, number>;
    for (const lane of LANES) laneUnits[lane] = 0;
    for (const phase of PHASES) phaseUnits[phase] = 0;
    let deferred = 0; let dropped = 0;
    for (const task of allocation.selected) {
      if (abortSignal.aborted) { deferred += 1; this.#age.set(task.id, (this.#age.get(task.id) ?? 0) + 1); continue; }
      const context: TaskContext = Object.freeze({
        tick, phase: task.phase, remainingUnits: Math.max(0, this.allocator.limits.maxTotalUnits - allocation.consumedUnits), abortSignal,
      });
      let result: TaskResult;
      try { result = task.run(context); } catch (error) {
        result = Object.freeze({ consumedUnits: Math.max(1, task.costUnits), completed: true, reschedule: false, detail: error instanceof Error ? error.message : String(error) });
      }
      const queue = this.#queues.get(task.lane)!;
      const index = queue.findIndex((entry) => entry.task.id === task.id);
      if (index >= 0 && (result.completed || !result.reschedule)) queue.splice(index, 1);
      if (result.reschedule && !result.completed) this.#age.set(task.id, (this.#age.get(task.id) ?? 0) + 1); else this.#age.delete(task.id);
      laneUnits[task.lane] += Math.max(0, result.consumedUnits); phaseUnits[task.phase] += Math.max(0, result.consumedUnits);
      this.hooks.onExecuted?.(task, result);
    }
    for (const task of allocation.deferred) { deferred += 1; this.#age.set(task.id, (this.#age.get(task.id) ?? 0) + 1); this.hooks.onDeferred?.(task); }
    for (const task of allocation.dropped) { dropped += 1; this.cancel(task.id); this.hooks.onDropped?.(task); }
    return Object.freeze({ tick, laneUnits: Object.freeze(laneUnits), phaseUnits: Object.freeze(phaseUnits), deferred, dropped });
  }
  clear(lane?: TaskLane): void {
    if (lane) { for (const e of this.#queues.get(lane)!) this.#age.delete(e.task.id); this.#queues.get(lane)!.length = 0; return; }
    for (const current of LANES) this.clear(current);
  }
  snapshot(): readonly RuntimeTask[] { return Object.freeze(LANES.flatMap((lane) => this.#queues.get(lane)!.map((e) => e.task))); }
}

export class PhaseScheduler {
  readonly taskScheduler: DeterministicTaskScheduler;
  readonly phases: readonly RuntimePhase[] = PHASES;
  #reports: TaskBudgetReport | null = null;
  constructor(scheduler = new DeterministicTaskScheduler()) { this.taskScheduler = scheduler; }
  run(tick: Tick, abortSignal?: AbortSignal): TaskBudgetReport {
    this.#reports = this.taskScheduler.runFrame(tick, abortSignal);
    return this.#reports;
  }
  phasePending(phase: RuntimePhase): number { return this.taskScheduler.snapshot().filter((task) => task.phase === phase).length; }
}
