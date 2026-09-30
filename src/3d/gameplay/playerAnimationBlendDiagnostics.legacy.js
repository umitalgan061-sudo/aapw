/**
 * Diagnostics for locomotion/combat animation blending in the existing player presentation seam.
 *
 * This is deliberately a pure policy module. It does not own AnimationMixer, combat state,
 * movement, hitboxes, or terrain. Callers pass resolved semantic state and environment values;
 * the module reports a bounded blend contract suitable for a renderer/controller adapter.
 *
 * @module gameplay/playerAnimationBlendDiagnostics
 */
const STATE_GROUPS = Object.freeze({
  idle: 'locomotion', locomotion: 'locomotion', sprint: 'locomotion', guard: 'defense', parry: 'defense',
  dodge: 'evasion', 'light-attack': 'attack', 'heavy-attack': 'attack', 'hit-stagger': 'reaction',
});
const DEFAULT_THRESHOLDS = Object.freeze({ idleSpeedMps: 0.15, sprintSpeedMps: 5.6, attackInterruptSeconds: 0.18, defenseInterruptSeconds: 0.08 });

function finite(value, fallback = 0) { const numeric = Number(value); return Number.isFinite(numeric) ? numeric : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function clamp01(value) { return clamp(finite(value), 0, 1); }
function round(value, digits = 4) { const factor = 10 ** digits; const output = Math.round(finite(value) * factor) / factor; return Object.is(output, -0) ? 0 : output; }
function normalizeState(state) { const value = String(state ?? 'idle').trim().toLowerCase(); return STATE_GROUPS[value] ? value : 'idle'; }
function resolveGroup(state) { return STATE_GROUPS[normalizeState(state)] || 'locomotion'; }
function normalizeWeights(weights) {
  const values = Object.entries(weights || {}).map(([key, value]) => [String(key), Math.max(0, finite(value))]).filter(([, value]) => value > 0);
  const total = values.reduce((sum, [, value]) => sum + value, 0);
  if (!total) return Object.freeze({ idle: 1 });
  const normalized = {}; for (const [key, value] of values) normalized[key] = round(value / total, 6); return Object.freeze(normalized);
}

export function classifyAnimationBlendState({ semanticState = 'idle', planarSpeedMps = 0, runIntent = false, attackKind = 'none', guarding = false } = {}) {
  const state = normalizeState(semanticState); const speed = Math.max(0, finite(planarSpeedMps));
  const expected = attackKind === 'heavy' ? 'heavy-attack' : attackKind === 'light' ? 'light-attack' : guarding ? 'guard' : runIntent || speed >= DEFAULT_THRESHOLDS.sprintSpeedMps ? 'sprint' : speed >= DEFAULT_THRESHOLDS.idleSpeedMps ? 'locomotion' : 'idle';
  return Object.freeze({ semanticState: state, expectedState: expected, group: resolveGroup(state), stateMatches: state === expected, speedMps: round(speed, 3) });
}

export function buildPlayerAnimationBlendContract({ primaryState = 'idle', primaryWeight = 1, secondaryState = null, secondaryWeight = 0, environmentalConfidence = 1, footPlantWeight = 0.7, combatReadiness = 1, locomotion = null } = {}) {
  const primary = normalizeState(primaryState); const secondary = secondaryState ? normalizeState(secondaryState) : null;
  const weights = normalizeWeights({ [primary]: primaryWeight, ...(secondary ? { [secondary]: secondaryWeight } : {}) });
  const confidence = clamp01(environmentalConfidence); const footPlant = clamp(footPlantWeight, 0.34, 1); const readiness = clamp01(combatReadiness);
  const locomotionWeights = locomotion && typeof locomotion === 'object' ? normalizeWeights({ walking: locomotion.walkWeight, running: locomotion.runWeight }) : normalizeWeights({ walking: primary === 'sprint' ? 0 : 1, running: primary === 'sprint' ? 1 : 0 });
  const dominantState = Object.entries(weights).sort((a, b) => b[1] - a[1])[0]?.[0] || 'idle';
  return Object.freeze({ primaryState: primary, secondaryState: secondary, normalizedWeights: weights, locomotionWeights, environmentalConfidence: round(confidence), footPlantWeight: round(footPlant), combatReadiness: round(readiness), interruptibility: round(primary === 'heavy-attack' ? 1 - DEFAULT_THRESHOLDS.attackInterruptSeconds : primary === 'guard' || primary === 'parry' ? 1 - DEFAULT_THRESHOLDS.defenseInterruptSeconds : 1), dominantState });
}

export function resolveAnimationTransitionWindow({ fromState = 'idle', toState = 'idle', normalizedTime = 0, canInterrupt = true, environmentConfidence = 1 } = {}) {
  const from = normalizeState(fromState); const to = normalizeState(toState); const time = clamp01(normalizedTime); const confidence = clamp01(environmentConfidence);
  const sameGroup = resolveGroup(from) === resolveGroup(to); const attackBoundary = from.includes('attack') && time < DEFAULT_THRESHOLDS.attackInterruptSeconds; const defenseBoundary = (from === 'guard' || from === 'parry') && time < DEFAULT_THRESHOLDS.defenseInterruptSeconds; const protectedWindow = attackBoundary || defenseBoundary;
  const permitted = Boolean(canInterrupt) && !protectedWindow; const crossfadeSeconds = sameGroup ? 0.14 : 0.22;
  return Object.freeze({ from, to, sameGroup, normalizedTime: round(time), protectedWindow, permitted, crossfadeSeconds: round(crossfadeSeconds * (1 + (1 - confidence) * 0.15), 4) });
}

export function auditAnimationBlendContract(contract) {
  const errors = []; const warnings = [];
  if (!contract || typeof contract !== 'object') return Object.freeze({ ok: false, errors: Object.freeze(['missing-contract']), warnings: Object.freeze([]) });
  const weights = contract.normalizedWeights || {}; const sum = Object.values(weights).reduce((total, value) => total + finite(value), 0);
  if (Math.abs(sum - 1) > 0.00001) errors.push('weights-do-not-sum-to-one');
  for (const [state, weight] of Object.entries(weights)) if (weight < 0 || weight > 1) errors.push(`weight-out-of-range:${state}`);
  if (contract.environmentalConfidence < 0 || contract.environmentalConfidence > 1) errors.push('confidence-out-of-range');
  if (contract.footPlantWeight < 0.34 || contract.footPlantWeight > 1) errors.push('footplant-out-of-range');
  if (contract.combatReadiness < 0 || contract.combatReadiness > 1) errors.push('readiness-out-of-range');
  if (contract.secondaryState && contract.secondaryState === contract.primaryState) warnings.push('duplicate-primary-secondary-state');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze([...new Set(errors)]), warnings: Object.freeze([...new Set(warnings)]) });
}

export function buildAnimationBlendDiagnostics(input = {}) {
  const classification = classifyAnimationBlendState(input); const contract = buildPlayerAnimationBlendContract(input);
  const transition = resolveAnimationTransitionWindow({ fromState: input.fromState || classification.semanticState, toState: input.toState || classification.expectedState, normalizedTime: input.normalizedTime, canInterrupt: input.canInterrupt, environmentConfidence: input.environmentalConfidence });
  return Object.freeze({ classification, contract, transition, audit: auditAnimationBlendContract(contract) });
}

export { DEFAULT_THRESHOLDS, STATE_GROUPS };
