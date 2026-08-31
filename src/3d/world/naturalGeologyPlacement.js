import {
  VALYRIA_GEOLOGY_POLICY,
  normalizedOwnerMapAtWorldXZ,
  valyriaGeologyClassAtWorldXZ,
  valyriaInfluence01,
  valyriaInfluenceAtWorldXZ,
  valyriaMorphologySignals,
} from './valyriaGeology.js';

/**
 * Deterministic placement policy for natural bedrock, outcrops and talus.
 *
 * This module owns no geometry and no height authority. It reads the canonical terrain sampler and
 * returns placement descriptors only. Generic geology follows regional strata, terrain slope breaks
 * and local erosion. Valyria is stricter: its outcrop clusters consume the SAME v4 fault, caldera,
 * lava-drainage and gully signals that already shape canonical terrain height. This prevents the
 * common procedural failure where terrain looks geological but its rocks are distributed by an
 * unrelated radial/random field.
 *
 * @module world/naturalGeologyPlacement
 */

export const NATURAL_GEOLOGY_PLACEMENT_POLICY = Object.freeze({
  id: 'natural-geology-placement-2026-08-31-v2-valyria-morphology-aligned',
  supersedes: 'natural-geology-placement-2026-08-27-v1-asset-informed-strata',
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
  minRockSlopeDegrees: 4,
  preferredOutcropSlopeDegrees: 18,
  maxRockSlopeDegrees: 61,
  maxTiltDegrees: 22,
  desktopClusterCount: 86,
  mobileClusterCount: 34,
  desktopValyriaClusterCount: 14,
  mobileValyriaClusterCount: 7,
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
  valyriaMorphologyAligned: true,
  valyriaClusterCandidateTrials: 7,
  valyriaFaultClusterShare: 0.38,
  valyriaShoulderClusterShare: 0.26,
  valyriaDrainageClusterShare: 0.22,
  valyriaMorphologyScoreBoost: 0.72,
  valyriaFaultAssetBoost: 0.11,
  valyriaDrainageDownhillBlend: 0.78,
  minimumNearestNeighborMeters: 22,
  minimumLargeOutcropSpacingMeters: 66,
  talusSlopeMinDegrees: 21,
  talusSlopeMaxDegrees: 48,
});

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;
const smoothstep01 = (value) => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const ZERO_MORPHOLOGY = Object.freeze({
  calderaBasin: 0,
  brokenCalderaShoulder: 0,
  faultEscarpment: 0,
  faultActivity: 0,
  lavaDrainage: 0,
  erosionGully: 0,
});

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
  let difference = (a - b) % TAU;
  if (difference > Math.PI) difference -= TAU;
  if (difference < -Math.PI) difference += TAU;
  return difference;
}

function distancePointToSegmentSquared(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const lengthSquared = abx * abx + abz * abz;
  if (lengthSquared <= 1e-9) return (px - ax) ** 2 + (pz - az) ** 2;
  const t = clamp01(((px - ax) * abx + (pz - az) * abz) / lengthSquared);
  return (px - (ax + abx * t)) ** 2 + (pz - (az + abz * t)) ** 2;
}

export function minimumDistanceToRoadMeters(x, z, roadEdges = []) {
  let bestSquared = Infinity;
  for (const edge of roadEdges ?? []) {
    const points = edge?.points;
    if (!Array.isArray(points) || points.length < 2) continue;
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      if (![a?.x, a?.z, b?.x, b?.z].every(Number.isFinite)) continue;
      bestSquared = Math.min(bestSquared, distancePointToSegmentSquared(x, z, a.x, a.z, b.x, b.z));
    }
  }
  return Math.sqrt(bestSquared);
}

export function minimumDistanceToSeatMeters(x, z, seats = []) {
  let best = Infinity;
  for (const seat of seats ?? []) {
    if (Number.isFinite(seat?.x) && Number.isFinite(seat?.z)) {
      best = Math.min(best, Math.hypot(x - seat.x, z - seat.z));
    }
  }
  return best;
}

