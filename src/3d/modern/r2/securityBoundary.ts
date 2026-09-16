export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

export interface BoundaryLimits {
  readonly maxStringLength: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxDepth: number;
  readonly maxPayloadBytes: number;
}

const DEFAULT_LIMITS: BoundaryLimits = {
  maxStringLength: 256,
  maxArrayLength: 256,
  maxObjectKeys: 256,
  maxDepth: 8,
  maxPayloadBytes: 256_000,
};

export function normalizeBoundaryLimits(partial: Partial<BoundaryLimits> = {}): BoundaryLimits {
  const value = { ...DEFAULT_LIMITS, ...partial };
  for (const [key, limit] of Object.entries(value)) {
    if (!Number.isInteger(limit) || limit <= 0) throw new RangeError(`${key} must be a positive integer`);
  }
  return Object.freeze(value);
}

function walk(value: unknown, limits: BoundaryLimits, depth: number, seen: WeakSet<object>, errors: string[], path: string): void {
  if (depth > limits.maxDepth) {
    errors.push(`${path}: maximum depth exceeded`);
    return;
  }
  if (typeof value === 'string') {
    if (value.length > limits.maxStringLength) errors.push(`${path}: string too long`);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  if (seen.has(value)) {
    errors.push(`${path}: cyclic object rejected`);
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayLength) errors.push(`${path}: array too long`);
    value.forEach((child, index) => walk(child, limits, depth + 1, seen, errors, `${path}[${index}]`));
  } else {
    const keys = Object.keys(value);
    if (keys.length > limits.maxObjectKeys) errors.push(`${path}: object has too many keys`);
    for (const key of keys) {
      if (key.length > limits.maxStringLength) errors.push(`${path}: key too long`);
      walk((value as Record<string, unknown>)[key], limits, depth + 1, seen, errors, `${path}.${key}`);
    }
  }
  seen.delete(value);
}

export function validatePayload(value: unknown, limits: Partial<BoundaryLimits> = {}): ValidationResult<unknown> {
  const normalized = normalizeBoundaryLimits(limits);
  const errors: string[] = [];
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) errors.push('payload is not JSON serializable');
    else if (new TextEncoder().encode(encoded).byteLength > normalized.maxPayloadBytes) errors.push('payload exceeds byte budget');
  } catch {
    errors.push('payload serialization failed');
  }
  try {
    walk(value, normalized, 0, new WeakSet(), errors, '$');
  } catch {
    errors.push('payload validation failed');
  }
  return errors.length === 0 ? { ok: true, value } : { ok: false, errors };
}

export function sanitizeIdentifier(value: string, maxLength = 64): ValidationResult<string> {
  if (typeof value !== 'string') return { ok: false, errors: ['identifier must be a string'] };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, errors: ['identifier must not be empty'] };
  if (trimmed.length > maxLength) return { ok: false, errors: ['identifier too long'] };
  if (!/^[A-Za-z0-9_.:-]+$/.test(trimmed)) return { ok: false, errors: ['identifier contains unsupported characters'] };
  return { ok: true, value: trimmed };
}

export function sanitizeUrl(value: string, allowedOrigins: readonly string[] = []): ValidationResult<string> {
  if (typeof value !== 'string' || value.length > 2048) return { ok: false, errors: ['invalid URL'] };
  if (value.startsWith('/')) return { ok: true, value };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, errors: ['malformed URL'] };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, errors: ['unsupported URL protocol'] };
  if (allowedOrigins.length > 0 && !allowedOrigins.includes(url.origin)) return { ok: false, errors: ['URL origin is not allowed'] };
  url.username = '';
  url.password = '';
  return { ok: true, value: url.toString() };
}

export interface RateLimitConfig {
  readonly capacity: number;
  readonly refillPerSecond: number;
  readonly maxClockJumpMs: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterMs: number;
}

export class TokenBucketLimiter {
  readonly #config: RateLimitConfig;
  #tokens: number;
  #lastMs = 0;

  public constructor(config: RateLimitConfig) {
    if (!Number.isInteger(config.capacity) || config.capacity <= 0) throw new RangeError('capacity must be positive integer');
    if (!Number.isFinite(config.refillPerSecond) || config.refillPerSecond <= 0) throw new RangeError('refillPerSecond must be positive');
    if (!Number.isFinite(config.maxClockJumpMs) || config.maxClockJumpMs < 0) throw new RangeError('maxClockJumpMs must be non-negative');
    this.#config = Object.freeze(config);
    this.#tokens = config.capacity;
  }

