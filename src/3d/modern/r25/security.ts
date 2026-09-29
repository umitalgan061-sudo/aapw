import type {
  RuntimeSecurityPolicy,
  SecurityEnvelope,
  SecurityValidationResult,
} from './contracts.ts';

export const DEFAULT_R25_SECURITY_POLICY: RuntimeSecurityPolicy = Object.freeze({
  maxInputPayloadBytes: 16 * 1024,
  maxMessageBytes: 64 * 1024,
  maxTextLength: 1024,
  maxIdLength: 160,
  allowedOrigins: Object.freeze([]),
  maxMessagesPerSecond: 120,
});

function finite(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function utf8Bytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export interface RateLimiterSnapshotR25 {
  readonly windowStartMs: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly limit: number;
}

export class MessageRateLimiterR25 {
  readonly #limit: number;
  readonly #windowMs: number;
  #windowStartMs = 0;
  #accepted = 0;
  #rejected = 0;

  public constructor(limitPerSecond = 120, windowMs = 1000) {
    this.#limit = Math.max(1, Math.trunc(limitPerSecond));
    this.#windowMs = Math.max(1, Math.trunc(windowMs));
  }

  public allow(timestampMs: number): boolean {
    const now = Math.max(0, finite(timestampMs, 0));
    if (now - this.#windowStartMs >= this.#windowMs) {
      this.#windowStartMs = now;
      this.#accepted = 0;
      this.#rejected = 0;
    }

    if (this.#accepted >= this.#limit) {
      this.#rejected += 1;
      return false;
    }

    this.#accepted += 1;
    return true;
  }

  public snapshot(): RateLimiterSnapshotR25 {
    return freeze({
      windowStartMs: this.#windowStartMs,
      accepted: this.#accepted,
      rejected: this.#rejected,
      limit: this.#limit,
    });
  }

  public reset(timestampMs = 0): void {
    this.#windowStartMs = Math.max(0, finite(timestampMs, 0));
    this.#accepted = 0;
    this.#rejected = 0;
  }
}

export function sanitizeText(
  value: unknown,
  maxLength: number,
): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, Math.max(0, Math.trunc(maxLength)));
}

export function sanitizeId(
  value: unknown,
  maxLength = DEFAULT_R25_SECURITY_POLICY.maxIdLength,
): string {
  return sanitizeText(value, maxLength)
    .replace(/[^a-zA-Z0-9._:-]/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, maxLength);
}

export function validateOrigin(
  origin: string,
  policy: RuntimeSecurityPolicy = DEFAULT_R25_SECURITY_POLICY,
): boolean {
  if (policy.allowedOrigins.length === 0) return true;
  return policy.allowedOrigins.includes(origin);
}

export function createSecurityEnvelope(
  type: string,
  payload: unknown,
  timestampMs: number,
  nonce: string,
  policy: RuntimeSecurityPolicy = DEFAULT_R25_SECURITY_POLICY,
): SecurityEnvelope {
  const safeType = sanitizeId(type, policy.maxIdLength);
  const safeNonce = sanitizeId(nonce, 96);
  const byteLength = utf8Bytes(payload);

  if (!safeType) throw new Error('R25_SECURITY_TYPE_EMPTY');
  if (!safeNonce) throw new Error('R25_SECURITY_NONCE_EMPTY');
  if (byteLength > policy.maxInputPayloadBytes) {
    throw new Error('R25_SECURITY_PAYLOAD_TOO_LARGE');
  }

  const envelope = freeze({
    version: 1 as const,
    type: safeType,
    nonce: safeNonce,
    timestampMs: Math.max(0, finite(timestampMs, 0)),
    payload,
    byteLength,
  });

  if (utf8Bytes(envelope) > policy.maxMessageBytes) {
    throw new Error('R25_SECURITY_MESSAGE_TOO_LARGE');
  }

  return envelope;
}