export function sampleTerrainFrame(
  sampleHeightMeters,
  x,
  z,
  probeMeters = NATURAL_GEOLOGY_PLACEMENT_POLICY.normalProbeMeters,
) {
  if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
  const probe = Math.max(0.25, finite(probeMeters, 9));
  const y = finite(sampleHeightMeters(x, z));
  const left = finite(sampleHeightMeters(x - probe, z), y);
  const right = finite(sampleHeightMeters(x + probe, z), y);
  const down = finite(sampleHeightMeters(x, z - probe), y);
  const up = finite(sampleHeightMeters(x, z + probe), y);
  const dx = (right - left) / (2 * probe);
  const dz = (up - down) / (2 * probe);
  const inv = 1 / Math.max(1e-9, Math.hypot(-dx, 1, -dz));
  const nx = -dx * inv;
  const ny = inv;
  const nz = -dz * inv;
  const slopeRadians = Math.acos(Math.max(-1, Math.min(1, ny)));
  return Object.freeze({
    x,
    y,
    z,
    nx,
    ny,
    nz,
    slopeRadians,
    slopeDegrees: slopeRadians * DEG,
    downhillAngleRadians: Math.atan2(dz, dx) + Math.PI,
    curvatureMeters: ((left + right + down + up) * 0.25) - y,
    localReliefMeters: Math.max(left, right, down, up, y) - Math.min(left, right, down, up, y),
    gradientX: dx,
    gradientZ: dz,
  });
}

function regionalStrataAngle(x, z, width, depth, seed) {
  const nx = x / Math.max(1, width) + 0.5;
  const nz = z / Math.max(1, depth) + 0.5;
  return -0.32
    + Math.sin(TAU * (nx * 0.72 + nz * 0.21) + geologyHash01(seed, 9, 4, 1) * TAU) * 0.62
    + Math.sin(TAU * (nx * -0.18 + nz * 0.61) + geologyHash01(seed, 13, 8, 2) * TAU) * 0.27;
}

function valyriaFaultWorldAngle(width, depth) {
  const P = VALYRIA_GEOLOGY_POLICY;
  const dx = Math.cos(P.faultStrikeRadians) * P.coreRadius.nx * width;
  const dz = Math.sin(P.faultStrikeRadians) * P.coreRadius.ny * depth;
  return Math.atan2(dz, dx);
}

function createCluster(seed, index, width, depth, mobile) {
  const marginX = width * 0.045;
  const marginZ = depth * 0.045;
  const x = -width * 0.5 + marginX + geologyHash01(seed, index, 1, 0) * (width - marginX * 2);
  const z = -depth * 0.5 + marginZ + geologyHash01(seed, index, 2, 0) * (depth - marginZ * 2);
  const orientation = regionalStrataAngle(x, z, width, depth, seed) + hashSigned(seed, index, 3, 0) * 0.36;
  const alongRadiusMeters = (mobile ? 150 : 210)
    + geologyHash01(seed, index, 4, 0) * (mobile ? 280 : 640);
  const acrossRadiusMeters = alongRadiusMeters * (0.18 + geologyHash01(seed, index, 5, 0) * 0.38);
  const selector = geologyHash01(seed, index, 6, 0);
  return Object.freeze({
    index,
    x,
    z,
    orientation,
    alongRadiusMeters,
    acrossRadiusMeters,
    kind: selector < 0.46 ? 'bedrock-band' : selector < 0.78 ? 'talus-apron' : 'boulder-field',
    strength: 0.62 + geologyHash01(seed, index, 7, 0) * 0.38,
    morphologyMode: 'regional-strata',
  });
}

function valyriaClusterMode(selector) {
  const P = NATURAL_GEOLOGY_PLACEMENT_POLICY;
  if (selector < P.valyriaFaultClusterShare) return 'fault';
  if (selector < P.valyriaFaultClusterShare + P.valyriaShoulderClusterShare) return 'shoulder';
  if (selector < P.valyriaFaultClusterShare + P.valyriaShoulderClusterShare + P.valyriaDrainageClusterShare) {
    return 'lava-drainage';
  }
  return 'erosion-gully';
}

function morphologySignalForMode(mode, morphology) {
  if (mode === 'fault') return morphology.faultActivity;
  if (mode === 'shoulder') return morphology.brokenCalderaShoulder;
  if (mode === 'lava-drainage') return morphology.lavaDrainage;
  return morphology.erosionGully;
}

