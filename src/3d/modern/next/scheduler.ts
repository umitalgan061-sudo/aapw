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

const DEFAULT_CONFIG: FixedStepConfig = {
  stepSeconds: 1 / 60,
  maxStepsPerFrame: 8,
  maxFrameDeltaSeconds: 0.25,
};

export class FixedStepScheduler {
  readonly config: FixedStepConfig;
  #tick = 0;
  #simTime = 0;
  #accumulator = 0;
  #nextTaskId = 1;
  #tasks = new Map<number, TaskEntry>();
  #orderedTasks: TaskEntry[] = [];

  constructor(config: Partial<FixedStepConfig> = {}) {
    this.config = {
      stepSeconds: config.stepSeconds ?? DEFAULT_CONFIG.stepSeconds,
      maxStepsPerFrame: config.maxStepsPerFrame ?? DEFAULT_CONFIG.maxStepsPerFrame,
      maxFrameDeltaSeconds: config.maxFrameDeltaSeconds ?? DEFAULT_CONFIG.maxFrameDeltaSeconds,
    };
    if (!(this.config.stepSeconds > 0) || !Number.isFinite(this.config.stepSeconds)) throw new RangeError('stepSeconds must be positive');
    if (!Number.isInteger(this.config.maxStepsPerFrame) || this.config.maxStepsPerFrame < 1) throw new RangeError('maxStepsPerFrame must be >= 1');
    if (!(this.config.maxFrameDeltaSeconds > 0) || !Number.isFinite(this.config.maxFrameDeltaSeconds)) throw new RangeError('maxFrameDeltaSeconds must be positive');
  }

  get tick(): Tick { return tick(this.#tick); }
  get simTime(): SimTime { return simTime(this.#simTime); }
  get accumulatorSeconds(): number { return this.#accumulator; }
  get state(): SimulationClockState {
    return { tick: this.tick, simTime: this.simTime, accumulatorSeconds: this.#accumulator };
  }

  addTask(name: string, task: SchedulerTask, options: { intervalTicks?: number; priority?: number; startDelayTicks?: number } = {}): number {
    const intervalTicks = Math.max(1, Math.floor(options.intervalTicks ?? 1));
    const entry: TaskEntry = {
      id: this.#nextTaskId++,
      name: name.trim() || `task-${this.#nextTaskId}`,
      intervalTicks,
      priority: options.priority ?? 0,
      task,
      nextTick: this.#tick + Math.max(0, Math.floor(options.startDelayTicks ?? intervalTicks)),
      enabled: true,
    };
    this.#tasks.set(entry.id, entry);
    this.#reorder();
    return entry.id;
  }

  removeTask(id: number): boolean {
    const deleted = this.#tasks.delete(id);
    if (deleted) this.#reorder();
    return deleted;
  }

  setTaskEnabled(id: number, enabled: boolean): boolean {
    const entry = this.#tasks.get(id);
    if (!entry) return false;
    entry.enabled = enabled;
    return true;
  }

  reset(startTick = 0, startSimTime = 0): void {
    this.#tick = Math.max(0, Math.floor(startTick));
    this.#simTime = Math.max(0, startSimTime);
    this.#accumulator = 0;
    for (const task of this.#tasks.values()) task.nextTick = this.#tick + task.intervalTicks;
  }

  advance(frameDeltaSeconds: number): AdvanceResult {
    const delta = Math.max(0, Math.min(this.config.maxFrameDeltaSeconds, Number.isFinite(frameDeltaSeconds) ? frameDeltaSeconds : 0));
    this.#accumulator += delta;
    let steps = 0;
    let simulatedSeconds = 0;
    let spiralPrevented = false;

    while (this.#accumulator >= this.config.stepSeconds && steps < this.config.maxStepsPerFrame) {
      this.#step();
      this.#accumulator -= this.config.stepSeconds;
      simulatedSeconds += this.config.stepSeconds;
      steps += 1;
    }

    if (this.#accumulator >= this.config.stepSeconds) {
      this.#accumulator = Math.min(this.#accumulator, this.config.stepSeconds);
      spiralPrevented = true;
    }

    return {
      steps,
      simulatedSeconds,
      alpha: this.#accumulator / this.config.stepSeconds,
      spiralPrevented,
    };
  }

  flush(maxSteps = this.config.maxStepsPerFrame): number {
    let steps = 0;
    const limit = Math.max(0, Math.floor(maxSteps));
    while (this.#accumulator >= this.config.stepSeconds && steps < limit) {
      this.#step();
      this.#accumulator -= this.config.stepSeconds;
      steps += 1;
    }
    return steps;
  }

  #step(): void {
    this.#tick += 1;
    this.#simTime += this.config.stepSeconds;
    const context: SchedulerTaskContext = { tick: tick(this.#tick), dtSeconds: this.config.stepSeconds, simTime: simTime(this.#simTime) };
    for (const task of this.#orderedTasks) {
      if (!task.enabled || this.#tick < task.nextTick) continue;
      task.task(context);
      do { task.nextTick += task.intervalTicks; } while (task.nextTick <= this.#tick);
    }
  }

  #reorder(): void {
    this.#orderedTasks = [...this.#tasks.values()].sort((a, b) => a.priority - b.priority || a.id - b.id);
  }
}

export class BudgetedTaskScheduler {
  #queue: Array<{ task: SchedulerTask; priority: number; estimatedCostMs: number; serial: number }> = [];
  #serial = 1;

  schedule(task: SchedulerTask, options: { priority?: number; estimatedCostMs?: number } = {}): void {
    this.#queue.push({ task, priority: options.priority ?? 0, estimatedCostMs: Math.max(0, options.estimatedCostMs ?? 0), serial: this.#serial++ });
    this.#queue.sort((a, b) => a.priority - b.priority || a.estimatedCostMs - b.estimatedCostMs || a.serial - b.serial);
  }

  run(context: SchedulerTaskContext, budgetMs: number): { executed: number; consumedEstimateMs: number; deferred: number } {
    const budget = Math.max(0, budgetMs);
    let consumed = 0;
    let executed = 0;
    const deferred: typeof this.#queue = [];
    while (this.#queue.length) {
      const item = this.#queue.shift()!;
      if (executed > 0 && consumed + item.estimatedCostMs > budget) { deferred.push(item); continue; }
      item.task(context);
      consumed += item.estimatedCostMs;
      executed += 1;
    }
    this.#queue.push(...deferred);
    this.#queue.sort((a, b) => a.priority - b.priority || a.estimatedCostMs - b.estimatedCostMs || a.serial - b.serial);
    return { executed, consumedEstimateMs: consumed, deferred: deferred.length };
  }
}
