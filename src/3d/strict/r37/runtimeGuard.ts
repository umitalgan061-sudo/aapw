import type { RuntimeHealth, RuntimeMetrics, RuntimeMode } from './types.ts';
import { clamp, finite } from './math.ts';

export interface RuntimeGuardConfig {
  readonly historyCapacity: number;
  readonly criticalScore: number;
  readonly degradedScore: number;
  readonly recoveryScore: number;
}

const DEFAULT_CONFIG: RuntimeGuardConfig = Object.freeze({
  historyCapacity: 120,
  criticalScore: 0.85,
  degradedScore: 0.55,
  recoveryScore: 0.25,
});

export class RuntimeGuardR37 {
  readonly config: RuntimeGuardConfig;
  #mode: RuntimeMode = 'booting';
  #history: RuntimeMetrics[] = [];
  #issues: string[] = [];
  #healthScore = 1;

  constructor(config: Partial<RuntimeGuardConfig> = {}) {
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...config,
      historyCapacity: Math.max(8, Math.trunc(finite(config.historyCapacity, DEFAULT_CONFIG.historyCapacity))),
      criticalScore: clamp(finite(config.criticalScore, DEFAULT_CONFIG.criticalScore), 0.1, 1),
      degradedScore: clamp(finite(config.degradedScore, DEFAULT_CONFIG.degradedScore), 0.05, 0.95),
      recoveryScore: clamp(finite(config.recoveryScore, DEFAULT_CONFIG.recoveryScore), 0, 0.9),
    });
  }

  setMode(mode: RuntimeMode): void {
    this.#mode = mode;
  }

  observe(metrics: RuntimeMetrics): RuntimeHealth {
    this.#history.push(Object.freeze(metrics));
    if (this.#history.length > this.config.historyCapacity) {
      this.#history.splice(0, this.#history.length - this.config.historyCapacity);
    }
    this.#issues = this.#deriveIssues(metrics);
    const pressure = this.#pressure(metrics);
    this.#healthScore = clamp(this.#healthScore * 0.82 + (1 - pressure) * 0.18, 0, 1);
    if (pressure >= this.config.criticalScore) this.#mode = this.#mode === 'disposed' ? 'disposed' : 'degraded';
    else if (pressure >= this.config.degradedScore) this.#mode = this.#mode === 'disposed' ? 'disposed' : 'degraded';
    else if (pressure <= this.config.recoveryScore && this.#mode === 'degraded') this.#mode = 'recovering';
    else if (this.#mode === 'recovering' && pressure <= this.config.recoveryScore * 0.75) this.#mode = 'running';
    return this.snapshot();
  }

  snapshot(): RuntimeHealth {
    const latest = this.#history.at(-1) ?? this.#zeroMetrics();
    return Object.freeze({
      score: Number(this.#healthScore.toFixed(4)),
      mode: this.#mode,
      issues: Object.freeze([...this.#issues]),
      metrics: latest,
    });
  }

  recentMetrics(limit = 30): readonly RuntimeMetrics[] {
    return Object.freeze(this.#history.slice(-Math.max(0, Math.trunc(limit))));
  }

  reset(): void {
    this.#history = [];
    this.#issues = [];
    this.#healthScore = 1;
    this.#mode = 'booting';
  }

  dispose(): void {
    this.#history = [];
    this.#issues = [];
    this.#healthScore = 0;
    this.#mode = 'disposed';
  }

  #pressure(metrics: RuntimeMetrics): number {
    return clamp(
      Math.max(
        finite(metrics.frameMs) / 16.67,
        finite(metrics.simulationMs) / 5,
        finite(metrics.renderMs) / 8,
        finite(metrics.networkMs) / 2.5,
        finite(metrics.assetMs) / 3,
        finite(metrics.memoryPressure),
      ),
      0,
      2,
    ) / 2;
  }

  #deriveIssues(metrics: RuntimeMetrics): string[] {
    const issues: string[] = [];
    if (metrics.frameMs > 16.67) issues.push('frame-budget');
    if (metrics.simulationMs > 5) issues.push('simulation-budget');
    if (metrics.renderMs > 8) issues.push('render-budget');
    if (metrics.networkMs > 2.5) issues.push('network-budget');
    if (metrics.assetMs > 3) issues.push('asset-budget');
    if (metrics.memoryPressure >= 0.8) issues.push('memory-pressure');
    if (metrics.droppedTicks > 0) issues.push('dropped-ticks');
    if (metrics.commands > 64) issues.push('command-pressure');
    return issues;
  }

  #zeroMetrics(): RuntimeMetrics {
    return Object.freeze({
      frameMs: 0,
      simulationMs: 0,
      renderMs: 0,
      networkMs: 0,
      assetMs: 0,
      entities: 0,
      commands: 0,
      droppedTicks: 0,
      memoryPressure: 0,
      quality: 'balanced',
    });
  }
}
