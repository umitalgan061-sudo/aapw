/** Production TypeScript owner for src/3d/gameplay/playerEquipmentCombatProfile.js. Legacy .js remains compatibility-only. */
/**
 * Deterministic equipment -> combat/animation profile bridge for the shipped player.
 *
 * This module deliberately does not own inventory, item acquisition, scene graph lifecycle,
 * animation mixers, or health state. It consumes an optional equipment snapshot and derives
 * bounded combat numbers, animation aliases, socket intent and material metadata that the
 * existing player.js state machine can consume.
 *
 * Asset-first note: the shipped player is `assets/models/characters/peasant_girl.fbx` with the
 * existing Mixamo-retargeted idle/walking/running FBX family. New model bytes are not authored
 * here. Material metadata is intentionally shaped for the shared MaterialAssignmentCore rather
 * than duplicating its recipe/placement implementation.
 *
 * @module gameplay/playerEquipmentCombatProfile
 */

type UnknownRecord = Record<string, unknown>;
type EquipmentItem = UnknownRecord;
type PlayerObject3DLike = { userData: UnknownRecord; name?: string; traverse?: (callback: (node: unknown) => void) => void };
type AttackKind = 'light' | 'heavy';
type SlotName = 'head' | 'chest' | 'back' | 'mainHand' | 'offHand';
type PlayerEquipmentSlots = Readonly<Record<SlotName, EquipmentItem | null>>;
type AnimationAliasSet = Readonly<Record<'idle' | 'walking' | 'running' | 'light' | 'heavy' | 'dodge' | 'guard' | 'parry' | 'hit', string>>;

export interface PlayerWeaponProfile extends UnknownRecord {
  readonly id: string;
  readonly displayName: string;
  readonly staminaMultiplier: number;
  readonly damageMultiplier: number;
  readonly reachMultiplier: number;
  readonly activeStartShift: number;
  readonly activeEndShift: number;
  readonly durationMultiplier: number;
  readonly commitMultiplier: number;
  readonly guardBreakMultiplier: number;
  readonly poiseMultiplier: number;
  readonly animationFamily: string;
  readonly socket: string | null;
  readonly materialSurface: string;
  readonly projectile: boolean;
  readonly twoHanded: boolean;
}

export interface PlayerArmorProfile extends UnknownRecord {
  readonly id: string;
  readonly displayName: string;
  readonly movementMultiplier: number;
  readonly staminaDrainMultiplier: number;
  readonly staminaRegenMultiplier: number;
  readonly poiseBonus: number;
  readonly guardDamageMultiplier: number;
  readonly dodgeDistanceMultiplier: number;
  readonly animationFamily: string;
  readonly materialSurfaces: readonly string[];
}

export interface PlayerResolvedEquipmentProfile {
  readonly version: 1;
  readonly slots: PlayerEquipmentSlots;
  readonly mainHand: PlayerWeaponProfile;
  readonly offHand: PlayerWeaponProfile;
  readonly armor: PlayerArmorProfile;
  readonly shieldEquipped: boolean;
  readonly ranged: boolean;
  readonly twoHanded: boolean;
  readonly effectiveGuardMultiplier: number;
  readonly sourceIds: Readonly<Record<SlotName, string>>;
}

export interface PlayerAttackTuning {
  readonly cost: number;
  readonly duration: number;
  readonly activeStart: number;
  readonly activeEnd: number;
  readonly reach: number;
  readonly damageScale: number;
  readonly commitMeters: number;
  readonly guardBreakMultiplier: number;
  readonly poiseMultiplier: number;
  readonly guardDamageMultiplier: number;
  readonly armorPoiseBonus: number;
  readonly movementMultiplier: number;
  readonly staminaRegenMultiplier: number;
  readonly dodgeDistanceMultiplier: number;
  readonly isRanged: boolean;
  readonly twoHanded: boolean;
}

export interface PlayerAnimationPlan {
  readonly family: string;
  readonly action: string;
  readonly comboStep: number;
  readonly weight: number;
  readonly timeScale: number;
  readonly grounded: boolean;
  readonly locomotionLayer: 'idle' | 'attack' | 'locomotion';
  readonly equipmentRevisionKey: string;
}

export interface PlayerEquipmentSocketBinding {
  readonly socket: string | null;
  readonly required: boolean;
  readonly itemId: string;
  readonly fallbackSocket: SlotName;
}
export interface PlayerEquipmentSocketPlan {
  readonly version: 1;
  readonly bindings: Readonly<Record<SlotName, PlayerEquipmentSocketBinding | null>>;
}

export interface PlayerMaterialAssignmentMetadata {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly src: string;
  readonly textureSize: number;
  readonly layeredFallbackAllowed: true;
  readonly importedMaterialsPreferred: true;
  readonly equipmentSurfaces: Readonly<Record<'mainHand' | 'offHand' | 'armor', readonly string[]>>;
  readonly materialContract: 'MaterialAssignmentCore';
  readonly placementContract: 'WorldAssetPlacementPipeline';
  readonly editorUiImportForbidden: true;
}

