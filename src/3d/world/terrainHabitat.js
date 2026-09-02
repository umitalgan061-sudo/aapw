/**
 * Read-only terrain morphology and habitat interpretation.
 *
 * This module NEVER owns geography. It samples the canonical terrain height function supplied by the
 * caller and derives deterministic local morphology used by render-only geology and vegetation
 * placement. No map pixels, hydrology classification, collider state, shoreline or terrain heights are
 * changed here.
 * @module world/terrainHabitat
 */

export const TERRAIN_HABITAT_POLICY = Object.freeze({
  // Keep the compatibility id stable: several exact-head guards intentionally key on the v2 migration.
  // The revision field describes the richer read-only interpretation added afterwards.
  id: 'canonical-terrain-habitat-2026-09-02-v2-ridge-foot-deposition',
  morphologyRevision: 'v3-crest-gully-fan-soil-depth',
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
  directionalRelief: true,
  ridgeShoulderSignal: true,
  cliffFootSignal: true,
  depositionalBenchSignal: true,
  drainageConvergenceSignal: true,
  ridgeCrestSignal: true,
  gullyFloorSignal: true,
  fanApronSignal: true,
  rockfallSourceSignal: true,
  soilDepthSignal: true,
  moistureRetentionSignal: true,
});

const DEG = 180 / Math.PI;
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
  let highCount = 0;
  let lowCount = 0;
  for (const value of samples) {
    sum += value;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    absoluteDeparture += Math.abs(value - centerY);
    if (value > centerY) highCount += 1;
    if (value < centerY) lowCount += 1;
  }
  const mean = sum / Math.max(1, samples.length);
  return Object.freeze({
    mean,
    minimum,
    maximum,
    relief: maximum - minimum,
    meanAbsoluteDeparture: absoluteDeparture / Math.max(1, samples.length),
    centerMinusMean: centerY - mean,
    highFraction: highCount / Math.max(1, samples.length),
    lowFraction: lowCount / Math.max(1, samples.length),
  });
}

function directionalRelief(samples, centerY) {
  const east = samples[0] - centerY;
  const southEast = samples[1] - centerY;
  const south = samples[2] - centerY;
  const southWest = samples[3] - centerY;
  const west = samples[4] - centerY;
  const northWest = samples[5] - centerY;
  const north = samples[6] - centerY;
  const northEast = samples[7] - centerY;
  const x = (east + southEast * Math.SQRT1_2 + northEast * Math.SQRT1_2)
    - (west + southWest * Math.SQRT1_2 + northWest * Math.SQRT1_2);
  const z = (south + southEast * Math.SQRT1_2 + southWest * Math.SQRT1_2)
    - (north + northEast * Math.SQRT1_2 + northWest * Math.SQRT1_2);
  const magnitude = Math.hypot(x, z);
  return Object.freeze({ x, z, magnitude, angleRadians: Math.atan2(z, x) });
}

