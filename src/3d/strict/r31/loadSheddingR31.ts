import type { RuntimePhase } from './applicationTypesR31.ts';

export interface LoadObservationR31 {
  readonly phase: RuntimePhase;
  readonly budgetMs: number;
  readonly observedMs: number;
  readonly queueDepth: number;
  readonly queueCapacity: number;
}

export interface LoadDecisionR31 {
  readonly shed: boolean;
  readonly phase: RuntimePhase;
  readonly pressure: number;
  readonly keepRatio: number;
  readonly reason: string;
}

export class LoadSheddingControllerR31 {
  #pressure = 0;
  #framesOverBudget = 0;
  #framesUnderBudget = 0;

  observe(observation: LoadObservationR31): LoadDecisionR31 {
    const budget = Math.max(0.1, observation.budgetMs);
    const timePressure = Math.max(0, observation.observedMs / budget - 1);
    const queuePressure = Math.max(0, observation.queueDepth / Math.max(1, observation.queueCapacity));
    const current = Math.min(1, timePressure * 0.7 + queuePressure * 0.3);
    this.#pressure = this.#pressure * 0.8 + current * 0.2;
    if (this.#pressure > 0.7) {
      this.#framesOverBudget++;
      this.#framesUnderBudget = 0;
    } else if (this.#pressure < 0.35) {
      this.#framesUnderBudget++;
      this.#framesOverBudget = 0;
    }

    const shed = observation.phase === 'background' || this.#pressure > 0.55;
    const keepRatio = observation.phase === 'critical' ? 1 : shed ? Math.max(0.15, 1 - this.#pressure) : 1;
    return Object.freeze({
      shed,
      phase: observation.phase,
      pressure: this.#pressure,
      keepRatio,
      reason: shed ? 'runtime-pressure' : 'inside-budget',
    });
  }

  shouldRun(priority: 'critical' | 'high' | 'normal' | 'low' | 'background'): boolean {
    if (priority === 'critical') return true;
    if (this.#pressure < 0.55) return true;
    if (priority === 'background') return false;
    if (priority === 'low') return this.#pressure < 0.72;
    return this.#pressure < 0.86;
  }

  reset(): void {
    this.#pressure = 0;
    this.#framesOverBudget = 0;
    this.#framesUnderBudget = 0;
  }

  state(): Readonly<{ pressure: number; framesOverBudget: number; framesUnderBudget: number }> {
    return Object.freeze({
      pressure: this.#pressure,
      framesOverBudget: this.#framesOverBudget,
      framesUnderBudget: this.#framesUnderBudget,
    });
  }
}
