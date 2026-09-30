import type {
  RuntimeHealthReportR31,
  RuntimeHealthSampleR31,
} from './applicationTypesR31.ts';

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * ratio) - 1));
  return ordered[index] ?? 0;
}

export interface DiagnosticsSnapshotR31 {
  readonly samples: number;
  readonly errors: number;
  readonly droppedCommands: number;
  readonly droppedEvents: number;
  readonly p95FrameMs: number;
  readonly maxFrameMs: number;
  readonly averageFrameMs: number;
}

export class DiagnosticsR31 {
  readonly #samples: RuntimeHealthSampleR31[] = [];
  readonly #maxSamples: number;
  #errors = 0;
  #droppedCommands = 0;
  #droppedEvents = 0;

  constructor(maxSamples = 300) {
    if (!Number.isInteger(maxSamples) || maxSamples < 10) throw new Error('maxSamples must be >= 10');
    this.#maxSamples = maxSamples;
  }

  record(sample: RuntimeHealthSampleR31): void {
    this.#samples.push(Object.freeze(sample));
    this.#errors += Math.max(0, sample.errors);
    this.#droppedCommands += Math.max(0, sample.droppedCommands);
    this.#droppedEvents += Math.max(0, sample.droppedEvents);
    if (this.#samples.length > this.#maxSamples) this.#samples.splice(0, this.#samples.length - this.#maxSamples);
  }

  report(): RuntimeHealthReportR31 {
    const frames = this.#samples.map((sample) => sample.frameMs);
    const p95 = percentile(frames, 0.95);
    const max = frames.reduce((current, value) => Math.max(current, value), 0);
    const errorPressure = Math.min(1, this.#errors / Math.max(1, this.#samples.length));
    const framePressure = Math.min(1, Math.max(0, p95 - 16.67) / 20);
    const dropPressure = Math.min(1, (this.#droppedCommands + this.#droppedEvents) / 100);
    const score = Math.round(100 * Math.max(0, 1 - (errorPressure * 0.45 + framePressure * 0.4 + dropPressure * 0.15)));
    const recommendations: string[] = [];
    if (p95 > 16.67) recommendations.push('Reduce per-frame work or raise LOD thresholds.');
    if (this.#droppedCommands > 0) recommendations.push('Increase command budget or reduce command fan-out.');
    if (this.#droppedEvents > 0) recommendations.push('Increase event budget or batch low-priority events.');
    if (this.#errors > 0) recommendations.push('Inspect subsystem exceptions and isolate failing plugins.');
    if (recommendations.length === 0) recommendations.push('Runtime is inside the R31 baseline budget.');

    return Object.freeze({
      healthy: score >= 80,
      score,
      samples: this.#samples.length,
      p95FrameMs: p95,
      maxFrameMs: max,
      totalErrors: this.#errors,
      recommendations: Object.freeze(recommendations),
    });
  }

  snapshot(): DiagnosticsSnapshotR31 {
    const frames = this.#samples.map((sample) => sample.frameMs);
    const avg = frames.length ? frames.reduce((sum, value) => sum + value, 0) / frames.length : 0;
    return Object.freeze({
      samples: this.#samples.length,
      errors: this.#errors,
      droppedCommands: this.#droppedCommands,
      droppedEvents: this.#droppedEvents,
      p95FrameMs: percentile(frames, 0.95),
      maxFrameMs: frames.reduce((current, value) => Math.max(current, value), 0),
      averageFrameMs: avg,
    });
  }

  recent(limit = 60): readonly RuntimeHealthSampleR31[] {
    return Object.freeze(this.#samples.slice(-Math.max(0, Math.floor(limit))));
  }

  clear(): void {
    this.#samples.length = 0;
    this.#errors = 0;
    this.#droppedCommands = 0;
    this.#droppedEvents = 0;
  }
}
