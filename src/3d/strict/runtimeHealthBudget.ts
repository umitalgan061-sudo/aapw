export type StrictHealthState = 'healthy' | 'degraded' | 'critical';

export interface StrictHealthThresholds {
  readonly degradedFrameMs: number;
  readonly criticalFrameMs: number;
  readonly degradedCpuMs: number;
  readonly criticalCpuMs: number;
  readonly degradedGpuMs: number;
  readonly criticalGpuMs: number;
  readonly degradedDrawCalls: number;
  readonly criticalDrawCalls: number;
  readonly degradedTriangles: number;
  readonly criticalTriangles: number;
  readonly degradedMemoryPressure: number;
  readonly criticalMemoryPressure: number;
  readonly degradedEntityPressure: number;
  readonly criticalEntityPressure: number;
  readonly degradedAssetBacklog: number;
  readonly criticalAssetBacklog: number;
  readonly degradedNetworkJitterMs: number;
  readonly criticalNetworkJitterMs: number;
}

export interface StrictHealthObservation {
  readonly frame: number;
  readonly frameMs: number;
  readonly cpuMs: number;
  readonly gpuMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly memoryPressure: number;
  readonly entityPressure: number;
  readonly assetBacklog: number;
  readonly networkJitterMs: number;
}

export interface StrictHealthIssue {
  readonly metric: string;
  readonly state: Exclude<StrictHealthState, 'healthy'>;
  readonly value: number;
  readonly threshold: number;
  readonly deltaFromPrevious: number;
}

export interface StrictHealthSnapshot {
  readonly frame: number;
  readonly state: StrictHealthState;
  readonly score: number;
  readonly issueCount: number;
  readonly recoveryRecommended: boolean;
  readonly trend: number;
  readonly issues: readonly StrictHealthIssue[];
  readonly sampleCount: number;
}

export interface StrictHealthBudgetOptions {
  readonly windowSize?: number;
  readonly recoveryAfterHealthySamples?: number;
  readonly thresholds?: Partial<StrictHealthThresholds>;
}

const DEFAULT_THRESHOLDS: StrictHealthThresholds = Object.freeze({
  degradedFrameMs: 22,
  criticalFrameMs: 40,
  degradedCpuMs: 14,
  criticalCpuMs: 28,
  degradedGpuMs: 15,
  criticalGpuMs: 30,
  degradedDrawCalls: 1200,
  criticalDrawCalls: 2600,
  degradedTriangles: 2_000_000,
  criticalTriangles: 4_000_000,
  degradedMemoryPressure: 0.78,
  criticalMemoryPressure: 0.94,
  degradedEntityPressure: 0.8,
  criticalEntityPressure: 0.97,
  degradedAssetBacklog: 24,
  criticalAssetBacklog: 80,
  degradedNetworkJitterMs: 40,
  criticalNetworkJitterMs: 110,
});

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const safePositive = (value: number, fallback: number): number => Math.max(0, finite(value, fallback));

function mergeThresholds(input?: Partial<StrictHealthThresholds>): StrictHealthThresholds {
  return Object.freeze({
    degradedFrameMs: Math.max(1, finite(input?.degradedFrameMs, DEFAULT_THRESHOLDS.degradedFrameMs)),
    criticalFrameMs: Math.max(1, finite(input?.criticalFrameMs, DEFAULT_THRESHOLDS.criticalFrameMs)),
    degradedCpuMs: Math.max(1, finite(input?.degradedCpuMs, DEFAULT_THRESHOLDS.degradedCpuMs)),
    criticalCpuMs: Math.max(1, finite(input?.criticalCpuMs, DEFAULT_THRESHOLDS.criticalCpuMs)),
    degradedGpuMs: Math.max(1, finite(input?.degradedGpuMs, DEFAULT_THRESHOLDS.degradedGpuMs)),
    criticalGpuMs: Math.max(1, finite(input?.criticalGpuMs, DEFAULT_THRESHOLDS.criticalGpuMs)),
    degradedDrawCalls: Math.max(1, finite(input?.degradedDrawCalls, DEFAULT_THRESHOLDS.degradedDrawCalls)),
    criticalDrawCalls: Math.max(1, finite(input?.criticalDrawCalls, DEFAULT_THRESHOLDS.criticalDrawCalls)),
    degradedTriangles: Math.max(1, finite(input?.degradedTriangles, DEFAULT_THRESHOLDS.degradedTriangles)),
    criticalTriangles: Math.max(1, finite(input?.criticalTriangles, DEFAULT_THRESHOLDS.criticalTriangles)),
    degradedMemoryPressure: clamp01(finite(input?.degradedMemoryPressure, DEFAULT_THRESHOLDS.degradedMemoryPressure)),
    criticalMemoryPressure: clamp01(finite(input?.criticalMemoryPressure, DEFAULT_THRESHOLDS.criticalMemoryPressure)),
    degradedEntityPressure: clamp01(finite(input?.degradedEntityPressure, DEFAULT_THRESHOLDS.degradedEntityPressure)),
    criticalEntityPressure: clamp01(finite(input?.criticalEntityPressure, DEFAULT_THRESHOLDS.criticalEntityPressure)),
    degradedAssetBacklog: Math.max(0, finite(input?.degradedAssetBacklog, DEFAULT_THRESHOLDS.degradedAssetBacklog)),
    criticalAssetBacklog: Math.max(0, finite(input?.criticalAssetBacklog, DEFAULT_THRESHOLDS.criticalAssetBacklog)),
    degradedNetworkJitterMs: Math.max(0, finite(input?.degradedNetworkJitterMs, DEFAULT_THRESHOLDS.degradedNetworkJitterMs)),
    criticalNetworkJitterMs: Math.max(0, finite(input?.criticalNetworkJitterMs, DEFAULT_THRESHOLDS.criticalNetworkJitterMs)),
  });
}

