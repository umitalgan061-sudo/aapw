import { FrameId, LogLevel, LogRecord, RuntimeBudget, StateDigest, Tick, asFrameId, asTick, checksumObject } from './domain.ts';

export interface MetricValue {
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  readonly tags: Readonly<Record<string, string>>;
}

export interface SpanRecord {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface HealthSample {
  readonly tick: Tick;
  readonly frame: FrameId;
  readonly budget: RuntimeBudget;
  readonly errors: number;
  readonly warnings: number;
  readonly droppedCommands: number;
  readonly networkLoss: number;
  readonly residentAssetBytes: number;
}

export interface HealthReport {
  readonly score: number;
  readonly grade: 'A' | 'B' | 'C' | 'D' | 'F';
  readonly reasons: readonly string[];
}

export class TelemetryBufferV5 {
  readonly #metrics: MetricValue[] = [];
  readonly #spans: SpanRecord[] = [];
  readonly #logs: LogRecord[] = [];
  readonly #health: HealthSample[] = [];
  readonly maxRecords: number;

  constructor(maxRecords = 4096) { this.maxRecords = Math.max(128, Math.trunc(maxRecords)); }

  metric(name: string, value: number, unit = 'count', tags: Readonly<Record<string, string>> = {}): void {
    if (!name.trim() || !Number.isFinite(value)) return;
    this.#metrics.push({ name: name.trim(), value, unit, tags: { ...tags } });
    this.#trim(this.#metrics);
  }

  log(level: LogLevel, scope: string, message: string, fields: Readonly<Record<string, unknown>> = {}, tick: Tick | null = null, frame: FrameId | null = null): void {
    this.#logs.push({ timestamp: Date.now(), level, scope, message: message.slice(0, 1000), tick, frame, fields: { ...fields } });
    this.#trim(this.#logs);
  }

  span(record: Omit<SpanRecord, 'id'> & { id?: string }): string {
    const id = record.id ?? `${record.name}:${record.startMs}:${this.#spans.length}`;
    this.#spans.push({ ...record, id });
    this.#trim(this.#spans);
    return id;
  }

  health(sample: HealthSample): void {
    this.#health.push({ ...sample, budget: { ...sample.budget } });
    this.#trim(this.#health);
  }

  reportHealth(window = 60): HealthReport {
    const samples = this.#health.slice(-Math.max(1, window));
    if (samples.length === 0) return { score: 100, grade: 'A', reasons: [] };
    const averages = {
      total: samples.reduce((sum, sample) => sum + sample.budget.totalMs, 0) / samples.length,
      errors: samples.reduce((sum, sample) => sum + sample.errors, 0) / samples.length,
      warnings: samples.reduce((sum, sample) => sum + sample.warnings, 0) / samples.length,
      commands: samples.reduce((sum, sample) => sum + sample.droppedCommands, 0) / samples.length,
      loss: samples.reduce((sum, sample) => sum + sample.networkLoss, 0) / samples.length,
    };
    let score = 100;
    const reasons: string[] = [];
    if (averages.total > 20) { score -= 25; reasons.push('frame budget exceeded'); }
    else if (averages.total > 16.67) { score -= 12; reasons.push('frame budget pressure'); }
    if (averages.errors > 0) { score -= Math.min(30, averages.errors * 8); reasons.push('runtime errors observed'); }
    if (averages.warnings > 1) { score -= Math.min(12, averages.warnings * 2); reasons.push('warning rate elevated'); }
    if (averages.commands > 1) { score -= 10; reasons.push('commands dropped'); }
    if (averages.loss > 0.03) { score -= 15; reasons.push('network loss elevated'); }
    score = Math.max(0, Math.min(100, Math.round(score)));
    const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
    return { score, grade, reasons };
  }

  metrics(limit = 256): readonly MetricValue[] { return this.#metrics.slice(-limit); }
  logs(limit = 256): readonly LogRecord[] { return this.#logs.slice(-limit); }
  spans(limit = 256): readonly SpanRecord[] { return this.#spans.slice(-limit); }
  healthSamples(limit = 256): readonly HealthSample[] { return this.#health.slice(-limit); }

  digest(): StateDigest {
    return {
      tick: asTick(this.#health.at(-1)?.tick ?? 0),
      entityCount: 0,
      commandCount: 0,
      eventCount: this.#logs.length,
      checksum: checksumObject({ metrics: this.#metrics, spans: this.#spans, logs: this.#logs }),
    };
  }

  clear(): void { this.#metrics.length = 0; this.#spans.length = 0; this.#logs.length = 0; this.#health.length = 0; }

  private #trim<T>(array: T[]): void {
    if (array.length > this.maxRecords) array.splice(0, array.length - this.maxRecords);
  }
}

export class FrameHealthMonitorV5 {
  #frame = asFrameId(0);
  #lastFrameMs = 0;

  constructor(private readonly telemetry: TelemetryBufferV5) {}

  record(frameDurationMs: number, budget: RuntimeBudget, tick: Tick, errors = 0, warnings = 0): FrameId {
    this.#frame = asFrameId(Number(this.#frame) + 1);
    this.#lastFrameMs = Math.max(0, frameDurationMs);
    this.telemetry.metric('frame.duration', this.#lastFrameMs, 'ms');
    this.telemetry.metric('frame.overBudget', this.#lastFrameMs > budget.maxTotalMs ? 1 : 0);
    this.telemetry.health({ tick, frame: this.#frame, budget, errors, warnings, droppedCommands: 0, networkLoss: 0, residentAssetBytes: 0 });
    return this.#frame;
  }

  frame(): FrameId { return this.#frame; }
  lastFrameMs(): number { return this.#lastFrameMs; }
}

export const epochNow = (): number => Date.now();
