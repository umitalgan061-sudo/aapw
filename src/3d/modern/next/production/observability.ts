import type { Tick } from '../types.ts';
import { evaluateBudget, RollingBudgetMetrics, type BudgetHealth } from '../metrics.ts';
import type {
  RuntimeClock,
  RuntimeBudget,
  RuntimeFault,
  RuntimeHealthReport,
  RuntimeIdentity,
  SubsystemHealth,
  SubsystemId,
  HealthLevel,
  RuntimeCapabilities,
  NetworkPeerState,
} from './contracts.ts';
import { emptyRuntimeHealth, scoreHealth } from './contracts.ts';

export interface ObservabilityConfig {
  readonly historySize: number;
  readonly faultHistorySize: number;
  readonly criticalFaultRatio: number;
  readonly warningFrameMs: number;
}

interface CounterSet {
  calls: number;
  failures: number;
  totalMs: number;
}

interface SubsystemRecord {
  calls: number;
  failures: number;
  totalMs: number;
  consecutiveFailures: number;
  lastFault?: RuntimeFault;
  lastTick: Tick;
}

export interface RuntimeTelemetrySnapshot {
  readonly counters: Readonly<Record<string, CounterSet>>;
  readonly budget: BudgetHealth | undefined;
  readonly frames: number;
  readonly faults: number;
  readonly activeSubsystems: number;
  readonly recentFaults: readonly RuntimeFault[];
}

const DEFAULT_CONFIG: ObservabilityConfig = {
  historySize: 180,
  faultHistorySize: 128,
  criticalFaultRatio: 0.2,
  warningFrameMs: 18,
};

export class ProductionObservability {
  readonly config: ObservabilityConfig;
  #counters = new Map<string, CounterSet>();
  #subsystems = new Map<SubsystemId, SubsystemRecord>();
  #faults: RuntimeFault[] = [];
  #budgetMetrics: RollingBudgetMetrics;
  #healthHistory: RuntimeHealthReport[] = [];
  #frames = 0;

  constructor(config: Partial<ObservabilityConfig> = {}) {
    this.config = {
      historySize: Math.max(30, Math.floor(config.historySize ?? DEFAULT_CONFIG.historySize)),
      faultHistorySize: Math.max(16, Math.floor(config.faultHistorySize ?? DEFAULT_CONFIG.faultHistorySize)),
      criticalFaultRatio: Math.min(1, Math.max(0.01, config.criticalFaultRatio ?? DEFAULT_CONFIG.criticalFaultRatio)),
      warningFrameMs: Math.max(8, config.warningFrameMs ?? DEFAULT_CONFIG.warningFrameMs),
    };
    this.#budgetMetrics = new RollingBudgetMetrics(this.config.historySize);
  }

  begin(subsystem: SubsystemId, label = subsystem): () => void {
    const key = label.trim() || subsystem;
    const startedAt = performanceNow();
    this.increment(key, 'calls');
    return () => {
      const elapsed = Math.max(0, performanceNow() - startedAt);
      const counter = this.#counter(key);
      counter.totalMs += elapsed;
      this.#subsystem(subsystem).totalMs += elapsed;
    };
  }

  increment(name: string, field: 'calls' | 'failures', amount = 1): void {
    const counter = this.#counter(name);
    counter[field] += Math.max(0, Math.floor(amount));
  }

  recordSuccess(subsystem: SubsystemId, tickValue: Tick): void {
    const record = this.#subsystem(subsystem);
    record.consecutiveFailures = 0;
    record.lastTick = tickValue;
  }

