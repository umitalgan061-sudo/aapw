/**
 * Bounded deterministic work scheduler.
 *
 * Work is charged in logical cost units rather than elapsed milliseconds. A host
 * can convert a frame budget into units and call drain() at a stable point in the
 * frame. Callbacks are synchronous by design: asynchronous completions must be
 * returned to the scheduler as a new event/task to preserve ordering.
 */
import {
  R44BoundaryError,
  R44InvariantError,
  type R44Failure,
  type R44JsonValue,
  type R44TaskLane,
  type R44TaskState,
  r44FiniteInteger,
  r44NormalizeId,
  r44NormalizeLabel,
  r44ToFailure,
} from "./contracts.js";

export interface R44TaskSpec<T = unknown> {
  readonly key: string;
  readonly owner: string;
  readonly lane: R44TaskLane;
  readonly priority?: number;
  readonly costUnits?: number;
  readonly createdTick: number;
  readonly expiresAtTick?: number;
  readonly dedupeKey?: string;
  readonly run: () => T;
  readonly onSettled?: (result: R44TaskResult<T>) => void;
}

export interface R44TaskResult<T = unknown> {
  readonly id: string;
  readonly state: R44TaskState;
  readonly value?: T;
  readonly failure?: R44Failure;
  readonly startedTick: number | null;
  readonly finishedTick: number | null;
  readonly chargedUnits: number;
}

export interface R44TaskSchedulerOptions {
  readonly capacity?: number;
  readonly maxCostUnitsPerDrain?: number;
  readonly interactiveShare?: number;
  readonly simulationShare?: number;
  readonly streamingShare?: number;
  readonly backgroundShare?: number;
  readonly agingPerTick?: number;
  readonly maxPriority?: number;
  readonly terminalHistoryCapacity?: number;
}

export interface R44DrainReport {
  readonly tick: number;
  readonly executed: number;
  readonly failed: number;
  readonly expired: number;
  readonly cancelled: number;
  readonly deferred: number;
  readonly chargedUnits: number;
  readonly remainingQueue: number;
  readonly remainingBudgetUnits: number;
  readonly laneCounts: Readonly<Record<R44TaskLane, number>>;
}

interface R44QueuedTask<T = unknown> {
  readonly id: string;
  readonly spec: R44TaskSpec<T>;
  readonly priority: number;
  readonly costUnits: number;
  readonly dedupeKey: string | null;
  readonly insertionOrder: number;
  state: R44TaskState;
  startedTick: number | null;
  finishedTick: number | null;
  chargedUnits: number;
  result?: T;
  failure?: R44Failure;
}

const R44_LANES: readonly R44TaskLane[] = Object.freeze(["interactive", "simulation", "streaming", "background"]);
const R44_DEFAULT_SHARES: Record<R44TaskLane, number> = {
  interactive: 0.45,
  simulation: 0.3,
  streaming: 0.2,
  background: 0.05,
};

export class R44TaskScheduler {
  readonly #capacity: number;
  readonly #maxCostUnitsPerDrain: number;
  readonly #shares: Record<R44TaskLane, number>;
  readonly #agingPerTick: number;
  readonly #maxPriority: number;
  readonly #historyCapacity: number;
  readonly #queue = new Map<string, R44QueuedTask>();
  readonly #dedupe = new Map<string, string>();
  readonly #history: R44TaskResult[] = [];
  readonly #laneCredits: Record<R44TaskLane, number> = { ...R44_DEFAULT_SHARES };
  #tick = 0;
  #sequence = 0;
  #insertionOrder = 0;
  #executing = false;
  #stats = { submitted: 0, executed: 0, failed: 0, cancelled: 0, expired: 0, rejected: 0 };

