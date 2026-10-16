import { describe, expect, it } from "vitest";
import { CircuitBreaker, DiagnosticBuffer, RuntimeHealthGate } from "../../src/engine-ts/r44/diagnostics.ts";
import { MetricAnomalyDetector, TelemetryHub } from "../../src/engine-ts/r44/telemetry.ts";

describe("R44 telemetry and diagnostics", () => {
  it("uses a fixed-capacity ring and computes robust percentiles", () => {
    const telemetry = new TelemetryHub({ capacity: 5, maxMetricNames: 16 });
    for (let value = 1; value <= 8; value += 1) telemetry.record("frame.ms", value, value, value);
    expect(telemetry.ring.size).toBe(5);
    const summary = telemetry.summary("frame.ms");
    expect(summary?.count).toBe(5);
    expect(summary?.min).toBe(4);
    expect(summary?.max).toBe(8);
    expect(summary?.p95).toBe(8);
    expect(summary?.average).toBe(6);
  });

  it("caps metric names and normalizes tags", () => {
    const telemetry = new TelemetryHub({ capacity: 32, maxMetricNames: 8 });
    for (let index = 0; index < 32; index += 1) telemetry.record("unique." + index, index, index, index);
    expect(telemetry.listNames().length).toBe(8);
    expect(telemetry.droppedNames).toBeGreaterThan(0);
    const tagTelemetry = new TelemetryHub({ capacity: 32, maxMetricNames: 8 });
    tagTelemetry.record("stable", 1, 1, 1, { "unsafe key": "ignored", platform: "web".repeat(60) });
    const item = tagTelemetry.ring.latest("stable");
    expect(item?.tags["unsafe key"]).toBeUndefined();
    expect(item?.tags.platform?.length).toBeLessThanOrEqual(96);
  });

  it("exports integrity-checked snapshots and rejects tampering", () => {
    const telemetry = new TelemetryHub({ capacity: 32 });
    telemetry.record("cpu.ms", 2.4, 1, 10);
    telemetry.increment("boot", 1, 1, 10);
    telemetry.setGauge("queue", 4, 1, 10);
    const exported = telemetry.exportSnapshot();
    const restored = new TelemetryHub({ capacity: 32 });
    expect(restored.importSnapshot(exported).ok).toBe(true);
    expect(restored.summary("cpu.ms")?.latest).toBe(2.4);
    expect(restored.counter("boot")).toBe(1);
    expect(restored.gauge("queue")).toBe(4);
    expect(restored.importSnapshot({ ...exported, digest: "bad" }).ok).toBe(false);
  });

  it("detects repeated deviations after warmup and respects cooldown", () => {
    const detector = new MetricAnomalyDetector({ minSamples: 4, warmupSamples: 4, sigmaThreshold: 3, cooldownFrames: 5 });
    for (let frame = 0; frame < 8; frame += 1) detector.observe(10, frame);
    expect(detector.observe(40, 8).anomalous).toBe(true);
    expect(detector.observe(50, 9).anomalous).toBe(false);
    expect(detector.observe(60, 14).anomalous).toBe(true);
  });

  it("deduplicates noisy diagnostic events while preserving aggregate counts", () => {
    const diagnostics = new DiagnosticBuffer({ capacity: 16, dedupeWindowMs: 100 });
    const input = {
      timeMs: 10, frame: 1, subsystem: "assets", code: "timeout",
      severity: "warning" as const, message: "Asset timed out.", recoverable: true,
      details: { key: "tree-a" },
    };
    expect(diagnostics.emit(input)).toBeDefined();
    expect(diagnostics.emit({ ...input, timeMs: 20 })).toBeUndefined();
    expect(diagnostics.recent()).toHaveLength(1);
    expect(diagnostics.faults()[0]?.count).toBe(2);
  });

  it("opens, probes, and resets a circuit breaker", () => {
    const breaker = new CircuitBreaker("network", { failureThreshold: 2, successThreshold: 2, openDurationMs: 50, halfOpenMaxCalls: 1 });
    breaker.recordFailure(0, "a");
    breaker.recordFailure(1, "b");
    expect(breaker.state).toBe("open");
    expect(breaker.canExecute(20).allowed).toBe(false);
    expect(breaker.canExecute(60).state).toBe("half-open");
    breaker.recordSuccess();
    expect(breaker.state).toBe("half-open");
    breaker.canExecute(61);
    breaker.recordSuccess();
    expect(breaker.state).toBe("closed");
    breaker.reset();
    expect(breaker.state).toBe("closed");
  });

  it("grades subsystem health and recommends low-scoring components", () => {
    const gate = new RuntimeHealthGate();
    const decision = gate.evaluate([
      { key: "frame", score: 96, weight: 4 },
      { key: "network", score: 34, weight: 2, detail: "rtt is high" },
    ]);
    expect(decision.score).toBeLessThan(90);
    expect(decision.recommendations).toContain("inspect.network");
    expect(["degraded", "critical"]).toContain(decision.status);
  });
});
