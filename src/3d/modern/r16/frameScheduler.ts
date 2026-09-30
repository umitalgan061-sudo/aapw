import { digestValue, normalizeTick } from './deterministic.js';
import type { R16BudgetClass, R16Result } from './types.js';

export type R16FramePhase =
  | 'input'
  | 'simulation'
  | 'world'
  | 'streaming'
  | 'network'
  | 'render'
  | 'save'
  | 'telemetry';

export interface R16FrameTask {
  readonly id: string;
  readonly phase: R16FramePhase;
  readonly budget: R16BudgetClass;
  readonly units: number;
  readonly priority: number;
  readonly enqueuedTick: number;
  readonly expiresTick: number;
  readonly run: (context: R16FrameContext) => R16Result<unknown>;
}

export interface R16FrameContext {
  readonly tick: number;
  readonly deltaMs: number;
  readonly phase: R16FramePhase;
  readonly budgetUnits: number;
  readonly budgetRemaining: number;
}

export interface R16FramePhaseBudget {
  readonly phase: R16FramePhase;
  readonly units: number;
  readonly milliseconds: number;
  readonly weight: number;
}

export interface R16FrameScheduleResult {
  readonly tick: number;
  readonly executed: readonly string[];
  readonly deferred: readonly string[];
  readonly failed: readonly string[];
  readonly consumedUnits: number;
  readonly elapsedMs: number;
  readonly digest: string;
}

export interface R16FixedStepStats {
  readonly tick: number;
  readonly accumulatedMs: number;
  readonly simulatedMs: number;
  readonly droppedMs: number;
  readonly steps: number;
  readonly alpha: number;
}

const PHASE_ORDER: readonly R16FramePhase[] = Object.freeze([
  'input',
  'simulation',
  'world',
  'streaming',
  'network',
  'render',
  'save',
  'telemetry',
]);

const DEFAULT_PHASE_BUDGETS: readonly R16FramePhaseBudget[] = Object.freeze([
  { phase: 'input', units: 128, milliseconds: 1, weight: 1.2 },
  { phase: 'simulation', units: 1024, milliseconds: 8, weight: 1.4 },
  { phase: 'world', units: 768, milliseconds: 5, weight: 1.1 },
  { phase: 'streaming', units: 512, milliseconds: 3, weight: 0.8 },
  { phase: 'network', units: 384, milliseconds: 2, weight: 0.9 },
  { phase: 'render', units: 1024, milliseconds: 6, weight: 1 },
  { phase: 'save', units: 128, milliseconds: 1, weight: 0.4 },
  { phase: 'telemetry', units: 128, milliseconds: 1, weight: 0.5 },
]);

export class R16FixedStepClock {
  readonly #stepMs: number;
  readonly #maxCatchUpSteps: number;
  readonly #maxDeltaMs: number;
  #accumulatedMs = 0;
  #tick = 0;
  #droppedMs = 0;
  #simulatedMs = 0;
  #steps = 0;

  constructor(
    stepMs = 16.6666666667,
    maxCatchUpSteps = 5,
    maxDeltaMs = 250,
  ) {
    this.#stepMs = Math.max(0.1, stepMs);
    this.#maxCatchUpSteps = Math.max(1, Math.trunc(maxCatchUpSteps));
    this.#maxDeltaMs = Math.max(this.#stepMs, maxDeltaMs);
  }

  advance(realDeltaMs: number): readonly R16ClockStep[] {
    const delta = Math.min(
      this.#maxDeltaMs,
      Math.max(0, Number.isFinite(realDeltaMs) ? realDeltaMs : 0),
    );

    this.#accumulatedMs += delta;

    const steps: R16ClockStep[] = [];

    while (
      this.#accumulatedMs + 0.000001 >= this.#stepMs &&
      steps.length < this.#maxCatchUpSteps
    ) {
      this.#accumulatedMs -= this.#stepMs;
      this.#tick += 1;
      this.#simulatedMs += this.#stepMs;
      this.#steps += 1;

      steps.push(
        Object.freeze({
          tick: this.#tick,
          deltaMs: this.#stepMs,
        }),
      );
    }

    if (this.#accumulatedMs >= this.#stepMs) {
      const keep = this.#stepMs * 0.999;
      const dropped = this.#accumulatedMs - keep;

      this.#droppedMs += Math.max(0, dropped);
      this.#accumulatedMs = Math.min(this.#accumulatedMs, keep);
    }

    return Object.freeze(steps);
  }

