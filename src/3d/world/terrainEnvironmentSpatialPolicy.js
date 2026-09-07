/**
 * Deterministic spatial ecology policy for already-authored environment assets.
 * Geography is upstream and immutable here; this module produces distribution weights only.
 */
import { environmentSurfaceScore, resolveTerrainEnvironmentProfile } from './terrainEnvironmentProfiles.js';
import { deterministicEnvironmentSeed } from './terrainEnvironmentAssetRegistry.js';

const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(Number(v)) ? Number(v) : 0));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / Math.max(1e-6, b - a)); return t * t * (3 - 2 * t); };

export const TERRAIN_ENVIRONMENT_SPATIAL_POLICY = Object.freeze({
  id: 'terrain-environment-spatial-ecology-2026-09-07-v2',
  deterministic: true,
  canonicalHeightUntouched: true,
  canonicalHydrologyUntouched: true,
  canonicalColliderUntouched: true,
  noGeometryInstantiation: true,
  patternTypes: Object.freeze(['grove','ecotone','opening','talus','scree-apron','shoreline-edge','settlement-envelope','snow-drift']),
  grove: Object.freeze({ coreDensityMultiplier: 1.7, edgeDensityMultiplier: 0.68, openingPenalty: 0.46, ecotoneWidthMeters: 44 }),
  shrub: Object.freeze({ edgeMultiplier: 1.34, wetMultiplier: 1.42, dryPenalty: 0.16 }),
  rock: Object.freeze({ peakSlopeDegrees: 62, windowDegrees: 22, ridgeMultiplier: 1.28 }),
  scree: Object.freeze({ minSlopeDegrees: 24, maxSlopeDegrees: 58, talusReachMeters: 95 }),
  settlement: Object.freeze({ clearingMeters: 22, envelopeMeters: 150, localMultiplier: 1.42 }),
  snow: Object.freeze({ leeMultiplier: 1.30, windwardPenalty: 0.72, exposedRockPenalty: 0.58 }),
});

