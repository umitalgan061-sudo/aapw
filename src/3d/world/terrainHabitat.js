/**
 * Read-only terrain morphology and habitat interpretation.
 *
 * This module NEVER owns geography. It samples the canonical terrain height function supplied by the
 * caller and derives deterministic local morphology used by render-only geology and vegetation
 * placement. No map pixels, hydrology classification, collider state, shoreline or terrain heights are
 * changed here.
 *
 * The goal is to stop scattering assets from latitude/randomness alone. Outcrops should prefer real
 * slope breaks and exposed relief; talus should collect below steep faces; broadleaf vegetation should
 * prefer sheltered/depositional ground; cold/exposed sites should prefer conifers and lower canopy.
 * @module world/terrainHabitat
 */

export const TERRAIN_HABITAT_POLICY = Object.freeze({
  id: 'canonical-terrain-habitat-2026-09-02-v1-multiscale-morphology',
  readOnly: true,
  deterministic: true,
  canonicalHeightUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalColliderUnchanged: true,
  canonicalCoastlineUnchanged: true,
  newGeographyIntroduced: false,
  localProbeMeters: 9,
  mesoProbeMeters: 28,
  broadProbeMeters: 82,
  slopeProbeMeters: 9,
  reliefNormalizationMeters: 92,
  curvatureNormalizationMeters: 18,
  exposureSlopeStartDegrees: 17,
  exposureSlopeFullDegrees: 49,
  vegetationSlopeSoftLimitDegrees: 34,
  vegetationSlopeHardLimitDegrees: 46,
  talusPreferredSlopeDegrees: 31,
  talusSlopeHalfWidthDegrees: 17,
  exposedRockPreferredSlopeDegrees: 28,
  exposedRockSlopeHalfWidthDegrees: 27,
});

const DEG = 180 / Math.PI;
const TAU = Math.PI * 2;
const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const mix = (a, b, t) => a + (b - a) * t;
const smooth01 = (value) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const smoothRange = (edge0, edge1, value) => smooth01((value - edge0) / Math.max(1e-9, edge1 - edge0));
const triangularPreference = (value, center, halfWidth) => 1 - clamp01(Math.abs(value - center) / Math.max(1e-9, halfWidth));

function safeHeight(sampleHeightMeters, x, z, fallback) {
  const sampled = Number(sampleHeightMeters(x, z));
  return Number.isFinite(sampled) ? sampled : fallback;
}

function ringSamples(sampleHeightMeters, x, z, radius, centerY) {
  const diagonal = radius * Math.SQRT1_2;
  return Object.freeze([
    safeHeight(sampleHeightMeters, x + radius, z, centerY),
    safeHeight(sampleHeightMeters, x + diagonal, z + diagonal, centerY),
    safeHeight(sampleHeightMeters, x, z + radius, centerY),
    safeHeight(sampleHeightMeters, x - diagonal, z + diagonal, centerY),
    safeHeight(sampleHeightMeters, x - radius, z, centerY),
    safeHeight(sampleHeightMeters, x - diagonal, z - diagonal, centerY),
    safeHeight(sampleHeightMeters, x, z - radius, centerY),
    safeHeight(sampleHeightMeters, x + diagonal, z - diagonal, centerY),
  ]);
}

function ringStats(samples, centerY) {
  let sum = 0;
  let minimum = Infinity;
  let maximum = -Infinity;
  let absoluteDeparture = 0;
  for (const value of samples) {
    sum += value;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    absoluteDeparture += Math.abs(value - centerY);
  }
  const mean = sum / Math.max(1, samples.length);
  return Object.freeze({
    mean,
    minimum,
    maximum,
    relief: maximum - minimum,
    meanAbsoluteDeparture: absoluteDeparture / Math.max(1, samples.length),
    centerMinusMean: centerY - mean,
  });
}

/**
 * Samples the caller-provided canonical height function at three world-space scales. The returned
 * frame is immutable and safe to cache by a caller. Positive convexity/ridge values mean the centre
 * stands above its neighbourhood; positive concavity/valley values mean it sits below neighbours.
 */
