import type { RuntimeIntegrationMetrics } from './runtimeIntegrationV2.ts';
import type { ChunkRuntimeMetrics } from './worldChunkRuntime.ts';
import type { SpatialMetrics } from './worldSpatialIndex.ts';
import type { SnapshotBufferMetrics } from './networkRuntimeV2.ts';

export type DiagnosticSeverity = 'info' | 'warning' | 'critical';

export interface DiagnosticIssue {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly subsystem: string;
  readonly message: string;
  readonly observed: number | string;
  readonly threshold?: number;
}

export interface RuntimeDiagnosticSnapshot {
  readonly timestamp: number;
  readonly score: number;
  readonly issues: readonly DiagnosticIssue[];
  readonly health: {
    readonly frameTimeMs: number;
    readonly targetFrameMs: number;
    readonly memoryMb: number | null;
    readonly residentChunkBytes: number;
    readonly spatialItems: number;
  };
  readonly recommendations: readonly string[];
}

export interface RuntimeDiagnosticInput {
  readonly integration: RuntimeIntegrationMetrics;
  readonly chunks: ChunkRuntimeMetrics;
  readonly spatial: SpatialMetrics;
  readonly snapshots?: SnapshotBufferMetrics;
  readonly frameTimeMs: number;
  readonly targetFrameMs?: number;
  readonly memoryMb?: number | null;
  readonly now?: number;
}

const bounded = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export const diagnoseRuntime = (input: RuntimeDiagnosticInput): RuntimeDiagnosticSnapshot => {
  const target = Math.max(8, input.targetFrameMs ?? 16.67);
  const frameRatio = bounded(input.frameTimeMs / target, 0, 4);
  const issues: DiagnosticIssue[] = [];
  const recommendations: string[] = [];
  let penalty = 0;

  if (frameRatio > 1.5) {
    issues.push({ code: 'FRAME_OVER_BUDGET', severity: 'critical', subsystem: 'frame', message: 'Frame time is substantially above the target budget.', observed: Number(input.frameTimeMs.toFixed(2)), threshold: target });
    recommendations.push('Reduce resolution scale and defer background systems.');
    penalty += 28;
  } else if (frameRatio > 1.15) {
    issues.push({ code: 'FRAME_PRESSURE', severity: 'warning', subsystem: 'frame', message: 'Frame time is above target budget.', observed: Number(input.frameTimeMs.toFixed(2)), threshold: target });
    recommendations.push('Sample adaptive quality and reduce expensive optional passes.');
    penalty += 12;
  }

  if (input.chunks.loading >= 4) {
    issues.push({ code: 'CHUNK_LOAD_PRESSURE', severity: 'warning', subsystem: 'streaming', message: 'Concurrent chunk loading is saturated.', observed: input.chunks.loading, threshold: 4 });
    recommendations.push('Increase chunk prioritization for nearest visible cells.');
    penalty += 7;
  }

  if (input.chunks.residentBytes > 450 * 1024 * 1024) {
    issues.push({ code: 'CHUNK_MEMORY', severity: 'warning', subsystem: 'streaming', message: 'Chunk residency is approaching the configured memory ceiling.', observed: input.chunks.residentBytes, threshold: 450 * 1024 * 1024 });
    recommendations.push('Evict least-recently-visible unpinned chunks.');
    penalty += 8;
  }

  if (input.spatial.items > 40_000) {
    issues.push({ code: 'SPATIAL_DENSITY', severity: 'warning', subsystem: 'spatial', message: 'Spatial index density is high.', observed: input.spatial.items, threshold: 40_000 });
    recommendations.push('Partition simulation interest using streaming cells and tighter query radii.');
    penalty += 6;
  }

  if (input.spatial.visitedCells / Math.max(1, input.spatial.queries) > 500) {
    issues.push({ code: 'SPATIAL_QUERY_COST', severity: 'warning', subsystem: 'spatial', message: 'Average spatial queries visit many cells.', observed: Number((input.spatial.visitedCells / Math.max(1, input.spatial.queries)).toFixed(1)), threshold: 500 });
    recommendations.push('Increase cell size or reduce query radius for broad scans.');
    penalty += 5;
  }

  if (input.memoryMb !== null && input.memoryMb !== undefined && input.memoryMb > 1400) {
    issues.push({ code: 'JS_HEAP_PRESSURE', severity: 'critical', subsystem: 'memory', message: 'JavaScript heap usage is high for a browser game.', observed: Number(input.memoryMb.toFixed(1)), threshold: 1400 });
    recommendations.push('Evict assets, reduce retained snapshots, and move large data to transferable buffers.');
    penalty += 25;
  }

  const snapshots = input.snapshots;
  if (snapshots && snapshots.dropped > 0) {
    issues.push({ code: 'SNAPSHOT_DROPS', severity: snapshots.dropped > 8 ? 'warning' : 'info', subsystem: 'network', message: 'Snapshot buffer has dropped old snapshots.', observed: snapshots.dropped, threshold: 8 });
    recommendations.push('Increase snapshot cadence budget or reduce entity payload size.');
    penalty += Math.min(10, snapshots.dropped);
  }

  const score = bounded(100 - penalty, 0, 100);
  return Object.freeze({
    timestamp: input.now ?? Date.now(),
    score: Number(score.toFixed(1)),
    issues,
    health: Object.freeze({ frameTimeMs: input.frameTimeMs, targetFrameMs: target, memoryMb: input.memoryMb ?? null, residentChunkBytes: input.chunks.residentBytes, spatialItems: input.spatial.items }),
    recommendations: [...new Set(recommendations)],
  });
};

export const severityWeight = (severity: DiagnosticSeverity): number => ({ info: 1, warning: 4, critical: 9 })[severity];

export const collapseIssues = (issues: readonly DiagnosticIssue[]): Readonly<Record<DiagnosticSeverity, number>> => Object.freeze({
  info: issues.filter((issue) => issue.severity === 'info').length,
  warning: issues.filter((issue) => issue.severity === 'warning').length,
  critical: issues.filter((issue) => issue.severity === 'critical').length,
});

export interface RingSample { readonly timestamp: number; readonly value: number; }
export class MetricRing {
  readonly #capacity: number;
  readonly #values: RingSample[] = [];
  constructor(capacity = 180) { this.#capacity = Math.max(8, Math.floor(capacity)); }
  push(value: number, timestamp = Date.now()): void {
    this.#values.push(Object.freeze({ timestamp, value: Number.isFinite(value) ? value : 0 }));
    while (this.#values.length > this.#capacity) this.#values.shift();
  }
  latest(): RingSample | undefined { return this.#values[this.#values.length - 1]; }
  values(): readonly RingSample[] { return [...this.#values]; }
  average(): number { return this.#values.length ? this.#values.reduce((sum, value) => sum + value.value, 0) / this.#values.length : 0; }
  percentile(p: number): number { const sorted = [...this.#values].sort((a, b) => a.value - b.value); if (!sorted.length) return 0; return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * bounded(p, 0, 1)) - 1))]?.value ?? 0; }
  clear(): void { this.#values.length = 0; }
}
