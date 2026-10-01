import { resolvePlayerAnimationIntent } from './playerAnimationDirector.legacy.js';
import { resolvePlayerEquipmentCombatProfile } from './playerEquipmentCombatProfile.js';

export type PlayerAnimationEquipmentIntentInput = {
  equipment?: Record<string, unknown>;
  movementState?: string;
  planarSpeedMps?: number;
  runIntent?: boolean;
  attackKind?: string;
  guarding?: boolean;
  dodgeRemaining?: number;
  hitStaggerRemaining?: number;
  availableActions?: Record<string, unknown>;
};

export type PlayerAnimationEquipmentIntent = Readonly<{
  action: string;
  semanticState: string;
  resolvedSemanticState: string;
  assetKey: string;
  equipment: Readonly<{
    mainHandId: string;
    offHandId: string;
    chestId: string;
    weaponFamily: string;
    armorFamily: string;
    ranged: boolean;
    twoHanded: boolean;
    shieldEquipped: boolean;
    materialSurfaces: readonly string[];
  }>;
  animationFamily: string;
  locomotionProfile: string;
  upperBodyLayer: string;
  lowerBodyLayer: string;
  fallback: boolean;
}>;

const finite = (value: unknown, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const text = (value: unknown, fallback = '') => typeof value === 'string' && value.length > 0 ? value : fallback;

const freeze = <T>(value: T): T => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return value;
};

function resolveAnimationFamily(profile: any, semanticState: string) {
  if (semanticState === 'dodge') return 'evasive';
  if (semanticState === 'guard') return profile.shieldEquipped ? 'shield-guard' : 'weapon-guard';
  if (semanticState === 'heavy-attack') return profile.twoHanded ? 'two-handed-heavy' : 'heavy';
  if (semanticState === 'light-attack') return profile.ranged ? 'ranged-attack' : 'melee-light';
  if (semanticState === 'sprint') return profile.armorFamily === 'plate' ? 'armored-sprint' : 'sprint';
  if (semanticState === 'locomotion') return profile.armorFamily === 'plate' ? 'armored-locomotion' : 'locomotion';
  return 'neutral';
}

function resolveUpperBodyLayer(profile: any, semanticState: string) {
  if (semanticState === 'guard') return profile.shieldEquipped ? 'guard-shield' : 'guard-weapon';
  if (semanticState === 'heavy-attack') return profile.twoHanded ? 'attack-heavy-two-handed' : 'attack-heavy';
  if (semanticState === 'light-attack') return profile.ranged ? 'attack-ranged' : 'attack-light';
  if (semanticState === 'dodge' || semanticState === 'hit-stagger') return 'combat-reactive';
  return 'upper-body-neutral';
}

function resolveLowerBodyLayer(profile: any, semanticState: string) {
  if (semanticState === 'sprint') return profile.armorFamily === 'plate' ? 'lower-armored-sprint' : 'lower-sprint';
  if (semanticState === 'locomotion') return profile.armorFamily === 'plate' ? 'lower-armored-locomotion' : 'lower-locomotion';
  if (semanticState === 'dodge') return 'lower-evasive';
  return 'lower-neutral';
}

export function resolvePlayerEquipmentAnimationIntent(input: PlayerAnimationEquipmentIntentInput = {}): PlayerAnimationEquipmentIntent {
  const profile = resolvePlayerEquipmentCombatProfile(input.equipment ?? {} as any) as any;
  const animation = resolvePlayerAnimationIntent({
    movementState: input.movementState ?? 'idle',
    planarSpeedMps: finite(input.planarSpeedMps),
    runIntent: Boolean(input.runIntent),
    attackKind: input.attackKind ?? 'none',
    guarding: Boolean(input.guarding),
    dodgeRemaining: finite(input.dodgeRemaining),
    hitStaggerRemaining: finite(input.hitStaggerRemaining),
    availableActions: input.availableActions ?? {},
  }) as any;
  const semanticState = text(animation.semanticState, 'idle');
  const equipment = freeze({
    mainHandId: text(profile.mainHand?.id, 'unarmed'),
    offHandId: text(profile.offHand?.id, 'empty'),
    chestId: text(profile.chest?.id, 'default-chest'),
    weaponFamily: text(profile.weaponFamily, 'unarmed'),
    armorFamily: text(profile.armorFamily, 'cloth'),
    ranged: Boolean(profile.ranged),
    twoHanded: Boolean(profile.twoHanded),
    shieldEquipped: Boolean(profile.shieldEquipped),
    materialSurfaces: Array.isArray(profile.materialSurfaces) ? [...profile.materialSurfaces].map((entry: unknown) => text(entry)).filter(Boolean) : [],
  });
  return freeze({
    action: text(animation.action, 'idle'),
    semanticState,
    resolvedSemanticState: text(animation.resolvedSemanticState, semanticState),
    assetKey: text(animation.assetKey, 'idle'),
    equipment,
    animationFamily: resolveAnimationFamily(profile, semanticState),
    locomotionProfile: text(profile.locomotionProfile, profile.armorFamily === 'plate' ? 'armored' : 'standard'),
    upperBodyLayer: resolveUpperBodyLayer(profile, semanticState),
    lowerBodyLayer: resolveLowerBodyLayer(profile, semanticState),
    fallback: Boolean(animation.fallback),
  });
}

export function isPlayerEquipmentAnimationIntent(value: unknown): value is PlayerAnimationEquipmentIntent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as any;
  return Object.isFrozen(candidate)
    && typeof candidate.action === 'string'
    && typeof candidate.semanticState === 'string'
    && typeof candidate.animationFamily === 'string'
    && Object.isFrozen(candidate.equipment)
    && Array.isArray(candidate.equipment.materialSurfaces);
}
