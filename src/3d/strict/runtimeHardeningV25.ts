import { StrictRuntimeHealthBudget, type StrictHealthObservation, type StrictHealthSnapshot } from './runtimeHealthBudget.ts';
import { checksum, stableStringify } from '../modern/deterministic.ts';

export type HardeningState = 'nominal' | 'throttled' | 'recovering' | 'critical' | 'disposed';

export interface HardeningPolicy {
  readonly failureWindowMs: number;
  readonly maxFailuresPerWindow: number;
  readonly recoverySamples: number;
  readonly operationTimeoutMs: number;
  readonly historyCapacity: number;
  readonly now?: () => number;
}

export interface HardeningDecision {
  readonly state: HardeningState;
  readonly health: StrictHealthSnapshot | null;
  readonly throttleFactor: number;
  readonly failureCount: number;
  readonly retrySuggested: boolean;
  readonly reason: string;
}

export interface HardeningSnapshot {
  readonly version: 25;
  readonly state: HardeningState;
  readonly throttleFactor: number;
  readonly failureCount: number;
  readonly lastFailure?: Readonly<{ operation: string; message: string; atMs: number }>;
  readonly history: readonly HardeningDecision[];
  readonly digest: string;
}

const DEFAULT_POLICY: HardeningPolicy = Object.freeze({
  failureWindowMs: 8_000,
  maxFailuresPerWindow: 5,
  recoverySamples: 6,
  operationTimeoutMs: 12_000,
  historyCapacity: 96,
  now: undefined,
});

const nowMs = (): number => typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? performance.now()
  : 0;

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, finite(value)));

export class RuntimeHardeningSupervisorV25 {
  readonly policy: HardeningPolicy;
  readonly health: StrictRuntimeHealthBudget;

  #state: HardeningState = 'nominal';
  #throttleFactor = 1;
  #failures: Array<{ readonly operation: string; readonly message: string; readonly atMs: number }> = [];
  #history: HardeningDecision[] = [];
  #disposed = false;
  #healthySamples = 0;
  #lastFailure: { readonly operation: string; readonly message: string; readonly atMs: number } | undefined;
  #now: () => number;

  constructor(options: Partial<HardeningPolicy> = {}) {
    this.policy = Object.freeze({
      ...DEFAULT_POLICY,
      ...options,
      failureWindowMs: Math.max(1_000, finite(options.failureWindowMs, DEFAULT_POLICY.failureWindowMs)),
      maxFailuresPerWindow: Math.max(1, Math.floor(finite(options.maxFailuresPerWindow, DEFAULT_POLICY.maxFailuresPerWindow))),
      recoverySamples: Math.max(1, Math.floor(finite(options.recoverySamples, DEFAULT_POLICY.recoverySamples))),
      operationTimeoutMs: Math.max(0, finite(options.operationTimeoutMs, DEFAULT_POLICY.operationTimeoutMs)),
      historyCapacity: Math.max(16, Math.floor(finite(options.historyCapacity, DEFAULT_POLICY.historyCapacity))),
      ...(options.now ? { now: options.now } : {}),
    });
    this.#now = options.now ?? nowMs;
    this.health = new StrictRuntimeHealthBudget({
      windowSize: Math.min(64, this.policy.historyCapacity),
      recoveryAfterHealthySamples: this.policy.recoverySamples,
    });
  }

