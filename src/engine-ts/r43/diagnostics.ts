import { stableDigest, type Result } from './contracts.ts';
import { TelemetryRegistry, type MetricPoint } from './observability.ts';

export interface DiagnosticIssue {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly frame: number;
  readonly subsystem: string;
}

export interface DiagnosticSnapshot {
  readonly frame: number;
  readonly issues: readonly DiagnosticIssue[];
  readonly metrics: readonly MetricPoint[];
  readonly digest: string;
}

export class DiagnosticsHub {
  readonly telemetry: TelemetryRegistry;
  readonly maxIssues: number;
  #issues: DiagnosticIssue[] = [];
  #frame = 0;

  constructor(maxIssues = 512, telemetry?: TelemetryRegistry) {
    this.maxIssues = Math.max(32, Math.trunc(maxIssues));
    this.telemetry = telemetry ?? new TelemetryRegistry(4096);
  }

  info(code: string, message: string, subsystem = 'runtime'): void {
    this.#record('info', code, message, subsystem);
  }

  warning(code: string, message: string, subsystem = 'runtime'): void {
    this.#record('warning', code, message, subsystem);
  }

  error(code: string, message: string, subsystem = 'runtime'): void {
    this.#record('error', code, message, subsystem);
  }

  setFrame(frame: number): void {
    this.#frame = Math.max(0, Math.trunc(frame));
  }

  observeMetric(name: string, value: number, tags: Record<string, string> = {}): void {
    this.telemetry.record(name, value, this.#frame, tags);
  }

  hasErrors(): boolean {
    return this.#issues.some((issue) => issue.severity === 'error');
  }

  bySeverity(severity: DiagnosticIssue['severity']): readonly DiagnosticIssue[] {
    return Object.freeze(this.#issues.filter((issue) => issue.severity === severity));
  }

  snapshot(): DiagnosticSnapshot {
    const issues = Object.freeze([...this.#issues]);
    const metrics = this.telemetry.buffer.snapshot().slice(-256);
    return Object.freeze({
      frame: this.#frame,
      issues,
      metrics,
      digest: stableDigest({ frame: this.#frame, issues, metrics }),
    });
  }

  validateNoErrorCode(code: string): Result<true> {
    const issue = this.#issues.find((item) => item.code === code && item.severity === 'error');
    if (issue) return { ok: false, error: { code: issue.code, message: issue.message, retryable: false } };
    return { ok: true, value: true };
  }

  clear(): void {
    this.#issues = [];
    this.telemetry.clear();
  }

  #record(severity: DiagnosticIssue['severity'], code: string, message: string, subsystem: string): void {
    this.#issues.push(Object.freeze({
      code: String(code).slice(0, 96),
      severity,
      message: String(message).slice(0, 512),
      frame: this.#frame,
      subsystem: String(subsystem).slice(0, 96),
    }));
    while (this.#issues.length > this.maxIssues) this.#issues.shift();
    this.telemetry.count('diagnostic.' + severity, 1, this.#frame);
  }
}
