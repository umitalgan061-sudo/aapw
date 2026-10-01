import type { HealthSignal, RuntimePhase, Tick } from './types';
import { deterministicBackoff } from './deterministic';

export type RecoveryDomain = 'input' | 'streaming' | 'network' | 'save' | 'renderer' | 'simulation';
export type RecoveryStage = 'diagnose' | 'quiesce' | 'reset' | 'replay' | 'resume' | 'complete' | 'blocked';
export interface RecoveryPlan { readonly id: string; readonly domain: RecoveryDomain; readonly source: string; readonly tick: Tick; readonly severity: HealthSignal['severity']; readonly stage: RecoveryStage; readonly attempt: number; readonly delayMs: number; }
interface DomainState { stage: RecoveryStage; attempts: number; lastTick: Tick; }

const STAGES: readonly RecoveryStage[] = ['diagnose', 'quiesce', 'reset', 'replay', 'resume', 'complete'];
const ORDER: Readonly<Record<RecoveryStage, number>> = Object.freeze({ diagnose: 0, quiesce: 1, reset: 2, replay: 3, resume: 4, complete: 5, blocked: 99 });

export class RecoveryCoordinator {
  #domains = new Map<RecoveryDomain, DomainState>();
  #maxAttempts: number;
  #cooldownTicks: number;
  constructor(maxAttempts = 3, cooldownTicks = 60) {
    this.#maxAttempts = Math.max(1, Math.trunc(maxAttempts));
    this.#cooldownTicks = Math.max(1, Math.trunc(cooldownTicks));
    for (const domain of ['input', 'streaming', 'network', 'save', 'renderer', 'simulation'] as const) this.#domains.set(domain, { stage: 'complete', attempts: 0, lastTick: 0 as Tick });
  }
  diagnose(domain: RecoveryDomain, source: string, severity: HealthSignal['severity'], tick: Tick): RecoveryPlan | null {
    const state = this.#domains.get(domain)!;
    if (state.attempts >= this.#maxAttempts) { state.stage = 'blocked'; return null; }
    if (Number(tick) - Number(state.lastTick) < this.#cooldownTicks && state.attempts > 0) return null;
    state.attempts += 1; state.lastTick = tick; state.stage = 'diagnose';
    return Object.freeze({ id: domain + '-' + String(Number(tick)) + '-' + String(state.attempts), domain, source, tick, severity, stage: state.stage, attempt: state.attempts, delayMs: deterministicBackoff(state.attempts, 25, 2000, domain) });
  }
  advance(domain: RecoveryDomain): RecoveryStage {
    const state = this.#domains.get(domain)!;
    const index = STAGES.indexOf(state.stage);
    if (state.stage === 'blocked' || state.stage === 'complete') return state.stage;
    state.stage = STAGES[Math.min(STAGES.length - 1, index + 1)]!;
    return state.stage;
  }
  fail(domain: RecoveryDomain): RecoveryStage {
    const state = this.#domains.get(domain)!;
    state.stage = state.attempts >= this.#maxAttempts ? 'blocked' : 'diagnose';
    return state.stage;
  }
  complete(domain: RecoveryDomain): void { const state = this.#domains.get(domain)!; state.stage = 'complete'; state.attempts = 0; }
  stage(domain: RecoveryDomain): RecoveryStage { return this.#domains.get(domain)?.stage ?? 'blocked'; }
  canRun(domain: RecoveryDomain): boolean { const stage = this.stage(domain); return stage !== 'blocked' && stage !== 'complete'; }
  reset(): void { for (const domain of this.#domains.values()) { domain.stage = 'complete'; domain.attempts = 0; domain.lastTick = 0 as Tick; } }
}

export function recoveryPhase(domain: RecoveryDomain): RuntimePhase {
  if (domain === 'renderer') return 'render';
  if (domain === 'simulation') return 'simulation';
  if (domain === 'streaming') return 'streaming';
  if (domain === 'network') return 'network';
  if (domain === 'save') return 'save';
  return 'input';
}
