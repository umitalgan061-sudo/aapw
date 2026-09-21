/**
 * AAPW Modern Runtime V3 - application kernel.
 *
 * This module provides a deterministic-friendly application boundary around the
 * modern runtime. It intentionally owns lifecycle, phase ordering, budgets,
 * fault isolation, service registration and frame publication, while remaining
 * renderer/framework agnostic.
 *
 * @module applicationKernelV3
 */

export type KernelPhase =
  | 'boot'
  | 'configure'
  | 'pre-update'
  | 'simulation'
  | 'post-update'
  | 'render'
  | 'present'
  | 'shutdown';

export type KernelState =
  | 'created'
  | 'starting'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'failed';

export type KernelClock = () => number;

export type KernelLogger = {
  debug?: (message: string, data?: Readonly<Record<string, unknown>>) => void;
  info?: (message: string, data?: Readonly<Record<string, unknown>>) => void;
  warn?: (message: string, data?: Readonly<Record<string, unknown>>) => void;
  error?: (message: string, data?: Readonly<Record<string, unknown>>) => void;
};

export type KernelTaskContext = {
  readonly frame: number;
  readonly simulationTick: number;
  readonly elapsedMs: number;
  readonly deltaMs: number;
  readonly phase: KernelPhase;
  readonly signal: AbortSignal;
};

export type KernelTask = {
  readonly id: string;
  readonly phase: KernelPhase;
  readonly priority: number;
  readonly budgetMs: number;
  readonly run: (context: KernelTaskContext) => void | Promise<void>;
  readonly critical?: boolean;
  readonly enabled?: () => boolean;
};

export type KernelTaskResult = {
  readonly id: string;
  readonly phase: KernelPhase;
  readonly durationMs: number;
  readonly budgetMs: number;
  readonly overBudget: boolean;
  readonly status: 'ok' | 'skipped' | 'failed';
  readonly errorMessage?: string;
};

export type KernelFrameReport = {
  readonly frame: number;
  readonly simulationTick: number;
  readonly deltaMs: number;
  readonly elapsedMs: number;
  readonly state: KernelState;
  readonly phaseResults: Readonly<Record<KernelPhase, readonly KernelTaskResult[]>>;
  readonly failedTaskIds: readonly string[];
  readonly overBudgetTaskIds: readonly string[];
  readonly durationMs: number;
};

export type KernelSnapshot = {
  readonly state: KernelState;
  readonly frame: number;
  readonly simulationTick: number;
  readonly elapsedMs: number;
  readonly taskCount: number;
  readonly serviceCount: number;
  readonly lastFrame?: KernelFrameReport;
};

export type KernelService<T = unknown> = {
  readonly id: string;
  readonly value: T;
  readonly start?: (context: KernelTaskContext) => void | Promise<void>;
  readonly stop?: (context: KernelTaskContext) => void | Promise<void>;
};

export type KernelOptions = {
  readonly fixedStepMs?: number;
  readonly maxFrameDeltaMs?: number;
  readonly maxCatchUpSteps?: number;
  readonly clock?: KernelClock;
  readonly logger?: KernelLogger;
  readonly frameBudgetMs?: number;
  readonly strictTaskFailures?: boolean;
};

type InternalTask = KernelTask & {
  order: number;
};

type EventName =
  | 'state'
  | 'phase'
  | 'task'
  | 'frame'
  | 'error';

type KernelEventMap = {
  state: (state: KernelState) => void;
  phase: (phase: KernelPhase, context: KernelTaskContext) => void;
  task: (result: KernelTaskResult) => void;
  frame: (report: KernelFrameReport) => void;
  error: (error: Error, task?: KernelTask) => void;
};

const PHASE_ORDER: readonly KernelPhase[] = [
  'boot',
  'configure',
  'pre-update',
  'simulation',
  'post-update',
  'render',
  'present',
  'shutdown',
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function createError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error(typeof value === 'string' ? value : 'Unknown kernel task failure');
}

export class ApplicationKernelV3 {
  readonly #tasks = new Map<string, InternalTask>();
  readonly #services = new Map<string, KernelService>();
  readonly #listeners = new Map<EventName, Set<(...args: never[]) => void>>();
  readonly #controller = new AbortController();
  readonly #clock: KernelClock;
  readonly #logger: KernelLogger;
  readonly #fixedStepMs: number;
  readonly #maxFrameDeltaMs: number;
  readonly #maxCatchUpSteps: number;
  readonly #frameBudgetMs: number;
  readonly #strictTaskFailures: boolean;

  #state: KernelState = 'created';
  #frame = 0;
  #simulationTick = 0;
  #elapsedMs = 0;
  #accumulatorMs = 0;
  #lastTimeMs: number | null = null;
  #taskOrder = 0;
  #lastFrame: KernelFrameReport | undefined;
  #startedAtMs: number | null = null;

