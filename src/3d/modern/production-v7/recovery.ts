import { RuntimePhaseV7, RuntimeModeV7, RuntimeHealthV7, RuntimeBudgetsV7 } from './types.ts';

export type RecoveryActionV7 =
  | 'flush-streaming' | 'evict-assets' | 'reduce-render-scale' | 'reduce-simulation'
  | 'reset-network' | 'rebuild-spatial-index' | 'pause-background';

export interface RecoveryStepV7 {
  readonly action: RecoveryActionV7;
  readonly reason: string;
  readonly priority: number;
}

export interface RecoveryPlanV7 {
  readonly phase: RuntimePhaseV7;
  readonly mode: RuntimeModeV7;
  readonly steps: readonly RecoveryStepV7[];
  readonly expectedRelief: number;
  readonly checksum: number;
}

export interface RecoveryResultV7 {
  readonly applied: readonly RecoveryActionV7[];
  readonly skipped: readonly RecoveryActionV7[];
  readonly phase: RuntimePhaseV7;
  readonly mode: RuntimeModeV7;
}

const rank = (action: RecoveryActionV7): number => ({
  'reduce-render-scale': 100, 'evict-assets': 90, 'flush-streaming': 85, 'pause-background': 80,
  'reduce-simulation': 70, 'reset-network': 60, 'rebuild-spatial-index': 40,
}[action]);

export class RuntimeRecoveryV7 {
  #phase: RuntimePhaseV7 = 'booting';
  #mode: RuntimeModeV7 = 'full';
  #attempts = 0;

  get phase(): RuntimePhaseV7 { return this.#phase; }
  get mode(): RuntimeModeV7 { return this.#mode; }

  start(): void { if (this.#phase === 'booting' || this.#phase === 'stopped') this.#phase = 'running'; }
  stop(): void { this.#phase = 'stopped'; }
  setMode(mode: RuntimeModeV7): void { this.#mode = mode; this.#phase = mode === 'constrained' ? 'throttled' : this.#phase; }

  plan(health: RuntimeHealthV7, budgets: RuntimeBudgetsV7): RecoveryPlanV7 {
    const steps = new Map<RecoveryActionV7, RecoveryStepV7>();
    const add = (action: RecoveryActionV7, reason: string) => steps.set(action, Object.freeze({ action, reason, priority: rank(action) }));
    if (budgets.render.frameMs > 22 || health.reasons.includes('frame-budget')) add('reduce-render-scale', 'render frame time above hard budget');
    if (health.reasons.includes('memory-pressure')) add('evict-assets', 'memory pressure detected');
    if (health.reasons.includes('memory-pressure')) add('flush-streaming', 'streaming residency should be reduced');
    if (health.score < 60) add('pause-background', 'runtime health requires foreground budget');
    if (health.reasons.includes('simulation-budget')) add('reduce-simulation', 'simulation budget exceeded');
    if (health.reasons.includes('network-latency')) add('reset-network', 'network session degraded');
    if (health.score < 35) add('rebuild-spatial-index', 'deep recovery after repeated degradation');
    const ordered = [...steps.values()].sort((a, b) => b.priority - a.priority);
    const relief = ordered.reduce((sum, step) => sum + ({ 'reduce-render-scale': 0.2, 'evict-assets': 0.18, 'flush-streaming': 0.12, 'pause-background': 0.08, 'reduce-simulation': 0.1, 'reset-network': 0.05, 'rebuild-spatial-index': 0.03 }[step.action]), 0);
    let checksum = 2166136261;
    for (const step of ordered) { checksum ^= step.priority ^ step.action.length; checksum = Math.imul(checksum, 16777619) >>> 0; }
    return Object.freeze({ phase: this.#phase, mode: this.#mode, steps: Object.freeze(ordered), expectedRelief: Number(relief.toFixed(4)), checksum: checksum >>> 0 });
  }

  apply(plan: RecoveryPlanV7, handlers: Partial<Record<RecoveryActionV7, () => boolean>> = {}): RecoveryResultV7 {
    this.#attempts += 1;
    this.#phase = 'recovering';
    const applied: RecoveryActionV7[] = [];
    const skipped: RecoveryActionV7[] = [];
    for (const step of plan.steps) {
      const handler = handlers[step.action];
      if (handler && handler()) applied.push(step.action);
      else skipped.push(step.action);
    }
    if (applied.length > 0) {
      this.#mode = plan.mode === 'full' ? 'balanced' : plan.mode;
      this.#phase = 'throttled';
    } else {
      this.#phase = this.#attempts > 2 ? 'stopped' : 'running';
    }
    return Object.freeze({ applied: Object.freeze(applied), skipped: Object.freeze(skipped), phase: this.#phase, mode: this.#mode });
  }

  resetAttempts(): void { this.#attempts = 0; }
}