function valyriaCandidate(seed, index, trial, mode) {
  const P = VALYRIA_GEOLOGY_POLICY;
  const c = Math.cos(P.faultStrikeRadians);
  const s = Math.sin(P.faultStrikeRadians);
  let nx;
  let ny;

  if (mode === 'fault') {
    const along = hashSigned(seed, index, 210 + trial, 0) * 1.02;
    const across = hashSigned(seed, index, 230 + trial, 0) * 0.24;
    const dx = along * c - across * s;
    const dy = along * s + across * c;
    nx = P.coreCenter.nx + dx * P.coreRadius.nx;
    ny = P.coreCenter.ny + dy * P.coreRadius.ny;
  } else if (mode === 'shoulder') {
    const angle = geologyHash01(seed, index, 250 + trial, 0) * TAU;
    const radial = 0.54 + geologyHash01(seed, index, 270 + trial, 0) * 0.54;
    nx = P.coreCenter.nx + Math.cos(angle) * P.coreRadius.nx * radial;
    ny = P.coreCenter.ny + Math.sin(angle) * P.coreRadius.ny * radial;
  } else {
    const angle = geologyHash01(seed, index, 290 + trial, 0) * TAU;
    const radial = Math.sqrt(geologyHash01(seed, index, 310 + trial, 0)) * 1.06;
    nx = P.coreCenter.nx + Math.cos(angle) * P.coreRadius.nx * radial;
    ny = P.coreCenter.ny + Math.sin(angle) * P.coreRadius.ny * radial;
  }

  const influence = valyriaInfluence01(nx, ny);
  const morphology = valyriaMorphologySignals(nx, ny);
  return { nx, ny, influence, morphology, signal: morphologySignalForMode(mode, morphology) };
}

function createValyriaCluster(seed, index, width, depth, mobile) {
  const P = NATURAL_GEOLOGY_PLACEMENT_POLICY;
  const mode = valyriaClusterMode(geologyHash01(seed, index, 201, 0));
  let best = null;
  for (let trial = 0; trial < P.valyriaClusterCandidateTrials; trial += 1) {
    const candidate = valyriaCandidate(seed, index, trial, mode);
    const score = candidate.signal * 0.72 + candidate.influence * 0.28;
    if (!best || score > best.score) best = { ...candidate, score };
  }

  const x = (best.nx - 0.5) * width;
  const z = (best.ny - 0.5) * depth;
  const faultAngle = valyriaFaultWorldAngle(width, depth);
  const radialAngle = Math.atan2(
    (best.ny - VALYRIA_GEOLOGY_POLICY.coreCenter.ny) * depth,
    (best.nx - VALYRIA_GEOLOGY_POLICY.coreCenter.nx) * width,
  );
  const orientation = mode === 'fault'
    ? faultAngle + hashSigned(seed, index, 331, 0) * 0.14
    : mode === 'shoulder'
      ? radialAngle + Math.PI * 0.5 + hashSigned(seed, index, 332, 0) * 0.22
      : faultAngle + hashSigned(seed, index, 333, 0) * 0.46;
  const longBase = mobile ? 180 : 280;
  const longSpread = mobile ? 250 : 520;
  const alongRadiusMeters = longBase + geologyHash01(seed, index, 204, 0) * longSpread;
  const acrossFactor = mode === 'fault' ? 0.22 : mode === 'shoulder' ? 0.34 : 0.42;
  const kind = mode === 'fault' || mode === 'shoulder'
    ? 'bedrock-band'
    : mode === 'lava-drainage' ? 'talus-apron' : 'boulder-field';

  return Object.freeze({
    index: 1000 + index,
    x,
    z,
    orientation,
    alongRadiusMeters,
    acrossRadiusMeters: alongRadiusMeters * (acrossFactor + geologyHash01(seed, index, 205, 0) * 0.14),
    kind,
    strength: 0.82 + geologyHash01(seed, index, 207, 0) * 0.18,
    morphologyMode: mode,
    morphologySignal: best.signal,
  });
}

