/**
 * V6 security and observability boundary.
 * Sanitizes untrusted runtime messages and emits bounded structured events.
 */

export type SecurityDecision = 'allow' | 'deny' | 'quarantine';
export type Severity = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type TelemetryKind = 'metric' | 'span' | 'event' | 'security' | 'performance';

export interface SecurityPolicy {
  readonly maxStringLength: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxPayloadBytes: number;
  readonly allowedProtocols: readonly string[];
  readonly maxRatePerTick: number;
}

export interface SecurityReceipt {
  readonly decision: SecurityDecision;
  readonly reason: string;
  readonly fingerprint: string;
}

export interface RuntimeEvent {
  readonly tick: number;
  readonly sequence: number;
  readonly kind: TelemetryKind;
  readonly severity: Severity;
  readonly name: string;
  readonly fields: Readonly<Record<string, string | number | boolean>>;
}

export interface MetricSummary {
  readonly name: string;
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly average: number;
  readonly p95: number;
}

const DEFAULT_POLICY: SecurityPolicy = {
  maxStringLength: 512,
  maxArrayLength: 64,
  maxObjectKeys: 64,
  maxPayloadBytes: 64 * 1024,
  allowedProtocols: ['https:', 'http:'],
  maxRatePerTick: 32,
};

function safeString(value: unknown, limit: number): string {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, limit);
}

function stableFingerprint(value: unknown): string {
  const json = stable(value);
  let hash = 2166136261;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stable(value: unknown, depth = 0): string {
  if (depth > 8) return '"[depth]"';
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.slice(0, 64).map((item) => stable(item, depth + 1)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort().slice(0, 64);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stable(record[key], depth + 1)}`).join(',')}}`;
  }
  return 'null';
}

export function sanitizeIdentifier(value: unknown, max = 128): string {
  return safeString(value, max).replace(/[^a-zA-Z0-9._:/-]/g, '_');
}