export interface PlayerEquipmentRuntimeSnapshot {
  readonly version: 1;
  readonly timestamp: number;
  readonly profile: PlayerResolvedEquipmentProfile;
  readonly socketPlan: PlayerEquipmentSocketPlan;
  readonly animation: PlayerAnimationPlan;
  readonly material: PlayerMaterialAssignmentMetadata;
  readonly audit: Readonly<{ ok: boolean; errors: readonly string[]; warnings: readonly string[] }>;
  readonly revision?: number;
}

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
const readString = (value: unknown, fallback: string): string => typeof value === 'string' && value.trim() ? value.trim() : fallback;

const MAX_NUMBER = 1000;
const MIN_NUMBER = 0;
const MAX_SOCKET_NAME = 80;
const MAX_ID_LENGTH = 96;
const DEFAULT_TEXTURE_SIZE = 256;
const DEFAULT_ATTACK_KIND = 'light';
const DEFAULT_ARMOR_ID = 'unarmored';
const DEFAULT_WEAPON_ID = 'unarmed';

const clamp = (value: unknown, min: number, max: number): number => Math.max(min, Math.min(max, finiteOr(value, min)));
const finiteOr = (value: unknown, fallback: number): number => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positiveOr = (value: unknown, fallback: number): number => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

function normalizeId(value: unknown, fallback: string): string {
  const id = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').slice(0, MAX_ID_LENGTH);
  return id || fallback;
}

function normalizeLabel(value: unknown, fallback = ''): string {
  const label = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_SOCKET_NAME);
  return label || fallback;
}

function freezeDeep<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as UnknownRecord)) freezeDeep(child);
  return Object.freeze(value) as T;
}

const ATTACK_PHASES = freezeDeep({
  light: { activeStart: 0.14, activeEnd: 0.26, duration: 0.44, reach: 1.65, damageScale: 1, commitMeters: 0.58 },
  heavy: { activeStart: 0.28, activeEnd: 0.46, duration: 0.72, reach: 2.05, damageScale: 1.65, commitMeters: 0.9 },
});

const WEAPON_COMMON = {
  staminaMultiplier: 1,
  damageMultiplier: 1,
  reachMultiplier: 1,
  activeStartShift: 0,
  activeEndShift: 0,
  durationMultiplier: 1,
  commitMultiplier: 1,
  guardBreakMultiplier: 1,
  poiseMultiplier: 1,
  animationFamily: 'arming-sword',
  socket: 'mainHand',
  materialSurface: 'metal',
  projectile: false,
  twoHanded: false,
};

