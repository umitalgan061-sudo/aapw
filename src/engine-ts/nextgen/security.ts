import { clamp, stableJson, hashString } from './contracts.ts';

export interface SecurityPolicy {
  readonly maxStringLength: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxPayloadBytes: number;
  readonly maxCommandsPerTick: number;
  readonly maxSnapshotAgeTicks: number;
}

export const DEFAULT_SECURITY_POLICY: SecurityPolicy = Object.freeze({ maxStringLength: 256, maxArrayLength: 1024, maxObjectKeys: 256, maxPayloadBytes: 128 * 1024, maxCommandsPerTick: 128, maxSnapshotAgeTicks: 20 });

export interface ValidationResult { readonly accepted: boolean; readonly reason: string | null; readonly bytes: number; readonly depth: number }

const utf8Bytes = (value: unknown): number => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value) ?? '').byteLength;

export const validateJsonValue = (value: unknown, policy: SecurityPolicy = DEFAULT_SECURITY_POLICY, depth = 0): ValidationResult => {
  if (depth > 32) return Object.freeze({ accepted: false, reason: 'max-depth', bytes: 0, depth });
  if (typeof value === 'string') { const bytes = utf8Bytes(value); return Object.freeze({ accepted: value.length <= policy.maxStringLength && bytes <= policy.maxPayloadBytes, reason: value.length > policy.maxStringLength ? 'string-too-long' : bytes > policy.maxPayloadBytes ? 'payload-too-large' : null, bytes, depth }); }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') { const bytes = utf8Bytes(value); return Object.freeze({ accepted: Number.isFinite(value as number) || typeof value !== 'number', reason: Number.isFinite(value as number) || typeof value !== 'number' ? null : 'non-finite-number', bytes, depth }); }
  if (Array.isArray(value)) {
    if (value.length > policy.maxArrayLength) return Object.freeze({ accepted: false, reason: 'array-too-long', bytes: 0, depth });
    let bytes = 2;
    for (const item of value) { const result = validateJsonValue(item, policy, depth + 1); if (!result.accepted) return result; bytes += result.bytes + 1; if (bytes > policy.maxPayloadBytes) return Object.freeze({ accepted: false, reason: 'payload-too-large', bytes, depth }); }
    return Object.freeze({ accepted: true, reason: null, bytes, depth });
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > policy.maxObjectKeys) return Object.freeze({ accepted: false, reason: 'object-too-wide', bytes: 0, depth });
    let bytes = 2;
    for (const [key, item] of entries) { if (key.length > policy.maxStringLength) return Object.freeze({ accepted: false, reason: 'key-too-long', bytes, depth }); const result = validateJsonValue(item, policy, depth + 1); if (!result.accepted) return result; bytes += key.length + result.bytes + 3; if (bytes > policy.maxPayloadBytes) return Object.freeze({ accepted: false, reason: 'payload-too-large', bytes, depth }); }
    return Object.freeze({ accepted: true, reason: null, bytes, depth });
  }
  return Object.freeze({ accepted: false, reason: 'unsupported-type', bytes: 0, depth });
};

export class TokenBucket {
  readonly #capacity: number;
  readonly #refillPerSecond: number;
  #tokens: number;
  #lastMs: number;
  constructor(capacity: number, refillPerSecond: number, nowMs = 0) { this.#capacity = Math.max(1, capacity); this.#refillPerSecond = Math.max(0, refillPerSecond); this.#tokens = this.#capacity; this.#lastMs = nowMs; }
  consume(amount = 1, nowMs = this.#lastMs): boolean { this.#refill(nowMs); const cost = Math.max(0, amount); if (this.#tokens < cost) return false; this.#tokens -= cost; return true; }
  private #refill(nowMs: number): void { const delta = Math.max(0, nowMs - this.#lastMs); this.#tokens = Math.min(this.#capacity, this.#tokens + delta / 1000 * this.#refillPerSecond); this.#lastMs = nowMs; }
  remaining(nowMs = this.#lastMs): number { this.#refill(nowMs); return this.#tokens; }
}

export class CommandGuard {
  readonly #policy: SecurityPolicy;
  readonly #buckets = new Map<string, TokenBucket>();
  #tick = -1;
  #commands = new Map<string, number>();
  constructor(policy: SecurityPolicy = DEFAULT_SECURITY_POLICY) { this.#policy = policy; }
  beginTick(tick: number): void { if (tick !== this.#tick) { this.#tick = tick; this.#commands.clear(); } }
  allow(actor: string, payload: unknown, nowMs = 0): ValidationResult {
    const validation = validateJsonValue(payload, this.#policy);
    if (!validation.accepted) return validation;
    const bucket = this.#buckets.get(actor) ?? new TokenBucket(this.#policy.maxCommandsPerTick, this.#policy.maxCommandsPerTick);
    this.#buckets.set(actor, bucket);
    const count = this.#commands.get(actor) ?? 0;
    if (count >= this.#policy.maxCommandsPerTick || !bucket.consume(1, nowMs)) return Object.freeze({ accepted: false, reason: 'rate-limit', bytes: validation.bytes, depth: validation.depth });
    this.#commands.set(actor, count + 1);
    return validation;
  }
}

export const sanitizeIdentifier = (value: string, maxLength = 64): string => value.normalize('NFKC').replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, maxLength);
export const signedDigest = (value: unknown, secret: string): string => hashString(`${secret}|${stableJson(value)}`);
export const snapshotAgeValid = (currentTick: number, snapshotTick: number, maxAge = DEFAULT_SECURITY_POLICY.maxSnapshotAgeTicks): boolean => currentTick >= snapshotTick && currentTick - snapshotTick <= clamp(maxAge, 0, 10_000);
