import { describe, expect, it } from "vitest";
import { BoundedWorkScheduler } from "../../src/engine-ts/r45";

describe("BoundedWorkScheduler", () => {
  it("runs critical work ahead of lower-priority work deterministically", () => {
    const scheduler = new BoundedWorkScheduler({ capacity: 10 });
    const calls: string[] = [];
    scheduler.enqueue({ id: "normal", lane: "simulation", priority: "normal", run: () => calls.push("normal") }, 1);
    scheduler.enqueue({ id: "critical", lane: "simulation", priority: "critical", run: () => calls.push("critical") }, 1);
    const receipts = scheduler.pump(1, 2);
    expect(calls).toEqual(["critical", "normal"]);
    expect(receipts.map((receipt) => receipt.status)).toEqual(["completed", "completed"]);
  });

  it("deduplicates queued work by lane and dedupe key", () => {
    const scheduler = new BoundedWorkScheduler();
    const first = scheduler.enqueue({
      id: "asset-1", lane: "assets", dedupeKey: "tree-1", run: () => "loaded",
    }, 2);
    const duplicate = scheduler.enqueue({
      id: "asset-2", lane: "assets", dedupeKey: "tree-1", run: () => "duplicate",
    }, 2);
    expect(first.accepted).toBe(true);
    expect(duplicate.accepted).toBe(true);
    if (first.accepted && duplicate.accepted) {
      expect(duplicate.id).toBe(first.id);
      expect(duplicate.deduplicated).toBe(true);
    }
    expect(scheduler.stats().queued).toBe(1);
  });

  it("respects cost budgets while continuing with other work that fits", () => {
    const scheduler = new BoundedWorkScheduler({ maxCostPerPump: 20 });
    const calls: string[] = [];
    scheduler.enqueue({ id: "expensive", lane: "world", priority: "critical", estimatedCost: 9, run: () => calls.push("expensive") }, 1);
    scheduler.enqueue({ id: "cheap", lane: "world", priority: "low", estimatedCost: 2, run: () => calls.push("cheap") }, 1);
    scheduler.pump(1, 2);
    expect(calls).toEqual(["cheap"]);
    expect(scheduler.get("expensive")?.status).toBe("queued");
  });

  it("supports prerequisite completion and cancels dependents after failures", () => {
    const scheduler = new BoundedWorkScheduler();
    const calls: string[] = [];
    scheduler.enqueue({ id: "base", lane: "world", priority: "low", run: () => calls.push("base") }, 1);
    scheduler.enqueue({ id: "dependent", lane: "world", priority: "critical", dependencies: ["base"], run: () => calls.push("dependent") }, 1);
    scheduler.pump(1, 5);
    scheduler.pump(2, 5);
    expect(calls).toEqual(["base", "dependent"]);

    const failing = new BoundedWorkScheduler();
    failing.enqueue({ id: "broken", lane: "world", run: () => { throw new Error("no"); } }, 1);
    failing.enqueue({ id: "blocked", lane: "world", dependencies: ["broken"], run: () => true }, 1);
    failing.pump(1, 5);
    failing.pump(1, 5);
    expect(failing.get("blocked")?.status).toBe("cancelled");
  });

  it("cancels queued work and records a cancellation outcome", () => {
    const scheduler = new BoundedWorkScheduler();
    scheduler.enqueue({ id: "pending", lane: "assets", run: () => true }, 1);
    expect(scheduler.cancel("pending", "scene-closed")).toBe(true);
    expect(scheduler.cancel("pending")).toBe(false);
    expect(scheduler.get("pending")?.status).toBe("cancelled");
  });

  it("expires overdue work instead of executing it", () => {
    const scheduler = new BoundedWorkScheduler();
    const run = () => "should-not-run";
    scheduler.enqueue({ id: "expired", lane: "background", deadlineTick: 3, run }, 1);
    const receipts = scheduler.pump(4, 8);
    expect(receipts).toHaveLength(0);
    expect(scheduler.get("expired")?.status).toBe("expired");
    expect(scheduler.stats().expired).toBe(1);
  });

  it("uses ageing to prevent indefinitely starved low-priority work", () => {
    const scheduler = new BoundedWorkScheduler({ maxAgeBoost: 500, maxTasksPerPump: 1 });
    scheduler.enqueue({ id: "old-low", lane: "world", priority: "low", run: () => "low" }, 0);
    for (let index = 0; index < 4; index += 1) {
      scheduler.enqueue({ id: "high-" + index, lane: "world", priority: "high", run: () => "high" }, index + 1);
      scheduler.pump(index + 1, 1);
    }
    scheduler.pump(700, 1);
    expect(scheduler.get("old-low")?.status).toBe("completed");
  });

  it("bounds history and rejects unsafe inputs", () => {
    const scheduler = new BoundedWorkScheduler({ maxHistory: 2, capacity: 2 });
    scheduler.enqueue({ id: "one", lane: "a", run: () => 1 }, 1);
    scheduler.enqueue({ id: "two", lane: "a", run: () => 2 }, 1);
    scheduler.pump(1, 2);
    scheduler.enqueue({ id: "three", lane: "a", run: () => 3 }, 2);
    scheduler.pump(2, 2);
    expect(scheduler.stats().history).toBe(2);
    expect(scheduler.enqueue({ id: "four", lane: "", run: () => 4 }, 2).accepted).toBe(false);
  });
});
