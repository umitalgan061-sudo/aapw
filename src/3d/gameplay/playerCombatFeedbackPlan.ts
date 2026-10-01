/**
 * Presentation-only feedback plan over the existing combat/equipment rules.
 * The shipped player state machine remains the authority for mutation, VFX, SFX,
 * camera shake and UI dispatch. This module only projects immutable cues.
 */
import {
  resolvePlayerCombatEnvelope,
  resolvePlayerDefenseRules,
  resolvePlayerHitReaction,
} from './playerEquipmentCombatRules.ts';

const finite = (value: unknown, fallback = 0): number => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const freezeCue = <T extends Record<string, unknown>>(cue: T): Readonly<T> => Object.freeze(cue);

export type CombatFeedbackCue = Readonly<{
  channel: 'attack' | 'guard' | 'parry' | 'dodge' | 'hit' | 'stagger' | 'ranged';
  intensity: number;
  cameraImpulse: number;
  audioKey: string;
  vfxKey: string;
  hapticMs: number;
  priority: number;
}>;

export type PlayerCombatFeedbackPlan = Readonly<{
  version: 1;
  cues: readonly CombatFeedbackCue[];
  dominantCue: CombatFeedbackCue | null;
  replayKey: string;
}>;

const cuePriority = (cue: CombatFeedbackCue): number => cue.priority * 10 + cue.intensity;
const cueChannels = new Set<CombatFeedbackCue['channel']>(['attack', 'guard', 'parry', 'dodge', 'hit', 'stagger', 'ranged']);

const makeCue = (
  channel: CombatFeedbackCue['channel'],
  intensity: number,
  audioKey: string,
  vfxKey: string,
  priority: number,
): CombatFeedbackCue => freezeCue({
  channel,
  intensity: Number(clamp(finite(intensity), 0, 1).toFixed(4)),
  cameraImpulse: Number(clamp(finite(intensity) * (channel === 'stagger' ? 0.2 : 0.12), 0, 0.2).toFixed(4)),
  audioKey,
  vfxKey,
  hapticMs: Math.round(clamp(finite(intensity) * (channel === 'hit' || channel === 'stagger' ? 90 : 45), 0, 110)),
  priority: Math.round(clamp(finite(priority), 0, 9)),
});

const cueSignature = (cue: CombatFeedbackCue): string => [
  cue.channel,
  cue.intensity.toFixed(4),
  cue.cameraImpulse.toFixed(4),
  cue.audioKey,
  cue.vfxKey,
  cue.hapticMs,
  cue.priority,
].join(':');

export function buildPlayerCombatFeedbackPlan(
  profileInput: Record<string, unknown> = {},
  {
    kind = 'light',
    staminaRatio = 1,
    poiseRatio = 1,
    guardInput = false,
    parryWindowOpen = false,
    dodgeInvulnerable = false,
    rangedRelease = false,
    hitRawAmount = 0,
    hitBlockedAmount = 0,
    currentPoise = 100,
    maxPoise = 100,
  }: Record<string, unknown> = {},
): PlayerCombatFeedbackPlan {
  const attack = resolvePlayerCombatEnvelope(profileInput, { kind, staminaRatio, poiseRatio });
  const defense = resolvePlayerDefenseRules(profileInput, {
    staminaRatio,
    poiseRatio,
    guardInput,
    parryWindowOpen,
    dodgeInvulnerable,
  });
  const reaction = resolvePlayerHitReaction(profileInput, {
    rawAmount: hitRawAmount,
    blockedAmount: hitBlockedAmount,
    poise: currentPoise,
    maxPoise,
  });

  const cues: CombatFeedbackCue[] = [];
  if (rangedRelease) cues.push(makeCue('ranged', 0.55 + finite(attack.damageScaleAtCurrentStamina) * 0.08, 'combat.ranged.release', 'combat.ranged.trail', 2));
  else cues.push(makeCue('attack', 0.38 + finite(attack.damageScaleAtCurrentStamina) * 0.12, kind === 'heavy' ? 'combat.heavy.swing' : 'combat.light.swing', kind === 'heavy' ? 'combat.heavy.arc' : 'combat.light.arc', 2));
  if (defense.guardAvailable) cues.push(makeCue('guard', 0.35 + finite(defense.guardDamageMultiplier) * 0.22, 'combat.guard.raise', 'combat.guard.flash', 1));
  if (defense.parryAvailable) cues.push(makeCue('parry', 0.8, 'combat.parry.window', 'combat.parry.sparks', 4));
  if (dodgeInvulnerable) cues.push(makeCue('dodge', 0.65, 'combat.dodge.whoosh', 'combat.dodge.afterimage', 3));
  if (reaction.effectiveImpact > 0) {
    const stagger = Boolean(reaction.staggers);
    cues.push(makeCue(stagger ? 'stagger' : 'hit', clamp(finite(reaction.effectiveImpact) / Math.max(1, finite(maxPoise, 100)), 0.12, 1), stagger ? 'combat.stagger.impact' : 'combat.hit.impact', stagger ? 'combat.stagger.break' : 'combat.hit.spark', stagger ? 5 : 3));
  }

  const ordered = cues.sort((a, b) => cuePriority(b) - cuePriority(a) || a.channel.localeCompare(b.channel));
  const dominantCue = ordered[0] ?? null;
  const replayKey = `v1|${ordered.map(cueSignature).join('|') || 'none'}|dominant=${dominantCue ? cueSignature(dominantCue) : 'none'}`;
  return Object.freeze({
    version: 1,
    cues: Object.freeze(ordered),
    dominantCue,
    replayKey,
  });
}

const isCue = (value: unknown): value is CombatFeedbackCue => {
  if (!value || typeof value !== 'object') return false;
  const cue = value as CombatFeedbackCue;
  return cueChannels.has(cue.channel) &&
    Number.isFinite(cue.intensity) && cue.intensity >= 0 && cue.intensity <= 1 &&
    Number.isFinite(cue.cameraImpulse) && cue.cameraImpulse >= 0 && cue.cameraImpulse <= 0.2 &&
    typeof cue.audioKey === 'string' && typeof cue.vfxKey === 'string' &&
    Number.isInteger(cue.hapticMs) && cue.hapticMs >= 0 && cue.hapticMs <= 110 &&
    Number.isInteger(cue.priority) && cue.priority >= 0 && cue.priority <= 9 &&
    Object.isFrozen(cue);
};

export function isPlayerCombatFeedbackPlan(value: unknown): value is PlayerCombatFeedbackPlan {
  try {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as PlayerCombatFeedbackPlan;
    if (candidate.version !== 1 || !Array.isArray(candidate.cues) || !Object.isFrozen(candidate) || !Object.isFrozen(candidate.cues)) return false;
    if (!candidate.cues.every(isCue)) return false;
    if (candidate.dominantCue !== null && !isCue(candidate.dominantCue)) return false;
    const expectedDominant = candidate.cues[0] ?? null;
    if (candidate.dominantCue !== expectedDominant) return false;
    const expectedReplayKey = `v1|${candidate.cues.map(cueSignature).join('|') || 'none'}|dominant=${expectedDominant ? cueSignature(expectedDominant) : 'none'}`;
    return candidate.replayKey === expectedReplayKey;
  } catch {
    return false;
  }
}
