import { clamp, stableStringify, type Result, type RuntimeCommand, type RuntimeError } from './contracts.ts';

export interface SecurityPolicy {
  readonly maxPayloadBytes: number;
  readonly maxStringLength: number;
  readonly maxCommandsPerWindow: number;
  readonly windowSeconds: number;
  readonly maxTextLength: number;
}

export class TokenBucket {
  readonly capacity: number;
  readonly refillPerSecond: number;
  #tokens: number;
  #lastSeconds: number;

  constructor(capacity: number, refillPerSecond: number, nowSeconds = 0) {
    this.capacity = Math.max(1, Math.trunc(capacity));
    this.refillPerSecond = Math.max(0, refillPerSecond);
    this.#tokens = this.capacity;
    this.#lastSeconds = nowSeconds;
  }

  consume(cost = 1, nowSeconds = 0): boolean {
    const safeNow = Math.max(this.#lastSeconds, Number.isFinite(nowSeconds) ? nowSeconds : this.#lastSeconds);
    const elapsed = safeNow - this.#lastSeconds;
    this.#tokens = Math.min(this.capacity, this.#tokens + elapsed * this.refillPerSecond);
    this.#lastSeconds = safeNow;
    if (cost > this.#tokens) return false;
    this.#tokens -= Math.max(0, cost);
    return true;
  }

  remaining(nowSeconds = 0): number {
    this.consume(0, nowSeconds);
    return Number(this.#tokens.toFixed(3));
  }
}

export function createDefaultSecurityPolicy(): SecurityPolicy {
  return Object.freeze({
    maxPayloadBytes: 128 * 1024,
    maxStringLength: 256,
    maxCommandsPerWindow: 120,
    windowSeconds: 1,
    maxTextLength: 512,
  });
}

export class TextSanitizer {
  readonly maxLength: number;

  constructor(maxLength = 512) {
    this.maxLength = Math.max(1, Math.trunc(maxLength));
  }

  clean(input: unknown): string {
    const raw = typeof input === 'string' ? input : String(input ?? '');
    const normalized = raw.normalize('NFKC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    return normalized.slice(0, this.maxLength).trim();
  }
}

export class CommandSecurityGate {
  readonly policy: SecurityPolicy;
  readonly sanitizer: TextSanitizer;
  readonly bucket: TokenBucket;

  constructor(policy: SecurityPolicy = createDefaultSecurityPolicy()) {
    this.policy = policy;
    this.sanitizer = new TextSanitizer(policy.maxTextLength);
    this.bucket = new TokenBucket(policy.maxCommandsPerWindow, policy.maxCommandsPerWindow / policy.windowSeconds);
  }

  validatePayload(value: unknown): Result<true> {
    try {
      const json = stableStringify(value);
      const bytes = new TextEncoder().encode(json).byteLength;
      if (bytes > this.policy.maxPayloadBytes) {
        return { ok: false, error: this.#error('SECURITY_PAYLOAD_LIMIT', 'Payload exceeds security size budget.', false) };
      }
      return { ok: true, value: true };
    } catch (cause) {
      return { ok: false, error: this.#error('SECURITY_PAYLOAD_INVALID', String(cause), false, cause) };
    }
  }

  validateCommand(command: RuntimeCommand, nowSeconds: number): Result<RuntimeCommand> {
    if (!this.bucket.consume(1, nowSeconds)) {
      return { ok: false, error: this.#error('SECURITY_RATE_LIMIT', 'Command rate limit exceeded.', true) };
    }
    if (command.type === 'custom') {
      const name = this.sanitizer.clean(command.name);
      if (!name || name.length > this.policy.maxStringLength) {
        return { ok: false, error: this.#error('SECURITY_COMMAND_NAME', 'Command name is invalid.', false) };
      }
      const payload = this.validatePayload(command.payload);
      if (!payload.ok) return payload;
      return { ok: true, value: Object.freeze({ ...command, name, payload: command.payload }) };
    }
    if (command.type === 'pause') {
      return {
        ok: true,
        value: Object.freeze({ ...command, reason: this.sanitizer.clean(command.reason).slice(0, this.policy.maxStringLength) }),
      };
    }
    return { ok: true, value: command };
  }

  #error(code: string, message: string, retryable: boolean, cause?: unknown): RuntimeError {
    return { code, message, retryable, cause };
  }
}

export class SnapshotAgeGuard {
  readonly maxAgeMs: number;

  constructor(maxAgeMs = 2500) {
    this.maxAgeMs = Math.max(100, Math.trunc(maxAgeMs));
  }

  accept(sentAtMs: number, nowMs: number): boolean {
    const age = nowMs - sentAtMs;
    return Number.isFinite(age) && age >= -250 && age <= this.maxAgeMs;
  }
}

export function sanitizeId(value: unknown, maxLength = 96): string {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._:-]/g, '')
    .slice(0, Math.max(1, Math.trunc(maxLength)));
}

export function sanitizeColor(value: unknown): string {
  const text = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : '#ffffff';
}
