/**
 * Read-only resolver for the shipped player attack-window events.
 * Keeps player.js authoritative for timing, movement and damage resolution.
 * @module gameplay/playerAttackWindowResolver
 */

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
};

export const PLAYER_ATTACK_WINDOW_RESOLVER_ID = 'aapw.player.attack-window-resolver.v1';

export function resolvePlayerAttackWindow(input = {}) {
  const phase = typeof input.phase === 'string' ? input.phase : 'unknown';
  const kind = input.kind === 'heavy' ? 'heavy' : input.kind === 'light' ? 'light' : 'none';
  const comboStep = clamp(Math.floor(finite(input.comboStep, 0)), 0, 3);
  const active = Boolean(input.active) && phase === 'active' && kind !== 'none';
  const reachMeters = clamp(finite(input.reachMeters, 0), 0, 8);
  const damageScale = clamp(finite(input.damageScale, 0), 0, 8);
  const facingX = clamp(finite(input.facing?.x, 0), -1, 1);
  const facingZ = clamp(finite(input.facing?.z, 1), -1, 1);
  const facingLength = Math.hypot(facingX, facingZ);
  const normalizedFacing = facingLength > 0 ? { x: facingX / facingLength, z: facingZ / facingLength } : { x: 0, z: 1 };
  const commitRemainingMeters = clamp(finite(input.commitRemainingMeters, 0), 0, reachMeters);
  const evidence = {
    id: PLAYER_ATTACK_WINDOW_RESOLVER_ID,
    owner: 'src/3d/gameplay/player.js',
    phase,
    kind,
    comboStep,
    active,
    accepted: active && reachMeters > 0 && damageScale > 0,
    reachMeters,
    damageScale,
    commitRemainingMeters,
    facing: normalizedFacing,
    source: 'aapw:player-attack-window',
  };
  return freeze(evidence);
}

export function validatePlayerAttackWindowEvidence(value) {
  return Boolean(value && value.id === PLAYER_ATTACK_WINDOW_RESOLVER_ID && value.owner === 'src/3d/gameplay/player.js' && typeof value.accepted === 'boolean' && value.reachMeters >= 0 && value.damageScale >= 0 && value.commitRemainingMeters >= 0 && value.commitRemainingMeters <= value.reachMeters && value.facing && Number.isFinite(value.facing.x) && Number.isFinite(value.facing.z));
}
