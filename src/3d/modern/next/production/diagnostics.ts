import type { RuntimeCapabilities, RuntimeClock, RuntimeHealthReport, RuntimeIdentity, RuntimeBudget, RuntimeFault, SubsystemId } from './contracts.ts';
import type { ProductionRuntimeController } from './runtimeController.ts';

export interface DiagnosticSeries {
  readonly name: string;
  readonly values: readonly number[];
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p95: number;
}

export interface DiagnosticCounters {
  readonly frames: number;
  readonly entities: number;
  readonly visibleEntities: number;
  readonly workersPending: number;
  readonly networkPeers: number;
  readonly networkPendingPackets: number;
  readonly persistenceWrites: number;
  readonly persistenceReads: number;
  readonly persistenceFailures: number;
  readonly faults: number;
}

export interface ProductionDiagnosticsSnapshot {
  readonly capturedAtMs: number;
  readonly identity: RuntimeIdentity;
  readonly mode: RuntimeHealthReport['mode'];
  readonly clock: RuntimeClock;
  readonly budget: RuntimeBudget;
  readonly capabilities: RuntimeCapabilities;
  readonly counters: DiagnosticCounters;
  readonly series: readonly DiagnosticSeries[];
  readonly subsystems: readonly RuntimeHealthReport['subsystems'];
  readonly faults: readonly RuntimeFault[];
}

export interface DiagnosticsOptions {
  readonly historySize: number;
  readonly includeFaults: boolean;
}

const DEFAULT_OPTIONS: DiagnosticsOptions = {
  historySize: 120,
  includeFaults: true,
};

export class ProductionDiagnosticsService {
  readonly runtime: ProductionRuntimeController;
  readonly options: DiagnosticsOptions;
  #history = new Map<string, number[]>();
  #seriesOrder: string[] = [];

  constructor(runtime: ProductionRuntimeController, options: Partial<DiagnosticsOptions> = {}) {
    this.runtime = runtime;
    this.options = {
      historySize: Math.max(16, Math.floor(options.historySize ?? DEFAULT_OPTIONS.historySize)),
      includeFaults: Boolean(options.includeFaults ?? DEFAULT_OPTIONS.includeFaults),
    };
  }

  capture(): ProductionDiagnosticsSnapshot {
    const stats = this.runtime.stats();
    const health = this.runtime.health();
    const telemetry = stats.telemetry;
    const frameTotal = telemetry.budget?.frameMs ?? 0;
    this.record('frameMs', frameTotal);
    this.record('entities', stats.entities);
    this.record('visibleEntities', stats.visibleEntities);
    this.record('networkRttMs', stats.network.averageRttMs);
    this.record('networkPendingPackets', stats.network.pendingPackets);
    this.record('workerPending', stats.workers.pending);
    this.record('persistenceFailures', stats.persistence.failures);

    return {
      capturedAtMs: globalThis.performance?.now?.() ?? Date.now(),
      identity: this.runtime.identity,
      mode: health.mode,
      clock: this.runtime.clock(),
      budget: health.budget,
      capabilities: health.capabilities,
      counters: {
        frames: stats.frames,
        entities: stats.entities,
        visibleEntities: stats.visibleEntities,
        workersPending: stats.workers.pending,
        networkPeers: stats.network.peers,
        networkPendingPackets: stats.network.pendingPackets,
        persistenceWrites: stats.persistence.writes,
        persistenceReads: stats.persistence.reads,
        persistenceFailures: stats.persistence.failures,
        faults: telemetry.faults,
      },
      series: this.#series(),
      subsystems: health.subsystems,
      faults: this.options.includeFaults ? this.runtime.observability.faults(32) : [],
    };
  }

  evaluate(): {
    overall: 'ok' | 'degraded' | 'critical';
    score: number;
    issues: readonly string[];
    recommendations: readonly string[];
  } {
    const health = this.runtime.health();
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = 1;

    for (const subsystem of health.subsystems) {
      score = Math.min(score, subsystem.score);
      if (subsystem.level === 'degraded') issues.push(`${subsystem.subsystem}: degraded`);
      if (subsystem.level === 'critical') issues.push(`${subsystem.subsystem}: critical`);
    }

    if (health.budget.frame.totalMs > health.budget.targetFrameMs) {
      issues.push('frame budget exceeded');
      recommendations.push('lower render tier or spread simulation and streaming work');
    }
    if (health.budget.frame.networkMs > health.budget.targetFrameMs * 0.2) {
      recommendations.push('reduce network snapshot frequency or delta payload size');
    }
    if (health.budget.frame.streamingMs > health.budget.targetFrameMs * 0.2) {
      recommendations.push('stagger chunk and resource residency transitions');
    }
    if (health.budget.memoryBytes > 1024 * 1024 * 1024) {
      recommendations.push('evict unpinned resources before loading additional world content');
    }
    if (health.queuedWorkers > 32) {
      issues.push('worker queue pressure');
      recommendations.push('defer background worker tasks');
    }

    const overall = score < 0.45 ? 'critical' : score < 0.75 ? 'degraded' : 'ok';
    return { overall, score, issues, recommendations: [...new Set(recommendations)] };
  }

  exportJson(): string {
    return JSON.stringify(this.capture());
  }

  reset(): void {
    this.#history.clear();
    this.#seriesOrder.length = 0;
  }

  #record(name: string, value: number): void {
    let values = this.#history.get(name);
    if (!values) {
      values = [];
      this.#history.set(name, values);
      this.#seriesOrder.push(name);
    }
    if (values.length >= this.options.historySize) values.shift();
    values.push(Number.isFinite(value) ? Math.max(0, value) : 0);
  }

  #series(): DiagnosticSeries[] {
    return this.#seriesOrder.slice().sort().map((name) => {
      const values = this.#history.get(name) ?? [];
      const sorted = [...values].sort((a,b) => a-b);
      const sum = values.reduce((total,value) => total + value, 0);
      const percentile = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]! : 0;
      return {
        name,
        values: values.slice(),
        min: sorted[0] ?? 0,
        max: sorted.at(-1) ?? 0,
        mean: values.length ? sum / values.length : 0,
        p95: percentile(0.95),
      };
    });
  }
}

export function buildSubsystemMatrix(report: RuntimeHealthReport): Record<SubsystemId, number> {
  const result = {} as Record<SubsystemId, number>;
  for (const subsystem of report.subsystems) result[subsystem.subsystem] = subsystem.score;
  return result;
}
