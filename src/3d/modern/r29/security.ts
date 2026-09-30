import { clampR29 } from './contracts.ts';
import type { R29RawInput } from './inputRuntime.ts';

export interface R29SecurityPolicy {
  readonly maxPayloadBytes: number;
  readonly maxInputPerSecond: number;
  readonly maxLookDelta: number;
  readonly maxStringLength: number;
  readonly maxSnapshotAgeTicks: number;
}

export interface R29SecurityVerdict<T> {
  readonly ok: boolean;
  readonly value: T | null;
  readonly reason: string;
  readonly sanitized: boolean;
}

export const DEFAULT_R29_SECURITY_POLICY: R29SecurityPolicy = Object.freeze({
  maxPayloadBytes: 512 * 1024,
  maxInputPerSecond: 180,
  maxLookDelta: 90,
  maxStringLength: 256,
  maxSnapshotAgeTicks: 30,
});

export class R29SecurityBoundary {
  readonly policy: R29SecurityPolicy;
  #windowStartTick = 0;
  #acceptedInWindow = 0;

  constructor(policy: Partial<R29SecurityPolicy> = {}) {
    this.policy = Object.freeze({
      ...DEFAULT_R29_SECURITY_POLICY,
      ...sanitizePolicy(policy),
    });
  }

  validateInput(raw: R29RawInput, tick: number): R29SecurityVerdict<R29RawInput> {
    const currentTick = Math.max(0, Math.floor(tick));
    if (currentTick - this.#windowStartTick >= 60) {
      this.#windowStartTick = currentTick;
      this.#acceptedInWindow = 0;
    }
    if (this.#acceptedInWindow >= this.policy.maxInputPerSecond) {
      return Object.freeze({ ok: false, value: null, reason: 'rate-limit', sanitized: false });
    }
    if (!Number.isSafeInteger(raw.sequence) || raw.sequence < 0) {
      return Object.freeze({ ok: false, value: null, reason: 'sequence', sanitized: false });
    }
    if (!Number.isSafeInteger(raw.tick) || raw.tick < 0 || raw.tick > currentTick + 120) {
      return Object.freeze({ ok: false, value: null, reason: 'tick', sanitized: false });
    }

    const value: R29RawInput = {
      tick: Math.floor(raw.tick),
      sequence: Math.floor(raw.sequence),
      moveX: clampR29(raw.moveX, -1, 1),
      moveY: clampR29(raw.moveY, -1, 1),
      lookX: clampR29(raw.lookX, -this.policy.maxLookDelta, this.policy.maxLookDelta),
      lookY: clampR29(raw.lookY, -this.policy.maxLookDelta, this.policy.maxLookDelta),
      ...(raw.jump !== undefined ? { jump: Boolean(raw.jump) } : {}),
      ...(raw.sprint !== undefined ? { sprint: Boolean(raw.sprint) } : {}),
      ...(raw.primary !== undefined ? { primary: Boolean(raw.primary) } : {}),
      ...(raw.secondary !== undefined ? { secondary: Boolean(raw.secondary) } : {}),
      ...(raw.interact !== undefined ? { interact: Boolean(raw.interact) } : {}),
      ...(raw.pause !== undefined ? { pause: Boolean(raw.pause) } : {}),
    };
    this.#acceptedInWindow += 1;
    return Object.freeze({
      ok: true,
      value: Object.freeze(value),
      reason: 'accepted',
      sanitized: value.moveX !== raw.moveX || value.moveY !== raw.moveY || value.lookX !== raw.lookX || value.lookY !== raw.lookY,
    });
  }

  validateSnapshotAge(serverTick: number, clientTick: number): R29SecurityVerdict<number> {
    const age = Math.max(0, Math.floor(serverTick) - Math.floor(clientTick));
    if (age > this.policy.maxSnapshotAgeTicks) {
      return Object.freeze({ ok: false, value: null, reason: 'snapshot-stale', sanitized: false });
    }
    return Object.freeze({ ok: true, value: age, reason: 'accepted', sanitized: false });
  }

  sanitizeText(value: unknown): R29SecurityVerdict<string> {
    if (typeof value !== 'string') return Object.freeze({ ok: false, value: null, reason: 'type', sanitized: false });
    const normalized = value
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim()
      .slice(0, this.policy.maxStringLength);
    return Object.freeze({
      ok: true,
      value: normalized,
      reason: 'accepted',
      sanitized: normalized !== value,
    });
  }

  validatePayload(payload: unknown): R29SecurityVerdict<unknown> {
    let bytes = 0;
    try {
      bytes = JSON.stringify(payload).length;
    } catch {
      return Object.freeze({ ok: false, value: null, reason: 'unserializable', sanitized: false });
    }
    if (bytes > this.policy.maxPayloadBytes) {
      return Object.freeze({ ok: false, value: null, reason: 'payload-too-large', sanitized: false });
    }
    return Object.freeze({ ok: true, value: payload, reason: 'accepted', sanitized: false });
  }

  reset(): void {
    this.#windowStartTick = 0;
    this.#acceptedInWindow = 0;
  }
}

function sanitizePolicy(policy: Partial<R29SecurityPolicy>): Partial<R29SecurityPolicy> {
  const output: Partial<R29SecurityPolicy> = {};
  if (Number.isFinite(policy.maxPayloadBytes) && (policy.maxPayloadBytes ?? 0) > 0) output.maxPayloadBytes = Math.floor(policy.maxPayloadBytes!);
  if (Number.isFinite(policy.maxInputPerSecond) && (policy.maxInputPerSecond ?? 0) > 0) output.maxInputPerSecond = Math.floor(policy.maxInputPerSecond!);
  if (Number.isFinite(policy.maxLookDelta) && (policy.maxLookDelta ?? 0) > 0) output.maxLookDelta = policy.maxLookDelta!;
  if (Number.isFinite(policy.maxStringLength) && (policy.maxStringLength ?? 0) > 0) output.maxStringLength = Math.floor(policy.maxStringLength!);
  if (Number.isFinite(policy.maxSnapshotAgeTicks) && (policy.maxSnapshotAgeTicks ?? 0) >= 0) output.maxSnapshotAgeTicks = Math.floor(policy.maxSnapshotAgeTicks!);
  return output;
}