  observeFrame(observation: StrictHealthObservation): HardeningDecision {
    if (this.#disposed) return this.#decision(null, 0, 'disposed');
    const snapshot = this.health.observe(observation);
    this.#expireFailures(this.#now());
    if (snapshot.state === 'critical' || this.#failures.length >= this.policy.maxFailuresPerWindow) {
      this.#state = 'critical';
      this.#throttleFactor = 0.35;
      this.#healthySamples = 0;
    } else if (snapshot.state === 'degraded') {
      this.#state = 'throttled';
      this.#throttleFactor = Math.max(0.55, 1 - (1 - snapshot.score) * 0.45);
      this.#healthySamples = 0;
    } else {
      this.#healthySamples += 1;
      if (this.#state !== 'nominal' && this.#healthySamples >= this.policy.recoverySamples) {
        this.#state = 'recovering';
        this.#throttleFactor = Math.min(1, this.#throttleFactor + 0.15);
        if (this.#throttleFactor >= 0.99) {
          this.#state = 'nominal';
          this.#throttleFactor = 1;
        }
      }
    }

    const reason = snapshot.state === 'critical'
      ? 'health-critical'
      : snapshot.state === 'degraded'
        ? 'health-degraded'
        : this.#state === 'recovering'
          ? 'recovery-window'
          : 'nominal';
    return this.#record(this.#decision(snapshot, this.#throttleFactor, reason));
  }

  async guardAsync<T>(operation: string, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.#disposed) throw new Error('Runtime hardening supervisor is disposed.');
    const controller = new AbortController();
    const timeoutId = this.policy.operationTimeoutMs > 0
      ? globalThis.setTimeout(() => controller.abort(), this.policy.operationTimeoutMs)
      : undefined;
    try {
      return await task(controller.signal);
    } catch (error) {
      this.recordFailure(operation, error);
      throw error;
    } finally {
      if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
    }
  }

  guard<T>(operation: string, task: () => T): T {
    if (this.#disposed) throw new Error('Runtime hardening supervisor is disposed.');
    try {
      return task();
    } catch (error) {
      this.recordFailure(operation, error);
      throw error;
    }
  }

  recordFailure(operation: string, error: unknown): void {
    if (this.#disposed) return;
    const event = Object.freeze({
      operation: String(operation).slice(0, 120),
      message: error instanceof Error ? error.message : String(error),
      atMs: this.#now(),
    });
    this.#lastFailure = event;
    this.#failures.push(event);
    this.#expireFailures(Number(event.atMs));
    if (this.#failures.length >= this.policy.maxFailuresPerWindow) {
      this.#state = 'critical';
      this.#throttleFactor = 0.35;
    } else {
      this.#state = 'throttled';
      this.#throttleFactor = Math.min(this.#throttleFactor, 0.7);
    }
  }

  canStartOperation(): boolean {
    return !this.#disposed && this.#state !== 'critical';
  }

  snapshot(): HardeningSnapshot {
    return Object.freeze({
      version: 25,
      state: this.#state,
      throttleFactor: Number(clamp01(this.#throttleFactor).toFixed(4)),
      failureCount: this.#failures.length,
      ...(this.#lastFailure ? { lastFailure: this.#lastFailure } : {}),
      history: Object.freeze([...this.#history]),
      digest: checksum(stableStringify({
        version: 25,
        state: this.#state,
        throttleFactor: this.#throttleFactor,
        failures: this.#failures,
        history: this.#history,
      })),
    });
  }

  reset(): void {
    if (this.#disposed) return;
    this.#state = 'nominal';
    this.#throttleFactor = 1;
    this.#failures.length = 0;
    this.#history.length = 0;
    this.#healthySamples = 0;
    this.#lastFailure = undefined;
    this.health.reset();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#state = 'disposed';
    this.#history.length = 0;
    this.#failures.length = 0;
    this.health.reset();
  }

  #expireFailures(referenceMs: number): void {
    const cutoff = referenceMs - this.policy.failureWindowMs;
    while (this.#failures.length > 0 && this.#failures[0]!.atMs < cutoff) this.#failures.shift();
  }

  #decision(health: StrictHealthSnapshot | null, throttleFactor: number, reason: string): HardeningDecision {
    return Object.freeze({
      state: this.#state,
      health,
      throttleFactor: Number(throttleFactor.toFixed(4)),
      failureCount: this.#failures.length,
      retrySuggested: this.#state === 'throttled' || this.#state === 'recovering',
      reason,
    });
  }

  #record(decision: HardeningDecision): HardeningDecision {
    this.#history.push(decision);
    if (this.#history.length > this.policy.historyCapacity) {
      this.#history.splice(0, this.#history.length - this.policy.historyCapacity);
    }
    return decision;
  }
}

export const DEFAULT_RUNTIME_HARDENING_POLICY_V25 = DEFAULT_POLICY;
