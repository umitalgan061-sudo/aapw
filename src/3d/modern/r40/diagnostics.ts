import type { RuntimeHealthReport, RuntimePhase, Tick } from './types';
import { hashJson, stableSort } from './deterministic';

export interface DiagnosticRecord {
  readonly id: string;
  readonly subsystem: string;
  readonly phase: RuntimePhase;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly details: Readonly<Record<string, string | number | boolean>>;
  readonly tick: Tick;
  readonly digest: string;
}
export interface DiagnosticSummary {
  readonly ok: boolean;
  readonly errors: number;
  readonly warnings: number;
  readonly records: readonly DiagnosticRecord[];
  readonly digest: string;
}

export class DiagnosticCollector {
  readonly maxRecords: number;
  #records: DiagnosticRecord[] = [];
  #sequence = 0;
  constructor(maxRecords = 2048) { this.maxRecords = Math.max(16, Math.trunc(maxRecords)); }

  record(subsystem: string, phase: RuntimePhase, ok: boolean, durationMs: number, tick: Tick, details: Record<string, string | number | boolean> = {}): DiagnosticRecord {
    const id = 'diag-' + String(++this.#sequence);
    const record = Object.freeze({
      id,
      subsystem: subsystem.slice(0, 96),
      phase,
      ok: Boolean(ok),
      durationMs: Math.max(0, durationMs),
      details: Object.freeze({ ...details }),
      tick,
      digest: hashJson({ id, subsystem, phase, ok, durationMs, tick, details }),
    });
    this.#records.push(record);
    if (this.#records.length > this.maxRecords) this.#records.shift();
    return record;
  }

  fromHealth(report: RuntimeHealthReport): readonly DiagnosticRecord[] {
    return Object.freeze(report.signals.map((signal) =>
      this.record(signal.subsystem, 'telemetry', signal.ok, 0, signal.tick, { code: signal.code, severity: signal.severity }),
    ));
  }

  summary(): DiagnosticSummary {
    const records = Object.freeze(stableSort(this.#records, (a, b) => a.id.localeCompare(b.id)));
    const errors = records.filter((record) => !record.ok).length;
    const warnings = records.filter((record) => record.details.severity === 'warning').length;
    return Object.freeze({ ok: errors === 0, errors, warnings, records, digest: hashJson({ errors, warnings, records }) });
  }

  latest(limit = 128): readonly DiagnosticRecord[] {
    return Object.freeze(this.#records.slice(-Math.max(1, Math.trunc(limit))));
  }

  clear(): void { this.#records.length = 0; }
}
