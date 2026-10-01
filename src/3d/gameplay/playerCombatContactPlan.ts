/**
 * Deterministic combat contact projection over existing player authorities.
 * No scene, mixer, collider or combat-state mutation occurs here.
 */
import { resolvePlayerCombatEnvelope, buildPlayerHitboxHurtboxContract } from './playerEquipmentCombatRules.ts';

const clamp = (value: unknown, min: number, max: number): number => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : min));
const finite = (value: unknown, fallback = 0): number => Number.isFinite(Number(value)) ? Number(value) : fallback;
const freeze = <T>(value: T): T => Object.freeze(value);

export type PlayerCombatContactInput = {
  profile?: Record<string, unknown>;
  kind?: 'light' | 'heavy';
  grounded?: boolean;
  groundConfidence?: number;
  groundY?: number;
  visualY?: number;
  colliderY?: number;
  crouching?: boolean;
  stance?: 'neutral' | 'guard';
  staminaRatio?: number;
  poiseRatio?: number;
};

export function resolvePlayerCombatContactPlan(input: PlayerCombatContactInput = {}) {
  const grounded = input.grounded !== false;
  const confidence = clamp(input.groundConfidence, 0, 1);
  const groundY = finite(input.groundY, 0);
  const visualY = finite(input.visualY, groundY);
  const colliderY = finite(input.colliderY, groundY);
  const visualGroundDelta = Number((visualY - groundY).toFixed(4));
  const colliderGroundDelta = Number((colliderY - groundY).toFixed(4));
  const visualColliderDelta = Number((visualY - colliderY).toFixed(4));
  const envelope = resolvePlayerCombatEnvelope(input.profile ?? {}, {
    kind: input.kind === 'heavy' ? 'heavy' : 'light',
    staminaRatio: input.staminaRatio,
    poiseRatio: input.poiseRatio,
  });
  const boxes = buildPlayerHitboxHurtboxContract(input.profile ?? {}, {
    grounded,
    crouching: Boolean(input.crouching),
    attackKind: input.kind === 'heavy' ? 'heavy' : 'light',
    stance: input.stance === 'guard' ? 'guard' : 'neutral',
  });
  const groundedContact = grounded && confidence >= 0.6 && Math.abs(visualGroundDelta) <= 0.025 && Math.abs(colliderGroundDelta) <= 0.025;
  const paritySafe = groundedContact && Math.abs(visualColliderDelta) <= 0.04;
  const contactWeight = grounded ? Number((confidence * (paritySafe ? 1 : 0.35)).toFixed(4)) : 0;
  const status = !grounded ? 'airborne' : paritySafe ? 'stable' : 'unsafe';
  const key = [
    'contact-v1',
    input.kind === 'heavy' ? 'heavy' : 'light',
    status,
    Math.round(contactWeight * 1000),
    Math.round(envelope.reach * 1000),
    Math.round(boxes.hurtbox.height * 1000),
  ].join('|');
  return freeze({
    version: 1,
    status,
    grounded,
    groundConfidence: confidence,
    contactWeight,
    visualGroundDelta,
    colliderGroundDelta,
    visualColliderDelta,
    parity: freeze({ safe: paritySafe, maxVisualColliderDeltaMeters: 0.04, maxGroundDeltaMeters: 0.025 }),
    combat: freeze({ kind: input.kind === 'heavy' ? 'heavy' : 'light', reachMeters: envelope.reach, staminaRatio: envelope.staminaRatio, poiseRatio: envelope.poiseRatio }),
    boxes,
    key,
  });
}

export function isPlayerCombatContactPlan(value: unknown): boolean {
  try {
    if (!value || typeof value !== 'object') return false;
    const plan = value as Record<string, any>;
    return plan.version === 1
      && (plan.status === 'stable' || plan.status === 'unsafe' || plan.status === 'airborne')
      && typeof plan.key === 'string'
      && Boolean(plan.parity && typeof plan.parity.safe === 'boolean')
      && Boolean(plan.boxes && plan.boxes.hurtbox && plan.boxes.hitbox)
      && Object.isFrozen(plan)
      && Object.isFrozen(plan.parity)
      && Object.isFrozen(plan.boxes);
  } catch {
    return false;
  }
}
