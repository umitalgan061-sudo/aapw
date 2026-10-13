/**
 * Strict TypeScript owner for deterministic player equipment socket descriptors.
 *
 * This module remains a pure transform/validation layer. Inventory, scene lifecycle, animation
 * mixers and the authoritative player state machine stay with their existing owners.
 *
 * @module gameplay/playerEquipmentSocketAttachment
 */

export type PlayerEquipmentSocketSlot = 'head' | 'chest' | 'back' | 'mainHand' | 'offHand';
export type PlayerSocketVector3 = Readonly<{ x: number; y: number; z: number }>;
export type PlayerSocketTransform = Readonly<{
  position: PlayerSocketVector3;
  rotation: PlayerSocketVector3;
  scale: PlayerSocketVector3;
}>;
export type PlayerSocketAttachment =
  | Readonly<{ ok: false; error: 'unsupported-socket' }>
  | Readonly<{
      ok: true;
      slot: PlayerEquipmentSocketSlot;
      socketName: string;
      itemId: string;
      transform: PlayerSocketTransform;
      inheritScale: boolean;
      visible: boolean;
    }>;
export type PlayerSocketAttachmentPlan = Readonly<{
  version: 1;
  rootScale: number;
  bindings: Readonly<Record<PlayerEquipmentSocketSlot, PlayerSocketAttachment | null>>;
}>;
export type PlayerSocketAttachmentAudit = Readonly<{
  ok: boolean;
  errors: readonly string[];
  warnings: readonly string[];
}>;

type UnknownRecord = Record<string, unknown>;
type SocketDefaults = Readonly<{
  position: PlayerSocketVector3;
  rotation: PlayerSocketVector3;
  scale: number;
}>;
type MutableVector3 = { x: number; y: number; z: number };
type MutableTransform = { position: MutableVector3; rotation: MutableVector3; scale: MutableVector3 };
type VectorSetter = { set?: (x: number, y: number, z: number) => unknown };
type Object3DLike = {
  userData?: UnknownRecord;
  position?: VectorSetter;
  rotation?: VectorSetter;
  scale?: VectorSetter;
  visible?: boolean;
};

const SOCKET_SLOTS: readonly PlayerEquipmentSocketSlot[] = Object.freeze([
  'head', 'chest', 'back', 'mainHand', 'offHand',
]);

function freezeDeep<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as UnknownRecord)) freezeDeep(child);
  return Object.freeze(value) as T;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeNumber(value: unknown, fallback: number): number {
  try {
    const candidate = Number(value);
    return Number.isFinite(candidate) ? candidate : fallback;
  } catch {
    return fallback;
  }
}

function safeString(value: unknown, fallback: string): string {
  try {
    return String(value ?? fallback);
  } catch {
    return fallback;
  }
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const finite = (value: unknown, fallback = 0): number => safeNumber(value, fallback);
const positive = (value: unknown, fallback = 1): number => {
  const candidate = safeNumber(value, fallback);
  return candidate > 0 ? candidate : fallback;
};

export const PLAYER_SOCKET_DEFAULTS = freezeDeep({
  head: { position: { x: 0, y: 0.02, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 },
  chest: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 },
  back: { position: { x: 0, y: -0.03, z: -0.08 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 },
  mainHand: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 },
  offHand: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 },
} satisfies Record<PlayerEquipmentSocketSlot, SocketDefaults>);

export const PLAYER_SOCKET_LIMITS = freezeDeep({
  positionMeters: 1.5,
  rotationRadians: Math.PI * 2,
  scale: { min: 0.15, max: 4 },
});

const SLOT_ALIASES: Readonly<Record<PlayerEquipmentSocketSlot, readonly string[]>> = freezeDeep({
  head: ['head', 'helmet', 'helm', 'hat'],
  chest: ['chest', 'torso', 'body', 'armor', 'armour'],
  back: ['back', 'quiver', 'cape', 'shield-back', 'weapon-back'],
  mainHand: ['mainhand', 'main-hand', 'weapon', 'right-hand', 'righthand'],
  offHand: ['offhand', 'off-hand', 'left-hand', 'lefthand', 'shield'],
});

function normalizeSlot(value: unknown): PlayerEquipmentSocketSlot | null {
  const normalized = safeString(value, '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  for (const slot of SOCKET_SLOTS) {
    if (SLOT_ALIASES[slot].includes(normalized)) return slot;
  }
  return null;
}

