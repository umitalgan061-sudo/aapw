import {
  RecoveryDecision,
  RecoverySupervisor,
  RuntimeIntegrityMonitor,
  IntegrityReport,
  createDefaultIntegrityProbes,
} from '../../3d/types/runtimeIntegrity.ts';

export interface KernelHealthView {
  readonly score: number;
  readonly status: 'healthy' | 'degraded' | 'critical';
  readonly reasons: readonly string[];
}

export interface RuntimeDiagnosis {
  readonly health: KernelHealthView;
  readonly integrity: IntegrityReport;
  readonly recovery: RecoveryDecision;
  readonly overallScore: number;
  readonly overallStatus: 'healthy' | 'degraded' | 'critical' | 'corrupt';
}

export interface RuntimeHealthCoordinatorOptions {
  readonly probeDefaults?: boolean;
  readonly integrityPolicy?: ConstructorParameters<typeof RuntimeIntegrityMonitor>[0];
  readonly recoveryPolicy?: ConstructorParameters<typeof RecoverySupervisor>[0];
}

export class RuntimeHealthCoordinator {
  readonly integrity: RuntimeIntegrityMonitor;
  readonly recovery: RecoverySupervisor;
  readonly #getKernelHealth: () => KernelHealthView;

  constructor(
    getKernelHealth: () => KernelHealthView,
    options: RuntimeHealthCoordinatorOptions = {},
  ) {
    this.#getKernelHealth = getKernelHealth;
    this.integrity = new RuntimeIntegrityMonitor(options.integrityPolicy);
    this.recovery = new RecoverySupervisor(options.recoveryPolicy);
    if (options.probeDefaults !== false) {
      for (const probe of createDefaultIntegrityProbes()) this.integrity.register(probe);
    }
  }

  registerProbe = this.integrity.register.bind(this.integrity);

  async diagnose(now = Date.now()): Promise<RuntimeDiagnosis> {
    const health = this.#getKernelHealth();
    const integrity = await this.integrity.run();
    const recovery = this.recovery.decide(integrity, now);
    const healthScore = Math.max(0, Math.min(1, health.score / 100));
    const overallScore = Number((healthScore * 0.55 + integrity.score * 0.45).toFixed(4));
    const overallStatus = integrity.level === 'corrupt' || health.status === 'critical'
      ? 'critical'
      : integrity.level === 'critical'
        ? 'critical'
        : integrity.level === 'degraded' || health.status === 'degraded'
          ? 'degraded'
          : 'healthy';

    return Object.freeze({
      health: Object.freeze({
        score: health.score,
        status: health.status,
        reasons: [...health.reasons],
      }),
      integrity,
      recovery,
      overallScore,
      overallStatus,
    });
  }

  markCheckpoint(now = Date.now()): void {
    this.recovery.markCheckpoint(now);
  }
}
