/**
 * Deterministic directional locomotion presentation policy.
 *
 * This module observes caller-owned planar velocity, facing, surface and combat presentation
 * state. It never owns movement, physics, input, combat timing, animation assets, or scene state.
 *
 * @module gameplay/playerDirectionalLocomotionPolicy
 */

export const PLAYER_DIRECTIONAL_LOCOMOTION_VERSION = '2026-09-15-v1';

export const PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS = Object.freeze({
  maxSpeedMps: 12,
  maxSlopeDegrees: 55,
  maxTurnRateDegreesPerSecond: 540,
  minInputMagnitude: 0.0001,
  walkSpeedMps: 3.2,
  sprintSpeedMps: 6.5,
  sprintEnterSpeedMps: 5.6,
  sprintExitSpeedMps: 5.1,
  maxRateScale: 1.35,
  minRateScale: 0.72,
  maxSlopeCadenceScale: 1.22,
  minSlopeCadenceScale: 0.82,
  maxTurnCadenceScale: 1.18,
  minTurnCadenceScale: 0.88,
  phaseWrap: 1,
  maxDeltaSeconds: 0.1,
  maxCatchUpSteps: 5,
  maxBlendWeight: 1,
});

export const PLAYER_DIRECTIONAL_SEMANTICS = Object.freeze([
  'idle',
  'locomotion',
  'sprint',
  'light-attack',
  'heavy-attack',
  'guard',
  'dodge',
  'hit-stagger',
]);

export const PLAYER_DIRECTIONAL_DIRECTIONS = Object.freeze([
  'forward',
  'forward-right',
  'right',
  'back-right',
  'back',
  'back-left',
  'left',
  'forward-left',
]);

const SQRT_HALF = Math.SQRT1_2;
const DIRECTION_VECTORS = Object.freeze({
  forward: Object.freeze({ x: 0, y: 1 }),
  'forward-right': Object.freeze({ x: SQRT_HALF, y: SQRT_HALF }),
  right: Object.freeze({ x: 1, y: 0 }),
  'back-right': Object.freeze({ x: SQRT_HALF, y: -SQRT_HALF }),
  back: Object.freeze({ x: 0, y: -1 }),
  'back-left': Object.freeze({ x: -SQRT_HALF, y: -SQRT_HALF }),
  left: Object.freeze({ x: -1, y: 0 }),
  'forward-left': Object.freeze({ x: -SQRT_HALF, y: SQRT_HALF }),
});

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function positiveFinite(value, fallback = 0) {
  const numeric = finite(value, fallback);
  return numeric > 0 ? numeric : fallback;
}

function normalizeAngleRadians(value) {
  const tau = Math.PI * 2;
  const numeric = finite(value, 0);
  const normalized = ((numeric + Math.PI) % tau + tau) % tau - Math.PI;
  return normalized === -Math.PI ? Math.PI : normalized;
}

export function normalizePlayerDirectionalPhase(value = 0) {
  const phase = finite(value, 0);
  const wrapped = ((phase % 1) + 1) % 1;
  return round(wrapped);
}

export function normalizePlayerDirectionalVector(vector = {}) {
  const x = finite(vector?.x, 0);
  const y = finite(vector?.y, finite(vector?.z, 0));
  const magnitude = Math.hypot(x, y);
  if (magnitude <= PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.minInputMagnitude) {
    return Object.freeze({ x: 0, y: 0, magnitude: 0 });
  }
  return Object.freeze({
    x: round(x / magnitude),
    y: round(y / magnitude),
    magnitude: round(magnitude),
  });
}