function vector3(value: unknown, fallback: PlayerSocketVector3): MutableVector3 {
  const source = isRecord(value) ? value : fallback;
  return {
    x: clamp(finite(source.x, fallback.x), -PLAYER_SOCKET_LIMITS.positionMeters, PLAYER_SOCKET_LIMITS.positionMeters),
    y: clamp(finite(source.y, fallback.y), -PLAYER_SOCKET_LIMITS.positionMeters, PLAYER_SOCKET_LIMITS.positionMeters),
    z: clamp(finite(source.z, fallback.z), -PLAYER_SOCKET_LIMITS.positionMeters, PLAYER_SOCKET_LIMITS.positionMeters),
  };
}

function euler(value: unknown, fallback: PlayerSocketVector3): MutableVector3 {
  const source = isRecord(value) ? value : fallback;
  const wrap = (input: unknown): number => {
    const twoPi = Math.PI * 2;
    let radians = finite(input, 0) % twoPi;
    if (radians > Math.PI) radians -= twoPi;
    if (radians < -Math.PI) radians += twoPi;
    return clamp(radians, -PLAYER_SOCKET_LIMITS.rotationRadians, PLAYER_SOCKET_LIMITS.rotationRadians);
  };
  return { x: wrap(source.x), y: wrap(source.y), z: wrap(source.z) };
}

function defaultScale(defaults: SocketDefaults | PlayerSocketTransform): MutableVector3 {
  if (typeof defaults.scale === 'number') {
    return { x: defaults.scale, y: defaults.scale, z: defaults.scale };
  }
  return { x: defaults.scale.x, y: defaults.scale.y, z: defaults.scale.z };
}

function transformFrom(defaults: SocketDefaults | PlayerSocketTransform, override: unknown): MutableTransform {
  const source = isRecord(override) ? override : {};
  const fallbackScale = defaultScale(defaults);
  const scaleSource = source.scale;
  let scale: MutableVector3;

  if (typeof scaleSource === 'number' || typeof source.uniformScale === 'number') {
    const uniform = clamp(
      positive(typeof scaleSource === 'number' ? scaleSource : source.uniformScale, fallbackScale.x),
      PLAYER_SOCKET_LIMITS.scale.min,
      PLAYER_SOCKET_LIMITS.scale.max,
    );
    scale = { x: uniform, y: uniform, z: uniform };
  } else if (isRecord(scaleSource)) {
    scale = {
      x: clamp(positive(scaleSource.x, fallbackScale.x), PLAYER_SOCKET_LIMITS.scale.min, PLAYER_SOCKET_LIMITS.scale.max),
      y: clamp(positive(scaleSource.y, fallbackScale.y), PLAYER_SOCKET_LIMITS.scale.min, PLAYER_SOCKET_LIMITS.scale.max),
      z: clamp(positive(scaleSource.z, fallbackScale.z), PLAYER_SOCKET_LIMITS.scale.min, PLAYER_SOCKET_LIMITS.scale.max),
    };
  } else {
    scale = {
      x: clamp(positive(fallbackScale.x, 1), PLAYER_SOCKET_LIMITS.scale.min, PLAYER_SOCKET_LIMITS.scale.max),
      y: clamp(positive(fallbackScale.y, 1), PLAYER_SOCKET_LIMITS.scale.min, PLAYER_SOCKET_LIMITS.scale.max),
      z: clamp(positive(fallbackScale.z, 1), PLAYER_SOCKET_LIMITS.scale.min, PLAYER_SOCKET_LIMITS.scale.max),
    };
  }

  return {
    position: vector3(source.position, defaults.position),
    rotation: euler(source.rotation, defaults.rotation),
    scale,
  };
}

function cloneTransform(transform: MutableTransform | PlayerSocketTransform): PlayerSocketTransform {
  return freezeDeep({
    position: { ...transform.position },
    rotation: { ...transform.rotation },
    scale: { ...transform.scale },
  });
}

