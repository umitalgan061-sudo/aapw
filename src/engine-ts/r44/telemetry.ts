import { clamp, compareNumbers, compareStrings, err, finite, ok, stableDigest, type Result } from "./contracts.ts";

export interface MetricSample {
  readonly name: string;
  readonly value: number;
  readonly frame: number;
  readonly timeMs: number;
  readonly tags: Readonly<Record<string, string>>;
}

export interface MetricSummary {
  readonly name: string;
  readonly count: number;
  readonly latest: number;
  readonly min: number;
  readonly max: number;
  readonly average: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly standardDeviation: number;
}

export interface CounterSnapshot {
  readonly name: string;
  readonly value: number;
}

export interface TelemetrySnapshot {
  readonly sequence: number;
  readonly samples: readonly MetricSample[];
  readonly counters: readonly CounterSnapshot[];
  readonly gauges: readonly { readonly name: string; readonly value: number }[];
  readonly digest: string;
}

export interface TelemetryPolicy {
  readonly capacity: number;
  readonly maxMetricNames: number;
  readonly maxTagKeys: number;
  readonly maxTagValueLength: number;
}

const DEFAULT_TELEMETRY_POLICY: TelemetryPolicy = Object.freeze({
  capacity: 8192,
  maxMetricNames: 512,
  maxTagKeys: 12,
  maxTagValueLength: 96,
});

/** Fixed-capacity circular sample buffer; adding a sample never shifts the retained history. */
export class MetricRing {
  readonly capacity: number;
  #buffer: Array<MetricSample | undefined>;
  #writeIndex = 0;
  #size = 0;
  #sequence = 0;

  constructor(capacity = 8192) {
    this.capacity = Math.max(1, Math.trunc(capacity));
    this.#buffer = new Array<MetricSample | undefined>(this.capacity);
  }

