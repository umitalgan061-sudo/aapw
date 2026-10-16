/**
 * Fault containment primitives for long-lived world/runtime sessions.
 *
 * The module is deterministic: cooldowns use host-provided logical ticks, retry
 * tokens are accounted by logical time, and incident identity is derived from a
 * stable fingerprint rather than UUIDs or wall-clock timestamps.
 */
import {
  R44BoundaryError,
  R44InvariantError,
  type R44CircuitState,
  type R44Failure,
  type R44Fingerprint,
  type R44JsonValue,
  type R44Severity,
  r44FiniteInteger,
  r44NormalizeId,
  r44NormalizeLabel,
  r44ToFailure,
} from "./contracts.js";
import { r44Fingerprint } from "./hash.js";

export interface R44CircuitBreakerOptions {
  readonly failureThreshold?: number;
  readonly openForTicks?: number;
  readonly successThreshold?: number;
  readonly maxProbeCalls?: number;
}

export interface R44CircuitSnapshot {
  readonly name: string;
  readonly state: R44CircuitState;
  readonly failures: number;
  readonly successes: number;
  readonly consecutiveFailures: number;
  readonly consecutiveProbeSuccesses: number;
  readonly openedAtTick: number | null;
  readonly nextProbeTick: number | null;
  readonly probeCallsInFlight: number;
  readonly rejectedCalls: number;
}

export type R44CircuitPermit =
  | { readonly allowed: true; readonly probe: boolean; complete(success: boolean, tick: number): void }
  | { readonly allowed: false; readonly retryAtTick: number | null; readonly reason: "open" | "probe-limit" };

export class R44CircuitBreaker {
  readonly #name: string;
  readonly #failureThreshold: number;
  readonly #openForTicks: number;
  readonly #successThreshold: number;
  readonly #maxProbeCalls: number;
  #state: R44CircuitState = "closed";
  #failures = 0;
  #successes = 0;
  #consecutiveFailures = 0;
  #consecutiveProbeSuccesses = 0;
  #openedAtTick: number | null = null;
  #nextProbeTick: number | null = null;
  #probeCallsInFlight = 0;
  #rejectedCalls = 0;
  #generation = 0;

  constructor(name: string, options: R44CircuitBreakerOptions = {}) {
    this.#name = r44NormalizeId(name, "circuit name", 96);
    this.#failureThreshold = r44FiniteInteger(options.failureThreshold ?? 5, "failureThreshold", 1, 10_000);
    this.#openForTicks = r44FiniteInteger(options.openForTicks ?? 30, "openForTicks", 1, 10_000_000);
    this.#successThreshold = r44FiniteInteger(options.successThreshold ?? 2, "successThreshold", 1, 10_000);
    this.#maxProbeCalls = r44FiniteInteger(options.maxProbeCalls ?? 1, "maxProbeCalls", 1, 128);
  }

