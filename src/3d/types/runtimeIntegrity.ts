export type IntegrityLevel = 'healthy' | 'degraded' | 'critical' | 'corrupt';
export type RecoveryAction = 'continue' | 'shed-quality' | 'reload-assets' | 'rebuild-renderer' | 'restore-checkpoint' | 'restart-runtime';

export interface IntegrityProbe {
  readonly id: string;
  readonly category: 'state' | 'render' | 'asset' | 'memory' | 'storage' | 'worker';
  readonly critical: boolean;
  readonly check: () => IntegrityObservation | Promise<IntegrityObservation>;
}

export interface IntegrityObservation {
  readonly healthy: boolean;
  readonly score: number;
  readonly message?: string;
  readonly recoverable: boolean;
}

export interface IntegrityReport {
  readonly level: IntegrityLevel;
  readonly score: number;
  readonly checked: number;
  readonly failed: number;
  readonly criticalFailures: number;
  readonly observations: readonly { readonly id: string; readonly observation: IntegrityObservation }[];
  readonly timestamp: number;
}

export interface RecoveryPolicy {
  readonly degradedThreshold: number;
  readonly criticalThreshold: number;
  readonly corruptThreshold: number;
  readonly maxConsecutiveFailures: number;
  readonly checkpointCooldownMs: number;
}

export interface RecoveryContext {
  readonly report: IntegrityReport;
  readonly consecutiveFailures: number;
  readonly lastCheckpointAt: number;
  readonly now: number;
}

export interface RecoveryDecision {
  readonly action: RecoveryAction;
  readonly reason: string;
  readonly severity: IntegrityLevel;
  readonly confidence: number;
}

const defaultPolicy: RecoveryPolicy = {
  degradedThreshold: 0.85,
  criticalThreshold: 0.60,
  corruptThreshold: 0.30,
  maxConsecutiveFailures: 3,
  checkpointCooldownMs: 30000,
};

export function scoreToLevel(score: number): IntegrityLevel {
  if (!Number.isFinite(score) || score < 0.30) return 'corrupt';
  if (score < 0.60) return 'critical';
  if (score < 0.85) return 'degraded';
  return 'healthy';
}

export class RuntimeIntegrityMonitor {
  readonly #probes = new Map<string, IntegrityProbe>();
  readonly #policy: RecoveryPolicy;
  #lastReport: IntegrityReport | undefined;

  constructor(policy: Partial<RecoveryPolicy> = {}) {
    this.#policy = Object.freeze({ ...defaultPolicy, ...policy });
  }

  register(probe: IntegrityProbe): () => void {
    if (!probe.id.trim()) throw new TypeError('Integrity probe id is required');
    if (this.#probes.has(probe.id)) throw new Error(`Integrity probe already exists: ${probe.id}`);
    this.#probes.set(probe.id, probe);
    return () => this.#probes.delete(probe.id);
  }

  async run(): Promise<IntegrityReport> {
    const observations: { id: string; observation: IntegrityObservation }[] = [];
    let scoreSum = 0;
    let failed = 0;
    let criticalFailures = 0;
    for (const probe of this.#probes.values()) {
      try {
        const observation = await probe.check();
        const score = Math.max(0, Math.min(1, Number.isFinite(observation.score) ? observation.score : 0));
        const normalized = { ...observation, score };
        observations.push({ id: probe.id, observation: normalized });
        scoreSum += score;
        if (!normalized.healthy) failed += 1;
        if (probe.critical && !normalized.healthy) criticalFailures += 1;
      } catch (error) {
        const observation: IntegrityObservation = { healthy: false, score: 0, recoverable: false, message: error instanceof Error ? error.message : String(error) };
        observations.push({ id: probe.id, observation });
        failed += 1;
        if (probe.critical) criticalFailures += 1;
      }
    }
    const checked = observations.length;
    const score = checked === 0 ? 1 : scoreSum / checked;
    const report: IntegrityReport = Object.freeze({
      level: criticalFailures > 0 ? 'critical' : scoreToLevel(score),
      score,
      checked,
      failed,
      criticalFailures,
      observations: [...observations],
      timestamp: Date.now(),
    });
    this.#lastReport = report;
    return report;
  }

  lastReport(): IntegrityReport | undefined { return this.#lastReport; }
  size(): number { return this.#probes.size; }
}

export class RecoverySupervisor {
  readonly #policy: RecoveryPolicy;
  #consecutiveFailures = 0;
  #lastCheckpointAt = 0;

  constructor(policy: Partial<RecoveryPolicy> = {}) {
    this.#policy = Object.freeze({ ...defaultPolicy, ...policy });
  }

  decide(report: IntegrityReport, now = Date.now()): RecoveryDecision {
    if (report.level === 'healthy') {
      this.#consecutiveFailures = 0;
      return { action: 'continue', reason: 'integrity-within-budget', severity: 'healthy', confidence: Math.max(0, Math.min(1, report.score)) };
    }
    this.#consecutiveFailures += 1;
    const context: RecoveryContext = { report, consecutiveFailures: this.#consecutiveFailures, lastCheckpointAt: this.#lastCheckpointAt, now };
    if (report.level === 'corrupt' || report.criticalFailures > 1) return this.#hardRecovery(context);
    if (report.score < this.#policy.criticalThreshold || this.#consecutiveFailures >= this.#policy.maxConsecutiveFailures) return this.#criticalRecovery(context);
    return { action: 'shed-quality', reason: 'degraded-integrity', severity: report.level, confidence: 1 - report.score };
  }

  markCheckpoint(now = Date.now()): void { this.#lastCheckpointAt = now; this.#consecutiveFailures = 0; }

  #hardRecovery(context: RecoveryContext): RecoveryDecision {
    if (context.now - context.lastCheckpointAt >= this.#policy.checkpointCooldownMs) {
      this.#lastCheckpointAt = context.now;
      return { action: 'restore-checkpoint', reason: 'corrupt-or-multiple-critical-probes', severity: context.report.level, confidence: 1 };
    }
    return { action: 'restart-runtime', reason: 'checkpoint-cooldown-not-elapsed', severity: 'corrupt', confidence: 0.9 };
  }

  #criticalRecovery(context: RecoveryContext): RecoveryDecision {
    if (context.report.observations.some(({ observation }) => !observation.recoverable)) return { action: 'rebuild-renderer', reason: 'non-recoverable-runtime-observation', severity: 'critical', confidence: 0.85 };
    return { action: 'reload-assets', reason: 'recoverable-integrity-failure', severity: 'critical', confidence: 0.75 };
  }

  get consecutiveFailures(): number { return this.#consecutiveFailures; }
  get lastCheckpointAt(): number { return this.#lastCheckpointAt; }
}

export function createDefaultIntegrityProbes(): readonly IntegrityProbe[] {
  return [
    { id: 'state-finite', category: 'state', critical: true, check: () => ({ healthy: true, score: 1, recoverable: false }) },
    { id: 'render-backend', category: 'render', critical: true, check: () => ({ healthy: true, score: 1, recoverable: true }) },
    { id: 'asset-residency', category: 'asset', critical: false, check: () => ({ healthy: true, score: 1, recoverable: true }) },
    { id: 'memory-budget', category: 'memory', critical: true, check: () => ({ healthy: true, score: 1, recoverable: true }) },
    { id: 'storage-availability', category: 'storage', critical: false, check: () => ({ healthy: true, score: 1, recoverable: true }) },
    { id: 'worker-health', category: 'worker', critical: false, check: () => ({ healthy: true, score: 1, recoverable: true }) },
  ];
}
