import { clampV15, checksumV15, type FrameObservationV15, type QualityDecisionV15 } from "./types.ts";

export interface RenderTelemetrySampleV15 {
  readonly frame: number;
  readonly backend: "webgpu" | "webgl2";
  readonly gpuMs: number | null;
  readonly cpuMs: number;
  readonly frameMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly visibleObjects: number;
  readonly textureBytes: number;
  readonly renderScale: number;
  readonly quality: QualityDecisionV15["tier"];
}

export class RenderTelemetryBufferV15 {
  readonly #capacity: number;
  readonly #samples: RenderTelemetrySampleV15[] = [];

  constructor(capacity = 720) {
    this.#capacity = Math.max(1, Math.min(10_000, Math.floor(capacity)));
  }

  push(sample: RenderTelemetrySampleV15): void {
    this.#samples.push(Object.freeze({
      ...sample,
      frameMs: Math.max(0, sample.frameMs),
      cpuMs: Math.max(0, sample.cpuMs),
      gpuMs: sample.gpuMs === null ? null : Math.max(0, sample.gpuMs),
      drawCalls: Math.max(0, Math.floor(sample.drawCalls)),
      triangles: Math.max(0, Math.floor(sample.triangles)),
      visibleObjects: Math.max(0, Math.floor(sample.visibleObjects)),
      textureBytes: Math.max(0, Math.floor(sample.textureBytes)),
    }));
    if (this.#samples.length > this.#capacity) this.#samples.splice(0, this.#samples.length - this.#capacity);
  }

  latest(): RenderTelemetrySampleV15 | undefined { return this.#samples[this.#samples.length - 1]; }

  window(size = this.#capacity): readonly RenderTelemetrySampleV15[] {
    return Object.freeze(this.#samples.slice(-Math.max(1, Math.floor(size))));
  }

  averages(size = this.#samples.length): Readonly<{ frameMs: number; cpuMs: number; gpuMs: number | null; drawCalls: number; triangles: number; visibleObjects: number; textureBytes: number; renderScale: number }> {
    const slice = this.#samples.slice(-Math.max(1, Math.floor(size)));
    if (!slice.length) return Object.freeze({ frameMs: 0, cpuMs: 0, gpuMs: null, drawCalls: 0, triangles: 0, visibleObjects: 0, textureBytes: 0, renderScale: 1 });
    let frame = 0, cpu = 0, gpu = 0, gpuCount = 0, draw = 0, triangles = 0, visible = 0, texture = 0, scale = 0;
    for (const item of slice) {
      frame += item.frameMs;
      cpu += item.cpuMs;
      if (item.gpuMs !== null) { gpu += item.gpuMs; gpuCount += 1; }
      draw += item.drawCalls;
      triangles += item.triangles;
      visible += item.visibleObjects;
      texture += item.textureBytes;
      scale += item.renderScale;
    }
    return Object.freeze({
      frameMs: Number((frame / slice.length).toFixed(3)),
      cpuMs: Number((cpu / slice.length).toFixed(3)),
      gpuMs: gpuCount === 0 ? null : Number((gpu / gpuCount).toFixed(3)),
      drawCalls: Math.round(draw / slice.length),
      triangles: Math.round(triangles / slice.length),
      visibleObjects: Math.round(visible / slice.length),
      textureBytes: Math.round(texture / slice.length),
      renderScale: Number((scale / slice.length).toFixed(3)),
    });
  }

  percentileFrameMs(percentile = 0.95): number {
    if (!this.#samples.length) return 0;
    const p = clampV15(percentile, 0, 1);
    const values = this.#samples.map(sample => sample.frameMs).sort((a, b) => a - b);
    const index = Math.min(values.length - 1, Math.max(0, Math.ceil((values.length - 1) * p)));
    return Number(values[index].toFixed(3));
  }

  health(quality: QualityDecisionV15): Readonly<{ score: number; status: "healthy" | "degraded" | "critical"; reasons: readonly string[] }> {
    const avg = this.averages(Math.min(60, this.#samples.length));
    const p95 = this.percentileFrameMs(0.95);
    let penalty = 0;
    const reasons: string[] = [];
    if (avg.frameMs > 20) { penalty += 15; reasons.push("average-frame-budget"); }
    if (p95 > 33.33) { penalty += 20; reasons.push("p95-frame-budget"); }
    if (avg.cpuMs > 12) { penalty += 10; reasons.push("cpu-budget"); }
    if (avg.gpuMs !== null && avg.gpuMs > 14) { penalty += 10; reasons.push("gpu-budget"); }
    if (avg.drawCalls > quality.maxDrawCalls) { penalty += 15; reasons.push("draw-call-budget"); }
    if (avg.triangles > quality.maxTriangles) { penalty += 15; reasons.push("triangle-budget"); }
    if (quality.renderScale < 0.75) { penalty += 10; reasons.push("dynamic-resolution-pressure"); }
    const score = Math.max(0, 100 - penalty);
    return Object.freeze({
      score,
      status: score < 45 ? "critical" : score < 70 ? "degraded" : "healthy",
      reasons: Object.freeze(reasons),
    });
  }

  digest(): number { return checksumV15(this.#samples); }
  size(): number { return this.#samples.length; }
}

export function observationFromTelemetryV15(
  sample: RenderTelemetrySampleV15,
  frame: number,
  timestampMs: number,
): FrameObservationV15 {
  return Object.freeze({
    frame: frame as FrameObservationV15["frame"],
    frameMs: sample.frameMs,
    cpuMs: sample.cpuMs,
    gpuMs: sample.gpuMs,
    drawCalls: sample.drawCalls,
    triangles: sample.triangles,
    visibleObjects: sample.visibleObjects,
    textureBytes: sample.textureBytes,
    memoryPressure: 0,
    thermalPressure: 0,
    timestampMs,
  });
}
