import type {
  RuntimeBudget,
  RuntimeFrameContext,
  RuntimePhase,
  ScheduledTask,
  SchedulerSnapshot,
  TaskId,
  TaskRunRecord,
} from './contracts.ts';

const PHASES: readonly RuntimePhase[] = Object.freeze([
  'input',
  'simulation',
  'streaming',
  'animation',
  'render',
  'post-render',
  'telemetry',
]);

interface MutableTask {
  descriptor: ScheduledTask;
  lastRunFrame: number;
  runs: number;
  skips: number;
  failures: number;
}

export interface R25SchedulerOptions {
  readonly frameBudgetMs?: number;
  readonly overrunGraceMs?: number;
  readonly maxRecords?: number;
  readonly clock?: () => number;
  readonly onTaskError?: (task: ScheduledTask, error: unknown) => void;
}

export interface SchedulerFrameOptions {
  readonly deltaMs: number;
  readonly fixedDeltaMs: number;
  readonly simulationTick: number;
  readonly timestampMs?: number;
  readonly budget?: Partial<RuntimeBudget>;
  readonly signal?: AbortSignal;
}

export interface SchedulerFrameResult {
  readonly frame: number;
  readonly budgetUsedMs: number;
  readonly budgetRemainingMs: number;
  readonly records: readonly TaskRunRecord[];
  readonly aborted: boolean;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function idOf(value: string): TaskId {
  const normalized = value.trim();
  if (!normalized) throw new Error('R25_TASK_ID_EMPTY');
  return normalized as TaskId;
}

function phaseRecord(): Record<RuntimePhase, number> {
  return {
    input: 0,
    simulation: 0,
    streaming: 0,
    animation: 0,
    render: 0,
    'post-render': 0,
    telemetry: 0,
  };
}

function sortTasks(a: MutableTask, b: MutableTask): number {
  const priority = b.descriptor.priority - a.descriptor.priority;
  if (priority !== 0) return priority;
  const budget = a.descriptor.budgetMs - b.descriptor.budgetMs;
  if (budget !== 0) return budget;
  return a.descriptor.id.localeCompare(b.descriptor.id);
}

export class R25Scheduler {
  readonly #tasks = new Map<TaskId, MutableTask>();
  readonly #clock: () => number;
  readonly #frameBudgetMs: number;
  readonly #overrunGraceMs: number;
  readonly #maxRecords: number;
  readonly #onTaskError?: (task: ScheduledTask, error: unknown) => void;
  #frame = 0;
  #disposed = false;
  #snapshot: SchedulerSnapshot;

