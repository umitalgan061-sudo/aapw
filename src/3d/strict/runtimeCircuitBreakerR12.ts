/**
 * Runtime circuit breaker for catastrophic frame/initialization failures.
 *
 * This layer is intentionally independent from render quality. Quality throttling handles pressure;
 * the circuit breaker protects the application from repeatedly executing a known-failing operation.
 * State transitions are deterministic and observable, with a bounded failure window and cooldown.
 */

export type RuntimeCircuitState = 'closed' | 'open' | 'half-open' | 'disposed';

export interface RuntimeCircuitPolicy {
  readonly failureThreshold: number;
  readonly failureWindowMs: number;
  readonly cooldownMs: number;
  readonly recoverySuccesses: number;
  readonly historyCapacity: number;
  readonly now: () => number;
}

export interface RuntimeCircuitEvent {
  readonly type: 'failure' | 'success' | 'trip' | 'half-open' | 'recover';
  readonly operation: string;
  readonly atMs: number;
  readonly message?: string;
}

export interface RuntimeCircuitSnapshot {
  readonly version: 12;
  readonly state: RuntimeCircuitState;
  readonly failuresInWindow: number;
  readonly consecutiveSuccesses: number;
  readonly openedAtMs: number | null;
  readonly lastFailure?: Readonly<{ operation: string; message: string; atMs: number }>;
  readonly history: readonly RuntimeCircuitEvent[];
}

const DEFAULT_POLICY: RuntimeCircuitPolicy = Object.freeze({
  failureThreshold: 3,
  failureWindowMs: 8_000,
  cooldownMs: 3_000,
  recoverySuccesses: 3,
  historyCapacity: 64,
  now: () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : 0),
});

const normalizePolicy = (input: Partial<Omit<RuntimeCircuitPolicy, 'now'>> & Pick<RuntimeCircuitPolicy, 'now'>): RuntimeCircuitPolicy => {
  const policy = Object.freeze({
    failureThreshold: Math.max(1, Math.floor(Number(input.failureThreshold ?? DEFAULT_POLICY.failureThreshold))),
    failureWindowMs: Math.max(250, Number(input.failureWindowMs ?? DEFAULT_POLICY.failureWindowMs)),
    cooldownMs: Math.max(0, Number(input.cooldownMs ?? DEFAULT_POLICY.cooldownMs)),
    recoverySuccesses: Math.max(1, Math.floor(Number(input.recoverySuccesses ?? DEFAULT_POLICY.recoverySuccesses))),
    historyCapacity: Math.max(8, Math.floor(Number(input.historyCapacity ?? DEFAULT_POLICY.historyCapacity))),
    now: input.now,
  });
  return policy;
};

export class RuntimeCircuitBreakerR12 {
  readonly policy: RuntimeCircuitPolicy;

  #state: RuntimeCircuitState = 'closed';
  #openedAtMs: number | null = null;
  #consecutiveSuccesses = 0;
  #failures: Array<{ readonly operation: string; readonly message: string; readonly atMs: number }> = [];
  #history: RuntimeCircuitEvent[] = [];
  #lastFailure: { readonly operation: string; readonly message: string; readonly atMs: number } | undefined;

  constructor(policy: Partial<Omit<RuntimeCircuitPolicy, 'now'>> & { readonly now?: () => number } = {}) {
    this.policy = normalizePolicy({ ...DEFAULT_POLICY, ...policy, now: policy.now ?? DEFAULT_POLICY.now });
  }

  get state(): RuntimeCircuitState {
    return this.#state;
  }

  canExecute(): boolean {
    if (this.#state === 'disposed') return false;
    if (this.#state === 'closed') return true;
    if (this.#state === 'half-open') return true;

    const now = this.policy.now();
    if (now - (this.#openedAtMs ?? now) < this.policy.cooldownMs) return false;

    this.#state = 'half-open';
    this.#record({ type: 'half-open', operation: 'circuit', atMs: now });
    return true;
  }

  recordFailure(operation: string, error: unknown): RuntimeCircuitSnapshot {
    if (this.#state === 'disposed') return this.snapshot();

    const now = this.policy.now();
    const event = Object.freeze({
      operation: String(operation).slice(0, 120),
      message: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      atMs: now,
    });
    this.#lastFailure = event;
    this.#expire(now);
    this.#failures.push(event);
    this.#consecutiveSuccesses = 0;
    this.#record({ type: 'failure', operation: event.operation, atMs: now, message: event.message });

    if (this.#failures.length >= this.policy.failureThreshold) {
      this.#state = 'open';
      this.#openedAtMs = now;
      this.#record({ type: 'trip', operation: event.operation, atMs: now, message: event.message });
    } else if (this.#state === 'half-open') {
      this.#state = 'open';
      this.#openedAtMs = now;
      this.#record({ type: 'trip', operation: event.operation, atMs: now, message: event.message });
    }

    return this.snapshot();
  }

  recordSuccess(operation = 'operation'): RuntimeCircuitSnapshot {
    if (this.#state === 'disposed') return this.snapshot();
    const now = this.policy.now();
    this.#expire(now);
    this.#record({ type: 'success', operation: String(operation).slice(0, 120), atMs: now });

    if (this.#state === 'half-open') {
      this.#consecutiveSuccesses += 1;
      if (this.#consecutiveSuccesses >= this.policy.recoverySuccesses) {
        this.#state = 'closed';
        this.#openedAtMs = null;
        this.#failures.length = 0;
        this.#consecutiveSuccesses = 0;
        this.#record({ type: 'recover', operation: 'circuit', atMs: now });
      }
    } else if (this.#state === 'closed') {
      this.#consecutiveSuccesses = Math.min(this.policy.recoverySuccesses, this.#consecutiveSuccesses + 1);
    }

    return this.snapshot();
  }

  forceOpen(reason = 'manual'): RuntimeCircuitSnapshot {
    if (this.#state === 'disposed') return this.snapshot();
    this.#state = 'open';
    this.#openedAtMs = this.policy.now();
    this.#record({ type: 'trip', operation: reason, atMs: this.#openedAtMs });
    return this.snapshot();
  }

  reset(): void {
    if (this.#state === 'disposed') return;
    this.#state = 'closed';
    this.#openedAtMs = null;
    this.#consecutiveSuccesses = 0;
    this.#failures.length = 0;
    this.#history.length = 0;
    this.#lastFailure = undefined;
  }

  dispose(): void {
    this.#state = 'disposed';
    this.#openedAtMs = null;
    this.#consecutiveSuccesses = 0;
    this.#failures.length = 0;
    this.#history.length = 0;
    this.#lastFailure = undefined;
  }

  snapshot(): RuntimeCircuitSnapshot {
    return Object.freeze({
      version: 12,
      state: this.#state,
      failuresInWindow: this.#failures.length,
      consecutiveSuccesses: this.#consecutiveSuccesses,
      openedAtMs: this.#openedAtMs,
      ...(this.#lastFailure ? { lastFailure: this.#lastFailure } : {}),
      history: Object.freeze([...this.#history]),
    });
  }

  #expire(now: number): void {
    const cutoff = now - this.policy.failureWindowMs;
    while (this.#failures.length > 0 && this.#failures[0]!.atMs < cutoff) this.#failures.shift();
  }

  #record(event: RuntimeCircuitEvent): void {
    this.#history.push(Object.freeze(event));
    if (this.#history.length > this.policy.historyCapacity) {
      this.#history.splice(0, this.#history.length - this.policy.historyCapacity);
    }
  }
}

export const DEFAULT_RUNTIME_CIRCUIT_POLICY_R12 = DEFAULT_POLICY;
