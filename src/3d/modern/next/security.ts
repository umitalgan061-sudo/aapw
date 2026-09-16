import { clamp } from './math.ts';

export interface SecurityLimits {
  readonly maxStringLength: number;
  readonly maxArrayLength: number;
  readonly maxObjectDepth: number;
  readonly maxPayloadBytes: number;
  readonly maxCommandsPerSecond: number;
  readonly maxDeltaEntities: number;
}

export const DEFAULT_SECURITY_LIMITS: SecurityLimits = {
  maxStringLength: 4096,
  maxArrayLength: 2048,
  maxObjectDepth: 12,
  maxPayloadBytes: 256 * 1024,
  maxCommandsPerSecond: 120,
  maxDeltaEntities: 4096,
};

export interface ValidationResult { readonly ok: boolean; readonly reason?: string; readonly normalized?: unknown; }

export function sanitizeText(value: unknown, maxLength = DEFAULT_SECURITY_LIMITS.maxStringLength): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, Math.max(0, maxLength));
}

export function isSafeIdentifier(value: unknown, maxLength = 128): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && /^[a-zA-Z0-9._:-]+$/.test(value);
}

export function validatePayload(value: unknown, limits: SecurityLimits = DEFAULT_SECURITY_LIMITS): ValidationResult {
  const seen = new WeakSet<object>();
  const walk = (input: unknown, depth: number): boolean => {
    if (depth > limits.maxObjectDepth) return false;
    if (typeof input === 'string') return input.length <= limits.maxStringLength;
    if (typeof input !== 'object' || input === null) return true;
    if (seen.has(input)) return false;
    seen.add(input);
    if (Array.isArray(input)) return input.length <= limits.maxArrayLength && input.every((entry) => walk(entry, depth + 1));
    const keys = Object.keys(input);
    if (keys.length > limits.maxArrayLength) return false;
    return keys.every((key) => key.length <= 256 && walk((input as Record<string, unknown>)[key], depth + 1));
  };
  try {
    if (!walk(value, 0)) return { ok: false, reason: 'payload structure exceeds limits' };
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (bytes > limits.maxPayloadBytes) return { ok: false, reason: 'payload byte budget exceeded' };
    return { ok: true, normalized: value };
  } catch {
    return { ok: false, reason: 'payload is not safely serializable' };
  }
}

export class RateLimiter {
  readonly limit: number;
  readonly windowMs: number;
  #buckets = new Map<string, { startedAt: number; count: number }>();
  constructor(limit = DEFAULT_SECURITY_LIMITS.maxCommandsPerSecond, windowMs = 1000) {
    this.limit = Math.max(1, Math.floor(limit));
    this.windowMs = Math.max(1, windowMs);
  }
  allow(key: string, nowMs: number): boolean {
    const id = sanitizeText(key, 128) || 'anonymous';
    const now = Math.max(0, nowMs);
    const current = this.#buckets.get(id);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.#buckets.set(id, { startedAt: now, count: 1 });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }
  reset(key?: string): void { if (key === undefined) this.#buckets.clear(); else this.#buckets.delete(key); }
}

export interface SnapshotSecurityPolicy {
  readonly maxAgeTicks: number;
  readonly maxFutureTicks: number;
  readonly maxEntities: number;
}

export function validateSnapshotBounds(snapshot: { tick: number; entities: readonly unknown[] }, currentTick: number, policy: SnapshotSecurityPolicy): ValidationResult {
  const age = currentTick - snapshot.tick;
  if (age > policy.maxAgeTicks) return { ok: false, reason: 'snapshot is stale' };
  if (-age > policy.maxFutureTicks) return { ok: false, reason: 'snapshot is from the future' };
  if (snapshot.entities.length > policy.maxEntities) return { ok: false, reason: 'snapshot entity limit exceeded' };
  return { ok: true };
}

export function sanitizeNumber(value: unknown, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return clamp(number, min, max);
}
