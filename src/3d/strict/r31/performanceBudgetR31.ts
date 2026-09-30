import type { RuntimeBudgetR31, RuntimePhase } from './applicationTypesR31.ts';
import { clampR31 } from './applicationTypesR31.ts';

export interface PerformanceWindowR31 {
  readonly samples: number;
  readonly totalMs: number;
  readonly maxMs: number;
  readonly averageMs: number;
  readonly p95Ms: number;
}

export interface BudgetDecisionR31 {
  readonly allowed: boolean;
  readonly ratio: number;
  readonly phase: RuntimePhase;
  readonly observedMs: number;
  readonly budgetMs: number;
}

function percentile(values: readonly number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? 0;
}

export class PerformanceBudgetR31 {
  readonly #budget: RuntimeBudgetR31;
  readonly #windows = new Map<RuntimePhase, number[]>();
  #violations = 0;

  constructor(budget: RuntimeBudgetR31) {
    this.#budget = Object.freeze({ ...budget });
  }

  record(phase: RuntimePhase, durationMs: number): void {
    const values = this.#windows.get(phase) ?? [];
    values.push(Math.max(0, Number.isFinite(durationMs) ? durationMs : 0));
    if (values.length > 180) values.splice(0, values.length - 180);
    this.#windows.set(phase, values);
  }

  decide(phase: RuntimePhase, durationMs: number): BudgetDecisionR31 {
    const budget = this.#budgetFor(phase);
    const observed = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
    const ratio = observed / Math.max(0.001, budget);
    const allowed = ratio <= 1;
    if (!allowed) this.#violations++;
    return Object.freeze({
      allowed,
      ratio: clampR31(ratio, 0, 100),
      phase,
      observedMs: observed,
      budgetMs: budget,
    });
  }

  window(phase: RuntimePhase): PerformanceWindowR31 {
    const values = this.#windows.get(phase) ?? [];
    const totalMs = values.reduce((sum, value) => sum + value, 0);
    return Object.freeze({
      samples: values.length,
      totalMs,
      maxMs: values.reduce((max, value) => Math.max(max, value), 0),
      averageMs: values.length ? totalMs / values.length : 0,
      p95Ms: percentile(values, 0.95),
    });
  }

  allWindows(): Readonly<Record<RuntimePhase, PerformanceWindowR31>> {
    const phases: RuntimePhase[] = ['bootstrap','input','simulation','world','gameplay','render','audio','network','persistence','diagnostics','teardown'];
    const result = {} as Record<RuntimePhase, PerformanceWindowR31>;
    for (const phase of phases) result[phase] = this.window(phase);
    return Object.freeze(result);
  }

  violations(): number { return this.#violations; }

  reset(): void {
    this.#windows.clear();
    this.#violations = 0;
  }

  #budgetFor(phase: RuntimePhase): number {
    switch (phase) {
      case 'simulation': return this.#budget.simulationMs;
      case 'render': return this.#budget.renderMs;
      case 'network': return this.#budget.networkMs;
      case 'persistence': return this.#budget.persistenceMs;
      default: return this.#budget.frameMs;
    }
  }
}
