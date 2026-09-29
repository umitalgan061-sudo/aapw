import { describe, expect, it } from "vitest";
import {
  AdaptiveQualityDirectorV15,
  FixedFrameSchedulerV15,
  MemorySaveStorageV15,
  PredictiveWorldPartitionV15,
  RenderTelemetryBufferV15,
  RuntimeDiagnosticsV15,
  RuntimeSecurityPolicyV15,
  SecureNetworkEnvelopeV15,
  AssetPipelineV15,
  sanitizeActionsV15,
  frameV15,
} from "../../src/3d/modern/v15/index.ts";

describe("v15 security policy", () => {
  it("rejects prototype-pollution keys", () => {
    const policy = new RuntimeSecurityPolicyV15();
    const report = policy.inspect(JSON.parse('{"constructor":{"prototype":{"polluted":true}}}'), "remote");
    expect(report.accepted).toBe(false);
    expect(report.issues.some(issue => issue.code === "unsafe-key")).toBe(true);
  });

  it("rejects deep and oversized hostile values", () => {
    const policy = new RuntimeSecurityPolicyV15({ maxDepth: 2, maxStringLength: 8 });
    const report = policy.inspect({ a: { b: { c: "0123456789" } } }, "remote");
    expect(report.accepted).toBe(false);
    expect(report.issues.length).toBeGreaterThan(0);
  });

  it("sanitizes actions to the registered token shape", () => {
    const actions = sanitizeActionsV15([" attack ", "<bad>", "combat.attack", "combat.attack", "x".repeat(200)]);
    expect(actions).toContain("combat.attack");
    expect(actions).not.toContain("<bad>");
    expect(new Set(actions).size).toBe(actions.length);
  });
});

describe("v15 diagnostics", () => {
  function makeDiagnostics() {
    return new RuntimeDiagnosticsV15({
      capabilities: {
        backend: "webgpu", webgpuAvailable: true, webgl2Available: true, mobile: false,
        touch: false, reducedMotion: false, batterySaver: false, hardwareConcurrency: 8,
        deviceMemoryGb: 16, devicePixelRatio: 1, maxTextureDimension: 8192, timestamp: 1,
      },
      quality: new AdaptiveQualityDirectorV15({ initial: "high" }),
      scheduler: new FixedFrameSchedulerV15(),
      telemetry: new RenderTelemetryBufferV15(),
      world: new PredictiveWorldPartitionV15(),
      assets: new AssetPipelineV15(),
      network: new SecureNetworkEnvelopeV15(),
    });
  }

  it("turns observable budget violations into structured issues", () => {
    const diagnostics = makeDiagnostics();
    const snapshot = diagnostics.capture({
      frame: frameV15(1),
      frameMs: 50,
      cpuMs: 20,
      gpuMs: 25,
      drawCalls: 2_000,
      triangles: 3_000_000,
      visibleObjects: 2_000,
      textureBytes: 700_000_000,
      memoryPressure: 1,
      thermalPressure: 1,
      timestampMs: 16,
    }, 99);
    expect(snapshot.issues.length).toBeGreaterThan(4);
    expect(["degraded", "critical"]).toContain(snapshot.health.state);
  });

  it("keeps a bounded history", () => {
    const diagnostics = new RuntimeDiagnosticsV15({
      capabilities: {
        backend: "webgl2", webgpuAvailable: false, webgl2Available: true, mobile: false,
        touch: false, reducedMotion: false, batterySaver: false, hardwareConcurrency: 4,
        deviceMemoryGb: null, devicePixelRatio: 1, maxTextureDimension: null, timestamp: 1,
      },
      quality: new AdaptiveQualityDirectorV15(),
      scheduler: new FixedFrameSchedulerV15(),
      telemetry: new RenderTelemetryBufferV15(),
      world: new PredictiveWorldPartitionV15(),
      assets: new AssetPipelineV15(),
      network: new SecureNetworkEnvelopeV15(),
    }, 8);
    const observation = {
      frame: frameV15(1), frameMs: 16, cpuMs: 7, gpuMs: 8, drawCalls: 100,
      triangles: 100_000, visibleObjects: 50, textureBytes: 1_000_000,
      memoryPressure: 0.1, thermalPressure: 0.1, timestampMs: 1,
    };
    for (let index = 1; index <= 20; index += 1) diagnostics.capture({ ...observation, frame: frameV15(index) }, index);
    expect(diagnostics.history()).toHaveLength(8);
    expect(diagnostics.summarize().samples).toBe(8);
  });
});