  public constructor(options: R25SchedulerOptions = {}) {
    this.#clock = options.clock ?? (() => globalThis.performance?.now?.() ?? Date.now());
    this.#frameBudgetMs = Math.max(1, finite(options.frameBudgetMs, 16.67));
    this.#overrunGraceMs = Math.max(0, finite(options.overrunGraceMs, 1.5));
    this.#maxRecords = Math.max(16, Math.trunc(finite(options.maxRecords, 256)));
    this.#onTaskError = options.onTaskError;
    this.#snapshot = freeze({
      frame: 0,
      executedTasks: 0,
      skippedTasks: 0,
      failedTasks: 0,
      budgetUsedMs: 0,
      budgetLimitMs: this.#frameBudgetMs,
      phaseUtilization: freeze(phaseRecord()),
      records: freeze([]),
    });
  }

  public get frame(): number {
    return this.#frame;
  }

  public get size(): number {
    return this.#tasks.size;
  }

  public register(task: ScheduledTask): void {
    this.#assertLive();
    this.#validateTask(task);
    this.#tasks.set(task.id, {
      descriptor: freeze({ ...task, id: idOf(String(task.id)) }),
      lastRunFrame: -1,
      runs: 0,
      skips: 0,
      failures: 0,
    });
  }

  public registerMany(tasks: readonly ScheduledTask[]): void {
    for (const task of tasks) this.register(task);
  }

  public unregister(id: TaskId): boolean {
    this.#assertLive();
    return this.#tasks.delete(id);
  }

  public clear(): void {
    this.#assertLive();
    this.#tasks.clear();
  }

  public setEnabled(id: TaskId, enabled: boolean): boolean {
    const entry = this.#tasks.get(id);
    if (!entry) return false;
    entry.descriptor = freeze({ ...entry.descriptor, enabled: Boolean(enabled) });
    return true;
  }

  public setPriority(id: TaskId, priority: number): boolean {
    const entry = this.#tasks.get(id);
    if (!entry) return false;
    entry.descriptor = freeze({
      ...entry.descriptor,
      priority: clamp(finite(priority, entry.descriptor.priority), -1000, 1000),
    });
    return true;
  }

  public setCadence(id: TaskId, cadenceFrames: number): boolean {
    const entry = this.#tasks.get(id);
    if (!entry) return false;
    entry.descriptor = freeze({
      ...entry.descriptor,
      cadenceFrames: Math.max(1, Math.trunc(finite(cadenceFrames, 1))),
    });
    return true;
  }

  public describe(id: TaskId): Readonly<MutableTask> | null {
    const entry = this.#tasks.get(id);
    return entry ? freeze({ ...entry }) : null;
  }

  public async runFrame(options: SchedulerFrameOptions): Promise<SchedulerFrameResult> {
    this.#assertLive();
    this.#frame += 1;
    const timestampMs = finite(options.timestampMs, this.#clock());
    const frameStart = this.#clock();
    const baseBudget = this.#normalizeBudget(options.budget);
    const records: TaskRunRecord[] = [];
    const phaseUtilization = phaseRecord();
    let budgetUsedMs = 0;
    let aborted = false;

    outer:
    for (const phase of PHASES) {
      if (options.signal?.aborted) {
        aborted = true;
        break;
      }

      const tasks = [...this.#tasks.values()]
        .filter((entry) => entry.descriptor.enabled)
        .filter((entry) => entry.descriptor.phase === phase)
        .filter((entry) => this.#shouldRun(entry))
        .sort(sortTasks);

      for (const entry of tasks) {
        if (options.signal?.aborted) {
          aborted = true;
          break outer;
        }

        const mandatory = entry.descriptor.priority >= 100;
        const projected = budgetUsedMs + entry.descriptor.budgetMs;
        const hardLimit = this.#frameBudgetMs + this.#overrunGraceMs;

        if (projected > hardLimit && !mandatory) {
          entry.skips += 1;
          records.push(freeze({
            id: entry.descriptor.id,
            phase,
            startedAtMs: timestampMs,
            elapsedMs: 0,
            skipped: true,
            error: null,
          }));
          continue;
        }

        const startedAtMs = this.#clock();
        const context: RuntimeFrameContext = freeze({
          frame: this.#frame,
          simulationTick: Math.max(0, Math.trunc(finite(options.simulationTick, this.#frame))),
          deltaMs: Math.max(0, finite(options.deltaMs, 0)),
          fixedDeltaMs: Math.max(0, finite(options.fixedDeltaMs, 0)),
          timestampMs,
          phase,
          budget: baseBudget,
          ...(options.signal ? { signal: options.signal } : {}),
        });

        let errorMessage: string | null = null;
        let elapsedMs = 0;

        try {
          await entry.descriptor.run(context);
        } catch (error) {
          entry.failures += 1;
          errorMessage = error instanceof Error ? error.message : String(error);
          this.#onTaskError?.(entry.descriptor, error);
        } finally {
          elapsedMs = Math.max(0, this.#clock() - startedAtMs);
        }

        entry.runs += 1;
        entry.lastRunFrame = this.#frame;
        budgetUsedMs += Math.max(entry.descriptor.budgetMs, elapsedMs);
        phaseUtilization[phase] += elapsedMs;

        records.push(freeze({
          id: entry.descriptor.id,
          phase,
          startedAtMs,
          elapsedMs: Number(elapsedMs.toFixed(4)),
          skipped: false,
          error: errorMessage,
        }));
      }
    }

    const measuredFrameMs = Math.max(0, this.#clock() - frameStart);
    budgetUsedMs = Math.max(budgetUsedMs, measuredFrameMs);

    this.#snapshot = freeze({
      frame: this.#frame,
      executedTasks: records.filter((record) => !record.skipped && !record.error).length,
      skippedTasks: records.filter((record) => record.skipped).length,
      failedTasks: records.filter((record) => Boolean(record.error)).length,
      budgetUsedMs: Number(budgetUsedMs.toFixed(4)),
      budgetLimitMs: this.#frameBudgetMs,
      phaseUtilization: freeze({
        input: Number(phaseUtilization.input.toFixed(4)),
        simulation: Number(phaseUtilization.simulation.toFixed(4)),
        streaming: Number(phaseUtilization.streaming.toFixed(4)),
        animation: Number(phaseUtilization.animation.toFixed(4)),
        render: Number(phaseUtilization.render.toFixed(4)),
        'post-render': Number(phaseUtilization['post-render'].toFixed(4)),
        telemetry: Number(phaseUtilization.telemetry.toFixed(4)),
      }),
      records: freeze(records.slice(-this.#maxRecords)),
    });

    return freeze({
      frame: this.#frame,
      budgetUsedMs: this.#snapshot.budgetUsedMs,
      budgetRemainingMs: Number(Math.max(0, this.#frameBudgetMs - budgetUsedMs).toFixed(4)),
      records: this.#snapshot.records,
      aborted,
    });
  }

  public snapshot(): SchedulerSnapshot {
    return this.#snapshot;
  }

  public stats(): Readonly<Record<string, Readonly<{ runs: number; skips: number; failures: number; lastRunFrame: number }>>> {
    return freeze(Object.fromEntries(
      [...this.#tasks.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, entry]) => [
          id,
          freeze({
            runs: entry.runs,
            skips: entry.skips,
            failures: entry.failures,
            lastRunFrame: entry.lastRunFrame,
          }),
        ]),
    ));
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#tasks.clear();
  }

  #validateTask(task: ScheduledTask): void {
    if (!task.id) throw new Error('R25_TASK_ID_REQUIRED');
    if (!PHASES.includes(task.phase)) throw new Error(`R25_UNKNOWN_PHASE:${task.phase}`);
    if (!Number.isFinite(task.priority)) throw new Error(`R25_INVALID_PRIORITY:${task.id}`);
    if (!Number.isFinite(task.budgetMs) || task.budgetMs < 0) {
      throw new Error(`R25_INVALID_BUDGET:${task.id}`);
    }
    if (!Number.isInteger(task.cadenceFrames) || task.cadenceFrames < 1) {
      throw new Error(`R25_INVALID_CADENCE:${task.id}`);
    }
    if (typeof task.run !== 'function') throw new Error(`R25_TASK_RUNNER_MISSING:${task.id}`);
  }

  #normalizeBudget(input: Partial<RuntimeBudget> | undefined): RuntimeBudget {
    return freeze({
      frameMs: Math.max(1, finite(input?.frameMs, this.#frameBudgetMs)),
      cpuMs: Math.max(0, finite(input?.cpuMs, this.#frameBudgetMs * 0.55)),
      gpuMs: Math.max(0, finite(input?.gpuMs, this.#frameBudgetMs * 0.65)),
      memoryBytes: Math.max(0, finite(input?.memoryBytes, 0)),
      assetBytes: Math.max(0, finite(input?.assetBytes, 0)),
      residentZones: Math.max(0, Math.trunc(finite(input?.residentZones, 0))),
    });
  }

  #shouldRun(entry: MutableTask): boolean {
    if (entry.lastRunFrame < 0) return true;
    return this.#frame - entry.lastRunFrame >= entry.descriptor.cadenceFrames;
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error('R25_SCHEDULER_DISPOSED');
  }
}

export function createR25Task(
  input: Omit<ScheduledTask, 'id'> & { readonly id: string },
): ScheduledTask {
  const id = idOf(input.id);
  return freeze({
    ...input,
    id,
    priority: clamp(finite(input.priority, 0), -1000, 1000),
    budgetMs: Math.max(0, finite(input.budgetMs, 0)),
    cadenceFrames: Math.max(1, Math.trunc(finite(input.cadenceFrames, 1))),
    enabled: input.enabled !== false,
  });
}

export function phaseOrder(): readonly RuntimePhase[] {
  return PHASES;
}

export function estimateTaskPressure(
  task: Pick<ScheduledTask, 'budgetMs' | 'priority' | 'cadenceFrames'>,
): number {
  const cadence = Math.max(1, task.cadenceFrames);
  const priorityFactor = clamp((task.priority + 100) / 200, 0, 2);
  return Number((task.budgetMs * (1 + priorityFactor) / cadence).toFixed(5));
}
