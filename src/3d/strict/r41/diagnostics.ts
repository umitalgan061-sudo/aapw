
import type { HealthReport, QualityTier, RuntimeMode, TelemetrySample } from './types.ts';
import { clamp, finite, stableHash } from './types.ts';

export interface DiagnosticThresholds {
  readonly frameWarningMs: number;
  readonly frameCriticalMs: number;
  readonly memoryWarningBytes: number;
  readonly memoryCriticalBytes: number;
  readonly droppedStepWarning: number;
  readonly failedTaskWarning: number;
  readonly networkRttWarningMs: number;
}

export interface DiagnosticSnapshot {
  readonly samples: number;
  readonly averageFrameMs: number;
  readonly p50FrameMs: number;
  readonly p95FrameMs: number;
  readonly p99FrameMs: number;
  readonly averageSimulationMs: number;
  readonly averageRenderMs: number;
  readonly averageMemoryBytes: number;
  readonly peakMemoryBytes: number;
  readonly averageEntityCount: number;
  readonly droppedStepCount: number;
  readonly failedTaskCount: number;
  readonly quality: QualityTier;
  readonly mode: RuntimeMode;
  readonly digest: number;
}

export interface DiagnosticAlert {
  readonly severity: 'info' | 'warning' | 'critical';
  readonly code: string;
  readonly message: string;
  readonly value: number;
  readonly threshold: number;
}

export class DiagnosticsR41 {
  readonly capacity: number;
  readonly thresholds: DiagnosticThresholds;
  #samples: TelemetrySample[] = [];
  #droppedSteps = 0;
  #failedTasks = 0;
  #mode: RuntimeMode = 'booting';

  constructor(capacity = 512, thresholds: Partial<DiagnosticThresholds> = {}) {
    this.capacity = Math.max(32, Math.trunc(capacity));
    this.thresholds = Object.freeze({
      frameWarningMs: finite(thresholds.frameWarningMs, 20),
      frameCriticalMs: finite(thresholds.frameCriticalMs, 33),
      memoryWarningBytes: finite(thresholds.memoryWarningBytes, 512 * 1024 * 1024),
      memoryCriticalBytes: finite(thresholds.memoryCriticalBytes, 768 * 1024 * 1024),
      droppedStepWarning: Math.max(0, Math.trunc(finite(thresholds.droppedStepWarning, 1))),
      failedTaskWarning: Math.max(0, Math.trunc(finite(thresholds.failedTaskWarning, 1))),
      networkRttWarningMs: finite(thresholds.networkRttWarningMs, 150),
    });
  }