export function normalizePlayerDirectionalInput(input = {}) {
  const velocity = normalizePlayerDirectionalVector(input.velocity ?? {
    x: input.velocityX,
    y: input.velocityY,
    z: input.velocityZ,
  });
  const facing = normalizePlayerDirectionalVector(input.facing ?? {
    x: input.facingX,
    y: input.facingY,
    z: input.facingZ ?? 1,
  });
  const planarSpeedMps = clamp(Math.max(0, finite(input.planarSpeedMps, velocity.magnitude)), 0, PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.maxSpeedMps);
  const slopeDegrees = clamp(Math.abs(finite(input.slopeDegrees, 0)), 0, PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.maxSlopeDegrees);
  const turnRateDegreesPerSecond = clamp(Math.abs(finite(input.turnRateDegreesPerSecond, 0)), 0, PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.maxTurnRateDegreesPerSecond);
  const previousPhase = normalizePlayerDirectionalPhase(input.previousPhase ?? input.phase ?? 0);
  const deltaSeconds = clamp(Math.max(0, finite(input.deltaSeconds, 1 / 60)), 0, 1);
  return Object.freeze({
    velocity,
    facing,
    planarSpeedMps: round(planarSpeedMps, 3),
    slopeDegrees: round(slopeDegrees, 3),
    turnRateDegreesPerSecond: round(turnRateDegreesPerSecond, 3),
    previousPhase,
    deltaSeconds: round(deltaSeconds, 5),
    runIntent: input.runIntent === true,
    guarding: input.guarding === true,
    attackKind: input.attackKind === 'light' || input.attackKind === 'heavy' ? input.attackKind : 'none',
    dodgeRemaining: Math.max(0, finite(input.dodgeRemaining, 0)),
    hitStaggerRemaining: Math.max(0, finite(input.hitStaggerRemaining, 0)),
    surfaceConfidence: clamp(finite(input.surfaceConfidence, 1), 0, 1),
    surfaceSlip: clamp(finite(input.surfaceSlip, 0), 0, 1),
  });
}

export function classifyPlayerDirectionalSemantic(input = {}) {
  const normalized = normalizePlayerDirectionalInput(input);
  if (normalized.hitStaggerRemaining > 0) return 'hit-stagger';
  if (normalized.dodgeRemaining > 0) return 'dodge';
  if (normalized.attackKind === 'heavy') return 'heavy-attack';
  if (normalized.attackKind === 'light') return 'light-attack';
  if (normalized.guarding) return 'guard';
  if (normalized.runIntent || normalized.planarSpeedMps >= PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.sprintEnterSpeedMps) return 'sprint';
  if (normalized.planarSpeedMps >= 0.15) return 'locomotion';
  return 'idle';
}

export function resolvePlayerDirectionalSemantic(input = {}, previousSemanticState = 'idle') {
  const normalized = normalizePlayerDirectionalInput(input);
  const current = classifyPlayerDirectionalSemantic(normalized);
  if (current === 'sprint' || current === 'locomotion') {
    if (previousSemanticState === 'sprint') {
      if (normalized.runIntent || normalized.planarSpeedMps >= PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.sprintExitSpeedMps) return 'sprint';
      return 'locomotion';
    }
    return normalized.runIntent || normalized.planarSpeedMps >= PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.sprintEnterSpeedMps ? 'sprint' : 'locomotion';
  }
  return current;
}

function vectorAngle(vector) {
  if (vector.magnitude <= PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.minInputMagnitude) return 0;
  return Math.atan2(vector.x, vector.y);
}

function angularDistance(a, b) {
  return normalizeAngleRadians(a - b);
}

export function resolvePlayerDirectionalAngle(input = {}) {
  const normalized = normalizePlayerDirectionalInput(input);
  const velocityAngle = vectorAngle(normalized.velocity);
  const facingAngle = vectorAngle(normalized.facing);
  return normalizeAngleRadians(velocityAngle - facingAngle);
}

export function resolvePlayerDirectionalSector(angleRadians = 0) {
  const eighthTurn = Math.PI / 4;
  const normalized = normalizeAngleRadians(angleRadians);
  const index = Math.round(normalized / eighthTurn);
  const normalizedIndex = ((index % 8) + 8) % 8;
  return PLAYER_DIRECTIONAL_DIRECTIONS[normalizedIndex];
}

