import { VALYRIA_GEOLOGY_POLICY, valyriaGeologyClassAtWorldXZ, valyriaInfluenceAtWorldXZ } from './valyriaGeology.js';

/**
 * Deterministic placement policy for natural bedrock, outcrops and talus.
 *
 * This module owns no geometry and no height authority. It reads the canonical terrain sampler and
 * returns placement descriptors only. The distribution is deliberately cluster/band driven instead
 * of uniform random scatter: real exposed geology follows bedrock structure, slope breaks and local
 * erosion rather than forming an even carpet of rocks.
 *
 * @module world/naturalGeologyPlacement
 */

export const NATURAL_GEOLOGY_PLACEMENT_POLICY = Object.freeze({
  id: 'natural-geology-placement-2026-08-27-v1-asset-informed-strata',
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
  minimumLargeOutcropSpacingMeters: 66,
  talusSlopeMinDegrees: 21,
  talusSlopeMaxDegrees: 48,
});

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;
const smoothstep01 = (value) => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

function mix32(value) {
  let x = value >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
  return x >>> 0;
}
export function geologyHash01(seed, a = 0, b = 0, c = 0) {
  const s = mix32((seed >>> 0) ^ Math.imul((a + 1) | 0, 0x9e3779b1));
  const t = mix32(s ^ Math.imul((b + 17) | 0, 0x85ebca77));
  const u = mix32(t ^ Math.imul((c + 101) | 0, 0xc2b2ae3d));
  return u / 4294967296;
}
const hashSigned = (seed, a, b, c) => geologyHash01(seed, a, b, c) * 2 - 1;
function angleDifferenceRadians(a, b) { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
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
  for (const seat of seats ?? []) if (Number.isFinite(seat?.x) && Number.isFinite(seat?.z)) best = Math.min(best, Math.hypot(x - seat.x, z - seat.z));
  return best;
}
export function sampleTerrainFrame(sampleHeightMeters, x, z, probeMeters = NATURAL_GEOLOGY_PLACEMENT_POLICY.normalProbeMeters) {
  if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
  const probe = Math.max(0.25, finite(probeMeters, 9));
  const y = finite(sampleHeightMeters(x, z));
  const left = finite(sampleHeightMeters(x - probe, z), y), right = finite(sampleHeightMeters(x + probe, z), y);
  const down = finite(sampleHeightMeters(x, z - probe), y), up = finite(sampleHeightMeters(x, z + probe), y);
  const dx = (right - left) / (2 * probe), dz = (up - down) / (2 * probe);
  const inv = 1 / Math.max(1e-9, Math.hypot(-dx, 1, -dz));
  const nx = -dx * inv, ny = inv, nz = -dz * inv;
  return Object.freeze({ x, y, z, nx, ny, nz, slopeRadians: Math.acos(Math.max(-1, Math.min(1, ny))),
    slopeDegrees: Math.acos(Math.max(-1, Math.min(1, ny))) * DEG, downhillAngleRadians: Math.atan2(dz, dx) + Math.PI,
    curvatureMeters: ((left + right + down + up) * 0.25) - y,
    localReliefMeters: Math.max(left, right, down, up, y) - Math.min(left, right, down, up, y), gradientX: dx, gradientZ: dz });
}
function regionalStrataAngle(x, z, width, depth, seed) {
  const nx = x / Math.max(1, width) + 0.5, nz = z / Math.max(1, depth) + 0.5;
  return -0.32 + Math.sin(TAU * (nx * 0.72 + nz * 0.21) + geologyHash01(seed, 9, 4, 1) * TAU) * 0.62
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
  return Object.freeze({ index, x, z, orientation, alongRadiusMeters, acrossRadiusMeters,
    kind: selector < 0.46 ? 'bedrock-band' : selector < 0.78 ? 'talus-apron' : 'boulder-field',
    strength: 0.62 + geologyHash01(seed, index, 7, 0) * 0.38 });
}
function createValyriaCluster(seed, index, width, depth, mobile) {
  const angle = geologyHash01(seed, index, 201, 0) * TAU;
  const radial = Math.sqrt(geologyHash01(seed, index, 202, 0)) * (mobile ? 420 : 700);
  const coreWorldX = (VALYRIA_GEOLOGY_POLICY.coreCenter.nx * 9000 - 4500) * (width / 9000);
  const coreWorldZ = (VALYRIA_GEOLOGY_POLICY.coreCenter.ny * 7000 - 3500) * (depth / 7000);
  const x = coreWorldX + Math.cos(angle) * radial;
  const z = coreWorldZ + Math.sin(angle) * radial * 0.82;
  const orientation = regionalStrataAngle(x, z, width, depth, seed) + hashSigned(seed, index, 203, 0) * 0.42;
  return Object.freeze({ index: 1000 + index, x, z, orientation,
    alongRadiusMeters: (mobile ? 170 : 260) + geologyHash01(seed, index, 204, 0) * (mobile ? 220 : 480),
    acrossRadiusMeters: (mobile ? 80 : 110) + geologyHash01(seed, index, 205, 0) * (mobile ? 95 : 190),
    kind: geologyHash01(seed, index, 206, 0) < 0.63 ? 'bedrock-band' : 'talus-apron', strength: 0.82 + geologyHash01(seed, index, 207, 0) * 0.18 });
}
function clusterInfluence(cluster, x, z) {
  const dx = x - cluster.x, dz = z - cluster.z, c = Math.cos(cluster.orientation), s = Math.sin(cluster.orientation);
  const along = dx * c + dz * s, across = -dx * s + dz * c;
  const n = (along * along) / (cluster.alongRadiusMeters ** 2) + (across * across) / (cluster.acrossRadiusMeters ** 2);
  return n >= 1 ? 0 : (1 - smoothstep01(n)) * cluster.strength;
}
function chooseDominantCluster(clusters, x, z) {
  let best = null, influence = 0;
  for (const cluster of clusters) { const c = clusterInfluence(cluster, x, z); if (c > influence) { influence = c; best = cluster; } }
  return { cluster: best, influence };
}
function placementKind(clusterKind, frame, randomSelector, valyriaClass) {
  if (valyriaClass === 'fractured-volcanic-scarp') return randomSelector < 0.78 ? 'fractured-scarp' : 'bedrock';
  if (valyriaClass === 'doom-core' || valyriaClass === 'basalt-ridge') return randomSelector < 0.68 ? 'bedrock' : 'low-outcrop';
  const slope = frame.slopeDegrees;
  if (clusterKind === 'talus-apron' && slope >= 21) return 'talus';
  if (clusterKind === 'boulder-field' || slope < 12) return randomSelector < 0.72 ? 'boulder' : 'low-outcrop';
  if (slope > 39) return randomSelector < 0.62 ? 'fractured-scarp' : 'bedrock';
  return randomSelector < 0.58 ? 'bedrock' : 'low-outcrop';
}
function geometryScaleFor(kind, frame, a, b, c) {
  const sf = smoothstep01((frame.slopeDegrees - 8) / 42);
  if (kind === 'fractured-scarp') return { x: 12 + a * 24, y: 10 + b * 24 + sf * 8, z: 5 + c * 10 };
  if (kind === 'bedrock') return { x: 9 + a * 19, y: 5 + b * 12 + sf * 5, z: 5 + c * 12 };
  if (kind === 'low-outcrop') return { x: 7 + a * 16, y: 2.8 + b * 7, z: 6 + c * 14 };
  if (kind === 'talus') return { x: 2.2 + a * 5.4, y: 1.3 + b * 3.8, z: 2 + c * 5 };
  return { x: 3.8 + a * 9.5, y: 2.5 + b * 7.5, z: 3.2 + c * 8.2 };
}
function placementScore({ influence, frame, kind, heightAboveSeaMeters, seed, column, row, cluster }) {
  const slope = frame.slopeDegrees;
  const slopePreference = kind === 'talus' ? 1 - Math.min(1, Math.abs(slope - 32) / 24)
    : kind === 'boulder' ? 1 - Math.min(1, Math.abs(slope - 13) / 28)
    : smoothstep01((slope - 5) / 28) * (1 - smoothstep01((slope - 56) / 9));
  const altitude = smoothstep01((heightAboveSeaMeters - 12) / 150);
  return influence * (0.52 + slopePreference * 0.31 + altitude * 0.17) * (0.58 + geologyHash01(seed, column, row, cluster?.index ?? 0) * 0.42);
}
function isTooClose(accepted, x, z, minimumDistance, largeOnly = false) {
  const min2 = minimumDistance ** 2;
  return accepted.some((p) => (!largeOnly || ['fractured-scarp', 'bedrock', 'asset-proxy'].includes(p.kind)) && (p.x - x) ** 2 + (p.z - z) ** 2 < min2);
}
function makePlacement({ seed, column, row, x, z, frame, cluster, influence, heightAboveSeaMeters, worldWidthMeters, worldDepthMeters }) {
  const valyriaInfluence = valyriaInfluenceAtWorldXZ(x, z);
  const valyriaClass = valyriaGeologyClassAtWorldXZ(x, z, { heightAboveSeaMeters, slopeDegrees: frame.slopeDegrees });
  let kind = placementKind(cluster.kind, frame, geologyHash01(seed, column, row, 101), valyriaClass);
  const assetFraction = valyriaInfluence > NATURAL_GEOLOGY_PLACEMENT_POLICY.valyriaMinimumInfluence
    ? NATURAL_GEOLOGY_PLACEMENT_POLICY.valyriaAssetProxyFraction : NATURAL_GEOLOGY_PLACEMENT_POLICY.assetProxyFraction;
  if (['bedrock', 'low-outcrop', 'fractured-scarp'].includes(kind) && influence > 0.42 && geologyHash01(seed, column, row, 102) < assetFraction) kind = 'asset-proxy';
  const scale = geometryScaleFor(kind === 'asset-proxy' ? 'bedrock' : kind, frame,
    geologyHash01(seed, column, row, 103), geologyHash01(seed, column, row, 104), geologyHash01(seed, column, row, 105));
  const strataAngle = regionalStrataAngle(x, z, worldWidthMeters, worldDepthMeters, seed);
  const blendToDownhill = smoothstep01((frame.slopeDegrees - 16) / 28) * 0.42;
  const yaw = strataAngle + angleDifferenceRadians(frame.downhillAngleRadians, strataAngle) * blendToDownhill + hashSigned(seed, column, row, 106) * 0.34;
  const terrainTilt = Math.min(NATURAL_GEOLOGY_PLACEMENT_POLICY.maxTiltDegrees / DEG, frame.slopeRadians * 0.52);
  const buryFraction = kind === 'talus' ? 0.24 : kind === 'boulder' ? 0.19 : 0.12 + geologyHash01(seed, column, row, 108) * 0.10;
  const southernDryness = clamp01((z / worldDepthMeters) + 0.5), northness = 1 - southernDryness;
  return Object.freeze({ id: `${column}:${row}:${cluster.index}`, x, y: frame.y - scale.y * buryFraction, z, kind,
    sourceClusterKind: cluster.kind, clusterIndex: cluster.index, clusterInfluence: influence,
    score: placementScore({ influence, frame, kind, heightAboveSeaMeters, cluster, seed, column, row }), scale: Object.freeze(scale),
    yawRadians: yaw, tiltRadians: terrainTilt, tiltAxisRadians: frame.downhillAngleRadians + Math.PI * 0.5 + hashSigned(seed, column, row, 107) * 0.18,
    slopeDegrees: frame.slopeDegrees, normal: Object.freeze({ x: frame.nx, y: frame.ny, z: frame.nz }), curvatureMeters: frame.curvatureMeters,
    localReliefMeters: frame.localReliefMeters, heightAboveSeaMeters, northness, southernDryness, valyriaInfluence, valyriaClass,
    volcanic: valyriaInfluence > NATURAL_GEOLOGY_PLACEMENT_POLICY.valyriaMinimumInfluence,
    assetFamily: kind === 'asset-proxy' ? (valyriaInfluence > NATURAL_GEOLOGY_PLACEMENT_POLICY.valyriaMinimumInfluence ? 'rocky-terrain' : southernDryness > 0.67 ? 'desert-rocks' : 'rocky-terrain') : null });
}

