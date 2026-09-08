/**
 * Render-only snow-surface breakup derived from canonical terrain exposure signals.
 *
 * This module exists to keep the visible snow response from reading like a broad binary overlay.
 * It consumes only the local slope/aspect/fold telemetry produced by terrainWindSnowExposure.js and
 * returns bounded multipliers for the existing windward/lee projection. It does not sample a second
 * height field, mutate transforms, classify geography, own hydrology, or create any material system.
 *
 * The fabric deliberately uses continuous normalized functions rather than a world-space grid. That
 * makes the breakup stable at chunk seams while still giving ridge shoulders, broken saddles, sheltered
 * pockets and near-cliff faces different snow-reading strengths.
 * @module world/terrainWindSnowSurfaceFabric
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const clampSigned = (value) => Math.max(-1, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function smootherstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / Math.max(1e-9, edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export const TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY = Object.freeze({
  id: 'terrain-wind-snow-surface-fabric-2026-09-08-v1-relief-continuity',
  renderOnly: true,
  heightAuthorityUnchanged: true,
  hydrologyAuthorityUnchanged: true,
  colliderAuthorityUnchanged: true,
  placementAuthorityUnchanged: true,
  deterministic: true,
  chunkSeamSafe: true,
  secondHeightAuthority: false,
  worldGridOverlay: false,
  periodicStriping: false,
  binaryMasking: false,
  minGain: 0.86,
  maxGain: 1.14,
  neutralBand: 0.18,
  crosswindSuppression: 0.42,
  foldedReliefGain: 0.20,
  brokenRidgeGain: 0.16,
  shelteredPocketGain: 0.18,
  cliffSheddingGain: 0.22,
  slopeTransitionGain: 0.12,
  curvatureScale: 0.20,
  ridgeCrustScale: 0.22,
  leePowderScale: 0.20,
  materialColdBiasScale: 0.11,
  materialWarmBiasScale: 0.08,
});

/**
 * Canonical relief-family descriptors used by the executable field matrix. These are stress inputs,
 * not geography and are never passed to terrain.js or used for world generation.
 */
export const SNOW_RELIEF_FAMILIES = Object.freeze([
  Object.freeze({ id: 'smooth-plain', slopeDegrees: 2.5, aspectDot: 0, foldGradient: 0 }),
  Object.freeze({ id: 'broad-ridge', slopeDegrees: 22, aspectDot: 0.72, foldGradient: 0.035 }),
  Object.freeze({ id: 'broken-ridge', slopeDegrees: 28, aspectDot: 0.78, foldGradient: 0.16 }),
  Object.freeze({ id: 'valley', slopeDegrees: 18, aspectDot: -0.76, foldGradient: 0.11 }),
  Object.freeze({ id: 'stepped-relief', slopeDegrees: 34, aspectDot: 0.30, foldGradient: 0.18 }),
  Object.freeze({ id: 'folded-basin', slopeDegrees: 20, aspectDot: -0.64, foldGradient: 0.23 }),
  Object.freeze({ id: 'near-cliff-windward', slopeDegrees: 62, aspectDot: 0.90, foldGradient: 0.12 }),
  Object.freeze({ id: 'near-cliff-lee', slopeDegrees: 62, aspectDot: -0.90, foldGradient: 0.12 }),
]);

function normalizedSlope(slopeDegrees) {
  return smoothstep(4, 58, Math.max(0, Number(slopeDegrees) || 0));
}

function steepnessBand(slopeDegrees) {
  return smoothstep(18, 46, Math.max(0, Number(slopeDegrees) || 0));
}

function cliffBand(slopeDegrees) {
  return smoothstep(46, 70, Math.max(0, Number(slopeDegrees) || 0));
}

function crosswindNeutrality(aspectDot) {
  return 1 - smoothstep(0.06, 0.36, Math.abs(clampSigned(aspectDot)));
}

function directionalStrength(aspectDot) {
  return smoothstep(0.18, 0.90, Math.abs(clampSigned(aspectDot)));
}

function foldedReliefStrength(foldGradient) {
  return smoothstep(0.025, 0.20, Math.max(0, Number(foldGradient) || 0));
}

function positiveAlignment(aspectDot) {
  return smoothstep(0.18, 0.90, Math.max(0, clampSigned(aspectDot)));
}

function negativeAlignment(aspectDot) {
  return smoothstep(0.18, 0.90, Math.max(0, -clampSigned(aspectDot)));
}

function shoulderBand(slopeDegrees) {
  const slope = Math.max(0, Number(slopeDegrees) || 0);
  return smootherstep(9, 32, slope) * (1 - smoothstep(32, 62, slope) * 0.52);
}

