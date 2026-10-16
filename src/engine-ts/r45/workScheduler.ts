import { RuntimeFault, normalizeError, taskId, type TaskId } from "./contracts";

export type WorkPriority = "critical" | "high" | "normal" | "low" | "background";
export type WorkStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "expired" | "deferred";

export interface WorkContext {
  readonly tick: number;
  readonly signal: AbortSignal;
  readonly taskId: TaskId;
}

export interface WorkDefinition<T = unknown> {
  readonly id: string;
  readonly lane: string;
  readonly priority?: WorkPriority;
  readonly estimatedCost?: number;
  readonly notBeforeTick?: number;
  readonly deadlineTick?: number;
  readonly dedupeKey?: string;
  readonly dependencies?: readonly string[];
  readonly run: (context: WorkContext) => T;
}

export interface WorkReceipt<T = unknown> {
  readonly id: TaskId;
  readonly lane: string;
  readonly priority: WorkPriority;
  readonly status: WorkStatus;
  readonly queuedAtTick: number;
  readonly finishedAtTick?: number;
  readonly cost: number;
  readonly value?: T;
  readonly fault?: Readonly<{ code: string; message: string }>;
}

export interface SchedulerOptions {
  readonly capacity?: number;
  readonly maxHistory?: number;
  readonly maxTasksPerPump?: number;
  readonly maxCostPerPump?: number;
  readonly maxLaneCount?: number;
  readonly maxAgeBoost?: number;
}

interface InternalTask {
  readonly definition: WorkDefinition;
  readonly id: TaskId;
  readonly sequence: number;
  readonly queuedAtTick: number;
  readonly controller: AbortController;
  status: WorkStatus;
}

const PRIORITY: Readonly<Record<WorkPriority, number>> = {
  critical: 500,
  high: 400,
  normal: 300,
  low: 200,
  background: 100,
};

export class BoundedWorkScheduler {
  readonly capacity: number;
  readonly maxHistory: number;
  readonly maxTasksPerPump: number;
  readonly maxCostPerPump: number;
  readonly maxLaneCount: number;
  readonly maxAgeBoost: number;
  #sequence = 0;
  #queue = new Map<TaskId, InternalTask>();
  #history = new Map<TaskId, WorkReceipt>();
  #dedupe = new Map<string, TaskId>();
  #dependencyOutcomes = new Map<TaskId, "completed" | "failed" | "cancelled" | "expired">();
  #laneUsage = new Map<string, number>();
  #metrics = { accepted: 0, completed: 0, failed: 0, cancelled: 0, expired: 0, rejected: 0, deferred: 0, evicted: 0 };