function oppositePairRelief(samples) {
  const pairs = [
    Math.abs(samples[0] - samples[4]),
    Math.abs(samples[1] - samples[5]),
    Math.abs(samples[2] - samples[6]),
    Math.abs(samples[3] - samples[7]),
  ];
  const maximum = Math.max(...pairs);
  const minimum = Math.min(...pairs);
  const mean = pairs.reduce((sum, value) => sum + value, 0) / pairs.length;
  return Object.freeze({ maximum, minimum, mean, anisotropy: maximum <= 1e-9 ? 0 : clamp01((maximum - minimum) / maximum) });
}

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

  const localSamples = ringSamples(sampleHeightMeters, x, z, localProbe, centerY);
  const mesoSamples = ringSamples(sampleHeightMeters, x, z, mesoProbe, centerY);
  const broadSamples = ringSamples(sampleHeightMeters, x, z, broadProbe, centerY);
  const localRing = ringStats(localSamples, centerY);
  const mesoRing = ringStats(mesoSamples, centerY);
  const broadRing = ringStats(broadSamples, centerY);
  const mesoDirection = directionalRelief(mesoSamples, centerY);
  const broadDirection = directionalRelief(broadSamples, centerY);
  const localPairs = oppositePairRelief(localSamples);
  const mesoPairs = oppositePairRelief(mesoSamples);

  const convexityMeters = Math.max(0,
    localRing.centerMinusMean * 0.48
    + mesoRing.centerMinusMean * 0.34
    + broadRing.centerMinusMean * 0.18);
  const concavityMeters = Math.max(0,
    -localRing.centerMinusMean * 0.50
    - mesoRing.centerMinusMean * 0.34
    - broadRing.centerMinusMean * 0.16);
  const reliefMeters = Math.max(localRing.relief, mesoRing.relief * 0.72, broadRing.relief * 0.42);
  const roughnessMeters = localRing.meanAbsoluteDeparture * 0.54
    + mesoRing.meanAbsoluteDeparture * 0.31
    + broadRing.meanAbsoluteDeparture * 0.15;

  const heightAboveSeaMeters = centerY - finite(seaLevelMeters);
  const ridge = clamp01(
    smoothRange(1.5, TERRAIN_HABITAT_POLICY.curvatureNormalizationMeters, convexityMeters) * 0.62
    + smoothRange(8, TERRAIN_HABITAT_POLICY.reliefNormalizationMeters, reliefMeters) * 0.38);
  const valley = clamp01(
    smoothRange(1.25, TERRAIN_HABITAT_POLICY.curvatureNormalizationMeters, concavityMeters) * 0.66
    + smoothRange(6, TERRAIN_HABITAT_POLICY.reliefNormalizationMeters * 0.72, reliefMeters) * 0.34);
  const exposure = clamp01(
    smoothRange(TERRAIN_HABITAT_POLICY.exposureSlopeStartDegrees, TERRAIN_HABITAT_POLICY.exposureSlopeFullDegrees, slopeDegrees) * 0.58
    + ridge * 0.42);
  const shelter = clamp01(valley * 0.68 + (1 - exposure) * 0.32);

  const directionalStrength = clamp01((mesoDirection.magnitude * 0.65 + broadDirection.magnitude * 0.35) / 180);
  const uphillFraction = clamp01((mesoRing.highFraction - 0.25) / 0.75);
  const downhillFraction = clamp01((mesoRing.lowFraction - 0.25) / 0.75);
  const crossSlopeAnisotropy = clamp01(localPairs.anisotropy * 0.38 + mesoPairs.anisotropy * 0.62);
  const ridgeShoulder = clamp01(
    ridge * 0.46
    + smoothRange(12, 76, mesoRing.relief) * 0.30
    + directionalStrength * 0.24);
  const ridgeCrest = clamp01(
    ridge * 0.54
    + smoothRange(2.5, 17, convexityMeters) * 0.22
    + crossSlopeAnisotropy * 0.14
    + (1 - smoothRange(32, 55, slopeDegrees)) * 0.10);
  const shoulderBreak = clamp01(
    ridgeShoulder * 0.44
    + triangularPreference(slopeDegrees, 24, 19) * 0.24
    + smoothRange(15, 82, mesoRing.relief) * 0.20
    + crossSlopeAnisotropy * 0.12);
  const cliffFoot = clamp01(
    uphillFraction * 0.34
    + triangularPreference(slopeDegrees, 24, 18) * 0.22
    + smoothRange(18, 94, mesoRing.relief) * 0.28
    + valley * 0.16);
  const gullyFloor = clamp01(
    valley * 0.42
    + smoothRange(2.5, 16, concavityMeters) * 0.24
    + directionalStrength * 0.16
    + uphillFraction * 0.18);
  const depositionalBench = clamp01(
    triangularPreference(slopeDegrees, 8, 13) * 0.30
    + valley * 0.30
    + cliffFoot * 0.24
    + (1 - directionalStrength) * 0.16);
  const fanApron = clamp01(
    cliffFoot * 0.30
    + depositionalBench * 0.28
    + triangularPreference(slopeDegrees, 11, 14) * 0.18
    + smoothRange(12, 72, broadRing.relief) * 0.12
    + (1 - crossSlopeAnisotropy) * 0.12);
  const drainageConvergence = clamp01(
    concavityMeters / Math.max(1, TERRAIN_HABITAT_POLICY.curvatureNormalizationMeters) * 0.40
    + uphillFraction * 0.18
    + smoothRange(4, 34, slopeDegrees) * 0.20
    + smoothRange(8, 75, reliefMeters) * 0.22);
  const depositional = clamp01(
    valley * 0.32
    + depositionalBench * 0.28
    + fanApron * 0.18
    + triangularPreference(slopeDegrees, 8, 15) * 0.12
    + smoothRange(4, 45, roughnessMeters) * 0.10);
  const drainage = clamp01(drainageConvergence * 0.62 + gullyFloor * 0.20 + cliffFoot * 0.10 + valley * 0.08);
  const exposedBedrock = clamp01(
    triangularPreference(slopeDegrees, TERRAIN_HABITAT_POLICY.exposedRockPreferredSlopeDegrees, TERRAIN_HABITAT_POLICY.exposedRockSlopeHalfWidthDegrees) * 0.34
    + ridgeShoulder * 0.25
    + ridgeCrest * 0.17
    + shoulderBreak * 0.10
    + smoothRange(14, 86, reliefMeters) * 0.14);
  const rockfallSource = clamp01(
    smoothRange(30, 58, slopeDegrees) * 0.34
    + exposedBedrock * 0.28
    + shoulderBreak * 0.20
    + smoothRange(24, 98, localRing.relief + mesoRing.relief * 0.45) * 0.18);
  const talusCatchment = clamp01(
    triangularPreference(slopeDegrees, TERRAIN_HABITAT_POLICY.talusPreferredSlopeDegrees, TERRAIN_HABITAT_POLICY.talusSlopeHalfWidthDegrees) * 0.24
    + cliffFoot * 0.27
    + fanApron * 0.18
    + rockfallSource * 0.16
    + depositional * 0.08
    + smoothRange(18, 96, reliefMeters) * 0.07);
  const boulderField = clamp01(
    triangularPreference(slopeDegrees, 15, 22) * 0.24
    + smoothRange(10, 62, roughnessMeters) * 0.22
    + cliffFoot * 0.16
    + fanApron * 0.16
    + depositional * 0.12
    + rockfallSource * 0.10);

  // Soil depth is intentionally a render/placement interpretation, not a simulated soil layer.
  // It rewards stable concave/depositional ground and suppresses exposed crest/scarp positions.
  const soilDepth = clamp01(
    0.16
    + depositional * 0.30
    + fanApron * 0.18
    + valley * 0.14
    + shelter * 0.12
    - exposedBedrock * 0.20
    - ridgeCrest * 0.12);
  const moistureRetention = clamp01(
    0.14
    + soilDepth * 0.28
    + shelter * 0.20
    + gullyFloor * 0.20
    + drainage * 0.10
    + valley * 0.08
    - exposure * 0.12);
  const windExposure = clamp01(
    exposure * 0.48
    + ridgeCrest * 0.24
    + shoulderBreak * 0.16
    + crossSlopeAnisotropy * 0.12);

  return Object.freeze({
    policyId: TERRAIN_HABITAT_POLICY.id,
    morphologyRevision: TERRAIN_HABITAT_POLICY.morphologyRevision,
    x: finite(x), y: centerY, z: finite(z),
    normal: Object.freeze({ x: normalX, y: normalY, z: normalZ }),
    gradientX, gradientZ, slopeRadians, slopeDegrees, downhillAngleRadians, heightAboveSeaMeters,
    localReliefMeters: localRing.relief,
    mesoReliefMeters: mesoRing.relief,
    broadReliefMeters: broadRing.relief,
    reliefMeters, roughnessMeters, convexityMeters, concavityMeters,
    ridge, valley, exposure, shelter, depositional, drainage, exposedBedrock, talusCatchment, boulderField,
    ridgeShoulder, ridgeCrest, shoulderBreak, cliffFoot, gullyFloor, depositionalBench, fanApron,
    drainageConvergence, rockfallSource, soilDepth, moistureRetention, windExposure, crossSlopeAnisotropy,
    directionalReliefStrength: directionalStrength,
    directionalReliefAngleRadians: mix(mesoDirection.angleRadians, broadDirection.angleRadians, 0.28),
    uphillNeighbourFraction: uphillFraction,
    downhillNeighbourFraction: downhillFraction,
  });
}

