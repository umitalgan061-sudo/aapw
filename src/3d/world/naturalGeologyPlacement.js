import { VALYRIA_GEOLOGY_POLICY, valyriaGeologyClassAtWorldXZ, valyriaInfluenceAtWorldXZ } from './valyriaGeology.js';

/**
 * Deterministic placement policy for natural bedrock, outcrops and talus.
 *
 * This module never changes canonical terrain height. It samples the shipped terrain authority and
 * emits render placement descriptors. Candidate locations are warped along regional strata instead
 * of reading as a jittered grid, while morphology roles are resolved from slope, curvature and local
 * relief so scarps, bedrock, talus and boulder fields occupy physically plausible terrain positions.
 *
 * @module world/naturalGeologyPlacement
 */
export const NATURAL_GEOLOGY_PLACEMENT_POLICY = Object.freeze({
  id: 'natural-geology-placement-2026-08-31-v2-morphology-strata',
  deterministic: true,
  renderOnly: true,
  geographyAuthorityUnchanged: true,
  heightAuthority: 'world/terrain.js',
  directAssetFamilies: Object.freeze([
    'assets/models/fbx/rocky_terrain_low_poly.glb',
    'assets/models/fbx/desert_rocks.glb',
  ]),
  referenceOnlyAssets: Object.freeze([
    'assets/models/fbx/rugged_mountain_landscape.glb',
    'assets/models/fbx/singlemountain.FBX',
    'assets/models/fbx/terrain_01.fbx',
    'assets/models/fbx/snow_terrain_low_poly.glb',
    'assets/models/fbx/sNOWlaNDSCAPE.glb',
  ]),
  knownLfsBytes: Object.freeze({
    'assets/models/fbx/rugged_mountain_landscape.glb': 50539536,
    'assets/models/fbx/rocky_terrain_low_poly.glb': 5708516,
    'assets/models/fbx/desert_rocks.glb': 12773288,
  }),
  minimumDryHeightMeters: 4.5,
  shorelineReserveMeters: 11,
  settlementReserveMeters: 145,
  roadReserveMeters: 22,
  normalProbeMeters: 9,
  morphologyOuterProbeMultiplier: 2.4,
  minRockSlopeDegrees: 4,
  preferredOutcropSlopeDegrees: 18,
  maxRockSlopeDegrees: 61,
  maxTiltDegrees: 22,
  desktopClusterCount: 86,
  mobileClusterCount: 34,
  desktopValyriaClusterCount: 12,
  mobileValyriaClusterCount: 6,
  desktopGridColumns: 82,
  desktopGridRows: 64,
  mobileGridColumns: 44,
  mobileGridRows: 34,
  desktopMaxPlacements: 620,
  mobileMaxPlacements: 190,
  assetProxyFraction: 0.105,
  valyriaAssetProxyFraction: 0.24,
  valyriaMinimumInfluence: 0.08,
  valyriaPolicyId: VALYRIA_GEOLOGY_POLICY.id,
  minimumNearestNeighborMeters: 22,
  maximumNearestNeighborJitterMeters: 18,
  minimumLargeOutcropSpacingMeters: 66,
  maximumLargeOutcropSpacingBoostMeters: 46,
  talusSlopeMinDegrees: 21,
  talusSlopeMaxDegrees: 48,
  candidateCellInsetFraction: 0.07,
  candidateStrataWarpFraction: 0.31,
  candidateCrossStrataWarpFraction: 0.24,
  ridgeExposureThreshold: 0.34,
  talusPotentialThreshold: 0.32,
  reliefScaleMeters: 14,
  curvatureScaleMeters: 2.6,
});

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;
const smoothstep01 = (value) => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const lerp = (a, b, t) => a + (b - a) * t;

