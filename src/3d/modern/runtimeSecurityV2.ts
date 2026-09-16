export interface SecurityLimits {
  readonly maxPayloadBytes: number;
  readonly maxStringLength: number;
  readonly maxCollectionLength: number;
  readonly maxCommandsPerTick: number;
  readonly maxSnapshotAgeTicks: number;
}

export interface SecurityAudit {
  readonly accepted: boolean;
  readonly reasons: readonly string[];
  readonly sanitized: boolean;
}

export interface CommandEnvelope {
  readonly id: string;
  readonly type: string;
  readonly payload: unknown;
  readonly tick: number;
  readonly checksum: string;
}

export const defaultSecurityLimits: SecurityLimits = Object.freeze({
  maxPayloadBytes: 256 * 1024,
  maxStringLength: 512,
  maxCollectionLength: 4096,
  maxCommandsPerTick: 128,
  maxSnapshotAgeTicks: 180,
});

const safeString = (value: unknown, max: number): string => String(value ?? '').slice(0, Math.max(1, Math.floor(max)));
const estimateBytes = (value: unknown): number => {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { return Number.MAX_SAFE_INTEGER; }
};

export const validatePayload = (payload: unknown, limits: SecurityLimits = defaultSecurityLimits): SecurityAudit => {
  const reasons: string[] = [];
  const bytes = estimateBytes(payload);
  if (bytes > limits.maxPayloadBytes) reasons.push(`payload exceeds ${limits.maxPayloadBytes} bytes`);
  if (typeof payload === 'string' && payload.length > limits.maxStringLength) reasons.push('string length exceeds policy');
  if (Array.isArray(payload) && payload.length > limits.maxCollectionLength) reasons.push('array length exceeds policy');
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const keys = Object.keys(payload as Record<string, unknown>);
    if (keys.length > limits.maxCollectionLength) reasons.push('object key count exceeds policy');
    if (keys.some((key) => key.length > limits.maxStringLength)) reasons.push('object key exceeds string policy');
  }
  return Object.freeze({ accepted: reasons.length === 0, reasons, sanitized: false });
};

export const sanitizeText = (value: unknown, maxLength = defaultSecurityLimits.maxStringLength): string => safeString(value, maxLength).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
export const sanitizeId = (value: unknown, maxLength = 96): string => sanitizeText(value, maxLength).replace(/[^a-zA-Z0-9._:-]/g, '_');

export class CommandRateLimiter {
  readonly #limits: SecurityLimits;
  #tick = -1;
  #count = 0;
  constructor(limits: SecurityLimits = defaultSecurityLimits) { this.#limits = Object.freeze({ ...limits }); }
  allow(tick: number): boolean {
    const normalizedTick = Math.max(0, Math.floor(tick));
    if (normalizedTick !== this.#tick) { this.#tick = normalizedTick; this.#count = 0; }
    if (this.#count >= this.#limits.maxCommandsPerTick) return false;
    this.#count += 1;
    return true;
  }
  count(): number { return this.#count; }
}

export const validateSnapshotAge = (snapshotTick: number, currentTick: number, maxAgeTicks = defaultSecurityLimits.maxSnapshotAgeTicks): boolean => {
  const age = Math.max(0, Math.floor(currentTick) - Math.floor(snapshotTick));
  return age <= Math.max(0, Math.floor(maxAgeTicks));
};

export const sanitizeCommand = (command: CommandEnvelope, limits: SecurityLimits = defaultSecurityLimits): CommandEnvelope => Object.freeze({
  id: sanitizeId(command.id),
  type: sanitizeId(command.type),
  payload: command.payload,
  tick: Math.max(0, Math.floor(command.tick)),
  checksum: sanitizeText(command.checksum, 32),
});