  recordFailure(fault: RuntimeFault): void {
    const record = this.#subsystem(fault.subsystem);
    record.failures += 1;
    record.consecutiveFailures += 1;
    record.lastFault = fault;
    record.lastTick = fault.tick;
    this.increment(fault.subsystem, 'failures');
    this.#faults.push(fault);
    if (this.#faults.length > this.config.faultHistorySize) this.#faults.shift();
  }

  frame(clock: RuntimeClock, budget: RuntimeBudget, identity: RuntimeIdentity, capabilities: RuntimeCapabilities, activeEntities: number, residentChunks: number, queuedInputs: number, queuedWorkers: number, peers: readonly NetworkPeerState[]): RuntimeHealthReport {
    this.#frames += 1;
    const budgetHealth = evaluateBudget({
      simulationMs: budget.frame.simulationMs,
      renderMs: budget.frame.renderMs,
      streamingMs: budget.frame.streamingMs,
      networkMs: budget.frame.networkMs,
      workerMs: budget.workerMs,
      memoryBytes: budget.memoryBytes,
      targetFrameMs: budget.targetFrameMs,
    });
    this.#budgetMetrics.add(budgetHealth);

    const subsystems = [...this.#subsystems.keys()].sort().map((subsystem) => this.#health(subsystem, clock.tick, budgetHealth));
    const health = this.#deriveOverallMode(budgetHealth, subsystems);
    const report: RuntimeHealthReport = {
      identity,
      mode: health.mode,
      clock,
      budget,
      capabilities,
      subsystems,
      activeEntities: Math.max(0, Math.floor(activeEntities)),
      residentChunks: Math.max(0, Math.floor(residentChunks)),
      queuedInputs: Math.max(0, Math.floor(queuedInputs)),
      queuedWorkers: Math.max(0, Math.floor(queuedWorkers)),
      peers: peers.map((peer) => ({ ...peer })).sort((a,b) => a.peerId.localeCompare(b.peerId)),
    };
    this.#healthHistory.push(report);
    if (this.#healthHistory.length > this.config.historySize) this.#healthHistory.shift();
    return report;
  }

  snapshot(): RuntimeTelemetrySnapshot {
    return {
      counters: Object.fromEntries([...this.#counters.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([name,counter]) => [name, { ...counter }])),
      budget: this.#budgetMetrics.latest(),
      frames: this.#frames,
      faults: this.#faults.length,
      activeSubsystems: this.#subsystems.size,
      recentFaults: this.#faults.slice(-16),
    };
  }

  recentHealth(limit = 30): RuntimeHealthReport[] {
    return this.#healthHistory.slice(-Math.max(0, Math.floor(limit)));
  }

  subsystem(subsystem: SubsystemId): SubsystemHealth {
    const budget = this.#budgetMetrics.latest();
    return this.#health(subsystem, tick(0), budget);
  }

  faults(limit = 32): RuntimeFault[] {
    return this.#faults.slice(-Math.max(0, Math.floor(limit)));
  }

  reset(): void {
    this.#counters.clear();
    this.#subsystems.clear();
    this.#faults.length = 0;
    this.#healthHistory.length = 0;
    this.#budgetMetrics.clear();
    this.#frames = 0;
  }

  #health(subsystem: SubsystemId, tickValue: Tick, budget?: BudgetHealth): SubsystemHealth {
    const record = this.#subsystem(subsystem);
    const level = resolveHealthLevel(record, budget, this.config.criticalFaultRatio);
    return {
      subsystem,
      level,
      score: scoreHealth(level, record.consecutiveFailures),
      consecutiveFailures: record.consecutiveFailures,
      lastFault: record.lastFault,
      updatedTick: tickValue,
    };
  }

  #deriveOverallMode(
    budget: BudgetHealth,
    subsystems: readonly SubsystemHealth[],
  ): { mode: RuntimeHealthReport['mode'] } {
    if (subsystems.some((entry) => entry.level === 'critical' && entry.subsystem === 'simulation')) return { mode: 'faulted' };
    if (subsystems.some((entry) => entry.level === 'critical')) return { mode: 'recovering' };
    if (budget.status === 'critical' || subsystems.some((entry) => entry.level === 'degraded')) return { mode: 'running' };
    return { mode: 'running' };
  }

  #counter(name: string): CounterSet {
    let counter = this.#counters.get(name);
    if (!counter) {
      counter = { calls: 0, failures: 0, totalMs: 0 };
      this.#counters.set(name, counter);
    }
    return counter;
  }

  #subsystem(name: SubsystemId): SubsystemRecord {
    let record = this.#subsystems.get(name);
    if (!record) {
      record = { calls: 0, failures: 0, totalMs: 0, consecutiveFailures: 0, lastTick: tick(0) };
      this.#subsystems.set(name, record);
    }
    return record;
  }
}

function resolveHealthLevel(record: SubsystemRecord, budget: BudgetHealth | undefined, criticalFaultRatio: number): HealthLevel {
  if (record.consecutiveFailures >= 3) return 'critical';
  if (record.consecutiveFailures > 0) return 'degraded';
  if (budget?.status === 'critical' && budget.frameBudgetUtilization > 1.5) return 'degraded';
  if (record.calls > 0 && record.failures / record.calls >= criticalFaultRatio) return 'degraded';
  return 'ok';
}

function performanceNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function buildInitialHealth(identity: RuntimeIdentity, capabilities: RuntimeCapabilities): RuntimeHealthReport {
  const clock: RuntimeClock = {
    tick: tick(0),
    simTimeSeconds: 0,
    wallTimeMs: 0,
    frameIndex: 0,
    deltaSeconds: 0,
  };
  const budget: RuntimeBudget = {
    targetFrameMs: 16.6,
    frame: { simulationMs: 0, renderMs: 0, streamingMs: 0, networkMs: 0, totalMs: 0 },
    workerMs: 0,
    memoryBytes: 0,
    render: {
      tier: 'medium',
      pixelRatio: 1.5,
      shadowMapSize: 2048,
      visibleDistance: 0.75,
      vegetationDensity: 0.7,
      effectsDensity: 0.7,
      lodBias: 0.35,
    },
  };
  return emptyRuntimeHealth(identity, clock, budget, capabilities);
}