function hash2(x, z, seed) {
  let h = (Math.imul(Math.floor(x) | 0, 0x1f123bb5) ^ Math.imul(Math.floor(z) | 0, 0x5bd1e995) ^ (seed | 0)) | 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function noise2(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z); const fx = smoothstep(0, 1, x - ix), fz = smoothstep(0, 1, z - iz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz;
}
function fbm(x, z, seed) {
  let sum = 0, amp = 0.58, freq = 1, weight = 0;
  for (let i = 0; i < 5; i += 1) { sum += noise2(x * freq, z * freq, seed + i * 0x9e3779b9) * amp; weight += amp; amp *= 0.48; freq *= 2.03; }
  return weight ? sum / weight : 0.5;
}
function ridged(x, z, seed) { return 1 - Math.abs(fbm(x, z, seed) * 2 - 1); }

export function environmentSpatialNoise(worldX, worldZ, seed = 0x51f15e) {
  return Object.freeze({
    macro: fbm(worldX / 1200, worldZ / 1200, seed ^ 0x13a6),
    broad: fbm(worldX / 520, worldZ / 520, seed ^ 0x22bd),
    meso: fbm(worldX / 210, worldZ / 210, seed ^ 0x42d1),
    fine: fbm(worldX / 78, worldZ / 78, seed ^ 0x61ef),
    edge: ridged(worldX / 155, worldZ / 155, seed ^ 0x74aa),
  });
}
export function distanceFalloff(distanceMeters, innerRadiusMeters, outerRadiusMeters) {
  const d = Math.max(0, finite(distanceMeters, 0)); const inner = Math.max(0, finite(innerRadiusMeters, 0)); const outer = Math.max(inner + 1e-6, finite(outerRadiusMeters, inner + 1));
  if (d <= inner) return 1; if (d >= outer) return 0; return 1 - smoothstep(inner, outer, d);
}
export function forestCoreWeight(distance, radius, width = 44) { const r = Math.max(1, finite(radius, 165)); const d = Math.max(0, finite(distance, r)); const edge = Math.max(0, r - Math.max(1, finite(width, 44))); return d <= edge ? 1 : d >= r ? 0 : 1 - smoothstep(edge, r, d); }
export function forestEcotoneWeight(distance, radius, width = 44) { const core = forestCoreWeight(distance, radius, width); return clamp01(distanceFalloff(distance, Math.max(0, radius - width), radius + width * 0.4) * (1 - core * 0.42)); }
export function groveOpeningWeight(worldX, worldZ, seed = 0x2c6f19) { const field = fbm(worldX / 92, worldZ / 92, seed); const broad = ridged(worldX / 220, worldZ / 220, seed ^ 0x31a7); return clamp01((1 - smoothstep(0.44, 0.73, field)) * 0.66 + (1 - broad) * 0.34); }
export function moistureDistributionWeight({ moisture = 0.5, biome = '', elevationMeters = 0, waterDistanceMeters = Infinity } = {}) {
  const wet = clamp01(moisture); const lowland = 1 - smoothstep(20, 140, finite(elevationMeters)); const water = distanceFalloff(waterDistanceMeters, 0, 28); const b = String(biome || '').toLowerCase();
  return clamp01(wet * 0.58 + lowland * 0.15 + water * 0.27 + (['wet-meadow','marsh','forest-edge'].includes(b) ? 0.18 : 0) - (['dry-upland','dry-heath'].includes(b) ? 0.16 : 0));
}
export function slopeDistributionWeight({ slopeDegrees = 0, category = 'tree' } = {}) {
  const s = clamp(finite(slopeDegrees), 0, 90); const k = String(category || 'tree').toLowerCase();
  if (k === 'rock' || k === 'cliff') return clamp01(smoothstep(16, 42, s) * (1 - smoothstep(76, 88, s)));
  if (k === 'scree') return clamp01(smoothstep(24, 32, s) * (1 - smoothstep(55, 64, s)));
  if (k === 'grass') return clamp01(1 - smoothstep(34, 52, s));
  if (k === 'shrub') return clamp01(1 - smoothstep(38, 50, s));
  return clamp01(1 - smoothstep(22, 38, s));
}
export function rockExposureWeight({ slopeDegrees = 0, ridgeWeight = 0, substrateRock = 0 } = {}) {
  const s = finite(slopeDegrees), ridge = clamp01(ridgeWeight), substrate = clamp01(substrateRock);
  const peak = 1 - Math.min(1, Math.abs(s - TERRAIN_ENVIRONMENT_SPATIAL_POLICY.rock.peakSlopeDegrees) / TERRAIN_ENVIRONMENT_SPATIAL_POLICY.rock.windowDegrees);
  return clamp01(peak * 0.48 + ridge * 0.28 + substrate * 0.24);
}
export function talusWeight({ slopeDegrees = 0, heightMeters = 0, distanceBelowRockFaceMeters = Infinity, ridgeWeight = 0 } = {}) {
  const s = clamp(finite(slopeDegrees), 0, 90), h = finite(heightMeters), below = distanceFalloff(distanceBelowRockFaceMeters, 16, TERRAIN_ENVIRONMENT_SPATIAL_POLICY.scree.talusReachMeters);
  const slopeBand = smoothstep(24, 35, s) * (1 - smoothstep(55, 62, s)); return clamp01(below * 0.46 + slopeBand * 0.30 + smoothstep(25, 140, h) * 0.10 + clamp01(ridgeWeight) * 0.14);
}
export function settlementEnvelopeWeight({ distanceMeters = Infinity, roadDistanceMeters = Infinity } = {}) { return clamp01(distanceFalloff(distanceMeters, 22, 150) * 0.74 + distanceFalloff(roadDistanceMeters, 1.5, 24) * 0.26); }
export function snowDriftWeight({ snowWeight = 0.5, windward = 0.5, lee = 0.5, exposedRock = 0, slopeDegrees = 0 } = {}) {
  const snow = clamp01(snowWeight), wind = clamp01(windward), leeward = clamp01(lee), rock = clamp01(exposedRock), slope = clamp(finite(slopeDegrees), 0, 90);
  const leeGain = leeward * TERRAIN_ENVIRONMENT_SPATIAL_POLICY.snow.leeMultiplier;
  const windPenalty = wind * TERRAIN_ENVIRONMENT_SPATIAL_POLICY.snow.windwardPenalty;
  return clamp01(snow * (0.62 + leeGain * 0.38) * (0.72 + windPenalty * 0.28) * (1 - rock * TERRAIN_ENVIRONMENT_SPATIAL_POLICY.snow.exposedRockPenalty * 0.34) * (0.82 + 0.18 * (1 - smoothstep(42, 70, slope))));
}
export function ecotoneComposition(category, context = {}) {
  const key = String(category || '').toLowerCase(); const profile = resolveTerrainEnvironmentProfile(key) || resolveTerrainEnvironmentProfile('rock');
  const noise = environmentSpatialNoise(finite(context.worldX), finite(context.worldZ), finite(context.seed, 0x51f15e));
  const core = forestCoreWeight(context.distanceFromGroveCenterMeters, context.groveRadiusMeters, context.ecotoneWidthMeters);
  const edge = forestEcotoneWeight(context.distanceFromGroveCenterMeters, context.groveRadiusMeters, context.ecotoneWidthMeters);
  const moisture = moistureDistributionWeight({ moisture: context.moisture, biome: context.biome, elevationMeters: context.heightMeters, waterDistanceMeters: context.waterDistanceMeters });
  const slope = slopeDistributionWeight({ slopeDegrees: context.slopeDegrees, category: key });
  const opening = groveOpeningWeight(finite(context.worldX), finite(context.worldZ), finite(context.seed, 0x2c6f19));
  const score = environmentSurfaceScore(profile, { slopeDegrees: context.slopeDegrees, heightMeters: context.heightMeters, moisture, waterDepth: context.waterDepth, biome: context.biome, roadDistance: context.roadDistance, settlementDistance: context.settlementDistance });
  let density = 1;
  if (key === 'tree') density = (0.52 + core * TERRAIN_ENVIRONMENT_SPATIAL_POLICY.grove.coreDensityMultiplier + edge * TERRAIN_ENVIRONMENT_SPATIAL_POLICY.grove.edgeDensityMultiplier) * (1 - opening * TERRAIN_ENVIRONMENT_SPATIAL_POLICY.grove.openingPenalty);
  else if (key === 'shrub') density = 0.68 + edge * 0.72 + moisture * 0.35;
  else if (key === 'grass') density = 0.72 + (1 - core) * 0.22 + moisture * 0.36;
  else if (key === 'rock') density = 0.76 + rockExposureWeight({ slopeDegrees: context.slopeDegrees, ridgeWeight: context.ridgeWeight, substrateRock: context.rockWeight }) * 0.74;
  else if (key === 'scree') density = 0.62 + talusWeight({ slopeDegrees: context.slopeDegrees, heightMeters: context.heightMeters, distanceBelowRockFaceMeters: context.distanceBelowRockFaceMeters, ridgeWeight: context.ridgeWeight }) * 0.98;
  else if (key === 'snow-patch') density = 0.52 + snowDriftWeight({ snowWeight: context.snowWeight, windward: context.windward, lee: context.lee, exposedRock: context.rockWeight, slopeDegrees: context.slopeDegrees }) * 1.22;
  else density = 0.72 + settlementEnvelopeWeight({ distanceMeters: context.settlementDistance, roadDistanceMeters: context.roadDistance }) * TERRAIN_ENVIRONMENT_SPATIAL_POLICY.settlement.localMultiplier;
  if (context.settlementDistance != null && ['tree','shrub','grass'].includes(key)) density *= 0.72 + distanceFalloff(context.settlementDistance, 22, 150) * 0.28;
  density *= 0.60 + score * 0.40; density *= 0.78 + noise.meso * 0.44;
  return Object.freeze({ category: key, densityMultiplier: clamp(density, 0, 2.2), coreWeight: core, ecotoneWeight: edge, moistureWeight: moisture, slopeWeight: slope, openingWeight: opening, environmentalScore: score, noise });
}
export function deterministicSpatialOrdinal(assetId, worldX, worldZ, ordinal = 0) { return (deterministicEnvironmentSeed(`spatial:${assetId || 'environment'}`, worldX, worldZ) ^ (Number(ordinal) | 0)) >>> 0; }
export function sampleClusterPoint(seed, centerX, centerZ, innerRadiusMeters, outerRadiusMeters, ordinal = 0) {
  const d = deterministicSpatialOrdinal(seed, centerX, centerZ, ordinal); const u = ((d % 1000003) + 1) / 1000004; const v = (((d >>> 11) % 1000003) + 1) / 1000004;
  const radius = Math.sqrt(u * (outerRadiusMeters ** 2 - innerRadiusMeters ** 2) + innerRadiusMeters ** 2); const angle = v * Math.PI * 2;
  return Object.freeze({ x: centerX + Math.cos(angle) * radius, z: centerZ + Math.sin(angle) * radius, radius, angle, seed: d });
}
export function buildSpatialDistributionManifest({ category, seed, worldX, worldZ, sample = {} } = {}) {
  const composition = ecotoneComposition(category, { ...sample, seed, worldX, worldZ });
  return Object.freeze({ version: 1, policyId: TERRAIN_ENVIRONMENT_SPATIAL_POLICY.id, category, deterministic: true, origin: { worldX: finite(worldX), worldZ: finite(worldZ) }, seed: deterministicSpatialOrdinal(category, worldX, worldZ, seed), composition, canonical: { heightUnchanged: true, hydrologyUnchanged: true, colliderUnchanged: true } });
}