export function geologySuitabilityForHabitat(frame, kind = 'bedrock') {
  if (!frame) return 0;
  if (kind === 'fractured-scarp') {
    return clamp01(frame.exposedBedrock * 0.34 + frame.shoulderBreak * 0.25 + frame.rockfallSource * 0.21 + frame.ridgeCrest * 0.12 + frame.ridge * 0.08);
  }
  if (kind === 'talus') {
    return clamp01(frame.talusCatchment * 0.48 + frame.cliffFoot * 0.18 + frame.fanApron * 0.15 + frame.rockfallSource * 0.12 + frame.roughnessMeters / 120 * 0.07);
  }
  if (kind === 'boulder') {
    return clamp01(frame.boulderField * 0.46 + frame.fanApron * 0.20 + frame.cliffFoot * 0.14 + frame.depositional * 0.12 + frame.rockfallSource * 0.08);
  }
  if (kind === 'low-outcrop') {
    return clamp01(frame.exposedBedrock * 0.34 + frame.ridgeShoulder * 0.20 + frame.shoulderBreak * 0.14 + frame.boulderField * 0.12 + frame.ridge * 0.10 + frame.soilDepth * 0.10);
  }
  if (kind === 'asset-proxy') {
    return clamp01(frame.exposedBedrock * 0.34 + frame.ridgeShoulder * 0.18 + frame.shoulderBreak * 0.15 + frame.reliefMeters / 160 * 0.14 + frame.ridgeCrest * 0.10 + frame.rockfallSource * 0.09);
  }
  return clamp01(frame.exposedBedrock * 0.42 + frame.ridgeShoulder * 0.20 + frame.ridgeCrest * 0.14 + frame.shoulderBreak * 0.12 + frame.ridge * 0.12);
}

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
  const dryExposurePenalty = 1 - frame.windExposure * (0.32 + coldness * 0.24);
  const rockPenalty = 1 - clamp01(frame.exposedBedrock * 0.46 + frame.rockfallSource * 0.18 + frame.ridgeCrest * 0.12);
  const soilSupport = clamp01(
    0.18
    + frame.soilDepth * 0.34
    + frame.moistureRetention * 0.18
    + frame.depositional * 0.14
    + frame.fanApron * 0.08
    + frame.shelter * 0.08);
  const icePenalty = 1 - permanentIce * 0.78;
  const density = clamp01(slopePenalty * dryExposurePenalty * rockPenalty * soilSupport * icePenalty);
  const pine = clamp01(
    0.34 + coldness * 0.46 + frame.windExposure * 0.15 + frame.ridgeShoulder * 0.10
    + frame.soilDepth * 0.08 - frame.gullyFloor * 0.05);
  const broadleaf = clamp01(
    (1 - coldness)
    * (0.10 + frame.shelter * 0.24 + frame.soilDepth * 0.24 + frame.moistureRetention * 0.20 + frame.depositional * 0.12 + frame.fanApron * 0.10)
    * (1 - frame.windExposure * 0.66)
    * (1 - frame.exposedBedrock * 0.42));
  const snowPine = clamp01(
    permanentIce * 0.66 + tundra * 0.42 + frame.windExposure * coldness * 0.13 + frame.soilDepth * coldness * 0.08);
  const stature = clamp01(
    0.48 + frame.shelter * 0.20 + frame.soilDepth * 0.20 + frame.moistureRetention * 0.12
    + frame.depositionalBench * 0.10 - frame.windExposure * 0.24 - frame.exposedBedrock * 0.12 - coldness * 0.14);
  return Object.freeze({ density, pine, broadleaf, snowPine, stature });
}