function ridgeShoulderSignal(slopeDegrees, aspectDot, foldGradient) {
  return clamp01(
    shoulderBand(slopeDegrees) * (
      positiveAlignment(aspectDot) * 0.58
      + foldedReliefStrength(foldGradient) * 0.42
    ),
  );
}

function shelteredPocketSignal(slopeDegrees, aspectDot, foldGradient) {
  const shelter = negativeAlignment(aspectDot);
  const bowl = foldedReliefStrength(foldGradient);
  const gentle = 1 - smoothstep(34, 56, Math.max(0, Number(slopeDegrees) || 0));
  return clamp01(shelter * (0.56 + bowl * 0.44) * (0.70 + gentle * 0.30));
}

function cliffSheddingSignal(slopeDegrees, aspectDot) {
  return clamp01(cliffBand(slopeDegrees) * (0.54 + negativeAlignment(aspectDot) * 0.46));
}

function slopeTransitionSignal(slopeDegrees) {
  const slope = Math.max(0, Number(slopeDegrees) || 0);
  return smoothstep(6, 14, slope) * (1 - smoothstep(24, 38, slope));
}

function brokenRidgeSignal(slopeDegrees, aspectDot, foldGradient) {
  const broken = foldedReliefStrength(foldGradient);
  const directional = positiveAlignment(aspectDot);
  const shoulder = shoulderBand(slopeDegrees);
  return clamp01(broken * (0.58 + directional * 0.42) * shoulder);
}

function valleyContinuitySignal(slopeDegrees, aspectDot, foldGradient) {
  const folded = foldedReliefStrength(foldGradient);
  const shelter = negativeAlignment(aspectDot);
  const moderate = 1 - smoothstep(38, 58, Math.max(0, Number(slopeDegrees) || 0));
  return clamp01(folded * shelter * (0.70 + moderate * 0.30));
}

function neutralCrosswindSignal(aspectDot, slopeDegrees) {
  return clamp01(crosswindNeutrality(aspectDot) * (0.72 + normalizedSlope(slopeDegrees) * 0.28));
}

/**
 * Return the bounded surface fabric used by the production wind/snow resolver.
 * All fields are normalized except the signed `materialTemperatureBias`.
 */
export function resolveTerrainWindSnowSurfaceFabric({
  slopeDegrees = 0,
  aspectDot = 0,
  foldGradient = 0,
  foldStrength = null,
  leeRetention = 1,
} = {}) {
  const P = TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY;
  const slope = Math.max(0, Number(slopeDegrees) || 0);
  const aspect = clampSigned(aspectDot);
  const fold = clamp01(
    Number.isFinite(foldStrength) ? foldStrength : foldedReliefStrength(foldGradient),
  );
  const directional = directionalStrength(aspect);
  const crosswind = neutralCrosswindSignal(aspect, slope);
  const windward = positiveAlignment(aspect);
  const lee = negativeAlignment(aspect);
  const ridge = ridgeShoulderSignal(slope, aspect, foldGradient);
  const brokenRidge = brokenRidgeSignal(slope, aspect, foldGradient);
  const shelter = shelteredPocketSignal(slope, aspect, foldGradient);
  const valley = valleyContinuitySignal(slope, aspect, foldGradient);
  const cliff = cliffSheddingSignal(slope, aspect);
  const transition = slopeTransitionSignal(slope);
  const leeHold = clamp01(leeRetention);
  const steep = steepnessBand(slope);

  const windwardGain = clamp01(
    0.93
      + directional * 0.045
      + fold * P.foldedReliefGain * 0.20
      + ridge * P.ridgeCrustScale * 0.20
      + brokenRidge * P.brokenRidgeGain * 0.20
      - crosswind * P.crosswindSuppression * 0.11
      - cliff * P.cliffSheddingGain * 0.20,
  );
  const leeGain = clamp01(
    0.93
      + lee * P.shelteredPocketGain * 0.18
      + shelter * P.shelteredPocketGain * 0.22
      + valley * P.leePowderScale * 0.16
      + leeHold * 0.025
      - crosswind * P.crosswindSuppression * 0.11
      - cliff * P.cliffSheddingGain * 0.40,
  );

  const normalizedCrust = clamp01(
    ridge * 0.56 + brokenRidge * 0.32 + windward * 0.12,
  );
  const normalizedPowder = clamp01(
    shelter * 0.54 + valley * 0.30 + lee * 0.16,
  );
  const retention = clamp01(
    0.78
      + shelter * 0.14
      + valley * 0.10
      - cliff * 0.34
      + leeHold * 0.08,
  );

  const materialTemperatureBias = clampSigned(
    normalizedPowder * P.materialWarmBiasScale
      - normalizedCrust * P.materialColdBiasScale
      - cliff * 0.035
      + transition * 0.008,
  );
  const materialBrightnessBias = clampSigned(
    normalizedPowder * 0.030
      - normalizedCrust * 0.040
      - cliff * 0.025
      + shelter * 0.018,
  );
  const continuity = clamp01(
    0.62
      + fold * P.curvatureScale * 0.35
      + ridge * 0.18
      + shelter * 0.20
      + valley * 0.15
      - crosswind * 0.24,
  );

  return Object.freeze({
    slope: normalizedSlope(slope),
    steepness: steep,
    cliff,
    directional,
    crosswindNeutrality: crosswind,
    foldStrength: fold,
    ridgeShoulder: ridge,
    brokenRidge,
    shelteredPocket: shelter,
    valleyContinuity: valley,
    slopeTransition: transition,
    windwardAlignment: windward,
    leeAlignment: lee,
    leeRetention: leeHold,
    windwardGain: lerp(P.minGain, P.maxGain, windwardGain),
    leeGain: lerp(P.minGain, P.maxGain, leeGain),
    retention,
    ridgeCrust: normalizedCrust,
    leePowder: normalizedPowder,
    continuity,
    materialTemperatureBias,
    materialBrightnessBias,
  });
}