export const PLAYER_WEAPON_PROFILES = freezeDeep({
  unarmed: {
    ...WEAPON_COMMON,
    id: 'unarmed', displayName: 'Unarmed',
    staminaMultiplier: 0.7, damageMultiplier: 0.35, reachMultiplier: 0.72,
    animationFamily: 'unarmed', socket: null, materialSurface: 'skin',
  },
  dagger: {
    ...WEAPON_COMMON,
    id: 'dagger', displayName: 'Dagger',
    staminaMultiplier: 0.72, damageMultiplier: 0.82, reachMultiplier: 0.72,
    durationMultiplier: 0.82, commitMultiplier: 0.68, poiseMultiplier: 0.74,
    animationFamily: 'dagger', materialSurface: 'metal',
  },
  armingSword: {
    ...WEAPON_COMMON,
    id: 'arming-sword', displayName: 'Arming Sword',
    damageMultiplier: 1, reachMultiplier: 1, animationFamily: 'arming-sword',
  },
  longsword: {
    ...WEAPON_COMMON,
    id: 'longsword', displayName: 'Longsword',
    staminaMultiplier: 1.08, damageMultiplier: 1.14, reachMultiplier: 1.12,
    durationMultiplier: 1.06, commitMultiplier: 1.08, poiseMultiplier: 1.1,
    animationFamily: 'longsword',
  },
  greatsword: {
    ...WEAPON_COMMON,
    id: 'greatsword', displayName: 'Greatsword',
    staminaMultiplier: 1.26, damageMultiplier: 1.46, reachMultiplier: 1.24,
    durationMultiplier: 1.18, commitMultiplier: 1.28, guardBreakMultiplier: 1.32, poiseMultiplier: 1.34,
    animationFamily: 'greatsword', twoHanded: true,
  },
  spear: {
    ...WEAPON_COMMON,
    id: 'spear', displayName: 'Spear',
    staminaMultiplier: 1.02, damageMultiplier: 1.08, reachMultiplier: 1.38,
    durationMultiplier: 1.05, commitMultiplier: 0.94, poiseMultiplier: 1.06,
    animationFamily: 'spear',
  },
  battleAxe: {
    ...WEAPON_COMMON,
    id: 'battle-axe', displayName: 'Battle Axe',
    staminaMultiplier: 1.16, damageMultiplier: 1.3, reachMultiplier: 1.08,
    durationMultiplier: 1.12, commitMultiplier: 1.14, guardBreakMultiplier: 1.24, poiseMultiplier: 1.18,
    animationFamily: 'axe',
  },
  mace: {
    ...WEAPON_COMMON,
    id: 'mace', displayName: 'Mace',
    staminaMultiplier: 1.1, damageMultiplier: 1.16, reachMultiplier: 0.94,
    durationMultiplier: 1.08, commitMultiplier: 1.05, guardBreakMultiplier: 1.38, poiseMultiplier: 1.22,
    animationFamily: 'mace',
  },
  staff: {
    ...WEAPON_COMMON,
    id: 'staff', displayName: 'Staff',
    staminaMultiplier: 0.96, damageMultiplier: 0.92, reachMultiplier: 1.16,
    durationMultiplier: 1, commitMultiplier: 0.92, poiseMultiplier: 0.92,
    animationFamily: 'staff',
  },
  bow: {
    ...WEAPON_COMMON,
    id: 'bow', displayName: 'Bow',
    staminaMultiplier: 0.95, damageMultiplier: 1.08, reachMultiplier: 4.2,
    durationMultiplier: 1.35, commitMultiplier: 0.4, guardBreakMultiplier: 0.4, poiseMultiplier: 0.6,
    animationFamily: 'archery', socket: 'back', projectile: true, twoHanded: true,
  },
  crossbow: {
    ...WEAPON_COMMON,
    id: 'crossbow', displayName: 'Crossbow',
    staminaMultiplier: 1.12, damageMultiplier: 1.24, reachMultiplier: 4.8,
    durationMultiplier: 1.62, commitMultiplier: 0.25, guardBreakMultiplier: 0.42, poiseMultiplier: 0.72,
    animationFamily: 'crossbow', socket: 'back', projectile: true, twoHanded: true,
  },
  shield: {
    ...WEAPON_COMMON,
    id: 'shield', displayName: 'Shield',
    staminaMultiplier: 0.96, damageMultiplier: 0.54, reachMultiplier: 0.78,
    durationMultiplier: 0.98, commitMultiplier: 0.7, guardBreakMultiplier: 0.3, poiseMultiplier: 0.82,
    animationFamily: 'shield-bash', socket: 'offHand', materialSurface: 'wood-metal',
  },
  buckler: {
    ...WEAPON_COMMON,
    id: 'buckler', displayName: 'Buckler',
    staminaMultiplier: 0.9, damageMultiplier: 0.48, reachMultiplier: 0.72,
    durationMultiplier: 0.9, commitMultiplier: 0.62, guardBreakMultiplier: 0.24, poiseMultiplier: 0.66,
    animationFamily: 'buckler', socket: 'offHand', materialSurface: 'metal',
  },
});

const ARMOR_COMMON = {
  movementMultiplier: 1,
  staminaDrainMultiplier: 1,
  staminaRegenMultiplier: 1,
  poiseBonus: 0,
  guardDamageMultiplier: 1,
  dodgeDistanceMultiplier: 1,
  animationFamily: 'light',
  materialSurfaces: ['cloth'],
};

export const PLAYER_ARMOR_PROFILES = freezeDeep({
  unarmored: {
    ...ARMOR_COMMON,
    id: 'unarmored', displayName: 'Unarmored',
    movementMultiplier: 1.02, staminaDrainMultiplier: 0.94, staminaRegenMultiplier: 1.04,
    animationFamily: 'unarmored', materialSurfaces: ['skin', 'cloth'],
  },
  cloth: {
    ...ARMOR_COMMON,
    id: 'cloth', displayName: 'Cloth',
    movementMultiplier: 1, staminaDrainMultiplier: 0.98, staminaRegenMultiplier: 1.02,
    poiseBonus: 4, animationFamily: 'light', materialSurfaces: ['cloth', 'leather'],
  },
  leather: {
    ...ARMOR_COMMON,
    id: 'leather', displayName: 'Leather',
    movementMultiplier: 0.97, staminaDrainMultiplier: 1, staminaRegenMultiplier: 1,
    poiseBonus: 10, guardDamageMultiplier: 0.96, animationFamily: 'light', materialSurfaces: ['leather', 'cloth'],
  },
  chain: {
    ...ARMOR_COMMON,
    id: 'chain', displayName: 'Chain',
    movementMultiplier: 0.91, staminaDrainMultiplier: 1.06, staminaRegenMultiplier: 0.94,
    poiseBonus: 22, guardDamageMultiplier: 0.9, dodgeDistanceMultiplier: 0.96,
    animationFamily: 'medium', materialSurfaces: ['metal', 'cloth'],
  },
  brigandine: {
    ...ARMOR_COMMON,
    id: 'brigandine', displayName: 'Brigandine',
    movementMultiplier: 0.88, staminaDrainMultiplier: 1.1, staminaRegenMultiplier: 0.91,
    poiseBonus: 30, guardDamageMultiplier: 0.87, dodgeDistanceMultiplier: 0.92,
    animationFamily: 'medium', materialSurfaces: ['cloth', 'leather', 'metal'],
  },
  plate: {
    ...ARMOR_COMMON,
    id: 'plate', displayName: 'Plate',
    movementMultiplier: 0.8, staminaDrainMultiplier: 1.18, staminaRegenMultiplier: 0.84,
    poiseBonus: 48, guardDamageMultiplier: 0.72, dodgeDistanceMultiplier: 0.84,
    animationFamily: 'heavy', materialSurfaces: ['metal', 'cloth', 'leather'],
  },
  royalPlate: {
    ...ARMOR_COMMON,
    id: 'royal-plate', displayName: 'Royal Plate',
    movementMultiplier: 0.76, staminaDrainMultiplier: 1.22, staminaRegenMultiplier: 0.8,
    poiseBonus: 58, guardDamageMultiplier: 0.66, dodgeDistanceMultiplier: 0.8,
    animationFamily: 'heavy', materialSurfaces: ['metal', 'cloth', 'leather'],
  },
  ranger: {
    ...ARMOR_COMMON,
    id: 'ranger', displayName: 'Ranger',
    movementMultiplier: 0.99, staminaDrainMultiplier: 0.95, staminaRegenMultiplier: 1.04,
    poiseBonus: 8, guardDamageMultiplier: 0.95, dodgeDistanceMultiplier: 1.03,
    animationFamily: 'ranger', materialSurfaces: ['leather', 'cloth', 'metal'],
  },
});

