/**
 * Deterministic combat volume contract over caller-owned player observations.
 * Geometry/collider owners remain responsible for actual collision queries.
 * @module gameplay/playerHitboxHurtboxContract
 */

const LIMITS = Object.freeze({
  maxVolumes: 16,
  maxRadius: 4,
  maxHeight: 6,
  maxReach: 6,
});

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const idOf = (value, fallback) => String(value ?? fallback).trim() || fallback;
const normKind = (value) => value === 'hurtbox' ? 'hurtbox' : 'hitbox';

function normalizeVolume(raw, index) {
  const volume = raw && typeof raw === 'object' ? raw : {};
  const kind = normKind(volume.kind);
  const radius = clamp(Math.abs(finite(volume.radius, 0.35)), 0.01, LIMITS.maxRadius);
  const height = clamp(Math.abs(finite(volume.height, radius * 2)), 0.01, LIMITS.maxHeight);
  const reach = clamp(Math.abs(finite(volume.reach, 0)), 0, LIMITS.maxReach);
  return Object.freeze({
    id: idOf(volume.id, `${kind}-${index}`),
    kind,
    tag: idOf(volume.tag, kind),
    radius,
    height,
    reach,
    bone: idOf(volume.bone, 'root'),
    enabled: volume.enabled !== false,
    priority: clamp(Math.floor(finite(volume.priority, 0)), -100, 100),
  });
}

function stableVolumeSort(a, b) {
  return b.priority - a.priority || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id);
}

export function createPlayerHitboxHurtboxContract(observation = {}) {
  const source = observation && typeof observation === 'object' ? observation : {};
  const rawVolumes = Array.isArray(source.volumes) ? source.volumes : [];
  const volumes = rawVolumes.slice(0, LIMITS.maxVolumes).map(normalizeVolume).sort(stableVolumeSort);
  const hitboxes = volumes.filter((volume) => volume.kind === 'hitbox' && volume.enabled);
  const hurtboxes = volumes.filter((volume) => volume.kind === 'hurtbox' && volume.enabled);
  const attack = source.attack && typeof source.attack === 'object' ? source.attack : {};
  const active = attack.active === true;
  const attackReach = clamp(Math.abs(finite(attack.reach, 0)), 0, LIMITS.maxReach);
  const phase = idOf(attack.phase, active ? 'active' : 'inactive');
  const accepted = active && hitboxes.length > 0 && attackReach > 0;
  const rejectedReason = accepted ? null : (!active ? 'attack-inactive' : hitboxes.length === 0 ? 'no-enabled-hitbox' : 'zero-reach');
  const payload = {
    schema: 'aapw.player-hitbox-hurtbox.v1',
    playerId: idOf(source.playerId, 'player'),
    attack: Object.freeze({ active, phase, reach: attackReach, serial: Math.max(0, Math.floor(finite(attack.serial, 0))) }),
    hitboxes: Object.freeze(hitboxes),
    hurtboxes: Object.freeze(hurtboxes),
    counts: Object.freeze({ total: volumes.length, hitboxes: hitboxes.length, hurtboxes: hurtboxes.length }),
    resolution: Object.freeze({ accepted, rejectedReason, queryMode: accepted ? 'caller-owned-volume-test' : 'none' }),
    ownership: Object.freeze({ geometry: 'caller-owned', collider: 'caller-owned', damage: 'existing-health-and-combat-owner' }),
  };
  return deepFreeze(payload);
}

export function validatePlayerHitboxHurtboxContract(contract) {
  const value = contract && typeof contract === 'object' ? contract : {};
  const counts = value.counts ?? {};
  return Object.freeze({
    valid: value.schema === 'aapw.player-hitbox-hurtbox.v1' && Number.isInteger(counts.total) && counts.total >= 0 && counts.total <= LIMITS.maxVolumes && Array.isArray(value.hitboxes) && Array.isArray(value.hurtboxes) && value.ownership?.geometry === 'caller-owned',
    reasons: Object.freeze([
      ...(value.schema === 'aapw.player-hitbox-hurtbox.v1' ? [] : ['schema']),
      ...(Array.isArray(value.hitboxes) ? [] : ['hitboxes']),
      ...(Array.isArray(value.hurtboxes) ? [] : ['hurtboxes']),
      ...(value.ownership?.geometry === 'caller-owned' ? [] : ['geometry-ownership']),
    ]),
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const PLAYER_HITBOX_HURTBOX_LIMITS = LIMITS;