/**
 * Convert the fabric to a compact acceptance digest. Stable key ordering makes this suitable for
 * byte-identical regression evidence without requiring a screenshot or a mutable object graph.
 */
export function terrainWindSnowSurfaceFabricDigest(fabric) {
  const safe = fabric && typeof fabric === 'object' ? fabric : {};
  const keys = [
    'slope',
    'steepness',
    'cliff',
    'directional',
    'crosswindNeutrality',
    'foldStrength',
    'ridgeShoulder',
    'brokenRidge',
    'shelteredPocket',
    'valleyContinuity',
    'slopeTransition',
    'windwardAlignment',
    'leeAlignment',
    'leeRetention',
    'windwardGain',
    'leeGain',
    'retention',
    'ridgeCrust',
    'leePowder',
    'continuity',
    'materialTemperatureBias',
    'materialBrightnessBias',
  ];
  return keys.map((key) => `${key}=${Number(safe[key] ?? 0).toFixed(8)}`).join('|');
}

/**
 * A deterministic family matrix for source-side acceptance. The six canonical stress families are
 * sampled at progressively rotated aspects so the same authored source cannot collapse into one
 * directional stripe merely because the prevailing wind is fixed.
 */
export function buildTerrainWindSnowSurfaceFamilyMatrix({
  directions = 24,
  aspectMagnitude = 0.82,
} = {}) {
  const count = Math.max(1, Math.floor(Number(directions) || 1));
  const magnitude = clamp01(aspectMagnitude);
  const rows = [];
  for (const family of SNOW_RELIEF_FAMILIES) {
    for (let index = 0; index < count; index += 1) {
      const theta = (index / count) * Math.PI * 2;
      const aspect = clampSigned(Math.cos(theta) * magnitude + family.aspectDot * 0.18);
      const folded = resolveTerrainWindSnowSurfaceFabric({
        slopeDegrees: family.slopeDegrees,
        aspectDot: aspect,
        foldGradient: family.foldGradient,
      });
      rows.push(Object.freeze({
        family: family.id,
        index,
        theta,
        aspectDot: aspect,
        foldGradient: family.foldGradient,
        digest: terrainWindSnowSurfaceFabricDigest(folded),
        fabric: folded,
      }));
    }
  }
  return Object.freeze(rows);
}

/**
 * Compute a continuous exposure scalar used to distinguish a clean planar face from a broken relief
 * face. Values near 0.5 are deliberately common, which prevents a full-world binary mask.
 */
export function resolveTerrainWindSnowContinuity({
  slopeDegrees = 0,
  aspectDot = 0,
  foldGradient = 0,
  leeRetention = 1,
} = {}) {
  const fabric = resolveTerrainWindSnowSurfaceFabric({ slopeDegrees, aspectDot, foldGradient, leeRetention });
  return clamp01(
    fabric.continuity
      * (0.78 + fabric.foldStrength * 0.12)
      * (0.88 + fabric.leeRetention * 0.12),
  );
}

/**
 * Convert the surface fabric to non-destructive tone hints for the existing snow-surface classifier.
 * The classifier remains responsible for selecting the packed/accumulated material families.
 */
