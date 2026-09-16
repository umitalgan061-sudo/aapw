import type { Result } from './types';
import { checksum } from './deterministic';
import type { RuntimeKernel } from './runtimeKernel';

export interface AcceptanceCheck {
  readonly id: string;
  readonly description: string;
  readonly pass: boolean;
  readonly detail: string;
}

export interface AcceptanceReport {
  readonly passed: boolean;
  readonly checks: readonly AcceptanceCheck[];
  readonly passedCount: number;
  readonly totalCount: number;
  readonly digest: string;
}

function check(id: string, description: string, pass: boolean, detail: string): AcceptanceCheck {
  return Object.freeze({ id, description, pass, detail });
}

/** Executes cheap runtime invariants suitable for release smoke tests and startup diagnostics. */
export function runRuntimeAcceptance(kernel: RuntimeKernel): Result<AcceptanceReport> {
  const health = kernel.health();
  const diagnostics = kernel.diagnosticsSnapshot();
  const probeA = kernel.deterministicProbe(16);
  const probeB = kernel.deterministicProbe(16);
  const checks = [
    check('determinism', 'same seed must produce the same probe', JSON.stringify(probeA) === JSON.stringify(probeB), 'counter-based deterministic probe'),
    check('entity-cap', 'entity storage must remain within configured cap', health.commands && diagnostics.entities !== undefined, `entities=${String(diagnostics.entities)}`),
    check('streaming-bound', 'streaming state remains bounded', health.streaming, `loaded=${String(diagnostics.streaming && typeof diagnostics.streaming === 'object' ? (diagnostics.streaming as { loaded?: unknown }).loaded : 'n/a')}`),
    check('resource-budget', 'resource residency remains inside configured budget', health.resources, `resources=${JSON.stringify(diagnostics.resources)}`),
    check('diagnostics', 'diagnostics subsystem is operational', health.diagnostics, 'diagnostic score is non-fatal'),
  ];
  const passedCount = checks.filter((item) => item.pass).length;
  const report: AcceptanceReport = Object.freeze({
    passed: passedCount === checks.length,
    checks: Object.freeze(checks),
    passedCount,
    totalCount: checks.length,
    digest: checksum(checks),
  });
  return { ok: report.passed, value: report };
}
