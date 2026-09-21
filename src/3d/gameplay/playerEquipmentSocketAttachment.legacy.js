/**
 * Deterministic socket attachment descriptors for player equipment.
 *
 * This is a pure transform/descriptor layer for the existing equipment socket plan. It does not
 * add or own an inventory, scene lifecycle, animation mixer or combat state machine. Consumers can
 * apply the returned local transform to an already-loaded equipment object after resolving the
 * canonical socket node from `playerEquipmentCombatProfile.js`.
 *
 * @module gameplay/playerEquipmentSocketAttachment
 */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positive = (value, fallback = 1) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const freeze = (value) => Object.freeze(value);

export const PLAYER_SOCKET_DEFAULTS = freeze({
  head: freeze({ position: { x: 0, y: 0.02, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 }),
  chest: freeze({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 }),
  back: freeze({ position: { x: 0, y: -0.03, z: -0.08 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 }),
  mainHand: freeze({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 }),
  offHand: freeze({ position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 }),
});

export const PLAYER_SOCKET_LIMITS = freeze({
  positionMeters: 1.5,
  rotationRadians: Math.PI * 2,
  scale: freeze({ min: 0.15, max: 4 }),
});

const SLOT_ALIASES = freeze({
  head: freeze(['head', 'helmet', 'helm', 'hat']),
  chest: freeze(['chest', 'torso', 'body', 'armor', 'armour']),
  back: freeze(['back', 'quiver', 'cape', 'shield-back', 'weapon-back']),
  mainHand: freeze(['mainhand', 'main-hand', 'weapon', 'right-hand', 'righthand']),
  offHand: freeze(['offhand', 'off-hand', 'left-hand', 'lefthand', 'shield']),
});

function normalizeSlot(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  for (const [slot, aliases] of Object.entries(SLOT_ALIASES)) {
    if (aliases.includes(normalized)) return slot;
  }
  return null;
}

function vector3(value, fallback) {
  const source = value && typeof value === 'object' ? value : fallback;
  return {
    x: clamp(finite(source?.x, fallback.x), -PLAYER_SOCKET_LIMITS.positionMeters, PLAYER_SOCKET_LIMITS.positionMeters),
    y: clamp(finite(source?.y, fallback.y), -PLAYER_SOCKET_LIMITS.positionMeters, PLAYER_SOCKET_LIMITS.positionMeters),
    z: clamp(finite(source?.z, fallback.z), -PLAYER_SOCKET_LIMITS.positionMeters, PLAYER_SOCKET_LIMITS.positionMeters),
  };
}

function euler(value, fallback) {
  const source = value && typeof value === 'object' ? value : fallback;
  const wrap = (radians) => {
    const twoPi = Math.PI * 2;
    let value = finite(radians, 0);
    value %= twoPi;
    if (value > Math.PI) value -= twoPi;
    if (value < -Math.PI) value += twoPi;
    return clamp(value, -PLAYER_SOCKET_LIMITS.rotationRadians, PLAYER_SOCKET_LIMITS.rotationRadians);
  };
  return { x: wrap(source?.x), y: wrap(source?.y), z: wrap(source?.z) };
}

function transformFrom(defaults, override) {
  const source = override && typeof override === 'object' ? override : {};
  const scaleSource = source.scale;
  const uniformScale = clamp(positive(typeof scaleSource === 'number' ? scaleSource : source.uniformScale, defaults.scale), PLAYER_SOCKET_LIMITS.scale.min, PLAYER_SOCKET_LIMITS.scale.max);
  const scale = typeof scaleSource === 'object'
    ? {
        x: clamp(positive(scaleSource.x, uniformScale), PLAYER_SOCKET_LIMITS.scale.min, PLAYER_SOCKET_LIMITS.scale.max),
        y: clamp(positive(scaleSource.y, uniformScale), PLAYER_SOCKET_LIMITS.scale.min, PLAYER_SOCKET_LIMITS.scale.max),
        z: clamp(positive(scaleSource.z, uniformScale), PLAYER_SOCKET_LIMITS.scale.min, PLAYER_SOCKET_LIMITS.scale.max),
      }
    : { x: uniformScale, y: uniformScale, z: uniformScale };
  return {
    position: vector3(source.position, defaults.position),
    rotation: euler(source.rotation, defaults.rotation),
    scale,
  };
}

function cloneTransform(transform) {
  return freeze({
    position: freeze({ ...transform.position }),
    rotation: freeze({ ...transform.rotation }),
    scale: freeze({ ...transform.scale }),
  });
}

export function normalizePlayerSocketOverrides(overrides = {}) {
  const result = {};
  for (const [rawSlot, value] of Object.entries(overrides || {})) {
    const slot = normalizeSlot(rawSlot);
    if (!slot) continue;
    result[slot] = cloneTransform(transformFrom(PLAYER_SOCKET_DEFAULTS[slot], value));
  }
  return freeze(result);
}

export function resolvePlayerSocketAttachment(slotInput, item = {}, { overrides = {}, mirrored = false } = {}) {
  const slot = normalizeSlot(slotInput);
  if (!slot) return freeze({ ok: false, error: 'unsupported-socket' });
  const normalizedOverrides = normalizePlayerSocketOverrides(overrides);
  const itemTransform = item?.attachment ?? item?.socketTransform ?? item?.transform ?? {};
  const overrideTransform = normalizedOverrides[slot] || null;
  let transform = transformFrom(PLAYER_SOCKET_DEFAULTS[slot], itemTransform);
  if (overrideTransform) {
    transform = transformFrom(transform, overrideTransform);
  }
  if (mirrored && (slot === 'mainHand' || slot === 'offHand')) {
    transform = {
      position: { x: -transform.position.x, y: transform.position.y, z: transform.position.z },
      rotation: { x: transform.rotation.x, y: -transform.rotation.y, z: -transform.rotation.z },
      scale: { x: transform.scale.x, y: transform.scale.y, z: transform.scale.z },
    };
  }
  return freeze({
    ok: true,
    slot,
    socketName: String(item?.socketName ?? item?.attachmentSocket ?? slot),
    itemId: String(item?.id ?? item?.itemId ?? item?.equipmentId ?? 'none'),
    transform: cloneTransform(transform),
    inheritScale: item?.inheritScale !== false,
    visible: item?.visible !== false,
  });
}

export function buildPlayerSocketAttachmentPlan(profile, { overrides = {}, rootScale = 1 } = {}) {
  const resolved = profile?.slots ? profile : null;
  const slots = resolved?.slots || {};
  const plan = {};
  for (const slot of Object.keys(PLAYER_SOCKET_DEFAULTS)) {
    const item = slots[slot];
    if (!item) {
      plan[slot] = null;
      continue;
    }
    plan[slot] = resolvePlayerSocketAttachment(slot, item, { overrides });
  }
  const scale = clamp(positive(rootScale, 1), 0.25, 2.5);
  return freeze({
    version: 1,
    rootScale: scale,
    bindings: freeze(plan),
  });
}

export function applyPlayerSocketAttachment(object3D, attachment, { preserveExistingScale = false } = {}) {
  if (!object3D || !attachment?.ok) return { ok: false, error: 'invalid-attachment' };
  const transform = attachment.transform;
  if (!object3D.userData) object3D.userData = {};
  object3D.userData.playerSocketAttachment = attachment;
  if (object3D.position?.set) object3D.position.set(transform.position.x, transform.position.y, transform.position.z);
  if (object3D.rotation?.set) object3D.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z);
  if (object3D.scale?.set && !preserveExistingScale) object3D.scale.set(transform.scale.x, transform.scale.y, transform.scale.z);
  object3D.visible = attachment.visible;
  return { ok: true, object3D, attachment };
}

export function auditPlayerSocketAttachmentPlan(plan) {
  const errors = [];
  const warnings = [];
  if (!plan || plan.version !== 1) errors.push('invalid-plan-version');
  for (const [slot, binding] of Object.entries(plan?.bindings || {})) {
    if (!binding) continue;
    if (!binding.ok) errors.push(`${slot}:binding-not-ok`);
    for (const axis of ['x', 'y', 'z']) {
      if (!Number.isFinite(binding.transform?.position?.[axis])) errors.push(`${slot}:position-${axis}`);
      if (!Number.isFinite(binding.transform?.rotation?.[axis])) errors.push(`${slot}:rotation-${axis}`);
      if (!Number.isFinite(binding.transform?.scale?.[axis])) errors.push(`${slot}:scale-${axis}`);
    }
    if (binding.transform.scale.x < PLAYER_SOCKET_LIMITS.scale.min || binding.transform.scale.x > PLAYER_SOCKET_LIMITS.scale.max) warnings.push(`${slot}:scale-x-out-of-range`);
    if (binding.transform.scale.y < PLAYER_SOCKET_LIMITS.scale.min || binding.transform.scale.y > PLAYER_SOCKET_LIMITS.scale.max) warnings.push(`${slot}:scale-y-out-of-range`);
    if (binding.transform.scale.z < PLAYER_SOCKET_LIMITS.scale.min || binding.transform.scale.z > PLAYER_SOCKET_LIMITS.scale.max) warnings.push(`${slot}:scale-z-out-of-range`);
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors), warnings: freeze(warnings) });
}

export function buildSocketPlacementEvidence(profile, { overrides = {}, rootScale = 1 } = {}) {
  const plan = buildPlayerSocketAttachmentPlan(profile, { overrides, rootScale });
  const audit = auditPlayerSocketAttachmentPlan(plan);
  return freeze({
    version: 1,
    plan,
    audit,
    populatedSlots: Object.freeze(Object.entries(plan.bindings).filter(([, binding]) => Boolean(binding)).map(([slot]) => slot)),
    attachmentCount: Object.values(plan.bindings).filter(Boolean).length,
  });
}