  public consume(cost = 1, nowMs = 0): RateLimitResult {
    if (!Number.isFinite(cost) || cost <= 0) throw new RangeError('cost must be positive');
    if (!Number.isFinite(nowMs) || nowMs < 0) throw new RangeError('nowMs must be non-negative');
    if (this.#lastMs === 0) this.#lastMs = nowMs;
    const elapsedMs = Math.max(0, Math.min(this.#config.maxClockJumpMs, nowMs - this.#lastMs));
    this.#lastMs = Math.max(this.#lastMs, nowMs);
    this.#tokens = Math.min(this.#config.capacity, this.#tokens + elapsedMs / 1000 * this.#config.refillPerSecond);
    if (this.#tokens >= cost) {
      this.#tokens -= cost;
      return { allowed: true, remaining: Math.floor(this.#tokens), retryAfterMs: 0 };
    }
    const missing = cost - this.#tokens;
    const retryAfterMs = Math.ceil((missing / this.#config.refillPerSecond) * 1000);
    return { allowed: false, remaining: Math.floor(this.#tokens), retryAfterMs };
  }

  public reset(): void {
    this.#tokens = this.#config.capacity;
    this.#lastMs = 0;
  }

  public remaining(): number {
    return Math.max(0, Math.floor(this.#tokens));
  }
}

export interface SequenceGuardResult {
  readonly accepted: boolean;
  readonly expected: number;
  readonly received: number;
}

export class SequenceGuard {
  #last = -1;

  public accept(sequence: number): SequenceGuardResult {
    if (!Number.isInteger(sequence) || sequence < 0) throw new RangeError('sequence must be non-negative integer');
    const expected = this.#last + 1;
    if (sequence !== expected) return { accepted: false, expected, received: sequence };
    this.#last = sequence;
    return { accepted: true, expected, received: sequence };
  }

  public reset(sequence = -1): void {
    if (!Number.isInteger(sequence) || sequence < -1) throw new RangeError('invalid sequence');
    this.#last = sequence;
  }

  public last(): number {
    return this.#last;
  }
}

export interface ReplayNonceStore {
  has(nonce: string): boolean;
  add(nonce: string): void;
  clear(): void;
}

export class BoundedNonceStore implements ReplayNonceStore {
  readonly #limit: number;
  readonly #nonces = new Map<string, number>();

  public constructor(limit = 2048) {
    if (!Number.isInteger(limit) || limit <= 0) throw new RangeError('limit must be positive integer');
    this.#limit = limit;
  }

  public has(nonce: string): boolean {
    return this.#nonces.has(nonce);
  }

  public add(nonce: string): void {
    if (!nonce.trim() || nonce.length > 128) throw new Error('invalid nonce');
    if (this.#nonces.has(nonce)) return;
    this.#nonces.set(nonce, this.#nonces.size);
    while (this.#nonces.size > this.#limit) {
      const first = this.#nonces.keys().next().value as string | undefined;
      if (first === undefined) break;
      this.#nonces.delete(first);
    }
  }

  public clear(): void {
    this.#nonces.clear();
  }
}

export interface CommandBoundary {
  readonly name: string;
  readonly maxPerSecond: number;
  readonly cost: number;
}

export class CommandSecurityGate {
  readonly #buckets = new Map<string, TokenBucketLimiter>();
  readonly #nonces: BoundedNonceStore;

  public constructor(nonceLimit = 2048) {
    this.#nonces = new BoundedNonceStore(nonceLimit);
  }

  public register(command: CommandBoundary): void {
    const name = sanitizeIdentifier(command.name, 64);
    if (!name.ok) throw new Error(name.errors.join(', '));
    if (!Number.isFinite(command.maxPerSecond) || command.maxPerSecond <= 0) throw new RangeError('maxPerSecond must be positive');
    if (!Number.isFinite(command.cost) || command.cost <= 0) throw new RangeError('cost must be positive');
    this.#buckets.set(name.value, new TokenBucketLimiter({ capacity: Math.max(1, Math.ceil(command.maxPerSecond)), refillPerSecond: command.maxPerSecond, maxClockJumpMs: 10_000 }));
  }

  public authorize(command: string, nonce: string, nowMs = 0): RateLimitResult {
    const name = sanitizeIdentifier(command, 64);
    if (!name.ok) return { allowed: false, remaining: 0, retryAfterMs: 0 };
    if (this.#nonces.has(nonce)) return { allowed: false, remaining: 0, retryAfterMs: 0 };
    const limiter = this.#buckets.get(name.value);
    if (!limiter) return { allowed: false, remaining: 0, retryAfterMs: 0 };
    const result = limiter.consume(1, nowMs);
    if (result.allowed) this.#nonces.add(nonce);
    return result;
  }

  public clear(): void {
    this.#nonces.clear();
    for (const bucket of this.#buckets.values()) bucket.reset();
  }
}

export interface SnapshotFreshness {
  readonly tick: number;
  readonly sequence: number;
  readonly maxAgeTicks: number;
}

export function validateSnapshotFreshness(snapshot: SnapshotFreshness, localTick: number, lastSequence: number): ValidationResult<SnapshotFreshness> {
  const errors: string[] = [];
  if (!Number.isInteger(snapshot.tick) || snapshot.tick < 0) errors.push('invalid snapshot tick');
  if (!Number.isInteger(snapshot.sequence) || snapshot.sequence < 0) errors.push('invalid snapshot sequence');
  if (!Number.isInteger(snapshot.maxAgeTicks) || snapshot.maxAgeTicks < 0) errors.push('invalid maxAgeTicks');
  if (!Number.isInteger(localTick) || localTick < 0) errors.push('invalid local tick');
  if (!Number.isInteger(lastSequence) || lastSequence < -1) errors.push('invalid last sequence');
  if (errors.length === 0) {
    if (snapshot.tick > localTick + 1) errors.push('snapshot is from the future');
    if (localTick - snapshot.tick > snapshot.maxAgeTicks) errors.push('snapshot is stale');
    if (snapshot.sequence <= lastSequence) errors.push('snapshot sequence is not monotonic');
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: snapshot };
}

export interface CapabilitySet {
  readonly values: ReadonlySet<string>;
}

export function hasCapability(capabilities: CapabilitySet, required: string): boolean {
  const sanitized = sanitizeIdentifier(required, 64);
  return sanitized.ok && capabilities.values.has(sanitized.value);
}

export function normalizeCapabilities(values: readonly string[]): CapabilitySet {
  const sanitized = new Set<string>();
  for (const value of values) {
    const result = sanitizeIdentifier(value, 64);
    if (result.ok) sanitized.add(result.value);
  }
  return Object.freeze({ values: sanitized });
}
