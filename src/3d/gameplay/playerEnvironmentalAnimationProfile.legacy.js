/**
 * Deterministic environment-aware presentation policy for the existing player animation family.
 *
 * The profile consumes canonical surface context supplied by the caller. It never samples terrain,
 * moves the player, resolves collisions, or owns geography. Its job is to make authored/fallback
 * animation presentation respond coherently to slope, moisture, snow, relief and carrying load.
 *
 * @module gameplay/playerEnvironmentalAnimationProfile
 */

export const PLAYER_ENVIRONMENTAL_ANIMATION_POLICY = Object.freeze({
  version: '2026-09-07-v2',
  playbackRate: Object.freeze({ min: 0.78, max: 1.28 }),
  footPlantWeight: Object.freeze({ min: 0.34, max: 1.0 }),
  leanMagnitude: Object.freeze({ min: 0, max: 0.16 }),
  confidence: Object.freeze({ min: 0, max: 1 }),
});

const SURFACE_PROFILES = Object.freeze({
  snow: Object.freeze({ traction: 0.58, strideFactor: 0.90, footPlant: 0.96, leanFactor: 1.10, combatReadiness: 0.82 }),
  coldGrassland: Object.freeze({ traction: 0.80, strideFactor: 0.98, footPlant: 0.82, leanFactor: 0.92, combatReadiness: 0.91 }),
  marsh: Object.freeze({ traction: 0.48, strideFactor: 0.86, footPlant: 1.00, leanFactor: 1.18, combatReadiness: 0.76 }),
  mountain: Object.freeze({ traction: 0.67, strideFactor: 0.90, footPlant: 0.95, leanFactor: 1.22, combatReadiness: 0.88 }),
  rockyHills: Object.freeze({ traction: 0.72, strideFactor: 0.93, footPlant: 0.92, leanFactor: 1.12, combatReadiness: 0.87 }),
  lush: Object.freeze({ traction: 0.78, strideFactor: 0.97, footPlant: 0.74, leanFactor: 0.88, combatReadiness: 0.93 }),
  desert: Object.freeze({ traction: 0.84, strideFactor: 0.95, footPlant: 0.68, leanFactor: 0.90, combatReadiness: 0.96 }),
  steppe: Object.freeze({ traction: 0.86, strideFactor: 0.99, footPlant: 0.69, leanFactor: 0.86, combatReadiness: 0.96 }),
  arid: Object.freeze({ traction: 0.83, strideFactor: 0.96, footPlant: 0.70, leanFactor: 0.90, combatReadiness: 0.95 }),
  jungle: Object.freeze({ traction: 0.61, strideFactor: 0.88, footPlant: 0.94, leanFactor: 1.14, combatReadiness: 0.80 }),
  coast: Object.freeze({ traction: 0.64, strideFactor: 0.90, footPlant: 0.93, leanFactor: 1.10, combatReadiness: 0.85 }),
  temperate: Object.freeze({ traction: 0.90, strideFactor: 1.00, footPlant: 0.62, leanFactor: 0.78, combatReadiness: 0.98 }),
  default: Object.freeze({ traction: 0.88, strideFactor: 0.99, footPlant: 0.66, leanFactor: 0.84, combatReadiness: 0.96 }),
});

const STATE_BIAS = Object.freeze({
  idle: Object.freeze({ speedWeight: 0.05, footWeight: 0.94, leanWeight: 0.05 }),
  locomotion: Object.freeze({ speedWeight: 0.34, footWeight: 1.00, leanWeight: 0.78 }),
  sprint: Object.freeze({ speedWeight: 0.74, footWeight: 0.78, leanWeight: 1.00 }),
  guard: Object.freeze({ speedWeight: 0.08, footWeight: 0.96, leanWeight: 0.34 }),
  parry: Object.freeze({ speedWeight: 0.02, footWeight: 1.00, leanWeight: 0.22 }),
  dodge: Object.freeze({ speedWeight: 0.58, footWeight: 0.64, leanWeight: 0.96 }),
  'light-attack': Object.freeze({ speedWeight: 0.12, footWeight: 0.82, leanWeight: 0.84 }),
  'heavy-attack': Object.freeze({ speedWeight: 0.08, footWeight: 0.88, leanWeight: 0.92 }),
  'hit-stagger': Object.freeze({ speedWeight: 0.04, footWeight: 0.92, leanWeight: 0.86 }),
});

