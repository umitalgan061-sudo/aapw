import { clamp, compareNumbers, compareStrings, stableDigest, type CircuitState, type Severity } from "./contracts.ts";

export interface DiagnosticEvent {
  readonly sequence: number;
  readonly timeMs: number;
  readonly frame: number;
  readonly subsystem: string;
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly recoverable: boolean;
  readonly fingerprint: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

export interface DiagnosticPolicy {
  readonly capacity: number;
  readonly maxSubsystems: number;
  readonly maxMessageLength: number;
  readonly maxDetailKeys: number;
  readonly dedupeWindowMs: number;
}

export interface FaultSummary {
  readonly fingerprint: string;
  readonly count: number;
  readonly firstSeenMs: number;
  readonly lastSeenMs: number;
  readonly lastSeverity: Severity;
  readonly subsystem: string;
  readonly code: string;
  readonly recoverable: boolean;
}

const DEFAULT_DIAGNOSTIC_POLICY: DiagnosticPolicy = Object.freeze({
  capacity: 2048,
  maxSubsystems: 128,
  maxMessageLength: 512,
  maxDetailKeys: 16,
  dedupeWindowMs: 2000,
});

const SEVERITY_WEIGHT: Record<Severity, number> = {
  trace: 0,
  info: 1,
  warning: 2,
  error: 3,
  fatal: 4,
};

export class DiagnosticBuffer {
  readonly policy: DiagnosticPolicy;
  #events: DiagnosticEvent[] = [];
  #faults = new Map<string, FaultSummary>();
  #subsystems = new Set<string>();
  #sequence = 0;
  #dedupe = new Map<string, number>();

  constructor(policy: Partial<DiagnosticPolicy> = {}) {
    this.policy = Object.freeze({
      capacity: Math.max(16, Math.trunc(policy.capacity ?? DEFAULT_DIAGNOSTIC_POLICY.capacity)),
      maxSubsystems: Math.max(4, Math.trunc(policy.maxSubsystems ?? DEFAULT_DIAGNOSTIC_POLICY.maxSubsystems)),
      maxMessageLength: Math.max(32, Math.trunc(policy.maxMessageLength ?? DEFAULT_DIAGNOSTIC_POLICY.maxMessageLength)),
      maxDetailKeys: Math.max(0, Math.trunc(policy.maxDetailKeys ?? DEFAULT_DIAGNOSTIC_POLICY.maxDetailKeys)),
      dedupeWindowMs: Math.max(0, Math.trunc(policy.dedupeWindowMs ?? DEFAULT_DIAGNOSTIC_POLICY.dedupeWindowMs)),
    });
  }

