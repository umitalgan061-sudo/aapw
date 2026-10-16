import { describe, expect, it } from "vitest";
import { FrameBudgetArbiter } from "../../src/engine-ts/r44/budget.ts";

function makeBudget() {
  const clock = { value: 0, now() { return this.value; } };
  const budget = new FrameBudgetArbiter({ maxPending: 16, maxTaskCostMs: 5, clock });
  budget.registerLane({ id: "simulation", weight: 4, reserveMs: 0.5 });
  budget.registerLane({ id: "background", weight: 1, reserveMs: 0 });
  return { budget, clock };
}

describe("FrameBudgetArbiter", () => {
  it("executes stable task ordering and reports bounded spend", () => {
    const { budget, clock } = makeBudget();
    const order: string[] = [];
    budget.enqueue({ id: "b", lane: "background", priority: 2, costMs: 1, run: () => { order.push("b"); clock.value += 0.1; } }, 1);
    budget.enqueue({ id: "a", lane: "simulation", priority: 0, costMs: 1, run: () => { order.push("a"); clock.value += 0.1; } }, 1);
    budget.enqueue({ id: "c", lane: "simulation", priority: 1, costMs: 1, run: () => { order.push("c"); clock.value += 0.1; } }, 1);
    const report = budget.drain(1, 3);
    expect(order[0]).toBe("a");
    expect(report.executed).toBe(3);
    expect(report.deferred).toBe(0);
    expect(report.spentMs).toBeLessThanOrEqual(report.budgetMs);
    expect(report.tasks.map((task) => task.state)).toEqual(["completed", "completed", "completed"]);
  });

  it("keeps work pending when declared costs do not fit the frame", () => {
    const { budget } = makeBudget();
    budget.enqueue({ id: "expensive", lane: "simulation", priority: 0, costMs: 4, run: () => undefined }, 1);
    const first = budget.drain(1, 2);
    expect(first.executed).toBe(0);
    expect(first.deferred).toBe(1);
    const second = budget.drain(2, 5);
    expect(second.executed).toBe(1);
    expect(second.deferred).toBe(0);
  });

  it("rejects duplicate ids and unknown lanes", () => {
    const { budget } = makeBudget();
    expect(budget.enqueue({ id: "same", lane: "simulation", priority: 1, costMs: 1, run: () => undefined }, 1).ok).toBe(true);
    expect(budget.enqueue({ id: "same", lane: "simulation", priority: 1, costMs: 1, run: () => undefined }, 1).ok).toBe(false);
    expect(budget.enqueue({ id: "other", lane: "missing", priority: 1, costMs: 1, run: () => undefined }, 1).ok).toBe(false);
  });

  it("cancels queued work and observes AbortSignal", () => {
    const { budget } = makeBudget();
    const controller = new AbortController();
    budget.enqueue({ id: "queued", lane: "simulation", priority: 1, costMs: 1, run: () => undefined }, 1);
    budget.enqueue({ id: "aborted", lane: "background", priority: 1, costMs: 1, signal: controller.signal, run: () => undefined }, 1);
    expect(budget.cancel("queued")).toBe(true);
    controller.abort();
    const report = budget.drain(1, 3);
    expect(report.tasks.some((task) => task.id === "aborted" && task.state === "cancelled")).toBe(true);
    expect(budget.pendingCount()).toBe(0);
  });

  it("reports callback failures without stopping the frame", () => {
    const { budget } = makeBudget();
    let following = false;
    budget.enqueue({ id: "bad", lane: "simulation", priority: 0, costMs: 1, run: () => { throw new Error("boom"); } }, 1);
    budget.enqueue({ id: "good", lane: "simulation", priority: 1, costMs: 1, run: () => { following = true; } }, 1);
    const report = budget.drain(1, 4);
    expect(report.tasks.find((task) => task.id === "bad")?.state).toBe("failed");
    expect(following).toBe(true);
  });

  it("enforces global and per-lane queue bounds", () => {
    const budget = new FrameBudgetArbiter({ maxPending: 2 });
    budget.registerLane({ id: "tiny", weight: 1, maxQueue: 1 });
    budget.registerLane({ id: "other", weight: 1 });
    const task = (id: string, lane: string) => ({ id, lane, priority: 1 as const, costMs: 0.2, run: () => undefined });
    expect(budget.enqueue(task("one", "tiny"), 0).ok).toBe(true);
    expect(budget.enqueue(task("two", "tiny"), 0).ok).toBe(false);
    expect(budget.enqueue(task("three", "other"), 0).ok).toBe(true);
    expect(budget.enqueue(task("four", "other"), 0).ok).toBe(false);
  });
});
