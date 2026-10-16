import { describe, expect, it } from "vitest";
import { R44CircuitBreaker, R44IncidentSupervisor, R44RetryBudget } from "../../../src/engine-ts/r44/incidentSupervisor.js";
import { R44PerformanceGovernor } from "../../../src/engine-ts/r44/performanceGovernor.js";
import { R44FeatureGateRegistry } from "../../../src/engine-ts/r44/featureGates.js";
import { R44ResourceLeaseRegistry, R44ResourceScope } from "../../../src/engine-ts/r44/resourceScope.js";

describe("R44 performance governor", () => {
  it("promotes pressure after sustained budget violations and recovers with hysteresis", () => {
    const governor = new R44PerformanceGovernor({
      capacity: 2,
      minimumSamplesForPercentile: 2,
      promoteAfter: 1,
      recoverAfter: 2,
      budgets: { frameMs: 10, simulationMs: 5, renderMs: 5, memoryMb: 100, networkRttMs: 50, activeEntities: 20, queuedTasks: 20 },
    });
    const make = (tick: number, frameMs: number) => ({
      tick, frameMs, simulationMs: 2, renderMs: 2, memoryMb: 20, networkRttMs: 10,
      activeEntities: 10, queuedTasks: 10,
    });
    expect(governor.sample(make(1, 30)).state).toBe("elevated");
    expect(governor.sample(make(2, 30)).state).toBe("constrained");
    expect(governor.sample(make(3, 30)).state).toBe("emergency");
    expect(governor.sample(make(4, 4)).state).toBe("emergency");
    expect(governor.sample(make(5, 4)).state).toBe("emergency");
    expect(governor.sample(make(6, 4)).state).toBe("constrained");
  });

  it("rejects tick regressions and exposes actionable recommendations", () => {
    const governor = new R44PerformanceGovernor({
      budgets: { frameMs: 1 },
      minimumSamplesForPercentile: 1,
      promoteAfter: 1,
    });
    const sample = { tick: 8, frameMs: 9, simulationMs: 1, renderMs: 1, memoryMb: 100, networkRttMs: 20, activeEntities: 1, queuedTasks: 1 };
    const report = governor.sample(sample);
    expect(report.exceededBudgets).toContain("frameMs");
    expect(report.recommendations.join(" ")).toContain("resolution");
    expect(() => governor.sample({ ...sample, tick: 7 })).toThrow();
  });

  it("resets its rolling window without losing configured budgets", () => {
    const governor = new R44PerformanceGovernor({ capacity: 8 });
    governor.sample({ tick: 1, frameMs: 1, simulationMs: 1, renderMs: 1, memoryMb: 1, networkRttMs: 1, activeEntities: 1, queuedTasks: 1 });
    governor.reset();
    expect(governor.sampleCount).toBe(0);
    expect(governor.report().metrics.frameMs.count).toBe(0);
    expect(governor.budgets.frameMs).toBeGreaterThan(0);
  });
});

describe("R44 incident containment", () => {
  it("opens a circuit after repeated failures and closes only after probes succeed", () => {
    const circuit = new R44CircuitBreaker("asset-loader", { failureThreshold: 2, openForTicks: 3, successThreshold: 2, maxProbeCalls: 1 });
    let permit = circuit.acquire(0);
    if (permit.allowed) permit.complete(false, 0);
    permit = circuit.acquire(1);
    if (permit.allowed) permit.complete(false, 1);
    expect(circuit.state).toBe("open");
    expect(circuit.acquire(3).allowed).toBe(false);
    permit = circuit.acquire(4);
    expect(permit.allowed && permit.probe).toBe(true);
    if (permit.allowed) permit.complete(true, 4);
    expect(circuit.state).toBe("half-open");
    permit = circuit.acquire(5);
    if (permit.allowed) permit.complete(true, 5);
    expect(circuit.state).toBe("closed");
  });

  it("does not allow a permit to complete twice", () => {
    const circuit = new R44CircuitBreaker("test");
    const permit = circuit.acquire(0);
    if (!permit.allowed) throw new Error("expected permit");
    permit.complete(true, 0);
    expect(() => permit.complete(true, 0)).toThrow();
  });

  it("applies bounded retry tokens and deterministic backoff", () => {
    const retry = new R44RetryBudget({ capacity: 2, refillPerTick: 0.5, baseDelayTicks: 2, maxDelayTicks: 20, maxAttempt: 3 });
    expect(retry.request("terrain", 0).delayTicks).toBe(2);
    expect(retry.request("terrain", 2).delayTicks).toBe(4);
    expect(retry.request("terrain", 5).allowed).toBe(false);
    expect(retry.request("other", 8).allowed).toBe(true);
    retry.succeed("terrain");
    expect(retry.request("terrain", 12).attempt).toBe(1);
  });

  it("coalesces repeated incidents and retains bounded active history", () => {
    const supervisor = new R44IncidentSupervisor({ historyCapacity: 2, activeCapacity: 3, coalesceWindowTicks: 5 });
    const first = supervisor.report({ subsystem: "network", code: "timeout", message: "Connection timed out", severity: "warning", tick: 1 });
    const second = supervisor.report({ subsystem: "network", code: "timeout", message: "Connection timed out", severity: "error", tick: 3 });
    expect(second.key).toBe(first.key);
    expect(second.occurrences).toBe(2);
    expect(supervisor.snapshot().totalCoalesced).toBe(1);
    supervisor.report({ subsystem: "asset", code: "missing", message: "Model missing", severity: "warning", tick: 9 });
    supervisor.report({ subsystem: "storage", code: "read", message: "Storage read failure", severity: "error", tick: 10 });
    expect(supervisor.snapshot().recent.length).toBe(2);
    expect(supervisor.resolveBySubsystem("network")).toBe(1);
  });
});

