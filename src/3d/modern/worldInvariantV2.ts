export interface WorldInvariantInput {
  readonly tick: number;
  readonly entityCount: number;
  readonly activeChunks: number;
  readonly residentBytes: number;
  readonly memoryBudgetBytes: number;
  readonly playerHealth: number;
  readonly playerStamina: number;
  readonly selectedKingdomId: string | null;
}

export interface WorldInvariantResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
  readonly normalized: WorldInvariantInput;
}

const finiteInt = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
const bounded = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const validateWorldInvariants = (input: WorldInvariantInput): WorldInvariantResult => {
  const tick = Math.max(0, finiteInt(input.tick));
  const entityCount = Math.max(0, finiteInt(input.entityCount));
  const activeChunks = Math.max(0, finiteInt(input.activeChunks));
  const residentBytes = Math.max(0, finiteInt(input.residentBytes));
  const memoryBudgetBytes = Math.max(1, finiteInt(input.memoryBudgetBytes, 1));
  const playerHealth = bounded(Number.isFinite(input.playerHealth) ? input.playerHealth : 0, 0, 100);
  const playerStamina = bounded(Number.isFinite(input.playerStamina) ? input.playerStamina : 0, 0, 100);
  const selectedKingdomId = input.selectedKingdomId === null ? null : String(input.selectedKingdomId).slice(0, 128);
  const normalized = Object.freeze({ tick, entityCount, activeChunks, residentBytes, memoryBudgetBytes, playerHealth, playerStamina, selectedKingdomId });
  const violations: string[] = [];
  if (residentBytes > memoryBudgetBytes) violations.push('resident memory exceeds configured budget');
  if (entityCount > 250_000) violations.push('entity population exceeds safety ceiling');
  if (activeChunks > 25_000) violations.push('active chunk population exceeds safety ceiling');
  return Object.freeze({ valid: violations.length === 0, violations: Object.freeze(violations), normalized });
};

export interface TransitionGuardState {
  readonly phase: 'boot' | 'running' | 'paused' | 'recovering' | 'disposed';
  readonly revision: number;
}

export class TransitionGuardV2 {
  #state: TransitionGuardState = Object.freeze({ phase: 'boot', revision: 0 });
  state(): TransitionGuardState { return this.#state; }
  transition(next: TransitionGuardState['phase']): boolean {
    const allowed: Record<TransitionGuardState['phase'], readonly TransitionGuardState['phase'][]> = {
      boot: ['running', 'disposed'],
      running: ['paused', 'recovering', 'disposed'],
      paused: ['running', 'recovering', 'disposed'],
      recovering: ['running', 'paused', 'disposed'],
      disposed: [],
    };
    if (!allowed[this.#state.phase].includes(next)) return false;
    this.#state = Object.freeze({ phase: next, revision: this.#state.revision + 1 });
    return true;
  }
}