export function geologyAssetHabitatHint(frame, { northness = 0, southernDryness = 0, volcanic = false } = {}) {
  if (volcanic) return 'volcanic-rock';
  const north = clamp01(northness);
  const south = clamp01(southernDryness);
  const coldHighland = clamp01(
    smoothRange(250, 510, frame?.heightAboveSeaMeters ?? 0) * 0.44
    + north * 0.30
    + (frame?.windExposure ?? frame?.exposure ?? 0) * 0.16
    + (frame?.ridgeCrest ?? 0) * 0.10);
  const aridExposure = clamp01(
    south * 0.40
    + (frame?.windExposure ?? frame?.exposure ?? 0) * 0.22
    + (frame?.ridgeShoulder ?? 0) * 0.14
    + (frame?.shoulderBreak ?? 0) * 0.10
    + (1 - (frame?.moistureRetention ?? frame?.depositional ?? 0)) * 0.14);
  const smallLooseRock = clamp01(
    (frame?.boulderField ?? 0) * 0.34
    + (frame?.fanApron ?? 0) * 0.23
    + (frame?.cliffFoot ?? 0) * 0.17
    + (frame?.rockfallSource ?? 0) * 0.14
    + (frame?.depositional ?? 0) * 0.12);
  if (coldHighland > 0.68 && aridExposure < 0.72) return 'cold-highland';
  if (aridExposure > 0.66 && coldHighland < 0.64) return 'arid-rock';
  if (smallLooseRock > 0.62) return 'loose-boulder';
  return 'temperate-bedrock';
}

