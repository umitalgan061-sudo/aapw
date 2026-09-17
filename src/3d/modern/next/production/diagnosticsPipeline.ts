import { clampP, checksumP, finiteP, integerP, type EventSinkP, type FrameBudgetP, type HealthState, type RuntimeHealthP, type RuntimeFrameReportP } from './contracts.ts';

export interface DiagnosticsConfigP {
  readonly maxSamples: number;
  readonly criticalFrameMultiplier: number;
  readonly degradedFrameMultiplier: number;
  readonly criticalMemoryMb: number;
  readonly degradedMemoryMb: number;
  readonly criticalRttMs: number;
  readonly degradedRttMs: number;
}

export interface PhaseSampleP {
  readonly frame: number;
  readonly tick: number;
  readonly budget: FrameBudgetP;
}

export interface DiagnosticsStatsP {
  readonly samples: number;
  readonly averageFrameMs: number;
  readonly p95FrameMs: number;
  readonly droppedFrames: number;
  readonly criticalFrames: number;
  readonly degradedFrames: number;
  readonly score: number;
  readonly checksum: number;
}

const DEFAULTS: DiagnosticsConfigP = Object.freeze({ maxSamples: 600, criticalFrameMultiplier: 1.5, degradedFrameMultiplier: 1.15, criticalMemoryMb: 2048, degradedMemoryMb: 1536, criticalRttMs: 250, degradedRttMs: 120 });

export class ProductionDiagnosticsPipeline {
  readonly config: DiagnosticsConfigP;
  readonly #events?: EventSinkP;
  readonly #samples: PhaseSampleP[] = [];
  #criticalFrames = 0;
  #degradedFrames = 0;
  #droppedFrames = 0;
  #lastHealth: RuntimeHealthP = Object.freeze({ state: 'healthy', score: 100, frameMs: 0, memoryMb: 0, networkRttMs: 0, assetQueue: 0, workerQueue: 0, recommendations: Object.freeze([]) });

  constructor(config: Partial<DiagnosticsConfigP> = {}, events?: EventSinkP) {
    this.config = Object.freeze({ ...DEFAULTS, ...config, maxSamples: Math.max(32, integerP(config.maxSamples ?? DEFAULTS.maxSamples)) });
    this.#events = events;
  }

  sample(frame: number, tick: number, budget: FrameBudgetP, memoryMb = 0, networkRttMs = 0, assetQueue = 0, workerQueue = 0): RuntimeHealthP {
    const normalized = Object.freeze({ frame: Math.max(0, integerP(frame)), tick: Math.max(0, integerP(tick)), budget: normalizeBudget(budget) });
    if (this.#samples.length >= this.config.maxSamples) this.#samples.shift();
    this.#samples.push(normalized);
    const target = Math.max(1, normalized.budget.targetMs);
    const ratio = normalized.budget.totalMs / target;
    let state: HealthState = 'healthy';
    const recommendations: string[] = [];
    if (ratio > this.config.criticalFrameMultiplier || memoryMb >= this.config.criticalMemoryMb || networkRttMs >= this.config.criticalRttMs) {
      state = 'critical'; this.#criticalFrames += 1;
    } else if (ratio > this.config.degradedFrameMultiplier || memoryMb >= this.config.degradedMemoryMb || networkRttMs >= this.config.degradedRttMs) {
      state = 'degraded'; this.#degradedFrames += 1;
    }
    if (ratio > 1) recommendations.push('reduce render/streaming work before simulation budget is affected');
    if (normalized.budget.simulationMs > target * 0.35) recommendations.push('lower distant simulation frequency');
    if (normalized.budget.renderMs > target * 0.55) recommendations.push('lower render tier or pixel ratio');
    if (normalized.budget.assetMs > target * 0.18) recommendations.push('spread asset hydration over additional frames');
    if (normalized.budget.networkMs > target * 0.15) recommendations.push('use snapshot deltas and reduce network cadence');
    if (memoryMb >= this.config.degradedMemoryMb) recommendations.push('evict unpinned assets and reduce resident caches');
    if (networkRttMs >= this.config.degradedRttMs) recommendations.push('prefer local prediction and bounded reconciliation');
    const score = scoreFor(state, ratio, memoryMb, networkRttMs, recommendations.length);
    this.#lastHealth = Object.freeze({ state, score, frameMs: normalized.budget.totalMs, memoryMb: Math.max(0, finiteP(memoryMb)), networkRttMs: Math.max(0, finiteP(networkRttMs)), assetQueue: Math.max(0, integerP(assetQueue)), workerQueue: Math.max(0, integerP(workerQueue)), recommendations: Object.freeze([...recommendations]) });
    this.#events?.emit('telemetry:health', this.#lastHealth);
    return this.#lastHealth;
  }

  markDroppedFrame(): void { this.#droppedFrames += 1; }
  latest(): RuntimeHealthP { return this.#lastHealth; }

  stats(): DiagnosticsStatsP {
    const values = this.#samples.map(sample => sample.budget.totalMs);
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const sorted = [...values].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.95)] ?? 0 : 0;
    const score = Math.max(0, Math.min(100, 100 - this.#criticalFrames * 2 - this.#degradedFrames * 0.5 - this.#droppedFrames));
    return Object.freeze({ samples: values.length, averageFrameMs: average, p95FrameMs: p95, droppedFrames: this.#droppedFrames, criticalFrames: this.#criticalFrames, degradedFrames: this.#degradedFrames, score, checksum: checksumP({ values, critical: this.#criticalFrames, degraded: this.#degradedFrames, dropped: this.#droppedFrames }) });
  }

  report(frame: number, tick: number, render: RuntimeFrameReportP['render']): RuntimeFrameReportP {
    const health = this.#lastHealth;
    return Object.freeze({ frame: Math.max(0, integerP(frame)), tick: Math.max(0, integerP(tick)), lifecycle: 'running', steps: 0, alpha: 0, render, health, phaseTimings: Object.freeze([]), digest: checksumP({ frame, tick, render, health }) });
  }

  clear(): void { this.#samples.length = 0; this.#criticalFrames = 0; this.#degradedFrames = 0; this.#droppedFrames = 0; }
}

function normalizeBudget(value: FrameBudgetP): FrameBudgetP {
  const field = (candidate: number): number => Math.max(0, finiteP(candidate));
  return Object.freeze({ inputMs: field(value.inputMs), simulationMs: field(value.simulationMs), worldMs: field(value.worldMs), networkMs: field(value.networkMs), assetMs: field(value.assetMs), renderMs: field(value.renderMs), telemetryMs: field(value.telemetryMs), totalMs: field(value.totalMs), targetMs: Math.max(1, field(value.targetMs)) });
}

function scoreFor(state: HealthState, ratio: number, memoryMb: number, rttMs: number, recommendationCount: number): number {
  const penalty = state === 'critical' ? 32 : state === 'degraded' ? 14 : 0;
  return clampP(1 - (penalty / 100 + Math.max(0, ratio - 1) * 0.2 + Math.max(0, memoryMb - 1024) / 4096 + Math.max(0, rttMs - 80) / 1000 + recommendationCount * 0.005), 0, 1) * 100;
}
