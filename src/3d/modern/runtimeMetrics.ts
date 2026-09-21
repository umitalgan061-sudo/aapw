import type { RuntimeSnapshot, TelemetryMetric } from './types';
import { checksum, quantize } from './deterministic';
import { RollingTelemetry } from './telemetry';

export interface MetricAggregate {
  readonly name: string;
  readonly unit: TelemetryMetric['unit'];
  readonly count: number;
  readonly latest: number;
  readonly average: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

export interface RuntimeMetricReport {
  readonly frame: number;
  readonly quality: RuntimeSnapshot['quality'];
  readonly backend: RuntimeSnapshot['backend'];
  readonly pressure: RuntimeSnapshot['pressure'];
  readonly metrics: readonly MetricAggregate[];
  readonly digest: string;
}

function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lo = Math.floor(position);
  const hi = Math.ceil(position);
  if (lo === hi) return sorted[lo] ?? 0;
  return (sorted[lo] ?? 0) + ((sorted[hi] ?? 0) - (sorted[lo] ?? 0)) * (position - lo);
}

/** Aggregates bounded frame telemetry for dashboards and regression checks. */
export class RuntimeMetricsAggregator {
  #values = new Map<string, { unit: TelemetryMetric['unit']; samples: number[] }>();
  #maxSamples: number;

  constructor(maxSamples = 360) {
    this.#maxSamples = Math.max(16, Math.min(4096, Math.floor(maxSamples)));
  }

  ingest(snapshot: RuntimeSnapshot): void {
    for (const metric of snapshot.metrics) {
      const series = this.#values.get(metric.name) ?? { unit: metric.unit, samples: [] };
      series.samples.push(Number.isFinite(metric.value) ? metric.value : 0);
      if (series.samples.length > this.#maxSamples) series.samples.splice(0, series.samples.length - this.#maxSamples);
      this.#values.set(metric.name, series);
    }
  }

  aggregate(name: string): MetricAggregate | null {
    const series = this.#values.get(name);
    if (!series || !series.samples.length) return null;
    const values = series.samples;
    const total = values.reduce((sum, value) => sum + value, 0);
    return Object.freeze({
      name,
      unit: series.unit,
      count: values.length,
      latest: values[values.length - 1] ?? 0,
      average: total / values.length,
      minimum: Math.min(...values),
      maximum: Math.max(...values),
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
      p99: percentile(values, 0.99),
    });
  }

  report(snapshot: RuntimeSnapshot): RuntimeMetricReport {
    this.ingest(snapshot);
    const metrics = [...this.#values.keys()].sort().map((name) => this.aggregate(name)).filter((metric): metric is MetricAggregate => metric !== null);
    return Object.freeze({
      frame: Number(snapshot.frame),
      quality: snapshot.quality,
      backend: snapshot.backend,
      pressure: snapshot.pressure,
      metrics: Object.freeze(metrics),
      digest: checksum(metrics.map((metric) => ({ ...metric, average: quantize(metric.average, 0.001), p95: quantize(metric.p95, 0.001), p99: quantize(metric.p99, 0.001) }))),
    });
  }

  names(): readonly string[] { return [...this.#values.keys()].sort(); }
  clear(): void { this.#values.clear(); }
}

export function telemetryRegressionScore(telemetry: RollingTelemetry): number {
  if (telemetry.count() === 0) return 1;
  const frame = telemetry.percentile('frameMs', 0.95);
  const cpu = telemetry.percentile('cpuMs', 0.95);
  const target = 16.6667;
  return Math.max(0, Math.min(1, 1 - ((frame / target - 1) * 0.6 + (cpu / (target * 0.7) - 1) * 0.4)));
}