function mix32(value) {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}
export function geologyHash01(seed, a = 0, b = 0, c = 0) {
  const s = mix32((seed >>> 0) ^ Math.imul((a + 1) | 0, 0x9e3779b1));
  const t = mix32(s ^ Math.imul((b + 17) | 0, 0x85ebca77));
  const u = mix32(t ^ Math.imul((c + 101) | 0, 0xc2b2ae3d));
  return u / 4294967296;
}
const hashSigned = (seed, a, b, c) => geologyHash01(seed, a, b, c) * 2 - 1;
function angleDifferenceRadians(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
function distancePointToSegmentSquared(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az, lengthSquared = abx * abx + abz * abz;
  if (lengthSquared <= 1e-9) return (px - ax) ** 2 + (pz - az) ** 2;
  const t = clamp01(((px - ax) * abx + (pz - az) * abz) / lengthSquared);
  return (px - (ax + abx * t)) ** 2 + (pz - (az + abz * t)) ** 2;
}
export function minimumDistanceToRoadMeters(x, z, roadEdges = []) {
  let bestSquared = Infinity;
  for (const edge of roadEdges ?? []) {
    const points = edge?.points;
    if (!Array.isArray(points) || points.length < 2) continue;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1], b = points[i];
      if (![a?.x, a?.z, b?.x, b?.z].every(Number.isFinite)) continue;
      bestSquared = Math.min(bestSquared, distancePointToSegmentSquared(x, z, a.x, a.z, b.x, b.z));
    }
  }
  return Math.sqrt(bestSquared);
}
export function minimumDistanceToSeatMeters(x, z, seats = []) {
  let best = Infinity;
  for (const seat of seats ?? []) {
    if (Number.isFinite(seat?.x) && Number.isFinite(seat?.z)) best = Math.min(best, Math.hypot(x - seat.x, z - seat.z));
  }
  return best;
}

export function sampleTerrainFrame(sampleHeightMeters, x, z, probeMeters = NATURAL_GEOLOGY_PLACEMENT_POLICY.normalProbeMeters) {
  if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
  const probe = Math.max(0.25, finite(probeMeters, 9));
  const outer = probe * NATURAL_GEOLOGY_PLACEMENT_POLICY.morphologyOuterProbeMultiplier;
  const y = finite(sampleHeightMeters(x, z));
  const left = finite(sampleHeightMeters(x - probe, z), y);
  const right = finite(sampleHeightMeters(x + probe, z), y);
  const down = finite(sampleHeightMeters(x, z - probe), y);
  const up = finite(sampleHeightMeters(x, z + probe), y);
  const outerLeft = finite(sampleHeightMeters(x - outer, z), left);
  const outerRight = finite(sampleHeightMeters(x + outer, z), right);
  const outerDown = finite(sampleHeightMeters(x, z - outer), down);
  const outerUp = finite(sampleHeightMeters(x, z + outer), up);
  const dx = (right - left) / (2 * probe), dz = (up - down) / (2 * probe);
  const inv = 1 / Math.max(1e-9, Math.hypot(-dx, 1, -dz));
  const nx = -dx * inv, ny = inv, nz = -dz * inv;
  const slopeRadians = Math.acos(Math.max(-1, Math.min(1, ny)));
  const innerMean = (left + right + down + up) * 0.25;
  const outerMean = (outerLeft + outerRight + outerDown + outerUp) * 0.25;
  const localMin = Math.min(outerLeft, outerRight, outerDown, outerUp, left, right, down, up, y);
  const localMax = Math.max(outerLeft, outerRight, outerDown, outerUp, left, right, down, up, y);
  const crossReliefX = Math.abs(outerRight - outerLeft);
  const crossReliefZ = Math.abs(outerUp - outerDown);
  return Object.freeze({
    x, y, z, nx, ny, nz,
    slopeRadians,
    slopeDegrees: slopeRadians * DEG,
    downhillAngleRadians: Math.atan2(dz, dx) + Math.PI,
    contourAngleRadians: Math.atan2(dz, dx) + Math.PI * 0.5,
    curvatureMeters: innerMean - y,
    broadCurvatureMeters: outerMean - y,
    localReliefMeters: localMax - localMin,
    directionalReliefMeters: Math.max(crossReliefX, crossReliefZ),
    reliefAxisRadians: crossReliefX >= crossReliefZ ? 0 : Math.PI * 0.5,
    gradientX: dx,
    gradientZ: dz,
  });
}