export function generateNaturalGeologyPlacements({ sampleHeightMeters, seaLevelMeters, seed = 1337, seats = [], roadEdges = [], worldWidthMeters, worldDepthMeters, isMobileClass = false, maxPlacements }) {
  if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
  const width = finite(worldWidthMeters), depth = finite(worldDepthMeters);
  if (!(width > 0) || !(depth > 0)) throw new RangeError('world dimensions must be positive');
  const sea = finite(seaLevelMeters), P = NATURAL_GEOLOGY_PLACEMENT_POLICY;
  const clusterCount = isMobileClass ? P.mobileClusterCount : P.desktopClusterCount;
  const valyriaClusterCount = isMobileClass ? P.mobileValyriaClusterCount : P.desktopValyriaClusterCount;
  const columns = isMobileClass ? P.mobileGridColumns : P.desktopGridColumns, rows = isMobileClass ? P.mobileGridRows : P.desktopGridRows;
  const cap = Math.max(0, Math.floor(maxPlacements ?? (isMobileClass ? P.mobileMaxPlacements : P.desktopMaxPlacements)));
  const clusters = [
    ...Array.from({ length: clusterCount }, (_, i) => createCluster(seed, i, width, depth, isMobileClass)),
    ...Array.from({ length: valyriaClusterCount }, (_, i) => createValyriaCluster(seed ^ 0x51a7b33f, i, width, depth, isMobileClass)),
  ];
  const cellWidth = width / columns, cellDepth = depth / rows, candidates = [];
  let rejectedWater = 0, rejectedSettlement = 0, rejectedRoad = 0, rejectedSlope = 0, rejectedCluster = 0;
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const x = -width * 0.5 + (column + 0.12 + geologyHash01(seed, column, row, 11) * 0.76) * cellWidth;
    const z = -depth * 0.5 + (row + 0.12 + geologyHash01(seed, column, row, 12) * 0.76) * cellDepth;
    const frame = sampleTerrainFrame(sampleHeightMeters, x, z, P.normalProbeMeters), heightAboveSeaMeters = frame.y - sea;
    if (heightAboveSeaMeters <= P.shorelineReserveMeters) { rejectedWater++; continue; }
    if (frame.slopeDegrees > P.maxRockSlopeDegrees) { rejectedSlope++; continue; }
    if (minimumDistanceToSeatMeters(x, z, seats) < P.settlementReserveMeters) { rejectedSettlement++; continue; }
    if (minimumDistanceToRoadMeters(x, z, roadEdges) < P.roadReserveMeters) { rejectedRoad++; continue; }
    const dominant = chooseDominantCluster(clusters, x, z);
    if (!dominant.cluster || dominant.influence < 0.12) { rejectedCluster++; continue; }
    const placement = makePlacement({ seed, column, row, x, z, frame, cluster: dominant.cluster, influence: dominant.influence, heightAboveSeaMeters, worldWidthMeters: width, worldDepthMeters: depth });
    const valyrian = placement.valyriaInfluence > P.valyriaMinimumInfluence;
    const threshold = valyrian ? (placement.kind === 'boulder' || placement.kind === 'talus' ? 0.10 : 0.12)
      : (placement.kind === 'boulder' ? 0.18 : placement.kind === 'talus' ? 0.16 : 0.22);
    if (placement.score < threshold) { rejectedCluster++; continue; }
    candidates.push(valyrian ? Object.freeze({ ...placement, score: placement.score * VALYRIA_GEOLOGY_POLICY.geologyDensityBoost }) : placement);
  }
  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const accepted = [];
  for (const candidate of candidates) {
    if (accepted.length >= cap) break;
    const large = ['fractured-scarp', 'bedrock', 'asset-proxy'].includes(candidate.kind);
    if (isTooClose(accepted, candidate.x, candidate.z, P.minimumNearestNeighborMeters)) continue;
    if (large && isTooClose(accepted, candidate.x, candidate.z, P.minimumLargeOutcropSpacingMeters, true)) continue;
    accepted.push(candidate);
  }
  accepted.sort((a, b) => a.id.localeCompare(b.id));
  const kinds = {}, assetFamilies = {}; let valyriaPlacementCount = 0;
  for (const p of accepted) { kinds[p.kind] = (kinds[p.kind] ?? 0) + 1; if (p.assetFamily) assetFamilies[p.assetFamily] = (assetFamilies[p.assetFamily] ?? 0) + 1; if (p.volcanic) valyriaPlacementCount++; }
  return Object.freeze({ policyId: P.id, placements: Object.freeze(accepted), clusters: Object.freeze(clusters), stats: Object.freeze({
    candidateCount: columns * rows, eligibleCandidateCount: candidates.length, placedCount: accepted.length, cap, clusterCount: clusters.length,
    genericClusterCount: clusterCount, valyriaClusterCount, gridColumns: columns, gridRows: rows, cellWidthMeters: cellWidth, cellDepthMeters: cellDepth,
    rejectedWater, rejectedSettlement, rejectedRoad, rejectedSlope, rejectedCluster, kinds: Object.freeze(kinds), assetFamilies: Object.freeze(assetFamilies), valyriaPlacementCount }) });
}
export function checksumNaturalGeologyPlacements(placements) {
  let hash = 2166136261 >>> 0; const mix = (value) => { for (const ch of String(value)) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619) >>> 0; } };
  for (const p of placements ?? []) { mix(p.id); mix(Math.round(p.x * 100)); mix(Math.round(p.y * 100)); mix(Math.round(p.z * 100)); mix(p.kind); mix(Math.round(p.yawRadians * 10000)); mix(Math.round(p.scale.x * 100)); mix(Math.round(p.scale.y * 100)); mix(Math.round(p.scale.z * 100)); }
  return hash.toString(16).padStart(8, '0');
}