  stats(): R16FixedStepStats {
    return Object.freeze({
      tick: this.#tick,
      accumulatedMs: this.#accumulatedMs,
      simulatedMs: this.#simulatedMs,
      droppedMs: this.#droppedMs,
      steps: this.#steps,
      alpha: Math.min(
        1,
        Math.max(0, this.#accumulatedMs / this.#stepMs),
      ),
    });
  }

  get tick(): number {
    return this.#tick;
  }

  get alpha(): number {
    return Math.min(
      1,
      Math.max(0, this.#accumulatedMs / this.#stepMs),
    );
  }

  reset(): void {
    this.#accumulatedMs = 0;
    this.#tick = 0;
    this.#droppedMs = 0;
    this.#simulatedMs = 0;
    this.#steps = 0;
  }
}

export interface R16ClockStep {
  readonly tick: number;
  readonly deltaMs: number;
}

export class R16FrameScheduler {
  readonly #queues = new Map<R16FramePhase, R16FrameTask[]>();
  readonly #budgets = new Map<R16FramePhase, R16FramePhaseBudget>();
  readonly #maxTasksPerPhase: number;
  readonly #history: R16FrameScheduleResult[] = [];

  constructor(
    maxTasksPerPhase = 1024,
    budgets: readonly R16FramePhaseBudget[] = DEFAULT_PHASE_BUDGETS,
  ) {
    this.#maxTasksPerPhase = Math.max(1, Math.trunc(maxTasksPerPhase));

    for (const phase of PHASE_ORDER) {
      this.#queues.set(phase, []);
    }

    for (const budget of budgets) {
      if (this.#queues.has(budget.phase)) {
        this.#budgets.set(
          budget.phase,
          Object.freeze({
            ...budget,
            units: Math.max(1, Math.trunc(budget.units)),
            milliseconds: Math.max(0.1, budget.milliseconds),
            weight: Math.max(0.1, budget.weight),
          }),
        );
      }
    }
  }

  enqueue(task: R16FrameTask): R16Result<void> {
    const queue = this.#queues.get(task.phase);

    if (!queue) {
      return {
        ok: false,
        error: {
          code: 'FRAME_PHASE_INVALID',
          message: 'Frame phase is invalid',
          retryable: false,
        },
      };
    }

    if (
      !task.id ||
      task.id.length > 128 ||
      task.units < 1 ||
      !Number.isFinite(task.units)
    ) {
      return {
        ok: false,
        error: {
          code: 'FRAME_TASK_INVALID',
          message: 'Frame task is malformed',
          retryable: false,
        },
      };
    }

    if (queue.length >= this.#maxTasksPerPhase) {
      return {
        ok: false,
        error: {
          code: 'FRAME_QUEUE_CAP',
          message: 'Frame phase queue reached capacity',
          retryable: true,
        },
      };
    }

    queue.push(
      Object.freeze({
        ...task,
        units: Math.max(1, Math.trunc(task.units)),
        priority: Math.trunc(task.priority),
        enqueuedTick: normalizeTick(task.enqueuedTick),
        expiresTick: normalizeTick(task.expiresTick),
      }),
    );

    return {
      ok: true,
      value: undefined,
    };
  }

  runTick(
    tick: number,
    deltaMs: number,
    now: () => number = () =>
      typeof performance !== 'undefined' ? performance.now() : Date.now(),
  ): readonly R16FrameScheduleResult[] {
    const normalizedTick = normalizeTick(tick);
    const results: R16FrameScheduleResult[] = [];

    for (const phase of PHASE_ORDER) {
      const phaseResult = this.runPhase(
        phase,
        normalizedTick,
        deltaMs,
        now,
      );

      results.push(phaseResult);
    }

    return Object.freeze(results);
  }

  runPhase(
    phase: R16FramePhase,
    tick: number,
    deltaMs: number,
    now: () => number,
  ): R16FrameScheduleResult {
    const queue = this.#queues.get(phase) ?? [];
    const budget =
      this.#budgets.get(phase) ??
      Object.freeze({
        phase,
        units: 128,
        milliseconds: 1,
        weight: 1,
      });

    const normalizedTick = normalizeTick(tick);
    const eligible = queue
      .filter((task) => task.expiresTick >= normalizedTick)
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          left.enqueuedTick - right.enqueuedTick ||
          left.id.localeCompare(right.id),
      );

    queue.length = 0;

    const executed: string[] = [];
    const deferred: string[] = [];
    const failed: string[] = [];
    let consumedUnits = 0;
    const start = now();

    for (const task of eligible) {
      const elapsed = now() - start;
      const unitsAllowed = consumedUnits + task.units <= budget.units;
      const millisecondsAllowed = elapsed <= budget.milliseconds;

      if (!unitsAllowed || !millisecondsAllowed) {
        deferred.push(task.id);
        queue.push(task);
        continue;
      }

      const remaining = Math.max(
        0,
        budget.units - consumedUnits - task.units,
      );

      const context: R16FrameContext = Object.freeze({
        tick: normalizedTick,
        deltaMs: Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0,
        phase,
        budgetUnits: budget.units,
        budgetRemaining: remaining,
      });

      try {
        const result = task.run(context);

        if (result.ok) {
          executed.push(task.id);
          consumedUnits += task.units;
        } else {
          failed.push(task.id);
        }
      } catch {
        failed.push(task.id);
      }
    }

    const elapsedMs = Math.max(0, now() - start);
    const result: R16FrameScheduleResult = Object.freeze({
      tick: normalizedTick,
      executed: Object.freeze(executed),
      deferred: Object.freeze(deferred),
      failed: Object.freeze(failed),
      consumedUnits,
      elapsedMs,
      digest: digestValue({
        phase,
        tick: normalizedTick,
        executed,
        deferred,
        failed,
        consumedUnits,
        elapsedMs,
      }),
    });

    this.#history.push(result);

    if (this.#history.length > 2048) {
      this.#history.shift();
    }

    return result;
  }

  pending(phase?: R16FramePhase): readonly R16FrameTask[] {
    if (phase) {
      return Object.freeze([
        ...(this.#queues.get(phase) ?? []),
      ]);
    }

    return Object.freeze(
      PHASE_ORDER.flatMap((current) => [
        ...(this.#queues.get(current) ?? []),
      ]),
    );
  }

  history(limit = 256): readonly R16FrameScheduleResult[] {
    return Object.freeze(
      this.#history.slice(-Math.max(1, Math.trunc(limit))),
    );
  }

  digest(): string {
    return digestValue(this.#history);
  }

  clear(): void {
    for (const queue of this.#queues.values()) {
      queue.length = 0;
    }

    this.#history.length = 0;
  }
}
