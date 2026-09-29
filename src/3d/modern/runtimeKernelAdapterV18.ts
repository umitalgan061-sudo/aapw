/**
 * Renderer- and legacy-engine-agnostic kernel contract for Runtime V18.
 *
 * The default implementation is intentionally small and deterministic. Production
 * integrations can provide an adapter around the existing ApplicationKernelV3
 * without making the V18 compile graph depend on the legacy implementation tree.
 */

export type KernelPhaseV18 =
  | 'pre-update'
  | 'simulation'
  | 'render'
  | 'present';

export interface KernelTaskContextV18 {
  readonly frame: number;
  readonly simulationTick: number;
  readonly phase: KernelPhaseV18;
}

export interface KernelTaskV18 {
  readonly id: string;
  readonly phase: KernelPhaseV18;
  readonly priority: number;
  readonly budgetMs: number;
  readonly critical?: boolean;
  readonly run: (context: KernelTaskContextV18) => void | Promise<void>;
}

export interface KernelFrameReportV18 {
  readonly frame: number;
  readonly simulationTick: number;
  readonly timestampMs: number;
  readonly durationMs: number;
  readonly executedTasks: number;
  readonly skippedTasks: number;
  readonly failedTasks: number;
}

export interface KernelSnapshotV18 {
  readonly version: 18;
  readonly state: 'created' | 'running' | 'paused' | 'stopped';
  readonly frame: number;
  readonly simulationTick: number;
  readonly taskCount: number;
}

export interface RuntimeKernelOptionsV18 {
  readonly clock?: () => number;
  readonly fixedStepMs?: number;
  readonly maxFrameDeltaMs?: number;
  readonly maxCatchUpSteps?: number;
  readonly frameBudgetMs?: number;
}

export interface RuntimeKernelAdapterV18 {
  readonly frame: number;
  readonly simulationTick: number;
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  tick(nowMs: number): Promise<KernelFrameReportV18>;
  stop(): Promise<void>;
  registerTask(task: KernelTaskV18): void;
  snapshot(): KernelSnapshotV18;
}

const PHASES: readonly KernelPhaseV18[] = [
  'pre-update',
  'simulation',
  'render',
  'present',
];

export class DeterministicKernelV18 implements RuntimeKernelAdapterV18 {
  readonly #clock: () => number;
  readonly #fixedStepMs: number;
  readonly #maxFrameDeltaMs: number;
  readonly #maxCatchUpSteps: number;
  readonly #frameBudgetMs: number;
  #state: KernelSnapshotV18['state'] = 'created';
  #frame = 0;
  #simulationTick = 0;
  #lastTimestampMs = 0;
  #tasks: KernelTaskV18[] = [];

  public constructor(options: RuntimeKernelOptionsV18 = {}) {
    this.#clock = options.clock ?? (() => performance.now());
    this.#fixedStepMs = Math.max(0.1, options.fixedStepMs ?? 1000 / 60);
    this.#maxFrameDeltaMs = Math.max(this.#fixedStepMs, options.maxFrameDeltaMs ?? 250);
    this.#maxCatchUpSteps = Math.max(1, Math.trunc(options.maxCatchUpSteps ?? 6));
    this.#frameBudgetMs = Math.max(0.1, options.frameBudgetMs ?? 16.67);
  }

  public get frame(): number { return this.#frame; }
  public get simulationTick(): number { return this.#simulationTick; }

  public async start(): Promise<void> {
    if (this.#state === 'stopped') throw new Error('V18 kernel cannot restart after stop');
    if (this.#state === 'running') return;
    this.#state = 'running';
    this.#lastTimestampMs = this.#clock();
  }

  public pause(): void {
    if (this.#state === 'running') this.#state = 'paused';
  }

  public resume(): void {
    if (this.#state === 'paused') {
      this.#state = 'running';
      this.#lastTimestampMs = this.#clock();
    }
  }

  public async tick(nowMs: number): Promise<KernelFrameReportV18> {
    if (this.#state !== 'running') {
      return Object.freeze({
        frame: this.#frame,
        simulationTick: this.#simulationTick,
        timestampMs: nowMs,
        durationMs: 0,
        executedTasks: 0,
        skippedTasks: 0,
        failedTasks: 0,
      });
    }

    const safeNow = Number.isFinite(nowMs) ? nowMs : this.#clock();
    const elapsed = Math.max(0, Math.min(this.#maxFrameDeltaMs, safeNow - this.#lastTimestampMs));
    const steps = Math.max(1, Math.min(this.#maxCatchUpSteps, Math.ceil(elapsed / this.#fixedStepMs)));
    this.#lastTimestampMs = safeNow;

    let executedTasks = 0;
    let skippedTasks = 0;
    let failedTasks = 0;

    for (let step = 0; step < steps; step += 1) {
      this.#frame += 1;
      this.#simulationTick += 1;

      for (const phase of PHASES) {
        const tasks = this.#tasks
          .filter((task) => task.phase === phase)
          .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

        for (const task of tasks) {
          if (task.budgetMs > this.#frameBudgetMs && !task.critical) {
            skippedTasks += 1;
            continue;
          }
          try {
            await task.run({
              frame: this.#frame,
              simulationTick: this.#simulationTick,
              phase,
            });
            executedTasks += 1;
          } catch (error) {
            failedTasks += 1;
            if (task.critical) throw error;
          }
        }
      }
    }

    return Object.freeze({
      frame: this.#frame,
      simulationTick: this.#simulationTick,
      timestampMs: safeNow,
      durationMs: elapsed,
      executedTasks,
      skippedTasks,
      failedTasks,
    });
  }

  public async stop(): Promise<void> {
    if (this.#state === 'stopped') return;
    this.#state = 'stopped';
    this.#tasks = [];
  }

  public registerTask(task: KernelTaskV18): void {
    if (!task.id.trim()) throw new TypeError('V18 kernel task id is required');
    if (!Number.isFinite(task.priority) || !Number.isFinite(task.budgetMs)) {
      throw new TypeError('V18 kernel task priority/budget must be finite');
    }
    const existing = this.#tasks.findIndex((entry) => entry.id === task.id);
    if (existing >= 0) this.#tasks[existing] = task;
    else this.#tasks.push(task);
  }

  public snapshot(): KernelSnapshotV18 {
    return Object.freeze({
      version: 18,
      state: this.#state,
      frame: this.#frame,
      simulationTick: this.#simulationTick,
      taskCount: this.#tasks.length,
    });
  }
}