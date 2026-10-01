import type { RuntimeMode } from './contracts';

export type RecoveryAction = 'ignore' | 'retry' | 'degrade' | 'restore' | 'restart' | 'fault';
export type RecoveryReason = 'budget' | 'network' | 'asset' | 'worker' | 'state' | 'render' | 'unknown';

export interface RecoveryIncident {
  readonly id: string;
  readonly tick: number;
  readonly mode: RuntimeMode;
  readonly reason: RecoveryReason;
  readonly message: string;
  readonly recoverable: boolean;
  readonly severity: 'info' | 'warning' | 'critical';
}

export interface RecoveryDecision {
  readonly action: RecoveryAction;
  readonly delayTicks: number;
  readonly incident: RecoveryIncident;
  readonly rationale: string;
}

export interface RecoveryPolicy {
  readonly maxRetries: number;
  readonly retryBaseTicks: number;
  readonly degradeAfter: number;
  readonly restoreAfter: number;
  readonly faultAfter: number;
}

export interface RecoveryState {
  readonly consecutiveFailures: number;
  readonly totalFailures: number;
  readonly recoveries: number;
  readonly degradations: number;
  readonly lastReason: RecoveryReason | null;
  readonly openCircuit: boolean;
}

const DEFAULT_POLICY: RecoveryPolicy = {
  maxRetries: 4,
  retryBaseTicks: 15,
  degradeAfter: 2,
  restoreAfter: 30,
  faultAfter: 6,
};

export class R35CircuitBreaker {
  readonly failureThreshold: number;
  readonly coolDownTicks: number;
  #failures = 0;
  #openedAt = -1;
  #halfOpen = false;

  constructor(failureThreshold = 5, coolDownTicks = 60) {
    if (failureThreshold < 1 || coolDownTicks < 1) throw new RangeError('invalid circuit breaker limits');
    this.failureThreshold = failureThreshold;
    this.coolDownTicks = coolDownTicks;
  }

  allow(tick: number): boolean {
    if (this.#openedAt < 0) return true;
    if (tick - this.#openedAt < this.coolDownTicks) return false;
    this.#halfOpen = true;
    return true;
  }

  success(): void {
    this.#failures = 0;
    this.#openedAt = -1;
    this.#halfOpen = false;
  }

  failure(tick: number): void {
    this.#failures += 1;
    if (this.#halfOpen || this.#failures >= this.failureThreshold) {
      this.#openedAt = tick;
      this.#halfOpen = false;
    }
  }

  get failures(): number {
    return this.#failures;
  }

  get open(): boolean {
    return this.#openedAt >= 0;
  }

  reset(): void {
    this.#failures = 0;
    this.#openedAt = -1;
    this.#halfOpen = false;
  }
}

export class R35RecoveryController {
  readonly policy: RecoveryPolicy;
  readonly circuit: R35CircuitBreaker;
  #retryCounts = new Map<RecoveryReason, number>();
  #consecutiveFailures = 0;
  #totalFailures = 0;
  #recoveries = 0;
  #degradations = 0;
  #lastReason: RecoveryReason | null = null;

  constructor(policy?: Partial<RecoveryPolicy>) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
    this.circuit = new R35CircuitBreaker(Math.max(3, this.policy.faultAfter - 1), this.policy.restoreAfter);
  }

  decide(incident: RecoveryIncident): RecoveryDecision {
    this.#lastReason = incident.reason;
    if (!incident.recoverable) {
      this.#totalFailures += 1;
      this.#consecutiveFailures += 1;
      this.circuit.failure(incident.tick);
      return {
        action: 'fault',
        delayTicks: 0,
        incident,
        rationale: 'incident is explicitly non-recoverable',
      };
    }

    const previous = this.#retryCounts.get(incident.reason) ?? 0;
    const next = previous + 1;
    this.#retryCounts.set(incident.reason, next);
    this.#totalFailures += 1;
    this.#consecutiveFailures += 1;
    this.circuit.failure(incident.tick);

    if (next <= this.policy.maxRetries && this.circuit.allow(incident.tick)) {
      const exponent = Math.min(5, next - 1);
      const delayTicks = this.policy.retryBaseTicks * (2 ** exponent);
      return {
        action: 'retry',
        delayTicks,
        incident,
        rationale: 'bounded exponential retry remains within policy',
      };
    }

    if (this.#consecutiveFailures >= this.policy.faultAfter || this.circuit.open) {
      return {
        action: 'fault',
        delayTicks: 0,
        incident,
        rationale: 'failure budget exhausted or circuit is open',
      };
    }

    if (this.#consecutiveFailures >= this.policy.degradeAfter) {
      this.#degradations += 1;
      return {
        action: 'degrade',
        delayTicks: 0,
        incident,
        rationale: 'degradation threshold reached before terminal fault threshold',
      };
    }

    return {
      action: incident.reason === 'state' ? 'restore' : 'retry',
      delayTicks: this.policy.retryBaseTicks,
      incident,
      rationale: 'recovery remains within the first-line policy',
    };
  }

  markRecovered(): void {
    this.#consecutiveFailures = 0;
    this.#recoveries += 1;
    this.#retryCounts.clear();
    this.circuit.success();
  }

  markRestarted(): void {
    this.#consecutiveFailures = 0;
    this.#retryCounts.clear();
    this.circuit.reset();
  }

  state(): RecoveryState {
    return Object.freeze({
      consecutiveFailures: this.#consecutiveFailures,
      totalFailures: this.#totalFailures,
      recoveries: this.#recoveries,
      degradations: this.#degradations,
      lastReason: this.#lastReason,
      openCircuit: this.circuit.open,
    });
  }
}

export function createRecoveryIncident(
  id: string,
  tick: number,
  mode: RuntimeMode,
  reason: RecoveryReason,
  message: string,
  recoverable = true,
): RecoveryIncident {
  return Object.freeze({
    id,
    tick,
    mode,
    reason,
    message,
    recoverable,
    severity: recoverable ? 'warning' : 'critical',
  });
}