function directionAngle(direction) {
  const vector = DIRECTION_VECTORS[direction] ?? DIRECTION_VECTORS.forward;
  return Math.atan2(vector.x, vector.y);
}

export function resolvePlayerDirectionalBlendWeights(input = {}) {
  const normalized = normalizePlayerDirectionalInput(input);
  const angle = resolvePlayerDirectionalAngle(normalized);
  const sectorWidth = Math.PI / 4;
  const normalizedTurns = ((angle + Math.PI) / sectorWidth + 8) % 8;
  const lowerIndex = Math.floor(normalizedTurns);
  const upperIndex = (lowerIndex + 1) % 8;
  const fraction = normalizedTurns - lowerIndex;
  const weights = Object.fromEntries(PLAYER_DIRECTIONAL_DIRECTIONS.map((direction) => [direction, 0]));
  const lower = PLAYER_DIRECTIONAL_DIRECTIONS[lowerIndex];
  const upper = PLAYER_DIRECTIONAL_DIRECTIONS[upperIndex];
  weights[lower] = round(1 - fraction);
  weights[upper] = round(fraction);
  return Object.freeze(weights);
}

export function resolvePlayerDirectionalDominantDirection(weights = {}) {
  let bestDirection = 'forward';
  let bestWeight = -1;
  for (const direction of PLAYER_DIRECTIONAL_DIRECTIONS) {
    const weight = finite(weights[direction], 0);
    if (weight > bestWeight) {
      bestDirection = direction;
      bestWeight = weight;
    }
  }
  return bestDirection;
}

export function validatePlayerDirectionalBlendWeights(weights = {}) {
  const values = PLAYER_DIRECTIONAL_DIRECTIONS.map((direction) => clamp(finite(weights[direction], 0), 0, 1));
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.abs(sum - 1) <= 0.0002 && values.every(Number.isFinite);
}

export function resolvePlayerDirectionalBlendMagnitude(input = {}) {
  const normalized = normalizePlayerDirectionalInput(input);
  return round(clamp(normalized.planarSpeedMps / PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.sprintSpeedMps, 0, 1), 4);
}

export function resolvePlayerDirectionalTurnClass(input = {}) {
  const normalized = normalizePlayerDirectionalInput(input);
  const rate = normalized.turnRateDegreesPerSecond;
  if (rate >= 300) return 'sharp';
  if (rate >= 120) return 'active';
  if (rate >= 30) return 'light';
  return 'neutral';
}

export function resolvePlayerDirectionalTurnScale(input = {}) {
  const normalized = normalizePlayerDirectionalInput(input);
  const turnClass = resolvePlayerDirectionalTurnClass(normalized);
  const map = Object.freeze({ neutral: 0.88, light: 0.97, active: 1.08, sharp: 1.18 });
  return map[turnClass];
}

export function resolvePlayerDirectionalSlopeClass(input = {}) {
  const slope = normalizePlayerDirectionalInput(input).slopeDegrees;
  if (slope >= 40) return 'extreme';
  if (slope >= 24) return 'steep';
  if (slope >= 10) return 'rising';
  return 'flat';
}

export function resolvePlayerDirectionalSlopeScale(input = {}) {
  const normalized = normalizePlayerDirectionalInput(input);
  const slopeRatio = normalized.slopeDegrees / PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.maxSlopeDegrees;
  const uphill = clamp(1 - slopeRatio * 0.18, 0.82, 1);
  return round(uphill);
}

export function resolvePlayerDirectionalSurfaceScale(input = {}) {
  const normalized = normalizePlayerDirectionalInput(input);
  const confidence = normalized.surfaceConfidence;
  const slipPenalty = normalized.surfaceSlip * 0.14;
  return round(clamp(0.85 + confidence * 0.15 - slipPenalty, 0.68, 1));
}

export function resolvePlayerDirectionalCadenceScale(input = {}) {
  const turnScale = resolvePlayerDirectionalTurnScale(input);
  const slopeScale = resolvePlayerDirectionalSlopeScale(input);
  const surfaceScale = resolvePlayerDirectionalSurfaceScale(input);
  const combined = turnScale * slopeScale * surfaceScale;
  return round(clamp(combined, PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.minSlopeCadenceScale, PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.maxSlopeCadenceScale));
}

