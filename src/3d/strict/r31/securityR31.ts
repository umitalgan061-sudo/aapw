import { clampR31 } from './applicationTypesR31.ts';

export interface SecurityPolicyR31 {
  readonly maxStringLength: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxPayloadBytes: number;
  readonly commandBurst: number;
  readonly commandWindowMs: number;
}

export interface SecurityDecisionR31 {
  readonly allowed: boolean;
  readonly reason: string;
  readonly normalized?: unknown;
}

export const DEFAULT_SECURITY_POLICY_R31: SecurityPolicyR31 = Object.freeze({
  maxStringLength: 512,
  maxArrayLength: 256,
  maxObjectKeys: 128,
  maxPayloadBytes: 64 * 1024,
  commandBurst: 24,
  commandWindowMs: 1000,
});

export class RateLimiterR31 {
  #windowStartedAt = 0;
  #count = 0;
  readonly #burst: number;
  readonly #windowMs: number;

  constructor(burst: number, windowMs: number) {
    this.#burst = Math.max(1, Math.floor(burst));
    this.#windowMs = Math.max(1, Math.floor(windowMs));
  }

  allow(nowMs: number): boolean {
    if (nowMs - this.#windowStartedAt >= this.#windowMs || nowMs < this.#windowStartedAt) {
      this.#windowStartedAt = nowMs;
      this.#count = 0;
    }
    if (this.#count >= this.#burst) return false;
    this.#count++;
    return true;
  }

  remaining(nowMs: number): number {
    if (nowMs - this.#windowStartedAt >= this.#windowMs) return this.#burst;
    return Math.max(0, this.#burst - this.#count);
  }
}

export function sanitizeR31(value: unknown, policy: SecurityPolicyR31 = DEFAULT_SECURITY_POLICY_R31, depth = 0): unknown {
  if (depth > 8) throw new Error('security-depth-exceeded');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
  }
  if (typeof value === 'string') return value.length <= policy.maxStringLength ? value : value.slice(0, policy.maxStringLength);
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return null;
  if (Array.isArray(value)) {
    return value.slice(0, policy.maxArrayLength).map((entry) => sanitizeR31(entry, policy, depth + 1));
  }
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).sort().slice(0, policy.maxObjectKeys);
  const result: Record<string, unknown> = {};
  for (const key of keys) result[key] = sanitizeR31(source[key], policy, depth + 1);
  return result;
}

export function estimatePayloadBytesR31(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function validatePayloadR31(value: unknown, policy: SecurityPolicyR31 = DEFAULT_SECURITY_POLICY_R31): SecurityDecisionR31 {
  try {
    const normalized = sanitizeR31(value, policy);
    const bytes = estimatePayloadBytesR31(normalized);
    if (bytes > policy.maxPayloadBytes) return Object.freeze({ allowed: false, reason: 'payload-too-large' });
    return Object.freeze({ allowed: true, reason: 'ok', normalized });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'payload-invalid';
    return Object.freeze({ allowed: false, reason });
  }
}

export function scoreSecurityPressureR31(remaining: number, burst: number): number {
  return clampR31(1 - remaining / Math.max(1, burst), 0, 1);
}
