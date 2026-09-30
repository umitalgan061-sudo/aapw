export type HealthStatus = 'passed' | 'failed' | 'timed-out';

export interface HealthGate {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

export interface HealthGateResult {
  readonly id: string;
  readonly status: HealthStatus;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface HealthSummary {
  readonly ok: boolean;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly timedOut: number;
  readonly durationMs: number;
  readonly gates: readonly HealthGateResult[];
}

export function summarizeHealth(gates: readonly HealthGateResult[], durationMs: number): HealthSummary {
  const passed = gates.filter((gate) => gate.status === 'passed').length;
  const failed = gates.filter((gate) => gate.status === 'failed').length;
  const timedOut = gates.filter((gate) => gate.status === 'timed-out').length;
  return Object.freeze({
    ok: failed === 0 && timedOut === 0,
    total: gates.length,
    passed,
    failed,
    timedOut,
    durationMs,
    gates: Object.freeze([...gates]),
  });
}
