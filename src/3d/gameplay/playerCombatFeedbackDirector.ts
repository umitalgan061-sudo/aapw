/**
 * Typed presentation adapter for combat feedback.
 *
 * The existing player state machine remains the authority for damage, poise,
 * block/parry/dodge and animation state. This module only derives a bounded,
 * immutable feedback frame for VFX/SFX/UI consumers.
 */
import {
  resolvePlayerDefenseRules,
  resolvePlayerHitReaction,
} from './playerEquipmentCombatRules.ts';

const clamp = (value: unknown, min: number, max: number, fallback = min): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
};

const freeze = <T>(value: T): T => Object.freeze(value);

export type CombatFeedbackKind = 'blocked' | 'parried' | 'dodged' | 'hit' | 'staggered' | 'guard-break';

export interface CombatFeedbackInput {
  rawAmount?: number;
  blockedAmount?: number;
  poise?: number;
  maxPoise?: number;
  staminaRatio?: number;
  poiseRatio?: number;
  guardInput?: boolean;
  parryWindowOpen?: boolean;
  dodgeInvulnerable?: boolean;
  sourceDistanceMeters?: number;
  sourceAngleRad?: number;
  attackKind?: 'light' | 'heavy';
  hitStopSeconds?: number;
  nowMs?: number;
}

export interface PlayerCombatFeedbackFrame {
  kind: CombatFeedbackKind;
  impact: Readonly<{
    rawAmount: number;
    blockedAmount: number;
    effectiveImpact: number;
    poiseAfter: number;
    staggerSeverity: number;
  }>;
  presentation: Readonly<{
    intensity: number;
    hitStopSeconds: number;
    cameraImpulse: number;
    vfxTier: 'none' | 'light' | 'medium' | 'heavy';
    sfxCue: 'none' | 'block' | 'parry' | 'dodge' | 'impact' | 'stagger' | 'guard-break';
  }>;
  telemetry: Readonly<{
    sourceDistanceMeters: number;
    sourceAngleRad: number;
    attackKind: 'light' | 'heavy';
    emittedAtMs: number;
  }>;
}

const pickKind = ({
  parryAvailable,
  dodgeInvulnerable,
  guardAvailable,
  blockedAmount,
  staggered,
  guardBreakRisk,
  effectiveImpact,
}: ReturnType<typeof resolvePlayerDefenseRules> & ReturnType<typeof resolvePlayerHitReaction>): CombatFeedbackKind => {
  if (parryAvailable) return 'parried';
  if (dodgeInvulnerable) return 'dodged';
  if (guardAvailable && blockedAmount > 0 && effectiveImpact === 0) return 'blocked';
  if (staggered) return guardBreakRisk >= 0.72 ? 'guard-break' : 'staggered';
  return 'hit';
};

export function derivePlayerCombatFeedbackFrame(
  profileInput: Record<string, unknown> = {},
  input: CombatFeedbackInput = {},
): PlayerCombatFeedbackFrame {
  const defense = resolvePlayerDefenseRules(profileInput, {
    staminaRatio: clamp(input.staminaRatio, 0, 1, 1),
    poiseRatio: clamp(input.poiseRatio, 0, 1, 1),
    guardInput: Boolean(input.guardInput),
    parryWindowOpen: Boolean(input.parryWindowOpen),
    dodgeInvulnerable: Boolean(input.dodgeInvulnerable),
  });
  const impact = resolvePlayerHitReaction(profileInput, {
    rawAmount: clamp(input.rawAmount, 0, 100000, 0),
    blockedAmount: clamp(input.blockedAmount, 0, 100000, 0),
    poise: clamp(input.poise, 0, 100000, 100),
    maxPoise: clamp(input.maxPoise, 1, 100000, 100),
  });
  const kind = pickKind({ ...defense, ...impact });
  const rawIntensity = impact.effectiveImpact / Math.max(1, Number(input.maxPoise) || 100);
  const intensity = Number(clamp(rawIntensity + (kind === 'parried' ? 0.28 : kind === 'guard-break' ? 0.22 : 0), 0, 1, 0).toFixed(4));
  const tier = intensity <= 0 ? 'none' : intensity < 0.25 ? 'light' : intensity < 0.6 ? 'medium' : 'heavy';
  const cue = kind === 'parried' ? 'parry' : kind === 'dodged' ? 'dodge' : kind === 'blocked' ? 'block' : kind === 'staggered' ? 'stagger' : kind === 'guard-break' ? 'guard-break' : 'impact';
  return freeze({
    kind,
    impact: freeze({
      rawAmount: impact.rawAmount,
      blockedAmount: impact.blockedAmount,
      effectiveImpact: impact.effectiveImpact,
      poiseAfter: impact.poiseAfter,
      staggerSeverity: impact.staggerSeverity,
    }),
    presentation: freeze({
      intensity,
      hitStopSeconds: Number(clamp(input.hitStopSeconds, 0, 0.22, kind === 'heavy' ? 0.09 : 0.05).toFixed(3)),
      cameraImpulse: Number(clamp(intensity * (kind === 'parried' ? 0.55 : 0.35), 0, 0.65, 0).toFixed(4)),
      vfxTier: tier,
      sfxCue: cue,
    }),
    telemetry: freeze({
      sourceDistanceMeters: Number(clamp(input.sourceDistanceMeters, 0, 64, 0).toFixed(3)),
      sourceAngleRad: Number(clamp(input.sourceAngleRad, 0, Math.PI, Math.PI).toFixed(4)),
      attackKind: input.attackKind === 'heavy' ? 'heavy' : 'light',
      emittedAtMs: Math.max(0, Math.floor(Number(input.nowMs) || 0)),
    }),
  });
}

export const isPlayerCombatFeedbackFrame = (value: unknown): value is PlayerCombatFeedbackFrame => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as PlayerCombatFeedbackFrame;
  return Object.isFrozen(candidate)
    && Object.isFrozen(candidate.impact)
    && Object.isFrozen(candidate.presentation)
    && Object.isFrozen(candidate.telemetry)
    && typeof candidate.kind === 'string'
    && typeof candidate.presentation.intensity === 'number';
};
