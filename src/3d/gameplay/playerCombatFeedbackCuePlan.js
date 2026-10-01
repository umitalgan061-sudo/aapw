/**
 * Deterministic presentation cues for the existing player combat pipeline.
 *
 * This module is intentionally side-effect free. It consumes the already-normalized
 * reaction result / combat frame and emits bounded VFX/SFX/UI cue metadata for the
 * existing runtime owners. It does not mutate player state, scene objects, mixers,
 * inventory, terrain or AI.
 *
 * @module gameplay/playerCombatFeedbackCuePlan
 */

const MAX_TEXT = 96;
const MAX_NUMBER = 1000;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeId = (value, fallback = '') => {
  const id = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').slice(0, MAX_TEXT);
  return id || fallback;
};
const normalizeText = (value, fallback = '') => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT) || fallback;

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

const REACTION_TO_CUE = freezeDeep({
  hit: { channel: 'impact', intensity: 0.72, vfx: 'impact-contact', sfx: 'combat-hit', ui: 'health-loss' },
  blocked: { channel: 'guard', intensity: 0.58, vfx: 'guard-spark', sfx: 'shield-block', ui: 'guard-contact' },
  parried: { channel: 'parry', intensity: 0.86, vfx: 'parry-flash', sfx: 'parry-ring', ui: 'parry-confirmed' },
  dodged: { channel: 'dodge', intensity: 0.42, vfx: 'dodge-whoosh', sfx: 'dodge-whoosh', ui: 'dodge-confirmed' },
  miss: { channel: 'miss', intensity: 0.18, vfx: null, sfx: 'combat-swish', ui: null },
});

const ATTACK_CUE = freezeDeep({
  light: { vfx: 'weapon-trail-light', sfx: 'weapon-swing-light' },
  heavy: { vfx: 'weapon-trail-heavy', sfx: 'weapon-swing-heavy' },
});

function normalizeReaction(value) {
  const reaction = normalizeId(value, 'miss');
  return REACTION_TO_CUE[reaction] ? reaction : 'miss';
}

function normalizeAttackKind(value) {
  const kind = normalizeId(value, 'none');
  return ATTACK_CUE[kind] ? kind : 'none';
}

function normalizeHitStrength(value, reaction) {
  const fallback = reaction === 'parried' ? 0.9 : reaction === 'blocked' ? 0.62 : reaction === 'hit' ? 0.76 : 0.25;
  return clamp(finiteOr(value, fallback), 0, 1);
}

export function buildPlayerCombatFeedbackCuePlan({
  reaction = 'miss',
  attackKind = 'none',
  comboStep = 0,
  hitStrength = null,
  critical = false,
  targetId = null,
  weaponId = null,
  source = 'player',
} = {}) {
  const normalizedReaction = normalizeReaction(reaction);
  const normalizedAttack = normalizeAttackKind(attackKind);
  const reactionCue = REACTION_TO_CUE[normalizedReaction];
  const attackCue = ATTACK_CUE[normalizedAttack] || null;
  const strength = normalizeHitStrength(hitStrength, normalizedReaction);
  const combo = clamp(Math.floor(finiteOr(comboStep, 0)), 0, 3);
  const criticalFlag = Boolean(critical) && normalizedReaction === 'hit';
  const intensity = clamp(reactionCue.intensity * (0.82 + strength * 0.36) * (criticalFlag ? 1.18 : 1), 0, 1);

  const cues = [];
  if (attackCue) {
    cues.push({ channel: 'attack', vfx: attackCue.vfx, sfx: attackCue.sfx, intensity: clamp(0.42 + combo * 0.08, 0, 1) });
  }
  if (reactionCue.vfx || reactionCue.sfx || reactionCue.ui) {
    cues.push({ channel: reactionCue.channel, vfx: reactionCue.vfx, sfx: reactionCue.sfx, ui: reactionCue.ui, intensity });
  }

  return freezeDeep({
    version: 1,
    source: normalizeId(source, 'player'),
    reaction: normalizedReaction,
    attackKind: normalizedAttack,
    comboStep: combo,
    targetId: targetId == null ? null : normalizeId(targetId, 'target'),
    weaponId: weaponId == null ? null : normalizeId(weaponId, 'weapon'),
    critical: criticalFlag,
    hitStrength: strength,
    primary: {
      channel: reactionCue.channel,
      intensity,
      vfx: reactionCue.vfx,
      sfx: reactionCue.sfx,
      ui: reactionCue.ui,
    },
    cues,
    presentation: {
      cameraShake: clamp(intensity * (normalizedReaction === 'parried' ? 0.55 : 0.28), 0, 0.7),
      hitStopSeconds: clamp(intensity * (normalizedReaction === 'parried' ? 0.045 : normalizedReaction === 'hit' ? 0.032 : 0.018), 0, 0.06),
      flashAlpha: clamp(intensity * (criticalFlag ? 0.9 : 0.58), 0, 1),
    },
  });
}

export function serializePlayerCombatFeedbackCuePlan(plan) {
  return JSON.stringify(plan);
}

export function validatePlayerCombatFeedbackCuePlan(plan) {
  const primary = plan?.primary || {};
  const values = [plan?.hitStrength, primary.intensity, plan?.presentation?.cameraShake, plan?.presentation?.hitStopSeconds, plan?.presentation?.flashAlpha];
  return Boolean(plan && plan.version === 1 && values.every((value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= MAX_NUMBER) && Array.isArray(plan.cues));
}
