import { describe, expect, it, vi } from "vitest";
import { RuntimeFault, RuntimeOperations } from "../../src/engine-ts/r45";

describe("RuntimeOperations integration facade", () => {
  it("starts services, runs bounded work and shuts services down in reverse order", async () => {
    const calls: string[] = [];
    const runtime = new RuntimeOperations({ clock: { fixedStepMs: 10 }, quality: { minTicksBetweenChanges: 0 } });
    runtime.registerService({ id: "assets", start: () => { calls.push("start-assets"); }, stop: () => { calls.push("stop-assets"); } });
    runtime.registerService({
      id: "world", dependsOn: ["assets"],
      start: () => { calls.push("start-world"); }, stop: () => { calls.push("stop-world"); },
    });
    const started = await runtime.start();
    expect(started.ok).toBe(true);
    expect(runtime.state).toBe("running");
    const work = vi.fn(() => "completed");
    runtime.enqueueWork({ id: "tick-work", lane: "simulation", priority: "critical", run: work });
    const report = runtime.frame(20, { frameMs: 12, memoryBytes: 100_000_000 });
    expect(report.clock.steps).toBe(2);
    expect(report.work.some((receipt) => receipt.status === "completed")).toBe(true);
    expect(work).toHaveBeenCalledTimes(1);
    const stopped = await runtime.shutdown();
    expect(stopped.ok).toBe(true);
    expect(runtime.state).toBe("stopped");
    expect(calls).toEqual(["start-assets", "start-world", "stop-world", "stop-assets"]);
  });

  it("freezes registrations when startup begins", async () => {
    const runtime = new RuntimeOperations();
    const started = await runtime.start();
    expect(started.ok).toBe(true);
    expect(() => runtime.registerService({ id: "late", start: () => undefined })).toThrow(/frozen/u);
    expect(() => runtime.registerSection({
      key: "late", capture: () => 1, validate: (value): value is number => typeof value === "number", restore: () => undefined,
    })).toThrow(/frozen/u);
  });

  it("dispatches typed commands and logs rejected commands as incidents", async () => {
    const runtime = new RuntimeOperations();
    runtime.registerCommand({
      name: "player.addCoins",
      version: 1,
      requiredScopes: ["player.write"],
      validate: (value): value is { coins: number } =>
        typeof value === "object" && value !== null && typeof (value as { coins?: unknown }).coins === "number",
      execute: (payload) => ({ coins: payload.coins }),
    });
    await runtime.start();
    const principal = { principalId: "p1", sessionId: "s1", scopes: new Set(["player.write"]) };
    const accepted = runtime.dispatch("player.addCoins", { coins: 12 }, principal, "req-1", "op-1");
    expect(accepted.status).toBe("accepted");
    const replay = runtime.dispatch("player.addCoins", { coins: 12 }, principal, "req-2", "op-1");
    expect(replay.status).toBe("replayed");
    const rejected = runtime.dispatch("missing.command", {}, principal, "req-3");
    expect(rejected.status).toBe("rejected");
    expect(runtime.snapshot().commands.accepted).toBe(1);
    expect(runtime.snapshot().commands.replayed).toBe(1);
    expect(runtime.snapshot().diagnostics.incidentCount).toBeGreaterThan(0);
  });

  it("saves named state sections and restores them from an integrity-checked envelope", async () => {
    const runtime = new RuntimeOperations({ clock: { fixedStepMs: 10 } });
    let health = 75;
    let coins = 14;
    runtime.registerSection({
      key: "player.health",
      capture: () => health,
      validate: (value): value is number => typeof value === "number" && value >= 0 && value <= 100,
      restore: (value) => { health = value; },
    });
    runtime.registerSection({
      key: "player.coins",
      capture: () => coins,
      validate: (value): value is number => typeof value === "number" && value >= 0,
      restore: (value) => { coins = value; },
    });
    await runtime.start();
    const saved = await runtime.save("slot-1");
    expect(saved.ok).toBe(true);
    health = 1;
    coins = 0;
    const loaded = await runtime.load("slot-1");
    expect(loaded.ok).toBe(true);
    expect(health).toBe(75);
    expect(coins).toBe(14);
  });

  it("rolls back already-restored sections when a later section restore fails", async () => {
    const runtime = new RuntimeOperations();
    let a = 1;
    let b = 2;
    let rejectSavedB = false;
    runtime.registerSection({
      key: "a", capture: () => a,
      validate: (value): value is number => typeof value === "number",
      restore: (value) => { a = value; },
    });
    runtime.registerSection({
      key: "b", capture: () => b,
      validate: (value): value is number => typeof value === "number",
      restore: (value) => {
        if (rejectSavedB && value === 2) throw new Error("restore failure");
        b = value;
      },
    });
    await runtime.start();
    await runtime.save("rollback");
    a = 10;
    b = 20;
    rejectSavedB = true;
    const result = await runtime.load("rollback");
    expect(result.ok).toBe(false);
    expect(a).toBe(10);
    expect(b).toBe(20);
    expect(runtime.state).toBe("running");
  });

  it("reports a degraded state when rollback itself fails", async () => {
    const runtime = new RuntimeOperations();
    let a = 1;
    let b = 2;
    let afterSave = false;
    runtime.registerSection({
      key: "a", capture: () => a,
      validate: (value): value is number => typeof value === "number",
      restore: (value) => {
        if (afterSave && value === 10) throw new Error("rollback unavailable");
        a = value;
      },
    });
    runtime.registerSection({
      key: "b", capture: () => b,
      validate: (value): value is number => typeof value === "number",
      restore: (value) => {
        if (afterSave && value === 2) throw new Error("restore unavailable");
        b = value;
      },
    });
    await runtime.start();
    await runtime.save("broken-rollback");
    a = 10;
    b = 20;
    afterSave = true;
    const result = await runtime.load("broken-rollback");
    expect(result.ok).toBe(false);
    expect(runtime.state).toBe("degraded");
  });

  it("rejects frame stepping and command dispatch while stopped", async () => {
    const runtime = new RuntimeOperations();
    await runtime.start();
    await runtime.shutdown();
    expect(() => runtime.frame(16)).toThrow(/running/u);
    expect(() => runtime.dispatch("missing", {}, {
      principalId: "p", sessionId: "s", scopes: new Set(),
    }, "req")).toThrow(RuntimeFault);
  });

  it("emits a coherent immutable runtime snapshot", async () => {
    const runtime = new RuntimeOperations();
    await runtime.start();
    runtime.frame(16);
    const snapshot = runtime.snapshot();
    expect(snapshot).toMatchObject({ state: "running", frameNumber: 1 });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.tick).toBe(runtime.clock.tick);
  });
});