export function axialAngleDifferenceRadians(a, b) {
  let difference = Math.abs((finite(a) - finite(b)) % Math.PI);
  if (difference > Math.PI * 0.5) difference = Math.PI - difference;
  return difference;
}

export function blendAxialAngleRadians(a, b, t) {
  let delta = (finite(b) - finite(a)) % Math.PI;
  if (delta > Math.PI * 0.5) delta -= Math.PI;
  if (delta < -Math.PI * 0.5) delta += Math.PI;
  return finite(a) + delta * clamp01(t);
}

export function terrainHabitatClass(frame) {
  if (!frame) return 'unknown';
  const pairs = [
    ['ridge-crest-bedrock', frame.ridgeCrest * 0.36 + frame.exposedBedrock * 0.30 + frame.ridgeShoulder * 0.20 + frame.shoulderBreak * 0.14],
    ['cliff-break-scarp', frame.shoulderBreak * 0.34 + frame.rockfallSource * 0.32 + frame.exposedBedrock * 0.20 + frame.ridgeShoulder * 0.14],
    ['cliff-foot-talus', frame.talusCatchment * 0.40 + frame.cliffFoot * 0.28 + frame.fanApron * 0.20 + frame.rockfallSource * 0.12],
    ['gully-floor', frame.gullyFloor * 0.46 + frame.drainage * 0.32 + frame.moistureRetention * 0.22],
    ['depositional-fan', frame.fanApron * 0.38 + frame.depositional * 0.32 + frame.depositionalBench * 0.18 + frame.soilDepth * 0.12],
    ['rough-boulder-field', frame.boulderField * 0.66 + frame.rockfallSource * 0.18 + frame.fanApron * 0.16],
  ];
  pairs.sort((a, b) => b[1] - a[1]);
  return pairs[0][0];
}

export function habitatPreferredOrientationRadians(frame, fallbackAngle = 0) {
  if (!frame) return finite(fallbackAngle);
  const contourAngle = frame.downhillAngleRadians + Math.PI * 0.5;
  const directionalAngle = finite(frame.directionalReliefAngleRadians, contourAngle) + Math.PI * 0.5;
  const reliefWeight = clamp01(
    frame.ridgeShoulder * 0.24 + frame.shoulderBreak * 0.20 + frame.exposedBedrock * 0.20
    + frame.directionalReliefStrength * 0.22 + frame.crossSlopeAnisotropy * 0.14);
  const directionalBlend = clamp01(frame.directionalReliefStrength * 0.34 + frame.crossSlopeAnisotropy * 0.18);
  const target = blendAxialAngleRadians(contourAngle, directionalAngle, directionalBlend);
  return blendAxialAngleRadians(finite(fallbackAngle), target, reliefWeight * 0.58);
}

export function habitatScaleMultiplier(frame, minimum = 0.82, maximum = 1.18) {
  const relief = clamp01((frame?.reliefMeters ?? 0) / TERRAIN_HABITAT_POLICY.reliefNormalizationMeters);
  const exposure = clamp01(frame?.windExposure ?? frame?.exposure ?? 0);
  const shoulder = clamp01(frame?.ridgeShoulder ?? 0);
  const crest = clamp01(frame?.ridgeCrest ?? 0);
  const source = clamp01(frame?.rockfallSource ?? 0);
  const signal = clamp01(relief * 0.32 + exposure * 0.16 + shoulder * 0.20 + crest * 0.16 + source * 0.16);
  return mix(finite(minimum, 0.82), finite(maximum, 1.18), signal);
}
