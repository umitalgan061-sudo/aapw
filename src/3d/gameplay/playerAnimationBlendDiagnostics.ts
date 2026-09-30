/** Production TypeScript owner for src/3d/gameplay/playerAnimationBlendDiagnostics.js. Legacy .js remains compatibility-only. */
export const STATE_GROUPS = Object.freeze({
  idle: 'locomotion', locomotion: 'locomotion', sprint: 'locomotion',
  guard: 'defense', parry: 'defense', dodge: 'evasion',
  'light-attack': 'attack', 'heavy-attack': 'attack', 'hit-stagger': 'reaction',
} as const);

export const DEFAULT_THRESHOLDS = Object.freeze({
  idleSpeedMps: 0.15,
  sprintSpeedMps: 5.6,
  attackInterruptSeconds: 0.18,
  defenseInterruptSeconds: 0.08,
} as const);

type AnimationSemanticState = keyof typeof STATE_GROUPS;
type AnimationGroup = typeof STATE_GROUPS[AnimationSemanticState];
export interface AnimationBlendInput {
  readonly semanticState?: unknown;
  readonly planarSpeedMps?: unknown;
  readonly runIntent?: unknown;
  readonly attackKind?: unknown;
  readonly guarding?: unknown;
  readonly primaryState?: unknown;
  readonly primaryWeight?: unknown;
  readonly secondaryState?: unknown;
  readonly secondaryWeight?: unknown;
  readonly environmentalConfidence?: unknown;
  readonly footPlantWeight?: unknown;
  readonly combatReadiness?: unknown;
  readonly locomotion?: { readonly walkWeight?: unknown; readonly runWeight?: unknown } | null;
  readonly fromState?: unknown;
  readonly toState?: unknown;
  readonly normalizedTime?: unknown;
  readonly canInterrupt?: unknown;
}

const finite = (value: unknown, fallback = 0): number => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value: unknown, min: number, max: number): number => Math.max(min, Math.min(max, finite(value, min)));
const clamp01 = (value: unknown): number => clamp(finite(value), 0, 1);
const round = (value: unknown, digits = 4): number => {
  const factor = 10 ** digits;
  const output = Math.round(finite(value) * factor) / factor;
  return Object.is(output, -0) ? 0 : output;
};
const normalizeState = (state: unknown): AnimationSemanticState => {
  const value = String(state ?? 'idle').trim().toLowerCase();
  return value in STATE_GROUPS ? value as AnimationSemanticState : 'idle';
};
const resolveGroup = (state: unknown): AnimationGroup => STATE_GROUPS[normalizeState(state)];

function normalizeWeights(weights: Record<string, unknown>): Readonly<Record<string, number>> {
  const values = Object.entries(weights)
    .map(([key, value]) => [String(key), Math.max(0, finite(value))] as const)
    .filter(([, value]) => value > 0);
  const total = values.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return Object.freeze({ idle: 1 });
  const normalized: Record<string, number> = {};
  for (const [key, value] of values) normalized[key] = round(value / total, 6);
  return Object.freeze(normalized);
}

export function classifyAnimationBlendState({
  semanticState = 'idle',
  planarSpeedMps = 0,
  runIntent = false,
  attackKind = 'none',
  guarding = false,
}: AnimationBlendInput = {}) {
  const state = normalizeState(semanticState);
  const speed = Math.max(0, finite(planarSpeedMps));
  const expected = attackKind === 'heavy' ? 'heavy-attack'
    : attackKind === 'light' ? 'light-attack'
    : guarding ? 'guard'
    : Boolean(runIntent) || speed >= DEFAULT_THRESHOLDS.sprintSpeedMps ? 'sprint'
    : speed >= DEFAULT_THRESHOLDS.idleSpeedMps ? 'locomotion' : 'idle';
  return Object.freeze({
    semanticState: state,
    expectedState: expected as AnimationSemanticState,
    group: resolveGroup(state),
    stateMatches: state === expected,
    speedMps: round(speed, 3),
  });
}