const SLOT_ALIASES = freezeDeep({
  head: ['head', 'helmet', 'helm', 'hat'],
  chest: ['chest', 'torso', 'body', 'armor', 'armour'],
  back: ['back', 'quiver', 'cape', 'shield-back', 'weapon-back'],
  mainHand: ['mainhand', 'main-hand', 'weapon', 'right-hand', 'righthand'],
  offHand: ['offhand', 'off-hand', 'left-hand', 'lefthand', 'shield'],
});

const SOCKET_CANDIDATES = freezeDeep({
  head: ['Head', 'head', 'mixamorigHead', 'mixamorig:Head'],
  chest: ['Chest', 'chest', 'Spine2', 'mixamorigSpine2', 'mixamorig:Spine2'],
  back: ['Back', 'back', 'Spine', 'mixamorigSpine', 'mixamorig:Spine'],
  mainHand: ['RightHand', 'rightHand', 'mixamorigRightHand', 'mixamorig:RightHand'],
  offHand: ['LeftHand', 'leftHand', 'mixamorigLeftHand', 'mixamorig:LeftHand'],
});

const ANIMATION_FAMILY_ALIASES = freezeDeep({
  unarmed: { idle: 'idle', walking: 'walking', running: 'running', light: 'idle', heavy: 'idle', dodge: 'running', guard: 'idle', parry: 'idle', hit: 'idle' },
  'arming-sword': { idle: 'idle', walking: 'walking', running: 'running', light: 'idle', heavy: 'idle', dodge: 'running', guard: 'idle', parry: 'idle', hit: 'idle' },
  longsword: { idle: 'idle', walking: 'walking', running: 'running', light: 'idle', heavy: 'idle', dodge: 'running', guard: 'idle', parry: 'idle', hit: 'idle' },
  greatsword: { idle: 'idle', walking: 'walking', running: 'running', light: 'idle', heavy: 'idle', dodge: 'running', guard: 'idle', parry: 'idle', hit: 'idle' },
  dagger: { idle: 'idle', walking: 'walking', running: 'running', light: 'idle', heavy: 'idle', dodge: 'running', guard: 'idle', parry: 'idle', hit: 'idle' },
  spear: { idle: 'idle', walking: 'walking', running: 'running', light: 'idle', heavy: 'idle', dodge: 'running', guard: 'idle', parry: 'idle', hit: 'idle' },
  axe: { idle: 'idle', walking: 'walking', running: 'running', light: 'idle', heavy: 'idle', dodge: 'running', guard: 'idle', parry: 'idle', hit: 'idle' },
  mace: { idle: 'idle', walking: 'walking', running: 'running', light: 'idle', heavy: 'idle', dodge: 'running', guard: 'idle', parry: 'idle', hit: 'idle' },
  staff: { idle: 'idle', walking: 'walking', running: 'running', light: 'idle', heavy: 'idle', dodge: 'running', guard: 'idle', parry: 'idle', hit: 'idle' },
  archery: { idle: 'idle', walking: 'walking', running: 'running', light: 'idle', heavy: 'idle', dodge: 'running', guard: 'idle', parry: 'idle', hit: 'idle' },
  crossbow: { idle: 'idle', walking: 'walking', running: 'running', light: 'idle', heavy: 'idle', dodge: 'running', guard: 'idle', parry: 'idle', hit: 'idle' },
  'shield-bash': { idle: 'idle', walking: 'walking', running: 'running', light: 'idle', heavy: 'idle', dodge: 'running', guard: 'idle', parry: 'idle', hit: 'idle' },
  buckler: { idle: 'idle', walking: 'walking', running: 'running', light: 'idle', heavy: 'idle', dodge: 'running', guard: 'idle', parry: 'idle', hit: 'idle' },
});

