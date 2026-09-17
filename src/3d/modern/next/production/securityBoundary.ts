import { checksumP, finiteP, integerP, normalizedIdP, type NetworkEnvelopeP, type SnapshotDeltaP, type WorldCommandP } from './contracts.ts';

export interface SecurityLimitsP {
  readonly maxDepth: number;
  readonly maxArrayLength: number;
  readonly maxObjectKeys: number;
  readonly maxStringLength: number;
  readonly maxPayloadBytes: number;
  readonly maxCommandsPerWindow: number;
  readonly commandWindowMs: number;
  readonly maxFutureTick: number;
  readonly maxPastTick: number;
}

export interface ValidationResultP { readonly ok: boolean; readonly reason?: string; readonly bytes: number; readonly checksum: number; }
export interface RateStateP { readonly actor: string; readonly allowed: boolean; readonly count: number; readonly resetAtMs: number; readonly remaining: number; }
export interface SecurityStatsP { readonly validated: number; readonly rejected: number; readonly commandRejected: number; readonly envelopeRejected: number; readonly rateRejected: number; readonly checksum: number; }

const DEFAULTS: SecurityLimitsP = Object.freeze({ maxDepth: 6, maxArrayLength: 128, maxObjectKeys: 128, maxStringLength: 2048, maxPayloadBytes: 256 * 1024, maxCommandsPerWindow: 40, commandWindowMs: 1000, maxFutureTick: 8, maxPastTick: 120 });
const ID_PATTERN = /^[a-zA-Z0-9:_-]{1,96}$/;

export class ProductionSecurityBoundary {
  readonly limits: SecurityLimitsP;
  readonly #rate = new Map<string, { startedAtMs: number; count: number }>();
  #validated = 0; #rejected = 0; #commandRejected = 0; #envelopeRejected = 0; #rateRejected = 0;
  constructor(limits: Partial<SecurityLimitsP> = {}) { this.limits = Object.freeze({ ...DEFAULTS, ...limits, maxDepth: Math.max(1, integerP(limits.maxDepth ?? DEFAULTS.maxDepth)), maxArrayLength: Math.max(1, integerP(limits.maxArrayLength ?? DEFAULTS.maxArrayLength)), maxObjectKeys: Math.max(1, integerP(limits.maxObjectKeys ?? DEFAULTS.maxObjectKeys)), maxStringLength: Math.max(16, integerP(limits.maxStringLength ?? DEFAULTS.maxStringLength)), maxPayloadBytes: Math.max(1024, integerP(limits.maxPayloadBytes ?? DEFAULTS.maxPayloadBytes)), maxCommandsPerWindow: Math.max(1, integerP(limits.maxCommandsPerWindow ?? DEFAULTS.maxCommandsPerWindow)), commandWindowMs: Math.max(1, finiteP(limits.commandWindowMs ?? DEFAULTS.commandWindowMs)), maxFutureTick: Math.max(0, integerP(limits.maxFutureTick ?? DEFAULTS.maxFutureTick)), maxPastTick: Math.max(0, integerP(limits.maxPastTick ?? DEFAULTS.maxPastTick)) }); }

  validatePayload(payload: unknown): ValidationResultP {
    const result = this.#validateNode(payload, 0);
    if (result.ok) this.#validated += 1; else this.#rejected += 1;
    return result;
  }

  validateId(value: unknown): boolean { return typeof value === 'string' && ID_PATTERN.test(value); }