  constructor(options: R44TaskSchedulerOptions = {}) {
    this.#capacity = r44FiniteInteger(options.capacity ?? 10_000, "capacity", 1, 1_000_000);
    this.#maxCostUnitsPerDrain = r44FiniteInteger(options.maxCostUnitsPerDrain ?? 1000, "maxCostUnitsPerDrain", 1, 100_000_000);
    this.#shares = Object.freeze({
      interactive: options.interactiveShare ?? R44_DEFAULT_SHARES.interactive,
      simulation: options.simulationShare ?? R44_DEFAULT_SHARES.simulation,
      streaming: options.streamingShare ?? R44_DEFAULT_SHARES.streaming,
      background: options.backgroundShare ?? R44_DEFAULT_SHARES.background,
    }) as Record<R44TaskLane, number>;
    const shareSum = R44_LANES.reduce((sum, lane) => sum + this.#shares[lane], 0);
    if (R44_LANES.some((lane) => !Number.isFinite(this.#shares[lane]) || this.#shares[lane] < 0) || shareSum <= 0) {
      throw new R44BoundaryError("lane-shares", "Lane shares must be non-negative and have a positive total");
    }
    this.#agingPerTick = options.agingPerTick ?? 0.25;
    if (!Number.isFinite(this.#agingPerTick) || this.#agingPerTick < 0 || this.#agingPerTick > 100) {
      throw new R44BoundaryError("aging-rate", "agingPerTick must be in [0, 100]");
    }
    this.#maxPriority = r44FiniteInteger(options.maxPriority ?? 100, "maxPriority", 1, 10_000);
    this.#historyCapacity = r44FiniteInteger(options.terminalHistoryCapacity ?? 2048, "terminalHistoryCapacity", 1, 100_000);
    for (const lane of R44_LANES) this.#laneCredits[lane] = this.#shares[lane] / shareSum;
  }

  get size(): number { return this.#queue.size; }
  get tick(): number { return this.#tick; }

  submit<T>(spec: R44TaskSpec<T>): Readonly<{ id: string; deduplicated: boolean }> {
    if (this.#queue.size >= this.#capacity) {
      this.#stats.rejected += 1;
      throw new R44BoundaryError("scheduler-capacity", "Task queue capacity exceeded");
    }
    const key = r44NormalizeId(spec.key, "task key", 160);
    const owner = r44NormalizeId(spec.owner, "task owner", 128);
    const createdTick = r44FiniteInteger(spec.createdTick, "createdTick", 0);
    const lane = spec.lane;
    if (!R44_LANES.includes(lane)) throw new R44BoundaryError("task-lane", "Unknown task lane");
    const dedupeKey = spec.dedupeKey === undefined ? null : r44NormalizeId(spec.dedupeKey, "dedupeKey", 192);
    if (dedupeKey !== null) {
      const previousId = this.#dedupe.get(dedupeKey);
      if (previousId !== undefined && this.#queue.has(previousId)) {
        return Object.freeze({ id: previousId, deduplicated: true });
      }
    }
    const priority = r44FiniteInteger(spec.priority ?? 50, "priority", 0, this.#maxPriority);
    const costUnits = r44FiniteInteger(spec.costUnits ?? 1, "costUnits", 1, this.#maxCostUnitsPerDrain);
    const expiresAtTick = spec.expiresAtTick;
    if (expiresAtTick !== undefined && r44FiniteInteger(expiresAtTick, "expiresAtTick", createdTick) < createdTick) {
      throw new R44BoundaryError("task-expiration", "Task expiry precedes creation");
    }
    if (typeof spec.run !== "function") throw new R44BoundaryError("task-callback", "Task callback must be a function");
    const id = "task-" + (++this.#sequence).toString(36);
    const normalizedSpec: R44TaskSpec<T> = Object.freeze({
      ...spec,
      key,
      owner,
      createdTick,
      priority,
      costUnits,
      lane,
      ...(dedupeKey === null ? {} : { dedupeKey }),
    });
    const task: R44QueuedTask<T> = {
      id,
      spec: normalizedSpec,
      priority,
      costUnits,
      dedupeKey,
      insertionOrder: this.#insertionOrder++,
      state: "queued",
      startedTick: null,
      finishedTick: null,
      chargedUnits: 0,
    };
    this.#queue.set(id, task as R44QueuedTask);
    if (dedupeKey !== null) this.#dedupe.set(dedupeKey, id);
    this.#stats.submitted += 1;
    return Object.freeze({ id, deduplicated: false });
  }

  cancel(idInput: string, tickInput = this.#tick): boolean {
    const id = r44NormalizeId(idInput, "task id", 96);
    const tick = r44FiniteInteger(tickInput, "tick", this.#tick);
    const task = this.#queue.get(id);
    if (task === undefined || task.state !== "queued") return false;
    this.#finish(task, "cancelled", tick);
    this.#stats.cancelled += 1;
    return true;
  }

  cancelOwner(ownerInput: string, tickInput = this.#tick): number {
    const owner = r44NormalizeId(ownerInput, "owner", 128);
    const tick = r44FiniteInteger(tickInput, "tick", this.#tick);
    let cancelled = 0;
    for (const task of [...this.#queue.values()]) {
      if (task.state === "queued" && task.spec.owner === owner) {
        this.#finish(task, "cancelled", tick);
        this.#stats.cancelled += 1;
        cancelled += 1;
      }
    }
    return cancelled;
  }

  cancelAll(tickInput = this.#tick): number {
    const tick = r44FiniteInteger(tickInput, "tick", this.#tick);
    let cancelled = 0;
    for (const task of [...this.#queue.values()]) {
      if (task.state === "queued") {
        this.#finish(task, "cancelled", tick);
        this.#stats.cancelled += 1;
        cancelled += 1;
      }
    }
    return cancelled;
  }

  drain(input: { tick: number; budgetUnits?: number; maxTasks?: number } ): R44DrainReport {
    if (this.#executing) throw new R44InvariantError("scheduler-reentrant", "Scheduler drain cannot be re-entered");
    const tick = r44FiniteInteger(input.tick, "tick", this.#tick);
    this.#tick = tick;
    let budget = r44FiniteInteger(input.budgetUnits ?? this.#maxCostUnitsPerDrain, "budgetUnits", 0, this.#maxCostUnitsPerDrain);
    const maxTasks = r44FiniteInteger(input.maxTasks ?? Number.MAX_SAFE_INTEGER, "maxTasks", 0);
    let executed = 0;
    let failed = 0;
    let expired = 0;
    let cancelled = 0;
    let chargedUnits = 0;
    const expiredBefore = this.#stats.expired;
    const cancelledBefore = this.#stats.cancelled;
    const laneCounts: Record<R44TaskLane, number> = { interactive: 0, simulation: 0, streaming: 0, background: 0 };
    this.#executing = true;
    try {
      this.#expireTasks(tick);
      while (executed + failed < maxTasks && budget > 0) {
        const task = this.#select(tick, budget);
        if (task === null) break;
        task.state = "running";
        task.startedTick = tick;
        task.chargedUnits = task.costUnits;
        budget -= task.costUnits;
        chargedUnits += task.costUnits;
        laneCounts[task.spec.lane] += 1;
        try {
          task.result = task.spec.run();
          this.#finish(task, "succeeded", tick);
          executed += 1;
          this.#stats.executed += 1;
        } catch (error) {
          task.failure = r44ToFailure(error, "task-failed");
          this.#finish(task, "failed", tick);
          failed += 1;
          this.#stats.failed += 1;
        }
      }
    } finally {
      this.#executing = false;
    }
    const deferred = [...this.#queue.values()].filter((task) => task.state === "queued").length;
    expired = this.#stats.expired - expiredBefore;
    cancelled = this.#stats.cancelled - cancelledBefore;
    return Object.freeze({
      tick,
      executed,
      failed,
      expired,
      cancelled,
      deferred,
      chargedUnits,
      remainingQueue: this.#queue.size,
      remainingBudgetUnits: budget,
      laneCounts: Object.freeze(laneCounts),
    });
  }

  get(idInput: string): R44TaskResult | null {
    const id = r44NormalizeId(idInput, "task id", 96);
    const task = this.#queue.get(id);
    if (task === undefined) return this.#history.find((item) => item.id === id) ?? null;
    return this.#result(task);
  }

  history(limit = 256): readonly R44TaskResult[] {
    const count = r44FiniteInteger(limit, "limit", 1, this.#historyCapacity);
    return Object.freeze(this.#history.slice(-count));
  }

  queueSnapshot(): readonly Readonly<Record<string, R44JsonValue>>[] {
    return Object.freeze([...this.#queue.values()]
      .filter((task) => task.state === "queued")
      .map((task) => Object.freeze({
        id: task.id,
        key: task.spec.key,
        owner: task.spec.owner,
        lane: task.spec.lane,
        priority: task.priority,
        costUnits: task.costUnits,
        createdTick: task.spec.createdTick,
        effectivePriority: this.#effectivePriority(task, this.#tick),
        dedupeKey: task.dedupeKey,
      })));
  }

  stats(): Readonly<Record<string, number>> {
    const queued = [...this.#queue.values()].filter((task) => task.state === "queued").length;
    return Object.freeze({ ...this.#stats, queued, retainedHistory: this.#history.length, capacity: this.#capacity });
  }

  #expireTasks(tick: number): void {
    for (const task of this.#queue.values()) {
      const expiry = task.spec.expiresAtTick;
      if (task.state === "queued" && expiry !== undefined && tick > expiry) {
        this.#finish(task, "expired", tick);
        this.#stats.expired += 1;
      }
    }
  }

  #select(tick: number, budget: number): R44QueuedTask | null {
    const candidates = [...this.#queue.values()].filter((task) => task.state === "queued" && task.costUnits <= budget);
    if (candidates.length === 0) return null;
    candidates.sort((left, right) => {
      const laneBoost = this.#laneCredits[right.spec.lane] - this.#laneCredits[left.spec.lane];
      const priority = this.#effectivePriority(right, tick) - this.#effectivePriority(left, tick);
      if (Math.abs(priority) > 0.001) return priority;
      if (Math.abs(laneBoost) > 0.001) return laneBoost;
      return left.insertionOrder - right.insertionOrder;
    });
    const selected = candidates[0] ?? null;
    if (selected !== null) {
      const spent = selected.costUnits / Math.max(1, budget);
      this.#laneCredits[selected.spec.lane] = Math.max(-2, this.#laneCredits[selected.spec.lane] - spent);
      for (const lane of R44_LANES) {
        if (lane !== selected.spec.lane) this.#laneCredits[lane] = Math.min(2, this.#laneCredits[lane] + this.#shares[lane]);
      }
    }
    return selected;
  }

  #effectivePriority(task: R44QueuedTask, tick: number): number {
    const age = Math.max(0, tick - task.spec.createdTick);
    return task.priority + Math.min(50, age * this.#agingPerTick);
  }

  #finish(task: R44QueuedTask, state: Exclude<R44TaskState, "queued" | "running">, tick: number): void {
    task.state = state;
    task.finishedTick = tick;
    if (task.dedupeKey !== null && this.#dedupe.get(task.dedupeKey) === task.id) this.#dedupe.delete(task.dedupeKey);
    const result = this.#result(task);
    this.#history.push(result);
    if (this.#history.length > this.#historyCapacity) this.#history.shift();
    this.#queue.delete(task.id);
    try { task.spec.onSettled?.(result); } catch { /* observer failures must not corrupt scheduling */ }
  }

  #result(task: R44QueuedTask): R44TaskResult {
    const base = {
      id: task.id,
      state: task.state,
      startedTick: task.startedTick,
      finishedTick: task.finishedTick,
      chargedUnits: task.chargedUnits,
    };
    if (task.failure !== undefined) return Object.freeze({ ...base, failure: task.failure });
    if (task.result !== undefined) return Object.freeze({ ...base, value: task.result });
    return Object.freeze(base);
  }
}
