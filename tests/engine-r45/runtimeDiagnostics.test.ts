import { describe, expect, it } from "vitest";
import { RuntimeDiagnosticLedger } from "../../src/engine-ts/r45";

describe("RuntimeDiagnosticLedger", () => {
  it("deduplicates repeated incidents without losing occurrence count", () => {
    const ledger = new RuntimeDiagnosticLedger({ dedupeWindowTicks: 10 });
    const first = ledger.recordIncident({
      tick: 1, component: "renderer", code: "DEVICE_LOST", severity: "warning", message: "device lost",
      fingerprintData: { reason: "gpu-reset" },
    });
    const second = ledger.recordIncident({
      tick: 3, component: "renderer", code: "DEVICE_LOST", severity: "error", message: "device recovered slowly",
      fingerprintData: { reason: "gpu-reset" },
    });
    expect(first.sequence).toBe(second.sequence);
    expect(second.occurrences).toBe(2);
    expect(second.severity).toBe("error");
    expect(second.firstSeenTick).toBe(1);
    expect(second.lastSeenTick).toBe(3);
  });

  it("keeps metric windows bounded and computes robust summary statistics", () => {
    const ledger = new RuntimeDiagnosticLedger();
    for (let value = 1; value <= 600; value += 1) ledger.sample(value, "frameMs", value, "ms");
    const metric = ledger.metric("frameMs");
    expect(metric.count).toBe(512);
    expect(metric.latest).toBe(600);
    expect(metric.min).toBe(89);
    expect(metric.max).toBe(600);
    expect(metric.p95).toBeGreaterThan(550);
  });

  it("bounds incident and sample history while exposing dropped counters", () => {
    const ledger = new RuntimeDiagnosticLedger({ incidentCapacity: 2, sampleCapacity: 2 });
    for (let tick = 1; tick <= 4; tick += 1) {
      ledger.recordIncident({ tick, component: "runtime", code: "E" + tick, severity: "warning", message: "warning " + tick });
      ledger.sample(tick, "queue", tick, "items");
    }
    expect(ledger.summary()).toMatchObject({ uniqueIncidents: 4, droppedIncidents: 2, droppedSamples: 2 });
  });

  it("requires monotonic-safe tick and finite numeric telemetry", () => {
    const ledger = new RuntimeDiagnosticLedger();
    expect(() => ledger.sample(1, "cpu", Number.NaN, "%")).toThrow();
    expect(() => ledger.recordIncident({
      tick: -1, component: "runtime", code: "bad", severity: "error", message: "bad tick",
    })).toThrow();
  });

  it("acknowledges non-critical active incidents but preserves critical incidents", () => {
    const ledger = new RuntimeDiagnosticLedger();
    ledger.recordIncident({ tick: 1, component: "asset", code: "MISS", severity: "warning", message: "missing" });
    ledger.recordIncident({ tick: 1, component: "runtime", code: "FATAL", severity: "critical", message: "fatal" });
    expect(ledger.acknowledgeThrough(1)).toBe(1);
    expect(ledger.summary().uniqueIncidents).toBe(1);
  });
});