  constructor(options: KernelOptions = {}) {
    this.#clock = options.clock ?? (() => performance.now());
    this.#logger = options.logger ?? {};
    this.#fixedStepMs = clamp(safeNumber(options.fixedStepMs ?? 1000 / 60), 1, 1000);
    this.#maxFrameDeltaMs = clamp(safeNumber(options.maxFrameDeltaMs ?? 250), this.#fixedStepMs, 5000);
    this.#maxCatchUpSteps = clamp(Math.floor(safeNumber(options.maxCatchUpSteps ?? 5)), 1, 30);
    this.#frameBudgetMs = clamp(safeNumber(options.frameBudgetMs ?? 16.67), 0.25, 1000);
    this.#strictTaskFailures = options.strictTaskFailures ?? true;
  }

  get state(): KernelState {
    return this.#state;
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  get frame(): number {
    return this.#frame;
  }

  get simulationTick(): number {
    return this.#simulationTick;
  }

  get elapsedMs(): number {
    return this.#elapsedMs;
  }

  get fixedStepMs(): number {
    return this.#fixedStepMs;
  }

  registerTask(task: KernelTask): () => void {
    if (!task.id.trim()) {
      throw new Error('Kernel task id must not be empty');
    }
    if (this.#tasks.has(task.id)) {
      throw new Error(`Kernel task already registered: ${task.id}`);
    }
    if (!PHASE_ORDER.includes(task.phase)) {
      throw new Error(`Unsupported kernel phase: ${task.phase}`);
    }

    const internal: InternalTask = {
      ...task,
      order: this.#taskOrder++,
      priority: Number.isFinite(task.priority) ? task.priority : 0,
      budgetMs: clamp(safeNumber(task.budgetMs, this.#frameBudgetMs), 0.01, this.#frameBudgetMs * 8),
    };

    this.#tasks.set(task.id, internal);

    return () => {
      if (this.#tasks.get(task.id) === internal) {
        this.#tasks.delete(task.id);
      }
    };
  }

  registerService<T>(service: KernelService<T>): () => void {
    if (!service.id.trim()) {
      throw new Error('Kernel service id must not be empty');
    }
    if (this.#services.has(service.id)) {
      throw new Error(`Kernel service already registered: ${service.id}`);
    }
    this.#services.set(service.id, service);
    return () => {
      if (this.#services.get(service.id) === service) {
        this.#services.delete(service.id);
      }
    };
  }

  resolveService<T>(id: string): T {
    const service = this.#services.get(id);
    if (!service) {
      throw new Error(`Kernel service not found: ${id}`);
    }
    return service.value as T;
  }

  hasService(id: string): boolean {
    return this.#services.has(id);
  }

  on<E extends EventName>(event: E, listener: KernelEventMap[E]): () => void {
    let listeners = this.#listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(event, listeners);
    }
    const typed = listener as (...args: never[]) => void;
    listeners.add(typed);
    return () => {
      listeners.delete(typed);
      if (listeners.size === 0) {
        this.#listeners.delete(event);
      }
    };
  }

  #emit<E extends EventName>(
    event: E,
    ...args: Parameters<KernelEventMap[E]>
  ): void {
    const listeners = this.#listeners.get(event);
    if (!listeners) {
      return;
    }
    for (const listener of [...listeners]) {
      try {
        listener(...(args as never[]));
      } catch (error) {
        this.#logger.warn?.('[ApplicationKernelV3] event listener failed', {
          event,
          error: createError(error).message,
        });
      }
    }
  }

  #transition(next: KernelState): void {
    if (this.#state === next) {
      return;
    }
    this.#state = next;
    this.#emit('state', next);
  }

  #makeContext(
    phase: KernelPhase,
    deltaMs: number,
    elapsedMs = this.#elapsedMs,
  ): KernelTaskContext {
    return {
      frame: this.#frame,
      simulationTick: this.#simulationTick,
      elapsedMs,
      deltaMs,
      phase,
      signal: this.#controller.signal,
    };
  }

  #tasksForPhase(phase: KernelPhase): InternalTask[] {
    return [...this.#tasks.values()]
      .filter((task) => task.phase === phase)
      .sort((a, b) => b.priority - a.priority || a.order - b.order);
  }

  async start(): Promise<void> {
    if (this.#state === 'running') {
      return;
    }
    if (this.#state !== 'created' && this.#state !== 'stopped') {
      throw new Error(`Kernel cannot start from state ${this.#state}`);
    }
    if (this.#controller.signal.aborted) {
      throw new Error('Kernel signal already aborted');
    }

    this.#transition('starting');
    this.#startedAtMs = this.#clock();
    this.#lastTimeMs = this.#startedAtMs;

    try {
      const context = this.#makeContext('boot', 0);
      for (const service of this.#services.values()) {
        if (service.start) {
          await service.start(context);
        }
      }
      await this.#runPhase('boot', context);
      await this.#runPhase('configure', context);
      this.#transition('running');
    } catch (error) {
      const normalized = createError(error);
      this.#transition('failed');
      this.#emit('error', normalized);
      throw normalized;
    }
  }

  pause(): void {
    if (this.#state === 'running') {
      this.#transition('paused');
    }
  }

  resume(): void {
    if (this.#state === 'paused') {
      this.#lastTimeMs = this.#clock();
      this.#transition('running');
    }
  }

  async stop(): Promise<void> {
    if (this.#state === 'stopped' || this.#state === 'created') {
      this.#transition('stopped');
      return;
    }

    if (this.#state === 'stopping') {
      return;
    }

    this.#transition('stopping');
    const context = this.#makeContext('shutdown', 0);

    try {
      this.#controller.abort();
      await this.#runPhase('shutdown', context, true);
      const services = [...this.#services.values()].reverse();
      for (const service of services) {
        if (service.stop) {
          await service.stop(context);
        }
      }
      this.#transition('stopped');
    } catch (error) {
      const normalized = createError(error);
      this.#transition('failed');
      this.#emit('error', normalized);
      throw normalized;
    }
  }

  async tick(nowMs = this.#clock()): Promise<KernelFrameReport | undefined> {
    if (this.#state === 'created') {
      await this.start();
    }
    if (this.#state !== 'running') {
      return this.#lastFrame;
    }

    const previous = this.#lastTimeMs ?? nowMs;
    const rawDelta = Math.max(0, nowMs - previous);
    const deltaMs = clamp(safeNumber(rawDelta), 0, this.#maxFrameDeltaMs);
    this.#lastTimeMs = nowMs;
    this.#elapsedMs += deltaMs;
    this.#frame += 1;
    this.#accumulatorMs += deltaMs;

    const frameStart = this.#clock();
    const phaseResults: Partial<Record<KernelPhase, KernelTaskResult[]>> = {};
    const failedTaskIds: string[] = [];
    const overBudgetTaskIds: string[] = [];

    for (const phase of PHASE_ORDER) {
      if (phase === 'boot' || phase === 'configure' || phase === 'shutdown') {
        continue;
      }

      if (this.#state !== 'running') {
        break;
      }

      if (phase === 'simulation') {
        let steps = 0;
        while (this.#accumulatorMs >= this.#fixedStepMs && steps < this.#maxCatchUpSteps) {
          this.#simulationTick += 1;
          const context = this.#makeContext(
            'simulation',
            this.#fixedStepMs,
            this.#simulationTick * this.#fixedStepMs,
          );
          const results = await this.#runPhase(
            'simulation',
            context,
            false,
            failedTaskIds,
            overBudgetTaskIds,
          );
          phaseResults.simulation = [
            ...(phaseResults.simulation ?? []),
            ...results,
          ];
          this.#accumulatorMs -= this.#fixedStepMs;
          steps += 1;
        }

        if (steps === this.#maxCatchUpSteps && this.#accumulatorMs >= this.#fixedStepMs) {
          this.#accumulatorMs = 0;
          this.#logger.warn?.('[ApplicationKernelV3] simulation catch-up guard engaged', {
            frame: this.#frame,
            deltaMs,
          });
        }
        continue;
      }

      const context = this.#makeContext(phase, deltaMs);
      phaseResults[phase] = await this.#runPhase(
        phase,
        context,
        false,
        failedTaskIds,
        overBudgetTaskIds,
      );
    }

    const durationMs = Math.max(0, this.#clock() - frameStart);
    const report: KernelFrameReport = {
      frame: this.#frame,
      simulationTick: this.#simulationTick,
      deltaMs,
      elapsedMs: this.#elapsedMs,
      state: this.#state,
      phaseResults: phaseResults as Record<KernelPhase, readonly KernelTaskResult[]>,
      failedTaskIds,
      overBudgetTaskIds,
      durationMs,
    };

    this.#lastFrame = report;
    this.#emit('frame', report);

    if (durationMs > this.#frameBudgetMs) {
      this.#logger.warn?.('[ApplicationKernelV3] frame budget exceeded', {
        frame: this.#frame,
        durationMs,
        budgetMs: this.#frameBudgetMs,
      });
    }

    return report;
  }

  async #runPhase(
    phase: KernelPhase,
    context: KernelTaskContext,
    allowStopping = false,
    failedTaskIds: string[] = [],
    overBudgetTaskIds: string[] = [],
  ): Promise<KernelTaskResult[]> {
    if (!allowStopping && this.#state !== 'running' && phase !== 'boot' && phase !== 'configure') {
      return [];
    }

    this.#emit('phase', phase, context);
    const tasks = this.#tasksForPhase(phase);
    const results: KernelTaskResult[] = [];

    for (const task of tasks) {
      if (this.#controller.signal.aborted && !allowStopping && phase !== 'shutdown') {
        break;
      }

      if (task.enabled && !task.enabled()) {
        const skipped: KernelTaskResult = {
          id: task.id,
          phase,
          durationMs: 0,
          budgetMs: task.budgetMs,
          overBudget: false,
          status: 'skipped',
        };
        results.push(skipped);
        this.#emit('task', skipped);
        continue;
      }

      const start = this.#clock();
      let status: KernelTaskResult['status'] = 'ok';
      let errorMessage: string | undefined;

      try {
        await task.run(context);
      } catch (error) {
        const normalized = createError(error);
        status = 'failed';
        errorMessage = normalized.message;
        failedTaskIds.push(task.id);
        this.#emit('error', normalized, task);
        this.#logger.error?.('[ApplicationKernelV3] task failed', {
          id: task.id,
          phase,
          message: normalized.message,
        });

        if (task.critical || this.#strictTaskFailures) {
          this.#transition('failed');
          if (this.#strictTaskFailures || task.critical) {
            throw normalized;
          }
        }
      }

      const durationMs = Math.max(0, this.#clock() - start);
      const overBudget = durationMs > task.budgetMs;
      if (overBudget) {
        overBudgetTaskIds.push(task.id);
      }

      const result: KernelTaskResult = {
        id: task.id,
        phase,
        durationMs,
        budgetMs: task.budgetMs,
        overBudget,
        status,
        ...(errorMessage ? { errorMessage } : {}),
      };
      results.push(result);
      this.#emit('task', result);
    }

    return results;
  }

  snapshot(): KernelSnapshot {
    return {
      state: this.#state,
      frame: this.#frame,
      simulationTick: this.#simulationTick,
      elapsedMs: this.#elapsedMs,
      taskCount: this.#tasks.size,
      serviceCount: this.#services.size,
      ...(this.#lastFrame ? { lastFrame: this.#lastFrame } : {}),
    };
  }

  resetFrameClock(): void {
    this.#lastTimeMs = this.#clock();
    this.#accumulatorMs = 0;
  }

  clearTaskFailures(): void {
    if (this.#state === 'failed') {
      this.#transition('stopped');
    }
    this.resetFrameClock();
  }

  inspectTasks(): readonly KernelTask[] {
    return [...this.#tasks.values()]
      .sort((a, b) => a.order - b.order)
      .map(({ order: _order, ...task }) => task);
  }

  inspectServices(): readonly string[] {
    return [...this.#services.keys()].sort();
  }

  get health(): 'healthy' | 'degraded' | 'failed' {
    if (this.#state === 'failed') {
      return 'failed';
    }
    const report = this.#lastFrame;
    if (!report) {
      return this.#state === 'running' ? 'healthy' : 'degraded';
    }
    if (report.failedTaskIds.length > 0) {
      return 'failed';
    }
    if (report.overBudgetTaskIds.length > 0 || report.durationMs > this.#frameBudgetMs) {
      return 'degraded';
    }
    return 'healthy';
  }

  dispose(): void {
    this.#tasks.clear();
    this.#services.clear();
    this.#listeners.clear();
  }
}

export function createKernel(options: KernelOptions = {}): ApplicationKernelV3 {
  return new ApplicationKernelV3(options);
}

export function createFixedStepClock(fixedStepMs: number): {
  readonly stepMs: number;
  tick(deltaMs: number): number;
  reset(): void;
} {
  const stepMs = clamp(safeNumber(fixedStepMs, 1000 / 60), 1, 1000);
  let accumulator = 0;

  return {
    stepMs,
    tick(deltaMs: number): number {
      accumulator += clamp(safeNumber(deltaMs), 0, stepMs * 32);
      const steps = Math.floor(accumulator / stepMs);
      accumulator -= steps * stepMs;
      return steps;
    },
    reset(): void {
      accumulator = 0;
    },
  };
}

export function orderKernelPhases(phases: readonly KernelPhase[]): KernelPhase[] {
  const seen = new Set<KernelPhase>();
  return phases
    .filter((phase) => {
      if (seen.has(phase)) {
        return false;
      }
      seen.add(phase);
      return true;
    })
    .sort((a, b) => PHASE_ORDER.indexOf(a) - PHASE_ORDER.indexOf(b));
}
