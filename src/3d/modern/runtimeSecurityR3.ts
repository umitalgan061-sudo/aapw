import type { PortResult, SecurityPort } from './portsR3.ts';

export interface SecurityPolicyR3 {
  readonly maxIdLength: number;
  readonly maxTextLength: number;
  readonly maxPayloadBytes: number;
  readonly refillPerSecond: number;
  readonly burst: number;
  readonly maxRateKeys: number;
}

interface Bucket {
  tokens: number;
  lastMs: number;
}

const DEFAULT_POLICY: SecurityPolicyR3 = {
  maxIdLength: 96,
  maxTextLength: 4096,
  maxPayloadBytes: 2 * 1024 * 1024,
  refillPerSecond: 30,
  burst: 60,
  maxRateKeys: 4096,
};

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export class RuntimeSecurityR3 implements SecurityPort {
  readonly #policy: SecurityPolicyR3;
  readonly #buckets = new Map<string, Bucket>();
  #rejectedPayloads = 0;
  #rejectedText = 0;
  #rejectedIds = 0;

  constructor(policy: Partial<SecurityPolicyR3> = {}) {
    this.#policy = {
      ...DEFAULT_POLICY,
      ...policy,
      maxIdLength: Math.max(8, Math.floor(policy.maxIdLength ?? DEFAULT_POLICY.maxIdLength)),
      maxTextLength: Math.max(32, Math.floor(policy.maxTextLength ?? DEFAULT_POLICY.maxTextLength)),
      maxPayloadBytes: Math.max(256, Math.floor(policy.maxPayloadBytes ?? DEFAULT_POLICY.maxPayloadBytes)),
      refillPerSecond: Math.max(1, policy.refillPerSecond ?? DEFAULT_POLICY.refillPerSecond),
      burst: Math.max(1, Math.floor(policy.burst ?? DEFAULT_POLICY.burst)),
      maxRateKeys: Math.max(16, Math.floor(policy.maxRateKeys ?? DEFAULT_POLICY.maxRateKeys)),
    };
  }

  sanitizeId(value: string): string {
    const normalized = value.normalize('NFKC').replace(CONTROL_CHARS, '').trim();
    const safe = normalized
      .replaceAll(/[^a-zA-Z0-9._:-]/g, '-')
      .replaceAll(/-{2,}/g, '-')
      .replace(/^-+/, '')
      .slice(0, this.#policy.maxIdLength);
    if (!safe) this.#rejectedIds += 1;
    return safe || 'anonymous';
  }

  validateText(value: string, maxLength: number): PortResult<string> {
    if (typeof value !== 'string') {
      this.#rejectedText += 1;
      return { ok: false, error: { code: 'SEC_TEXT_TYPE', message: 'Expected text input.', retryable: false } };
    }
    const limit = Math.min(this.#policy.maxTextLength, Math.max(1, Math.floor(maxLength)));
    const normalized = value.normalize('NFKC').replace(CONTROL_CHARS, '');
    if (normalized.length > limit) {
      this.#rejectedText += 1;
      return { ok: false, error: { code: 'SEC_TEXT_LENGTH', message: 'Text input exceeds configured limit.', retryable: false } };
    }
    return { ok: true, value: normalized };
  }

  validatePayload(bytes: Uint8Array, maxBytes: number): PortResult<void> {
    const limit = Math.min(this.#policy.maxPayloadBytes, Math.max(1, Math.floor(maxBytes)));
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > limit) {
      this.#rejectedPayloads += 1;
      return { ok: false, error: { code: 'SEC_PAYLOAD', message: 'Payload exceeds configured security boundary.', retryable: false } };
    }
    return { ok: true, value: undefined };
  }

  acceptRate(key: string, nowMs: number): boolean {
    const safeKey = this.sanitizeId(key).slice(0, 120);
    const now = Number.isFinite(nowMs) ? Math.max(0, nowMs) : 0;
    if (this.#buckets.size >= this.#policy.maxRateKeys && !this.#buckets.has(safeKey)) this.#evictOldest();
    const existing = this.#buckets.get(safeKey);
    const bucket = existing ?? { tokens: this.#policy.burst, lastMs: now };
    const elapsed = Math.max(0, now - bucket.lastMs) / 1000;
    bucket.tokens = Math.min(this.#policy.burst, bucket.tokens + elapsed * this.#policy.refillPerSecond);
    bucket.lastMs = now;
    if (bucket.tokens < 1) {
      this.#buckets.set(safeKey, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.#buckets.set(safeKey, bucket);
    return true;
  }

  stats(): { readonly activeKeys: number; readonly rejectedPayloads: number; readonly rejectedText: number; readonly rejectedIds: number } {
    return {
      activeKeys: this.#buckets.size,
      rejectedPayloads: this.#rejectedPayloads,
      rejectedText: this.#rejectedText,
      rejectedIds: this.#rejectedIds,
    };
  }

  #evictOldest(): void {
    let oldestKey: string | null = null;
    let oldest = Number.POSITIVE_INFINITY;
    for (const [key, bucket] of this.#buckets) {
      if (bucket.lastMs < oldest) {
        oldest = bucket.lastMs;
        oldestKey = key;
      }
    }
    if (oldestKey) this.#buckets.delete(oldestKey);
  }
}