  validateCommand(command: WorldCommandP, currentTick: number): ValidationResultP {
    if (!this.validateId(command.kind) && command.kind.length > 80) return this.reject('invalid-command-kind');
    if (command.actorId !== normalizedIdP(command.actorId)) return this.reject('invalid-actor-id');
    if (!Number.isInteger(command.tick)) return this.reject('invalid-command-tick');
    if (command.tick > currentTick + this.limits.maxFutureTick) return this.reject('future-command');
    if (command.tick < currentTick - this.limits.maxPastTick) return this.reject('stale-command');
    const payload = this.validatePayload(command.payload); if (!payload.ok) { this.#commandRejected += 1; return payload; }
    return payload;
  }

  validateEnvelope(envelope: NetworkEnvelopeP, currentTick: number): ValidationResultP {
    if (envelope.protocol !== 4) return this.reject('protocol');
    if (!this.validateId(envelope.session)) return this.reject('session-id');
    if (!Number.isInteger(envelope.sequence) || envelope.sequence < 1) return this.reject('sequence');
    if (!Number.isInteger(envelope.tick)) return this.reject('tick');
    if (envelope.tick > currentTick + this.limits.maxFutureTick) { this.#envelopeRejected += 1; return this.reject('future-envelope'); }
    if (envelope.tick < currentTick - this.limits.maxPastTick) { this.#envelopeRejected += 1; return this.reject('stale-envelope'); }
    const payload = this.validatePayload(envelope.payload); if (!payload.ok) { this.#envelopeRejected += 1; return payload; }
    if (payload.bytes > this.limits.maxPayloadBytes) { this.#envelopeRejected += 1; return this.reject('payload-bytes'); }
    return payload;
  }

  validateDelta(delta: SnapshotDeltaP, currentTick: number): ValidationResultP {
    if (delta.protocol !== 4 || delta.baseTick > delta.tick) return this.reject('delta-version-or-range');
    if (delta.tick > currentTick + this.limits.maxFutureTick || delta.tick < currentTick - this.limits.maxPastTick) return this.reject('delta-age');
    if (!delta.upserts.every(actor => Number.isInteger(actor.id) && actor.id > 0 && [actor.x, actor.y, actor.z, actor.yaw, actor.health, actor.stamina].every(Number.isFinite))) return this.reject('delta-actor-values');
    if (!delta.removals.every(id => Number.isInteger(id) && id > 0)) return this.reject('delta-removals');
    return this.validatePayload(delta);
  }

  allowCommand(actorId: string, nowMs = currentTime()): RateStateP {
    const actor = String(actorId).slice(0, 96); const now = Math.max(0, finiteP(nowMs)); let state = this.#rate.get(actor);
    if (!state || now - state.startedAtMs >= this.limits.commandWindowMs) state = { startedAtMs: now, count: 0 };
    if (state.count >= this.limits.maxCommandsPerWindow) { this.#rate.set(actor, state); this.#rateRejected += 1; return Object.freeze({ actor, allowed: false, count: state.count, resetAtMs: state.startedAtMs + this.limits.commandWindowMs, remaining: 0 }); }
    state.count += 1; this.#rate.set(actor, state); return Object.freeze({ actor, allowed: true, count: state.count, resetAtMs: state.startedAtMs + this.limits.commandWindowMs, remaining: Math.max(0, this.limits.maxCommandsPerWindow - state.count) });
  }

  cleanupRate(nowMs = currentTime()): number { const now = Math.max(0, finiteP(nowMs)); let removed = 0; for (const [actor, state] of this.#rate) if (now - state.startedAtMs >= this.limits.commandWindowMs * 2) { this.#rate.delete(actor); removed += 1; } return removed; }
  stats(): SecurityStatsP { return Object.freeze({ validated: this.#validated, rejected: this.#rejected, commandRejected: this.#commandRejected, envelopeRejected: this.#envelopeRejected, rateRejected: this.#rateRejected, checksum: checksumP({ validated: this.#validated, rejected: this.#rejected, commandRejected: this.#commandRejected, envelopeRejected: this.#envelopeRejected, rateRejected: this.#rateRejected }) }); }

  #validateNode(value: unknown, depth: number): ValidationResultP {
    if (depth > this.limits.maxDepth) return this.reject('depth');
    if (value === null || typeof value === 'boolean') return this.accept(4);
    if (typeof value === 'number') return Number.isFinite(value) ? this.accept(8) : this.reject('non-finite-number');
    if (typeof value === 'string') return value.length <= this.limits.maxStringLength ? this.accept(value.length * 2 + 8) : this.reject('string-length');
    if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') return this.reject('unsupported-type');
    if (Array.isArray(value)) {
      if (value.length > this.limits.maxArrayLength) return this.reject('array-length');
      let bytes = 16; for (const child of value) { const result = this.#validateNode(child, depth + 1); if (!result.ok) return result; bytes += result.bytes; if (bytes > this.limits.maxPayloadBytes) return this.reject('payload-bytes'); }
      return this.accept(bytes);
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > this.limits.maxObjectKeys) return this.reject('object-keys');
    let bytes = 24;
    for (const [key, child] of entries) { if (key.length > this.limits.maxStringLength) return this.reject('object-key-length'); const result = this.#validateNode(child, depth + 1); if (!result.ok) return result; bytes += key.length * 2 + result.bytes; if (bytes > this.limits.maxPayloadBytes) return this.reject('payload-bytes'); }
    return this.accept(bytes);
  }

  accept(bytes: number): ValidationResultP { return Object.freeze({ ok: true, bytes: Math.max(0, Math.trunc(bytes)), checksum: checksumP({ bytes }) }); }
  reject(reason: string): ValidationResultP { this.#rejected += 1; return Object.freeze({ ok: false, reason, bytes: 0, checksum: checksumP(reason) }); }
}

function currentTime(): number { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
