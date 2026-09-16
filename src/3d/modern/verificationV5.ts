import { checksumV5, type RuntimeSnapshotV5, type RuntimeHealthV5, type RuntimeErrorV5, type EntityStateV5, type OutcomeV5, okV5, failV5, type BudgetV5, defaultBudgetV5, stableStringifyV5 } from './runtimeContractV5';
import { type RuntimeOrchestratorV5 } from './runtimeOrchestratorV5';

export interface VerificationRuleV5 { readonly id: string; readonly description: string; readonly severity: 'warn' | 'error'; readonly check: (context: VerificationContextV5) => boolean; }
export interface VerificationContextV5 { readonly snapshot: RuntimeSnapshotV5; readonly health: RuntimeHealthV5; readonly errors: readonly RuntimeErrorV5[]; readonly budget: BudgetV5; readonly now: number; }
export interface VerificationFindingV5 { readonly ruleId: string; readonly severity: VerificationRuleV5['severity']; readonly description: string; readonly passed: boolean; readonly evidence: string; }
export interface VerificationReportV5 { readonly passed: boolean; readonly score: number; readonly findings: readonly VerificationFindingV5[]; readonly digest: string; }
export interface VerificationOptionsV5 { readonly maxRules?: number; readonly maxFindings?: number; readonly minScore?: number; readonly budget?: BudgetV5; readonly now?: () => number; }

const clampScore = (value: number): number => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

