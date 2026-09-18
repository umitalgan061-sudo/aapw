import { InputCommandV7, RuntimeCommandV7, SequenceV7, TickV7, clampV7 } from './types.ts';
import { hashStringV7 } from './deterministic.ts';

export interface SecurityLimitsV7 {
  readonly maxCommandsPerTick: number;
  readonly maxActionLength: number;
  readonly maxActionsPerInput: number;
  readonly maxTagLength: number;
  readonly maxEntityId: number;
  readonly maxPayloadBytes: number;
}

export const DEFAULT_SECURITY_LIMITS_V7: SecurityLimitsV7 = Object.freeze({
  maxCommandsPerTick: 32,
  maxActionLength: 48,
  maxActionsPerInput: 12,
  maxTagLength: 48,
  maxEntityId: 0x7fffffff,
  maxPayloadBytes: 64 * 1024,
});

export interface SecurityAuditV7 {
  readonly accepted: number;
  readonly rejected: number;
  readonly reasons: Readonly<Record<string, number>>;
}

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized.length > max) return null;
  if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(normalized)) return null;
  return normalized;
};

export class RuntimeSecurityV7 {
  readonly #limits: SecurityLimitsV7;
  readonly #seenSequences = new Set<number>();
  readonly #seenCommands = new Set<number>();
  #accepted = 0;
  #rejected = 0;
  readonly #reasons = new Map<string, number>();

  constructor(limits: Partial<SecurityLimitsV7> = {}) { this.#limits = Object.freeze({ ...DEFAULT_SECURITY_LIMITS_V7, ...limits }); }

  validateInput(input: InputCommandV7): boolean {
    if (!Number.isInteger(Number(input.sequence)) || Number(input.sequence) < 0) return this.#reject('sequence');
    if (!Number.isInteger(Number(input.tick)) || Number(input.tick) < 0) return this.#reject('tick');
    if (this.#seenSequences.has(Number(input.sequence))) return this.#reject('replay');
    if (Math.abs(input.move.x) > 1 || Math.abs(input.move.z) > 1 || Math.abs(input.look.pitch) > Math.PI * 0.51) return this.#reject('vector');
    if (input.actions.length > this.#limits.maxActionsPerInput) return this.#reject('actions');
    for (const action of input.actions) if (!text(action, this.#limits.maxActionLength)) return this.#reject('action-text');
    const bytes = this.#bytes(input);
    if (bytes > this.#limits.maxPayloadBytes) return this.#reject('payload-size');
    this.#seenSequences.add(Number(input.sequence)); this.#accepted += 1;
    if (this.#seenSequences.size > 8192) this.#seenSequences.clear();
    return true;
  }

  validateCommand(command: RuntimeCommandV7, tick: TickV7): boolean {
    const signature = hashStringV7(JSON.stringify(command));
    if (this.#seenCommands.has(signature)) return this.#reject('duplicate-command');
    if (Math.abs(Number((command as { id?: number }).id ?? 0)) > this.#limits.maxEntityId) return this.#reject('entity-id');
    if (command.type === 'tag' && !text(command.tag, this.#limits.maxTagLength)) return this.#reject('tag');
    if (command.type === 'damage' || command.type === 'heal') {
      if (!Number.isFinite(command.amount) || command.amount < 0 || command.amount > 1_000_000) return this.#reject('amount');
    }
    this.#seenCommands.add(signature);
    this.#accepted += 1;
    return true;
  }

  audit(): SecurityAuditV7 {
    const reasons: Record<string, number> = {};
    for (const [reason, count] of this.#reasons) reasons[reason] = count;
    return Object.freeze({ accepted: this.#accepted, rejected: this.#rejected, reasons: Object.freeze(reasons) });
  }

  resetReplayWindow(): void { this.#seenSequences.clear(); this.#seenCommands.clear(); }

  #bytes(value: unknown): number {
    try { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
    catch { return Number.POSITIVE_INFINITY; }
  }

  #reject(reason: string): false {
    this.#rejected += 1; this.#reasons.set(reason, (this.#reasons.get(reason) ?? 0) + 1); return false;
  }
}