export function sampleCanonicalTerrainHabitat(sampleHeightMeters, x, z, {
  seaLevelMeters = 0,
  localProbeMeters = TERRAIN_HABITAT_POLICY.localProbeMeters,
  mesoProbeMeters = TERRAIN_HABITAT_POLICY.mesoProbeMeters,
  broadProbeMeters = TERRAIN_HABITAT_POLICY.broadProbeMeters,
} = {}) {
  if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
  const localProbe = Math.max(1, finite(localProbeMeters, TERRAIN_HABITAT_POLICY.localProbeMeters));
  const mesoProbe = Math.max(localProbe * 1.5, finite(mesoProbeMeters, TERRAIN_HABITAT_POLICY.mesoProbeMeters));
  const broadProbe = Math.max(mesoProbe * 1.5, finite(broadProbeMeters, TERRAIN_HABITAT_POLICY.broadProbeMeters));
  const centerY = finite(sampleHeightMeters(x, z));

  const west = safeHeight(sampleHeightMeters, x - localProbe, z, centerY);
  const east = safeHeight(sampleHeightMeters, x + localProbe, z, centerY);
  const north = safeHeight(sampleHeightMeters, x, z - localProbe, centerY);
  const south = safeHeight(sampleHeightMeters, x, z + localProbe, centerY);
  const gradientX = (east - west) / (localProbe * 2);
  const gradientZ = (south - north) / (localProbe * 2);
  const normalLength = Math.max(1e-9, Math.hypot(-gradientX, 1, -gradientZ));
  const normalX = -gradientX / normalLength;
  const normalY = 1 / normalLength;
  const normalZ = -gradientZ / normalLength;
  const slopeRadians = Math.acos(Math.max(-1, Math.min(1, normalY)));
  const slopeDegrees = slopeRadians * DEG;
  const downhillAngleRadians = Math.atan2(gradientZ, gradientX) + Math.PI;

  const localRing = ringStats(ringSamples(sampleHeightMeters, x, z, localProbe, centerY), centerY);
  const mesoRing = ringStats(ringSamples(sampleHeightMeters, x, z, mesoProbe, centerY), centerY);
  const broadRing = ringStats(ringSamples(sampleHeightMeters, x, z, broadProbe, centerY), centerY);

  const convexityMeters = Math.max(0,
    localRing.centerMinusMean * 0.48
    + mesoRing.centerMinusMean * 0.34
    + broadRing.centerMinusMean * 0.18);
  const concavityMeters = Math.max(0,
    -localRing.centerMinusMean * 0.50
    - mesoRing.centerMinusMean * 0.34
    - broadRing.centerMinusMean * 0.16);
  const reliefMeters = Math.max(
    localRing.relief,
    mesoRing.relief * 0.72,
    broadRing.relief * 0.42,
  );
  const roughnessMeters = localRing.meanAbsoluteDeparture * 0.54
    + mesoRing.meanAbsoluteDeparture * 0.31
    + broadRing.meanAbsoluteDeparture * 0.15;

  const heightAboveSeaMeters = centerY - finite(seaLevelMeters);
  const ridge = clamp01(
    smoothRange(1.5, TERRAIN_HABITAT_POLICY.curvatureNormalizationMeters, convexityMeters) * 0.62
    + smoothRange(8, TERRAIN_HABITAT_POLICY.reliefNormalizationMeters, reliefMeters) * 0.38,
  );
  const valley = clamp01(
    smoothRange(1.25, TERRAIN_HABITAT_POLICY.curvatureNormalizationMeters, concavityMeters) * 0.66
    + smoothRange(6, TERRAIN_HABITAT_POLICY.reliefNormalizationMeters * 0.72, reliefMeters) * 0.34,
  );
  const exposure = clamp01(
    smoothRange(
      TERRAIN_HABITAT_POLICY.exposureSlopeStartDegrees,
      TERRAIN_HABITAT_POLICY.exposureSlopeFullDegrees,
      slopeDegrees,
    ) * 0.58
    + ridge * 0.42,
  );
  const shelter = clamp01(valley * 0.68 + (1 - exposure) * 0.32);
  const depositional = clamp01(
    valley * 0.58
    + triangularPreference(slopeDegrees, 8, 15) * 0.24
    + smoothRange(4, 45, roughnessMeters) * 0.18,
  );
  const drainage = clamp01(
    concavityMeters / Math.max(1, TERRAIN_HABITAT_POLICY.curvatureNormalizationMeters) * 0.50
    + smoothRange(4, 34, slopeDegrees) * 0.30
    + smoothRange(8, 75, reliefMeters) * 0.20,
  );
  const exposedBedrock = clamp01(
    triangularPreference(
      slopeDegrees,
      TERRAIN_HABITAT_POLICY.exposedRockPreferredSlopeDegrees,
      TERRAIN_HABITAT_POLICY.exposedRockSlopeHalfWidthDegrees,
    ) * 0.50
    + ridge * 0.28
    + smoothRange(14, 86, reliefMeters) * 0.22,
  );
  const talusCatchment = clamp01(
    triangularPreference(
      slopeDegrees,
      TERRAIN_HABITAT_POLICY.talusPreferredSlopeDegrees,
      TERRAIN_HABITAT_POLICY.talusSlopeHalfWidthDegrees,
    ) * 0.45
    + depositional * 0.28
    + smoothRange(18, 96, reliefMeters) * 0.27,
  );
  const boulderField = clamp01(
    triangularPreference(slopeDegrees, 15, 22) * 0.40
    + smoothRange(10, 62, roughnessMeters) * 0.36
    + (ridge * 0.10 + valley * 0.14),
  );

  return Object.freeze({
    policyId: TERRAIN_HABITAT_POLICY.id,
    x: finite(x),
    y: centerY,
    z: finite(z),
    normal: Object.freeze({ x: normalX, y: normalY, z: normalZ }),
    gradientX,
    gradientZ,
    slopeRadians,
    slopeDegrees,
    downhillAngleRadians,
    heightAboveSeaMeters,
    localReliefMeters: localRing.relief,
    mesoReliefMeters: mesoRing.relief,
    broadReliefMeters: broadRing.relief,
    reliefMeters,
    roughnessMeters,
    convexityMeters,
    concavityMeters,
    ridge,
    valley,
    exposure,
    shelter,
    depositional,
    drainage,
    exposedBedrock,
    talusCatchment,
    boulderField,
  });
}

