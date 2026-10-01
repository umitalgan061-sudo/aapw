/**
 * Deterministic contact resolver for the existing player combat pipeline.
 * Consumes caller-owned attack window and target snapshots; never mutates scene/state.
 * @module gameplay/playerCombatContactResolver
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeId = (value) => String(value ?? '').trim().slice(0, 96);

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

function distanceXZ(a, b) {
  return Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z));
}

function facingDot(origin, target, facing) {
  const dx = finite(target?.x) - finite(origin?.x);
  const dz = finite(target?.z) - finite(origin?.z);
  const length = Math.hypot(dx, dz);
  if (!(length > 0)) return 1;
  const fx = finite(facing?.x, 0);
  const fz = finite(facing?.z, 1);
  const facingLength = Math.hypot(fx, fz) || 1;
  return clamp((dx * fx + dz * fz) / (length * facingLength), -1, 1);
}

function normalizeTarget(target, index) {
  return {
    id: normalizeId(target?.id) || `target-${index + 1}`,
    x: finite(target?.x),
    z: finite(target?.z),
    radiusMeters: clamp(finite(target?.radiusMeters, 0.35), 0.05, 2.5),
    invulnerable: Boolean(target?.invulnerable),
    hostile: target?.hostile !== false,
    active: target?.active !== false,
  };
}

export function resolveCombatContacts({
  attack = {},
  attacker = {},
  targets = [],
  maxContacts = 4,
} = {}) {
  const origin = { x: finite(attacker?.x), z: finite(attacker?.z) };
  const facing = { x: finite(attacker?.facing?.x), z: finite(attacker?.facing?.z, 1) };
  const reachMeters = clamp(finite(attack?.reachMeters, 0), 0, 12);
  const active = Boolean(attack?.active);
  const attackSerial = Math.max(0, Math.floor(finite(attack?.serial)));
  const comboStep = clamp(Math.floor(finite(attack?.comboStep, 1)), 1, 3);
  const damageScale = clamp(finite(attack?.damageScale, 1), 0, 10);
  const minFacingDot = clamp(finite(attack?.minFacingDot, 0.1), -1, 1);
  const list = Array.isArray(targets) ? targets.slice(0, 64).map(normalizeTarget) : [];
  const contacts = [];
  if (active && reachMeters > 0) {
    for (const target of list) {
      if (!target.active || !target.hostile || target.invulnerable) continue;
      const distanceMeters = distanceXZ(origin, target);
      const contactDistance = reachMeters + target.radiusMeters;
      const dot = facingDot(origin, target, facing);
      if (distanceMeters > contactDistance || dot < minFacingDot) continue;
      contacts.push({
        targetId: target.id,
        distanceMeters: Number(distanceMeters.toFixed(4)),
        facingDot: Number(dot.toFixed(4)),
        damageScale: Number(damageScale.toFixed(4)),
        comboStep,
      });
    }
  }
  contacts.sort((a, b) => b.facingDot - a.facingDot || a.distanceMeters - b.distanceMeters || a.targetId.localeCompare(b.targetId));
  const bounded = contacts.slice(0, clamp(Math.floor(finite(maxContacts, 4)), 1, 8));
  return freezeDeep({
    attackSerial,
    active,
    hitCount: bounded.length,
    contacts: bounded,
    source: 'player-combat-contact-resolver',
  });
}

export function serializeCombatContacts(snapshot) {
  return JSON.stringify(snapshot ?? resolveCombatContacts());
}
