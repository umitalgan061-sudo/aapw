import type { PlatformError, Result } from './types';
import { checksum, stableStringify } from './deterministic';

export type DiagnosticSeverity = 'info' | 'warning' | 'error' | 'fatal';

export interface DiagnosticEntry {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly subsystem: string;
  readonly timestamp: number;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface HealthReport {
  readonly ok: boolean;
  readonly score: number;
  readonly errors: number;
  readonly warnings: number;
  readonly digest: string;
  readonly entries: readonly DiagnosticEntry[];
}

/** Bounded diagnostics ring-buffer; designed to replace unstructured console-only failure reporting. */
export class Diagnostics {
  #entries: DiagnosticEntry[] = [];
  #capacity: number;
  #now: () => number;

  constructor(options: { readonly capacity?: number; readonly now?: () => number } = {}) {
    this.#capacity = Math.max(64, Math.floor(options.capacity ?? 512));
    this.#now = options.now ?? (() => Date.now());
  }

  record(entry: Omit<DiagnosticEntry, 'timestamp'> & { readonly timestamp?: number }): void {
    this.#entries.push({ ...entry, timestamp: entry.timestamp ?? this.#now() });
    if (this.#entries.length > this.#capacity) this.#entries.splice(0, this.#entries.length - this.#capacity);
  }

  info(code: string, message: string, subsystem: string, data?: Readonly<Record<string, unknown>>): void {
    this.record({ code, message, subsystem, severity: 'info', data });
  }

  warning(code: string, message: string, subsystem: string, data?: Readonly<Record<string, unknown>>): void {
    this.record({ code, message, subsystem, severity: 'warning', data });
  }

  error(code: string, message: string, subsystem: string, data?: Readonly<Record<string, unknown>>): void {
    this.record({ code, message, subsystem, severity: 'error', data });
  }

  fatal(code: string, message: string, subsystem: string, data?: Readonly<Record<string, unknown>>): void {
    this.record({ code, message, subsystem, severity: 'fatal', data });
  }

  capture(error: unknown, subsystem: string, code = 'UNHANDLED_ERROR'): PlatformError {
    const message = error instanceof Error ? error.message : String(error);
    this.error(code, message, subsystem, { stack: error instanceof Error ? error.stack : undefined });
    return { code, message, cause: error, retryable: false };
  }

  entries(): readonly DiagnosticEntry[] { return this.#entries.map((entry) => ({ ...entry })); }

  health(): HealthReport {
    const errors = this.#entries.filter((entry) => entry.severity === 'error' || entry.severity === 'fatal').length;
    const warnings = this.#entries.filter((entry) => entry.severity === 'warning').length;
    const score = Math.max(0, Math.min(100, 100 - errors * 18 - warnings * 4));
    const digest = checksum(this.#entries.map(({ timestamp: _timestamp, ...entry }) => entry));
    return { ok: errors === 0, score, errors, warnings, digest, entries: this.entries() };
  }

  exportJson(pretty = false): string {
    return JSON.stringify({ generatedAt: this.#now(), health: this.health() }, null, pretty ? 2 : 0);
  }

  importJson(serialized: string): Result<number> {
    try {
      const parsed: unknown = JSON.parse(serialized);
      if (!parsed || typeof parsed !== 'object' || !('health' in parsed)) {
        return { ok: false, error: { code: 'DIAGNOSTIC_IMPORT_INVALID', message: 'Invalid diagnostic payload', retryable: false } };
      }
      const health = (parsed as { health: { entries?: unknown } }).health;
      if (!Array.isArray(health.entries)) {
        return { ok: false, error: { code: 'DIAGNOSTIC_IMPORT_INVALID', message: 'Missing diagnostic entries', retryable: false } };
      }
      let count = 0;
      for (const entry of health.entries) {
        if (!entry || typeof entry !== 'object') continue;
        const item = entry as DiagnosticEntry;
        if (typeof item.code !== 'string' || typeof item.message !== 'string' || typeof item.subsystem !== 'string') continue;
        this.record(item);
        count += 1;
      }
      return { ok: true, value: count };
    } catch (error) {
      return { ok: false, error: { code: 'DIAGNOSTIC_IMPORT_FAILED', message: String(error), retryable: false, cause: error } };
    }
  }

  digest(): string { return checksum(stableStringify(this.#entries)); }
  clear(): void { this.#entries = []; }
}
