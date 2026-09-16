import type { Disposable } from './coreTypes.js';
import { stableSort } from './coreTypes.js';

export type GateSeverity = 'info' | 'warning' | 'blocking';
export interface ReleaseGate { readonly id: string; readonly severity: GateSeverity; readonly passed: boolean; readonly detail: string; readonly metric?: number; readonly threshold?: number; }
export interface ReleaseReport { readonly buildId: string; readonly generatedAt: number; readonly passed: boolean; readonly score: number; readonly gates: readonly ReleaseGate[]; readonly summary: Readonly<Record<string, number>>; }
export interface ReleaseInput { readonly typecheck: boolean; readonly tests: boolean; readonly build: boolean; readonly deterministic: boolean; readonly errorRate: number; readonly p95FrameMs: number; readonly memoryRatio: number; readonly unhandledExceptions: number; readonly legacySurfaces: number; }
export interface ReleasePolicy { readonly maxErrorRate: number; readonly maxP95FrameMs: number; readonly maxMemoryRatio: number; readonly maxUnhandledExceptions: number; readonly maxLegacySurfaces: number; }

const DEFAULT_POLICY: ReleasePolicy = Object.freeze({ maxErrorRate: 0.02, maxP95FrameMs: 24, maxMemoryRatio: 0.92, maxUnhandledExceptions: 0, maxLegacySurfaces: 8 });
function metricGate(id: string, value: number, threshold: number, lowerIsBetter: boolean, severity: GateSeverity): ReleaseGate { const passed = lowerIsBetter ? value <= threshold : value >= threshold; return Object.freeze({ id, severity, passed, detail: passed ? `${id} within policy` : `${id} outside policy`, metric: value, threshold }); }

export class ReleaseRuntime implements Disposable {
  readonly policy: ReleasePolicy;
  #disposed = false;
  #reports: ReleaseReport[] = [];
  #now: () => number;
  constructor(policy: Partial<ReleasePolicy> = {}, now: () => number = () => Date.now()) { this.policy = Object.freeze({ ...DEFAULT_POLICY, ...policy }); this.#now = now; }

  evaluate(buildId: string, input: ReleaseInput): ReleaseReport {
    const gates: ReleaseGate[] = [
      { id: 'typecheck', severity: 'blocking', passed: input.typecheck, detail: input.typecheck ? 'TypeScript typecheck passed' : 'TypeScript typecheck failed' },
      { id: 'tests', severity: 'blocking', passed: input.tests, detail: input.tests ? 'Regression suite passed' : 'Regression suite failed' },
      { id: 'build', severity: 'blocking', passed: input.build, detail: input.build ? 'Production build passed' : 'Production build failed' },
      { id: 'deterministic', severity: 'blocking', passed: input.deterministic, detail: input.deterministic ? 'Deterministic boundary passed' : 'Deterministic boundary failed' },
      metricGate('errorRate', input.errorRate, this.policy.maxErrorRate, true, 'blocking'),
      metricGate('p95FrameMs', input.p95FrameMs, this.policy.maxP95FrameMs, true, 'blocking'),
      metricGate('memoryRatio', input.memoryRatio, this.policy.maxMemoryRatio, true, 'warning'),
      metricGate('unhandledExceptions', input.unhandledExceptions, this.policy.maxUnhandledExceptions, true, 'blocking'),
      metricGate('legacySurfaces', input.legacySurfaces, this.policy.maxLegacySurfaces, true, 'warning'),
    ].map(gate => Object.freeze(gate));
    const passedBlocking = gates.filter(gate => gate.severity === 'blocking').every(gate => gate.passed);
    const passedCount = gates.filter(gate => gate.passed).length;
    const score = gates.length ? passedCount / gates.length : 0;
    const report: ReleaseReport = Object.freeze({ buildId: buildId.trim() || 'unknown-build', generatedAt: this.#now(), passed: passedBlocking, score, gates: Object.freeze(stableSort(gates, (a, b) => a.id.localeCompare(b.id))), summary: Object.freeze({ total: gates.length, passed: passedCount, failed: gates.length - passedCount, blockingFailures: gates.filter(gate => gate.severity === 'blocking' && !gate.passed).length, warnings: gates.filter(gate => gate.severity === 'warning' && !gate.passed).length }) });
    this.#reports.push(report); if (this.#reports.length > 64) this.#reports.shift();
    return report;
  }

  latest(): ReleaseReport | null { return this.#reports.at(-1) ?? null; }
  history(): readonly ReleaseReport[] { return Object.freeze(this.#reports.slice()); }
  assert(report = this.latest()): void { if (!report || !report.passed) throw new Error('RELEASE_GATE_FAILED'); }
  clear(): void { this.#reports.length = 0; }
  dispose(): void { this.#disposed = true; this.clear(); }
}