function clusterInfluence(cluster, x, z) {
  const dx = x - cluster.x;
  const dz = z - cluster.z;
  const c = Math.cos(cluster.orientation);
  const s = Math.sin(cluster.orientation);
  const along = dx * c + dz * s;
  const across = -dx * s + dz * c;
  const normalized = (along * along) / (cluster.alongRadiusMeters ** 2)
    + (across * across) / (cluster.acrossRadiusMeters ** 2);
  return normalized >= 1 ? 0 : (1 - smoothstep01(normalized)) * cluster.strength;
}

function chooseDominantCluster(clusters, x, z) {
  let best = null;
  let influence = 0;
  for (const cluster of clusters) {
    const candidate = clusterInfluence(cluster, x, z);
    if (candidate > influence) {
      influence = candidate;
      best = cluster;
    }
  }
  return { cluster: best, influence };
}

function dominantMorphology(morphology) {
  const entries = [
    ['fault', morphology.faultActivity],
    ['shoulder', morphology.brokenCalderaShoulder],
    ['lava-drainage', morphology.lavaDrainage],
    ['erosion-gully', morphology.erosionGully],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return Object.freeze({ kind: entries[0][0], strength: entries[0][1] });
}

function placementKind(clusterKind, frame, randomSelector, valyriaClass, morphology) {
  if (morphology.faultActivity > 0.48) return randomSelector < 0.82 ? 'fractured-scarp' : 'bedrock';
  if (morphology.brokenCalderaShoulder > 0.48) return randomSelector < 0.76 ? 'bedrock' : 'low-outcrop';
  if (morphology.lavaDrainage > 0.52) return frame.slopeDegrees > 20 ? 'talus' : 'low-outcrop';
  if (morphology.erosionGully > 0.52) return frame.slopeDegrees > 18 ? 'talus' : 'boulder';
  if (valyriaClass === 'fractured-volcanic-scarp') return randomSelector < 0.78 ? 'fractured-scarp' : 'bedrock';
  if (valyriaClass === 'doom-core' || valyriaClass === 'basalt-ridge') return randomSelector < 0.68 ? 'bedrock' : 'low-outcrop';
  const slope = frame.slopeDegrees;
  if (clusterKind === 'talus-apron' && slope >= 21) return 'talus';
  if (clusterKind === 'boulder-field' || slope < 12) return randomSelector < 0.72 ? 'boulder' : 'low-outcrop';
  if (slope > 39) return randomSelector < 0.62 ? 'fractured-scarp' : 'bedrock';
  return randomSelector < 0.58 ? 'bedrock' : 'low-outcrop';
}

function geometryScaleFor(kind, frame, a, b, c) {
  const slopeFactor = smoothstep01((frame.slopeDegrees - 8) / 42);
  if (kind === 'fractured-scarp') return { x: 12 + a * 24, y: 10 + b * 24 + slopeFactor * 8, z: 5 + c * 10 };
  if (kind === 'bedrock') return { x: 9 + a * 19, y: 5 + b * 12 + slopeFactor * 5, z: 5 + c * 12 };
  if (kind === 'low-outcrop') return { x: 7 + a * 16, y: 2.8 + b * 7, z: 6 + c * 14 };
  if (kind === 'talus') return { x: 2.2 + a * 5.4, y: 1.3 + b * 3.8, z: 2 + c * 5 };
  return { x: 3.8 + a * 9.5, y: 2.5 + b * 7.5, z: 3.2 + c * 8.2 };
}

function placementScore({
  influence,
  frame,
  kind,
  heightAboveSeaMeters,
  seed,
  column,
  row,
  cluster,
  morphologyStrength = 0,
  valyriaInfluence = 0,
}) {
  const slope = frame.slopeDegrees;
  const slopePreference = kind === 'talus'
    ? 1 - Math.min(1, Math.abs(slope - 32) / 24)
    : kind === 'boulder'
      ? 1 - Math.min(1, Math.abs(slope - 13) / 28)
      : smoothstep01((slope - 5) / 28) * (1 - smoothstep01((slope - 56) / 9));
  const altitude = smoothstep01((heightAboveSeaMeters - 12) / 150);
  const base = influence
    * (0.52 + slopePreference * 0.31 + altitude * 0.17)
    * (0.58 + geologyHash01(seed, column, row, cluster?.index ?? 0) * 0.42);
  return base * (1 + valyriaInfluence * morphologyStrength * NATURAL_GEOLOGY_PLACEMENT_POLICY.valyriaMorphologyScoreBoost);
}

function isTooClose(accepted, x, z, minimumDistance, largeOnly = false) {
  const minSquared = minimumDistance ** 2;
  return accepted.some((placement) => (
    (!largeOnly || ['fractured-scarp', 'bedrock', 'asset-proxy'].includes(placement.kind))
    && (placement.x - x) ** 2 + (placement.z - z) ** 2 < minSquared
  ));
}

function makePlacement({
  seed,
  column,
  row,
  x,
  z,
  frame,
  cluster,
  influence,
  heightAboveSeaMeters,
  worldWidthMeters,
  worldDepthMeters,
}) {
  const P = NATURAL_GEOLOGY_PLACEMENT_POLICY;
  const valyriaInfluence = valyriaInfluenceAtWorldXZ(x, z);
  const ownerPoint = normalizedOwnerMapAtWorldXZ(x, z);
  const morphology = valyriaInfluence > P.valyriaMinimumInfluence
    ? valyriaMorphologySignals(ownerPoint.nx, ownerPoint.ny)
    : ZERO_MORPHOLOGY;
  const morphologyDominant = dominantMorphology(morphology);
  const valyriaClass = valyriaGeologyClassAtWorldXZ(x, z, {
    heightAboveSeaMeters,
    slopeDegrees: frame.slopeDegrees,
  });

  let kind = placementKind(
    cluster.kind,
    frame,
    geologyHash01(seed, column, row, 101),
    valyriaClass,
    morphology,
  );
  let assetFraction = valyriaInfluence > P.valyriaMinimumInfluence
    ? P.valyriaAssetProxyFraction
    : P.assetProxyFraction;
  if (morphology.faultActivity > 0.52 || morphology.brokenCalderaShoulder > 0.58) {
    assetFraction = Math.min(0.48, assetFraction + P.valyriaFaultAssetBoost);
  }
  if (
    ['bedrock', 'low-outcrop', 'fractured-scarp'].includes(kind)
    && influence > 0.42
    && geologyHash01(seed, column, row, 102) < assetFraction
  ) kind = 'asset-proxy';

  const scale = geometryScaleFor(
    kind === 'asset-proxy' ? 'bedrock' : kind,
    frame,
    geologyHash01(seed, column, row, 103),
    geologyHash01(seed, column, row, 104),
    geologyHash01(seed, column, row, 105),
  );
  if (morphology.faultActivity > 0.48) {
    scale.x *= 1.18 + morphology.faultActivity * 0.32;
    scale.z *= 0.82;
    scale.y *= 1.06 + morphology.faultActivity * 0.16;
  } else if (morphology.brokenCalderaShoulder > 0.48) {
    scale.x *= 1.10 + morphology.brokenCalderaShoulder * 0.18;
  }

  const strataAngle = regionalStrataAngle(x, z, worldWidthMeters, worldDepthMeters, seed);
  const faultAngle = valyriaFaultWorldAngle(worldWidthMeters, worldDepthMeters);
  const clusterAngle = cluster.orientation;
  const morphologyDrainage = Math.max(morphology.lavaDrainage, morphology.erosionGully);
  const blendToDownhill = valyriaInfluence > P.valyriaMinimumInfluence
    ? morphologyDrainage * P.valyriaDrainageDownhillBlend
    : smoothstep01((frame.slopeDegrees - 16) / 28) * 0.42;
  let structuralAngle = strataAngle;
  if (morphology.faultActivity >= Math.max(morphologyDrainage, morphology.brokenCalderaShoulder)) {
    structuralAngle = faultAngle;
  } else if (morphology.brokenCalderaShoulder > Math.max(morphologyDrainage, 0.32)) {
    structuralAngle = clusterAngle;
  }
  const yaw = structuralAngle
    + angleDifferenceRadians(frame.downhillAngleRadians, structuralAngle) * blendToDownhill
    + hashSigned(seed, column, row, 106) * (valyriaInfluence > P.valyriaMinimumInfluence ? 0.22 : 0.34);

  const terrainTilt = Math.min(P.maxTiltDegrees / DEG, frame.slopeRadians * 0.52);
  const buryFraction = kind === 'talus'
    ? 0.24
    : kind === 'boulder'
      ? 0.19
      : 0.12 + geologyHash01(seed, column, row, 108) * 0.10;
  const southernDryness = clamp01((z / worldDepthMeters) + 0.5);
  const northness = 1 - southernDryness;
  const score = placementScore({
    influence,
    frame,
    kind,
    heightAboveSeaMeters,
    cluster,
    seed,
    column,
    row,
    morphologyStrength: morphologyDominant.strength,
    valyriaInfluence,
  });

  return Object.freeze({
    id: `${column}:${row}:${cluster.index}`,
    x,
    y: frame.y - scale.y * buryFraction,
    z,
    kind,
    sourceClusterKind: cluster.kind,
    sourceMorphologyMode: cluster.morphologyMode ?? 'regional-strata',
    clusterIndex: cluster.index,
    clusterInfluence: influence,
    score,
    scale: Object.freeze(scale),
    yawRadians: yaw,
    tiltRadians: terrainTilt,
    tiltAxisRadians: frame.downhillAngleRadians + Math.PI * 0.5 + hashSigned(seed, column, row, 107) * 0.18,
    slopeDegrees: frame.slopeDegrees,
    normal: Object.freeze({ x: frame.nx, y: frame.ny, z: frame.nz }),
    curvatureMeters: frame.curvatureMeters,
    localReliefMeters: frame.localReliefMeters,
    heightAboveSeaMeters,
    northness,
    southernDryness,
    valyriaInfluence,
    valyriaClass,
    valyriaMorphology: Object.freeze({ ...morphology }),
    valyriaMorphologyDominant: morphologyDominant.kind,
    valyriaMorphologyStrength: morphologyDominant.strength,
    volcanic: valyriaInfluence > P.valyriaMinimumInfluence,
    assetFamily: kind === 'asset-proxy'
      ? (valyriaInfluence > P.valyriaMinimumInfluence
        ? 'rocky-terrain'
        : southernDryness > 0.67 ? 'desert-rocks' : 'rocky-terrain')
      : null,
  });
}

export function generateNaturalGeologyPlacements({
  sampleHeightMeters,
  seaLevelMeters,
  seed = 1337,
  seats = [],
  roadEdges = [],
  worldWidthMeters,
  worldDepthMeters,
  isMobileClass = false,
  maxPlacements,
}) {
  if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
  const width = finite(worldWidthMeters);
  const depth = finite(worldDepthMeters);
  if (!(width > 0) || !(depth > 0)) throw new RangeError('world dimensions must be positive');
  const sea = finite(seaLevelMeters);
  const P = NATURAL_GEOLOGY_PLACEMENT_POLICY;
  const clusterCount = isMobileClass ? P.mobileClusterCount : P.desktopClusterCount;
  const valyriaClusterCount = isMobileClass ? P.mobileValyriaClusterCount : P.desktopValyriaClusterCount;
  const columns = isMobileClass ? P.mobileGridColumns : P.desktopGridColumns;
  const rows = isMobileClass ? P.mobileGridRows : P.desktopGridRows;
  const cap = Math.max(0, Math.floor(
    maxPlacements ?? (isMobileClass ? P.mobileMaxPlacements : P.desktopMaxPlacements),
  ));
  const clusters = [
    ...Array.from({ length: clusterCount }, (_, index) => createCluster(seed, index, width, depth, isMobileClass)),
    ...Array.from(
      { length: valyriaClusterCount },
      (_, index) => createValyriaCluster(seed ^ 0x51a7b33f, index, width, depth, isMobileClass),
    ),
  ];
  const cellWidth = width / columns;
  const cellDepth = depth / rows;
  const candidates = [];
  let rejectedWater = 0;
  let rejectedSettlement = 0;
  let rejectedRoad = 0;
  let rejectedSlope = 0;
  let rejectedCluster = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = -width * 0.5
        + (column + 0.12 + geologyHash01(seed, column, row, 11) * 0.76) * cellWidth;
      const z = -depth * 0.5
        + (row + 0.12 + geologyHash01(seed, column, row, 12) * 0.76) * cellDepth;
      const frame = sampleTerrainFrame(sampleHeightMeters, x, z, P.normalProbeMeters);
      const heightAboveSeaMeters = frame.y - sea;
      if (heightAboveSeaMeters <= P.shorelineReserveMeters) { rejectedWater += 1; continue; }
      if (frame.slopeDegrees > P.maxRockSlopeDegrees) { rejectedSlope += 1; continue; }
      if (minimumDistanceToSeatMeters(x, z, seats) < P.settlementReserveMeters) {
        rejectedSettlement += 1;
        continue;
      }
      if (minimumDistanceToRoadMeters(x, z, roadEdges) < P.roadReserveMeters) {
        rejectedRoad += 1;
        continue;
      }
      const dominant = chooseDominantCluster(clusters, x, z);
      if (!dominant.cluster || dominant.influence < 0.12) { rejectedCluster += 1; continue; }
      const placement = makePlacement({
        seed,
        column,
        row,
        x,
        z,
        frame,
        cluster: dominant.cluster,
        influence: dominant.influence,
        heightAboveSeaMeters,
        worldWidthMeters: width,
        worldDepthMeters: depth,
      });
      const valyrian = placement.valyriaInfluence > P.valyriaMinimumInfluence;
      const threshold = valyrian
        ? (placement.kind === 'boulder' || placement.kind === 'talus' ? 0.10 : 0.12)
        : (placement.kind === 'boulder' ? 0.18 : placement.kind === 'talus' ? 0.16 : 0.22);
      if (placement.score < threshold) { rejectedCluster += 1; continue; }
      candidates.push(valyrian
        ? Object.freeze({ ...placement, score: placement.score * VALYRIA_GEOLOGY_POLICY.geologyDensityBoost })
        : placement);
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const accepted = [];
  for (const candidate of candidates) {
    if (accepted.length >= cap) break;
    const large = ['fractured-scarp', 'bedrock', 'asset-proxy'].includes(candidate.kind);
    if (isTooClose(accepted, candidate.x, candidate.z, P.minimumNearestNeighborMeters)) continue;
    if (large && isTooClose(
      accepted,
      candidate.x,
      candidate.z,
      P.minimumLargeOutcropSpacingMeters,
      true,
    )) continue;
    accepted.push(candidate);
  }
  accepted.sort((a, b) => a.id.localeCompare(b.id));

  const kinds = {};
  const assetFamilies = {};
  const valyriaMorphologyKinds = {};
  let valyriaPlacementCount = 0;
  let faultAlignedPlacementCount = 0;
  let drainageAlignedPlacementCount = 0;
  for (const placement of accepted) {
    kinds[placement.kind] = (kinds[placement.kind] ?? 0) + 1;
    if (placement.assetFamily) {
      assetFamilies[placement.assetFamily] = (assetFamilies[placement.assetFamily] ?? 0) + 1;
    }
    if (placement.volcanic) {
      valyriaPlacementCount += 1;
      const dominant = placement.valyriaMorphologyDominant;
      valyriaMorphologyKinds[dominant] = (valyriaMorphologyKinds[dominant] ?? 0) + 1;
      if (dominant === 'fault') faultAlignedPlacementCount += 1;
      if (dominant === 'lava-drainage' || dominant === 'erosion-gully') drainageAlignedPlacementCount += 1;
    }
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
      assetFamilies: Object.freeze(assetFamilies),
      valyriaPlacementCount,
      valyriaMorphologyKinds: Object.freeze(valyriaMorphologyKinds),
      faultAlignedPlacementCount,
      drainageAlignedPlacementCount,
      valyriaMorphologyAligned: true,
    }),
  });
}

export function checksumNaturalGeologyPlacements(placements) {
  let hash = 2166136261 >>> 0;
  const mix = (value) => {
    for (const character of String(value)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  };
  for (const placement of placements ?? []) {
    mix(placement.id);
    mix(Math.round(placement.x * 100));
    mix(Math.round(placement.y * 100));
    mix(Math.round(placement.z * 100));
    mix(placement.kind);
    mix(Math.round(placement.yawRadians * 10000));
    mix(Math.round(placement.scale.x * 100));
    mix(Math.round(placement.scale.y * 100));
    mix(Math.round(placement.scale.z * 100));
    mix(placement.valyriaMorphologyDominant ?? 'none');
  }
  return hash.toString(16).padStart(8, '0');
}
