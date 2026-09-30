import type { RuntimeHealthReportR31 } from './applicationTypesR31.ts';
import type { ApplicationKernelDiagnosticsR31 } from './applicationKernelR31.ts';

export interface AcceptanceCheckR31 {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface RuntimeAcceptanceReportR31 {
  readonly accepted: boolean;
  readonly checks: readonly AcceptanceCheckR31[];
  readonly health: RuntimeHealthReportR31;
}

export function evaluateRuntimeAcceptanceR31(
  diagnostics: ApplicationKernelDiagnosticsR31,
  options: { readonly requireHealthy?: boolean; readonly maxQueuedCommands?: number } = {},
): RuntimeAcceptanceReportR31 {
  const checks: AcceptanceCheckR31[] = [];
  checks.push({
    id: 'lifecycle',
    ok: diagnostics.lifecycle.status === 'running' || diagnostics.lifecycle.status === 'paused',
    detail: `status=${diagnostics.lifecycle.status}`,
  });
  checks.push({
    id: 'scheduler',
    ok: diagnostics.scheduler.budgetViolations === 0,
    detail: `budgetViolations=${diagnostics.scheduler.budgetViolations}`,
  });
  checks.push({
    id: 'events',
    ok: diagnostics.events.dropped === 0,
    detail: `dropped=${diagnostics.events.dropped}`,
  });
  checks.push({
    id: 'commands',
    ok: diagnostics.commands.dropped <= (options.maxQueuedCommands ?? 10),
    detail: `dropped=${diagnostics.commands.dropped}`,
  });
  checks.push({
    id: 'health',
    ok: options.requireHealthy === false ? true : diagnostics.health.healthy,
    detail: `score=${diagnostics.health.score}`,
  });
  return Object.freeze({
    accepted: checks.every((check) => check.ok),
    checks: Object.freeze(checks),
    health: diagnostics.health,
  });
}

export function formatAcceptanceReportR31(report: RuntimeAcceptanceReportR31): string {
  const lines = [
    `R31 acceptance: ${report.accepted ? 'PASS' : 'FAIL'}`,
    `health=${report.health.score} p95=${report.health.p95FrameMs.toFixed(2)}ms`,
  ];
  for (const check of report.checks) lines.push(`[${check.ok ? 'OK' : 'FAIL'}] ${check.id}: ${check.detail}`);
  return lines.join('\n');
}