  push(sample: Omit<MetricSample, "tags"> & { readonly tags?: Readonly<Record<string, string>> }): number {
    if (!Number.isFinite(sample.value)) return this.#sequence;
    const tags = Object.freeze({ ...(sample.tags ?? {}) });
    this.#buffer[this.#writeIndex] = Object.freeze({
      name: sample.name.trim().slice(0, 128),
      value: sample.value,
      frame: Math.max(0, Math.trunc(sample.frame)),
      timeMs: Math.max(0, finite(sample.timeMs, 0)),
      tags,
    });
    this.#writeIndex = (this.#writeIndex + 1) % this.capacity;
    this.#size = Math.min(this.capacity, this.#size + 1);
    this.#sequence += 1;
    return this.#sequence;
  }

  values(): readonly MetricSample[] {
    const out: MetricSample[] = [];
    const start = (this.#writeIndex - this.#size + this.capacity) % this.capacity;
    for (let offset = 0; offset < this.#size; offset += 1) {
      const sample = this.#buffer[(start + offset) % this.capacity];
      if (sample) out.push(sample);
    }
    return Object.freeze(out);
  }

  latest(name?: string): MetricSample | undefined {
    for (let offset = 1; offset <= this.#size; offset += 1) {
      const index = (this.#writeIndex - offset + this.capacity) % this.capacity;
      const sample = this.#buffer[index];
      if (sample && (name === undefined || sample.name === name)) return sample;
    }
    return undefined;
  }

  filter(name: string, windowSize = this.capacity): readonly MetricSample[] {
    return Object.freeze(this.values()
      .filter((sample) => sample.name === name)
      .slice(-Math.max(1, Math.trunc(windowSize))));
  }

  clear(): void {
    this.#buffer = new Array<MetricSample | undefined>(this.capacity);
    this.#writeIndex = 0;
    this.#size = 0;
    this.#sequence = 0;
  }

  get size(): number {
    return this.#size;
  }

  get sequence(): number {
    return this.#sequence;
  }
}

/**
 * Bounded metric registry with counters, gauges, summaries, and stable export.
 * Metric names are capped to prevent accidental high-cardinality memory leaks.
 */
export class TelemetryHub {
  readonly policy: TelemetryPolicy;
  readonly ring: MetricRing;
  #counters = new Map<string, number>();
  #gauges = new Map<string, number>();
  #knownNames = new Set<string>();
  #droppedNames = 0;

  constructor(policy: Partial<TelemetryPolicy> = {}) {
    this.policy = Object.freeze({
      capacity: Math.max(1, Math.trunc(policy.capacity ?? DEFAULT_TELEMETRY_POLICY.capacity)),
      maxMetricNames: Math.max(8, Math.trunc(policy.maxMetricNames ?? DEFAULT_TELEMETRY_POLICY.maxMetricNames)),
      maxTagKeys: Math.max(0, Math.trunc(policy.maxTagKeys ?? DEFAULT_TELEMETRY_POLICY.maxTagKeys)),
      maxTagValueLength: Math.max(1, Math.trunc(policy.maxTagValueLength ?? DEFAULT_TELEMETRY_POLICY.maxTagValueLength)),
    });
    this.ring = new MetricRing(this.policy.capacity);
  }

  record(nameValue: string, value: number, frame: number, timeMs: number, tags: Record<string, unknown> = {}): boolean {
    const name = normalizeMetricName(nameValue);
    if (!name || !Number.isFinite(value)) return false;
    if (!this.#trackName(name)) return false;
    const cleanTags = Object.create(null) as Record<string, string>;
    const keys = Object.keys(tags).sort(compareStrings).slice(0, this.policy.maxTagKeys);
    for (const key of keys) {
      if (!/^[a-zA-Z0-9_.:-]{1,64}$/u.test(key)) continue;
      cleanTags[key] = String(tags[key] ?? "").normalize("NFKC").slice(0, this.policy.maxTagValueLength);
    }
    this.ring.push({ name, value, frame, timeMs, tags: cleanTags });
    return true;
  }

  increment(nameValue: string, delta = 1, frame = 0, timeMs = 0): number {
    const name = normalizeMetricName(nameValue);
    if (!name || !this.#trackName(name)) return this.#counters.get(name) ?? 0;
    const next = (this.#counters.get(name) ?? 0) + (Number.isFinite(delta) ? delta : 0);
    this.#counters.set(name, next);
    this.ring.push({ name: "counter." + name, value: next, frame, timeMs, tags: {} });
    return next;
  }

  setGauge(nameValue: string, value: number, frame = 0, timeMs = 0): boolean {
    const name = normalizeMetricName(nameValue);
    if (!name || !Number.isFinite(value) || !this.#trackName(name)) return false;
    this.#gauges.set(name, value);
    this.ring.push({ name: "gauge." + name, value, frame, timeMs, tags: {} });
    return true;
  }

  counter(nameValue: string): number {
    return this.#counters.get(normalizeMetricName(nameValue)) ?? 0;
  }

  gauge(nameValue: string): number | undefined {
    return this.#gauges.get(normalizeMetricName(nameValue));
  }

  summary(nameValue: string, windowSize = this.policy.capacity): MetricSummary | undefined {
    const name = normalizeMetricName(nameValue);
    const samples = this.ring.filter(name, windowSize).map((sample) => sample.value);
    if (samples.length === 0) return undefined;
    const sorted = [...samples].sort(compareNumbers);
    const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    const variance = samples.reduce((sum, value) => sum + ((value - average) ** 2), 0) / samples.length;
    const quantile = (p: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))] ?? 0;
    return Object.freeze({
      name,
      count: samples.length,
      latest: samples[samples.length - 1] ?? 0,
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      average: rounded(average),
      p50: quantile(0.5),
      p95: quantile(0.95),
      p99: quantile(0.99),
      standardDeviation: rounded(Math.sqrt(variance)),
    });
  }

  snapshots(): readonly TelemetrySnapshot[] {
    const body = {
      sequence: this.ring.sequence,
      samples: this.ring.values(),
      counters: [...this.#counters.entries()].sort(([a], [b]) => compareStrings(a, b)).map(([name, value]) => Object.freeze({ name, value })),
      gauges: [...this.#gauges.entries()].sort(([a], [b]) => compareStrings(a, b)).map(([name, value]) => Object.freeze({ name, value })),
    };
    return Object.freeze([Object.freeze({ ...body, digest: stableDigest(body) })]);
  }

  exportSnapshot(): TelemetrySnapshot {
    const body = {
      sequence: this.ring.sequence,
      samples: this.ring.values(),
      counters: Object.freeze([...this.#counters.entries()].sort(([a], [b]) => compareStrings(a, b)).map(([name, value]) => Object.freeze({ name, value }))),
      gauges: Object.freeze([...this.#gauges.entries()].sort(([a], [b]) => compareStrings(a, b)).map(([name, value]) => Object.freeze({ name, value }))),
    };
    return Object.freeze({ ...body, digest: stableDigest(body) });
  }

  importSnapshot(snapshot: TelemetrySnapshot): Result<true> {
    const body = {
      sequence: snapshot.sequence,
      samples: snapshot.samples,
      counters: snapshot.counters,
      gauges: snapshot.gauges,
    };
    if (stableDigest(body) !== snapshot.digest) return err("TELEMETRY_DIGEST", "Telemetry snapshot digest mismatch.");
    if (snapshot.samples.length > this.policy.capacity ||
        snapshot.counters.length + snapshot.gauges.length > this.policy.maxMetricNames) {
      return err("TELEMETRY_LIMIT", "Telemetry snapshot exceeds configured limits.");
    }
    for (const sample of snapshot.samples) {
      if (!Number.isFinite(sample.value) || !Number.isFinite(sample.frame) || !Number.isFinite(sample.timeMs)) {
        return err("TELEMETRY_SAMPLE_INVALID", "Telemetry sample contains non-finite values.");
      }
    }
    this.clear();
    for (const sample of snapshot.samples) {
      this.ring.push(sample);
      this.#trackName(sample.name);
    }
    for (const counter of snapshot.counters) {
      if (!Number.isFinite(counter.value)) return err("TELEMETRY_COUNTER_INVALID", "Counter is not finite.");
      this.#counters.set(counter.name, counter.value);
      this.#trackName(counter.name);
    }
    for (const gauge of snapshot.gauges) {
      if (!Number.isFinite(gauge.value)) return err("TELEMETRY_GAUGE_INVALID", "Gauge is not finite.");
      this.#gauges.set(gauge.name, gauge.value);
      this.#trackName(gauge.name);
    }
    return ok(true);
  }

  listNames(): readonly string[] {
    return Object.freeze([...this.#knownNames].sort(compareStrings));
  }

  clear(): void {
    this.ring.clear();
    this.#counters.clear();
    this.#gauges.clear();
    this.#knownNames.clear();
    this.#droppedNames = 0;
  }

  get droppedNames(): number {
    return this.#droppedNames;
  }

  #trackName(name: string): boolean {
    if (this.#knownNames.has(name)) return true;
    if (this.#knownNames.size >= this.policy.maxMetricNames) {
      this.#droppedNames += 1;
      return false;
    }
    this.#knownNames.add(name);
    return true;
  }
}

export interface AnomalyPolicy {
  readonly minSamples: number;
  readonly warmupSamples: number;
  readonly sigmaThreshold: number;
  readonly absoluteThreshold: number;
  readonly cooldownFrames: number;
}

export interface AnomalyResult {
  readonly anomalous: boolean;
  readonly value: number;
  readonly baseline: number;
  readonly deviation: number;
  readonly zScore: number;
  readonly severity: "none" | "low" | "medium" | "high";
  readonly reason: string;
}

export class MetricAnomalyDetector {
  readonly policy: AnomalyPolicy;
  #history: number[] = [];
  #lastAlertFrame = -1;

  constructor(policy: Partial<AnomalyPolicy> = {}) {
    this.policy = Object.freeze({
      minSamples: Math.max(4, Math.trunc(policy.minSamples ?? 16)),
      warmupSamples: Math.max(4, Math.trunc(policy.warmupSamples ?? 16)),
      sigmaThreshold: Math.max(0.5, finite(policy.sigmaThreshold, 3.5)),
      absoluteThreshold: Math.max(0, finite(policy.absoluteThreshold, 0)),
      cooldownFrames: Math.max(0, Math.trunc(policy.cooldownFrames ?? 120)),
    });
  }

  observe(value: number, frame: number): AnomalyResult {
    const safe = Number.isFinite(value) ? value : 0;
    const baseline = this.#history.length === 0
      ? safe
      : this.#history.reduce((sum, item) => sum + item, 0) / this.#history.length;
    const variance = this.#history.length === 0
      ? 0
      : this.#history.reduce((sum, item) => sum + ((item - baseline) ** 2), 0) / this.#history.length;
    const deviation = Math.sqrt(variance);
    const zScore = deviation > 1e-9 ? Math.abs(safe - baseline) / deviation : (safe === baseline ? 0 : Number.POSITIVE_INFINITY);
    const enoughSamples = this.#history.length >= Math.max(this.policy.minSamples, this.policy.warmupSamples);
    const absoluteTrip = this.policy.absoluteThreshold > 0 && Math.abs(safe - baseline) >= this.policy.absoluteThreshold;
    const outlier = enoughSamples && (zScore >= this.policy.sigmaThreshold || absoluteTrip);
    const anomalous = outlier && frame - this.#lastAlertFrame >= this.policy.cooldownFrames;
    if (anomalous) this.#lastAlertFrame = Math.max(0, Math.trunc(frame));
    // Keep isolated spikes out of the baseline so anomalies cannot normalize themselves away.
    if (!outlier) {
      this.#history.push(safe);
      if (this.#history.length > 512) this.#history.shift();
    }
    const severity = !anomalous ? "none" : zScore >= this.policy.sigmaThreshold * 3 ? "high" : zScore >= this.policy.sigmaThreshold * 2 ? "medium" : "low";
    return Object.freeze({
      anomalous,
      value: safe,
      baseline: rounded(baseline),
      deviation: rounded(deviation),
      zScore: Number.isFinite(zScore) ? rounded(zScore) : 999,
      severity,
      reason: !enoughSamples ? "warming-up" : anomalous ? "deviation-threshold-crossed" : "within-baseline",
    });
  }

  reset(): void {
    this.#history = [];
    this.#lastAlertFrame = -1;
  }
}

function normalizeMetricName(value: string): string {
  return String(value ?? "").normalize("NFKC").trim().replace(/[^a-zA-Z0-9_.:-]/gu, "_").slice(0, 128);
}

function rounded(value: number): number {
  return Number(value.toFixed(5));
}
