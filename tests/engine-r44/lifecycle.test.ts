import { describe, expect, it } from "vitest";
import { RuntimeLifecycle } from "../../src/engine-ts/r44/lifecycle.ts";

describe("RuntimeLifecycle", () => {
  it("starts services in dependency order and stops in reverse order", async () => {
    const events: string[] = [];
    const lifecycle = new RuntimeLifecycle({ now: () => events.length });
    lifecycle.register({ id: "renderer", dependencies: ["assets"], start: () => { events.push("start-renderer"); return 3; }, stop: () => { events.push("stop-renderer"); } });
    lifecycle.register({ id: "assets", start: () => { events.push("start-assets"); return 2; }, stop: () => { events.push("stop-assets"); } });
    lifecycle.register({ id: "world", dependencies: ["assets"], start: () => { events.push("start-world"); return 1; }, stop: () => { events.push("stop-world"); } });
    const started = await lifecycle.start();
    expect(started.success).toBe(true);
    expect(started.started[0]).toBe("assets");
    expect(events.indexOf("start-assets")).toBeLessThan(events.indexOf("start-renderer"));
    expect(lifecycle.statuses().every((service) => service.state === "ready")).toBe(true);
    const stopped = await lifecycle.stop();
    expect(stopped.success).toBe(true);
    expect(events.indexOf("stop-renderer")).toBeLessThan(events.indexOf("stop-assets"));
    expect(lifecycle.statuses().every((service) => service.state === "stopped")).toBe(true);
  });

  it("rolls back successful critical dependencies when startup fails", async () => {
    const events: string[] = [];
    const lifecycle = new RuntimeLifecycle();
    lifecycle.register({ id: "first", start: () => { events.push("start-first"); return true; }, stop: () => { events.push("stop-first"); } });
    lifecycle.register({ id: "second", dependencies: ["first"], start: () => { throw new Error("startup failed"); } });
    const result = await lifecycle.start();
    expect(result.success).toBe(false);
    expect(events).toContain("stop-first");
    expect(lifecycle.state).toBe("failed");
  });

  it("reports missing dependencies and cycles rather than partially starting", async () => {
    const missing = new RuntimeLifecycle();
    missing.register({ id: "a", dependencies: ["not-there"], start: () => undefined });
    const report = await missing.start();
    expect(report.success).toBe(false);
    expect(report.failures[0]?.message).toContain("Missing dependency");
    const cycle = new RuntimeLifecycle();
    cycle.register({ id: "a", dependencies: ["b"] });
    cycle.register({ id: "b", dependencies: ["a"] });
    expect(() => cycle.plan()).toThrow(/cycle/i);
  });

  it("supports non-critical degradation while keeping runtime online", async () => {
    const lifecycle = new RuntimeLifecycle();
    lifecycle.register({ id: "optional", critical: false, start: () => { throw new Error("offline"); } });
    const report = await lifecycle.start();
    expect(report.success).toBe(true);
    expect(report.failures).toHaveLength(1);
    expect(lifecycle.state).toBe("ready");
  });

  it("uses health callbacks to mark services degraded and recovered", async () => {
    let healthy = true;
    const lifecycle = new RuntimeLifecycle();
    lifecycle.register({ id: "worker", start: () => 1, health: () => healthy });
    await lifecycle.start();
    healthy = false;
    expect(lifecycle.healthCheck()[0]?.state).toBe("degraded");
    healthy = true;
    expect(lifecycle.healthCheck()[0]?.state).toBe("ready");
  });

  it("makes registration immutable after startup begins", async () => {
    const lifecycle = new RuntimeLifecycle();
    await lifecycle.start();
    expect(lifecycle.register({ id: "late" }).ok).toBe(false);
  });
});
