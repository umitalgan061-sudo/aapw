import {
  checksumV15,
  type DeviceCapabilitiesV15,
  type FrameObservationV15,
  type QualityDecisionV15,
  type RuntimeHealthV15,
} from "./types.ts";
import type { AdaptiveQualityDirectorV15 } from "./adaptiveQuality.ts";
import type { FixedFrameSchedulerV15 } from "./frameScheduler.ts";
import type { RenderTelemetryBufferV15 } from "./renderTelemetry.ts";
import type { PredictiveWorldPartitionV15 } from "./worldPartition.ts";
import type { AssetPipelineV15 } from "./assetPipeline.ts";
import type { SecureNetworkEnvelopeV15 } from "./networkEnvelope.ts";

export interface DiagnosticIssueV15 {
  readonly severity: "info" | "warn" | "error";
  readonly code: string;
  readonly value: number | string | boolean;
  readonly threshold?: number;
  readonly message: string;
}

export interface DiagnosticSnapshotV15 {
  readonly version: 15;
  readonly timestampMs: number;
  readonly health: RuntimeHealthV15;
  readonly issues: readonly DiagnosticIssueV15[];
  readonly metrics: Readonly<Record<string, number>>;
  readonly checksum: number;
}

export interface DiagnosticSourcesV15 {
  readonly capabilities: DeviceCapabilitiesV15;
  readonly quality: AdaptiveQualityDirectorV15;
  readonly scheduler: FixedFrameSchedulerV15;
  readonly telemetry: RenderTelemetryBufferV15;
  readonly world: PredictiveWorldPartitionV15;
  readonly assets: AssetPipelineV15;
  readonly network: SecureNetworkEnvelopeV15<unknown>;
}

export class RuntimeDiagnosticsV15 {
  readonly #sources: DiagnosticSourcesV15;
  readonly #history: DiagnosticSnapshotV15[] = [];
  readonly #capacity: number;

  constructor(sources: DiagnosticSourcesV15, capacity = 120) {
    this.#sources = sources;
    this.#capacity = Math.max(8, Math.min(2_000, Math.floor(capacity)));
  }