export function validateSecurityEnvelope(
  envelope: unknown,
  policy: RuntimeSecurityPolicy = DEFAULT_R25_SECURITY_POLICY,
): SecurityValidationResult {
  if (!envelope || typeof envelope !== 'object') {
    return freeze({
      ok: false,
      code: 'INVALID_TYPE',
      reason: 'security envelope must be an object',
    });
  }

  const candidate = envelope as Record<string, unknown>;
  if (candidate.version !== 1) {
    return freeze({
      ok: false,
      code: 'INVALID_VERSION',
      reason: 'unsupported envelope version',
    });
  }

  const type = sanitizeId(candidate.type, policy.maxIdLength);
  const nonce = sanitizeId(candidate.nonce, 96);
  const timestampMs = finite(candidate.timestampMs, Number.NaN);
  const payloadBytes = utf8Bytes(candidate.payload);

  if (!type) {
    return freeze({ ok: false, code: 'INVALID_TYPE_ID', reason: 'type is empty or invalid' });
  }
  if (!nonce) {
    return freeze({ ok: false, code: 'INVALID_NONCE', reason: 'nonce is empty or invalid' });
  }
  if (!Number.isFinite(timestampMs)) {
    return freeze({ ok: false, code: 'INVALID_TIMESTAMP', reason: 'timestamp must be finite' });
  }
  if (payloadBytes > policy.maxInputPayloadBytes) {
    return freeze({ ok: false, code: 'PAYLOAD_TOO_LARGE', reason: 'payload exceeds configured limit' });
  }

  const sanitized: SecurityEnvelope = freeze({
    version: 1,
    type,
    nonce,
    timestampMs: Math.max(0, timestampMs),
    payload: candidate.payload,
    byteLength: payloadBytes,
  });

  if (utf8Bytes(sanitized) > policy.maxMessageBytes) {
    return freeze({ ok: false, code: 'MESSAGE_TOO_LARGE', reason: 'message exceeds configured limit' });
  }

  return freeze({
    ok: true,
    code: 'OK',
    reason: 'validated',
    sanitized,
  });
}

export function validateInputPayload(
  payload: unknown,
  policy: RuntimeSecurityPolicy = DEFAULT_R25_SECURITY_POLICY,
): SecurityValidationResult {
  const bytes = utf8Bytes(payload);
  if (!Number.isFinite(bytes)) {
    return freeze({ ok: false, code: 'UNSERIALIZABLE', reason: 'payload cannot be serialized safely' });
  }
  if (bytes > policy.maxInputPayloadBytes) {
    return freeze({ ok: false, code: 'PAYLOAD_TOO_LARGE', reason: 'input payload exceeds configured limit' });
  }
  return freeze({
    ok: true,
    code: 'OK',
    reason: 'validated',
    sanitized: payload,
  });
}

export function validateCommand(
  command: unknown,
  policy: RuntimeSecurityPolicy = DEFAULT_R25_SECURITY_POLICY,
): SecurityValidationResult {
  if (!command || typeof command !== 'object') {
    return freeze({ ok: false, code: 'COMMAND_TYPE', reason: 'command must be an object' });
  }

  const candidate = command as Record<string, unknown>;
  const type = sanitizeId(candidate.type, policy.maxIdLength);
  const id = sanitizeId(candidate.id, policy.maxIdLength);

  if (!type) return freeze({ ok: false, code: 'COMMAND_TYPE_EMPTY', reason: 'command type is empty' });
  if (!id) return freeze({ ok: false, code: 'COMMAND_ID_EMPTY', reason: 'command id is empty' });

  const payloadResult = validateInputPayload(candidate.payload, policy);
  if (!payloadResult.ok) return payloadResult;

  return freeze({
    ok: true,
    code: 'OK',
    reason: 'command validated',
    sanitized: freeze({
      type,
      id,
      payload: candidate.payload,
    }),
  });
}

export function isDangerousString(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /(?:javascript:|data:text\/html|<script\b|onerror\s*=|onload\s*=|eval\s*\()/i.test(value);
}

export function scanPayloadForDangerousStrings(
  payload: unknown,
  maxDepth = 5,
): readonly string[] {
  const findings: string[] = [];

  const visit = (value: unknown, path: string, depth: number): void => {
    if (depth > maxDepth) {
      findings.push(`depth:${path}`);
      return;
    }

    if (typeof value === 'string') {
      if (isDangerousString(value)) findings.push(path);
      return;
    }

    if (!value || typeof value !== 'object') return;

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        visit(value[index], `${path}[${index}]`, depth + 1);
      }
      return;
    }

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      visit(entry, path ? `${path}.${sanitizeId(key)}` : sanitizeId(key), depth + 1);
    }
  };

  visit(payload, '$', 0);
  return freeze([...new Set(findings)]);
}