/** Returns a 0..1 geology suitability for the requested fallback/asset placement family. */
export function geologySuitabilityForHabitat(frame, kind = 'bedrock') {
  if (!frame) return 0;
  if (kind === 'fractured-scarp') return clamp01(frame.exposedBedrock * 0.62 + frame.ridge * 0.38);
  if (kind === 'talus') return clamp01(frame.talusCatchment * 0.76 + frame.roughnessMeters / 95 * 0.24);
  if (kind === 'boulder') return clamp01(frame.boulderField * 0.78 + frame.depositional * 0.22);
  if (kind === 'low-outcrop') return clamp01(frame.exposedBedrock * 0.50 + frame.boulderField * 0.24 + frame.ridge * 0.26);
  if (kind === 'asset-proxy') return clamp01(frame.exposedBedrock * 0.64 + frame.reliefMeters / 125 * 0.24 + frame.ridge * 0.12);
  return clamp01(frame.exposedBedrock * 0.70 + frame.ridge * 0.30);
}

/**
 * Ecological suitability derived only from canonical topography plus caller-supplied cryosphere
 * weights. This is a placement weighting signal, not a biome/geography authority.
 */
export function vegetationSuitabilityForHabitat(frame, climate = {}) {
  if (!frame) return Object.freeze({ density: 0, pine: 0, broadleaf: 0, snowPine: 0, stature: 0.5 });
  const permanentIce = clamp01(finite(climate.permanentIce));
  const tundra = clamp01(finite(climate.tundra));
  const coldness = Math.max(permanentIce, tundra);
  const slopePenalty = 1 - smoothRange(
    TERRAIN_HABITAT_POLICY.vegetationSlopeSoftLimitDegrees,
    TERRAIN_HABITAT_POLICY.vegetationSlopeHardLimitDegrees,
    frame.slopeDegrees,
  );
  const dryExposurePenalty = 1 - frame.exposure * (0.30 + coldness * 0.22);
  const soilSupport = clamp01(0.34 + frame.depositional * 0.36 + frame.shelter * 0.22 + frame.valley * 0.08);
  const icePenalty = 1 - permanentIce * 0.76;
  const density = clamp01(slopePenalty * dryExposurePenalty * soilSupport * icePenalty);

  const pine = clamp01(
    0.38
    + coldness * 0.48
    + frame.exposure * 0.22
    + frame.ridge * 0.12
    - frame.valley * 0.08,
  );
  const broadleaf = clamp01(
    (1 - coldness) * (0.24 + frame.shelter * 0.46 + frame.depositional * 0.34)
    * (1 - frame.exposure * 0.58),
  );
  const snowPine = clamp01(
    permanentIce * 0.68
    + tundra * 0.44
    + frame.exposure * coldness * 0.18,
  );
  const stature = clamp01(
    0.58
    + frame.shelter * 0.34
    + frame.depositional * 0.16
    - frame.exposure * 0.28
    - coldness * 0.16,
  );
  return Object.freeze({ density, pine, broadleaf, snowPine, stature });
}

