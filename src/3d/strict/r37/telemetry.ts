export interface TelemetrySample {
  readonly atMs: number;
  readonly name: string;
  readonly value: number;
  readonly tags: Readonly<Record<string, string>>;
}

export interface TelemetrySummary {
  readonly name: string;
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly average: number;
  readonly latest: number;
}

export interface TelemetryConfig {
  readonly capacity: number;
  readonly maxTagKeys: number;
}

export class TelemetryRingR37 {
  readonly config: TelemetryConfig;
  #samples: TelemetrySample[] = [];

  constructor(config: Partial<TelemetryConfig> = {}) {
    this.config = Object.freeze({
      capacity: Math.max(32, Math.trunc(Number(config.capacity ?? 512))),
      maxTagKeys: Math.max(1, Math.trunc(Number(config.maxTagKeys ?? 16))),
    });
  }

  record(name: string, value: number, tags: Readonly<Record<string, string>> = {}, atMs = nowMs()): void {
    this.#samples.push(Object.freeze({
      atMs: Number.isFinite(atMs) ? atMs : 0,
      name: String(name).slice(0, 96),
      value: Number.isFinite(value) ? value : 0,
      tags: Object.freeze(Object.fromEntries(Object.entries(tags).slice(0, this.config.maxTagKeys).map(([key, tag]) => [key.slice(0, 64), String(tag).slice(0, 128)]))),
    }));
    if (this.#samples.length > this.config.capacity) this.#samples.splice(0, this.#samples.length - this.config.capacity);
  }

  latest(name: string): TelemetrySample | undefined { return this.#samples.findLast((sample) => sample.name === name); }

  summarize(name: string): TelemetrySummary | null {
    const values = this.#samples.filter((sample) => sample.name === name).map((sample) => sample.value);
    if (values.length === 0) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Object.freeze({ name, count: values.length, min, max, average, latest: values.at(-1)! });
  }

  window(startMs: number, endMs = nowMs()): readonly TelemetrySample[] {
    const lo = Math.min(startMs, endMs);
    const hi = Math.max(startMs, endMs);
    return Object.freeze(this.#samples.filter((sample) => sample.atMs >= lo && sample.atMs <= hi));
  }

  samples(): readonly TelemetrySample[] { return Object.freeze([...this.#samples]); }
  clear(): void { this.#samples = []; }
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0;
}