const MATERIAL_SURFACE_FALLBACKS = freezeDeep({
  skin: ['skin'],
  cloth: ['cloth'],
  leather: ['leather'],
  metal: ['metal'],
  'wood-metal': ['wood', 'metal'],
});

function readItemId(item: unknown, fallback: string): string {
  const source = asRecord(item);
  return normalizeId(source.profileId ?? source.equipmentId ?? source.itemId ?? source.id ?? source.slug ?? fallback, fallback);
}

function readWeaponProfile(item: unknown): PlayerWeaponProfile {
  const source = asRecord(item);
  const id = readItemId(source, DEFAULT_WEAPON_ID);
  const explicitType = normalizeId(source.weaponType ?? source.type ?? source.category, '');
  const weaponTable = PLAYER_WEAPON_PROFILES as unknown as Record<string, PlayerWeaponProfile>;
  const profile = (weaponTable[id] ?? weaponTable[explicitType] ?? Object.values(weaponTable).find((candidate) => candidate.id === id) ?? weaponTable[DEFAULT_WEAPON_ID])!;
  const overrides = asRecord(source.combat ?? source.stats ?? source.weaponStats);
  return {
    ...profile,
    id,
    displayName: normalizeLabel(source.name, profile.displayName),
    staminaMultiplier: clamp(positiveOr(overrides.staminaMultiplier, profile.staminaMultiplier), 0.35, 3),
    damageMultiplier: clamp(positiveOr(overrides.damageMultiplier, profile.damageMultiplier), 0.1, 4),
    reachMultiplier: clamp(positiveOr(overrides.reachMultiplier, profile.reachMultiplier), 0.35, 6),
    activeStartShift: clamp(finiteOr(overrides.activeStartShift, profile.activeStartShift), -0.12, 0.12),
    activeEndShift: clamp(finiteOr(overrides.activeEndShift, profile.activeEndShift), -0.12, 0.12),
    durationMultiplier: clamp(positiveOr(overrides.durationMultiplier, profile.durationMultiplier), 0.5, 2.5),
    commitMultiplier: clamp(positiveOr(overrides.commitMultiplier, profile.commitMultiplier), 0.2, 2.5),
    guardBreakMultiplier: clamp(positiveOr(overrides.guardBreakMultiplier, profile.guardBreakMultiplier), 0.1, 3),
    poiseMultiplier: clamp(positiveOr(overrides.poiseMultiplier, profile.poiseMultiplier), 0.1, 3),
    socket: profile.socket,
    animationFamily: profile.animationFamily,
    materialSurface: profile.materialSurface,
    projectile: Boolean(profile.projectile || source.projectile || source.ranged),
    twoHanded: Boolean(profile.twoHanded || source.twoHanded),
  };
}

function readArmorProfile(items: PlayerEquipmentSlots): PlayerArmorProfile {
  const source = [items.chest, items.head].find(Boolean) as EquipmentItem | undefined;
  const id = readItemId(source, DEFAULT_ARMOR_ID);
  const sourceRecord = asRecord(source);
  const explicitType = normalizeId(sourceRecord.armorType ?? sourceRecord.type ?? sourceRecord.category, '');
  const armorTable = PLAYER_ARMOR_PROFILES as unknown as Record<string, PlayerArmorProfile>;
  const profile = (armorTable[id] ?? armorTable[explicitType] ?? Object.values(armorTable).find((candidate) => candidate.id === id) ?? armorTable[DEFAULT_ARMOR_ID])!;
  const stats = asRecord(sourceRecord.armor ?? sourceRecord.stats ?? sourceRecord.armorStats);
  const extraPoise = finiteOr(stats.poiseBonus, 0);
  return {
    ...profile,
    id,
    displayName: normalizeLabel(sourceRecord.name, profile.displayName),
    movementMultiplier: clamp(positiveOr(stats.movementMultiplier, profile.movementMultiplier), 0.55, 1.15),
    staminaDrainMultiplier: clamp(positiveOr(stats.staminaDrainMultiplier, profile.staminaDrainMultiplier), 0.55, 1.8),
    staminaRegenMultiplier: clamp(positiveOr(stats.staminaRegenMultiplier, profile.staminaRegenMultiplier), 0.55, 1.25),
    poiseBonus: clamp(extraPoise + profile.poiseBonus, 0, MAX_NUMBER),
    guardDamageMultiplier: clamp(positiveOr(stats.guardDamageMultiplier, profile.guardDamageMultiplier), 0.35, 1.25),
    dodgeDistanceMultiplier: clamp(positiveOr(stats.dodgeDistanceMultiplier, profile.dodgeDistanceMultiplier), 0.6, 1.1),
    animationFamily: profile.animationFamily,
    materialSurfaces: Array.isArray(profile.materialSurfaces) ? [...profile.materialSurfaces] : ['cloth'],
  };
}

