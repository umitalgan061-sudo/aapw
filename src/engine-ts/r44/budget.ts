import { clamp, compareStrings, err, finite, ok, type LaneId, type MonotonicClock, type Priority, type Result, systemMonotonicClock } from "./contracts.ts";

export interface BudgetLaneOptions {
  readonly id: LaneId;
  readonly weight: number;
  readonly reserveMs?: number;
  readonly maxQueue?: number;
  readonly enabled?: () => boolean;
}

export interface BudgetTask<T = unknown> {
  readonly id: string;
  readonly lane: LaneId;
  readonly costMs: number;
  readonly priority: Priority;
  readonly run: () => T;
  readonly deadlineFrame?: number;
  readonly signal?: AbortSignal;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export type BudgetTaskState = "queued" | "running" | "completed" | "failed" | "cancelled" | "expired" | "rejected";

export interface BudgetTaskReport {
  readonly id: string;
  readonly lane: LaneId;
  readonly state: BudgetTaskState;
  readonly costMs: number;
  readonly elapsedMs: number;
  readonly frame: number;
  readonly queueWaitFrames: number;
  readonly error?: string;
}

export interface BudgetDrainReport {
  readonly frame: number;
  readonly budgetMs: number;
  readonly spentMs: number;
  readonly unusedMs: number;
  readonly executed: number;
  readonly deferred: number;
  readonly dropped: number;
  readonly tasks: readonly BudgetTaskReport[];
  readonly laneSpentMs: Readonly<Record<string, number>>;
}

interface QueueEntry {
  readonly sequence: number;
  readonly task: BudgetTask;
  readonly enqueuedFrame: number;
}

interface LaneState {
  readonly options: Required<Omit<BudgetLaneOptions, "enabled">> & { readonly enabled?: () => boolean };
  readonly queue: QueueEntry[];
  spentMs: number;
  turns: number;
}

/**
 * A deterministic per-frame work governor.
 *
 * Tasks have declared costs; actual callback duration is observed but scheduling
 * is based on the declared cost, so an unusually slow task cannot reorder other
 * work inside the same frame. The caller supplies a monotonic clock for testing.
 */
export class FrameBudgetArbiter {
  readonly maxPending: number;
  readonly maxTaskCostMs: number;
  readonly clock: MonotonicClock;
  #lanes = new Map<LaneId, LaneState>();
  #taskIds = new Set<string>();
  #sequence = 0;
  #lastFrame = -1;
  #roundRobinCursor = 0;

  constructor(options: { readonly maxPending?: number; readonly maxTaskCostMs?: number; readonly clock?: MonotonicClock } = {}) {
    this.maxPending = Math.max(1, Math.trunc(options.maxPending ?? 4096));
    this.maxTaskCostMs = Math.max(0.1, finite(options.maxTaskCostMs, 6));
    this.clock = options.clock ?? systemMonotonicClock;
  }