export class RuntimeVerificationV5 {
  readonly maxRules: number; readonly maxFindings: number; readonly minScore: number; readonly budget: BudgetV5;
  #now: () => number; #rules = new Map<string, VerificationRuleV5>(); #history: VerificationReportV5[] = [];
  constructor(options: VerificationOptionsV5 = {}) { this.maxRules = Math.max(8, Math.min(2048, Math.floor(options.maxRules ?? 128))); this.maxFindings = Math.max(8, Math.min(4096, Math.floor(options.maxFindings ?? 512))); this.minScore = clampScore(options.minScore ?? 92); this.budget = Object.freeze({ ...defaultBudgetV5(), ...options.budget }); this.#now = options.now ?? (() => Date.now()); this.#installDefaults(); }
  register(rule: VerificationRuleV5): OutcomeV5<void> { if (!rule.id || rule.id.length > 96) return failV5('VERIFY_ID', 'Invalid verification rule id'); if (this.#rules.size >= this.maxRules && !this.#rules.has(rule.id)) return failV5('VERIFY_LIMIT', 'Verification rule limit reached'); this.#rules.set(rule.id, Object.freeze({ ...rule })); return okV5(undefined); }
  unregister(id: string): boolean { return this.#rules.delete(id); }
  rules(): readonly VerificationRuleV5[] { return Object.freeze([...this.#rules.values()].sort((a, b) => a.id.localeCompare(b.id))); }
  verify<T>(runtime: RuntimeOrchestratorV5<T>): VerificationReportV5 { const snapshot = runtime.snapshot(); const health = runtime.health(); const context: VerificationContextV5 = Object.freeze({ snapshot, health, errors: [], budget: this.budget, now: this.#now() }); const findings: VerificationFindingV5[] = []; let passedWeight = 0; let totalWeight = 0; for (const rule of this.rules()) { let passed = false; try { passed = Boolean(rule.check(context)); } catch { passed = false; } const weight = rule.severity === 'error' ? 3 : 1; totalWeight += weight; if (passed) passedWeight += weight; if (findings.length < this.maxFindings) findings.push(Object.freeze({ ruleId: rule.id, severity: rule.severity, description: rule.description, passed, evidence: passed ? 'check-ok' : this.#evidence(rule.id, context) })); } const score = totalWeight ? clampScore((passedWeight / totalWeight) * 100) : 100; const hardFailure = findings.some((finding) => finding.severity === 'error' && !finding.passed); const report: VerificationReportV5 = Object.freeze({ passed: !hardFailure && score >= this.minScore, score, findings: Object.freeze(findings), digest: checksumV5({ score, findings }) }); this.#history.push(report); while (this.#history.length > 32) this.#history.shift(); return report; }
  latest(): VerificationReportV5 | null { return this.#history.at(-1) ?? null; }
  history(): readonly VerificationReportV5[] { return Object.freeze(this.#history.slice()); }
  clearHistory(): void { this.#history.length = 0; }

  #evidence(id: string, context: VerificationContextV5): string { switch (id) { case 'phase': return `phase=${context.snapshot.phase}`; case 'health': return `score=${context.health.score}`; case 'checksum': return `checksum=${context.snapshot.checksum}`; case 'entities': return `count=${context.snapshot.entities.length}`; case 'finite': return 'non-finite-state'; default: return `rule=${id}`; } }
  #installDefaults(): void {
    this.register({ id: 'phase', description: 'Runtime is not terminal when verification is requested', severity: 'error', check: (context) => context.snapshot.phase !== 'failed' });
    this.register({ id: 'health', description: 'Runtime health stays above the production floor', severity: 'error', check: (context) => context.health.score >= this.minScore });
    this.register({ id: 'checksum', description: 'Snapshot checksum is reproducible', severity: 'error', check: (context) => context.snapshot.checksum === checksumV5({ runtimeId: context.snapshot.runtimeId, tick: context.snapshot.tick, phase: context.snapshot.phase, brand: context.snapshot.brand, quality: context.snapshot.quality, entities: context.snapshot.entities }) });
    this.register({ id: 'entities', description: 'Entity ids are unique and deterministically ordered', severity: 'error', check: (context) => { const ids = context.snapshot.entities.map((entity) => Number(entity.id)); return ids.length === new Set(ids).size && ids.every((id, index) => index === 0 || id >= ids[index - 1]!); } });
    this.register({ id: 'finite', description: 'Transform and velocity state remains finite', severity: 'error', check: (context) => context.snapshot.entities.every((entity) => this.#entityFinite(entity)) });
    this.register({ id: 'velocity', description: 'Velocity magnitude remains within sane runtime limits', severity: 'warn', check: (context) => context.snapshot.entities.every((entity) => Math.hypot(entity.velocity.x, entity.velocity.y, entity.velocity.z) < 10_000) });
    this.register({ id: 'tags', description: 'Tags are normalized and bounded', severity: 'warn', check: (context) => context.snapshot.entities.every((entity) => entity.tags.length <= 128 && entity.tags.every((tag) => tag.length <= 48)) });
    this.register({ id: 'tick', description: 'Simulation tick is a non-negative integer', severity: 'error', check: (context) => Number.isInteger(context.snapshot.tick) && context.snapshot.tick >= 0 });
    this.register({ id: 'quality', description: 'Quality is a recognized production tier', severity: 'warn', check: (context) => ['minimal', 'balanced', 'high', 'ultra'].includes(context.snapshot.quality) });
    this.register({ id: 'budget', description: 'Budget ceilings are positive', severity: 'warn', check: (context) => Object.values(context.budget).every((value) => Number.isFinite(value) && value > 0) });
    this.register({ id: 'pressure', description: 'Runtime pressure should remain below the hard failure boundary', severity: 'warn', check: (context) => context.health.pressure < 1.5 });
    this.register({ id: 'recovery', description: 'Recovery count is bounded', severity: 'warn', check: (context) => context.health.recoveryCount >= 0 && context.health.recoveryCount < 1000 });
    this.register({ id: 'errors', description: 'Error count stays bounded during a healthy session', severity: 'warn', check: (context) => context.health.errors < 100 });
  }
  #entityFinite(entity: EntityStateV5): boolean { const values = [entity.transform.position.x, entity.transform.position.y, entity.transform.position.z, entity.velocity.x, entity.velocity.y, entity.velocity.z, entity.transform.rotation.x, entity.transform.rotation.y, entity.transform.rotation.z, entity.transform.rotation.w, entity.transform.scale.x, entity.transform.scale.y, entity.transform.scale.z]; return values.every((value) => Number.isFinite(value)); }
}

export function verificationDigestV5(report: VerificationReportV5): string { return checksumV5(stableStringifyV5(report)); }
export function failedVerificationRulesV5(report: VerificationReportV5): readonly string[] { return Object.freeze(report.findings.filter((finding) => !finding.passed).map((finding) => finding.ruleId)); }