  constructor(options: SchedulerOptions = {}) {
    this.capacity = options.capacity ?? 512;
    this.maxHistory = options.maxHistory ?? 2048;
    this.maxTasksPerPump = options.maxTasksPerPump ?? 64;
    this.maxCostPerPump = options.maxCostPerPump ?? 200;
    this.maxLaneCount = options.maxLaneCount ?? 64;
    this.maxAgeBoost = options.maxAgeBoost ?? 120;
    for (const [name, value, min, max] of [
      ["capacity", this.capacity, 1, 100_000],
      ["maxHistory", this.maxHistory, 1, 1_000_000],
      ["maxTasksPerPump", this.maxTasksPerPump, 1, 10_000],
      ["maxCostPerPump", this.maxCostPerPump, 1, 10_000_000],
      ["maxLaneCount", this.maxLaneCount, 1, 4096],
      ["maxAgeBoost", this.maxAgeBoost, 0, 100_000],
    ] as const) {
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new RuntimeFault("INVALID_INPUT", "Scheduler option is invalid", "scheduler.constructor", {
          details: { name, value },
        });
      }
    }
  }

  enqueue<T>(definition: WorkDefinition<T>, currentTick: number): OutcomeReceipt<T> {
    if (!Number.isSafeInteger(currentTick) || currentTick < 0) {
      throw new RuntimeFault("INVALID_INPUT", "Scheduler tick is invalid", "scheduler.enqueue");
    }
    if (this.#queue.size >= this.capacity) {
      this.#metrics.rejected += 1;
      return { accepted: false, reason: "capacity" };
    }
    const lane = definition.lane.trim();
    if (!lane || lane.length > 64) {
      this.#metrics.rejected += 1;
      return { accepted: false, reason: "invalid-lane" };
    }
    if (!this.#queueHasLane(lane) && new Set([...this.#queue.values()].map((task) => task.definition.lane)).size >= this.maxLaneCount) {
      this.#metrics.rejected += 1;
      return { accepted: false, reason: "lane-capacity" };
    }
    const id = taskId(definition.id);
    const priority = definition.priority ?? "normal";
    const dependencies = [...new Set((definition.dependencies ?? []).map((entry) => taskId(entry)))];
    if (dependencies.length > 64) {
      throw new RuntimeFault("CAPACITY_EXCEEDED", "A work item cannot depend on more than 64 tasks", "scheduler.enqueue");
    }
    if (dependencies.includes(id)) {
      throw new RuntimeFault("CONFLICT", "A work item cannot depend on itself", "scheduler.enqueue");
    }
    const cost = definition.estimatedCost ?? 1;
    if (!Number.isFinite(cost) || cost < 1 || cost > this.maxCostPerPump) {
      this.#metrics.rejected += 1;
      return { accepted: false, reason: "invalid-cost" };
    }
    if (definition.deadlineTick !== undefined && definition.deadlineTick < currentTick) {
      this.#metrics.expired += 1;
      return { accepted: false, reason: "already-expired" };
    }
    const dedupeKey = definition.dedupeKey ? lane + "|" + definition.dedupeKey : undefined;
    if (dedupeKey) {
      const existing = this.#dedupe.get(dedupeKey);
      if (existing && this.#queue.has(existing)) return { accepted: true, id: existing, deduplicated: true };
    }
    if ([...this.#queue.values()].some((task) => task.id === id)) {
      this.#metrics.rejected += 1;
      return { accepted: false, reason: "duplicate-id" };
    }
    if (this.#sequence >= Number.MAX_SAFE_INTEGER) {
      throw new RuntimeFault("CAPACITY_EXCEEDED", "Scheduler sequence exhausted", "scheduler.enqueue");
    }
    const frozen: WorkDefinition = Object.freeze({
      ...definition,
      lane,
      priority,
      estimatedCost: cost,
      dependencies: Object.freeze(dependencies),
    });
    const internal: InternalTask = {
      definition: frozen,
      id,
      sequence: ++this.#sequence,
      queuedAtTick: currentTick,
      controller: new AbortController(),
      status: "queued",
    };
    this.#queue.set(id, internal);
    if (dedupeKey) this.#dedupe.set(dedupeKey, id);
    this.#metrics.accepted += 1;
    return { accepted: true, id, deduplicated: false };
  }

  cancel(idValue: string, reason = "cancelled-by-caller"): boolean {
    const id = taskId(idValue);
    const task = this.#queue.get(id);
    if (!task || task.status !== "queued") return false;
    task.status = "cancelled";
    task.controller.abort(reason);
    this.#queue.delete(id);
    this.#removeDedupe(task);
    this.#rememberDependencyOutcome(id, "cancelled");
    this.#remember({
      id,
      lane: task.definition.lane,
      priority: task.definition.priority ?? "normal",
      status: "cancelled",
      queuedAtTick: task.queuedAtTick,
      finishedAtTick: task.queuedAtTick,
      cost: 0,
      fault: Object.freeze({ code: "CANCELLED", message: reason }),
    });
    this.#metrics.cancelled += 1;
    return true;
  }

  pump(tick: number, budgetCost = this.maxCostPerPump): readonly WorkReceipt[] {
    if (!Number.isSafeInteger(tick) || tick < 0) {
      throw new RuntimeFault("INVALID_INPUT", "Pump tick is invalid", "scheduler.pump");
    }
    const available = Math.min(this.maxCostPerPump, Math.max(0, budgetCost));
    if (!Number.isFinite(available)) {
      throw new RuntimeFault("INVALID_INPUT", "Pump cost budget is invalid", "scheduler.pump");
    }
    let remaining = available;
    let ran = 0;
    const receipts: WorkReceipt[] = [];
    this.#laneUsage.clear();

    while (ran < this.maxTasksPerPump && remaining > 0) {
      const ordered = [...this.#queue.values()]
        .filter((task) => task.status === "queued")
        .sort((left, right) => this.#score(right, tick) - this.#score(left, tick) || left.sequence - right.sequence);
      if (ordered.length === 0) break;
      const expired = ordered.find((task) =>
        task.definition.deadlineTick !== undefined && tick > task.definition.deadlineTick);
      if (expired) {
        this.#finishWithoutRun(expired, "expired", tick, "DEADLINE_EXCEEDED", "Task deadline has passed");
        this.#metrics.expired += 1;
        continue;
      }
      const eligible = ordered.filter((task) =>
        task.definition.notBeforeTick === undefined || tick >= task.definition.notBeforeTick);
      const failedDependency = eligible.find((task) => this.#dependencyState(task) === "failed");
      if (failedDependency) {
        this.#finishWithoutRun(failedDependency, "cancelled", tick, "DEPENDENCY_FAILED", "A dependency did not complete");
        this.#metrics.cancelled += 1;
        continue;
      }
      const runnable = eligible.filter((task) => this.#dependencyState(task) === "ready");
      const candidate = runnable.find((task) => (task.definition.estimatedCost ?? 1) <= remaining);
      if (!candidate) {
        this.#metrics.deferred += runnable.filter((task) => (task.definition.estimatedCost ?? 1) > remaining).length;
        break;
      }
      const cost = candidate.definition.estimatedCost ?? 1;
      candidate.status = "running";
      this.#queue.delete(candidate.id);
      this.#removeDedupe(candidate);
      const laneUsed = this.#laneUsage.get(candidate.definition.lane) ?? 0;
      this.#laneUsage.set(candidate.definition.lane, laneUsed + cost);
      try {
        const value = candidate.definition.run({ tick, signal: candidate.controller.signal, taskId: candidate.id });
        const receipt: WorkReceipt = Object.freeze({
          id: candidate.id,
          lane: candidate.definition.lane,
          priority: candidate.definition.priority ?? "normal",
          status: "completed",
          queuedAtTick: candidate.queuedAtTick,
          finishedAtTick: tick,
          cost,
          value,
        });
        receipts.push(receipt);
        this.#remember(receipt);
        this.#rememberDependencyOutcome(candidate.id, "completed");
        this.#metrics.completed += 1;
      } catch (error) {
        const fault = normalizeError(error, "scheduler.task");
        const receipt: WorkReceipt = Object.freeze({
          id: candidate.id,
          lane: candidate.definition.lane,
          priority: candidate.definition.priority ?? "normal",
          status: "failed",
          queuedAtTick: candidate.queuedAtTick,
          finishedAtTick: tick,
          cost,
          fault: Object.freeze({ code: fault.code, message: fault.message }),
        });
        receipts.push(receipt);
        this.#remember(receipt);
        this.#rememberDependencyOutcome(candidate.id, "failed");
        this.#metrics.failed += 1;
      }
      remaining -= cost;
      ran += 1;
    }
    for (const task of this.#queue.values()) {
      if (task.status === "deferred") task.status = "queued";
    }
    return Object.freeze(receipts);
  }

  get(idValue: string): WorkReceipt | undefined {
    const id = taskId(idValue);
    const saved = this.#history.get(id);
    if (saved) return saved;
    const queued = this.#queue.get(id);
    if (!queued) return undefined;
    return Object.freeze({
      id,
      lane: queued.definition.lane,
      priority: queued.definition.priority ?? "normal",
      status: queued.status,
      queuedAtTick: queued.queuedAtTick,
      cost: queued.definition.estimatedCost ?? 1,
    });
  }

  queued(): readonly WorkReceipt[] {
    return Object.freeze([...this.#queue.values()]
      .sort((a, b) => a.sequence - b.sequence)
      .map((task) => Object.freeze({
        id: task.id,
        lane: task.definition.lane,
        priority: task.definition.priority ?? "normal",
        status: task.status,
        queuedAtTick: task.queuedAtTick,
        cost: task.definition.estimatedCost ?? 1,
      })));
  }

  stats(): Readonly<Record<string, number>> {
    return Object.freeze({
      queued: this.#queue.size,
      history: this.#history.size,
      dependencyOutcomes: this.#dependencyOutcomes.size,
      ...this.#metrics,
      lanes: new Set([...this.#queue.values()].map((task) => task.definition.lane)).size,
    });
  }

  #score(task: InternalTask, tick: number): number {
    const priority = PRIORITY[task.definition.priority ?? "normal"];
    const age = Math.min(this.maxAgeBoost, Math.max(0, tick - task.queuedAtTick));
    const deadline = task.definition.deadlineTick;
    const urgency = deadline === undefined ? 0 : Math.max(0, 50 - (deadline - tick));
    return priority + age + urgency;
  }

  #dependencyState(task: InternalTask): "ready" | "waiting" | "failed" {
    for (const dependencyValue of task.definition.dependencies ?? []) {
      const dependency = taskId(dependencyValue);
      const outcome = this.#dependencyOutcomes.get(dependency);
      if (outcome === "failed" || outcome === "cancelled" || outcome === "expired") return "failed";
      if (outcome !== "completed") return "waiting";
    }
    return "ready";
  }

  #queueHasLane(lane: string): boolean {
    return [...this.#queue.values()].some((task) => task.definition.lane === lane);
  }

  #removeDedupe(task: InternalTask): void {
    const key = task.definition.dedupeKey ? task.definition.lane + "|" + task.definition.dedupeKey : undefined;
    if (key && this.#dedupe.get(key) === task.id) this.#dedupe.delete(key);
  }

  #finishWithoutRun(task: InternalTask, status: "cancelled" | "expired", tick: number, code: string, message: string): void {
    task.status = status;
    this.#queue.delete(task.id);
    this.#removeDedupe(task);
    this.#rememberDependencyOutcome(task.id, status);
    this.#remember({
      id: task.id,
      lane: task.definition.lane,
      priority: task.definition.priority ?? "normal",
      status,
      queuedAtTick: task.queuedAtTick,
      finishedAtTick: tick,
      cost: 0,
      fault: Object.freeze({ code, message }),
    });
  }

  #rememberDependencyOutcome(
    id: TaskId,
    outcome: "completed" | "failed" | "cancelled" | "expired",
  ): void {
    if (this.#dependencyOutcomes.has(id)) this.#dependencyOutcomes.delete(id);
    this.#dependencyOutcomes.set(id, outcome);
    const required = new Set<string>();
    for (const task of this.#queue.values()) {
      for (const dependency of task.definition.dependencies ?? []) required.add(dependency);
    }
    const historyBudget = this.maxHistory + required.size;
    while (this.#dependencyOutcomes.size > historyBudget) {
      const oldestUnreferenced = [...this.#dependencyOutcomes.keys()].find((candidate) => !required.has(candidate));
      if (oldestUnreferenced === undefined) break;
      this.#dependencyOutcomes.delete(oldestUnreferenced);
    }
  }

  #remember(receipt: WorkReceipt): void {
    if (this.#history.has(receipt.id)) this.#history.delete(receipt.id);
    if (this.#history.size >= this.maxHistory) {
      const oldest = this.#history.keys().next().value;
      if (oldest !== undefined) this.#history.delete(oldest);
    }
    this.#history.set(receipt.id, receipt);
  }
}

export type OutcomeReceipt<T> =
  | { readonly accepted: true; readonly id: TaskId; readonly deduplicated?: boolean }
  | { readonly accepted: false; readonly reason: "capacity" | "lane-capacity" | "invalid-lane" | "invalid-cost" | "already-expired" | "duplicate-id" };