export function normalizePlayerSocketOverrides(overrides: unknown = {}): Readonly<Partial<Record<PlayerEquipmentSocketSlot, PlayerSocketTransform>>> {
  const result: Partial<Record<PlayerEquipmentSocketSlot, PlayerSocketTransform>> = {};
  if (!isRecord(overrides)) return freezeDeep(result);
  for (const [rawSlot, value] of Object.entries(overrides)) {
    const slot = normalizeSlot(rawSlot);
    if (!slot) continue;
    result[slot] = cloneTransform(transformFrom(PLAYER_SOCKET_DEFAULTS[slot], value));
  }
  return freezeDeep(result);
}

export function resolvePlayerSocketAttachment(
  slotInput: unknown,
  item: unknown = {},
  { overrides = {}, mirrored = false }: { overrides?: unknown; mirrored?: unknown } = {},
): PlayerSocketAttachment {
  const slot = normalizeSlot(slotInput);
  if (!slot) return freezeDeep({ ok: false as const, error: 'unsupported-socket' as const });

  const itemRecord = isRecord(item) ? item : {};
  const itemTransform = itemRecord.attachment ?? itemRecord.socketTransform ?? itemRecord.transform ?? {};
  let transform = transformFrom(PLAYER_SOCKET_DEFAULTS[slot], itemTransform);

  // Apply only explicitly supplied override fields. This preserves item-authored grip offsets when
  // a designer changes just one axis instead of resetting the other axes to socket defaults.
  if (isRecord(overrides)) {
    for (const [rawSlot, override] of Object.entries(overrides)) {
      if (normalizeSlot(rawSlot) === slot) transform = transformFrom(transform, override);
    }
  }

  if (Boolean(mirrored) && (slot === 'mainHand' || slot === 'offHand')) {
    transform = {
      position: { x: -transform.position.x, y: transform.position.y, z: transform.position.z },
      rotation: { x: transform.rotation.x, y: -transform.rotation.y, z: -transform.rotation.z },
      scale: { x: transform.scale.x, y: transform.scale.y, z: transform.scale.z },
    };
  }

  return freezeDeep({
    ok: true as const,
    slot,
    socketName: safeString(itemRecord.socketName ?? itemRecord.attachmentSocket ?? slot, slot),
    itemId: safeString(itemRecord.id ?? itemRecord.itemId ?? itemRecord.equipmentId ?? 'none', 'none'),
    transform: cloneTransform(transform),
    inheritScale: itemRecord.inheritScale !== false,
    visible: itemRecord.visible !== false,
  });
}

export function buildPlayerSocketAttachmentPlan(
  profile: unknown,
  { overrides = {}, rootScale = 1 }: { overrides?: unknown; rootScale?: unknown } = {},
): PlayerSocketAttachmentPlan {
  const profileRecord = isRecord(profile) ? profile : {};
  const slots = isRecord(profileRecord.slots) ? profileRecord.slots : {};
  const bindings = {} as Record<PlayerEquipmentSocketSlot, PlayerSocketAttachment | null>;
  for (const slot of SOCKET_SLOTS) {
    const item = slots[slot];
    bindings[slot] = item == null
      ? null
      : resolvePlayerSocketAttachment(slot, item, { overrides });
  }
  return freezeDeep({
    version: 1 as const,
    rootScale: clamp(positive(rootScale, 1), 0.25, 2.5),
    bindings,
  });
}

export function validatePlayerSocketAttachment(
  value: unknown,
  expectedSlot?: unknown,
): PlayerSocketAttachmentAudit {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(value)) {
    return freezeDeep({ ok: false, errors: ['invalid-attachment'], warnings });
  }
  if (value.ok !== true) errors.push('attachment-not-ok');

  const slot = normalizeSlot(value.slot);
  if (!slot) errors.push('unsupported-socket');
  if (expectedSlot !== undefined) {
    const expected = normalizeSlot(expectedSlot);
    if (!expected) errors.push('unsupported-expected-slot');
    else if (slot && slot !== expected) errors.push('slot-mismatch');
  }

  if (typeof value.socketName !== 'string' || !value.socketName.trim()) errors.push('missing-socket-name');
  if (typeof value.itemId !== 'string') errors.push('invalid-item-id');
  if (typeof value.visible !== 'boolean') errors.push('invalid-visible-flag');
  if (typeof value.inheritScale !== 'boolean') errors.push('invalid-inherit-scale-flag');

  const transform = isRecord(value.transform) ? value.transform : null;
  if (!transform) {
    errors.push('invalid-transform');
  } else {
    for (const field of ['position', 'rotation', 'scale'] as const) {
      const vector = isRecord(transform[field]) ? transform[field] : null;
      if (!vector) {
        errors.push(`missing-${field}`);
        continue;
      }
      for (const axis of ['x', 'y', 'z'] as const) {
        const component = vector[axis];
        if (typeof component !== 'number' || !Number.isFinite(component)) {
          errors.push(`${field}-${axis}-not-finite`);
          continue;
        }
        if (field === 'scale' && (component < PLAYER_SOCKET_LIMITS.scale.min || component > PLAYER_SOCKET_LIMITS.scale.max)) {
          warnings.push(`scale-${axis}-out-of-range`);
        }
        if (field === 'position' && Math.abs(component) > PLAYER_SOCKET_LIMITS.positionMeters) {
          warnings.push(`position-${axis}-out-of-range`);
        }
      }
    }
  }
  return freezeDeep({ ok: errors.length === 0, errors, warnings });
}