export function resolvePlayerDirectionalPlaybackRate(input = {}) {
  const normalized = normalizePlayerDirectionalInput(input);
  const base = normalized.planarSpeedMps / PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.walkSpeedMps;
  const semantic = resolvePlayerDirectionalSemantic(normalized);
  const semanticScale = semantic === 'sprint' ? 0.92 : semantic === 'idle' ? 0.72 : 1;
  const cadence = resolvePlayerDirectionalCadenceScale(normalized);
  const confidenceScale = 0.8 + normalized.surfaceConfidence * 0.2;
  return round(clamp(base * semanticScale * cadence * confidenceScale, PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.minRateScale, PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.maxRateScale), 3);
}

export function resolvePlayerDirectionalPhaseStride(input = {}) {
  const normalized = normalizePlayerDirectionalInput(input);
  const rate = resolvePlayerDirectionalPlaybackRate(normalized);
  const cadence = resolvePlayerDirectionalCadenceScale(normalized);
  const distanceMeters = normalized.planarSpeedMps * normalized.deltaSeconds;
  return Object.freeze({
    phaseDelta: round(rate * cadence * normalized.deltaSeconds),
    distanceMeters: round(distanceMeters, 5),
    playbackRate: rate,
    cadenceScale: cadence,
  });
}

export function resolvePlayerDirectionalPhaseStep(input = {}) {
  const normalized = normalizePlayerDirectionalInput(input);
  const semantic = resolvePlayerDirectionalSemantic(normalized);
  if (semantic === 'idle' || semantic === 'guard') {
    return Object.freeze({ phase: normalized.previousPhase, wrapped: false, advanced: false });
  }
  const stride = resolvePlayerDirectionalPhaseStride(normalized);
  const nextPhase = normalized.previousPhase + stride.phaseDelta;
  return Object.freeze({
    phase: normalizePlayerDirectionalPhase(nextPhase),
    wrapped: nextPhase >= 1,
    advanced: stride.phaseDelta > 0,
  });
}

export function resolvePlayerDirectionalFootLead(phase = 0) {
  const normalized = normalizePlayerDirectionalPhase(phase);
  if (normalized < 0.25) return 'left';
  if (normalized < 0.5) return 'right';
  if (normalized < 0.75) return 'left';
  return 'right';
}

export function resolvePlayerDirectionalFootEvent(input = {}) {
  const previousPhase = normalizePlayerDirectionalPhase(input.previousPhase);
  const next = resolvePlayerDirectionalPhaseStep(input);
  if (!next.wrapped) return Object.freeze({ emitted: false, foot: null, phase: next.phase });
  return Object.freeze({
    emitted: true,
    foot: resolvePlayerDirectionalFootLead(previousPhase),
    phase: next.phase,
  });
}

export function resolvePlayerDirectionalTurnAmount(input = {}) {
  const normalized = normalizePlayerDirectionalInput(input);
  const maxTurn = PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.maxTurnRateDegreesPerSecond * normalized.deltaSeconds;
  return round(clamp(normalized.turnRateDegreesPerSecond * normalized.deltaSeconds, 0, maxTurn), 4);
}

export function resolvePlayerDirectionalFacingBlend(input = {}) {
  const normalized = normalizePlayerDirectionalInput(input);
  const amount = resolvePlayerDirectionalTurnAmount(normalized);
  const turnRatio = normalized.turnRateDegreesPerSecond / PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.maxTurnRateDegreesPerSecond;
  return Object.freeze({
    amountDegrees: amount,
    weight: round(clamp(turnRatio, 0, 1)),
    class: resolvePlayerDirectionalTurnClass(normalized),
  });
}

