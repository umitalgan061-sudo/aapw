import type { Disposable } from './coreTypes.js';
import { stableSort } from './coreTypes.js';
import type { EngineRuntime } from './engineRuntime.js';

export type QualitySeverity = 'info' | 'warning' | 'blocking';
export interface QualityFinding { readonly id: string; readonly severity: QualitySeverity; readonly domain: string; readonly message: string; readonly metric?: number; readonly threshold?: number; }
export interface QualityReport { readonly passed: boolean; readonly score: number; readonly findings: readonly QualityFinding[]; readonly checkedAt: number; readonly build: string; }
export interface QualityPolicy { readonly maxEntities: number; readonly maxMemoryRatio: number; readonly maxFrameMs: number; readonly maxDroppedSteps: number; readonly maxNetworkPending: number; readonly minScore: number; }

const DEFAULT_POLICY: QualityPolicy = Object.freeze({ maxEntities: 8192, maxMemoryRatio: 0.92, maxFrameMs: 24, maxDroppedSteps: 0, maxNetworkPending: 256, minScore: 0.8 });

export class RuntimeQualityInspector implements Disposable {
  readonly policy: QualityPolicy;
  #now: () => number;
  #last: QualityReport | null = null;
  #disposed = false;

  constructor(policy: Partial<QualityPolicy> = {}, now: () => number = () => Date.now()) { this.policy = Object.freeze({ ...DEFAULT_POLICY, ...policy }); this.#now = now; }

  inspect(engine: EngineRuntime, build = 'unknown'): QualityReport {
    if (this.#disposed) return Object.freeze({ passed: false, score: 0, findings: [Object.freeze({ id: 'disposed', severity: 'blocking', domain: 'runtime', message: 'Inspector disposed' })], checkedAt: this.#now(), build });
    const snapshot = engine.runtime.snapshot();
    const findings: QualityFinding[] = [];
    if (snapshot.entities > this.policy.maxEntities) findings.push(Object.freeze({ id: 'entity-budget', severity: 'blocking', domain: 'world', message: 'Entity budget exceeded', metric: snapshot.entities, threshold: this.policy.maxEntities }));
    const frameMs = snapshot.scheduler.deltaSeconds * 1000;
    if (frameMs > this.policy.maxFrameMs) findings.push(Object.freeze({ id: 'frame-budget', severity: 'warning', domain: 'render', message: 'Frame delta exceeds release target', metric: frameMs, threshold: this.policy.maxFrameMs }));
    if (snapshot.scheduler.droppedSteps > this.policy.maxDroppedSteps) findings.push(Object.freeze({ id: 'dropped-steps', severity: 'blocking', domain: 'simulation', message: 'Fixed-step simulation dropped work', metric: snapshot.scheduler.droppedSteps, threshold: this.policy.maxDroppedSteps }));
    const score = Math.max(0, 1 - findings.reduce((sum, finding) => sum + (finding.severity === 'blocking' ? 0.2 : 0.1), 0));
    const passed = score >= this.policy.minScore && !findings.some(finding => finding.severity === 'blocking');
    const report = Object.freeze({ passed, score, findings: Object.freeze(stableSort(findings, (a, b) => a.severity.localeCompare(b.severity) || a.id.localeCompare(b.id))), checkedAt: this.#now(), build });
    this.#last = report;
    return report;
  }

  latest(): QualityReport | null { return this.#last; }
  assert(engine: EngineRuntime): QualityReport { const report = this.inspect(engine); if (!report.passed) throw new Error('RUNTIME_QUALITY_GATE_FAILED'); return report; }
  clear(): void { this.#last = null; }
  dispose(): void { this.#disposed = true; this.clear(); }
}