function normalizeSlotSnapshot(snapshot: unknown = {}): PlayerEquipmentSlots {
  const source = asRecord(snapshot);
  const result = {} as Record<SlotName, EquipmentItem | null>;
  const aliases = SLOT_ALIASES as unknown as Record<SlotName, readonly string[]>;
  for (const slot of Object.keys(aliases) as SlotName[]) {
    const aliasSet = new Set(aliases[slot]);
    const candidate = Object.entries(source).find(([key]) => aliasSet.has(normalizeId(key, '')))?.[1];
    result[slot] = candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as EquipmentItem : null;
  }
  return Object.freeze(result) as PlayerEquipmentSlots;
}

export function resolvePlayerEquipmentCombatProfile(snapshot: unknown = {}): PlayerResolvedEquipmentProfile {
  const slots = normalizeSlotSnapshot(snapshot);
  const mainHand = readWeaponProfile(slots.mainHand);
  const offHand = readWeaponProfile(slots.offHand);
  const armor = readArmorProfile(slots);
  const shieldEquipped = Boolean(slots.offHand) && ['shield', 'buckler', 'shield-bash', 'buckler'].includes(offHand.id);
  const ranged = Boolean(mainHand.projectile);
  const twoHanded = Boolean(mainHand.twoHanded || (!slots.offHand && mainHand.id !== DEFAULT_WEAPON_ID));
  const effectiveGuardMultiplier = clamp((shieldEquipped ? 0.82 : 1) * armor.guardDamageMultiplier, 0.25, 1.2);
  return freezeDeep({
    version: 1,
    slots,
    mainHand,
    offHand,
    armor,
    shieldEquipped,
    ranged,
    twoHanded,
    effectiveGuardMultiplier,
    sourceIds: {
      mainHand: readItemId(slots.mainHand, DEFAULT_WEAPON_ID),
      offHand: readItemId(slots.offHand, 'none'),
      head: readItemId(slots.head, 'none'),
      chest: readItemId(slots.chest, DEFAULT_ARMOR_ID),
      back: readItemId(slots.back, 'none'),
    },
  });
}

function phaseFor(kind: AttackKind): Readonly<{ activeStart: number; activeEnd: number; duration: number; reach: number; damageScale: number; commitMeters: number }> {
  const phases = ATTACK_PHASES as unknown as Record<AttackKind, Readonly<{ activeStart: number; activeEnd: number; duration: number; reach: number; damageScale: number; commitMeters: number }>>;
  return (phases[kind] ?? phases[DEFAULT_ATTACK_KIND])!;
}

export function resolvePlayerAttackTuning(base: unknown, profile: PlayerResolvedEquipmentProfile | null | undefined, kind: AttackKind = DEFAULT_ATTACK_KIND): PlayerAttackTuning {
  const resolved = profile || resolvePlayerEquipmentCombatProfile();
  const phase = phaseFor(kind);
  const weapon = resolved.mainHand;
  const armor = resolved.armor;
  const baseRecord = asRecord(base);
  const baseValue = (key: string, fallback: number): number => finiteOr(baseRecord[key], fallback);
  const staminaCost = baseValue('staminaCost', kind === 'heavy' ? 24 : 12);
  const duration = baseValue('duration', phase.duration);
  const activeStart = baseValue('activeStart', phase.activeStart);
  const activeEnd = baseValue('activeEnd', phase.activeEnd);
  const reach = baseValue('reach', phase.reach);
  const damageScale = baseValue('damageScale', phase.damageScale);
  const commitMeters = baseValue('commitMeters', phase.commitMeters);
  const tunedDuration = clamp(duration * weapon.durationMultiplier, 0.18, 2.5);
  const tunedActiveStart = clamp(activeStart * weapon.durationMultiplier + weapon.activeStartShift, 0.04, Math.max(0.05, tunedDuration - 0.04));
  const tunedActiveEnd = clamp(activeEnd * weapon.durationMultiplier + weapon.activeEndShift, tunedActiveStart + 0.03, Math.max(tunedActiveStart + 0.04, tunedDuration - 0.02));
  return freezeDeep({
    cost: clamp(staminaCost * weapon.staminaMultiplier * armor.staminaDrainMultiplier, 2, 80),
    duration: tunedDuration,
    activeStart: tunedActiveStart,
    activeEnd: tunedActiveEnd,
    reach: clamp(reach * weapon.reachMultiplier, 0.35, 12),
    damageScale: clamp(damageScale * weapon.damageMultiplier, 0.1, 6),
    commitMeters: clamp(commitMeters * weapon.commitMultiplier * armor.movementMultiplier, 0.05, 2.8),
    guardBreakMultiplier: clamp(weapon.guardBreakMultiplier, 0.1, 3),
    poiseMultiplier: clamp(weapon.poiseMultiplier, 0.1, 3),
    guardDamageMultiplier: resolved.effectiveGuardMultiplier,
    armorPoiseBonus: armor.poiseBonus,
    movementMultiplier: armor.movementMultiplier,
    staminaRegenMultiplier: armor.staminaRegenMultiplier,
    dodgeDistanceMultiplier: armor.dodgeDistanceMultiplier,
    isRanged: resolved.ranged,
    twoHanded: resolved.twoHanded,
  });
}

