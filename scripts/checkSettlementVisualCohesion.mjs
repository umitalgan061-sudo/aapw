#!/usr/bin/env node
/**
 * Cross-layer visual cohesion audit for the geographic settlement pass.
 *
 * This gate is intentionally static and package-free. It does not render anything itself; the
 * Chromium harness owns runtime/pixel evidence. The goal here is to catch a more subtle failure:
 * every individual subsystem can pass its own contract while the world still looks visually
 * disconnected because terrain, regional architecture, asset materials and placement use different
 * geographic assumptions.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FILES = Object.freeze({
  terrain: path.join(ROOT, 'src/3d/world/terrain.js'),
  biome: path.join(ROOT, 'src/3d/world/terrainBiomeShading.js'),
  villages: path.join(ROOT, 'src/3d/world/villages.js'),
  landmarks: path.join(ROOT, 'src/3d/world/settlementFunctionalLandmarks.js'),
  placement: path.join(ROOT, 'src/3d/world/WorldAssetPlacementPipeline.js'),
  material: path.join(ROOT, 'src/3d/materials/MaterialAssignmentCore.js'),
  vegetation: path.join(ROOT, 'src/3d/world/vegetation.js'),
});

const REGIONS = Object.freeze(['north', 'fertile', 'maritime', 'arid', 'mountain', 'temperate', 'volcanic']);
const ROLES = Object.freeze(['blacksmith', 'barracks', 'farm', 'stable', 'tavern', 'market']);
const TERRAIN_TERMS = Object.freeze([
  'mapDerivedHeight',
  'canonicalWaterClassificationPreserved',
  'currentMapPoint',
  'terrainMapUvAt',
  'CURRENT_TERRAIN_ALBEDO_POLICY',
  'terrainHeightAuthority',
]);
const BIOME_TERMS = Object.freeze([
  'grassMidStartMeters',
  'dryUplandStartMeters',
  'rockSlopeStartDegrees',
  'snowAltitudeStartMeters',
  'forestPatchFrequency',
  'shoreSandTopMeters',
  'northFrozenShoreTundraStrength',
]);
const SURFACE_TOKENS = Object.freeze([
  'stone',
  'brick',
  'wood',
  'door',
  'window',
  'glass',
  'metal',
  'iron',
  'roof',
  'thatch',
  'plaster',
]);

function read(key) {
  const file = FILES[key];
  assert(fs.existsSync(file), `missing source file: ${path.relative(ROOT, file)}`);
  return fs.readFileSync(file, 'utf8');
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

function checkTerrainAuthority() {
  const source = read('terrain');
  for (const term of TERRAIN_TERMS) assert(source.includes(term), `terrain geography authority missing: ${term}`);
  assert(source.includes("legacyProceduralFallback: false"), 'legacy procedural terrain fallback is still enabled');
  assert(source.includes("mapping: 'full-owner-map-global-uv'"), 'terrain albedo is no longer owner-map aligned');
  assert(source.includes("role: 'neutralised-luminance-detail-multiplier'"), 'terrain albedo is not separated from biome hue authority');
  assert(count(source, /function currentMapPoint/g) === 1, 'terrain has multiple map coordinate authorities');
  assert(count(source, /export function createHeightSampler/g) === 1, 'terrain exposes multiple height sampler definitions');
}

function checkBiomeContinuity() {
  const source = read('biome');
  for (const term of BIOME_TERMS) assert(source.includes(term), `terrain biome shading policy missing geographic cue: ${term}`);
  assert(source.includes('GEOGRAPHIC_REFERENCE_PALETTE'), 'terrain hue policy is disconnected from geographic reference palette');
  assert(source.includes('resolveTerrainBiomeColor'), 'biome resolver disappeared');
  assert(source.includes('terrainConcavityMetersFromNeighbours'), 'local relief/concavity signal is not part of the visual surface layer');
  assert(source.includes('resolveTerrainWindSnowAdjustment'), 'wind/snow exposure is not connected to terrain shading');
  assert(source.includes('rockStrataBandMeters'), 'rock strata visual breakup is missing');
  assert(source.includes('forestPatchFrequency'), 'forest patch geographic texture breakup is missing');
}

function checkRegionalArchitecture() {
  const source = read('villages');
  for (const region of REGIONS) {
    assert(new RegExp(`\\b${region}: architectureProfile\\(\\{`).test(source), `missing regional architecture profile: ${region}`);
  }
  assert(source.includes('SEAT_ARCHITECTURE_REGION'), 'seat-to-region architecture resolver is missing');
  assert(source.includes('resolveVillageArchitectureProfile'), 'regional architecture profile cannot be resolved at runtime');
  assert(source.includes('resolveVillageArchitectureSurfacePalette'), 'regional surface material resolver is missing');
  assert(count(source, /layers:\s*\[/g) >= REGIONS.length, 'regional architecture profiles lost their layered material language');
  assert(!/Math\.random\s*\(/.test(source), 'village architecture uses nondeterministic Math.random');
}

function checkFunctionalGeography() {
  const source = read('landmarks');
  for (const region of REGIONS) {
    assert(new RegExp(`\\b${region}: Object\\.freeze\\(\\[`).test(source), `functional role matrix missing region: ${region}`);
  }
  for (const role of ROLES) {
    assert(source.includes(`role: '${role}'`), `functional role missing: ${role}`);
    assert(source.includes(`ROLE_DISTANCE_BIAS`), 'role distance policy is not centralized');
  }
  assert(source.includes('FUNCTIONAL_LANDMARK_MAX_SLOPE_DEGREES'), 'functional terrain slope ceiling missing');
  assert(source.includes('FUNCTIONAL_LANDMARK_MAX_WATER_DEPTH_METERS'), 'functional water exclusion missing');
  assert(source.includes('FUNCTIONAL_LANDMARK_MIN_HOUSE_CLEARANCE_METERS'), 'functional residential clearance missing');
  assert(source.includes('FUNCTIONAL_LANDMARK_MIN_SPACING_METERS'), 'functional inter-landmark spacing missing');
  assert(source.includes('FUNCTIONAL_LANDMARK_ROAD_PREFERENCE_MAX_METERS'), 'road relationship policy missing');
  assert(source.includes('createDeterministicRoll'), 'functional distribution is not deterministic');
  assert(source.includes('assetVersion: FUNCTIONAL_LANDMARK_ASSET_VERSION'), 'functional provenance version missing');
  assert(!/new THREE\.(BoxGeometry|ConeGeometry|CylinderGeometry|SphereGeometry)\b/.test(source), 'functional geography pass is generating decorative primitive stand-ins');
}

function checkMaterialContinuity() {
  const source = read('material');
  assert(source.includes('ensureDeterministicMaterialUVs'), 'UV fallback for imported models is missing');
  assert(source.includes("strategy: 'deterministic-local-box'"), 'UV fallback strategy is not provenance-tagged');
  assert(source.includes('fallbackPaletteId || recipe.basePaletteId'), 'surface recipes can still leave unmatched imported surfaces untextured');
  assert(source.includes('fallbackSurfaces'), 'surface fallback coverage is not reported');
  assert(source.includes('generatedUVCount'), 'generated UV evidence is missing from material manifests');
  assert(source.includes('deleteAttribute?.(\'uv\')'), 'runtime-generated UV cleanup is missing on restore');
  for (const token of SURFACE_TOKENS) assert(source.includes(token), `shared material core no longer recognizes surface token: ${token}`);
}

function checkPlacementContinuity() {
  const source = read('placement');
  assert(source.includes("settlement: Object.freeze({ maxSlopeDegrees: 12, maxWaterDepth: 0.02, minRoadDistance: 0 })"), 'settlement placement preset drifted from grounded geography policy');
  assert(source.includes('footprintGrounding'), 'placement core is not footprint aware');
  assert(source.includes('foundationInsetMeters'), 'foundation inset policy disappeared');
  assert(source.includes('createMaterialManifest'), 'placement manifest no longer links visual material to world placement');
  assert(source.includes('worldPlacementFootprint'), 'grounded footprint evidence disappeared');
  assert(source.includes('createDisconnectedFoundationIslandProbes'), 'disconnected foundation islands are not sampled');
}

function checkVegetationBridge() {
  const source = read('vegetation');
  assert(source.includes('isPlaceablePosition'), 'vegetation placement gate disappeared');
  assert(source.includes('maxSlope') || source.includes('maxSlopeDegrees'), 'vegetation slope constraint disappeared');
  assert(source.includes('water') || source.includes('Water'), 'vegetation water awareness disappeared');
}

function checkCrossLayerBindings() {
  const villages = read('villages');
  const landmarks = read('landmarks');
  const material = read('material');
  const placement = read('placement');

  assert(villages.includes("./settlementFunctionalLandmarks.js"), 'villages do not consume functional settlement layer');
  assert(landmarks.includes("'./WorldAssetPlacementPipeline.js'"), 'functional landmarks bypass world placement');
  assert(landmarks.includes("'../materials/MaterialAssignmentCore.js'"), 'functional landmarks bypass shared material core');
  assert(placement.includes("'../materials/MaterialAssignmentCore.js'"), 'placement core bypasses shared material core');
  assert(material.includes("'./palettes.js'"), 'material core bypasses shared geographic palette library');

  const authoredAssetCount = count(landmarks, /assets\/models\/(?:settlements|fbx)\//g);
  assert(authoredAssetCount >= 10, `functional visual layer exposes too few authored source paths: ${authoredAssetCount}`);

  const regionProfileCount = count(villages, /architectureProfile\(\{/g);
  assert(regionProfileCount >= REGIONS.length, `architecture profile count drifted: ${regionProfileCount}`);

  const manifestLinks = count(landmarks, /manifest/g) + count(placement, /worldPlacementManifest/g) + count(material, /createMaterialManifest/g);
  assert(manifestLinks >= 6, 'cross-layer visual evidence chain is too thin');
}

function main() {
  checkTerrainAuthority();
  checkBiomeContinuity();
  checkRegionalArchitecture();
  checkFunctionalGeography();
  checkMaterialContinuity();
  checkPlacementContinuity();
  checkVegetationBridge();
  checkCrossLayerBindings();

  console.log(JSON.stringify({
    ok: true,
    regions: REGIONS.length,
    functionalRoles: ROLES.length,
    terrainSignals: TERRAIN_TERMS.length,
    biomeSignals: BIOME_TERMS.length,
    materialSurfaceTokens: SURFACE_TOKENS.length,
    verdict: 'terrain-architecture-assets-placement-share-one-geographic-contract',
  }, null, 2));
  console.log('[checkSettlementVisualCohesion] PASS');
}

try {
  main();
} catch (error) {
  console.error('[checkSettlementVisualCohesion] FAIL');
  console.error(error?.stack || error);
  process.exitCode = 1;
}
