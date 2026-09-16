/** Bounded validation and abuse controls for runtime/network input boundaries. */

export interface CommandSecurityConfig {
  maxPayloadBytes: number;
  maxCommandsPerWindow: number;
  windowTicks: number;
  maxStringLength: number;
  maxCollectionSize: number;
}

export interface CommandSecurityResult { accepted: boolean; reason: string | null; payloadBytes: number }
export interface RateLimitState { accepted: number; rejected: number; windowStartTick: number }

const DEFAULTS: CommandSecurityConfig = {
  maxPayloadBytes: 16 * 1024,
  maxCommandsPerWindow: 120,
  windowTicks: 60,
  maxStringLength: 256,
  maxCollectionSize: 512,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function sanitizeString(value: string, maxLength: number): string {
  return value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
}

export function sanitizePayload(value: unknown, config: CommandSecurityConfig = DEFAULTS, depth = 0): unknown {
  if (depth > 8) throw new Error('payload nesting exceeds limit');
  if (typeof value === 'string') return sanitizeString(value, config.maxStringLength);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('payload contains non-finite number');
    return value;
  }
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) {
    if (value.length > config.maxCollectionSize) throw new Error('payload collection exceeds limit');
    return value.map((item) => sanitizePayload(item, config, depth + 1));
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > config.maxCollectionSize) throw new Error('payload object exceeds limit');
    const result: Record<string, unknown> = {};
    for (const [key, item] of entries) result[sanitizeString(key, config.maxStringLength)] = sanitizePayload(item, config, depth + 1);
    return result;
  }
  throw new Error(`unsupported payload type ${typeof value}`);
}

export class CommandRateLimiterV3 {
  readonly config: CommandSecurityConfig;
  #accepted = 0;
  #rejected = 0;
  #windowStartTick = 0;
  #windowAccepted = 0;

  constructor(config?: Partial<CommandSecurityConfig>) { this.config = { ...DEFAULTS, ...config }; }

  consume(tick: number): boolean {
    if (tick - this.#windowStartTick >= this.config.windowTicks) {
      this.#windowStartTick = tick;
      this.#windowAccepted = 0;
    }
    if (this.#windowAccepted >= this.config.maxCommandsPerWindow) {
      this.#rejected += 1;
      return false;
    }
    this.#windowAccepted += 1;
    this.#accepted += 1;
    return true;
  }

  get state(): RateLimitState { return { accepted: this.#accepted, rejected: this.#rejected, windowStartTick: this.#windowStartTick }; }
  reset(tick = 0): void { this.#accepted = 0; this.#rejected = 0; this.#windowStartTick = tick; this.#windowAccepted = 0; }
}

export function validateRuntimeCommand(input: { tick: number; entityId: number; type: string; payload: unknown }, limiter: CommandRateLimiterV3, config: CommandSecurityConfig = DEFAULTS): CommandSecurityResult {
  try {
    if (!Number.isInteger(input.tick) || input.tick < 0) return { accepted: false, reason: 'invalid tick', payloadBytes: 0 };
    if (!Number.isInteger(input.entityId) || input.entityId <= 0) return { accepted: false, reason: 'invalid entity id', payloadBytes: 0 };
    if (!input.type || input.type.length > config.maxStringLength) return { accepted: false, reason: 'invalid command type', payloadBytes: 0 };
    const sanitized = sanitizePayload(input.payload, config);
    const payloadBytes = serializedBytes(sanitized);
    if (payloadBytes > config.maxPayloadBytes) return { accepted: false, reason: 'payload exceeds size limit', payloadBytes };
    if (!limiter.consume(input.tick)) return { accepted: false, reason: 'command rate limit exceeded', payloadBytes };
    return { accepted: true, reason: null, payloadBytes };
  } catch (error) {
    return { accepted: false, reason: error instanceof Error ? error.message : String(error), payloadBytes: 0 };
  }
}

export function rejectDangerousKeys(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  const dangerous = new Set(['__proto__', 'prototype', 'constructor']);
  const clean: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) if (!dangerous.has(key)) clean[key] = Array.isArray(item) ? item.map(rejectDangerousKeys) : rejectDangerousKeys(item);
  return clean;
}