export function resolveTerrainWindSnowToneHints(options = {}) {
  const fabric = resolveTerrainWindSnowSurfaceFabric(options);
  return Object.freeze({
    packedBias: clamp01(fabric.ridgeCrust * 0.62 + fabric.crosswindNeutrality * 0.08),
    accumulatedBias: clamp01(fabric.leePowder * 0.68 + fabric.shelteredPocket * 0.18),
    cooling: clamp01(fabric.ridgeCrust * 0.72 + Math.max(0, -fabric.materialTemperatureBias) * 0.28),
    warming: clamp01(fabric.leePowder * 0.72 + Math.max(0, fabric.materialTemperatureBias) * 0.28),
    brightness: fabric.materialBrightnessBias,
    continuity: fabric.continuity,
  });
}

/**
 * Stable invariant helper used by field-matrix checks. It intentionally accepts arbitrary numeric
 * inputs and proves the resolver remains finite and bounded instead of leaking NaN into the shader.
 */
export function sanitizeTerrainWindSnowSurfaceFabricInput({
  slopeDegrees,
  aspectDot,
  foldGradient,
  foldStrength,
  leeRetention,
} = {}) {
  return Object.freeze({
    slopeDegrees: Number.isFinite(slopeDegrees) ? Math.max(0, slopeDegrees) : 0,
    aspectDot: Number.isFinite(aspectDot) ? clampSigned(aspectDot) : 0,
    foldGradient: Number.isFinite(foldGradient) ? Math.max(0, foldGradient) : 0,
    foldStrength: Number.isFinite(foldStrength) ? clamp01(foldStrength) : null,
    leeRetention: Number.isFinite(leeRetention) ? clamp01(leeRetention) : 1,
  });
}

export function resolveTerrainWindSnowSurfaceFabricSafely(input = {}) {
  return resolveTerrainWindSnowSurfaceFabric(
    sanitizeTerrainWindSnowSurfaceFabricInput(input),
  );
}

/**
 * Produce a deterministic probe ladder over slope, fold and aspect. It is deliberately independent
 * from canonical map coordinates; the production runtime never calls this helper.
 */
export function buildTerrainWindSnowSurfaceProbeLadder({
  slopes = [0, 2, 6, 10, 16, 22, 30, 38, 46, 54, 62, 72],
  folds = [0, 0.01, 0.025, 0.05, 0.09, 0.14, 0.20, 0.28],
  aspects = [-1, -0.82, -0.58, -0.30, -0.06, 0, 0.06, 0.30, 0.58, 0.82, 1],
} = {}) {
  const rows = [];
  for (const slope of slopes) {
    for (const fold of folds) {
      for (const aspect of aspects) {
        const fabric = resolveTerrainWindSnowSurfaceFabric({
          slopeDegrees: slope,
          foldGradient: fold,
          aspectDot: aspect,
        });
        rows.push(Object.freeze({
          slopeDegrees: slope,
          foldGradient: fold,
          aspectDot: aspect,
          continuity: fabric.continuity,
          windwardGain: fabric.windwardGain,
          leeGain: fabric.leeGain,
          ridgeCrust: fabric.ridgeCrust,
          leePowder: fabric.leePowder,
          digest: terrainWindSnowSurfaceFabricDigest(fabric),
        }));
      }
    }
  }
  return Object.freeze(rows);
}

/**
 * Low-cost summary for browser/runtime telemetry. No arrays or mutable references are retained.
 */
export function summarizeTerrainWindSnowSurfaceFabric(fabric) {
  const safe = fabric && typeof fabric === 'object' ? fabric : {};
  const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
  return Object.freeze({
    continuity: clamp01(finite(safe.continuity)),
    ridgeCrust: clamp01(finite(safe.ridgeCrust)),
    leePowder: clamp01(finite(safe.leePowder)),
    crosswindNeutrality: clamp01(finite(safe.crosswindNeutrality)),
    windwardGain: finite(safe.windwardGain, 1),
    leeGain: finite(safe.leeGain, 1),
    materialTemperatureBias: clampSigned(finite(safe.materialTemperatureBias)),
    materialBrightnessBias: clampSigned(finite(safe.materialBrightnessBias)),
  });
}

// Explicit public aliases keep the acceptance layer readable while preserving one source of logic.
export const resolveWindwardSurfaceBreakup = resolveTerrainWindSnowSurfaceFabric;
export const resolveSnowSurfaceContinuity = resolveTerrainWindSnowContinuity;
export const createSnowSurfaceFieldMatrix = buildTerrainWindSnowSurfaceFamilyMatrix;
export const createSnowSurfaceProbeLadder = buildTerrainWindSnowSurfaceProbeLadder;
