/** Production TypeScript owner for a deterministic player combat interaction bridge. */
// @ts-nocheck

import { buildPlayerHitboxHurtboxContract, resolvePlayerCombatEnvelope } from './playerEquipmentCombatRules.ts';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const distance2D = (a, b) => Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z));
const normalize = (x, z) => {
  const length = Math.hypot(x, z);
  return length > 1e-6 ? { x: x / length, z: z / length } : { x: 0, z: 1 };
};
const freeze = (value) => Object.freeze(value);

/**
 * Resolves non-mutating hit intents against an existing target snapshot list.
 * The shipped player state machine remains the only authority for damage/poise mutation.
 */
export function resolvePlayerCombatInteractionFrame({
  equipment = {},
  attackKind = 'light',
  comboStep = 1,
  origin = { x: 0, y: 0, z: 0 },
  facing = { x: 0, z: 1 },
  targets = [],
  staminaRatio = 1,
  grounded = true,
  stance = 'neutral',
} = {}) {
  const profile = equipment?.mainHand ? equipment : equipment;
  const envelope = resolvePlayerCombatEnvelope(profile, { kind: attackKind, staminaRatio });
  const contract = buildPlayerHitboxHurtboxContract(profile, { grounded, attackKind, stance });
  const direction = normalize(facing?.x, facing?.z);
  const maxReach = Math.max(0.1, finite(contract.hitbox?.activeReachMeters, envelope.reach));
  const halfArc = clamp(0.62 + (comboStep - 1) * 0.04, 0.55, 0.78);
  const candidates = [];

  for (const target of Array.isArray(targets) ? targets : []) {
    if (!target || target.id == null || target.alive === false || !target.position) continue;
    const targetPosition = target.position;
    const offset = { x: finite(targetPosition.x) - finite(origin.x), z: finite(targetPosition.z) - finite(origin.z) };
    const distance = Math.hypot(offset.x, offset.z);
    if (distance > maxReach) continue;
    const toTarget = normalize(offset.x, offset.z);
    const dot = direction.x * toTarget.x + direction.z * toTarget.z;
    if (distance > 1e-5 && dot < halfArc) continue;
    const proximity = clamp(1 - distance / maxReach, 0, 1);
    const facingScore = clamp((dot + 1) / 2, 0, 1);
    const priority = clamp(finite(target.priority, 0), 0, 1);
    const blockedBy = Array.isArray(target.blockedBy) ? target.blockedBy : [];
    const guard = target.guard === true;
    const blocked = guard && blockedBy.includes(attackKind);
    const rawDamage = Math.max(0, finite(target.damageTakenMultiplier, 1)) * envelope.damageScaleAtCurrentStamina;
    const damage = blocked ? 0 : Number((rawDamage * (0.72 + proximity * 0.18 + facingScore * 0.1)).toFixed(4));
    const impact = Number((envelope.staggerPressure * (blocked ? 0.45 : 1) * (0.7 + proximity * 0.3)).toFixed(4));
    candidates.push({
      id: String(target.id),
      distance: Number(distance.toFixed(4)),
      score: Number((proximity * 0.5 + facingScore * 0.35 + priority * 0.15).toFixed(6)),
      blocked,
      outcome: blocked ? 'blocked' : 'hit',
      damage,
      poiseImpact: impact,
      hitPosition: freeze({ x: Number(targetPosition.x.toFixed(4)), y: Number(finite(targetPosition.y)).toFixed(4), z: Number(targetPosition.z.toFixed(4)) }),
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.distance - b.distance || a.id.localeCompare(b.id));
  const intents = candidates.map((candidate, index) => freeze({
    ...candidate,
    ordinal: index,
    comboStep: Math.max(1, Math.floor(finite(comboStep, 1))),
    attackKind: attackKind === 'heavy' ? 'heavy' : 'light',
  }));
  return freeze({
    version: 1,
    attackKind: attackKind === 'heavy' ? 'heavy' : 'light',
    comboStep: Math.max(1, Math.floor(finite(comboStep, 1))),
    hitbox: contract.hitbox,
    hurtbox: contract.hurtbox,
    reachMeters: maxReach,
    targetsConsidered: Array.isArray(targets) ? targets.length : 0,
    intents: freeze(intents),
    hasContact: intents.length > 0,
    origin: freeze({ x: finite(origin.x), y: finite(origin.y), z: finite(origin.z) }),
    facing: freeze({ x: Number(direction.x.toFixed(4)), z: Number(direction.z.toFixed(4)) }),
  });
}

export function validatePlayerCombatInteractionFrame(frame) {
  const errors = [];
  if (!frame || frame.version !== 1) errors.push('invalid-version');
  if (!Array.isArray(frame?.intents)) errors.push('missing-intents');
  if (frame?.intents?.some((intent) => intent.ordinal < 0)) errors.push('invalid-ordinal');
  if (frame?.intents?.some((intent) => intent.damage < 0 || intent.poiseImpact < 0)) errors.push('negative-impact');
  if (frame?.hasContact !== Boolean(frame?.intents?.length)) errors.push('contact-mismatch');
  return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}