export function sanitizeUrl(value: unknown, policy: SecurityPolicy = DEFAULT_POLICY): string | undefined {
  const raw = safeString(value, 2048);
  try {
    const url = new URL(raw, 'https://invalid.local');
    if (url.origin === 'https://invalid.local' && !/^[a-z]+:/.test(raw)) return undefined;
    if (!policy.allowedProtocols.includes(url.protocol)) return undefined;
    if (url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function validatePayload(payload: unknown, policy: SecurityPolicy = DEFAULT_POLICY): SecurityReceipt {
  const fingerprint = stableFingerprint(payload);
  const bytes = stable(payload).length;
  if (bytes > policy.maxPayloadBytes) return { decision: 'deny', reason: 'payload-too-large', fingerprint };
  const visit = (value: unknown, depth: number): SecurityDecision => {
    if (depth > 8) return 'quarantine';
    if (typeof value === 'string') return value.length > policy.maxStringLength ? 'deny' : 'allow';
    if (Array.isArray(value)) {
      if (value.length > policy.maxArrayLength) return 'deny';
      for (const item of value) if (visit(item, depth + 1) === 'deny') return 'deny';
      return 'allow';
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > policy.maxObjectKeys) return 'deny';
      for (const [key, item] of entries) {
        if (key.length > 128 || /__proto__|constructor|prototype/i.test(key)) return 'deny';
        if (visit(item, depth + 1) === 'deny') return 'deny';
      }
      return 'allow';
    }
    return 'allow';
  };
  const decision = visit(payload, 0);
  return { decision, reason: decision === 'allow' ? 'ok' : 'nested-limit', fingerprint };
}

export class TickRateLimiter {
  readonly #maxPerTick: number;
  readonly #counts = new Map<string, number>();
  #tick = -1;

  constructor(maxPerTick = DEFAULT_POLICY.maxRatePerTick) { this.#maxPerTick = Math.max(1, Math.floor(maxPerTick)); }

  allow(key: string, tick: number): boolean {
    if (tick !== this.#tick) { this.#tick = tick; this.#counts.clear(); }
    const count = (this.#counts.get(key) ?? 0) + 1;
    this.#counts.set(key, count);
    return count <= this.#maxPerTick;
  }

  reset(): void { this.#counts.clear(); this.#tick = -1; }
}

interface MetricSeries { readonly values: number[]; readonly capacity: number; }

export class MetricsRegistry {
  readonly #series = new Map<string, MetricSeries>();
  readonly #capacity: number;

  constructor(capacity = 240) { this.#capacity = Math.max(16, Math.floor(capacity)); }

  observe(name: string, value: number): void {
    const cleanName = sanitizeIdentifier(name);
    const series = this.#series.get(cleanName) ?? { values: [], capacity: this.#capacity };
    series.values.push(Number.isFinite(value) ? value : 0);
    while (series.values.length > series.capacity) series.values.shift();
    this.#series.set(cleanName, series);
  }

  counter(name: string, amount = 1): void { this.observe(name, amount); }

  summarize(name: string): MetricSummary | undefined {
    const series = this.#series.get(sanitizeIdentifier(name));
    if (!series || series.values.length === 0) return undefined;
    const sorted = [...series.values].sort((a, b) => a - b);
    return {
      name: sanitizeIdentifier(name),
      count: sorted.length,
      min: sorted[0]!,
      max: sorted[sorted.length - 1]!,
      average: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
      p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!,
    };
  }

  summaries(): readonly MetricSummary[] {
    return [...this.#series.keys()].sort().map((name) => this.summarize(name)!).filter(Boolean);
  }

  reset(name?: string): void {
    if (name) this.#series.delete(sanitizeIdentifier(name)); else this.#series.clear();
  }
}

export class TelemetryBuffer {
  readonly #capacity: number;
  readonly #events: RuntimeEvent[] = [];
  #sequence = 0;

  constructor(capacity = 512) { this.#capacity = Math.max(32, Math.floor(capacity)); }

  emit(input: Omit<RuntimeEvent, 'sequence'>): RuntimeEvent {
    const event: RuntimeEvent = Object.freeze({
      ...input,
      sequence: ++this.#sequence,
      tick: Math.max(0, Math.floor(input.tick)),
      name: sanitizeIdentifier(input.name),
      fields: Object.fromEntries(Object.entries(input.fields).slice(0, 32).map(([key, value]) => [sanitizeIdentifier(key), typeof value === 'string' ? safeString(value, 256) : value])),
    });
    this.#events.push(event);
    while (this.#events.length > this.#capacity) this.#events.shift();
    return event;
  }

  values(): readonly RuntimeEvent[] { return this.#events; }
  since(sequence: number): readonly RuntimeEvent[] { return this.#events.filter((event) => event.sequence > sequence); }
  clear(): void { this.#events.length = 0; }
}

export class RuntimeSecurityBoundary {
  readonly policy: SecurityPolicy;
  readonly limiter: TickRateLimiter;
  readonly metrics: MetricsRegistry;
  readonly telemetry: TelemetryBuffer;

  constructor(policy: Partial<SecurityPolicy> = {}) {
    this.policy = {
      ...DEFAULT_POLICY,
      ...policy,
      maxStringLength: Math.max(32, Math.floor(policy.maxStringLength ?? DEFAULT_POLICY.maxStringLength)),
      maxArrayLength: Math.max(4, Math.floor(policy.maxArrayLength ?? DEFAULT_POLICY.maxArrayLength)),
      maxObjectKeys: Math.max(4, Math.floor(policy.maxObjectKeys ?? DEFAULT_POLICY.maxObjectKeys)),
      maxPayloadBytes: Math.max(1024, Math.floor(policy.maxPayloadBytes ?? DEFAULT_POLICY.maxPayloadBytes)),
      allowedProtocols: [...(policy.allowedProtocols ?? DEFAULT_POLICY.allowedProtocols)],
      maxRatePerTick: Math.max(1, Math.floor(policy.maxRatePerTick ?? DEFAULT_POLICY.maxRatePerTick)),
    };
    this.limiter = new TickRateLimiter(this.policy.maxRatePerTick);
    this.metrics = new MetricsRegistry();
    this.telemetry = new TelemetryBuffer();
  }

  guard(name: string, payload: unknown, tick: number): SecurityReceipt {
    const key = sanitizeIdentifier(name);
    if (!this.limiter.allow(key, tick)) {
      this.metrics.counter(`security.rate.${key}`);
      return { decision: 'deny', reason: 'rate-limit', fingerprint: stableFingerprint(payload) };
    }
    const receipt = validatePayload(payload, this.policy);
    if (receipt.decision !== 'allow') this.metrics.counter(`security.reject.${receipt.reason}`);
    this.telemetry.emit({ tick, kind: 'security', severity: receipt.decision === 'allow' ? 'debug' : 'warn', name: key, fields: { decision: receipt.decision, reason: receipt.reason, fingerprint: receipt.fingerprint } });
    return receipt;
  }
}