export function resolvePlayerDirectionalMomentum(input = {}) {
  const normalized = normalizePlayerDirectionalInput(input);
  const speedRatio = normalized.planarSpeedMps / PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.maxSpeedMps;
  const turnRatio = normalized.turnRateDegreesPerSecond / PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.maxTurnRateDegreesPerSecond;
  const slip = normalized.surfaceSlip;
  return Object.freeze({
    forward: round(clamp(speedRatio * (1 - turnRatio * 0.22), 0, 1)),
    lateral: round(clamp(turnRatio * 0.85, 0, 1)),
    braking: round(clamp((1 - speedRatio) * 0.2 + slip * 0.4, 0, 1)),
  });
}

export function resolvePlayerDirectionalPresentation(input = {}, previousSemanticState = 'idle') {
  const normalized = normalizePlayerDirectionalInput(input);
  const semanticState = resolvePlayerDirectionalSemantic(normalized, previousSemanticState);
  const blendWeights = resolvePlayerDirectionalBlendWeights(normalized);
  const phase = resolvePlayerDirectionalPhaseStep({ ...normalized, phase: normalized.previousPhase });
  const foot = resolvePlayerDirectionalFootEvent({ ...normalized, phase: normalized.previousPhase });
  const turn = resolvePlayerDirectionalFacingBlend(normalized);
  const momentum = resolvePlayerDirectionalMomentum(normalized);
  const dominantDirection = resolvePlayerDirectionalDominantDirection(blendWeights);
  return Object.freeze({
    version: PLAYER_DIRECTIONAL_LOCOMOTION_VERSION,
    semanticState,
    dominantDirection,
    directionAngleRadians: round(resolvePlayerDirectionalAngle(normalized), 5),
    blendMagnitude: resolvePlayerDirectionalBlendMagnitude(normalized),
    blendWeights,
    turn,
    slopeClass: resolvePlayerDirectionalSlopeClass(normalized),
    slopeScale: resolvePlayerDirectionalSlopeScale(normalized),
    surfaceScale: resolvePlayerDirectionalSurfaceScale(normalized),
    cadenceScale: resolvePlayerDirectionalCadenceScale(normalized),
    playbackRate: resolvePlayerDirectionalPlaybackRate(normalized),
    phase,
    foot,
    momentum,
    speedMps: normalized.planarSpeedMps,
  });
}

export function validatePlayerDirectionalPresentation(presentation = {}) {
  const blendOk = validatePlayerDirectionalBlendWeights(presentation.blendWeights);
  const phaseOk = Number.isFinite(presentation.phase?.phase) && presentation.phase.phase >= 0 && presentation.phase.phase < 1;
  const rateOk = Number.isFinite(presentation.playbackRate) && presentation.playbackRate >= PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.minRateScale && presentation.playbackRate <= PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.maxRateScale;
  const semanticOk = PLAYER_DIRECTIONAL_SEMANTICS.includes(presentation.semanticState);
  const directionOk = PLAYER_DIRECTIONAL_DIRECTIONS.includes(presentation.dominantDirection);
  return Object.freeze({ ok: blendOk && phaseOk && rateOk && semanticOk && directionOk, blendOk, phaseOk, rateOk, semanticOk, directionOk });
}

export function createPlayerDirectionalLocomotionState() {
  return Object.freeze({
    semanticState: 'idle',
    phase: 0,
    frameCount: 0,
    transitionCount: 0,
    footstepCount: 0,
    lastDirection: 'forward',
    lastPresentationFingerprint: '',
  });
}

function fingerprintPayload(value) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function resolvePlayerDirectionalFingerprint(value = {}) {
  return fingerprintPayload(value);
}

