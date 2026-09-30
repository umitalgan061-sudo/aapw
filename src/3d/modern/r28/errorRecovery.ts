export type RecoveryState = 'healthy' | 'degraded' | 'recovering' | 'failed';

export interface RecoveryAction {
  readonly id: string;
  readonly priority: number;
  readonly maxAttempts: number;
  readonly cooldownTicks: number;
  execute(): Promise<boolean> | boolean;
}

export interface RecoveryReport {
  readonly state: RecoveryState;
  readonly action?: string;
  readonly success: boolean;
  readonly attempts: number;
  readonly detail?: string;
}

export class RuntimeRecoveryController {
  #state: RecoveryState = 'healthy';
  #attempts = new Map<string, number>();
  #lastAttemptTick = new Map<string, number>();

  registerFailure(): void {
    this.#state = this.#state === 'failed' ? 'failed' : 'degraded';
  }

  reset(): void {
    this.#state = 'healthy';
    this.#attempts.clear();
    this.#lastAttemptTick.clear();
  }

  state(): RecoveryState {
    return this.#state;
  }

  async recover(actions: readonly RecoveryAction[], currentTick: number): Promise<RecoveryReport> {
    this.#state = 'recovering';
    const candidates = [...actions]
      .filter((action) => {
        const attempts = this.#attempts.get(action.id) ?? 0;
        const lastTick = this.#lastAttemptTick.get(action.id) ?? Number.NEGATIVE_INFINITY;
        return attempts < action.maxAttempts && currentTick - lastTick >= action.cooldownTicks;
      })
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));

    for (const action of candidates) {
      const attempts = (this.#attempts.get(action.id) ?? 0) + 1;
      this.#attempts.set(action.id, attempts);
      this.#lastAttemptTick.set(action.id, currentTick);
      try {
        const success = await action.execute();
        if (success) {
          this.#state = 'healthy';
          return { state: 'healthy', action: action.id, success: true, attempts };
        }
      } catch (error) {
        if (attempts >= action.maxAttempts) this.#state = 'failed';
        const detail = error instanceof Error ? error.message : String(error);
        this.#state = attempts >= action.maxAttempts ? 'failed' : 'degraded';
        return { state: this.#state, action: action.id, success: false, attempts, detail };
      }
    }

    this.#state = candidates.length === 0 ? 'failed' : 'degraded';
    return {
      state: this.#state,
      success: false,
      attempts: 0,
      detail: candidates.length === 0 ? 'No eligible recovery action' : 'Recovery actions did not restore the runtime',
    };
  }
}
