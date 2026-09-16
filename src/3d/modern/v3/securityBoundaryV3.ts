import { clampNumber } from './coreContracts';

export interface SecurityLimits {
  readonly maxStringLength: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxPayloadBytes: number;
  readonly maxCommandRate: number;
  readonly rateWindowMs: number;
}

export const DEFAULT_SECURITY_LIMITS: SecurityLimits = {
  maxStringLength: 512,
  maxArrayLength: 2048,
  maxObjectKeys: 256,
  maxPayloadBytes: 512 * 1024,
  maxCommandRate: 120,
  rateWindowMs: 1000,
};

export function sanitizeText(value: unknown, maxLength = DEFAULT_SECURITY_LIMITS.maxStringLength): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function sanitizeId(value: unknown, prefix = ''): string {
  const normalized = sanitizeText(value, 128).replace(/[^a-zA-Z0-9._:-]/g, '');
  if (!normalized) throw new Error('invalid identifier');
  if (prefix && !normalized.startsWith(prefix)) throw new Error('identifier prefix mismatch');
  return normalized;
}

export function validatePayloadSize(payload: unknown, limits: SecurityLimits = DEFAULT_SECURITY_LIMITS): void {
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (bytes > limits.maxPayloadBytes) throw new Error('payload exceeds configured size limit');
}

export function deepSanitize(value: unknown, limits: SecurityLimits = DEFAULT_SECURITY_LIMITS, depth = 0): unknown {
  if (depth > 12) throw new Error('payload nesting depth exceeded');
  if (typeof value === 'string') return sanitizeText(value, limits.maxStringLength);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayLength) throw new Error('payload array length exceeded');
    return value.map((item) => deepSanitize(item, limits, depth + 1));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > limits.maxObjectKeys) throw new Error('payload object key count exceeded');
    const result: Record<string, unknown> = {};
    for (const [key, entry] of entries.slice(0, limits.maxObjectKeys)) {
      const cleanKey = sanitizeText(key, 128).replace(/[^a-zA-Z0-9._:-]/g, '');
      if (!cleanKey) continue;
      result[cleanKey] = deepSanitize(entry, limits, depth + 1);
    }
    return result;
  }
  return null;
}

export class SlidingWindowRateLimiter {
  #limit: number;
  #windowMs: number;
  #events = new Map<string, number[]>();

  constructor(limit = DEFAULT_SECURITY_LIMITS.maxCommandRate, windowMs = DEFAULT_SECURITY_LIMITS.rateWindowMs) {
    if (limit < 1 || windowMs < 1) throw new Error('invalid rate limiter configuration');
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  allow(key: string, nowMs: number): boolean {
    const now = Number.isFinite(nowMs) ? nowMs : 0;
    const values = this.#events.get(key) ?? [];
    const cutoff = now - this.#windowMs;
    const active = values.filter((timestamp) => timestamp > cutoff);
    if (active.length >= this.#limit) {
      this.#events.set(key, active);
      return false;
    }
    active.push(now);
    this.#events.set(key, active);
    return true;
  }

  remaining(key: string, nowMs: number): number {
    const now = Number.isFinite(nowMs) ? nowMs : 0;
    const cutoff = now - this.#windowMs;
    const active = (this.#events.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
    this.#events.set(key, active);
    return Math.max(0, this.#limit - active.length);
  }

  reset(key?: string): void {
    if (key === undefined) this.#events.clear();
    else this.#events.delete(key);
  }
}

export interface CommandGuardResult {
  readonly accepted: boolean;
  readonly reason?: 'payload-too-large' | 'rate-limited' | 'invalid-id' | 'invalid-value';
  readonly score: number;
}

export function guardCommand(options: {
  readonly actorId: unknown;
  readonly payload: unknown;
  readonly nowMs: number;
  readonly limiter: SlidingWindowRateLimiter;
  readonly limits?: SecurityLimits;
}): CommandGuardResult {
  const limits = options.limits ?? DEFAULT_SECURITY_LIMITS;
  let actorId: string;
  try {
    actorId = sanitizeId(options.actorId);
  } catch {
    return { accepted: false, reason: 'invalid-id', score: 0 };
  }
  try {
    validatePayloadSize(options.payload, limits);
    deepSanitize(options.payload, limits);
  } catch {
    return { accepted: false, reason: 'payload-too-large', score: 0 };
  }
  if (!options.limiter.allow(actorId, options.nowMs)) return { accepted: false, reason: 'rate-limited', score: 0.2 };
  const remaining = options.limiter.remaining(actorId, options.nowMs);
  return { accepted: true, score: clampNumber(remaining / limits.maxCommandRate, 0, 1) };
}

export function validateMonotonicTick(previous: number, next: number, maxJump = 8): boolean {
  if (!Number.isInteger(previous) || !Number.isInteger(next)) return false;
  return next >= previous && next - previous <= maxJump;
}

export function validateSequence(previous: number, next: number): boolean {
  if (!Number.isInteger(previous) || !Number.isInteger(next)) return false;
  if (next === previous) return true;
  return next > previous;
}

export function validateUrl(value: unknown, allowedProtocols: readonly string[] = ['https:']): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return allowedProtocols.includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}