  capture(observation: FrameObservationV15, timestampMs = Date.now()): DiagnosticSnapshotV15 {
    const quality = this.#sources.quality.decision("diagnostics");
    const health = this.#deriveHealth(observation, quality);
    const issues = this.#issues(observation, quality, health);
    const metrics = this.#metrics(observation, quality);
    const snapshot = Object.freeze({
      version: 15 as const,
      timestampMs,
      health,
      issues: Object.freeze(issues),
      metrics: Object.freeze(metrics),
      checksum: checksumV15({ health, issues, metrics }),
    });
    this.#history.push(snapshot);
    if (this.#history.length > this.#capacity) this.#history.splice(0, this.#history.length - this.#capacity);
    return snapshot;
  }

  latest(): DiagnosticSnapshotV15 | undefined { return this.#history[this.#history.length - 1]; }
  history(): readonly DiagnosticSnapshotV15[] { return Object.freeze([...this.#history]); }

  summarize(): Readonly<{
    samples: number;
    critical: number;
    degraded: number;
    healthy: number;
    averageFrameMs: number;
    p95FrameMs: number;
    latestChecksum: number;
  }> {
    const samples = this.#history.length;
    let critical = 0;
    let degraded = 0;
    for (const item of this.#history) {
      if (item.health.state === "critical") critical += 1;
      else if (item.health.state === "degraded") degraded += 1;
    }
    const healthy = samples - critical - degraded;
    const frames = this.#history.map(item => item.health.observation.frameMs).sort((a, b) => a - b);
    const average = frames.length ? frames.reduce((sum, value) => sum + value, 0) / frames.length : 0;
    const index = frames.length ? Math.min(frames.length - 1, Math.ceil((frames.length - 1) * 0.95)) : 0;
    return Object.freeze({
      samples,
      critical,
      degraded,
      healthy,
      averageFrameMs: Number(average.toFixed(3)),
      p95FrameMs: Number((frames[index] ?? 0).toFixed(3)),
      latestChecksum: this.latest()?.checksum ?? 0,
    });
  }

  clear(): void { this.#history.length = 0; }

  #deriveHealth(observation: FrameObservationV15, quality: QualityDecisionV15): RuntimeHealthV15 {
    const issues = this.#issues(observation, quality, undefined);
    let penalty = 0;
    for (const issue of issues) penalty += issue.severity === "error" ? 18 : issue.severity === "warn" ? 8 : 0;
    const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
    return Object.freeze({
      state: score < 45 ? "critical" : score < 72 ? "degraded" : "healthy",
      score,
      reasons: Object.freeze(issues.filter(issue => issue.severity !== "info").map(issue => issue.code)),
      observation,
      quality,
      capabilities: this.#sources.capabilities,
    });
  }

  #issues(observation: FrameObservationV15, quality: QualityDecisionV15, health: RuntimeHealthV15 | undefined): DiagnosticIssueV15[] {
    const issues: DiagnosticIssueV15[] = [];
    if (observation.frameMs > 33.33) issues.push({ severity: "error", code: "frame-p95-risk", value: observation.frameMs, threshold: 33.33, message: "frame latency exceeds interactive budget" });
    else if (observation.frameMs > 20) issues.push({ severity: "warn", code: "frame-budget", value: observation.frameMs, threshold: 20, message: "frame latency is above preferred budget" });
    if (observation.cpuMs > 16) issues.push({ severity: "warn", code: "cpu-budget", value: observation.cpuMs, threshold: 16, message: "cpu time is above preferred budget" });
    if (observation.gpuMs !== null && observation.gpuMs > 18) issues.push({ severity: "warn", code: "gpu-budget", value: observation.gpuMs, threshold: 18, message: "gpu time is above preferred budget" });
    if (observation.memoryPressure >= 0.9) issues.push({ severity: "error", code: "memory-critical", value: observation.memoryPressure, threshold: 0.9, message: "memory pressure is critical" });
    else if (observation.memoryPressure >= 0.75) issues.push({ severity: "warn", code: "memory-high", value: observation.memoryPressure, threshold: 0.75, message: "memory pressure is high" });
    if (observation.thermalPressure >= 0.9) issues.push({ severity: "error", code: "thermal-critical", value: observation.thermalPressure, threshold: 0.9, message: "thermal pressure is critical" });
    else if (observation.thermalPressure >= 0.75) issues.push({ severity: "warn", code: "thermal-high", value: observation.thermalPressure, threshold: 0.75, message: "thermal pressure is high" });
    if (observation.drawCalls > quality.maxDrawCalls) issues.push({ severity: "warn", code: "draw-budget", value: observation.drawCalls, threshold: quality.maxDrawCalls, message: "draw calls exceed selected quality budget" });
    if (observation.triangles > quality.maxTriangles) issues.push({ severity: "warn", code: "triangle-budget", value: observation.triangles, threshold: quality.maxTriangles, message: "triangle count exceeds selected quality budget" });
    const world = this.#sources.world.stats();
    if (world.utilization >= 1) issues.push({ severity: "warn", code: "world-resident-full", value: world.utilization, threshold: 1, message: "world partition resident budget is full" });
    const assets = this.#sources.assets.stats();
    if (assets.bytes > 600 * 1024 * 1024) issues.push({ severity: "warn", code: "asset-memory-high", value: assets.bytes, threshold: 600 * 1024 * 1024, message: "asset memory footprint is high" });
    const network = this.#sources.network.stats();
    if (network.dropped > 0) issues.push({ severity: "warn", code: "network-drops", value: network.dropped, message: "network input has been rejected or dropped" });
    if (quality.renderScale < 0.7) issues.push({ severity: "info", code: "dynamic-resolution", value: quality.renderScale, message: "dynamic resolution is under pressure" });
    if (this.#sources.capabilities.batterySaver) issues.push({ severity: "info", code: "battery-saver", value: true, message: "battery saver hint is active" });
    if (health?.state === "critical") issues.push({ severity: "info", code: "health-critical", value: true, message: "derived health is critical" });
    return issues;
  }

  #metrics(observation: FrameObservationV15, quality: QualityDecisionV15): Record<string, number> {
    const world = this.#sources.world.stats();
    const assets = this.#sources.assets.stats();
    const network = this.#sources.network.stats();
    const scheduler = this.#sources.scheduler.snapshot();
    return {
      frameMs: observation.frameMs,
      cpuMs: observation.cpuMs,
      gpuMs: observation.gpuMs ?? 0,
      drawCalls: observation.drawCalls,
      triangles: observation.triangles,
      visibleObjects: observation.visibleObjects,
      memoryPressure: observation.memoryPressure,
      thermalPressure: observation.thermalPressure,
      renderScale: quality.renderScale,
      worldUtilization: world.utilization,
      worldResident: world.resident,
      assetBytes: assets.bytes,
      assetRecords: assets.records,
      networkDropped: network.dropped,
      schedulerDroppedSeconds: scheduler.droppedSeconds,
    };
  }
}

export function diagnosticChecksumV15(snapshot: DiagnosticSnapshotV15): number {
  return checksumV15({ health: snapshot.health, issues: snapshot.issues, metrics: snapshot.metrics });
}