describe("R44 resource lifecycle", () => {
  it("disposes scope entries in reverse order and continues after failure", async () => {
    const order: string[] = [];
    const scope = new R44ResourceScope("scope");
    scope.defer(() => { order.push("first"); }, { owner: "test" });
    scope.defer(() => { order.push("second"); throw new Error("cannot dispose"); }, { owner: "test" });
    scope.defer(async () => { order.push("third"); }, { owner: "test" });
    const report = await scope.disposeDetailed();
    expect(order).toEqual(["third", "second", "first"]);
    expect(report.failures.length).toBe(1);
    expect(scope.state).toBe("disposed");
    await expect(scope.disposeDetailed()).resolves.toEqual(report);
  });

  it("rejects registration after disposal and makes release idempotent", async () => {
    const scope = new R44ResourceScope("scope");
    const handle = scope.defer(() => undefined);
    handle.release();
    handle.release();
    await scope.dispose();
    expect(() => scope.defer(() => undefined)).toThrow();
    expect(scope.activeCount).toBe(0);
  });

  it("reference counts leases and reports aged allocations", async () => {
    let disposed = 0;
    const registry = new R44ResourceLeaseRegistry({ maxLeases: 4, maxEstimatedBytes: 100, maxAgeTicks: 2 });
    registry.advance(1);
    const lease = registry.register("gpu-buffer", {
      owner: "renderer", kind: "buffer", estimatedBytes: 40, acquiredTick: 1, release: () => { disposed += 1; },
    });
    const retained = lease.retain();
    registry.advance(5);
    expect(registry.reportLeaks().length).toBe(1);
    expect(await lease.release()).toBe(true);
    expect(disposed).toBe(0);
    expect(await retained.release()).toBe(true);
    expect(disposed).toBe(1);
    expect(registry.estimatedBytes).toBe(0);
    expect(await retained.release()).toBe(false);
  });
});

describe("R44 feature gates", () => {
  it("assigns rollouts deterministically for a stable subject", () => {
    const gates = new R44FeatureGateRegistry();
    gates.register({ key: "new-renderer", enabledByDefault: false, rolloutPercent: 50, seed: "release-44" });
    const first = gates.evaluate("new-renderer", "user-17");
    for (let index = 0; index < 10; index += 1) {
      expect(gates.evaluate("new-renderer", "user-17").enabled).toBe(first.enabled);
      expect(gates.evaluate("new-renderer", "user-17").assignmentPercent).toBe(first.assignmentPercent);
    }
  });

  it("honours dependency and emergency overrides", () => {
    const gates = new R44FeatureGateRegistry();
    gates.register({ key: "physics-v2", enabledByDefault: true });
    gates.register({ key: "cloth-v2", enabledByDefault: true, requires: ["physics-v2"] });
    expect(gates.isEnabled("cloth-v2", "session")).toBe(true);
    gates.setEmergencyOverride("physics-v2", false, 7, "incident-44");
    expect(gates.evaluate("physics-v2", "session", 7).reason).toBe("emergency-disabled");
    expect(gates.isEnabled("cloth-v2", "session", 7)).toBe(false);
    gates.setEmergencyOverride("physics-v2", true, 8, "mitigation-complete");
    expect(gates.isEnabled("cloth-v2", "session", 8)).toBe(true);
  });

  it("resolves symmetric conflict declarations without recursion", () => {
    const gates = new R44FeatureGateRegistry();
    gates.register({ key: "path-a", enabledByDefault: true, conflictsWith: ["path-b"] });
    gates.register({ key: "path-b", enabledByDefault: true, conflictsWith: ["path-a"] });
    expect(gates.isEnabled("path-a", "s")).toBe(true);
    expect(gates.isEnabled("path-b", "s")).toBe(false);
  });
});