export function resolvePlayerAnimationPlan(profile: PlayerResolvedEquipmentProfile | null | undefined, { movementState = 'idle', attackKind = 'none', comboStep = 0, speedMps = 0, grounded = true }: { movementState?: string; attackKind?: string; comboStep?: unknown; speedMps?: unknown; grounded?: unknown } = {}): PlayerAnimationPlan {
  const resolved = profile || resolvePlayerEquipmentCombatProfile();
  const family = resolved.mainHand.animationFamily || resolved.armor.animationFamily || 'light';
  const animationFamilies = ANIMATION_FAMILY_ALIASES as unknown as Record<string, AnimationAliasSet>;
  const aliases = animationFamilies[family] ?? animationFamilies['arming-sword']!;
  let action = aliases.idle;
  if (movementState === 'dodge') action = aliases.dodge;
  else if (movementState === 'parry') action = aliases.parry;
  else if (movementState === 'hit-stagger' || movementState === 'guard-break') action = aliases.hit;
  else if (movementState === 'guard') action = aliases.guard;
  else if (attackKind === 'light' || attackKind === 'heavy') action = aliases[attackKind] || aliases.idle;
  const safeSpeedMps = finiteOr(speedMps, 0);
  const safeComboStep = finiteOr(comboStep, 0);
  if (attackKind !== 'light' && attackKind !== 'heavy' && safeSpeedMps > 4.2) action = aliases.running;
  else if (attackKind !== 'light' && attackKind !== 'heavy' && safeSpeedMps > 0.15) action = aliases.walking;
  const weight = attackKind === 'none' ? 1 : clamp(0.84 + Math.min(0.16, Math.max(0, safeComboStep - 1) * 0.08), 0, 1);
  const timeScale = attackKind === 'heavy' ? 0.92 : attackKind === 'light' ? 1 : movementState === 'dodge' ? 1.45 : 1;
  return freezeDeep({
    family,
    action,
    comboStep: clamp(Math.floor(safeComboStep), 0, 3),
    weight,
    timeScale,
    grounded: Boolean(grounded),
    locomotionLayer: movementState === 'idle' ? 'idle' : movementState.startsWith('attack-') ? 'attack' : 'locomotion',
    equipmentRevisionKey: `${resolved.sourceIds.mainHand}|${resolved.sourceIds.offHand}|${resolved.sourceIds.chest}|${resolved.sourceIds.head}`,
  });
}

function findSocketName(root: PlayerObject3DLike | unknown, slot: SlotName): string | null {
  const candidates = new Set((SOCKET_CANDIDATES as unknown as Record<SlotName, readonly string[]>)[slot] ?? []);
  let found: string | null = null;
  const traverse = (asRecord(root).traverse);
  if (typeof traverse !== 'function') return null;
  traverse((node: unknown) => {
    const candidate = asRecord(node).name;
    if (found || typeof candidate !== 'string' || !candidate) return;
    if (candidates.has(candidate)) found = candidate;
  });
  return found;
}

export function buildPlayerEquipmentSocketPlan(root: unknown, profile: PlayerResolvedEquipmentProfile | null | undefined): PlayerEquipmentSocketPlan {
  const resolved = profile || resolvePlayerEquipmentCombatProfile();
  const bindings = {} as Record<SlotName, PlayerEquipmentSocketBinding | null>;
  for (const slot of Object.keys(SOCKET_CANDIDATES) as SlotName[]) {
    const item = resolved.slots[slot];
    bindings[slot] = item ? {
      socket: findSocketName(root, slot),
      required: Boolean(item),
      itemId: resolved.sourceIds[slot] || readItemId(item, 'none'),
      fallbackSocket: slot,
    } : null;
  }
  return freezeDeep({ version: 1, bindings });
}

function surfaceHintsForItem(item: unknown, fallback: string): string[] {
  const profile = readWeaponProfile(item);
  const fallbacks = MATERIAL_SURFACE_FALLBACKS as unknown as Record<string, readonly string[]>;
  const hints = fallbacks[profile.materialSurface] ?? [fallback];
  return [...new Set(hints.map((value) => normalizeId(value, fallback)))];
}

export function buildPlayerMaterialAssignmentMetadata({ object = null, metadata = {}, profile = null, textureSize = DEFAULT_TEXTURE_SIZE }: { object?: unknown; metadata?: UnknownRecord; profile?: PlayerResolvedEquipmentProfile | null; textureSize?: unknown } = {}): PlayerMaterialAssignmentMetadata {
  const resolved = profile ?? resolvePlayerEquipmentCombatProfile();
  const objectData = asRecord(object);
  const metadataRecord = asRecord(metadata);
  const size = clamp(Math.floor(finiteOr(textureSize, DEFAULT_TEXTURE_SIZE)), 128, 512);
  return freezeDeep({
    id: normalizeId(metadataRecord.id ?? asRecord(objectData.userData).assetId ?? objectData.name, 'player'),
    name: normalizeLabel(metadataRecord.name ?? objectData.name, 'player'),
    category: normalizeLabel(metadataRecord.category ?? asRecord(objectData.userData).assetCategory, 'character'),
    src: String(metadataRecord.src ?? asRecord(objectData.userData).assetSrc ?? 'assets/models/characters/peasant_girl.fbx'),
    textureSize: size,
    layeredFallbackAllowed: true,
    importedMaterialsPreferred: true,
    equipmentSurfaces: {
      mainHand: surfaceHintsForItem(resolved.slots.mainHand, 'metal'),
      offHand: surfaceHintsForItem(resolved.slots.offHand, 'metal'),
      armor: [...resolved.armor.materialSurfaces],
    },
    materialContract: 'MaterialAssignmentCore',
    placementContract: 'WorldAssetPlacementPipeline',
    editorUiImportForbidden: true,
  });
}

