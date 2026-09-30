export interface MetricRecordR31 {
  readonly name: string;
  readonly kind: 'counter' | 'gauge' | 'timer';
  readonly value: number;
  readonly unit: string;
  readonly labels: Readonly<Record<string, string>>;
}

export interface MetricSummaryR31 {
  readonly name: string;
  readonly kind: MetricRecordR31['kind'];
  readonly unit: string;
  readonly count: number;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly average: number;
}

export class MetricsAggregatorR31 {
  readonly #records = new Map<string, MetricRecordR31[]>();
  readonly #maxPerMetric: number;

  constructor(maxPerMetric = 180) {
    if (!Number.isInteger(maxPerMetric) || maxPerMetric < 16) throw new Error('Metric history must be >= 16');
    this.#maxPerMetric = maxPerMetric;
  }

  record(record: MetricRecordR31): void {
    const values = this.#records.get(record.name) ?? [];
    values.push(Object.freeze({
      ...record,
      value: Number.isFinite(record.value) ? record.value : 0,
      labels: Object.freeze({ ...record.labels }),
    }));
    if (values.length > this.#maxPerMetric) values.splice(0, values.length - this.#maxPerMetric);
    this.#records.set(record.name, values);
  }

  increment(name: string, value = 1, labels: Readonly<Record<string, string>> = {}): void {
    this.record({ name, kind: 'counter', value, unit: 'count', labels });
  }

  gauge(name: string, value: number, unit: string, labels: Readonly<Record<string, string>> = {}): void {
    this.record({ name, kind: 'gauge', value, unit, labels });
  }

  timer(name: string, milliseconds: number, labels: Readonly<Record<string, string>> = {}): void {
    this.record({ name, kind: 'timer', value: milliseconds, unit: 'ms', labels });
  }

  summary(name: string): MetricSummaryR31 | null {
    const records = this.#records.get(name);
    if (!records?.length) return null;
    const values = records.map((record) => record.value);
    const sum = values.reduce((a, b) => a + b, 0);
    const latest = records[records.length - 1]!;
    return Object.freeze({
      name,
      kind: latest.kind,
      unit: latest.unit,
      count: values.length,
      value: latest.value,
      min: values.reduce((m, v) => Math.min(m, v), Infinity),
      max: values.reduce((m, v) => Math.max(m, v), -Infinity),
      average: sum / values.length,
    });
  }

  all(): readonly MetricSummaryR31[] {
    return Object.freeze([...this.#records.keys()].sort().map((name) => this.summary(name)!).filter(Boolean));
  }

  clear(name?: string): void {
    if (name) this.#records.delete(name);
    else this.#records.clear();
  }
}