  get state(): R44CircuitState { return this.#state; }

  acquire(tick: number): R44CircuitPermit {
    r44FiniteInteger(tick, "tick", 0);
    if (this.#state === "open") {
      if (this.#nextProbeTick === null || tick < this.#nextProbeTick) {
        this.#rejectedCalls += 1;
        return Object.freeze({ allowed: false, retryAtTick: this.#nextProbeTick, reason: "open" });
      }
      this.#state = "half-open";
      this.#probeCallsInFlight = 0;
      this.#consecutiveProbeSuccesses = 0;
      this.#generation += 1;
    }
    const probe = this.#state === "half-open";
    if (probe && this.#probeCallsInFlight >= this.#maxProbeCalls) {
      this.#rejectedCalls += 1;
      return Object.freeze({ allowed: false, retryAtTick: tick + 1, reason: "probe-limit" });
    }
    if (probe) this.#probeCallsInFlight += 1;
    const generation = this.#generation;
    let completed = false;
    return Object.freeze({
      allowed: true,
      probe,
      complete: (success: boolean, completionTick: number): void => {
        if (completed) throw new R44InvariantError("circuit-permit-reused", "Circuit permit can be completed only once");
        completed = true;
        r44FiniteInteger(completionTick, "completionTick", tick);
        if (generation !== this.#generation) return;
        this.#complete(success, probe, completionTick);
      },
    });
  }

  record(success: boolean, tick: number): void {
    const permit = this.acquire(tick);
    if (!permit.allowed) return;
    permit.complete(success, tick);
  }

  forceOpen(tick: number): void {
    r44FiniteInteger(tick, "tick", 0);
    this.#open(tick);
  }

  reset(): void {
    this.#state = "closed";
    this.#failures = 0;
    this.#successes = 0;
    this.#consecutiveFailures = 0;
    this.#consecutiveProbeSuccesses = 0;
    this.#openedAtTick = null;
    this.#nextProbeTick = null;
    this.#probeCallsInFlight = 0;
    this.#generation += 1;
  }

  snapshot(): R44CircuitSnapshot {
    return Object.freeze({
      name: this.#name,
      state: this.#state,
      failures: this.#failures,
      successes: this.#successes,
      consecutiveFailures: this.#consecutiveFailures,
      consecutiveProbeSuccesses: this.#consecutiveProbeSuccesses,
      openedAtTick: this.#openedAtTick,
      nextProbeTick: this.#nextProbeTick,
      probeCallsInFlight: this.#probeCallsInFlight,
      rejectedCalls: this.#rejectedCalls,
    });
  }

  #complete(success: boolean, probe: boolean, tick: number): void {
    if (probe) this.#probeCallsInFlight = Math.max(0, this.#probeCallsInFlight - 1);
    if (success) {
      this.#successes += 1;
      this.#consecutiveFailures = 0;
      if (this.#state === "half-open") {
        this.#consecutiveProbeSuccesses += 1;
        if (this.#consecutiveProbeSuccesses >= this.#successThreshold) {
          this.#state = "closed";
          this.#openedAtTick = null;
          this.#nextProbeTick = null;
          this.#consecutiveProbeSuccesses = 0;
          this.#probeCallsInFlight = 0;
          this.#generation += 1;
        }
      }
      return;
    }
    this.#failures += 1;
    this.#consecutiveFailures += 1;
    this.#consecutiveProbeSuccesses = 0;
    if (this.#state === "half-open" || this.#consecutiveFailures >= this.#failureThreshold) this.#open(tick);
  }

  #open(tick: number): void {
    this.#state = "open";
    this.#openedAtTick = tick;
    this.#nextProbeTick = tick + this.#openForTicks;
    this.#probeCallsInFlight = 0;
    this.#consecutiveProbeSuccesses = 0;
    this.#generation += 1;
  }
}

export interface R44RetryBudgetOptions {
  readonly capacity?: number;
  readonly refillPerTick?: number;
  readonly maxAttempt?: number;
  readonly baseDelayTicks?: number;
  readonly maxDelayTicks?: number;
}

export interface R44RetryDecision {
  readonly allowed: boolean;
  readonly attempt: number;
  readonly delayTicks: number;
  readonly nextEligibleTick: number;
  readonly remainingTokens: number;
  readonly reason: "scheduled" | "attempt-limit" | "budget-empty" | "invalid-tick";
}

export class R44RetryBudget {
  readonly #capacity: number;
  readonly #refillPerTick: number;
  readonly #maxAttempt: number;
  readonly #baseDelayTicks: number;
  readonly #maxDelayTicks: number;
  #tokens: number;
  #lastTick = 0;
  readonly #attempts = new Map<string, number>();
  readonly #nextEligible = new Map<string, number>();

  constructor(options: R44RetryBudgetOptions = {}) {
    this.#capacity = options.capacity ?? 16;
    this.#refillPerTick = options.refillPerTick ?? 0.25;
    this.#maxAttempt = options.maxAttempt ?? 8;
    this.#baseDelayTicks = options.baseDelayTicks ?? 2;
    this.#maxDelayTicks = options.maxDelayTicks ?? 256;
    r44FiniteInteger(this.#capacity, "capacity", 1, 100_000);
    if (!Number.isFinite(this.#refillPerTick) || this.#refillPerTick < 0) {
      throw new R44BoundaryError("retry-refill", "refillPerTick must be non-negative");
    }
    r44FiniteInteger(this.#maxAttempt, "maxAttempt", 1, 1000);
    r44FiniteInteger(this.#baseDelayTicks, "baseDelayTicks", 1, 1_000_000);
    r44FiniteInteger(this.#maxDelayTicks, "maxDelayTicks", this.#baseDelayTicks, 100_000_000);
    this.#tokens = this.#capacity;
  }

  request(keyInput: string, tickInput: number): R44RetryDecision {
    const key = r44NormalizeId(keyInput, "retry key", 160);
    const tick = r44FiniteInteger(tickInput, "tick", 0);
    if (tick < this.#lastTick) {
      return this.#decision(false, this.#attempts.get(key) ?? 0, 0, this.#lastTick, "invalid-tick");
    }
    this.#refill(tick);
    const attempt = (this.#attempts.get(key) ?? 0) + 1;
    if (attempt > this.#maxAttempt) {
      return this.#decision(false, attempt, 0, Number.MAX_SAFE_INTEGER, "attempt-limit");
    }
    const nextAllowed = this.#nextEligible.get(key) ?? 0;
    if (tick < nextAllowed) return this.#decision(false, attempt, nextAllowed - tick, nextAllowed, "budget-empty");
    if (this.#tokens < 1) return this.#decision(false, attempt, 0, tick + 1, "budget-empty");
    this.#tokens -= 1;
    const delayTicks = Math.min(this.#maxDelayTicks, this.#baseDelayTicks * (2 ** Math.min(attempt - 1, 30)));
    const eligible = tick + delayTicks;
    this.#attempts.set(key, attempt);
    this.#nextEligible.set(key, eligible);
    return this.#decision(true, attempt, delayTicks, eligible, "scheduled");
  }

  succeed(keyInput: string): void {
    const key = r44NormalizeId(keyInput, "retry key", 160);
    this.#attempts.delete(key);
    this.#nextEligible.delete(key);
  }

  forget(keyInput: string): void {
    const key = r44NormalizeId(keyInput, "retry key", 160);
    this.#attempts.delete(key);
    this.#nextEligible.delete(key);
  }

  snapshot(): Readonly<{ tokens: number; capacity: number; trackedKeys: number; lastTick: number }> {
    return Object.freeze({ tokens: this.#tokens, capacity: this.#capacity, trackedKeys: this.#attempts.size, lastTick: this.#lastTick });
  }

  #refill(tick: number): void {
    const elapsed = tick - this.#lastTick;
    this.#tokens = Math.min(this.#capacity, this.#tokens + elapsed * this.#refillPerTick);
    this.#lastTick = tick;
  }

  #decision(
    allowed: boolean,
    attempt: number,
    delayTicks: number,
    nextEligibleTick: number,
    reason: R44RetryDecision["reason"],
  ): R44RetryDecision {
    return Object.freeze({
      allowed,
      attempt,
      delayTicks,
      nextEligibleTick,
      remainingTokens: this.#tokens,
      reason,
    });
  }
}

export interface R44IncidentInput {
  readonly subsystem: string;
  readonly code: string;
  readonly message: string;
  readonly severity: R44Severity;
  readonly tick: number;
  readonly fingerprint?: string;
  readonly details?: Readonly<Record<string, R44JsonValue>>;
  readonly recoverable?: boolean;
}

export interface R44Incident {
  readonly id: string;
  readonly key: string;
  readonly subsystem: string;
  readonly code: string;
  readonly message: string;
  readonly severity: R44Severity;
  readonly firstTick: number;
  readonly lastTick: number;
  readonly occurrences: number;
  readonly recoverable: boolean;
  readonly details: Readonly<Record<string, R44JsonValue>>;
}

export interface R44IncidentSnapshot {
  readonly active: readonly R44Incident[];
  readonly recent: readonly R44Incident[];
  readonly totalReported: number;
  readonly totalCoalesced: number;
  readonly severityCounts: Readonly<Record<R44Severity, number>>;
}

export interface R44IncidentSupervisorOptions {
  readonly historyCapacity?: number;
  readonly activeCapacity?: number;
  readonly coalesceWindowTicks?: number;
}

export class R44IncidentSupervisor {
  readonly #historyCapacity: number;
  readonly #activeCapacity: number;
  readonly #coalesceWindowTicks: number;
  readonly #active = new Map<string, R44Incident>();
  readonly #history: R44Incident[] = [];
  readonly #severityCounts: Record<R44Severity, number> = { info: 0, warning: 0, error: 0, fatal: 0 };
  #totalReported = 0;
  #totalCoalesced = 0;

  constructor(options: R44IncidentSupervisorOptions = {}) {
    this.#historyCapacity = r44FiniteInteger(options.historyCapacity ?? 512, "historyCapacity", 1, 100_000);
    this.#activeCapacity = r44FiniteInteger(options.activeCapacity ?? 256, "activeCapacity", 1, 100_000);
    this.#coalesceWindowTicks = r44FiniteInteger(options.coalesceWindowTicks ?? 120, "coalesceWindowTicks", 0, 10_000_000);
  }

  report(input: R44IncidentInput): R44Incident {
    const tick = r44FiniteInteger(input.tick, "tick", 0);
    const subsystem = r44NormalizeId(input.subsystem, "subsystem", 96);
    const code = r44NormalizeLabel(input.code, 96);
    const message = input.message.trim().slice(0, 1024);
    if (message.length === 0) throw new R44BoundaryError("incident-message", "Incident message must not be empty");
    const details = Object.freeze({ ...(input.details ?? {}) });
    const key = input.fingerprint ?? r44Fingerprint({
      subsystem, code, message, severity: input.severity,
    } as unknown as R44JsonValue).fingerprint;
    const existing = this.#active.get(key);
    if (existing !== undefined && tick - existing.lastTick <= this.#coalesceWindowTicks) {
      const updated = Object.freeze({
        ...existing,
        lastTick: tick,
        occurrences: existing.occurrences + 1,
        severity: severityMax(existing.severity, input.severity),
        details,
      });
      this.#active.set(key, updated);
      this.#totalCoalesced += 1;
      this.#severityCounts[input.severity] += 1;
      this.#appendHistory(updated);
      return updated;
    }
    if (this.#active.size >= this.#activeCapacity) this.#evictOldestActive();
    const incident: R44Incident = Object.freeze({
      id: "inc-" + this.#totalReported.toString(36) + "-" + key.slice(-8),
      key,
      subsystem,
      code,
      message,
      severity: input.severity,
      firstTick: tick,
      lastTick: tick,
      occurrences: 1,
      recoverable: input.recoverable ?? input.severity !== "fatal",
      details,
    });
    this.#active.set(key, incident);
    this.#totalReported += 1;
    this.#severityCounts[input.severity] += 1;
    this.#appendHistory(incident);
    return incident;
  }

  resolve(keyInput: string): boolean {
    const key = r44NormalizeId(keyInput, "incident key", 256);
    return this.#active.delete(key);
  }

  resolveBySubsystem(subsystemInput: string): number {
    const subsystem = r44NormalizeId(subsystemInput, "subsystem", 96);
    let resolved = 0;
    for (const [key, incident] of this.#active) {
      if (incident.subsystem === subsystem) {
        this.#active.delete(key);
        resolved += 1;
      }
    }
    return resolved;
  }

  activeFor(subsystemInput: string): readonly R44Incident[] {
    const subsystem = r44NormalizeId(subsystemInput, "subsystem", 96);
    return Object.freeze([...this.#active.values()].filter((incident) => incident.subsystem === subsystem));
  }

  snapshot(): R44IncidentSnapshot {
    return Object.freeze({
      active: Object.freeze([...this.#active.values()]),
      recent: Object.freeze([...this.#history]),
      totalReported: this.#totalReported,
      totalCoalesced: this.#totalCoalesced,
      severityCounts: Object.freeze({ ...this.#severityCounts }),
    });
  }

  assertNoFatal(): void {
    const fatal = [...this.#active.values()].filter((incident) => incident.severity === "fatal");
    if (fatal.length > 0) {
      throw new R44InvariantError("fatal-incidents-active", "Fatal runtime incidents remain active", {
        count: fatal.length,
        ids: fatal.map((item) => item.id),
      });
    }
  }

  #appendHistory(incident: R44Incident): void {
    this.#history.push(incident);
    if (this.#history.length > this.#historyCapacity) this.#history.shift();
  }

  #evictOldestActive(): void {
    let keyToRemove: string | null = null;
    let oldestTick = Number.MAX_SAFE_INTEGER;
    for (const [key, incident] of this.#active) {
      if (incident.severity === "fatal") continue;
      if (incident.firstTick < oldestTick) {
        oldestTick = incident.firstTick;
        keyToRemove = key;
      }
    }
    if (keyToRemove === null) {
      throw new R44InvariantError("incident-capacity-fatal", "Incident capacity reached with fatal incidents only");
    }
    this.#active.delete(keyToRemove);
  }
}

function severityMax(left: R44Severity, right: R44Severity): R44Severity {
  const rank: Record<R44Severity, number> = { info: 0, warning: 1, error: 2, fatal: 3 };
  return rank[left] >= rank[right] ? left : right;
}

export function r44IncidentFromError(
  subsystem: string,
  error: unknown,
  tick: number,
  severity: R44Severity = "error",
): R44IncidentInput {
  const failure: R44Failure = r44ToFailure(error);
  return Object.freeze({
    subsystem,
    code: failure.code,
    message: failure.message,
    severity,
    tick,
    recoverable: failure.retryable,
  });
}