  setMode(mode: RuntimeMode): void { this.#mode = mode; }

  record(sample: TelemetrySample): void {
    this.#samples.push(Object.freeze({ ...sample }));
    if (this.#samples.length > this.capacity) this.#samples.shift();
  }

  recordDroppedSteps(count: number): void {
    this.#droppedSteps += Math.max(0, Math.trunc(finite(count)));
  }

  recordFailedTasks(count: number): void {
    this.#failedTasks += Math.max(0, Math.trunc(finite(count)));
  }

  samples(): readonly TelemetrySample[] {
    return Object.freeze([...this.#samples]);
  }

  snapshot(): DiagnosticSnapshot {
    const frameValues = this.#samples.map(sample => sample.frameMs);
    const simulationValues = this.#samples.map(sample => sample.simulationMs);
    const renderValues = this.#samples.map(sample => sample.renderMs);
    const memoryValues = this.#samples.map(sample => sample.memoryBytes);
    const entityValues = this.#samples.map(sample => sample.entityCount);
    const latest = this.#samples[this.#samples.length - 1];
    const canonical = this.#samples.map(sample => [
      sample.tick,
      sample.frameMs,
      sample.simulationMs,
      sample.renderMs,
      sample.networkMs,
      sample.streamingMs,
      sample.persistenceMs,
      sample.entityCount,
      sample.activeCount,
      sample.memoryBytes,
      sample.quality,
    ]);

    return Object.freeze({
      samples: this.#samples.length,
      averageFrameMs: average(frameValues),
      p50FrameMs: percentile(frameValues, 0.5),
      p95FrameMs: percentile(frameValues, 0.95),
      p99FrameMs: percentile(frameValues, 0.99),
      averageSimulationMs: average(simulationValues),
      averageRenderMs: average(renderValues),
      averageMemoryBytes: average(memoryValues),
      peakMemoryBytes: memoryValues.length ? Math.max(...memoryValues) : 0,
      averageEntityCount: average(entityValues),
      droppedStepCount: this.#droppedSteps,
      failedTaskCount: this.#failedTasks,
      quality: latest?.quality ?? 'balanced',
      mode: this.#mode,
      digest: stableHash(canonical),
    });
  }

  alerts(): readonly DiagnosticAlert[] {
    const report = this.snapshot();
    const alerts: DiagnosticAlert[] = [];
    if (report.averageFrameMs >= this.thresholds.frameCriticalMs) {
      alerts.push({
        severity: 'critical',
        code: 'frame-critical',
        message: 'Average frame time exceeds the critical runtime budget.',
        value: report.averageFrameMs,
        threshold: this.thresholds.frameCriticalMs,
      });
    } else if (report.averageFrameMs >= this.thresholds.frameWarningMs) {
      alerts.push({
        severity: 'warning',
        code: 'frame-warning',
        message: 'Average frame time is above the warning threshold.',
        value: report.averageFrameMs,
        threshold: this.thresholds.frameWarningMs,
      });
    }

    if (report.peakMemoryBytes >= this.thresholds.memoryCriticalBytes) {
      alerts.push({
        severity: 'critical',
        code: 'memory-critical',
        message: 'Observed runtime memory exceeds the critical threshold.',
        value: report.peakMemoryBytes,
        threshold: this.thresholds.memoryCriticalBytes,
      });
    } else if (report.peakMemoryBytes >= this.thresholds.memoryWarningBytes) {
      alerts.push({
        severity: 'warning',
        code: 'memory-warning',
        message: 'Observed runtime memory is above the warning threshold.',
        value: report.peakMemoryBytes,
        threshold: this.thresholds.memoryWarningBytes,
      });
    }

    if (report.droppedStepCount >= this.thresholds.droppedStepWarning) {
      alerts.push({
        severity: 'warning',
        code: 'simulation-drops',
        message: 'The fixed-step simulation has dropped catch-up work.',
        value: report.droppedStepCount,
        threshold: this.thresholds.droppedStepWarning,
      });
    }

    if (report.failedTaskCount >= this.thresholds.failedTaskWarning) {
      alerts.push({
        severity: 'warning',
        code: 'scheduled-work-failed',
        message: 'One or more bounded runtime tasks failed.',
        value: report.failedTaskCount,
        threshold: this.thresholds.failedTaskWarning,
      });
    }

    return Object.freeze(alerts);
  }

  health(): HealthReport {
    const alerts = this.alerts();
    const critical = alerts.filter(alert => alert.severity === 'critical').map(alert => alert.code);
    const warnings = alerts.filter(alert => alert.severity === 'warning').map(alert => alert.code);
    const report = this.snapshot();
    const score = clamp(100 - critical.length * 35 - warnings.length * 12 - Math.max(0, report.averageFrameMs - 16.67) * 1.1, 0, 100);
    return Object.freeze({
      score,
      ok: critical.length === 0 && this.#mode !== 'faulted',
      mode: this.#mode,
      tick: this.#samples[this.#samples.length - 1]?.tick ?? 0,
      warnings: Object.freeze(warnings),
      critical: Object.freeze(critical),
      sampleCount: this.#samples.length,
    });
  }

  reset(): void {
    this.#samples = [];
    this.#droppedSteps = 0;
    this.#failedTasks = 0;
    this.#mode = 'booting';
  }

  compare(previous: DiagnosticSnapshot, current = this.snapshot()): Readonly<{
    frameDeltaMs: number;
    memoryDeltaBytes: number;
    entityDelta: number;
    healthTrend: 'up' | 'down' | 'flat';
  }> {
    const previousHealth = scoreFromSnapshot(previous, this.thresholds.frameWarningMs);
    const currentHealth = scoreFromSnapshot(current, this.thresholds.frameWarningMs);
    return Object.freeze({
      frameDeltaMs: current.averageFrameMs - previous.averageFrameMs,
      memoryDeltaBytes: current.averageMemoryBytes - previous.averageMemoryBytes,
      entityDelta: current.averageEntityCount - previous.averageEntityCount,
      healthTrend: currentHealth > previousHealth ? 'up' : currentHealth < previousHealth ? 'down' : 'flat',
    });
  }
}

export function mergeDiagnosticSnapshots(
  snapshots: readonly DiagnosticSnapshot[],
): DiagnosticSnapshot | null {
  if (!snapshots.length) return null;
  const ordered = snapshots.slice().sort((a, b) => a.samples - b.samples);
  const latest = ordered[ordered.length - 1];
  if (!latest) return null;
  return Object.freeze({
    ...latest,
    samples: ordered.reduce((sum, snapshot) => sum + snapshot.samples, 0),
    averageFrameMs: weightedAverage(ordered.map(snapshot => [snapshot.averageFrameMs, snapshot.samples])),
    averageSimulationMs: weightedAverage(ordered.map(snapshot => [snapshot.averageSimulationMs, snapshot.samples])),
    averageRenderMs: weightedAverage(ordered.map(snapshot => [snapshot.averageRenderMs, snapshot.samples])),
    averageMemoryBytes: weightedAverage(ordered.map(snapshot => [snapshot.averageMemoryBytes, snapshot.samples])),
    averageEntityCount: weightedAverage(ordered.map(snapshot => [snapshot.averageEntityCount, snapshot.samples])),
    peakMemoryBytes: Math.max(...ordered.map(snapshot => snapshot.peakMemoryBytes)),
    droppedStepCount: ordered.reduce((sum, snapshot) => sum + snapshot.droppedStepCount, 0),
    failedTaskCount: ordered.reduce((sum, snapshot) => sum + snapshot.failedTaskCount, 0),
    digest: stableHash(ordered.map(snapshot => snapshot.digest)),
  });
}

function average(values: readonly number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], ratio: number): number {
  if (!values.length) return 0;
  const ordered = values.slice().sort((a, b) => a - b);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil((ordered.length - 1) * clamp(ratio, 0, 1))));
  return ordered[index] ?? 0;
}

function weightedAverage(values: readonly (readonly [number, number])[]): number {
  const weight = values.reduce((sum, pair) => sum + pair[1], 0);
  if (weight <= 0) return 0;
  return values.reduce((sum, pair) => sum + pair[0] * pair[1], 0) / weight;
}

function scoreFromSnapshot(snapshot: DiagnosticSnapshot, frameWarningMs: number): number {
  return clamp(100 - Math.max(0, snapshot.averageFrameMs - frameWarningMs) * 3 - snapshot.failedTaskCount * 5, 0, 100);
}
