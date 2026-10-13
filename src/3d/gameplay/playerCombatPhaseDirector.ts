/**
 * Deterministic phase projection over the shipped combat-rule authority.
 * This adapter does not own timers, state mutation, damage, animation mixers or input.
 */
import {
  resolvePlayerCombatEnvelope,
  resolvePlayerDefenseRules,
  resolvePlayerDodgeRules,
  resolvePlayerRangedRules,
} from './playerEquipmentCombatRules.ts';

export type CombatPhaseKind = 'light' | 'heavy' | 'guard' | 'parry' | 'dodge' | 'ranged';
export type CombatPhaseName = 'startup' | 'active' | 'recovery' | 'complete';

export interface CombatPhaseInput {
  kind?: CombatPhaseKind;
  equipment?: Record<string, unknown>;
  staminaRatio?: number;
  poiseRatio?: number;
  grounded?: boolean;
  attackBusy?: boolean;
  guardBreak?: boolean;
  parryWindowOpen?: boolean;
  dodgeInvulnerable?: boolean;
  lockOn?: boolean;
  moving?: boolean;
}

export interface CombatPhaseFrame {
  kind: CombatPhaseKind;
  accepted: boolean;
  reason: string;
  startup: number;
  active: number;
  recovery: number;
  total: number;
  staminaCost: number;
  invulnerable: boolean;
  ranged: boolean;
}

export interface CombatPhaseReceipt {
  phase: CombatPhaseName;
  normalizedTime: number;
  remaining: number;
  invulnerable: boolean;
}

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

const freeze = <T>(value: T): T => Object.freeze(value);

export function resolvePlayerCombatPhase(input: CombatPhaseInput = {}): CombatPhaseFrame {
  const kind: CombatPhaseKind = input.kind ?? 'light';
  const staminaRatio = clamp(input.staminaRatio, 0, 1, 1);
  const poiseRatio = clamp(input.poiseRatio, 0, 1, 1);
  const grounded = input.grounded !== false;
  const profile = input.equipment ?? {};

  if (kind === 'guard' || kind === 'parry') {
    const defense = resolvePlayerDefenseRules(profile, {
      staminaRatio,
      poiseRatio,
      guardInput: true,
      parryWindowOpen: kind === 'parry' || Boolean(input.parryWindowOpen),
      dodgeInvulnerable: Boolean(input.dodgeInvulnerable),
    });
    const accepted = kind === 'parry' ? defense.parryAvailable : defense.guardAvailable;
    return freeze({
      kind,
      accepted,
      reason: accepted ? 'accepted' : 'defense-gated',
      startup: kind === 'parry' ? 0.04 : 0.08,
      active: kind === 'parry' ? 0.16 : 0.42,
      recovery: kind === 'parry' ? 0.22 : 0.28,
      total: kind === 'parry' ? 0.42 : 0.78,
      staminaCost: kind === 'parry' ? 8 : 4,
      invulnerable: false,
      ranged: false,
    });
  }

  if (kind === 'dodge') {
    const dodge = resolvePlayerDodgeRules(profile, {
      staminaRatio,
      grounded,
      attackBusy: Boolean(input.attackBusy),
      guardBreak: Boolean(input.guardBreak),
    });
    return freeze({
      kind,
      accepted: dodge.canStart,
      reason: dodge.canStart ? 'accepted' : 'dodge-gated',
      startup: 0.06,
      active: dodge.iframeWindow.duration,
      recovery: dodge.cooldownSeconds,
      total: Number((0.06 + dodge.iframeWindow.duration + dodge.cooldownSeconds).toFixed(4)),
      staminaCost: dodge.staminaCost,
      invulnerable: dodge.canStart,
      ranged: false,
    });
  }

  if (kind === 'ranged') {
    const ranged = resolvePlayerRangedRules(profile, {
      staminaRatio,
      lockOn: Boolean(input.lockOn),
      moving: Boolean(input.moving),
    });
    const accepted = ranged.ranged && staminaRatio > 0.18;
    const startup = ranged.ranged ? 0.24 : 0.2;
    const active = ranged.ranged ? 0.08 : 0.04;
    const recovery = ranged.ranged ? 0.36 : 0.2;
    return freeze({
      kind,
      accepted,
      reason: accepted ? 'accepted' : 'ranged-gated',
      startup,
      active,
      recovery,
      total: Number((startup + active + recovery).toFixed(4)),
      staminaCost: ranged.ranged ? 10 : 0,
      invulnerable: false,
      ranged: ranged.ranged,
    });
  }

  const envelope = resolvePlayerCombatEnvelope(profile, {
    kind,
    staminaRatio,
    poiseRatio,
  });
  const accepted = !envelope.exhausted && !Boolean(input.attackBusy) && !Boolean(input.guardBreak);
  return freeze({
    kind,
    accepted,
    reason: accepted ? 'accepted' : envelope.exhausted ? 'stamina-gated' : 'combat-gated',
    startup: envelope.activeStart,
    active: Number((envelope.activeEnd - envelope.activeStart).toFixed(4)),
    recovery: Number((envelope.duration - envelope.activeEnd).toFixed(4)),
    total: envelope.duration,
    staminaCost: envelope.staminaCost,
    invulnerable: false,
    ranged: false,
  });
}

export function resolvePlayerCombatPhaseAtTime(frame: CombatPhaseFrame, elapsedSeconds: number): CombatPhaseReceipt {
  const elapsed = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0);
  const startupEnd = frame.startup;
  const activeEnd = frame.startup + frame.active;
  const normalizedTime = frame.total > 0 ? Math.min(1, elapsed / frame.total) : 1;
  const phase: CombatPhaseName = elapsed < startupEnd
    ? 'startup'
    : elapsed < activeEnd
      ? 'active'
      : elapsed < frame.total
        ? 'recovery'
        : 'complete';
  return freeze({
    phase,
    normalizedTime: Number(normalizedTime.toFixed(4)),
    remaining: Number(Math.max(0, frame.total - elapsed).toFixed(4)),
    invulnerable: frame.invulnerable && phase === 'active',
  });
}

export function isPlayerCombatPhaseFrame(value: unknown): value is CombatPhaseFrame {
  if (!value || typeof value !== 'object') return false;
  const frame = value as CombatPhaseFrame;
  return ['light', 'heavy', 'guard', 'parry', 'dodge', 'ranged'].includes(frame.kind)
    && typeof frame.accepted === 'boolean'
    && typeof frame.reason === 'string'
    && Number.isFinite(frame.total)
    && frame.startup >= 0
    && frame.active >= 0
    && frame.recovery >= 0
    && Math.abs((frame.startup + frame.active + frame.recovery) - frame.total) < 1e-6
    && Object.isFrozen(frame);
}