export function classifyNaturalGeologyMorphology(frame) {
  const P = NATURAL_GEOLOGY_PLACEMENT_POLICY;
  const slope = finite(frame?.slopeDegrees);
  const relief = smoothstep01(finite(frame?.localReliefMeters) / P.reliefScaleMeters);
  const directionalRelief = smoothstep01(finite(frame?.directionalReliefMeters) / (P.reliefScaleMeters * 1.25));
  const convexity = smoothstep01((-finite(frame?.broadCurvatureMeters) + 0.08) / P.curvatureScaleMeters);
  const concavity = smoothstep01((finite(frame?.broadCurvatureMeters) + 0.08) / P.curvatureScaleMeters);
  const steepness = smoothstep01((slope - 13) / 34);
  const severeSlope = smoothstep01((slope - 32) / 22);
  const talusSlope = smoothstep01((slope - P.talusSlopeMinDegrees) / 8)
    * (1 - smoothstep01((slope - P.talusSlopeMaxDegrees) / 8));
  const ridgeExposure = clamp01(relief * 0.44 + directionalRelief * 0.18 + convexity * 0.24 + severeSlope * 0.32);
  const talusPotential = clamp01(talusSlope * 0.62 + concavity * 0.19 + relief * 0.24 + steepness * 0.12);
  const bedrockExposure = clamp01(steepness * 0.42 + relief * 0.36 + convexity * 0.14 + directionalRelief * 0.16);
  const boulderPotential = clamp01((1 - severeSlope) * 0.32 + relief * 0.22 + (1 - convexity) * 0.12 + concavity * 0.14);
  let role = 'weathered-outcrop';
  if (ridgeExposure >= P.ridgeExposureThreshold && slope >= 27) role = 'ridge-scarp';
  else if (talusPotential >= P.talusPotentialThreshold && slope >= P.talusSlopeMinDegrees) role = 'talus-apron';
  else if (bedrockExposure >= 0.33 || slope >= P.preferredOutcropSlopeDegrees) role = 'bedrock-exposure';
  else if (boulderPotential >= 0.45 || slope < 11) role = 'boulder-field';
  return Object.freeze({ role, ridgeExposure, talusPotential, bedrockExposure, boulderPotential, relief, convexity, concavity });
}