  emit(input: Omit<DiagnosticEvent, "sequence" | "fingerprint" | "details"> & { readonly details?: Readonly<Record<string, unknown>> }): DiagnosticEvent | undefined {
    const subsystem = normalize(input.subsystem, 96);
    const code = normalize(input.code, 96);
    if (!subsystem || !code) return undefined;
    if (!this.#subsystems.has(subsystem) && this.#subsystems.size >= this.policy.maxSubsystems) return undefined;
    this.#subsystems.add(subsystem);
    const timeMs = Math.max(0, Number.isFinite(input.timeMs) ? input.timeMs : 0);
    const message = String(input.message ?? "").normalize("NFKC").slice(0, this.policy.maxMessageLength);
    const details = Object.create(null) as Record<string, string | number | boolean | null>;
    for (const key of Object.keys(input.details ?? {}).sort(compareStrings).slice(0, this.policy.maxDetailKeys)) {
      if (!/^[a-zA-Z0-9_.:-]{1,64}$/u.test(key)) continue;
      const value = input.details?.[key];
      if (typeof value === "string") details[key] = value.slice(0, 128);
      else if (typeof value === "number" && Number.isFinite(value)) details[key] = value;
      else if (typeof value === "boolean" || value === null) details[key] = value;
    }
    const fingerprint = stableDigest({ subsystem, code, severity: input.severity, message, details });
    const lastTime = this.#dedupe.get(fingerprint);
    if (lastTime !== undefined && timeMs - lastTime < this.policy.dedupeWindowMs) {
      this.#dedupe.set(fingerprint, timeMs);
      this.#aggregate(fingerprint, input, subsystem, code, timeMs);
      return undefined;
    }
    const event: DiagnosticEvent = Object.freeze({
      sequence: this.#sequence++,
      timeMs,
      frame: Math.max(0, Math.trunc(input.frame)),
      subsystem,
      code,
      severity: input.severity,
      message,
      recoverable: input.recoverable,
      fingerprint,
      details: Object.freeze(details),
    });
    this.#events.push(event);
    while (this.#events.length > this.policy.capacity) this.#events.shift();
    this.#dedupe.set(fingerprint, timeMs);
    this.#aggregate(fingerprint, input, subsystem, code, timeMs);
    this.#pruneDedupe(timeMs);
    return event;
  }

  recent(limit = 100, minSeverity: Severity = "trace"): readonly DiagnosticEvent[] {
    const threshold = SEVERITY_WEIGHT[minSeverity];
    return Object.freeze(this.#events.filter((event) => SEVERITY_WEIGHT[event.severity] >= threshold).slice(-Math.max(1, Math.trunc(limit))));
  }

  faults(limit = 100): readonly FaultSummary[] {
    return Object.freeze([...this.#faults.values()]
      .sort((a, b) => SEVERITY_WEIGHT[b.lastSeverity] - SEVERITY_WEIGHT[a.lastSeverity] || compareNumbers(b.count, a.count) || compareStrings(a.fingerprint, b.fingerprint))
      .slice(0, Math.max(1, Math.trunc(limit))));
  }

  countsBySeverity(): Readonly<Record<Severity, number>> {
    const counts: Record<Severity, number> = { trace: 0, info: 0, warning: 0, error: 0, fatal: 0 };
    for (const event of this.#events) counts[event.severity] += 1;
    return Object.freeze(counts);
  }

  clear(): void {
    this.#events = [];
    this.#faults.clear();
    this.#subsystems.clear();
    this.#dedupe.clear();
    this.#sequence = 0;
  }

  #aggregate(
    fingerprint: string,
    input: Omit<DiagnosticEvent, "sequence" | "fingerprint" | "details"> & { readonly details?: Readonly<Record<string, unknown>> },
    subsystem: string,
    code: string,
    timeMs: number,
  ): void {
    const existing = this.#faults.get(fingerprint);
    this.#faults.set(fingerprint, Object.freeze({
      fingerprint,
      count: (existing?.count ?? 0) + 1,
      firstSeenMs: existing?.firstSeenMs ?? timeMs,
      lastSeenMs: timeMs,
      lastSeverity: input.severity,
      subsystem,
      code,
      recoverable: input.recoverable,
    }));
  }

  #pruneDedupe(now: number): void {
    const keepAfter = now - Math.max(this.policy.dedupeWindowMs * 4, 10_000);
    for (const [fingerprint, time] of this.#dedupe) {
      if (time < keepAfter) this.#dedupe.delete(fingerprint);
    }
    while (this.#dedupe.size > this.policy.capacity * 2) {
      const oldest = [...this.#dedupe.entries()].sort((a, b) => compareNumbers(a[1], b[1]))[0];
      if (!oldest) break;
      this.#dedupe.delete(oldest[0]);
    }
  }
}

export interface CircuitBreakerPolicy {
  readonly failureThreshold: number;
  readonly successThreshold: number;
  readonly openDurationMs: number;
  readonly halfOpenMaxCalls: number;
}

export interface CircuitDecision {
  readonly allowed: boolean;
  readonly state: CircuitState;
  readonly retryAfterMs: number;
  readonly reason: string;
}

const DEFAULT_BREAKER_POLICY: CircuitBreakerPolicy = Object.freeze({
  failureThreshold: 5,
  successThreshold: 2,
  openDurationMs: 5000,
  halfOpenMaxCalls: 1,
});

/** Small circuit breaker used around optional systems (assets, worker, network). */
export class CircuitBreaker {
  readonly name: string;
  readonly policy: CircuitBreakerPolicy;
  #state: CircuitState = "closed";
  #failures = 0;
  #successes = 0;
  #openedAtMs = 0;
  #halfOpenCalls = 0;
  #lastReason = "";

  constructor(name: string, policy: Partial<CircuitBreakerPolicy> = {}) {
    this.name = normalize(name, 96) || "unnamed";
    this.policy = Object.freeze({
      failureThreshold: Math.max(1, Math.trunc(policy.failureThreshold ?? DEFAULT_BREAKER_POLICY.failureThreshold)),
      successThreshold: Math.max(1, Math.trunc(policy.successThreshold ?? DEFAULT_BREAKER_POLICY.successThreshold)),
      openDurationMs: Math.max(1, Math.trunc(policy.openDurationMs ?? DEFAULT_BREAKER_POLICY.openDurationMs)),
      halfOpenMaxCalls: Math.max(1, Math.trunc(policy.halfOpenMaxCalls ?? DEFAULT_BREAKER_POLICY.halfOpenMaxCalls)),
    });
  }

  get state(): CircuitState {
    return this.#state;
  }

