import { describe, expect, it } from "vitest";
import { R44BoundaryError, R44InvariantError } from "../../../src/engine-ts/r44/contracts.js";
import { R44TaskScheduler } from "../../../src/engine-ts/r44/taskScheduler.js";

describe("R44TaskScheduler", () => {
  it("orders tasks deterministically by priority then insertion order", () => {
    const scheduler = new R44TaskScheduler({ capacity: 16, maxCostUnitsPerDrain: 20 });
    const order: string[] = [];
    scheduler.submit({ key: "low", owner: "test", lane: "background", priority: 1, createdTick: 0, run: () => order.push("low") });
    scheduler.submit({ key: "high-a", owner: "test", lane: "interactive", priority: 90, createdTick: 0, run: () => order.push("high-a") });
    scheduler.submit({ key: "high-b", owner: "test", lane: "interactive", priority: 90, createdTick: 0, run: () => order.push("high-b") });
    const report = scheduler.drain({ tick: 1, budgetUnits: 10 });
    expect(order).toEqual(["high-a", "high-b", "low"]);
    expect(report.executed).toBe(3);
    expect(report.remainingQueue).toBe(0);
    expect(scheduler.stats().queued).toBe(0);
  });

  it("deduplicates queued work using a stable dedupe key", () => {
    const scheduler = new R44TaskScheduler();
    const first = scheduler.submit({
      key: "load-world",
      owner: "streaming",
      lane: "streaming",
      createdTick: 0,
      dedupeKey: "chunk:2:4",
      run: () => "loaded",
    });
    const second = scheduler.submit({
      key: "load-world-again",
      owner: "streaming",
      lane: "streaming",
      createdTick: 0,
      dedupeKey: "chunk:2:4",
      run: () => "duplicate",
    });
    expect(second).toEqual({ id: first.id, deduplicated: true });
    expect(scheduler.size).toBe(1);
    scheduler.drain({ tick: 1 });
    expect(scheduler.size).toBe(0);
  });

  it("enforces capacity, budget, and cost bounds", () => {
    const scheduler = new R44TaskScheduler({ capacity: 1, maxCostUnitsPerDrain: 3 });
    scheduler.submit({ key: "costly", owner: "test", lane: "simulation", costUnits: 3, createdTick: 0, run: () => 7 });
    expect(() => scheduler.submit({ key: "extra", owner: "test", lane: "background", createdTick: 0, run: () => 0 }))
      .toThrow(R44BoundaryError);
    const report = scheduler.drain({ tick: 1, budgetUnits: 2 });
    expect(report.executed).toBe(0);
    expect(report.deferred).toBe(1);
    expect(report.remainingBudgetUnits).toBe(2);
    expect(scheduler.drain({ tick: 2, budgetUnits: 3 }).executed).toBe(1);
  });

  it("records task exceptions and continues the drain", () => {
    const settled: string[] = [];
    const scheduler = new R44TaskScheduler();
    scheduler.submit({
      key: "throws",
      owner: "test",
      lane: "simulation",
      createdTick: 0,
      run: () => { throw new Error("boom"); },
      onSettled: (result) => settled.push(result.state),
    });
    scheduler.submit({
      key: "works",
      owner: "test",
      lane: "simulation",
      createdTick: 0,
      run: () => 2,
      onSettled: (result) => settled.push(result.state),
    });
    const report = scheduler.drain({ tick: 2 });
    expect(report.failed).toBe(1);
    expect(report.executed).toBe(1);
    expect(settled).toEqual(["failed", "succeeded"]);
    expect(scheduler.get("task-1")?.failure?.message).toContain("boom");
    expect(scheduler.history().length).toBe(2);
  });

  it("expires and cancels tasks while releasing queue capacity", () => {
    const scheduler = new R44TaskScheduler({ capacity: 2 });
    scheduler.submit({ key: "expires", owner: "test", lane: "background", createdTick: 0, expiresAtTick: 2, run: () => 1 });
    const cancel = scheduler.submit({ key: "cancel", owner: "worker", lane: "streaming", createdTick: 0, run: () => 2 });
    expect(scheduler.cancel(cancel.id, 1)).toBe(true);
    const report = scheduler.drain({ tick: 3 });
    expect(report.expired).toBe(1);
    expect(report.cancelled).toBe(0);
    expect(scheduler.stats().cancelled).toBe(1);
    expect(scheduler.size).toBe(0);
    expect(() => scheduler.submit({ key: "replacement", owner: "test", lane: "background", createdTick: 3, run: () => true })).not.toThrow();
  });

  it("prevents recursive draining from a task callback", () => {
    const scheduler = new R44TaskScheduler();
    scheduler.submit({
      key: "recursive",
      owner: "test",
      lane: "interactive",
      createdTick: 0,
      run: () => scheduler.drain({ tick: 1 }),
    });
    expect(() => scheduler.drain({ tick: 1 })).not.toThrow();
    expect(scheduler.history()[0]?.failure?.code).toBe("scheduler-reentrant");
  });

  it("applies aging so an old low-priority job can eventually execute", () => {
    const scheduler = new R44TaskScheduler({ agingPerTick: 2, maxPriority: 100 });
    const order: string[] = [];
    scheduler.submit({ key: "old", owner: "test", lane: "background", priority: 0, createdTick: 0, run: () => order.push("old") });
    scheduler.submit({ key: "new", owner: "test", lane: "interactive", priority: 15, createdTick: 10, run: () => order.push("new") });
    scheduler.drain({ tick: 20, maxTasks: 1 });
    expect(order[0]).toBe("old");
  });

  it("does not allow decreasing logical tick values", () => {
    const scheduler = new R44TaskScheduler();
    scheduler.drain({ tick: 3 });
    expect(() => scheduler.drain({ tick: 2 })).toThrow(R44BoundaryError);
    expect(() => scheduler.cancel("missing", 2)).toThrow(R44BoundaryError);
  });
});
