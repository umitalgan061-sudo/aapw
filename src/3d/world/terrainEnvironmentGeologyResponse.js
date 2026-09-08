/**
 * Geological response layers for world-space environment planning.
 * Read-only descriptors; no mesh generation, movement or terrain writes.
 */

import { TERRAIN_ENVIRONMENT_ROCK_ASSET_POLICY, VERIFIED_ROCK_ENVIRONMENT_ASSETS } from './terrainEnvironmentRockAssetCatalog.js';
import { VALYRIA_GEOLOGY_POLICY, valyriaGeologyClassAtWorldXZ, valyriaInfluenceAtWorldXZ } from './valyriaGeology.js';

const freeze = (v) => Object.freeze(v);
const norm = (v) => String(v ?? '').trim().toLowerCase();
const finite = (v, f = 0) => Number.isFinite(v) ? v : f;
const clamp01 = (v) => Math.max(0, Math.min(1, finite(v)));
const smooth = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };

export const TERRAIN_ENVIRONMENT_GEOLOGY_RESPONSE_POLICY = freeze({
  id: 'terrain-environment-geology-response-2026-09-08-v1',
  deterministic: true,
  authoredOnly: true,
  noGeometryCreation: true,
  noTerrainMutation: true,
  noHydrologyMutation: true,
  noColliderMutation: true,
  minimumRockAssetCount: 2,
  geologyClasses: freeze(['plain', 'ridge', 'outcrop', 'talus', 'cliff', 'fractured-scarp', 'volcanic-scarp']),
  sourceAuthority: 'naturalGeologyPlacement',
  valyriaAuthority: 'valyriaGeology',
  rockPolicyId: TERRAIN_ENVIRONMENT_ROCK_ASSET_POLICY.id,
});

const GEOLOGY_PROFILES = freeze({
  plain: freeze({ rock: 0.12, cliff: 0.02, scree: 0.04, relief: 0.20, scale: 0.58, spacing: 0.80 }),
  ridge: freeze({ rock: 0.56, cliff: 0.26, scree: 0.34, relief: 0.78, scale: 1.02, spacing: 0.54 }),
  outcrop: freeze({ rock: 0.86, cliff: 0.52, scree: 0.42, relief: 0.82, scale: 1.10, spacing: 0.42 }),
  talus: freeze({ rock: 0.48, cliff: 0.18, scree: 0.93, relief: 0.62, scale: 0.76, spacing: 0.34 }),
  cliff: freeze({ rock: 0.78, cliff: 0.98, scree: 0.64, relief: 1.00, scale: 1.22, spacing: 0.76 }),
  'fractured-scarp': freeze({ rock: 0.94, cliff: 0.92, scree: 0.86, relief: 1.00, scale: 1.38, spacing: 0.92 }),
  'volcanic-scarp': freeze({ rock: 0.96, cliff: 0.90, scree: 0.78, relief: 0.94, scale: 1.46, spacing: 0.88 }),
});

function geologyClass({ slopeDegrees = 0, localReliefMeters = 0, rockExposure = 0, talusWeight = 0, curvatureMeters = 0, valyriaClass = 'plain' } = {}) {
  const slope = finite(slopeDegrees);
  const relief = finite(localReliefMeters);
  const rock = clamp01(rockExposure);
  const talus = clamp01(talusWeight);
  const curvature = Math.abs(finite(curvatureMeters));
  if (['fractured-volcanic-scarp', 'volcanic-scarp'].includes(norm(valyriaClass))) return 'volcanic-scarp';
  if (valyriaClass === 'fractured-volcanic-scarp') return 'fractured-scarp';
  if (slope >= 44 && rock >= 0.45) return 'cliff';
  if (slope >= 34 && (rock >= 0.55 || relief >= 22)) return 'fractured-scarp';
  if (talus >= 0.62 && slope >= 18) return 'talus';
  if (rock >= 0.68 && relief >= 10) return 'outcrop';
  if (slope >= 18 || relief >= 15 || curvature >= 6) return 'ridge';
  return 'plain';
}

function exposureEnvelope(sample, valyriaInfluence) {
  const rock = clamp01(sample.rockExposure);
  const talus = clamp01(sample.talusWeight);
  const slope = clamp01(finite(sample.slopeDegrees) / 60);
  const height = clamp01((finite(sample.heightAboveSeaMeters) - 10) / 480);
  return freeze({
    rockExposure: clamp01(rock * 0.58 + slope * 0.22 + height * 0.14 + valyriaInfluence * 0.06),
    screeExposure: clamp01(talus * 0.56 + slope * 0.28 + valyriaInfluence * 0.16),
    cliffExposure: clamp01(slope * 0.64 + rock * 0.24 + valyriaInfluence * 0.12),
  });
}

function assetAffinity(asset, geographyClass, sample) {
  if (!asset) return 0;
  const climates = asset.climates ?? [];
  const biomes = asset.biomes ?? [];
  const climate = norm(sample.climate);
  const biome = norm(sample.biome);
  const climateScore = !climate || climates.map(norm).includes(climate) ? 1 : 0.2;
  const biomeScore = !biome || biomes.map(norm).includes(biome) ? 1 : 0.2;
  const familyScore = (asset.families ?? [asset.role]).map(norm).includes(norm(geographyClass)) ? 1 : 0.52;
  const dryBonus = geographyClass === 'outcrop' && climates.some((v) => norm(v) === 'dryland') ? 0.08 : 0;
  return clamp01(climateScore * 0.34 + biomeScore * 0.30 + familyScore * 0.28 + dryBonus);
}

