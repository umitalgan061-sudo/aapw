import { describe, expect, it, vi } from "vitest";
import { RuntimeFault, ServiceLifecycleGraph } from "../../src/engine-ts/r45";

describe("ServiceLifecycleGraph", () => {
  it("plans dependencies before dependents with stable ordering", () => {
    const graph = new ServiceLifecycleGraph();
    graph.register({ id: "renderer", dependsOn: ["assets"], start: () => undefined });
    graph.register({ id: "assets", start: () => undefined });
    graph.register({ id: "input", dependsOn: ["assets"], start: () => undefined });
    expect(graph.plan().map(String)).toEqual(["assets", "input", "renderer"]);
  });

  it("detects missing dependencies and dependency cycles", () => {
    const missing = new ServiceLifecycleGraph();
    missing.register({ id: "renderer", dependsOn: ["assets"], start: () => undefined });
    expect(() => missing.plan()).toThrow(/not registered/u);

    const cyclic = new ServiceLifecycleGraph();
    cyclic.register({ id: "a", dependsOn: ["b"], start: () => undefined });
    cyclic.register({ id: "b", dependsOn: ["a"], start: () => undefined });
    expect(() => cyclic.plan()).toThrow(/cycle/u);
  });

  it("starts in dependency order and stops in reverse dependency order", async () => {
    const calls: string[] = [];
    const graph = new ServiceLifecycleGraph();
    graph.register({ id: "a", start: () => { calls.push("start-a"); }, stop: () => { calls.push("stop-a"); } });
    graph.register({ id: "b", dependsOn: ["a"], start: () => { calls.push("start-b"); }, stop: () => { calls.push("stop-b"); } });
    await graph.startAll();
    expect(graph.get("a")?.state).toBe("ready");
    expect(graph.get("b")?.state).toBe("ready");
    await graph.stopAll();
    expect(calls).toEqual(["start-a", "start-b", "stop-b", "stop-a"]);
    expect(graph.get("a")?.state).toBe("stopped");
  });

  it("rolls back previously started services after a startup fault", async () => {
    const calls: string[] = [];
    const graph = new ServiceLifecycleGraph();
    graph.register({ id: "a", start: () => calls.push("start-a"), stop: () => calls.push("stop-a") });
    graph.register({ id: "b", dependsOn: ["a"], start: () => { throw new Error("boot failed"); } });
    await expect(graph.startAll()).rejects.toThrow("boot failed");
    expect(calls).toEqual(["start-a", "stop-a"]);
    expect(graph.get("a")?.state).toBe("stopped");
    expect(graph.get("b")?.state).toBe("failed");
  });

  it("captures health degradation and later recovery", async () => {
    let healthy = false;
    const graph = new ServiceLifecycleGraph();
    graph.register({ id: "service", start: () => undefined, health: () => ({ healthy, detail: "probe" }) });
    await graph.startAll();
    await graph.inspectHealth();
    expect(graph.get("service")?.state).toBe("degraded");
    healthy = true;
    await graph.inspectHealth();
    expect(graph.get("service")?.state).toBe("ready");
  });

  it("serializes concurrent start requests instead of starting a service twice", async () => {
    const start = vi.fn(async () => undefined);
    const graph = new ServiceLifecycleGraph();
    graph.register({ id: "service", start });
    await Promise.all([graph.startAll(), graph.startAll()]);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("does not permit an invalid public state transition", async () => {
    const graph = new ServiceLifecycleGraph();
    graph.register({ id: "service", start: () => undefined });
    await graph.startAll();
    const record = graph.get("service");
    expect(record?.state).toBe("ready");
    expect(() => new RuntimeFault("CONFLICT", "x", "test")).not.toThrow();
  });

  it("retains bounded event history with monotonic sequence values", async () => {
    const graph = new ServiceLifecycleGraph({ eventCapacity: 2 });
    graph.register({ id: "service", start: () => undefined, stop: () => undefined });
    await graph.startAll();
    await graph.stopAll();
    const events = graph.events();
    expect(events).toHaveLength(2);
    expect(events[1]!.sequence).toBeGreaterThan(events[0]!.sequence);
  });
});