  canExecute(nowMs: number): CircuitDecision {
    const now = Math.max(0, Number.isFinite(nowMs) ? nowMs : 0);
    if (this.#state === "open") {
      const elapsed = now - this.#openedAtMs;
      if (elapsed >= this.policy.openDurationMs) {
        this.#state = "half-open";
        this.#halfOpenCalls = 0;
        this.#successes = 0;
      } else {
        return Object.freeze({ allowed: false, state: "open", retryAfterMs: Math.max(0, this.policy.openDurationMs - elapsed), reason: this.#lastReason || "failure threshold reached" });
      }
    }
    if (this.#state === "half-open" && this.#halfOpenCalls >= this.policy.halfOpenMaxCalls) {
      return Object.freeze({ allowed: false, state: "half-open", retryAfterMs: 0, reason: "half-open probe already in flight" });
    }
    if (this.#state === "half-open") this.#halfOpenCalls += 1;
    return Object.freeze({ allowed: true, state: this.#state, retryAfterMs: 0, reason: this.#state === "half-open" ? "probe" : "closed" });
  }

  recordSuccess(): void {
    if (this.#state === "half-open") {
      this.#successes += 1;
      this.#halfOpenCalls = Math.max(0, this.#halfOpenCalls - 1);
      if (this.#successes >= this.policy.successThreshold) {
        this.#state = "closed";
        this.#failures = 0;
        this.#lastReason = "";
      }
    } else {
      this.#failures = Math.max(0, this.#failures - 1);
    }
  }

  recordFailure(nowMs: number, reason: string): void {
    const now = Math.max(0, Number.isFinite(nowMs) ? nowMs : 0);
    this.#failures += 1;
    this.#lastReason = String(reason ?? "failure").slice(0, 256);
    if (this.#state === "half-open" || this.#failures >= this.policy.failureThreshold) {
      this.#state = "open";
      this.#openedAtMs = now;
      this.#halfOpenCalls = 0;
      this.#successes = 0;
    }
  }

  reset(): void {
    this.#state = "closed";
    this.#failures = 0;
    this.#successes = 0;
    this.#openedAtMs = 0;
    this.#halfOpenCalls = 0;
    this.#lastReason = "";
  }

  snapshot(): Readonly<{ name: string; state: CircuitState; failures: number; successes: number; openedAtMs: number; lastReason: string }> {
    return Object.freeze({
      name: this.name,
      state: this.#state,
      failures: this.#failures,
      successes: this.#successes,
      openedAtMs: this.#openedAtMs,
      lastReason: this.#lastReason,
    });
  }
}

export interface HealthSignal {
  readonly key: string;
  readonly score: number;
  readonly weight: number;
  readonly detail?: string;
}

export interface HealthDecision {
  readonly score: number;
  readonly grade: "A" | "B" | "C" | "D" | "F";
  readonly status: "healthy" | "degraded" | "critical";
  readonly signals: readonly HealthSignal[];
  readonly recommendations: readonly string[];
}

export class RuntimeHealthGate {
  evaluate(signals: readonly HealthSignal[]): HealthDecision {
    const safe = signals
      .filter((signal) => Number.isFinite(signal.score) && Number.isFinite(signal.weight) && signal.weight > 0)
      .map((signal) => Object.freeze({
        key: normalize(signal.key, 96),
        score: clamp(signal.score, 0, 100),
        weight: clamp(signal.weight, 0, 1000),
        ...(signal.detail ? { detail: signal.detail.slice(0, 256) } : {}),
      }))
      .sort((a, b) => compareStrings(a.key, b.key));
    const totalWeight = safe.reduce((sum, signal) => sum + signal.weight, 0);
    const score = totalWeight > 0
      ? Math.round(safe.reduce((sum, signal) => sum + signal.score * signal.weight, 0) / totalWeight)
      : 100;
    const critical = safe.some((signal) => signal.score < 25);
    const status = critical || score < 50 ? "critical" : score < 80 ? "degraded" : "healthy";
    const grade = score >= 95 ? "A" : score >= 85 ? "B" : score >= 70 ? "C" : score >= 50 ? "D" : "F";
    const recommendations = safe
      .filter((signal) => signal.score < 80)
      .map((signal) => "inspect." + signal.key)
      .slice(0, 16);
    return Object.freeze({
      score,
      grade,
      status,
      signals: Object.freeze(safe),
      recommendations: Object.freeze([...new Set(recommendations)]),
    });
  }
}

function normalize(value: unknown, maxLength: number): string {
  return String(value ?? "").normalize("NFKC").trim().replace(/[^a-zA-Z0-9_.:-]/gu, "_").slice(0, maxLength);
}