export function geologyResponseAtWorld({ worldX = 0, worldZ = 0, sample = {} } = {}) {
  const valyriaClass = valyriaGeologyClassAtWorldXZ(worldX, worldZ, { heightAboveSeaMeters: finite(sample.heightAboveSeaMeters), slopeDegrees: finite(sample.slopeDegrees) });
  const valyriaInfluence = clamp01(valyriaInfluenceAtWorldXZ(worldX, worldZ));
  const geographyClass = geologyClass({ ...sample, valyriaClass });
  const profile = GEOLOGY_PROFILES[geographyClass] ?? GEOLOGY_PROFILES.plain;
  const exposure = exposureEnvelope(sample, valyriaInfluence);
  const altitude = clamp01((finite(sample.heightAboveSeaMeters) - 8) / 360);
  const wetPenalty = clamp01(finite(sample.moisture) * 0.34);
  const density = clamp01(profile.rock * 0.54 + exposure.rockExposure * 0.28 + exposure.screeExposure * 0.12 + valyriaInfluence * 0.10 - wetPenalty * 0.18);
  const scale = profile.scale * (0.84 + altitude * 0.24) * (1 + valyriaInfluence * 0.22);
  return freeze({
    policyId: TERRAIN_ENVIRONMENT_GEOLOGY_RESPONSE_POLICY.id,
    worldX: finite(worldX),
    worldZ: finite(worldZ),
    geographyClass,
    profile,
    exposure,
    valyriaClass,
    valyriaInfluence,
    density: clamp01(density),
    scale,
    spacingFactor: clamp01(profile.spacing + valyriaInfluence * 0.06),
    surface: freeze({ slopeDegrees: finite(sample.slopeDegrees), localReliefMeters: finite(sample.localReliefMeters), curvatureMeters: finite(sample.curvatureMeters), moisture: clamp01(sample.moisture) }),
  });
}

export function rankGeologyAssetAffinity({ worldX = 0, worldZ = 0, sample = {}, category = 'rock' } = {}) {
  const response = geologyResponseAtWorld({ worldX, worldZ, sample });
  const key = norm(category);
  return freeze(VERIFIED_ROCK_ENVIRONMENT_ASSETS
    .filter((asset) => asset.families.includes(key))
    .map((asset) => freeze({ asset, score: clamp01(assetAffinity(asset, response.geographyClass, sample) * 0.58 + response.density * 0.26 + (key === 'cliff' ? response.exposure.cliffExposure : key === 'scree' ? response.exposure.screeExposure : response.exposure.rockExposure) * 0.16) }))
    .sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id)));
}

export function selectGeologyAssetForWorld({ worldX = 0, worldZ = 0, sample = {}, category = 'rock' } = {}) {
  return rankGeologyAssetAffinity({ worldX, worldZ, sample, category })[0] ?? null;
}

export function geologyPlacementEnvelope({ worldX = 0, worldZ = 0, sample = {}, category = 'rock' } = {}) {
  const response = geologyResponseAtWorld({ worldX, worldZ, sample });
  const selected = selectGeologyAssetForWorld({ worldX, worldZ, sample, category });
  const targetDensity = category === 'cliff' ? response.exposure.cliffExposure : category === 'scree' ? response.exposure.screeExposure : response.exposure.rockExposure;
  return freeze({
    policyId: TERRAIN_ENVIRONMENT_GEOLOGY_RESPONSE_POLICY.id,
    category: norm(category),
    geographyClass: response.geographyClass,
    density: clamp01(response.density * 0.54 + targetDensity * 0.46),
    spacingMeters: 18 + response.spacingFactor * 78,
    scaleMin: Math.max(0.42, response.scale * 0.56),
    scaleMax: response.scale * 1.18,
    preferredAsset: selected?.asset?.id ?? null,
    preferredAssetScore: selected?.score ?? 0,
    valyriaInfluence: response.valyriaInfluence,
  });
}

export function geologyCoverageReport() {
  const categories = TERRAIN_ENVIRONMENT_ROCK_ASSET_POLICY.acceptedCategories;
  const rows = categories.map((category) => freeze({ category, count: VERIFIED_ROCK_ENVIRONMENT_ASSETS.filter((asset) => asset.families.includes(category)).length }));
  const missing = rows.filter((row) => row.count === 0).map((row) => row.category);
  return freeze({ policyId: TERRAIN_ENVIRONMENT_GEOLOGY_RESPONSE_POLICY.id, rows, missing: freeze(missing), ok: missing.length === 0, assetCount: VERIFIED_ROCK_ENVIRONMENT_ASSETS.length });
}

export function geologyResponseManifest(samples = []) {
  const entries = (Array.isArray(samples) ? samples : []).map((sample, index) => freeze({ index, response: geologyResponseAtWorld(sample), envelope: geologyPlacementEnvelope({ ...sample, category: sample.category ?? 'rock' }) }));
  return freeze({ policyId: TERRAIN_ENVIRONMENT_GEOLOGY_RESPONSE_POLICY.id, count: entries.length, entries });
}
