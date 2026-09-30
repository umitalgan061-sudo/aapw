import {RuntimeError,stableHash} from './contracts.ts';
import type {HealthGrade} from './contracts.ts';

  HealthGrade,
  RuntimeError,
  stableHash,
} from './contracts.ts';

export type RecoveryState =
  | 'healthy'
  | 'suspect'
  | 'recovering'
  | 'quarantined'
  | 'failed';

export type FaultClass =
  | 'render'
  | 'asset'
  | 'network'
  | 'state'
  | 'input'
  | 'world'
  | 'unknown';

export interface Fault {
  readonly id: string;
  readonly fingerprint: string;
  readonly class: FaultClass;
  readonly message: string;
  readonly tick: number;
  readonly recoverable: boolean;
  readonly metadata?: Readonly<Record<string,string|number|boolean>>;
}

export interface RecoveryPolicy {
  readonly maxAttempts: number;
  readonly baseBackoffTicks: number;
  readonly maxBackoffTicks: number;
  readonly quarantineThreshold: number;
  readonly historyLimit: number;
}

export interface RecoverySnapshot {
  readonly state: RecoveryState;
  readonly attempt: number;
  readonly faultCount: number;
  readonly score: number;
  readonly nextAttemptTick: number;
  readonly lastFault?: Fault;
}

const DEFAULT_POLICY: RecoveryPolicy = {
  maxAttempts: 4,
  baseBackoffTicks: 15,
  maxBackoffTicks: 240,
  quarantineThreshold: 8,
  historyLimit: 128,
};

export class RuntimeRecoveryController {
  readonly #policy: RecoveryPolicy;
  readonly #faults: Fault[] = [];

  #state: RecoveryState = 'healthy';
  #attempt = 0;
  #nextAttemptTick = 0;
  #lastFault: Fault | undefined;

  constructor(policy: Partial<RecoveryPolicy> = {}) {
    this.#policy = {
      ...DEFAULT_POLICY,
      ...policy,
    };
  }

  report(
    fault: Omit<Fault,'id'|'fingerprint'>,
  ): RecoverySnapshot {
    const fingerprint = stableHash({
      class: fault.class,
      message: fault.message,
    });

    const entry: Fault = {
      ...fault,
      id: 'r32-fault-' + stableHash({
        ...fault,
        tick: fault.tick,
      }),
      fingerprint,
    };

    this.#faults.push(entry);

    while (this.#faults.length > this.#policy.historyLimit) {
      this.#faults.shift();
    }

    this.#lastFault = entry;

    const repeated = this.#faults.filter(
      (item) => item.fingerprint === fingerprint,
    ).length;

    if (!fault.recoverable || repeated >= this.#policy.quarantineThreshold) {
      this.#state = 'quarantined';

      return this.snapshot(fault.tick);
    }

    this.#attempt += 1;

    if (this.#attempt > this.#policy.maxAttempts) {
      this.#state = 'failed';

      return this.snapshot(fault.tick);
    }

    this.#state = 'suspect';

    const exponent = Math.max(
      0,
      this.#attempt - 1,
    );

    const backoff = Math.min(
      this.#policy.maxBackoffTicks,
      this.#policy.baseBackoffTicks * (2 ** exponent),
    );

    this.#nextAttemptTick = fault.tick + backoff;

    return this.snapshot(fault.tick);
  }

  beginAttempt(tick: number): boolean {
    if (
      this.#state === 'failed'
      || this.#state === 'quarantined'
    ) {
      return false;
    }

    if (tick < this.#nextAttemptTick) {
      return false;
    }

    this.#state = 'recovering';

    return true;
  }

  resolve(tick: number): RecoverySnapshot {
    this.#state = 'healthy';
    this.#attempt = 0;
    this.#nextAttemptTick = tick;
    this.#lastFault = undefined;

    return this.snapshot(tick);
  }

  canContinue(): boolean {
    return (
      this.#state !== 'failed'
      && this.#state !== 'quarantined'
    );
  }

  healthGrade(): HealthGrade {
    const score = this.snapshot().score;

    if (score >= 90) {
      return 'excellent';
    }

    if (score >= 75) {
      return 'healthy';
    }

    if (score >= 55) {
      return 'degraded';
    }

    return 'critical';
  }

  snapshot(tick = this.#nextAttemptTick): RecoverySnapshot {
    const recent = this.#faults.slice(-10);
    const score = Math.max(
      0,
      Math.min(
        100,
        100
          - recent.length * 8
          - this.#attempt * 10,
      ),
    );

    return {
      state: this.#state,
      attempt: this.#attempt,
      faultCount: this.#faults.length,
      score,
      nextAttemptTick: Math.max(
        tick,
        this.#nextAttemptTick,
      ),
      ...(this.#lastFault === undefined
        ? {}
        : {
          lastFault: this.#lastFault,
        }),
    };
  }

  faults(): readonly Fault[] {
    return this.#faults.slice();
  }

  clearFaults(): void {
    this.#faults.length = 0;
    this.#state = 'healthy';
    this.#attempt = 0;
    this.#nextAttemptTick = 0;
    this.#lastFault = undefined;
  }
}

export interface FaultBoundary<T> {
  readonly execute: (
    operation: () => T,
  ) => T;
  readonly snapshot: () => RecoverySnapshot;
}

export function createFaultBoundary<T>(
  controller: RuntimeRecoveryController,
  tick: () => number,
  category: FaultClass,
): FaultBoundary<T> {
  return {
    execute(operation) {
      try {
        return operation();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        const snapshot = controller.report({
          class: category,
          message,
          tick: tick(),
          recoverable: true,
        });

        if (!snapshot.lastFault) {
          throw error;
        }

        throw new RuntimeError({
          code: 'R32_FAULT_BOUNDARY',
          message: 'Runtime operation failed inside a guarded boundary.',
          cause: error,
          metadata: {
            class: category,
            fingerprint: snapshot.lastFault.fingerprint,
          },
        });
      }
    },
    snapshot: () => controller.snapshot(tick()),
  };
}

export function classifyRuntimeError(
  error: unknown,
): FaultClass {
  if (!(error instanceof RuntimeError)) {
    return 'unknown';
  }

  const code = error.code;

  if (code.includes('RENDER')) {
    return 'render';
  }

  if (code.includes('ASSET')) {
    return 'asset';
  }

  if (code.includes('NETWORK')) {
    return 'network';
  }

  if (
    code.includes('STATE')
    || code.includes('SNAPSHOT')
  ) {
    return 'state';
  }

  if (code.includes('INPUT')) {
    return 'input';
  }

  if (code.includes('WORLD')) {
    return 'world';
  }

  return 'unknown';
}
