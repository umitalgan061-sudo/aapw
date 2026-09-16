export type MetricKind = 'counter' | 'gauge' | 'histogram';

export interface MetricPoint {
  readonly name: string;
  readonly kind: MetricKind;
  readonly value: number;
  readonly timestampMs: number;
  readonly tags: Readonly<Record<string, string>>;
}

export interface HistogramSummary {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
}

class Histogram {
  private readonly values: number[] = [];
  public add(value: number): void { if (Number.isFinite(value)) this.values.push(value); if (this.values.length > 2048) this.values.shift(); }
  public summary(): HistogramSummary {
    const values = [...this.values].sort((a, b) => a - b);
    if (!values.length) return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
    const pick = (p: number) => values[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0;
    return { count: values.length, min: values[0] ?? 0, max: values.at(-1) ?? 0, mean: values.reduce((a, b) => a + b, 0) / values.length, p50: pick(0.5), p95: pick(0.95), p99: pick(0.99) };
  }
}

/** Privacy-safe in-memory telemetry. It never records URLs, user text or identifiers. */
export class RuntimeTelemetry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, Histogram>();
  private readonly maxMetricNames: number;
  private disposed = false;

  public constructor(maxMetricNames = 256) { this.maxMetricNames = Math.max(16, maxMetricNames); }

  public increment(name: string, amount = 1, tags?: Readonly<Record<string, string>>): void {
    this.ensureActive();
    const key = metricKey(name, tags);
    if (!this.counters.has(key) && this.counters.size >= this.maxMetricNames) return;
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
  }

  public gauge(name: string, value: number, tags?: Readonly<Record<string, string>>): void {
    this.ensureActive();
    if (!Number.isFinite(value)) return;
    const key = metricKey(name, tags);
    if (!this.gauges.has(key) && this.gauges.size >= this.maxMetricNames) return;
    this.gauges.set(key, value);
  }

  public observe(name: string, value: number, tags?: Readonly<Record<string, string>>): void {
    this.ensureActive();
    const key = metricKey(name, tags);
    let histogram = this.histograms.get(key);
    if (!histogram) {
      if (this.histograms.size >= this.maxMetricNames) return;
      histogram = new Histogram();
      this.histograms.set(key, histogram);
    }
    histogram.add(value);
  }

  public snapshot(): Readonly<Record<string, number | HistogramSummary>> {
    const result: Record<string, number | HistogramSummary> = {};
    for (const [key, value] of this.counters) result[`counter:${key}`] = value;
    for (const [key, value] of this.gauges) result[`gauge:${key}`] = value;
    for (const [key, histogram] of this.histograms) result[`histogram:${key}`] = histogram.summary();
    return result;
  }

  public reset(): void { this.counters.clear(); this.gauges.clear(); this.histograms.clear(); }
  private ensureActive(): void { if (this.disposed) throw new Error('TELEMETRY_DISPOSED'); }
  public dispose(): void { if (this.disposed) return; this.reset(); this.disposed = true; }
}

const metricKey = (name: string, tags?: Readonly<Record<string, string>>): string => {
  const cleanName = name.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80);
  const tagPart = tags ? Object.keys(tags).sort().map((key) => `${key}=${String(tags[key]).slice(0, 32)}`).join(',') : '';
  return `${cleanName}|${tagPart}`;
};