export function advancePlayerDirectionalLocomotionState(state = createPlayerDirectionalLocomotionState(), input = {}) {
  const prior = state && typeof state === 'object' ? state : createPlayerDirectionalLocomotionState();
  const normalized = normalizePlayerDirectionalInput(input);
  const presentation = resolvePlayerDirectionalPresentation(normalized, prior.semanticState);
  const transition = presentation.semanticState !== prior.semanticState;
  const footstep = presentation.foot.emitted;
  const snapshot = {
    semanticState: presentation.semanticState,
    phase: presentation.phase.phase,
    frameCount: prior.frameCount + 1,
    transitionCount: prior.transitionCount + (transition ? 1 : 0),
    footstepCount: prior.footstepCount + (footstep ? 1 : 0),
    lastDirection: presentation.dominantDirection,
  };
  const fingerprint = resolvePlayerDirectionalFingerprint({ snapshot, presentation });
  return Object.freeze({ ...snapshot, lastPresentationFingerprint: fingerprint });
}

export function validatePlayerDirectionalState(state = {}) {
  const frameCount = Number.isInteger(state.frameCount) && state.frameCount >= 0;
  const transitionCount = Number.isInteger(state.transitionCount) && state.transitionCount >= 0 && state.transitionCount <= state.frameCount;
  const footstepCount = Number.isInteger(state.footstepCount) && state.footstepCount >= 0;
  const phase = Number.isFinite(state.phase) && state.phase >= 0 && state.phase < 1;
  const semantic = PLAYER_DIRECTIONAL_SEMANTICS.includes(state.semanticState);
  const direction = PLAYER_DIRECTIONAL_DIRECTIONS.includes(state.lastDirection);
  return Object.freeze({ ok: frameCount && transitionCount && footstepCount && phase && semantic && direction, frameCount, transitionCount, footstepCount, phase, semantic, direction });
}

export function comparePlayerDirectionalRuns(first = [], second = []) {
  const left = Array.isArray(first) ? first : [];
  const right = Array.isArray(second) ? second : [];
  const length = Math.max(left.length, right.length);
  const differences = [];
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (JSON.stringify(a) !== JSON.stringify(b)) differences.push(index);
  }
  return Object.freeze({ equal: differences.length === 0, length, differences: Object.freeze(differences) });
}

export function createPlayerDirectionalScenario(samples = []) {
  const stateHistory = [];
  let state = createPlayerDirectionalLocomotionState();
  for (const sample of Array.isArray(samples) ? samples : []) {
    state = advancePlayerDirectionalLocomotionState(state, sample);
    stateHistory.push(state);
  }
  const finalState = stateHistory.at(-1) ?? state;
  return Object.freeze({
    count: stateHistory.length,
    states: Object.freeze(stateHistory),
    finalState,
    fingerprint: resolvePlayerDirectionalFingerprint(stateHistory),
    valid: validatePlayerDirectionalState(finalState).ok,
  });
}

export function resolvePlayerDirectionalCapabilities() {
  return Object.freeze([
    '8-way-directional-blending',
    'sprint-hysteresis',
    'turn-classification',
    'slope-aware-cadence',
    'surface-confidence-scaling',
    'foot-phase-continuity',
    'bounded-playback-rate',
    'immutable-read-model',
    'deterministic-fingerprint',
    'presentation-only-ownership',
  ]);
}

export function getPlayerDirectionalLocomotionLimits() {
  return Object.freeze({ ...PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS });
}

export function auditPlayerDirectionalLocomotionPolicy() {
  const weightProbe = resolvePlayerDirectionalBlendWeights({ velocity: { x: 0.7, y: 0.7 }, facing: { x: 0, y: 1 } });
  const state = createPlayerDirectionalLocomotionState();
  return Object.freeze({
    version: PLAYER_DIRECTIONAL_LOCOMOTION_VERSION,
    capabilities: resolvePlayerDirectionalCapabilities(),
    limits: getPlayerDirectionalLocomotionLimits(),
    blendContract: validatePlayerDirectionalBlendWeights(weightProbe),
    stateContract: validatePlayerDirectionalState(state).ok,
    directionCount: PLAYER_DIRECTIONAL_DIRECTIONS.length,
    semanticCount: PLAYER_DIRECTIONAL_SEMANTICS.length,
  });
}

