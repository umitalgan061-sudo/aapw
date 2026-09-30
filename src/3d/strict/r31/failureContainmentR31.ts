export type FailureModeR31 = 'ignore' | 'disable' | 'propagate';

export interface FailurePolicyR31 {
  readonly mode: FailureModeR31;
  readonly maxFailures: number;
  readonly cooldownFrames: number;
}

export interface FailureStateR31 {
  readonly id: string;
  readonly failures: number;
  readonly disabled: boolean;
  readonly lastFailureFrame: number;
  readonly lastError: string | null;
}

export interface FailureDecisionR31 {
  readonly id: string;
  readonly mode: FailureModeR31;
  readonly disabled: boolean;
  readonly propagate: boolean;
}

interface Entry {
  readonly id: string;
  readonly policy: FailurePolicyR31;
  failures: number;
  disabled: boolean;
  lastFailureFrame: number;
  lastError: string | null;
}

export class FailureContainmentR31 {
  readonly #entries = new Map<string, Entry>();

  register(id: string, policy: FailurePolicyR31): () => void {
    if (!id.trim()) throw new Error('Failure id cannot be empty');
    if (this.#entries.has(id)) throw new Error(`Duplicate failure id: ${id}`);
    const entry: Entry = {
      id,
      policy: Object.freeze({
        ...policy,
        maxFailures: Math.max(1, Math.floor(policy.maxFailures)),
        cooldownFrames: Math.max(0, Math.floor(policy.cooldownFrames)),
      }),
      failures: 0,
      disabled: false,
      lastFailureFrame: -1,
      lastError: null,
    };
    this.#entries.set(id, entry);
    return () => this.#entries.delete(id);
  }

  execute<T>(id: string, frame: number, action: () => T): { readonly ok: true; readonly value: T } | { readonly ok: false; readonly decision: FailureDecisionR31 } {
    const entry = this.#entries.get(id);
    if (!entry) return { ok: false, decision: Object.freeze({ id, mode: 'propagate', disabled: false, propagate: true }) };
    if (entry.disabled && frame - entry.lastFailureFrame < entry.policy.cooldownFrames) {
      return { ok: false, decision: Object.freeze({ id, mode: entry.policy.mode, disabled: true, propagate: false }) };
    }
    if (entry.disabled) entry.disabled = false;
    try {
      return { ok: true, value: action() };
    } catch (error) {
      entry.failures++;
      entry.lastFailureFrame = Math.max(0, Math.floor(frame));
      entry.lastError = error instanceof Error ? error.message : String(error);
      if (entry.failures >= entry.policy.maxFailures && entry.policy.mode === 'disable') entry.disabled = true;
      const propagate = entry.policy.mode === 'propagate';
      if (propagate) throw error;
      return { ok: false, decision: Object.freeze({
        id,
        mode: entry.policy.mode,
        disabled: entry.disabled,
        propagate,
      }) };
    }
  }

  reset(id?: string): void {
    if (id) {
      const entry = this.#entries.get(id);
      if (entry) {
        entry.failures = 0;
        entry.disabled = false;
        entry.lastError = null;
      }
      return;
    }
    for (const entry of this.#entries.values()) {
      entry.failures = 0;
      entry.disabled = false;
      entry.lastError = null;
    }
  }

  state(): readonly FailureStateR31[] {
    return Object.freeze([...this.#entries.values()].map((entry) => Object.freeze({
      id: entry.id,
      failures: entry.failures,
      disabled: entry.disabled,
      lastFailureFrame: entry.lastFailureFrame,
      lastError: entry.lastError,
    })));
  }
}
