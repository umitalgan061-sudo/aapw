/**
 * Deterministic hitbox/hurtbox projection for the existing player combat seam.
 * The caller owns colliders, scene objects, animation and state mutation.
 * @module gameplay/playerCombatHitboxHurtboxDirector
 */

const BOX_KINDS = new Set(['hitbox', 'hurtbox']);
const VALID_ACTIONS = new Set(['light', 'heavy', 'dodge', 'guard', 'parry', 'ranged']);

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const normalizeId = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 64) : fallback;
const normalizeVec3 = (value) => ({ x: finite(value?.x), y: finite(value?.y), z: finite(value?.z) });
const distanceSq = (a, b) => ((a.x - b.x) ** 2) + ((a.y - b.y) ** 2) + ((a.z - b.z) ** 2);
const freezeDeep = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
};

function normalizeBox(box, index, defaultKind) {
  const kind = BOX_KINDS.has(box?.kind) ? box.kind : defaultKind;
  const center = normalizeVec3(box?.center);
  const radius = clamp(box?.radius, 0.05, 3);
  const halfHeight = clamp(box?.halfHeight, 0, 3);
  return { id: normalizeId(box?.id, `${kind}-${index}`), kind, center, radius, halfHeight, enabled: box?.enabled !== false };
}

function overlaps(a, b) {
  const vertical = Math.abs(a.center.y - b.center.y) <= a.halfHeight + b.halfHeight;
  const reach = a.radius + b.radius;
  return vertical && distanceSq(a.center, b.center) <= reach * reach;
}

export function resolvePlayerCombatHitboxHurtbox({
  action = 'light',
  hitboxes = [],
  hurtboxes = [],
  origin = { x: 0, y: 0, z: 0 },
  maxContacts = 8,
} = {}) {
  const normalizedAction = VALID_ACTIONS.has(action) ? action : 'light';
  const normalizedOrigin = normalizeVec3(origin);
  const sourceBoxes = Array.isArray(hitboxes) ? hitboxes.map((box, index) => normalizeBox(box, index, 'hitbox')).filter((box) => box.enabled) : [];
  const targetBoxes = Array.isArray(hurtboxes) ? hurtboxes.map((box, index) => normalizeBox(box, index, 'hurtbox')).filter((box) => box.enabled) : [];
  const contacts = [];

  for (const hitbox of sourceBoxes) {
    for (const hurtbox of targetBoxes) {
      if (!overlaps(hitbox, hurtbox)) continue;
      contacts.push({
        hitboxId: hitbox.id,
        hurtboxId: hurtbox.id,
        distanceMeters: Math.sqrt(distanceSq(hitbox.center, hurtbox.center)),
        sourceOffsetMeters: Math.sqrt(distanceSq(normalizedOrigin, hitbox.center)),
      });
    }
  }

  contacts.sort((left, right) => left.distanceMeters - right.distanceMeters || left.hitboxId.localeCompare(right.hitboxId) || left.hurtboxId.localeCompare(right.hurtboxId));
  const boundedContacts = contacts.slice(0, Math.max(0, Math.min(16, Math.floor(finite(maxContacts, 8)))));
  const result = {
    version: 1,
    action: normalizedAction,
    active: sourceBoxes.length > 0,
    contactCount: boundedContacts.length,
    contacts: boundedContacts,
    origin: normalizedOrigin,
    failClosed: !Array.isArray(hitboxes) || !Array.isArray(hurtboxes),
  };
  return freezeDeep(result);
}

export function stableSerializePlayerCombatHitboxHurtbox(value) {
  return JSON.stringify(value, Object.keys(value || {}).sort());
}