function regionalStrataAngle(x, z, width, depth, seed) {
  const nx = x / Math.max(1, width) + 0.5, nz = z / Math.max(1, depth) + 0.5;
  return -0.32
    + Math.sin(TAU * (nx * 0.72 + nz * 0.21) + geologyHash01(seed, 9, 4, 1) * TAU) * 0.62
    + Math.sin(TAU * (nx * -0.18 + nz * 0.61) + geologyHash01(seed, 13, 8, 2) * TAU) * 0.27;
}
function createCluster(seed, index, width, depth, mobile) {
  const marginX = width * 0.045, marginZ = depth * 0.045;
  const x = -width * 0.5 + marginX + geologyHash01(seed, index, 1, 0) * (width - marginX * 2);
  const z = -depth * 0.5 + marginZ + geologyHash01(seed, index, 2, 0) * (depth - marginZ * 2);
  const orientation = regionalStrataAngle(x, z, width, depth, seed) + hashSigned(seed, index, 3, 0) * 0.36;
  const alongRadiusMeters = (mobile ? 150 : 210) + geologyHash01(seed, index, 4, 0) * (mobile ? 280 : 640);
  const acrossRadiusMeters = alongRadiusMeters * (0.18 + geologyHash01(seed, index, 5, 0) * 0.38);
  const selector = geologyHash01(seed, index, 6, 0);
  return Object.freeze({
    index, x, z, orientation, alongRadiusMeters, acrossRadiusMeters,
    kind: selector < 0.46 ? 'bedrock-band' : selector < 0.78 ? 'talus-apron' : 'boulder-field',
    strength: 0.62 + geologyHash01(seed, index, 7, 0) * 0.38,
  });
}
function createValyriaCluster(seed, index, width, depth, mobile) {
  const angle = geologyHash01(seed, index, 201, 0) * TAU;
  const radial = Math.sqrt(geologyHash01(seed, index, 202, 0)) * (mobile ? 420 : 700);
  const coreWorldX = (VALYRIA_GEOLOGY_POLICY.coreCenter.nx * 9000 - 4500) * (width / 9000);
  const coreWorldZ = (VALYRIA_GEOLOGY_POLICY.coreCenter.ny * 7000 - 3500) * (depth / 7000);
  const x = coreWorldX + Math.cos(angle) * radial;
  const z = coreWorldZ + Math.sin(angle) * radial * 0.82;
  const orientation = regionalStrataAngle(x, z, width, depth, seed) + hashSigned(seed, index, 203, 0) * 0.42;
  return Object.freeze({
    index: 1000 + index, x, z, orientation,
    alongRadiusMeters: (mobile ? 170 : 260) + geologyHash01(seed, index, 204, 0) * (mobile ? 220 : 480),
    acrossRadiusMeters: (mobile ? 80 : 110) + geologyHash01(seed, index, 205, 0) * (mobile ? 95 : 190),
    kind: geologyHash01(seed, index, 206, 0) < 0.63 ? 'bedrock-band' : 'talus-apron',
    strength: 0.82 + geologyHash01(seed, index, 207, 0) * 0.18,
  });
}
function clusterInfluence(cluster, x, z) {
  const dx = x - cluster.x, dz = z - cluster.z, c = Math.cos(cluster.orientation), s = Math.sin(cluster.orientation);
  const along = dx * c + dz * s, across = -dx * s + dz * c;
  const n = (along * along) / (cluster.alongRadiusMeters ** 2) + (across * across) / (cluster.acrossRadiusMeters ** 2);
  return n >= 1 ? 0 : (1 - smoothstep01(n)) * cluster.strength;
}
function chooseDominantCluster(clusters, x, z) {
  let best = null, influence = 0;
  for (const cluster of clusters) {
    const candidate = clusterInfluence(cluster, x, z);
    if (candidate > influence) { influence = candidate; best = cluster; }
  }
  return { cluster: best, influence };
}

function warpedCandidatePoint(seed, column, row, columns, rows, width, depth) {
  const P = NATURAL_GEOLOGY_PLACEMENT_POLICY;
  const cellWidth = width / columns, cellDepth = depth / rows;
  const centerX = -width * 0.5 + (column + 0.5) * cellWidth;
  const centerZ = -depth * 0.5 + (row + 0.5) * cellDepth;
  const strata = regionalStrataAngle(centerX, centerZ, width, depth, seed);
  const along = hashSigned(seed, column, row, 11) * cellWidth * P.candidateStrataWarpFraction;
  const across = hashSigned(seed, column, row, 12) * cellDepth * P.candidateCrossStrataWarpFraction;
  const broadAlong = Math.sin((column + geologyHash01(seed, 77, row, 1)) * 0.73 + row * 0.21) * cellWidth * 0.11;
  const broadAcross = Math.sin((row + geologyHash01(seed, column, 91, 2)) * 0.67 - column * 0.18) * cellDepth * 0.09;
  const c = Math.cos(strata), s = Math.sin(strata);
  const dx = (along + broadAlong) * c - (across + broadAcross) * s;
  const dz = (along + broadAlong) * s + (across + broadAcross) * c;
  const insetX = cellWidth * P.candidateCellInsetFraction;
  const insetZ = cellDepth * P.candidateCellInsetFraction;
  const cellMinX = -width * 0.5 + column * cellWidth + insetX;
  const cellMaxX = -width * 0.5 + (column + 1) * cellWidth - insetX;
  const cellMinZ = -depth * 0.5 + row * cellDepth + insetZ;
  const cellMaxZ = -depth * 0.5 + (row + 1) * cellDepth - insetZ;
  return Object.freeze({
    x: Math.max(cellMinX, Math.min(cellMaxX, centerX + dx)),
    z: Math.max(cellMinZ, Math.min(cellMaxZ, centerZ + dz)),
    strataAngleRadians: strata,
  });
}