export function buildPlayerEquipmentRuntimeSnapshot({ object = null, equipment = {}, now = () => 0 }: { object?: unknown; equipment?: unknown; now?: () => number } = {}): PlayerEquipmentRuntimeSnapshot {
  const profile = resolvePlayerEquipmentCombatProfile(equipment);
  const socketPlan = buildPlayerEquipmentSocketPlan(object, profile);
  const animation = resolvePlayerAnimationPlan(profile);
  const material = buildPlayerMaterialAssignmentMetadata({ object, profile });
  return freezeDeep({
    version: 1,
    timestamp: finiteOr(now(), 0),
    profile,
    socketPlan,
    animation,
    material,
    audit: auditPlayerEquipmentProfile(profile, { socketPlan }),
  });
}

export function auditPlayerEquipmentProfile(profile: PlayerResolvedEquipmentProfile | null | undefined, { socketPlan = null }: { socketPlan?: PlayerEquipmentSocketPlan | null } = {}): Readonly<{ ok: boolean; errors: readonly string[]; warnings: readonly string[] }> {
  const resolved = profile || resolvePlayerEquipmentCombatProfile();
  const errors = [];
  const warnings = [];
  if (!resolved.mainHand?.id) errors.push('missing-main-hand');
  if (!resolved.armor?.id) errors.push('missing-armor');
  for (const [name, value] of Object.entries(resolved.mainHand || {})) {
    if (typeof value === 'number' && !Number.isFinite(value)) errors.push(`mainHand-non-finite:${name}`);
  }
  for (const [name, value] of Object.entries(resolved.armor || {})) {
    if (typeof value === 'number' && !Number.isFinite(value)) errors.push(`armor-non-finite:${name}`);
  }
  if (resolved.mainHand?.projectile && !resolved.twoHanded) warnings.push('ranged-profile-not-two-handed');
  if (resolved.armor?.movementMultiplier < 0.7) warnings.push('very-heavy-movement-profile');
  if (socketPlan) {
    for (const [slot, binding] of Object.entries(socketPlan.bindings || {})) {
      if (binding?.required && !binding.socket) warnings.push(`socket-fallback:${slot}`);
    }
  }
  return freezeDeep({ ok: errors.length === 0, errors, warnings });
}

export function createPlayerEquipmentRuntime({ getEquipment = () => ({}), object3D = null, now = () => 0 }: { getEquipment?: (() => unknown) | unknown; object3D?: PlayerObject3DLike | null; now?: () => number } = {}) {
  let disposed = false;
  let revision = 0;
  const initialEquipment = typeof getEquipment === 'function' ? getEquipment() : getEquipment;
  let snapshot = buildPlayerEquipmentRuntimeSnapshot({ object: object3D, equipment: initialEquipment || {}, now });

  function refresh(): PlayerEquipmentRuntimeSnapshot {
    if (disposed) return snapshot;
    const equipment = typeof getEquipment === 'function' ? (getEquipment() || {}) : (getEquipment || {});
    revision += 1;
    snapshot = freezeDeep({ ...buildPlayerEquipmentRuntimeSnapshot({ object: object3D, equipment, now }), revision });
    if (object3D) object3D.userData.playerEquipment = snapshot;
    return snapshot;
  }

  function read(): PlayerEquipmentRuntimeSnapshot { return snapshot; }
  function dispose(): void { disposed = true; }

  if (object3D) object3D.userData.playerEquipment = snapshot;
  return Object.freeze({ refresh, read, dispose });
}

export function isSupportedPlayerWeaponId(value: unknown): boolean {
  const table = PLAYER_WEAPON_PROFILES as unknown as Record<string, PlayerWeaponProfile>;
  return Boolean(table[normalizeId(value, '')]);
}

export function isSupportedPlayerArmorId(value: unknown): boolean {
  const table = PLAYER_ARMOR_PROFILES as unknown as Record<string, PlayerArmorProfile>;
  return Boolean(table[normalizeId(value, '')]);
}

export { SLOT_ALIASES, SOCKET_CANDIDATES, ANIMATION_FAMILY_ALIASES };


export interface PlayerEquipmentCombatProfileContract { readonly weaponId: string; readonly armorId: string; readonly damageMultiplier: number; readonly staminaMultiplier: number; }