export function buildPlayerAnimationBlendContract({
  primaryState = 'idle',
  primaryWeight = 1,
  secondaryState = null,
  secondaryWeight = 0,
  environmentalConfidence = 1,
  footPlantWeight = 0.7,
  combatReadiness = 1,
  locomotion = null,
}: AnimationBlendInput = {}) {
  const primary = normalizeState(primaryState);
  const secondary = secondaryState ? normalizeState(secondaryState) : null;
  const weights = normalizeWeights({ [primary]: primaryWeight, ...(secondary ? { [secondary]: secondaryWeight } : {}) });
  const confidence = clamp01(environmentalConfidence);
  const footPlant = clamp(footPlantWeight, 0.34, 1);
  const readiness = clamp01(combatReadiness);
  const locomotionWeights = locomotion && typeof locomotion === 'object'
    ? normalizeWeights({ walking: locomotion.walkWeight, running: locomotion.runWeight })
    : normalizeWeights({ walking: primary === 'sprint' ? 0 : 1, running: primary === 'sprint' ? 1 : 0 });
  const dominantState = Object.entries(weights).sort((a, b) => b[1] - a[1])[0]?.[0] || 'idle';
  return Object.freeze({
    primaryState: primary,
    secondaryState: secondary,
    normalizedWeights: weights,
    locomotionWeights,
    environmentalConfidence: round(confidence),
    footPlantWeight: round(footPlant),
    combatReadiness: round(readiness),
    interruptibility: round(primary === 'heavy-attack' ? 1 - DEFAULT_THRESHOLDS.attackInterruptSeconds : primary === 'guard' || primary === 'parry' ? 1 - DEFAULT_THRESHOLDS.defenseInterruptSeconds : 1),
    dominantState,
  });
}

export function resolveAnimationTransitionWindow({
  fromState = 'idle',
  toState = 'idle',
  normalizedTime = 0,
  canInterrupt = true,
  environmentConfidence = 1,
}: AnimationBlendInput = {}) {
  const from = normalizeState(fromState);
  const to = normalizeState(toState);
  const time = clamp01(normalizedTime);
  const confidence = clamp01(environmentConfidence);
  const sameGroup = resolveGroup(from) === resolveGroup(to);
  const attackBoundary = from.includes('attack') && time < DEFAULT_THRESHOLDS.attackInterruptSeconds;
  const defenseBoundary = (from === 'guard' || from === 'parry') && time < DEFAULT_THRESHOLDS.defenseInterruptSeconds;
  const protectedWindow = attackBoundary || defenseBoundary;
  const permitted = Boolean(canInterrupt) && !protectedWindow;
  const crossfadeSeconds = sameGroup ? 0.14 : 0.22;
  return Object.freeze({
    from, to, sameGroup, normalizedTime: round(time),
    protectedWindow, permitted,
    crossfadeSeconds: round(crossfadeSeconds * (1 + (1 - confidence) * 0.15), 4),
  });
}

export function auditAnimationBlendContract(contract: unknown): Readonly<{ ok: boolean; errors: readonly string[]; warnings: readonly string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!contract || typeof contract !== 'object') return Object.freeze({ ok: false, errors: Object.freeze(['missing-contract']), warnings: Object.freeze([]) });
  const value = contract as Record<string, unknown>;
  const weights = value.normalizedWeights && typeof value.normalizedWeights === 'object' ? value.normalizedWeights as Record<string, unknown> : {};
  const sum = Object.values(weights).reduce((total, weight) => total + finite(weight), 0);
  if (Math.abs(sum - 1) > 0.00001) errors.push('weights-do-not-sum-to-one');
  for (const [state, weight] of Object.entries(weights)) if (finite(weight) < 0 || finite(weight) > 1) errors.push(`weight-out-of-range:${state}`);
  if (clamp01(value.environmentalConfidence) !== finite(value.environmentalConfidence)) errors.push('confidence-non-finite');
  if (finite(value.footPlantWeight, 0) < 0.34 || finite(value.footPlantWeight, 0) > 1) errors.push('footplant-out-of-range');
  if (finite(value.combatReadiness, 0) < 0 || finite(value.combatReadiness, 0) > 1) errors.push('readiness-out-of-range');
  if (value.secondaryState && value.secondaryState === value.primaryState) warnings.push('duplicate-primary-secondary-state');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze([...new Set(errors)]), warnings: Object.freeze([...new Set(warnings)]) });
}

export function buildAnimationBlendDiagnostics(input: AnimationBlendInput = {}) {
  const classification = classifyAnimationBlendState(input);
  const contract = buildPlayerAnimationBlendContract(input);
  const transition = resolveAnimationTransitionWindow({
    fromState: input.fromState ?? classification.semanticState,
    toState: input.toState ?? classification.expectedState,
    normalizedTime: input.normalizedTime,
    canInterrupt: input.canInterrupt,
    environmentConfidence: input.environmentalConfidence,
  });
  return Object.freeze({ classification, contract, transition, audit: auditAnimationBlendContract(contract) });
}