function severity(value: number, degraded: number, critical: number): Exclude<StrictHealthState, 'healthy'> | null {
  if (value >= critical) return 'critical';
  if (value >= degraded) return 'degraded';
  return null;
}

function normalizedPressure(value: number, degraded: number, critical: number): number {
  if (critical <= degraded) return value >= critical ? 1 : 0;
  return clamp01((value - degraded) / (critical - degraded));
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

export class StrictRuntimeHealthBudget {
  readonly thresholds: StrictHealthThresholds;
  readonly windowSize: number;
  readonly recoveryAfterHealthySamples: number;
  #history: StrictHealthObservation[] = [];
  #latest: StrictHealthSnapshot | undefined;
  #healthyStreak = 0;

  constructor(options: StrictHealthBudgetOptions = {}) {
    this.thresholds = mergeThresholds(options.thresholds);
    this.windowSize = Math.max(4, Math.min(128, Math.trunc(options.windowSize ?? 32)));
    this.recoveryAfterHealthySamples = Math.max(1, Math.min(32, Math.trunc(options.recoveryAfterHealthySamples ?? 4)));
  }

  observe(input: StrictHealthObservation): StrictHealthSnapshot {
    const sample = Object.freeze({
      frame: Math.max(0, Math.trunc(input.frame)),
      frameMs: safePositive(input.frameMs, 0),
      cpuMs: safePositive(input.cpuMs, 0),
      gpuMs: safePositive(input.gpuMs, 0),
      drawCalls: safePositive(input.drawCalls, 0),
      triangles: safePositive(input.triangles, 0),
      memoryPressure: clamp01(finite(input.memoryPressure)),
      entityPressure: clamp01(finite(input.entityPressure)),
      assetBacklog: safePositive(input.assetBacklog, 0),
      networkJitterMs: safePositive(input.networkJitterMs, 0),
    });
    const previous = this.#history.at(-1);
    this.#history.push(sample);
    if (this.#history.length > this.windowSize) this.#history.splice(0, this.#history.length - this.windowSize);

    const issues: StrictHealthIssue[] = [];
    const addIssue = (metric: string, value: number, degraded: number, critical: number) => {
      const state = severity(value, degraded, critical);
      if (!state) return;
      const previousValue = previous ? this.#metricValue(previous, metric) : value;
      issues.push(Object.freeze({
        metric,
        state,
        value,
        threshold: state === 'critical' ? critical : degraded,
        deltaFromPrevious: value - previousValue,
      }));
    };
    addIssue('frameMs', sample.frameMs, this.thresholds.degradedFrameMs, this.thresholds.criticalFrameMs);
    addIssue('cpuMs', sample.cpuMs, this.thresholds.degradedCpuMs, this.thresholds.criticalCpuMs);
    addIssue('gpuMs', sample.gpuMs, this.thresholds.degradedGpuMs, this.thresholds.criticalGpuMs);
    addIssue('drawCalls', sample.drawCalls, this.thresholds.degradedDrawCalls, this.thresholds.criticalDrawCalls);
    addIssue('triangles', sample.triangles, this.thresholds.degradedTriangles, this.thresholds.criticalTriangles);
    addIssue('memoryPressure', sample.memoryPressure, this.thresholds.degradedMemoryPressure, this.thresholds.criticalMemoryPressure);
    addIssue('entityPressure', sample.entityPressure, this.thresholds.degradedEntityPressure, this.thresholds.criticalEntityPressure);
    addIssue('assetBacklog', sample.assetBacklog, this.thresholds.degradedAssetBacklog, this.thresholds.criticalAssetBacklog);
    addIssue('networkJitterMs', sample.networkJitterMs, this.thresholds.degradedNetworkJitterMs, this.thresholds.criticalNetworkJitterMs);

    const trend = this.#trend();
    const worst = issues.some(issue => issue.state === 'critical')
      ? 'critical'
      : issues.length > 0 ? 'degraded' : 'healthy';

    if (worst === 'healthy') this.#healthyStreak += 1;
    else this.#healthyStreak = 0;

    const snapshot = Object.freeze({
      frame: sample.frame,
      state: worst as StrictHealthState,
      score: this.#score(sample, issues, trend),
      issueCount: issues.length,
      recoveryRecommended: worst === 'critical' || this.#healthyStreak >= this.recoveryAfterHealthySamples,
      trend,
      issues: Object.freeze(issues),
      sampleCount: this.#history.length,
    });
    this.#latest = snapshot;
    return snapshot;
  }

  latest(): StrictHealthSnapshot | undefined {
    return this.#latest;
  }

  history(): readonly StrictHealthObservation[] {
    return Object.freeze([...this.#history]);
  }

  healthyStreak(): number {
    return this.#healthyStreak;
  }

  reset(): void {
    this.#history.length = 0;
    this.#latest = undefined;
    this.#healthyStreak = 0;
  }

  #metricValue(sample: StrictHealthObservation, metric: string): number {
    switch (metric) {
      case 'frameMs': return sample.frameMs;
      case 'cpuMs': return sample.cpuMs;
      case 'gpuMs': return sample.gpuMs;
      case 'drawCalls': return sample.drawCalls;
      case 'triangles': return sample.triangles;
      case 'memoryPressure': return sample.memoryPressure;
      case 'entityPressure': return sample.entityPressure;
      case 'assetBacklog': return sample.assetBacklog;
      case 'networkJitterMs': return sample.networkJitterMs;
      default: return 0;
    }
  }

  #trend(): number {
    if (this.#history.length < 2) return 0;
    const recent = this.#history.slice(-Math.min(8, this.#history.length));
    const frame = recent.map(sample => normalizedPressure(sample.frameMs, this.thresholds.degradedFrameMs, this.thresholds.criticalFrameMs));
    const cpu = recent.map(sample => normalizedPressure(sample.cpuMs, this.thresholds.degradedCpuMs, this.thresholds.criticalCpuMs));
    const gpu = recent.map(sample => normalizedPressure(sample.gpuMs, this.thresholds.degradedGpuMs, this.thresholds.criticalGpuMs));
    const memory = recent.map(sample => normalizedPressure(sample.memoryPressure, this.thresholds.degradedMemoryPressure, this.thresholds.criticalMemoryPressure));
    const backlog = recent.map(sample => normalizedPressure(sample.assetBacklog, this.thresholds.degradedAssetBacklog, this.thresholds.criticalAssetBacklog));
    const current = average([frame.at(-1) ?? 0, cpu.at(-1) ?? 0, gpu.at(-1) ?? 0, memory.at(-1) ?? 0, backlog.at(-1) ?? 0]);
    const first = average([frame[0] ?? 0, cpu[0] ?? 0, gpu[0] ?? 0, memory[0] ?? 0, backlog[0] ?? 0]);
    return current - first;
  }

  #score(sample: StrictHealthObservation, issues: readonly StrictHealthIssue[], trend: number): number {
    const pressure = average([
      normalizedPressure(sample.frameMs, this.thresholds.degradedFrameMs, this.thresholds.criticalFrameMs),
      normalizedPressure(sample.cpuMs, this.thresholds.degradedCpuMs, this.thresholds.criticalCpuMs),
      normalizedPressure(sample.gpuMs, this.thresholds.degradedGpuMs, this.thresholds.criticalGpuMs),
      normalizedPressure(sample.drawCalls, this.thresholds.degradedDrawCalls, this.thresholds.criticalDrawCalls),
      normalizedPressure(sample.triangles, this.thresholds.degradedTriangles, this.thresholds.criticalTriangles),
      normalizedPressure(sample.memoryPressure, this.thresholds.degradedMemoryPressure, this.thresholds.criticalMemoryPressure),
      normalizedPressure(sample.entityPressure, this.thresholds.degradedEntityPressure, this.thresholds.criticalEntityPressure),
      normalizedPressure(sample.assetBacklog, this.thresholds.degradedAssetBacklog, this.thresholds.criticalAssetBacklog),
      normalizedPressure(sample.networkJitterMs, this.thresholds.degradedNetworkJitterMs, this.thresholds.criticalNetworkJitterMs),
    ]);
    const issuePenalty = Math.min(0.25, issues.length * 0.03);
    return Math.round(clamp01(1 - pressure * 0.75 - Math.max(0, trend) * 0.2 - issuePenalty) * 1000) / 1000;
  }
}
