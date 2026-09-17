import type { DiagnosticSample, RuntimeDiagnosticsPort } from './portsR3.ts';

export interface MetricWindowR3 {
  readonly name: string;
  readonly samples: readonly number[];
  readonly average: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly p95: number;
  readonly latest: number;
}

export interface DiagnosticsBudgetR3 {
  readonly name: string;
  readonly limit: number;
  readonly mode: 'max' | 'min';
}

export interface BudgetViolationR3 {
  readonly name: string;
  readonly value: number;
  readonly limit: number;
  readonly mode: 'max' | 'min';
}

export interface RuntimeDiagnosticsSnapshotR3 {
  readonly samples: readonly DiagnosticSample[];
  readonly windows: readonly MetricWindowR3[];
  readonly violations: readonly BudgetViolationR3[];
  readonly frame: number;
}

interface WindowState {
  readonly values: number[];
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((sorted.length - 1) * q)));
  return sorted[index] ?? 0;
}

export class RuntimeDiagnosticsR3 implements RuntimeDiagnosticsPort {
  readonly #windows = new Map<string, WindowState>();
  readonly #budgets = new Map<string, DiagnosticsBudgetR3>();
  readonly #current = new Map<string, number>();
  readonly #maxSamples: number;
  #frame = 0;

  constructor(maxSamples = 120) {
    this.#maxSamples = Math.max(8, Math.floor(maxSamples));
  }

  setFrame(frame: number): void {
    this.#frame = Math.max(0, Math.floor(frame));
  }

  defineBudget(budget: DiagnosticsBudgetR3): void {
    if (!budget.name.trim() || !Number.isFinite(budget.limit)) throw new Error('Diagnostic budget is invalid.');
    this.#budgets.set(budget.name, { ...budget });
  }

  removeBudget(name: string): void {
    this.#budgets.delete(name);
  }

  mark(name: string, value: number): void {
    if (!name.trim() || !Number.isFinite(value)) return;
    this.#current.set(name, value);
    const window = this.#windows.get(name) ?? { values: [] };
    window.values.push(value);
    if (window.values.length > this.#maxSamples) window.values.shift();
    this.#windows.set(name, window);
  }

  increment(name: string, delta = 1): void {
    const current = this.#current.get(name) ?? 0;
    this.mark(name, current + (Number.isFinite(delta) ? delta : 0));
  }

  reset(name?: string): void {
    if (!name) {
      this.#current.clear();
      this.#windows.clear();
      return;
    }
    this.#current.delete(name);
    this.#windows.delete(name);
  }

  current(name: string): number {
    return this.#current.get(name) ?? 0;
  }

  window(name: string): MetricWindowR3 | null {
    const state = this.#windows.get(name);
    if (!state || state.values.length === 0) return null;
    const values = state.values;
    const total = values.reduce((sum, value) => sum + value, 0);
    return {
      name,
      samples: [...values],
      average: total / values.length,
      minimum: Math.min(...values),
      maximum: Math.max(...values),
      p95: quantile(values, 0.95),
      latest: values[values.length - 1] ?? 0,
    };
  }

  windows(): readonly MetricWindowR3[] {
    return [...this.#windows.keys()].sort().map((name) => this.window(name)).filter((value): value is MetricWindowR3 => value !== null);
  }

  violations(): readonly BudgetViolationR3[] {
    const violations: BudgetViolationR3[] = [];
    for (const budget of this.#budgets.values()) {
      const value = this.current(budget.name);
      const violated = budget.mode === 'max' ? value > budget.limit : value < budget.limit;
      if (violated) violations.push({ name: budget.name, value, limit: budget.limit, mode: budget.mode });
    }
    return violations.sort((a, b) => a.name.localeCompare(b.name));
  }

  snapshot(): RuntimeDiagnosticsSnapshotR3 {
    const samples = [...this.#current.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { samples, windows: this.windows(), violations: this.violations(), frame: this.#frame };
  }
}

export function installStandardRuntimeBudgets(diagnostics: RuntimeDiagnosticsR3): void {
  diagnostics.defineBudget({ name: 'runtime.frameMs', limit: 16.67, mode: 'max' });
  diagnostics.defineBudget({ name: 'runtime.simulationMs', limit: 8, mode: 'max' });
  diagnostics.defineBudget({ name: 'runtime.streamingMs', limit: 4, mode: 'max' });
  diagnostics.defineBudget({ name: 'runtime.networkMs', limit: 2, mode: 'max' });
  diagnostics.defineBudget({ name: 'runtime.heapPressure', limit: 0.85, mode: 'max' });
  diagnostics.defineBudget({ name: 'runtime.rollbackDepth', limit: 12, mode: 'max' });
}
