import { CommandEnvelope, EntityId, NetworkDelta, asCommandId, asEntityId, asTick, checksumObject, isPlainRecord } from './domain.ts';

export interface SecurityLimits {
  readonly maxCommandBytes: number;
  readonly maxStringLength: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxCommandsPerSecond: number;
  readonly maxSnapshotEntities: number;
}

export const DEFAULT_SECURITY_LIMITS: SecurityLimits = Object.freeze({ maxCommandBytes: 32 * 1024, maxStringLength: 1024, maxArrayLength: 4096, maxObjectKeys: 256, maxCommandsPerSecond: 240, maxSnapshotEntities: 20_000 });

export interface SecurityViolation { readonly code: string; readonly message: string; readonly severity: 'warn' | 'error' | 'fatal'; }

export class RateLimiterV5 {
  #tokens: number;
  #lastMs: number;
  constructor(private readonly ratePerSecond = 240, private readonly burst = 240, now: () => number = () => Date.now()) {
    this.#tokens = burst;
    this.#lastMs = now();
    this.#now = now;
  }
  #now: () => number;

  allow(cost = 1): boolean {
    const now = this.#now();
    const elapsed = Math.max(0, now - this.#lastMs) / 1000;
    this.#tokens = Math.min(this.burst, this.#tokens + elapsed * this.ratePerSecond);
    this.#lastMs = now;
    if (cost <= 0 || cost > this.#tokens) return false;
    this.#tokens -= cost;
    return true;
  }

  remaining(): number { return Math.floor(this.#tokens); }
}

const inspectValue = (value: unknown, limits: SecurityLimits, path: string, depth: number, violations: SecurityViolation[]): void => {
  if (depth > 12) { violations.push({ code: 'max-depth', message: `${path} exceeds maximum object depth`, severity: 'error' }); return; }
  if (typeof value === 'string') {
    if (value.length > limits.maxStringLength) violations.push({ code: 'string-size', message: `${path} string is too long`, severity: 'error' });
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayLength) violations.push({ code: 'array-size', message: `${path} array is too large`, severity: 'error' });
    value.forEach((entry, index) => inspectValue(entry, limits, `${path}[${index}]`, depth + 1, violations));
    return;
  }
  if (isPlainRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length > limits.maxObjectKeys) violations.push({ code: 'object-size', message: `${path} object has too many keys`, severity: 'error' });
    for (const key of keys) inspectValue(value[key], limits, `${path}.${key}`, depth + 1, violations);
  }
};

export class RuntimeSecurityV5 {
  readonly #limits: SecurityLimits;
  readonly #commands = new RateLimiterV5();
  constructor(limits: Partial<SecurityLimits> = {}) { this.#limits = { ...DEFAULT_SECURITY_LIMITS, ...limits }; }

  validateCommand(command: CommandEnvelope): readonly SecurityViolation[] {
    const violations: SecurityViolation[] = [];
    if (!command.type.trim() || command.type.length > 128) violations.push({ code: 'command-type', message: 'invalid command type', severity: 'error' });
    if (!this.#commands.allow()) violations.push({ code: 'command-rate', message: 'command rate exceeded', severity: 'error' });
    if (Number(command.tick) < 0 || !Number.isInteger(Number(command.tick))) violations.push({ code: 'command-tick', message: 'invalid command tick', severity: 'error' });
    if (command.issuer !== null && !Number.isInteger(Number(command.issuer))) violations.push({ code: 'issuer', message: 'invalid issuer', severity: 'error' });
    inspectValue(command.payload, this.#limits, 'payload', 0, violations);
    const bytes = new TextEncoder().encode(JSON.stringify(command)).byteLength;
    if (bytes > this.#limits.maxCommandBytes) violations.push({ code: 'command-bytes', message: 'command exceeds byte limit', severity: 'error' });
    return violations;
  }

  validateDelta(delta: NetworkDelta): readonly SecurityViolation[] {
    const violations: SecurityViolation[] = [];
    if (!Number.isInteger(delta.baseSequence) || delta.baseSequence < 0) violations.push({ code: 'base-sequence', message: 'invalid base sequence', severity: 'error' });
    if (!Number.isInteger(delta.sequence) || delta.sequence < 0) violations.push({ code: 'sequence', message: 'invalid sequence', severity: 'error' });
    if (delta.upserts.length + delta.removes.length > this.#limits.maxSnapshotEntities) violations.push({ code: 'delta-size', message: 'delta entity count exceeds limit', severity: 'error' });
    for (const id of delta.removes) if (!Number.isInteger(Number(id)) || Number(id) < 0) violations.push({ code: 'entity-id', message: 'invalid removed entity id', severity: 'error' });
    return violations;
  }

  sanitizeEntityId(value: unknown): EntityId | null {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return asEntityId(value);
    return null;
  }

  sanitizeCommandId(value: unknown): ReturnType<typeof asCommandId> | null {
    if (typeof value !== 'string') return null;
    const sanitized = value.trim().slice(0, 128);
    return sanitized ? asCommandId(sanitized) : null;
  }

  sanitizeText(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.normalize('NFKC').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, this.#limits.maxStringLength);
  }

  verifyChecksum(value: unknown, expected: string): boolean { return checksumObject(value) === expected; }
  tick(value: unknown): ReturnType<typeof asTick> | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? asTick(value) : null; }
}
