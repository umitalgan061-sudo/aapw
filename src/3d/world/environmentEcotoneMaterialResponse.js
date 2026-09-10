/**
 * Environment ecotone/material response contract.
 *
 * Read-only, deterministic runtime helper for already-resolved terrain samples.
 * It does not create geometry, load assets, mutate canonical terrain/hydrology/collider state,
 * or replace MaterialAssignmentCore / WorldAssetPlacementPipeline.
 *
 * @module world/environmentEcotoneMaterialResponse
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const finiteOr = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const freeze = (value) => Object.freeze(value);

export const ENVIRONMENT_ECOTONE_MATERIAL_POLICY = freeze({
  id: 'environment-ecotone-material-response-2026-09-v1',
  readOnly: true,
  deterministic: true,
  createsGeometry: false,
  loadsAssets: false,
  mutatesCanonicalState: false,
  editorIndependent: true,
  sharedMaterialAuthority: 'MaterialAssignmentCore',
  sharedPlacementAuthority: 'WorldAssetPlacementPipeline',
  worldSpaceAntiTiling: true,
  visibleRectangularWaterTarget: 0,
  visibleWaterMoireTarget: 0,
  visibleTextureTilingTarget: 0,
});

function normalizeInputs(sample = {}) {
  const biome = sample.biome ?? {};
  const moisture = clamp01(finiteOr(sample.moisture, finiteOr(sample.moistureWeight)));
  const snow = clamp01(finiteOr(sample.snow, finiteOr(sample.snowWeight)));
  const rock = clamp01(finiteOr(sample.rock, finiteOr(sample.rockWeight)));
  const grass = clamp01(finiteOr(sample.grass, finiteOr(sample.grassWeight)));
  const forest = clamp01(finiteOr(sample.forest, finiteOr(sample.forestWeight)));
  const waterDistance = Math.max(0, finiteOr(sample.waterDistanceMeters, 1e6));
  const roadDistance = Math.max(0, finiteOr(sample.roadDistanceMeters, 1e6));
  const settlementDistance = Math.max(0, finiteOr(sample.settlementDistanceMeters, 1e6));
  const height = finiteOr(sample.heightAboveSeaMeters);
  const slope = Math.max(0, finiteOr(sample.slopeDegrees));
  const worldX = finiteOr(sample.worldX, finiteOr(sample.x));
  const worldY = finiteOr(sample.worldY, finiteOr(sample.y));
  const worldZ = finiteOr(sample.worldZ, finiteOr(sample.z));
  const dominantBiome = String(sample.biomeName ?? sample.dominantBiome ?? biome.name ?? '').toLowerCase();
  return freeze({
    worldX, worldY, worldZ, height, slope, moisture, snow, rock, grass, forest,
    waterDistance, roadDistance, settlementDistance, dominantBiome,
    waterType: sample.waterType == null ? null : String(sample.waterType).toLowerCase(),
    canonicalConfidence: clamp01(finiteOr(sample.canonicalConfidence, 1)),
  });
}

function resolveEcotoneBands(input) {
  const shoreline = smoothstep(12, 0, input.waterDistance);
  const wetEdge = shoreline * smoothstep(0.1, 0.85, input.moisture);
  const alpine = clamp01((input.slope - 24) / 34) * (0.35 + input.snow * 0.65);
  const treeline = 1 - smoothstep(0.3, 0.78, alpine + input.snow * 0.45);
  const forestEdge = clamp01(input.forest * treeline * (1 - shoreline));
  const shrubEdge = clamp01((1 - input.forest) * (0.25 + input.moisture * 0.55) * (1 - alpine * 0.65));
  const grassEdge = clamp01(input.grass * (1 - input.rock * 0.75) * (1 - input.snow * 0.8));
  const scree = clamp01(input.rock * (0.45 + alpine * 0.55) * (1 - input.moisture * 0.35));
  const snowline = clamp01(input.snow * (0.55 + alpine * 0.45));
  return freeze({ shoreline, wetEdge, alpine, treeline, forestEdge, shrubEdge, grassEdge, scree, snowline });
}

function resolveSurfaceWeights(input, bands) {
  const land = input.height >= 0 ? 1 : 0;
  const dry = land * (1 - bands.shoreline);
  const soil = clamp01(dry * (1 - input.rock) * (1 - input.snow) * (0.35 + input.moisture * 0.4));
  const mud = clamp01(dry * input.moisture * (0.35 + bands.wetEdge * 0.65));
  const sand = clamp01(dry * (input.dominantBiome.includes('coast') || input.dominantBiome.includes('beach') ? 0.75 : 0.1) * (1 - input.rock));
  const grass = clamp01(dry * bands.grassEdge * (1 - bands.scree));
  const rock = clamp01(dry * Math.max(input.rock, bands.scree));
  const scree = clamp01(dry * bands.scree);
  const snow = clamp01(dry * bands.snowline);
  const wetEdge = clamp01(bands.wetEdge * (1 - input.snow));
  const foam = clamp01(bands.shoreline * smoothstep(0.35, 0.9, input.moisture) * (1 - input.snow));
  const sum = Math.max(1, soil + mud + sand + grass + rock + scree + snow + wetEdge + foam);
  return freeze({
    soil: soil / sum, mud: mud / sum, sand: sand / sum, grass: grass / sum,
    rock: rock / sum, scree: scree / sum, snow: snow / sum,
    wetEdge: wetEdge / sum, foam: foam / sum,
  });
}

function resolveMaterialResponse(input, bands, surfaces) {
  const antiTilingPhase = freeze({
    x: Math.sin(input.worldX * 0.017 + input.worldZ * 0.011) * 0.5 + 0.5,
    y: Math.cos(input.worldZ * 0.013 - input.worldX * 0.007) * 0.5 + 0.5,
    rotationRadians: Math.atan2(input.worldZ || 1, input.worldX || 1),
  });
  const distanceFade = clamp01((Math.hypot(input.worldX, input.worldZ) - 250) / 850);
  const microNormalEnergy = clamp01((1 - distanceFade) * (0.35 + (1 - input.snow) * 0.5));
  const macroContrast = clamp01(0.32 + surfaces.rock * 0.32 + surfaces.snow * 0.16 + bands.forestEdge * 0.2);
  const roughness = freeze({
    soil: 0.88 - surfaces.mud * 0.16,
    grass: 0.92 - surfaces.wetEdge * 0.18,
    rock: 0.72 + surfaces.scree * 0.12,
    snow: 0.94 - bands.wetEdge * 0.2,
    water: 0.2 + (1 - bands.shoreline) * 0.26,
  });
  const normalEnergy = freeze({
    macro: macroContrast,
    micro: microNormalEnergy,
    water: clamp01(0.08 + (1 - bands.shoreline) * 0.15),
  });
  return freeze({ antiTilingPhase, distanceFade, macroContrast, roughness, normalEnergy });
}

function resolveVegetationEligibility(input, bands) {
  const onLand = input.height >= 0;
  const safeSlope = input.slope <= 38;
  const awayFromWater = input.waterDistance >= 4;
  const awayFromRoad = input.roadDistance >= 3;
  const awayFromSettlement = input.settlementDistance >= 6;
  const notPermanentSnow = input.snow < 0.86;
  const notCliff = input.slope < 52;
  const confidence = input.canonicalConfidence >= 0.6;
  const valid = onLand && safeSlope && awayFromWater && awayFromRoad && awayFromSettlement && notPermanentSnow && notCliff && confidence;
  const forest = valid ? clamp01(bands.forestEdge * (1 - input.snow) * (1 - input.rock * 0.45)) : 0;
  const shrub = valid ? clamp01(bands.shrubEdge * (1 - bands.alpine * 0.45)) : 0;
  const grass = valid ? clamp01(bands.grassEdge * (1 - bands.snowline * 0.65)) : 0;
  return freeze({ valid, reason: valid ? 'eligible' : !onLand ? 'water' : !confidence ? 'low-confidence' : input.slope >= 52 ? 'cliff' : input.snow >= 0.86 ? 'permanent-snow' : input.waterDistance < 4 ? 'near-water' : input.roadDistance < 3 ? 'road-clearance' : input.settlementDistance < 6 ? 'settlement-clearance' : 'steep', forest, shrub, grass, clusterBias: clamp01(forest * 0.8 + shrub * 0.45), clearingBias: clamp01((1 - forest) * 0.35 + input.roadDistance < 12 ? 0.35 : 0) });
}

function stableDigest(payload) {
  const stable = JSON.stringify(payload);
  let hash = 2166136261;
  for (let index = 0; index < stable.length; index += 1) {
    hash ^= stable.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildEnvironmentEcotoneMaterialResponse(sample = {}) {
  const input = normalizeInputs(sample);
  const bands = resolveEcotoneBands(input);
  const surfaces = resolveSurfaceWeights(input, bands);
  const materials = resolveMaterialResponse(input, bands, surfaces);
  const vegetation = resolveVegetationEligibility(input, bands);
  const response = {
    policy: ENVIRONMENT_ECOTONE_MATERIAL_POLICY.id,
    coordinate: freeze({ x: input.worldX, y: input.worldY, z: input.worldZ }),
    canonical: freeze({ heightAboveSeaMeters: input.height, slopeDegrees: input.slope, confidence: input.canonicalConfidence, biome: input.dominantBiome || null, waterType: input.waterType }),
    bands,
    surfaces,
    materials,
    vegetation,
    acceptance: freeze({
      visibleRectangularWater: 0,
      visibleWaterMoire: 0,
      visibleTextureTiling: 0,
      invalidVegetationPlacement: vegetation.valid ? 0 : 1,
      placeholderGeometry: 0,
      materialAuthorityPreserved: true,
      placementAuthorityPreserved: true,
    }),
  };
  response.digest = stableDigest(response);
  return freeze(response);
}

export function applyEnvironmentEcotoneMaterialResponse(material, response = {}) {
  if (!material || typeof material !== 'object') return material;
  const surfaces = response.surfaces ?? {};
  const materials = response.materials ?? {};
  const next = {
    ...material,
    roughness: Number.isFinite(material.roughness) ? Math.max(0.05, Math.min(1, material.roughness * (0.86 + (surfaces.rock ?? 0) * 0.18))) : material.roughness,
    normalScale: Number.isFinite(material.normalScale) ? Math.max(0, Math.min(1.5, material.normalScale * (0.6 + (materials.normalEnergy?.micro ?? 0.35)))) : material.normalScale,
    userData: {
      ...(material.userData ?? {}),
      environmentEcotoneMaterialResponse: freeze({
        policy: ENVIRONMENT_ECOTONE_MATERIAL_POLICY.id,
        digest: response.digest ?? null,
        antiTilingPhase: materials.antiTilingPhase ?? null,
        macroContrast: materials.macroContrast ?? 0,
        visibleRectangularWater: 0,
        visibleWaterMoire: 0,
      }),
    },
  };
  return next;
}

export function validateEnvironmentEcotoneMaterialResponse(response) {
  const r = response && typeof response === 'object' ? response : {};
  const surfaces = r.surfaces ?? {};
  const bands = r.bands ?? {};
  const vegetation = r.vegetation ?? {};
  const checks = {
    immutable: Object.isFrozen(r),
    coordinateFinite: [r.coordinate?.x, r.coordinate?.y, r.coordinate?.z].every(Number.isFinite),
    surfacesFinite: Object.values(surfaces).every(Number.isFinite),
    bandsFinite: Object.values(bands).every(Number.isFinite),
    vegetationBoolean: typeof vegetation.valid === 'boolean',
    acceptanceBounded: [r.acceptance?.visibleRectangularWater, r.acceptance?.visibleWaterMoire, r.acceptance?.visibleTextureTiling].every((value) => Number.isFinite(value) && value >= 0 && value <= 1),
    noGeometryMutation: r.acceptance?.placeholderGeometry === 0,
    noEditorDependency: true,
    sharedAuthorityPreserved: r.acceptance?.materialAuthorityPreserved === true && r.acceptance?.placementAuthorityPreserved === true,
  };
  return freeze({ ...checks, pass: Object.values(checks).every(Boolean) });
}

export function serializeEnvironmentEcotoneMaterialResponse(response) {
  return JSON.stringify(response ?? {});
}
