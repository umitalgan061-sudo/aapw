export interface TelemetrySampleR31 {
  readonly timestampMs: number;
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  readonly tags: Readonly<Record<string, string>>;
}

export interface TelemetryAggregateR31 {
  readonly name: string;
  readonly unit: string;
  readonly samples: number;
  readonly last: number;
  readonly min: number;
  readonly max: number;
  readonly average: number;
  readonly sum: number;
}

export class TelemetryBufferR31 {
  readonly #capacity: number;
  readonly #samples: TelemetrySampleR31[] = [];
  #dropped = 0;

  constructor(capacity = 2048) {
    if (!Number.isInteger(capacity) || capacity < 32) throw new Error('Telemetry capacity must be >= 32');
    this.#capacity = capacity;
  }

  record(sample: TelemetrySampleR31): void {
    const normalized = Object.freeze({
      ...sample,
      timestampMs: Number.isFinite(sample.timestampMs) ? sample.timestampMs : 0,
      value: Number.isFinite(sample.value) ? sample.value : 0,
      tags: Object.freeze({ ...sample.tags }),
    });
    this.#samples.push(normalized);
    if (this.#samples.length > this.#capacity) {
      this.#samples.splice(0, this.#samples.length - this.#capacity);
      this.#dropped++;
    }
  }

  aggregate(name: string): TelemetryAggregateR31 | null {
    const selected = this.#samples.filter((sample) => sample.name === name);
    if (!selected.length) return null;
    const values = selected.map((sample) => sample.value);
    const sum = values.reduce((a, b) => a + b, 0);
    return Object.freeze({
      name,
      unit: selected[selected.length - 1]!.unit,
      samples: values.length,
      last: values[values.length - 1]!,
      min: values.reduce((m, v) => Math.min(m, v), Infinity),
      max: values.reduce((m, v) => Math.max(m, v), -Infinity),
      average: sum / values.length,
      sum,
    });
  }

  aggregates(): readonly TelemetryAggregateR31[] {
    const names = [...new Set(this.#samples.map((sample) => sample.name))].sort();
    return Object.freeze(names.map((name) => this.aggregate(name)!).filter(Boolean));
  }

  recent(limit = 120): readonly TelemetrySampleR31[] {
    return Object.freeze(this.#samples.slice(-Math.max(0, Math.floor(limit))));
  }

  exportJson(): string {
    return JSON.stringify({
      version: 31,
      dropped: this.#dropped,
      aggregates: this.aggregates(),
      recent: this.recent(),
    });
  }

  diagnostics(): Readonly<{ capacity: number; samples: number; dropped: number }> {
    return Object.freeze({
      capacity: this.#capacity,
      samples: this.#samples.length,
      dropped: this.#dropped,
    });
  }

  clear(): void {
    this.#samples.length = 0;
    this.#dropped = 0;
  }
}