function placementKind(clusterKind, frame, morphology, randomSelector, valyriaClass) {
  if (valyriaClass === 'fractured-volcanic-scarp') return randomSelector < 0.82 ? 'fractured-scarp' : 'bedrock';
  if (valyriaClass === 'doom-core' || valyriaClass === 'basalt-ridge') return randomSelector < 0.70 ? 'bedrock' : 'low-outcrop';
  if (morphology.role === 'ridge-scarp') return randomSelector < 0.72 ? 'fractured-scarp' : 'bedrock';
  if (morphology.role === 'talus-apron') return randomSelector < 0.83 ? 'talus' : 'boulder';
  if (morphology.role === 'bedrock-exposure') return randomSelector < 0.64 ? 'bedrock' : 'low-outcrop';
  if (morphology.role === 'boulder-field') return randomSelector < 0.74 ? 'boulder' : 'low-outcrop';
  if (clusterKind === 'talus-apron' && frame.slopeDegrees >= 18) return randomSelector < 0.62 ? 'talus' : 'low-outcrop';
  if (clusterKind === 'boulder-field' || frame.slopeDegrees < 12) return randomSelector < 0.72 ? 'boulder' : 'low-outcrop';
  return randomSelector < 0.56 ? 'bedrock' : 'low-outcrop';
}
function geometryScaleFor(kind, frame, morphology, a, b, c) {
  const reliefBoost = 0.72 + morphology.relief * 0.82;
  const slopeBoost = 0.80 + smoothstep01((frame.slopeDegrees - 7) / 38) * 0.52;
  if (kind === 'fractured-scarp') return {
    x: (9 + a * 25) * reliefBoost,
    y: (7 + b * 20) * slopeBoost,
    z: (3.4 + c * 8.6) * (0.82 + morphology.ridgeExposure * 0.36),
  };
  if (kind === 'bedrock') return {
    x: (7.5 + a * 19) * reliefBoost,
    y: (4.1 + b * 11) * slopeBoost,
    z: (4.6 + c * 12.5) * (0.86 + morphology.convexity * 0.24),
  };
  if (kind === 'low-outcrop') return {
    x: (6 + a * 15) * (0.86 + morphology.relief * 0.36),
    y: (2.4 + b * 6.4) * (0.88 + morphology.bedrockExposure * 0.35),
    z: 5.4 + c * 14,
  };
  if (kind === 'talus') return {
    x: (2 + a * 5.8) * (0.92 + morphology.talusPotential * 0.34),
    y: 1.1 + b * 3.4,
    z: (2.2 + c * 6.4) * (0.90 + morphology.talusPotential * 0.32),
  };
  return {
    x: 3.4 + a * 10.4,
    y: (2.1 + b * 7.2) * (0.90 + morphology.relief * 0.26),
    z: 3.0 + c * 9.4,
  };
}
function placementScore({ influence, frame, morphology, kind, heightAboveSeaMeters, seed, column, row, cluster }) {
  const slope = frame.slopeDegrees;
  const slopePreference = kind === 'talus'
    ? 1 - Math.min(1, Math.abs(slope - 32) / 22)
    : kind === 'boulder'
      ? 1 - Math.min(1, Math.abs(slope - 13) / 27)
      : smoothstep01((slope - 4) / 27) * (1 - smoothstep01((slope - 56) / 8));
  const morphologyAffinity = kind === 'fractured-scarp' ? morphology.ridgeExposure
    : kind === 'talus' ? morphology.talusPotential
      : kind === 'boulder' ? morphology.boulderPotential : morphology.bedrockExposure;
  const altitude = smoothstep01((heightAboveSeaMeters - 12) / 150);
  return influence
    * (0.43 + slopePreference * 0.24 + altitude * 0.13 + morphologyAffinity * 0.20)
    * (0.60 + geologyHash01(seed, column, row, cluster?.index ?? 0) * 0.40);
}
function spacingForPlacement(kind, morphology, seed, column, row) {
  const P = NATURAL_GEOLOGY_PLACEMENT_POLICY;
  const jitter = geologyHash01(seed, column, row, 119);
  const minimumSpacingMeters = P.minimumNearestNeighborMeters + jitter * P.maximumNearestNeighborJitterMeters;
  const large = ['fractured-scarp', 'bedrock', 'asset-proxy'].includes(kind);
  const largeSpacingMeters = large
    ? P.minimumLargeOutcropSpacingMeters + (morphology.relief * 0.62 + jitter * 0.38) * P.maximumLargeOutcropSpacingBoostMeters
    : 0;
  return Object.freeze({ minimumSpacingMeters, largeSpacingMeters });
}
function isTooClose(accepted, candidate) {
  const largeCandidate = ['fractured-scarp', 'bedrock', 'asset-proxy'].includes(candidate.kind);
  for (const existing of accepted) {
    const distance = Math.hypot(existing.x - candidate.x, existing.z - candidate.z);
    if (distance < Math.max(existing.minimumSpacingMeters, candidate.minimumSpacingMeters)) return true;
    const largeExisting = ['fractured-scarp', 'bedrock', 'asset-proxy'].includes(existing.kind);
    if (largeCandidate && largeExisting && distance < Math.max(existing.largeSpacingMeters, candidate.largeSpacingMeters)) return true;
  }
  return false;
}
function makePlacement({ seed, column, row, x, z, frame, cluster, influence, heightAboveSeaMeters, worldWidthMeters, worldDepthMeters, strataAngleRadians }) {
  const P = NATURAL_GEOLOGY_PLACEMENT_POLICY;
  const morphology = classifyNaturalGeologyMorphology(frame);
  const valyriaInfluence = valyriaInfluenceAtWorldXZ(x, z);
  const valyriaClass = valyriaGeologyClassAtWorldXZ(x, z, { heightAboveSeaMeters, slopeDegrees: frame.slopeDegrees });
  let kind = placementKind(cluster.kind, frame, morphology, geologyHash01(seed, column, row, 101), valyriaClass);
  const assetFraction = valyriaInfluence > P.valyriaMinimumInfluence ? P.valyriaAssetProxyFraction : P.assetProxyFraction;
  if (['bedrock', 'low-outcrop', 'fractured-scarp'].includes(kind)
    && influence > 0.42
    && geologyHash01(seed, column, row, 102) < assetFraction) kind = 'asset-proxy';
  const scaleKind = kind === 'asset-proxy' ? (morphology.role === 'ridge-scarp' ? 'fractured-scarp' : 'bedrock') : kind;
  const scale = geometryScaleFor(
    scaleKind,
    frame,
    morphology,
    geologyHash01(seed, column, row, 103),
    geologyHash01(seed, column, row, 104),
    geologyHash01(seed, column, row, 105),
  );
  const contourAngle = frame.contourAngleRadians;
  const downhill = frame.downhillAngleRadians;
  let orientationTarget = strataAngleRadians;
  if (kind === 'fractured-scarp' || morphology.role === 'ridge-scarp') orientationTarget = contourAngle;
  else if (kind === 'talus') orientationTarget = downhill;
  else if (kind === 'boulder') orientationTarget = lerp(strataAngleRadians, downhill, 0.28);
  const alignmentStrength = kind === 'fractured-scarp' ? 0.68 : kind === 'talus' ? 0.62 : 0.42;
  const yaw = strataAngleRadians
    + angleDifferenceRadians(orientationTarget, strataAngleRadians) * alignmentStrength
    + hashSigned(seed, column, row, 106) * (kind === 'boulder' ? 0.58 : 0.27);
  const terrainTilt = Math.min(P.maxTiltDegrees / DEG, frame.slopeRadians * (kind === 'talus' ? 0.68 : 0.48));
  const buryBase = kind === 'talus' ? 0.31 : kind === 'boulder' ? 0.24 : kind === 'fractured-scarp' ? 0.10 : 0.14;
  const buryFraction = Math.min(0.42, buryBase + morphology.concavity * 0.06 + geologyHash01(seed, column, row, 108) * 0.055);
  const southernDryness = clamp01((z / worldDepthMeters) + 0.5), northness = 1 - southernDryness;
  const spacing = spacingForPlacement(kind, morphology, seed, column, row);
  return Object.freeze({
    id: `${column}:${row}:${cluster.index}`,
    x,
    y: frame.y - scale.y * buryFraction,
    z,
    kind,
    formationRole: morphology.role,
    sourceClusterKind: cluster.kind,
    clusterIndex: cluster.index,
    clusterInfluence: influence,
    score: placementScore({ influence, frame, morphology, kind, heightAboveSeaMeters, cluster, seed, column, row }),
    scale: Object.freeze(scale),
    yawRadians: yaw,
    tiltRadians: terrainTilt,
    tiltAxisRadians: downhill + Math.PI * 0.5 + hashSigned(seed, column, row, 107) * 0.16,
    buryFraction,
    minimumSpacingMeters: spacing.minimumSpacingMeters,
    largeSpacingMeters: spacing.largeSpacingMeters,
    slopeDegrees: frame.slopeDegrees,
    normal: Object.freeze({ x: frame.nx, y: frame.ny, z: frame.nz }),
    curvatureMeters: frame.curvatureMeters,
    broadCurvatureMeters: frame.broadCurvatureMeters,
    localReliefMeters: frame.localReliefMeters,
    directionalReliefMeters: frame.directionalReliefMeters,
    ridgeExposure: morphology.ridgeExposure,
    talusPotential: morphology.talusPotential,
    bedrockExposure: morphology.bedrockExposure,
    boulderPotential: morphology.boulderPotential,
    heightAboveSeaMeters,
    northness,
    southernDryness,
    valyriaInfluence,
    valyriaClass,
    volcanic: valyriaInfluence > P.valyriaMinimumInfluence,
    assetFamily: kind === 'asset-proxy'
      ? (valyriaInfluence > P.valyriaMinimumInfluence ? 'rocky-terrain' : southernDryness > 0.67 ? 'desert-rocks' : 'rocky-terrain')
      : null,
  });
}

