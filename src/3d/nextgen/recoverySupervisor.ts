import type { RuntimeMode } from './kernelTypes.ts';
import { clamp, stableHash } from './kernelTypes.ts';

export type FaultKind = 'renderer-loss' | 'memory-pressure' | 'asset-failure' | 'network-timeout' | 'simulation-overrun' | 'unknown';
export type RecoveryAction = 'reduce-quality' | 'flush-assets' | 'restart-renderer' | 'pause-streaming' | 'reset-subsystem' | 'fail-closed';

export interface RecoveryPolicy {
  readonly maxAttemptsPerKind: number;
  readonly cooldownTicks: number;
  readonly stableTicksForReset: number;
  readonly historyLimit: number;
}

export const DEFAULT_RECOVERY_POLICY: RecoveryPolicy = Object.freeze({
  maxAttemptsPerKind: 3,
  cooldownTicks: 180,
  stableTicksForReset: 600,
  historyLimit: 256,
});

export interface RecoveryRequest {
  readonly kind: FaultKind;
  readonly tick: number;
  readonly severity: number;
  readonly detail?: string;
}

export interface RecoveryPlan {
  readonly accepted: boolean;
  readonly action: RecoveryAction;
  readonly kind: FaultKind;
  readonly attempt: number;
  readonly reason: string;
  readonly tick: number;
}

interface RecoveryState {
  readonly attempts: number;
  readonly lastAttemptTick: number;
  readonly stableSinceTick: number;
  readonly mode: RuntimeMode;
}

export class RecoverySupervisor {
  readonly policy: RecoveryPolicy;
  #states = new Map<FaultKind, RecoveryState>();
  #history: RecoveryPlan[] = [];
  #disposed = false;

  constructor(policy: RecoveryPolicy = DEFAULT_RECOVERY_POLICY) { this.policy = Object.freeze({ ...policy }); }

  request(request: RecoveryRequest): RecoveryPlan {
    if (this.#disposed) return Object.freeze({
      accepted: false,
      action: 'fail-closed',
      kind: request.kind,
      attempt: 0,
      reason: 'disposed',
      tick: request.tick,
    });
    const previous = this.#states.get(request.kind) ?? {
      attempts: 0,
      lastAttemptTick: -Infinity,
      stableSinceTick: request.tick,
      mode: 'live' as const,
    };
    const tick = Math.max(0, Math.floor(request.tick));
    if (tick - previous.lastAttemptTick < this.policy.cooldownTicks) {
      return this.#record(Object.freeze({
        accepted: false,
        action: 'pause-streaming',
        kind: request.kind,
        attempt: previous.attempts,
        reason: 'cooldown',
        tick,
      }), previous);
    }
    const attempt = previous.attempts + 1;
    const severity = clamp(request.severity, 0, 100);
    const action: RecoveryAction =
      attempt > this.policy.maxAttemptsPerKind ? 'fail-closed' :
      request.kind === 'renderer-loss' && severity >= 60 ? 'restart-renderer' :
      request.kind === 'memory-pressure' ? 'flush-assets' :
      request.kind === 'simulation-overrun' ? 'reduce-quality' :
      request.kind === 'network-timeout' ? 'pause-streaming' :
      request.kind === 'asset-failure' ? 'reset-subsystem' :
      'reduce-quality';

    const plan = Object.freeze({
      accepted: true,
      action,
      kind: request.kind,
      attempt,
      reason: request.detail?.slice(0, 256) ?? request.kind,
      tick,
    });
    this.#states.set(request.kind, Object.freeze({
      attempts: attempt,
      lastAttemptTick: tick,
      stableSinceTick: previous.stableSinceTick,
      mode: action === 'fail-closed' ? 'failed' : 'recovering',
    }));
    return this.#record(plan, previous);
  }

  #record(plan: RecoveryPlan, _previous: RecoveryState): RecoveryPlan {
    this.#history.push(plan);
    if (this.#history.length > this.policy.historyLimit) this.#history.splice(0, this.#history.length - this.policy.historyLimit);
    return plan;
  }

  markStable(tick: number): void {
    for (const [kind, state] of this.#states) {
      if (tick - state.lastAttemptTick >= this.policy.stableTicksForReset) {
        this.#states.set(kind, Object.freeze({ ...state, attempts: 0, stableSinceTick: tick, mode: 'live' }));
      }
    }
  }

  mode(kind: FaultKind): RuntimeMode {
    return this.#states.get(kind)?.mode ?? 'live';
  }

  history(): readonly RecoveryPlan[] { return Object.freeze([...this.#history]); }

  diagnostics() {
    return Object.freeze({
      faults: this.#states.size,
      recovering: [...this.#states.values()].filter((x) => x.mode === 'recovering').length,
      failed: [...this.#states.values()].filter((x) => x.mode === 'failed').length,
      attempts: [...this.#states.values()].reduce((sum, x) => sum + x.attempts, 0),
      digest: stableHash(this.#history),
    });
  }

  reset(kind?: FaultKind): void {
    if (kind) this.#states.delete(kind);
    else this.#states.clear();
  }

  dispose(): void { this.#disposed = true; this.#states.clear(); this.#history = []; }
}