export function applyPlayerSocketAttachment(
  object3D: unknown,
  attachment: unknown,
  { preserveExistingScale = false }: { preserveExistingScale?: unknown } = {},
): Readonly<{ ok: true; object3D: unknown; attachment: PlayerSocketAttachment }> | Readonly<{ ok: false; error: string; validation?: PlayerSocketAttachmentAudit }> {
  const validation = validatePlayerSocketAttachment(attachment);
  if (!isRecord(object3D) || !validation.ok || !isRecord(attachment) || attachment.ok !== true) {
    return freezeDeep({ ok: false as const, error: 'invalid-attachment', validation });
  }

  const target = object3D as Object3DLike;
  const resolved = attachment as unknown as Extract<PlayerSocketAttachment, { ok: true }>;
  const transform = resolved.transform;
  if (!isRecord(target.userData)) target.userData = {};
  target.userData.playerSocketAttachment = resolved;
  target.position?.set?.(transform.position.x, transform.position.y, transform.position.z);
  target.rotation?.set?.(transform.rotation.x, transform.rotation.y, transform.rotation.z);
  if (!Boolean(preserveExistingScale)) target.scale?.set?.(transform.scale.x, transform.scale.y, transform.scale.z);
  target.visible = resolved.visible;
  return freezeDeep({ ok: true as const, object3D, attachment: resolved });
}

export function auditPlayerSocketAttachmentPlan(plan: unknown): PlayerSocketAttachmentAudit {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(plan) || plan.version !== 1) errors.push('invalid-plan-version');
  const bindings = isRecord(plan) && isRecord(plan.bindings) ? plan.bindings : null;
  if (!bindings) {
    errors.push('invalid-bindings');
    return freezeDeep({ ok: false, errors, warnings });
  }

  for (const [rawSlot, binding] of Object.entries(bindings)) {
    const slot = normalizeSlot(rawSlot);
    if (!slot) {
      errors.push(`unsupported-slot:${rawSlot}`);
      continue;
    }
    if (binding == null) continue;
    const audit = validatePlayerSocketAttachment(binding, slot);
    errors.push(...audit.errors.map((error) => `${slot}:${error}`));
    warnings.push(...audit.warnings.map((warning) => `${slot}:${warning}`));
  }
  return freezeDeep({ ok: errors.length === 0, errors, warnings });
}

export function buildSocketPlacementEvidence(
  profile: unknown,
  { overrides = {}, rootScale = 1 }: { overrides?: unknown; rootScale?: unknown } = {},
) {
  const plan = buildPlayerSocketAttachmentPlan(profile, { overrides, rootScale });
  const audit = auditPlayerSocketAttachmentPlan(plan);
  const populatedSlots = SOCKET_SLOTS.filter((slot) => Boolean(plan.bindings[slot]));
  return freezeDeep({
    version: 1 as const,
    plan,
    audit,
    populatedSlots,
    attachmentCount: populatedSlots.length,
  });
}

const api = freezeDeep({
  PLAYER_SOCKET_DEFAULTS,
  PLAYER_SOCKET_LIMITS,
  normalizePlayerSocketOverrides,
  resolvePlayerSocketAttachment,
  buildPlayerSocketAttachmentPlan,
  validatePlayerSocketAttachment,
  applyPlayerSocketAttachment,
  auditPlayerSocketAttachmentPlan,
  buildSocketPlacementEvidence,
});

export default api;
