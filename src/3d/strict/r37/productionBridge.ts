import type { RuntimeHealth, RuntimeMetrics, RuntimeMode } from './types.ts';
import { UnifiedRuntimeR37 } from './runtimeFacade.ts';
import { DiagnosticsReporterR37 } from './diagnosticsReporter.ts';
import { ResourceBudgetR37 } from './resourceBudget.ts';
import { EventTimelineR37 } from './eventTimeline.ts';
import { clamp, finite } from './math.ts';

export interface ProductionBridgeSnapshot {
  readonly mode: RuntimeMode;
  readonly health: RuntimeHealth;
  readonly diagnostics: ReturnType<DiagnosticsReporterR37['report']>;
  readonly budget: ReturnType<ResourceBudgetR37['snapshot']>;
  readonly timelineDigest: string;
}

export interface ProductionBridgeConfig {
  readonly seed: number;
  readonly maxEntities: number;
  readonly initialQuality: 'minimal' | 'low' | 'balanced' | 'high' | 'ultra';
}

export class ProductionRuntimeBridgeR37 {
  readonly runtime: UnifiedRuntimeR37;
  readonly diagnostics: DiagnosticsReporterR37;
  readonly budget: ResourceBudgetR37;
  readonly timeline: EventTimelineR37;
  #mode: RuntimeMode = 'booting';

  constructor(config: Partial<ProductionBridgeConfig> = {}) {
    const normalized = {
      seed: Math.trunc(finite(config.seed, 37)),
      maxEntities: Math.max(1, Math.trunc(finite(config.maxEntities, 4096))),
      initialQuality: config.initialQuality ?? 'balanced',
    };
    this.runtime = new UnifiedRuntimeR37(normalized);
    this.diagnostics = new DiagnosticsReporterR37();
    this.budget = new ResourceBudgetR37();
    this.timeline = new EventTimelineR37();
    this.#mode = 'running';
  }

  step(deltaSeconds: number, cameraPosition: { readonly x: number; readonly y: number; readonly z: number }): ProductionBridgeSnapshot {
    if (this.#mode === 'disposed') throw new Error('production bridge disposed');
    this.budget.beginTick(this.runtime.clock.tick + 1);
    const result = this.runtime.step(clamp(finite(deltaSeconds), 0, 0.25), cameraPosition);
    this.diagnostics.recordMetrics(result.metrics);
    this.timeline.appendMany(result.events);
    this.#mode = result.health.mode;
    return this.snapshot(result.metrics);
  }

  requestBudget(id: string, className: Parameters<ResourceBudgetR37['request']>[0]['class'], cost: number, priority = 0): ReturnType<ResourceBudgetR37['request']> {
    return this.budget.request({ id, class: className, cost, priority });
  }

  snapshot(metrics?: RuntimeMetrics): ProductionBridgeSnapshot {
    const health = this.runtime.health();
    const currentMetrics = metrics ?? health.metrics;
    return Object.freeze({
      mode: this.#mode,
      health,
      diagnostics: this.diagnostics.report(health, currentMetrics),
      budget: this.budget.snapshot(),
      timelineDigest: this.timeline.digest(),
    });
  }

  reset(): void {
    this.runtime.world.reset();
    this.runtime.clock.reset();
    this.runtime.input.rewind(0);
    this.timeline.clear();
    this.diagnostics.clear();
    this.budget.beginTick(0);
    this.#mode = 'running';
  }

  dispose(): void {
    this.runtime.dispose();
    this.timeline.clear();
    this.diagnostics.clear();
    this.#mode = 'disposed';
  }
}
