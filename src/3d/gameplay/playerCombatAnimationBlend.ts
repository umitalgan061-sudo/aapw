/** Production TypeScript owner for pure player combat/locomotion animation blending. */

export const PLAYER_COMBAT_ANIMATION_BLEND_VERSION = '2026-09-30-v2' as const;

export type PlayerAnimationSemanticState =
  | 'idle'
  | 'locomotion'
  | 'light-attack'
  | 'heavy-attack'
  | 'guard'
  | 'dodge'
  | 'hit-stagger'
  | string;

export interface PlayerCombatAnimationBlendInput {
  readonly semanticState?: unknown;
  readonly planarSpeedMps?: unknown;
  readonly attackPhase?: unknown;
  readonly guardWeight?: unknown;
  readonly locomotionFadeInMps?: unknown;
  readonly locomotionFadeOutMps?: unknown;
  readonly combatOverlayWeight?: unknown;
  readonly additiveFeedbackWeight?: unknown;
}

export interface PlayerCombatAnimationBlendResult {
  readonly version: typeof PLAYER_COMBAT_ANIMATION_BLEND_VERSION;
  readonly semanticState: PlayerAnimationSemanticState;
  readonly speedMps: number;
  readonly locomotionWeight: number;
  readonly baseWeight: number;
  readonly combatOverlayWeight: number;
  readonly attackWeight: number;
  readonly guardWeight: number;
  readonly dodgeWeight: number;
  readonly staggerWeight: number;
  readonly additiveFeedbackWeight: number;
}

const COMBAT_STATES = new Set<string>([
  'light-attack',
  'heavy-attack',
  'guard',
  'dodge',
  'hit-stagger',
]);

const finite = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const normalizeState = (value: unknown): PlayerAnimationSemanticState =>
  String(value || 'idle').toLowerCase();

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function resolvePlayerCombatAnimationBlend(
  {
    semanticState = 'idle',
    planarSpeedMps = 0,
    attackPhase = 0,
    guardWeight = 0,
    locomotionFadeInMps = 0.15,
    locomotionFadeOutMps = 5.6,
    combatOverlayWeight = 0.9,
    additiveFeedbackWeight = 0,
  }: PlayerCombatAnimationBlendInput = {},
): PlayerCombatAnimationBlendResult {
  const state = normalizeState(semanticState);
  const speed = Math.max(0, finite(planarSpeedMps));
  const phase = clamp(finite(attackPhase), 0, 1);
  const guard = clamp(finite(guardWeight), 0, 1);
  const overlayCap = clamp(finite(combatOverlayWeight, 0.9), 0, 1);
  const additive = clamp(finite(additiveFeedbackWeight), 0, 1);
  const fadeIn = Math.max(0, finite(locomotionFadeInMps, 0.15));
  const fadeOut = Math.max(0.16, finite(locomotionFadeOutMps, 5.6));
  const locomotion = state === 'idle'
    ? 0
    : smoothstep(fadeIn, fadeOut, speed);
  const combat = COMBAT_STATES.has(state) ? overlayCap : 0;
  const attack = state === 'light-attack' || state === 'heavy-attack'
    ? overlayCap * Math.max(phase, 0.2)
    : 0;
  const dodge = state === 'dodge' ? overlayCap : 0;
  const stagger = state === 'hit-stagger' ? overlayCap : 0;
  const guardLayer = state === 'guard' ? Math.max(guard, 0.25) : 0;
  const locomotionWeight = clamp(locomotion * (1 - combat), 0, 1);
  const baseWeight = clamp(1 - locomotionWeight, 0, 1);

  return Object.freeze({
    version: PLAYER_COMBAT_ANIMATION_BLEND_VERSION,
    semanticState: state,
    speedMps: round(speed, 3),
    locomotionWeight: round(locomotionWeight, 4),
    baseWeight: round(baseWeight, 4),
    combatOverlayWeight: round(combat, 4),
    attackWeight: round(attack, 4),
    guardWeight: round(guardLayer, 4),
    dodgeWeight: round(dodge, 4),
    staggerWeight: round(stagger, 4),
    additiveFeedbackWeight: round(additive, 4),
  });
}

export function validatePlayerCombatAnimationBlend(
  blend: Partial<PlayerCombatAnimationBlendResult> | null | undefined,
): blend is PlayerCombatAnimationBlendResult {
  if (!blend || typeof blend !== 'object') return false;
  if (blend.version !== PLAYER_COMBAT_ANIMATION_BLEND_VERSION) return false;
  const weights: readonly unknown[] = [
    blend.locomotionWeight,
    blend.baseWeight,
    blend.combatOverlayWeight,
    blend.attackWeight,
    blend.guardWeight,
    blend.dodgeWeight,
    blend.staggerWeight,
    blend.additiveFeedbackWeight,
  ];
  return weights.every((weight) => typeof weight === 'number' && Number.isFinite(weight) && weight >= 0 && weight <= 1)
    && Number(blend.locomotionWeight) + Number(blend.combatOverlayWeight) <= 1.0001;
}