export function generateNaturalGeologyPlacements({ sampleHeightMeters, seaLevelMeters, seed = 1337, seats = [], roadEdges = [], worldWidthMeters, worldDepthMeters, isMobileClass = false, maxPlacements }) {
  if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
  const width = finite(worldWidthMeters), depth = finite(worldDepthMeters);
  if (!(width > 0) || !(depth > 0)) throw new RangeError('world dimensions must be positive');
  const sea = finite(seaLevelMeters), P = NATURAL_GEOLOGY_PLACEMENT_POLICY;
  const clusterCount = isMobileClass ? P.mobileClusterCount : P.desktopClusterCount;
  const valyriaClusterCount = isMobileClass ? P.mobileValyriaClusterCount : P.desktopValyriaClusterCount;
  const columns = isMobileClass ? P.mobileGridColumns : P.desktopGridColumns;
  const rows = isMobileClass ? P.mobileGridRows : P.desktopGridRows;
  const cap = Math.max(0, Math.floor(maxPlacements ?? (isMobileClass ? P.mobileMaxPlacements : P.desktopMaxPlacements)));
  const clusters = [
    ...Array.from({ length: clusterCount }, (_, i) => createCluster(seed, i, width, depth, isMobileClass)),
    ...Array.from({ length: valyriaClusterCount }, (_, i) => createValyriaCluster(seed ^ 0x51a7b33f, i, width, depth, isMobileClass)),
  ];
  const cellWidth = width / columns, cellDepth = depth / rows, candidates = [];
  let rejectedWater = 0, rejectedSettlement = 0, rejectedRoad = 0, rejectedSlope = 0, rejectedCluster = 0;
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const candidatePoint = warpedCandidatePoint(seed, column, row, columns, rows, width, depth);
    const { x, z } = candidatePoint;
    const frame = sampleTerrainFrame(sampleHeightMeters, x, z, P.normalProbeMeters);
    const heightAboveSeaMeters = frame.y - sea;
    if (heightAboveSeaMeters <= P.shorelineReserveMeters) { rejectedWater++; continue; }
    if (frame.slopeDegrees > P.maxRockSlopeDegrees) { rejectedSlope++; continue; }
    if (minimumDistanceToSeatMeters(x, z, seats) < P.settlementReserveMeters) { rejectedSettlement++; continue; }
    if (minimumDistanceToRoadMeters(x, z, roadEdges) < P.roadReserveMeters) { rejectedRoad++; continue; }
    const dominant = chooseDominantCluster(clusters, x, z);
    if (!dominant.cluster || dominant.influence < 0.12) { rejectedCluster++; continue; }
    const placement = makePlacement({
      seed, column, row, x, z, frame, cluster: dominant.cluster, influence: dominant.influence,
      heightAboveSeaMeters, worldWidthMeters: width, worldDepthMeters: depth,
      strataAngleRadians: candidatePoint.strataAngleRadians,
    });
    const valyrian = placement.valyriaInfluence > P.valyriaMinimumInfluence;
    const morphologyBoost = placement.formationRole === 'ridge-scarp' ? 0.03 : placement.formationRole === 'talus-apron' ? 0.02 : 0;
    const threshold = valyrian
      ? (placement.kind === 'boulder' || placement.kind === 'talus' ? 0.10 : 0.12)
      : (placement.kind === 'boulder' ? 0.18 : placement.kind === 'talus' ? 0.16 : 0.21 - morphologyBoost);
    if (placement.score < threshold) { rejectedCluster++; continue; }
    candidates.push(valyrian
      ? Object.freeze({ ...placement, score: placement.score * VALYRIA_GEOLOGY_POLICY.geologyDensityBoost })
      : placement);
  }
  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const accepted = [];
  for (const candidate of candidates) {
    if (accepted.length >= cap) break;
    if (isTooClose(accepted, candidate)) continue;
    accepted.push(candidate);
  }
  accepted.sort((a, b) => a.id.localeCompare(b.id));
  const kinds = {}, formationRoles = {}, assetFamilies = {};
  let valyriaPlacementCount = 0;
  for (const p of accepted) {
    kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
    formationRoles[p.formationRole] = (formationRoles[p.formationRole] ?? 0) + 1;
    if (p.assetFamily) assetFamilies[p.assetFamily] = (assetFamilies[p.assetFamily] ?? 0) + 1;
    if (p.volcanic) valyriaPlacementCount++;
  }
  return Object.freeze({
    policyId: P.id,
    placements: Object.freeze(accepted),
    clusters: Object.freeze(clusters),
    stats: Object.freeze({
      candidateCount: columns * rows,
      eligibleCandidateCount: candidates.length,
      placedCount: accepted.length,
      cap,
      clusterCount: clusters.length,
      genericClusterCount: clusterCount,
      valyriaClusterCount,
      gridColumns: columns,
      gridRows: rows,
      cellWidthMeters: cellWidth,
      cellDepthMeters: cellDepth,
      rejectedWater,
      rejectedSettlement,
      rejectedRoad,
      rejectedSlope,
      rejectedCluster,
      kinds: Object.freeze(kinds),
      formationRoles: Object.freeze(formationRoles),
      assetFamilies: Object.freeze(assetFamilies),
      valyriaPlacementCount,
    }),
  });
}

export function checksumNaturalGeologyPlacements(placements) {
  let hash = 2166136261 >>> 0;
  const mix = (value) => {
    for (const ch of String(value)) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  };
  for (const p of placements ?? []) {
    mix(p.id);
    mix(Math.round(p.x * 100));
    mix(Math.round(p.y * 100));
    mix(Math.round(p.z * 100));
    mix(p.kind);
    mix(p.formationRole ?? 'legacy');
    mix(Math.round(p.yawRadians * 10000));
    mix(Math.round(p.scale.x * 100));
    mix(Math.round(p.scale.y * 100));
    mix(Math.round(p.scale.z * 100));
  }
  return hash.toString(16).padStart(8, '0');
}