  registerLane(options: BudgetLaneOptions): Result<true> {
    const id = options.id.trim();
    if (!id) return err("BUDGET_LANE_ID", "Lane identifier must not be empty.");
    if (this.#lanes.has(id)) return err("BUDGET_LANE_DUPLICATE", "Lane already exists.", false, { lane: id });
    const laneOptions = Object.freeze({
      id,
      weight: clamp(finite(options.weight, 1), 0.1, 16),
      reserveMs: clamp(finite(options.reserveMs, 0), 0, 100),
      maxQueue: Math.max(1, Math.trunc(options.maxQueue ?? 512)),
      ...(options.enabled ? { enabled: options.enabled } : {}),
    });
    this.#lanes.set(id, { options: laneOptions, queue: [], spentMs: 0, turns: 0 });
    return ok(true);
  }

  removeLane(id: LaneId, cancelPending = true): readonly BudgetTaskReport[] {
    const lane = this.#lanes.get(id);
    if (!lane) return Object.freeze([]);
    const reports: BudgetTaskReport[] = [];
    if (cancelPending) {
      for (const entry of lane.queue) {
        this.#taskIds.delete(entry.task.id);
        reports.push(this.#report(entry, "cancelled", 0, this.#lastFrame, 0));
      }
    }
    this.#lanes.delete(id);
    return Object.freeze(reports);
  }

  enqueue<T>(task: BudgetTask<T>, frame: number): Result<string> {
    const id = task.id.trim();
    if (!id) return err("BUDGET_TASK_ID", "Task identifier must not be empty.");
    if (this.#taskIds.has(id)) return err("BUDGET_TASK_DUPLICATE", "Task identifier is already queued or running.", false, { id });
    const lane = this.#lanes.get(task.lane);
    if (!lane) return err("BUDGET_LANE_UNKNOWN", "Task references an unknown lane.", false, { lane: task.lane });
    const total = this.pendingCount();
    if (total >= this.maxPending) return err("BUDGET_QUEUE_FULL", "Global pending work limit reached.", true);
    if (lane.queue.length >= lane.options.maxQueue) return err("BUDGET_LANE_FULL", "Lane pending work limit reached.", true, { lane: task.lane });
    if (!Number.isFinite(task.costMs) || task.costMs <= 0) return err("BUDGET_TASK_COST", "Task cost must be finite and positive.");
    const normalized: BudgetTask = Object.freeze({
      ...task,
      id,
      costMs: Math.min(task.costMs, this.maxTaskCostMs),
      priority: Math.max(0, Math.min(4, Math.trunc(task.priority))) as Priority,
    });
    const entry: QueueEntry = Object.freeze({
      sequence: this.#sequence++,
      task: normalized,
      enqueuedFrame: Math.max(0, Math.trunc(frame)),
    });
    lane.queue.push(entry);
    this.#taskIds.add(id);
    return ok(id);
  }

  cancel(id: string): boolean {
    for (const lane of this.#lanes.values()) {
      const index = lane.queue.findIndex((entry) => entry.task.id === id);
      if (index < 0) continue;
      lane.queue.splice(index, 1);
      this.#taskIds.delete(id);
      return true;
    }
    return false;
  }

  pendingCount(): number {
    let count = 0;
    for (const lane of this.#lanes.values()) count += lane.queue.length;
    return count;
  }

  queueDepth(laneId?: string): number {
    if (laneId !== undefined) return this.#lanes.get(laneId)?.queue.length ?? 0;
    return this.pendingCount();
  }

  laneIds(): readonly string[] {
    return Object.freeze([...this.#lanes.keys()].sort(compareStrings));
  }

  drain(frame: number, availableMs: number): BudgetDrainReport {
    const safeFrame = Math.max(0, Math.trunc(frame));
    if (safeFrame < this.#lastFrame) {
      throw new Error("Budget frames must be monotonic.");
    }
    this.#lastFrame = safeFrame;
    const budgetMs = clamp(finite(availableMs, 0), 0, 1000);
    const start = this.clock.now();
    const reports: BudgetTaskReport[] = [];
    const laneSpent: Record<string, number> = {};
    for (const lane of this.#lanes.values()) {
      lane.spentMs = 0;
      lane.turns = 0;
      laneSpent[lane.options.id] = 0;
    }

    let modeledSpent = 0;
    let dropped = 0;
    let executed = 0;
    let noProgressPasses = 0;
    const maxTaskRuns = Math.max(1, this.pendingCount());

    while (this.pendingCount() > 0 && executed + dropped < maxTaskRuns) {
      const candidate = this.#choose(safeFrame, budgetMs - modeledSpent);
      if (!candidate) break;
      const { lane, entry } = candidate;
      const index = lane.queue.indexOf(entry);
      if (index < 0) {
        noProgressPasses += 1;
        if (noProgressPasses > this.#lanes.size + 1) break;
        continue;
      }
      noProgressPasses = 0;
      lane.queue.splice(index, 1);
      const task = entry.task;
      if (task.signal?.aborted) {
        this.#taskIds.delete(task.id);
        reports.push(this.#report(entry, "cancelled", 0, safeFrame, safeFrame - entry.enqueuedFrame));
        dropped += 1;
        continue;
      }
      if (task.deadlineFrame !== undefined && safeFrame > task.deadlineFrame) {
        this.#taskIds.delete(task.id);
        reports.push(this.#report(entry, "expired", 0, safeFrame, safeFrame - entry.enqueuedFrame));
        dropped += 1;
        continue;
      }
      const before = this.clock.now();
      let state: BudgetTaskState = "completed";
      let error: string | undefined;
      try {
        task.run();
      } catch (cause) {
        state = "failed";
        error = cause instanceof Error ? cause.message : String(cause);
      }
      const elapsed = Math.max(0, this.clock.now() - before);
      modeledSpent += task.costMs;
      lane.spentMs += task.costMs;
      laneSpent[lane.options.id] = (laneSpent[lane.options.id] ?? 0) + task.costMs;
      lane.turns += 1;
      executed += 1;
      this.#taskIds.delete(task.id);
      reports.push(this.#report(entry, state, elapsed, safeFrame, safeFrame - entry.enqueuedFrame, error));
    }

    // A disabled lane can remain pending indefinitely; this is reported as deferred.
    const deferred = this.pendingCount();
    const wallSpentMs = Math.max(0, this.clock.now() - start);
    const spentMs = Math.min(budgetMs, Math.max(modeledSpent, Math.min(wallSpentMs, budgetMs)));
    return Object.freeze({
      frame: safeFrame,
      budgetMs,
      spentMs: Number(spentMs.toFixed(4)),
      unusedMs: Number(Math.max(0, budgetMs - spentMs).toFixed(4)),
      executed,
      deferred,
      dropped,
      tasks: Object.freeze(reports),
      laneSpentMs: Object.freeze({ ...laneSpent }),
    });
  }

  clear(): readonly string[] {
    const ids: string[] = [];
    for (const lane of this.#lanes.values()) {
      for (const entry of lane.queue) ids.push(entry.task.id);
      lane.queue.length = 0;
    }
    this.#taskIds.clear();
    return Object.freeze(ids.sort(compareStrings));
  }

  #choose(frame: number, remainingMs: number): { lane: LaneState; entry: QueueEntry } | undefined {
    if (remainingMs <= 0) return undefined;
    const laneList = [...this.#lanes.values()].filter((lane) => { try { return !lane.options.enabled || lane.options.enabled(); } catch { return false; } }).sort((a, b) => compareStrings(a.options.id, b.options.id));
    if (laneList.length === 0) return undefined;
    const reservedUnmet = laneList.filter((lane) =>
      lane.spentMs < Math.min(lane.options.reserveMs, remainingMs) &&
      lane.queue.some((item) => item.enqueuedFrame <= frame && item.task.costMs <= remainingMs),
    );
    const options = reservedUnmet.length > 0 ? reservedUnmet : laneList;
    const candidates: { lane: LaneState; entry: QueueEntry; score: number }[] = [];

    for (const lane of options) {
      const entry = lane.queue
        .filter((item) => item.enqueuedFrame <= frame && item.task.costMs <= remainingMs)
        .sort((a, b) => this.#compareEntries(a, b, frame))[0];
      if (!entry) continue;
      const age = Math.max(0, frame - entry.enqueuedFrame);
      const priorityBenefit = (4 - entry.task.priority) * 1000;
      const agingBenefit = Math.min(900, age * 3);
      const deadlineBenefit = entry.task.deadlineFrame === undefined
        ? 0
        : Math.max(0, 100 - (entry.task.deadlineFrame - frame));
      const sharePenalty = lane.spentMs / lane.options.weight;
      const cursorBonus = laneList.indexOf(lane) === this.#roundRobinCursor ? 0.25 : 0;
      candidates.push({
        lane,
        entry,
        score: priorityBenefit + agingBenefit + deadlineBenefit - sharePenalty + cursorBonus,
      });
    }
    candidates.sort((a, b) => b.score - a.score || this.#compareEntries(a.entry, b.entry, frame) || compareStrings(a.lane.options.id, b.lane.options.id));
    const selected = candidates[0];
    if (!selected) {
      // No task currently fits. An oversized task is left queued for a later frame.
      return undefined;
    }
    this.#roundRobinCursor = (laneList.indexOf(selected.lane) + 1) % laneList.length;
    return selected;
  }

  #compareEntries(a: QueueEntry, b: QueueEntry, frame: number): number {
    const effectiveA = Math.max(0, a.task.priority - Math.floor(Math.max(0, frame - a.enqueuedFrame) / 120));
    const effectiveB = Math.max(0, b.task.priority - Math.floor(Math.max(0, frame - b.enqueuedFrame) / 120));
    return effectiveA - effectiveB || a.sequence - b.sequence || compareStrings(a.task.id, b.task.id);
  }

  #report(
    entry: QueueEntry,
    state: BudgetTaskState,
    elapsedMs: number,
    frame: number,
    queueWaitFrames: number,
    error?: string,
  ): BudgetTaskReport {
    const base = {
      id: entry.task.id,
      lane: entry.task.lane,
      state,
      costMs: entry.task.costMs,
      elapsedMs: Number(Math.max(0, finite(elapsedMs, 0)).toFixed(4)),
      frame,
      queueWaitFrames: Math.max(0, queueWaitFrames),
    };
    return Object.freeze(error === undefined ? base : { ...base, error });
  }
}