/**
 * A terrain-aware hint for model-family routing. The renderer remains the final routing authority;
 * this only describes the morphology so a hydrated rock family is not chosen from latitude alone.
 */
export function geologyAssetHabitatHint(frame, {
  northness = 0,
  southernDryness = 0,
  volcanic = false,
} = {}) {
  if (volcanic) return 'volcanic-rock';
  const north = clamp01(northness);
  const south = clamp01(southernDryness);
  const coldHighland = clamp01(
    smoothRange(250, 510, frame?.heightAboveSeaMeters ?? 0) * 0.58
    + north * 0.42,
  );
  const aridExposure = clamp01(
    south * 0.52
    + (frame?.exposure ?? 0) * 0.28
    + (frame?.ridge ?? 0) * 0.20,
  );
  const smallLooseRock = clamp01(
    (frame?.boulderField ?? 0) * 0.60
    + (frame?.depositional ?? 0) * 0.24
    + (1 - smoothRange(18, 34, frame?.slopeDegrees ?? 0)) * 0.16,
  );
  if (coldHighland > 0.70 && aridExposure < 0.72) return 'cold-highland';
  if (aridExposure > 0.69 && coldHighland < 0.60) return 'arid-rock';
  if (smallLooseRock > 0.70) return 'loose-boulder';
  return 'temperate-bedrock';
}

/** Axial angle distance: 0 and PI describe the same geological strike. */
export function axialAngleDifferenceRadians(a, b) {
  let difference = Math.abs((finite(a) - finite(b)) % Math.PI);
  if (difference > Math.PI * 0.5) difference = Math.PI - difference;
  return difference;
}

/** Blends two axial directions while preserving the shortest geological strike transition. */
export function blendAxialAngleRadians(a, b, t) {
  let delta = (finite(b) - finite(a)) % Math.PI;
  if (delta > Math.PI * 0.5) delta -= Math.PI;
  if (delta < -Math.PI * 0.5) delta += Math.PI;
  return finite(a) + delta * clamp01(t);
}

/** Converts a normalized habitat signal to a stable diagnostic class. */
export function terrainHabitatClass(frame) {
  if (!frame) return 'unknown';
  const pairs = [
    ['ridge-bedrock', frame.exposedBedrock * 0.66 + frame.ridge * 0.34],
    ['talus-catchment', frame.talusCatchment],
    ['depositional-valley', frame.depositional * 0.62 + frame.valley * 0.38],
    ['rough-boulder-field', frame.boulderField],
  ];
  pairs.sort((a, b) => b[1] - a[1]);
  return pairs[0][0];
}

/** Deterministic orientation aligned to downhill but softened by ridge strike. */
export function habitatPreferredOrientationRadians(frame, fallbackAngle = 0) {
  if (!frame) return finite(fallbackAngle);
  const contourAngle = frame.downhillAngleRadians + Math.PI * 0.5;
  const reliefWeight = clamp01(frame.ridge * 0.55 + frame.exposedBedrock * 0.45);
  const fallback = finite(fallbackAngle);
  let delta = (contourAngle - fallback) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return fallback + delta * reliefWeight * 0.48;
}

/** Bounded scalar interpolation useful to keep instance transforms physically plausible. */
export function habitatScaleMultiplier(frame, minimum = 0.82, maximum = 1.18) {
  const relief = clamp01((frame?.reliefMeters ?? 0) / TERRAIN_HABITAT_POLICY.reliefNormalizationMeters);
  const exposure = clamp01(frame?.exposure ?? 0);
  const signal = clamp01(relief * 0.68 + exposure * 0.32);
  return mix(finite(minimum, 0.82), finite(maximum, 1.18), signal);
}