export function createPlayerDirectionalLocomotionController({ onPresentation = null } = {}) {
  let state = createPlayerDirectionalLocomotionState();
  let previousPresentationFingerprint = '';
  return Object.freeze({
    update(input = {}) {
      const presentation = resolvePlayerDirectionalPresentation(input, state.semanticState);
      state = advancePlayerDirectionalLocomotionState(state, input);
      if (typeof onPresentation === 'function') {
        const nextFingerprint = resolvePlayerDirectionalFingerprint(presentation);
        if (nextFingerprint !== previousPresentationFingerprint) onPresentation(presentation);
        previousPresentationFingerprint = nextFingerprint;
      }
      return Object.freeze({ presentation, state });
    },
    read() {
      return Object.freeze({ ...state });
    },
    reset() {
      state = createPlayerDirectionalLocomotionState();
      previousPresentationFingerprint = '';
    },
  });
}

export function classifyPlayerDirectionalQuadrant(angleRadians = 0) {
  const degrees = Math.abs((normalizeAngleRadians(angleRadians) * 180) / Math.PI);
  if (degrees < 22.5) return 'forward';
  if (degrees < 67.5) return 'diagonal';
  if (degrees < 112.5) return 'lateral';
  if (degrees < 157.5) return 'rear-diagonal';
  return 'rear';
}

export function resolvePlayerDirectionalFootPlantWeight(input = {}) {
  const normalized = normalizePlayerDirectionalInput(input);
  const confidence = normalized.surfaceConfidence;
  const slopePenalty = normalized.slopeDegrees / PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.maxSlopeDegrees;
  const turnPenalty = normalized.turnRateDegreesPerSecond / PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.maxTurnRateDegreesPerSecond;
  return round(clamp(confidence * (1 - slopePenalty * 0.24 - turnPenalty * 0.18), 0, 1));
}

export function resolvePlayerDirectionalGroundedConfidence(input = {}) {
  const normalized = normalizePlayerDirectionalInput(input);
  const contact = resolvePlayerDirectionalFootPlantWeight(normalized);
  const speedPenalty = normalized.planarSpeedMps / PLAYER_DIRECTIONAL_LOCOMOTION_LIMITS.maxSpeedMps * 0.08;
  return round(clamp(contact - speedPenalty, 0, 1));
}

export function resolvePlayerDirectionalSurfacePresentation(input = {}) {
  return Object.freeze({
    slopeClass: resolvePlayerDirectionalSlopeClass(input),
    slopeScale: resolvePlayerDirectionalSlopeScale(input),
    confidence: normalizePlayerDirectionalInput(input).surfaceConfidence,
    slip: normalizePlayerDirectionalInput(input).surfaceSlip,
    footPlantWeight: resolvePlayerDirectionalFootPlantWeight(input),
    groundedConfidence: resolvePlayerDirectionalGroundedConfidence(input),
  });
}

export function resolvePlayerDirectionalCombatOverlay(input = {}) {
  const semantic = classifyPlayerDirectionalSemantic(input);
  const weights = Object.freeze({
    locomotion: semantic === 'idle' || semantic === 'locomotion' || semantic === 'sprint' ? 1 : 0,
    guard: semantic === 'guard' ? 1 : 0,
    dodge: semantic === 'dodge' ? 1 : 0,
    lightAttack: semantic === 'light-attack' ? 1 : 0,
    heavyAttack: semantic === 'heavy-attack' ? 1 : 0,
    hitStagger: semantic === 'hit-stagger' ? 1 : 0,
  });
  return weights;
}

export function resolvePlayerDirectionalFullPresentation(input = {}, previousSemanticState = 'idle') {
  const base = resolvePlayerDirectionalPresentation(input, previousSemanticState);
  return Object.freeze({
    ...base,
    surface: resolvePlayerDirectionalSurfacePresentation(input),
    combatOverlay: resolvePlayerDirectionalCombatOverlay(input),
    quadrant: classifyPlayerDirectionalQuadrant(base.directionAngleRadians),
    valid: validatePlayerDirectionalPresentation(base).ok,
  });
}