const ACTION_FAMILY = Object.freeze({
  idle: 'idle',
  locomotion: 'locomotion',
  sprint: 'locomotion',
  guard: 'defense',
  parry: 'defense',
  dodge: 'evasion',
  'light-attack': 'attack',
  'heavy-attack': 'attack',
  'hit-stagger': 'reaction',
});

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
  return clamp(finite(value), 0, 1);
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  const rounded = Math.round(finite(value) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeProfileKey(value) {
  const key = String(value ?? 'default').trim().toLowerCase();
  if (SURFACE_PROFILES[key]) return key;
  const aliases = Object.freeze({
    cold: 'coldGrassland',
    ice: 'snow',
    wetland: 'marsh',
    rocky: 'rockyHills',
    grassland: 'temperate',
    lowland: 'temperate',
    fertile: 'lush',
  });
  return aliases[key] || 'default';
}

function normalizeSemanticState(value) {
  const state = String(value ?? 'idle').trim().toLowerCase();
  return STATE_BIAS[state] ? state : 'idle';
}

export function resolveSurfaceProfile(profileKey = 'default') {
  const key = normalizeProfileKey(profileKey);
  return Object.freeze({ key, ...SURFACE_PROFILES[key] });
}

export function normalizeEnvironment(context = {}) {
  return Object.freeze({
    profileKey: normalizeProfileKey(context.profileKey ?? context.biome ?? 'default'),
    slopeDegrees: clamp(finite(context.slopeDegrees), 0, 89),
    moisture: clamp01(context.moisture),
    snowCover: clamp01(context.snowCover),
    waterSignal: clamp01(context.waterSignal),
    reliefSignal: clamp01(context.reliefSignal),
    groundDeltaLeftMeters: clamp(finite(context.groundDeltaLeftMeters), -2, 2),
    groundDeltaRightMeters: clamp(finite(context.groundDeltaRightMeters), -2, 2),
    cameraHeadingMismatch: clamp01(context.cameraHeadingMismatch),
    carryWeight: clamp01(context.carryWeight),
    weaponWeight: clamp01(context.weaponWeight),
  });
}

function resolveStateBias(semanticState) {
  return STATE_BIAS[normalizeSemanticState(semanticState)];
}

export function resolveActionFamily(semanticState = 'idle') {
  return ACTION_FAMILY[normalizeSemanticState(semanticState)] || 'idle';
}

export function resolveEnvironmentalAnimationProfile(context = {}, semanticState = 'idle', {
  baseSpeedMps = 6.5,
} = {}) {
  const environment = normalizeEnvironment(context);
  const state = normalizeSemanticState(semanticState);
  const surface = resolveSurfaceProfile(environment.profileKey);
  const bias = resolveStateBias(state);
  const speed = Math.max(0, finite(context.planarSpeedMps));
  const baseSpeed = Math.max(0.01, finite(baseSpeedMps, 6.5));
  const speedRatio = clamp(speed / baseSpeed, 0, 1.6);
  const unevenness = clamp01(environment.slopeDegrees / 42);
  const softGround = clamp01(environment.moisture * 0.55 + environment.waterSignal * 0.45);
  const coldGrip = clamp01(environment.snowCover * 0.72 + (environment.profileKey === 'snow' ? 0.28 : 0));
  const loadPenalty = clamp01(environment.carryWeight * 0.60 + environment.weaponWeight * 0.40);
  const confidencePenalty = clamp01(unevenness * 0.38 + softGround * 0.25 + coldGrip * 0.18 + environment.cameraHeadingMismatch * 0.12);
  const targetRate = surface.strideFactor
    * (1 - loadPenalty * 0.07)
    * (1 + (speedRatio - 1) * bias.speedWeight * 0.18)
    * (1 - confidencePenalty * 0.08);
  const playbackRate = clamp(targetRate, PLAYER_ENVIRONMENTAL_ANIMATION_POLICY.playbackRate.min, PLAYER_ENVIRONMENTAL_ANIMATION_POLICY.playbackRate.max);
  const footPlantWeight = clamp(
    surface.footPlant * bias.footWeight + unevenness * 0.12 + softGround * 0.08 + coldGrip * 0.06,
    PLAYER_ENVIRONMENTAL_ANIMATION_POLICY.footPlantWeight.min,
    PLAYER_ENVIRONMENTAL_ANIMATION_POLICY.footPlantWeight.max,
  );
  const leanSign = environment.groundDeltaRightMeters - environment.groundDeltaLeftMeters;
  const leanDirection = leanSign === 0 ? 0 : leanSign > 0 ? 1 : -1;
  const signedTerrainLean = clamp(environment.slopeDegrees / 60, 0, 1) * leanDirection;
  const leanMagnitude = clamp(
    (surface.leanFactor * bias.leanWeight * Math.abs(signedTerrainLean) * 0.12) + loadPenalty * 0.018,
    PLAYER_ENVIRONMENTAL_ANIMATION_POLICY.leanMagnitude.min,
    PLAYER_ENVIRONMENTAL_ANIMATION_POLICY.leanMagnitude.max,
  );
  const stepConfidence = clamp01(1 - confidencePenalty);
  const combatReadiness = clamp01(surface.combatReadiness - (softGround * 0.08 + unevenness * 0.06) + (state === 'guard' || state.includes('attack') ? 0.02 : 0));
  return Object.freeze({
    version: PLAYER_ENVIRONMENTAL_ANIMATION_POLICY.version,
    semanticState: state,
    actionFamily: resolveActionFamily(state),
    surfaceProfile: environment.profileKey,
    playbackRate: round(playbackRate),
    footPlantWeight: round(footPlantWeight),
    leanMagnitude: round(leanMagnitude),
    leanDirection,
    stepConfidence: round(stepConfidence),
    combatReadiness: round(combatReadiness),
    traction: round(surface.traction),
    strideFactor: round(surface.strideFactor),
    slopeDegrees: round(environment.slopeDegrees),
    moisture: round(environment.moisture),
    snowCover: round(environment.snowCover),
    waterSignal: round(environment.waterSignal),
    loadPenalty: round(loadPenalty),
  });
}

export function resolveLocomotionBlendProfile({
  planarSpeedMps = 0,
  walkSpeedMps = 3.2,
  runSpeedMps = 6.5,
  footPlantWeight = 0.7,
  stepConfidence = 1,
} = {}) {
  const speed = Math.max(0, finite(planarSpeedMps));
  const walk = Math.max(0.01, finite(walkSpeedMps, 3.2));
  const run = Math.max(walk + 0.01, finite(runSpeedMps, 6.5));
  const gaitT = clamp01((speed - walk) / (run - walk));
  const sprintWeight = Math.max(0, gaitT);
  const walkWeight = 1 - sprintWeight;
  const footPlantBias = clamp(footPlantWeight, 0.34, 1);
  return Object.freeze({
    walkWeight: round(walkWeight),
    runWeight: round(sprintWeight),
    gaitT: round(gaitT),
    footPlantBias: round(footPlantBias),
    stepConfidence: round(clamp01(stepConfidence)),
  });
}

export function resolveGroundContactPresentation({
  leftFootGroundDeltaMeters = 0,
  rightFootGroundDeltaMeters = 0,
  pelvisGroundDeltaMeters = 0,
} = {}) {
  const left = clamp(finite(leftFootGroundDeltaMeters), -0.5, 0.5);
  const right = clamp(finite(rightFootGroundDeltaMeters), -0.5, 0.5);
  const pelvis = clamp(finite(pelvisGroundDeltaMeters), -0.5, 0.5);
  const asymmetry = clamp(right - left, -1, 1);
  const average = (left + right) / 2;
  const pelvisCorrection = clamp(pelvis - average, -0.35, 0.35);
  const contactConfidence = clamp01(1 - (Math.abs(left) + Math.abs(right)) * 1.25 - Math.abs(pelvisCorrection) * 0.85);
  return Object.freeze({
    leftFootCorrectionMeters: round(-left, 4),
    rightFootCorrectionMeters: round(-right, 4),
    pelvisCorrectionMeters: round(pelvisCorrection, 4),
    asymmetry: round(asymmetry, 4),
    contactConfidence: round(contactConfidence, 4),
  });
}

export function validateEnvironmentalAnimationContext(context = {}) {
  const errors = [];
  const normalized = normalizeEnvironment(context);
  if (!Number.isFinite(Number(context?.slopeDegrees ?? 0))) errors.push('non-finite-slope');
  if (!Number.isFinite(Number(context?.moisture ?? 0))) errors.push('non-finite-moisture');
  if (!Number.isFinite(Number(context?.snowCover ?? 0))) errors.push('non-finite-snow');
  if (!Number.isFinite(Number(context?.waterSignal ?? 0))) errors.push('non-finite-water');
  if (!Number.isFinite(Number(context?.reliefSignal ?? 0))) errors.push('non-finite-relief');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), normalized });
}

export function createEnvironmentalAnimationDirector({
  resolveContext,
  onUpdate = null,
} = {}) {
  if (typeof resolveContext !== 'function') throw new TypeError('resolveContext callback is required');
  let lastSignature = null;
  return Object.freeze({
    update(semanticState, frameContext = {}) {
      const context = resolveContext(frameContext);
      const profile = resolveEnvironmentalAnimationProfile(context, semanticState, frameContext);
      const signature = JSON.stringify(profile);
      if (signature !== lastSignature && typeof onUpdate === 'function') onUpdate(profile);
      lastSignature = signature;
      return profile;
    },
    reset() {
      lastSignature = null;
    },
  });
}

export { SURFACE_PROFILES, STATE_BIAS };
