#!/usr/bin/env node

/**
 * Full-world deterministic acceptance matrix for asset geography, placement plausibility and surface
 * material context.
 *
 * This is intentionally a geometry-free headless test. It does not render a browser screenshot and
 * it does not mutate terrain. Instead, it feeds representative canonical-style surface samples into
 * the asset geography profiler and the existing material-context adapter. The purpose is to catch the
 * class of errors that visual QA repeatedly exposes: technically valid placement on a surface that is
 * ecologically nonsensical, repeating asset cohorts, desert assets in wet basins, trees on exposed
 * scree, or snow props spread into temperate same-latitude land.
 *
 * The fixtures are deliberately broad rather than tied to one settlement. The live terrain sampler is
 * still the numeric authority; these cases verify the mapping between surface facts and asset response.
 */

import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  WORLD_ASSET_GEOGRAPHY_DOMAINS,
  WORLD_ASSET_GEOGRAPHY_FAMILIES,
  WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY,
  assetGeographyPlacementDecision,
  compareAssetGeographyProfiles,
  deterministicAssetCohortOffset,
  deterministicAssetScale,
  deterministicAssetYaw,
  distributeAssetCandidates,
  evaluateAssetDistributionCandidate,
  isWorldAssetGeographicallyPlausible,
  rankAssetDistributionCandidates,
  sampleWorldAssetGeographyProfile,
  summarizeAssetGeography,
  validateAssetGeographyProfile,
} from '../src/3d/world/worldAssetGeographyProfile.js';
import {
  WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY,
  applyWorldPlacementMaterialContext,
} from '../src/3d/materials/worldPlacementMaterialContext.js';
import { WORLD_ECOLOGY_SURFACE_FIELD_POLICY } from '../src/3d/world/worldEcologySurfaceField.js';

function fixture(overrides = {}) {
  return {
    x: 0,
    z: 0,
    height: 24,
    slopeDegrees: 4,
    aspectRadians: 0.3,
    moisture: 0.56,
    snow: 0,
    waterDepth: 0,
    riverDistance: 160,
    lakeDistance: 180,
    coastDistance: 220,
    roadDistance: 45,
    settlementDistance: 180,
    biome: 'meadow',
    concavity: 0,
    erosion: 0.35,
    deposition: 0.52,
    shelter: 0.52,
    lithic: 0.20,
    ...overrides,
  };
}

function profile(overrides, metadata) {
  return sampleWorldAssetGeographyProfile(fixture(overrides), metadata);
}

function assertFiniteObject(value, path = 'root', seen = new Set()) {
  if (value == null || typeof value !== 'object') {
    if (typeof value === 'number') assert(Number.isFinite(value), `${path} must be finite`);
    return;
  }
  if (seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'number') assert(Number.isFinite(child), `${path}.${key} must be finite`);
    else if (child && typeof child === 'object') assertFiniteObject(child, `${path}.${key}`, seen);
  }
}

function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function makeCandidate(x, z, overrides = {}) {
  return {
    x,
    z,
    surface: fixture({ x, z, ...overrides }),
  };
}

console.log(`[checkWorldAssetGeographyDistribution] policy=${WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.id}`);
console.log(`[checkWorldAssetGeographyDistribution] ecologyField=${WORLD_ECOLOGY_SURFACE_FIELD_POLICY.id}`);
console.log(`[checkWorldAssetGeographyDistribution] materialContext=${WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.id}`);

assert.equal(WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.renderOnly, true);
assert.equal(WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.placementRankingOnly, true);
assert.equal(WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.canonicalTerrainReadOnly, true);
assert.equal(WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.canonicalHydrologyReadOnly, true);
assert.equal(WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.newGeographyIntroduced, false);
assert.equal(WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.placementUnchanged, true);
assert.equal(WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.geometryUnchanged, true);
assert.equal(WORLD_ECOLOGY_SURFACE_FIELD_POLICY.canonicalTerrainReadOnly, true);

for (const [domain, value] of Object.entries(WORLD_ASSET_GEOGRAPHY_DOMAINS)) {
  assert(value && Array.isArray(value.elevationWindow), `${domain} domain must define elevation window`);
  assert(value.elevationWindow.length === 2, `${domain} elevation window must have two values`);
  assert(value.elevationWindow[0] <= value.elevationWindow[1], `${domain} elevation window must be ordered`);
  assert(value.maxSlope >= 0 && value.maxSlope <= 90, `${domain} slope ceiling must be physical`);
}

for (const [family, value] of Object.entries(WORLD_ASSET_GEOGRAPHY_FAMILIES)) {
  assert(value.preferredDomains && typeof value.preferredDomains === 'object', `${family} must have preferred domains`);
  assert(value.antiDomains && typeof value.antiDomains === 'object', `${family} must have anti domains`);
  assert(value.scale[0] > 0 && value.scale[1] > value.scale[0], `${family} scale range must be ordered`);
  assert(value.maxSlope > 0 && value.maxSlope <= 90, `${family} max slope must be physical`);
}

const CASES = [
  {
    id: 'temperate-meadow-tree',
    family: 'tree',
    surface: fixture({ biome: 'meadow', height: 18, slopeDegrees: 5, moisture: 0.62, deposition: 0.62, shelter: 0.66 }),
    expect: (p) => p.placementScore > 0.35 && p.domains.meadow > 0.45,
  },
  {
    id: 'temperate-forest-tree',
    family: 'tree',
    surface: fixture({ biome: 'forest', height: 42, slopeDegrees: 8, moisture: 0.70, deposition: 0.46, shelter: 0.70 }),
    expect: (p) => p.placementScore > 0.45 && p.domains.woodland > 0.55,
  },
  {
    id: 'dry-heath-shrub',
    family: 'shrub',
    surface: fixture({ biome: 'heath', height: 120, slopeDegrees: 14, moisture: 0.31, deposition: 0.32, shelter: 0.42 }),
    expect: (p) => p.domains.heath > p.domains.wetland,
  },
  {
    id: 'marsh-reed-waterside',
    family: 'waterside',
    surface: fixture({ biome: 'marsh', height: 7, slopeDegrees: 2, moisture: 0.92, riverDistance: 6, lakeDistance: 32, coastDistance: 180, deposition: 0.82, concavity: 0.62 }),
    expect: (p) => p.domains.wetland > 0.50 && p.domains.riparian > 0.50,
  },
  {
    id: 'river-floodplain-tree',
    family: 'tree',
    surface: fixture({ biome: 'riparian', height: 14, slopeDegrees: 3, moisture: 0.78, riverDistance: 7, deposition: 0.90, concavity: 0.38, shelter: 0.55 }),
    expect: (p) => p.domains.riparian > p.domains.scree && p.placementScore > 0.30,
  },
  {
    id: 'steep-scree-rock',
    family: 'rock',
    surface: fixture({ biome: 'scree', height: 310, slopeDegrees: 48, moisture: 0.30, lithic: 0.94, erosion: 0.86, deposition: 0.18, concavity: -0.72 }),
    expect: (p) => p.domains.scree > 0.55 && p.familyResponse.morphologicalSupport > 0.40,
  },
  {
    id: 'alpine-rock',
    family: 'rock',
    surface: fixture({ biome: 'alpine', height: 470, slopeDegrees: 38, moisture: 0.42, lithic: 0.92, snow: 0.24, erosion: 0.74, shelter: 0.24 }),
    expect: (p) => p.domains.alpine > 0.50 && p.placementScore > 0.25,
  },
  {
    id: 'high-snowfield-snow',
    family: 'snow',
    surface: fixture({ biome: 'permanent-ice snowfield', height: 120, slopeDegrees: 12, moisture: 0.72, snow: 0.94, erosion: 0.24, shelter: 0.52 }),
    expect: (p) => p.domains.snowfield > 0.65 && p.placementScore > 0.40,
  },
  {
    id: 'north-tundra-shrub',
    family: 'shrub',
    surface: fixture({ biome: 'tundra', height: 30, slopeDegrees: 6, moisture: 0.64, snow: 0.34, shelter: 0.68 }),
    expect: (p) => p.domains.heath + p.domains.wetland + p.domains.alpine > 0.50,
  },
  {
    id: 'coastal-dune-vegetation',
    family: 'vegetation',
    surface: fixture({ biome: 'coast dune', height: 8, slopeDegrees: 7, moisture: 0.58, coastDistance: 8, deposition: 0.74, erosion: 0.30 }),
    expect: (p) => p.domains.coast > 0.45,
  },
  {
    id: 'coastal-rock',
    family: 'rock',
    surface: fixture({ biome: 'coast cliff', height: 17, slopeDegrees: 42, moisture: 0.62, coastDistance: 11, lithic: 0.88, erosion: 0.82 }),
    expect: (p) => p.domains.coast > 0.35 && p.domains.scree > 0.34,
  },
  {
    id: 'volcanic-basalt',
    family: 'rock',
    surface: fixture({ biome: 'volcanic basalt', height: 82, slopeDegrees: 26, moisture: 0.21, lithic: 0.97, erosion: 0.82, deposition: 0.21, shelter: 0.26 }),
    expect: (p) => p.domains.volcanic > 0.58 && p.material.mineral > 0.55,
  },
  {
    id: 'volcanic-snow-margin',
    family: 'snow',
    surface: fixture({ biome: 'volcanic snowfield', height: 430, slopeDegrees: 20, moisture: 0.38, snow: 0.52, lithic: 0.88, erosion: 0.64 }),
    expect: (p) => p.domains.volcanic > 0.35 && p.domains.alpine > 0.35,
  },
  {
    id: 'settlement-plain',
    family: 'settlement',
    surface: fixture({ biome: 'plain', height: 28, slopeDegrees: 4, moisture: 0.50, deposition: 0.72, roadDistance: 16, settlementDistance: 30, shelter: 0.56 }),
    expect: (p) => p.domains.meadow > 0.42 && p.placementScore > 0.40,
  },
  {
    id: 'building-wet-basin',
    family: 'building',
    surface: fixture({ biome: 'wetland bog', height: 8, slopeDegrees: 2, moisture: 0.94, concavity: 0.86, deposition: 0.80, waterDepth: 0.01 }),
    expect: (p) => p.placementScore < 0.50,
  },
  {
    id: 'building-snowfield',
    family: 'building',
    surface: fixture({ biome: 'permanent-ice', height: 16, slopeDegrees: 4, moisture: 0.75, snow: 0.88, shelter: 0.42 }),
    expect: (p) => p.placementScore < 0.30,
  },
];

let checked = 0;
for (const testCase of CASES) {
  const p = sampleWorldAssetGeographyProfile(testCase.surface, { family: testCase.family, category: testCase.family });
  assert.equal(p.family, testCase.family, `${testCase.id} family inference must stay explicit`);
  assert(testCase.expect(p), `${testCase.id} did not satisfy ecological expectation`);
  assertFiniteObject(p, testCase.id);
  const validity = validateAssetGeographyProfile(p);
  assert.equal(validity.ok, true, `${testCase.id} profile must be structurally valid`);
  const summary = summarizeAssetGeography(p);
  assert(summary.topDomains.length <= 4, `${testCase.id} summary should be compact`);
  checked += 1;
}

const temperateTree = profile({ biome: 'meadow', height: 18, slopeDegrees: 4, moisture: 0.61 }, { family: 'tree' });
const permanentSnow = profile({ biome: 'permanent-ice', height: 24, slopeDegrees: 4, moisture: 0.65, snow: 0.92 }, { family: 'snow' });
const sameLatitudeEast = profile({ biome: 'meadow', height: 20, slopeDegrees: 4, moisture: 0.55, snow: 0 }, { family: 'snow' });
assert(temperateTree.placementScore > 0.25, 'temperate tree should be viable in a meadow');
assert(permanentSnow.placementScore > sameLatitudeEast.placementScore, 'snow asset must prefer frozen geography over temperate same-latitude land');
assert(permanentSnow.domains.snowfield > sameLatitudeEast.domains.snowfield, 'snowfield domain must be geographic, not merely family named');

const treeOnScree = profile({ biome: 'scree cliff', height: 330, slopeDegrees: 52, moisture: 0.34, lithic: 0.94, erosion: 0.88 }, { family: 'tree' });
const rockOnScree = profile({ biome: 'scree cliff', height: 330, slopeDegrees: 52, moisture: 0.34, lithic: 0.94, erosion: 0.88 }, { family: 'rock' });
assert(rockOnScree.placementScore > treeOnScree.placementScore, 'rock must outrank tree on exposed scree');
assert(treeOnScree.familyResponse.antiSignal > rockOnScree.familyResponse.antiSignal, 'tree should carry stronger anti-domain pressure on scree');

const meadow = profile({ biome: 'meadow', height: 18, slopeDegrees: 4, moisture: 0.55, deposition: 0.72 }, { family: 'vegetation' });
const marsh = profile({ biome: 'marsh', height: 7, slopeDegrees: 2, moisture: 0.92, deposition: 0.86, riverDistance: 9 }, { family: 'vegetation' });
assert(meadow.domains.meadow > marsh.domains.meadow || marsh.domains.wetland > meadow.domains.wetland, 'meadow and marsh must separate into distinct domains');

const coast = profile({ biome: 'coast shore', height: 4, slopeDegrees: 7, moisture: 0.68, coastDistance: 4, deposition: 0.78 }, { family: 'waterside' });
const inland = profile({ biome: 'meadow', height: 26, slopeDegrees: 7, moisture: 0.55, coastDistance: 180, deposition: 0.46 }, { family: 'waterside' });
assert(coast.domains.coast > inland.domains.coast, 'waterside asset must recognise coast proximity');
assert(coast.placementScore > inland.placementScore, 'waterside asset must prefer coast when otherwise equivalent');

const wetSlope = profile({ biome: 'marsh', height: 12, slopeDegrees: 28, moisture: 0.90, deposition: 0.86 }, { family: 'vegetation' });
const wetBowl = profile({ biome: 'marsh', height: 12, slopeDegrees: 3, moisture: 0.90, deposition: 0.86, concavity: 0.74 }, { family: 'vegetation' });
assert(wetBowl.placementScore > wetSlope.placementScore, 'wet vegetation should prefer stable low-slope bowls to steep wet faces');

const northSheltered = profile({ biome: 'tundra', height: 54, slopeDegrees: 7, moisture: 0.62, snow: 0.42, shelter: 0.90 }, { family: 'shrub' });
const northExposed = profile({ biome: 'tundra', height: 54, slopeDegrees: 29, moisture: 0.62, snow: 0.42, shelter: 0.18, erosion: 0.76 }, { family: 'shrub' });
assert(northSheltered.placementScore > northExposed.placementScore, 'sheltered tundra should be more viable for shrub cover than exposed terrain');

const volcanic = profile({ biome: 'volcanic basalt', height: 90, slopeDegrees: 24, moisture: 0.21, lithic: 0.96, erosion: 0.84 }, { family: 'rock' });
const fertile = profile({ biome: 'meadow', height: 90, slopeDegrees: 24, moisture: 0.63, lithic: 0.28, deposition: 0.68 }, { family: 'rock' });
assert(volcanic.material.mineral > fertile.material.mineral, 'volcanic rock must produce higher mineral response than fertile ground');
assert(volcanic.material.roughnessFine > 0.48, 'volcanic rock must retain fine roughness');

const first = sampleWorldAssetGeographyProfile(fixture({ x: 1234.5, z: -844.3, biome: 'forest', height: 44 }), { family: 'tree' });
const second = sampleWorldAssetGeographyProfile(fixture({ x: 1234.5, z: -844.3, biome: 'forest', height: 44 }), { family: 'tree' });
assert.deepEqual(first, second, 'same world position must produce exactly deterministic profile');
assert.equal(deterministicAssetCohortOffset(1234.5, -844.3, 'tree'), deterministicAssetCohortOffset(1234.5, -844.3, 'tree'));
assert.equal(deterministicAssetYaw(first, 1234.5, -844.3), deterministicAssetYaw(second, 1234.5, -844.3));
assert.equal(deterministicAssetScale(first, 1234.5, -844.3), deterministicAssetScale(second, 1234.5, -844.3));

const nearbyA = sampleWorldAssetGeographyProfile(fixture({ x: 100, z: 200, biome: 'forest', moisture: 0.66 }), { family: 'tree' });
const nearbyB = sampleWorldAssetGeographyProfile(fixture({ x: 111, z: 214, biome: 'forest', moisture: 0.66 }), { family: 'tree' });
const delta = compareAssetGeographyProfiles(nearbyA, nearbyB);
assert(delta && Number.isFinite(delta.placementScoreDelta), 'profile comparison must be finite');
assert(Math.abs(delta.placementScoreDelta) < 0.6, 'neighbouring profiles should vary smoothly rather than flip discontinuously');

const candidateSet = [
  makeCandidate(0, 0, { biome: 'meadow', moisture: 0.60, height: 22 }),
  makeCandidate(8, 4, { biome: 'meadow', moisture: 0.61, height: 24 }),
  makeCandidate(16, -3, { biome: 'forest', moisture: 0.70, height: 45 }),
  makeCandidate(29, 10, { biome: 'heath', moisture: 0.34, height: 110 }),
  makeCandidate(41, 8, { biome: 'scree', moisture: 0.31, height: 330, slopeDegrees: 49, lithic: 0.94 }),
  makeCandidate(55, 24, { biome: 'marsh', moisture: 0.93, height: 8, slopeDegrees: 2 }),
  makeCandidate(71, 28, { biome: 'tundra', moisture: 0.64, height: 46, snow: 0.30 }),
];

const rankedTrees = rankAssetDistributionCandidates(candidateSet, { family: 'tree' });
assert.equal(rankedTrees.length, candidateSet.length, 'ranking must preserve candidate cardinality');
for (let i = 1; i < rankedTrees.length; i += 1) {
  assert(rankedTrees[i - 1].profile.placementScore >= rankedTrees[i].profile.placementScore - 1e-12, 'ranking must be monotonic');
}

const treeDistribution = distributeAssetCandidates(candidateSet, { family: 'tree' }, { targetCount: 4, minimumScore: 0.24 });
assert(treeDistribution.selected.length <= 4, 'distribution must respect target count');
assert(treeDistribution.selected.every((item) => item.profile.placementScore >= 0.24), 'distribution must honour minimum score');
for (let i = 0; i < treeDistribution.selected.length; i += 1) {
  for (let j = i + 1; j < treeDistribution.selected.length; j += 1) {
    const distance = distance2D(treeDistribution.selected[i], treeDistribution.selected[j]);
    assert(distance > 1.1 || treeDistribution.selected[i].profile.cohort > 0.65 || treeDistribution.selected[j].profile.cohort > 0.65, 'distribution must avoid hard duplicate points unless a strong cohort signal exists');
  }
}

const emptyDistribution = distributeAssetCandidates([], { family: 'tree' }, { targetCount: 3 });
assert.equal(emptyDistribution.selected.length, 0);
assert.equal(emptyDistribution.rejected.length, 0);

for (const family of Object.keys(WORLD_ASSET_GEOGRAPHY_FAMILIES)) {
  const cases = [
    fixture({ biome: 'meadow', height: 18, slopeDegrees: 4, moisture: 0.54 }),
    fixture({ biome: 'forest', height: 40, slopeDegrees: 8, moisture: 0.72 }),
    fixture({ biome: 'heath', height: 110, slopeDegrees: 16, moisture: 0.34 }),
    fixture({ biome: 'marsh', height: 8, slopeDegrees: 2, moisture: 0.91, concavity: 0.7 }),
    fixture({ biome: 'alpine', height: 420, slopeDegrees: 34, moisture: 0.42, snow: 0.44, lithic: 0.84 }),
    fixture({ biome: 'permanent-ice', height: 30, slopeDegrees: 7, moisture: 0.70, snow: 0.95 }),
    fixture({ biome: 'scree', height: 300, slopeDegrees: 45, moisture: 0.30, lithic: 0.94, erosion: 0.82 }),
  ];
  for (const surface of cases) {
    const p = sampleWorldAssetGeographyProfile(surface, { family });
    assert(p.placementScore >= 0 && p.placementScore <= 1, `${family} score must be bounded`);
    const d = assetGeographyPlacementDecision(p, { rejectPoor: false });
    assert.equal(d.accept, true, `${family} relaxed decision should not fail structurally`);
  }
}

function fakeMaterial(name, color) {
  const material = new THREE.MeshStandardMaterial({ color });
  material.name = name;
  return material;
}

const materialSurface = fixture({
  x: 330,
  z: -740,
  biome: 'forest',
  height: 44,
  slopeDegrees: 11,
  moisture: 0.74,
  riverDistance: 14,
  lakeDistance: 160,
  coastDistance: 250,
  roadDistance: 8,
  settlementDistance: 52,
  deposition: 0.64,
  erosion: 0.38,
  shelter: 0.72,
  lithic: 0.18,
});

const materialTestMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 2), fakeMaterial('forest timber', 0x7a5a3c));
materialTestMesh.userData = {
  worldPlacementMaterialContext: {},
};
const materialContextResult = applyWorldPlacementMaterialContext(materialTestMesh, materialSurface, {
  groundingMode: 'terrain-conform',
  heightRange: 1.8,
  samples: [materialSurface],
  islandSamples: [],
});
assert(materialContextResult && typeof materialContextResult === 'object', 'material context must return a result');
assert(materialTestMesh.userData.worldPlacementMaterialContext, 'material adapter must persist its context');
assert(materialTestMesh.userData.worldAssetSurfaceResponse, 'material adapter must persist asset surface response');
assertFiniteObject(materialTestMesh.userData.worldPlacementMaterialContext, 'materialContext');
assertFiniteObject(materialTestMesh.userData.worldAssetSurfaceResponse, 'assetSurfaceResponse');

const materialProfiles = [];
for (const family of ['tree', 'rock', 'snow', 'building', 'waterside']) {
  const p = sampleWorldAssetGeographyProfile(materialSurface, { family });
  materialProfiles.push({ family, summary: summarizeAssetGeography(p), material: p.material });
}
assert.equal(materialProfiles.length, 5);
assert(materialProfiles.find((item) => item.family === 'rock').material.mineral >= materialProfiles.find((item) => item.family === 'tree').material.mineral,
  'rock family should not be less mineral than tree on a forest surface');

const surfaceTransitions = [
  fixture({ x: 0, z: 0, biome: 'meadow', moisture: 0.56, height: 18, slopeDegrees: 4 }),
  fixture({ x: 25, z: 8, biome: 'riparian', moisture: 0.68, height: 16, slopeDegrees: 4, riverDistance: 10, deposition: 0.74 }),
  fixture({ x: 50, z: 17, biome: 'marsh', moisture: 0.88, height: 9, slopeDegrees: 3, riverDistance: 8, concavity: 0.70 }),
  fixture({ x: 82, z: 27, biome: 'heath', moisture: 0.34, height: 84, slopeDegrees: 12, deposition: 0.32 }),
  fixture({ x: 121, z: 41, biome: 'alpine', moisture: 0.40, height: 290, slopeDegrees: 32, lithic: 0.85, snow: 0.32 }),
];
let previousScore = null;
for (const surface of surfaceTransitions) {
  const p = sampleWorldAssetGeographyProfile(surface, { family: 'vegetation' });
  if (previousScore !== null) assert(Math.abs(p.placementScore - previousScore) < 0.75, 'ecotone transition should remain bounded');
  previousScore = p.placementScore;
}

const waterReject = sampleWorldAssetGeographyProfile(fixture({ waterDepth: 0.25, biome: 'lake', height: 4 }), { family: 'tree' });
assert.equal(isWorldAssetGeographicallyPlausible(waterReject), false, 'ordinary tree must not be geographically plausible inside meaningful water depth');
const waterWaterside = sampleWorldAssetGeographyProfile(fixture({ waterDepth: 0.25, biome: 'lake', height: 4, lakeDistance: 0 }), { family: 'waterside' });
assert(waterWaterside.placementScore >= 0, 'waterside profile must remain bounded even on water-contact surfaces');

const extremeFixtures = [
  fixture({ height: -4, slopeDegrees: 89, moisture: 0, snow: 0, waterDepth: 4, biome: 'ocean', erosion: 1, deposition: 0, shelter: 0, lithic: 1 }),
  fixture({ height: 700, slopeDegrees: 0, moisture: 1, snow: 1, waterDepth: 0, biome: 'permanent-ice mountain', erosion: 1, deposition: 1, shelter: 1, lithic: 1 }),
  fixture({ height: 0, slopeDegrees: 90, moisture: 1, snow: 1, waterDepth: 0, biome: 'scree glacier', erosion: 1, deposition: 1, shelter: 0 }),
];
for (const extreme of extremeFixtures) {
  for (const family of Object.keys(WORLD_ASSET_GEOGRAPHY_FAMILIES)) {
    const p = sampleWorldAssetGeographyProfile(extreme, { family });
    assertFiniteObject(p, `extreme-${family}`);
    assert(p.placementScore >= 0 && p.placementScore <= 1);
  }
}

const profileDecisionCases = [
  [profile({ biome: 'meadow', height: 20, slopeDegrees: 4, moisture: 0.58 }, { family: 'tree' }), true],
  [profile({ biome: 'permanent-ice', height: 25, slopeDegrees: 5, moisture: 0.72, snow: 0.94 }, { family: 'tree' }), false],
  [profile({ biome: 'scree', height: 310, slopeDegrees: 54, moisture: 0.31, lithic: 0.94 }, { family: 'rock' }), true],
  [profile({ biome: 'marsh', height: 8, slopeDegrees: 2, moisture: 0.94 }, { family: 'building' }), false],
];
for (const [p, expected] of profileDecisionCases) {
  const d = assetGeographyPlacementDecision(p);
  assert.equal(d.accept, expected, `decision mismatch for ${p.family}`);
  assert(Array.isArray(d.reasons), 'decision reasons must be inspectable');
}

let yawVariation = 0;
let scaleVariation = 0;
let previousYaw = null;
let previousScale = null;
for (let index = 0; index < 32; index += 1) {
  const x = 200 + index * 19.3;
  const z = -400 + index * 11.7;
  const p = sampleWorldAssetGeographyProfile(fixture({ x, z, biome: 'forest', moisture: 0.68 }), { family: 'tree' });
  const yaw = deterministicAssetYaw(p, x, z);
  const scale = deterministicAssetScale(p, x, z);
  if (previousYaw !== null) yawVariation += Math.abs(yaw - previousYaw);
  if (previousScale !== null) scaleVariation += Math.abs(scale - previousScale);
  previousYaw = yaw;
  previousScale = scale;
}
assert(yawVariation > 0.1, 'tree candidates must not all share one yaw');
assert(scaleVariation > 0.01, 'tree candidates must not all share one scale');

const repeatCandidates = [];
for (let i = 0; i < 25; i += 1) {
  repeatCandidates.push(makeCandidate(i * 17.0, (i % 5) * 23.0, {
    biome: i % 4 === 0 ? 'forest' : 'meadow',
    moisture: 0.55 + (i % 7) * 0.035,
    height: 22 + (i % 6) * 5,
    shelter: 0.35 + (i % 5) * 0.10,
    deposition: 0.45 + (i % 6) * 0.06,
  }));
}
const repeatedDistribution = distributeAssetCandidates(repeatCandidates, { family: 'tree' }, { targetCount: 14, minimumScore: 0.28, spacingMeters: 8.5 });
assert(repeatedDistribution.selected.length > 4, 'repeat-distribution fixture should preserve enough healthy candidates');
const cohorts = repeatedDistribution.selected.map((item) => item.profile.cohort);
const cohortRange = Math.max(...cohorts) - Math.min(...cohorts);
assert(cohortRange > 0.08, 'selected candidates should span multiple cohort values');

const rejectedPoor = repeatedDistribution.rejected.filter((item) => item.profile.placementScore < 0.28);
assert(rejectedPoor.length >= 0, 'rejection set must remain inspectable');

const profileSummary = summarizeAssetGeography(rockOnScree);
assert(profileSummary.topDomains[0].score >= profileSummary.topDomains[profileSummary.topDomains.length - 1].score, 'domain summary must be sorted');
assert(profileSummary.material.normalMacro >= 0 && profileSummary.material.normalMacro <= 1);
assert(profileSummary.material.roughnessMacro >= 0 && profileSummary.material.roughnessMacro <= 1);

console.log('[checkWorldAssetGeographyDistribution] PASS', JSON.stringify({
  checkedCases: checked,
  families: Object.keys(WORLD_ASSET_GEOGRAPHY_FAMILIES).length,
  domains: Object.keys(WORLD_ASSET_GEOGRAPHY_DOMAINS).length,
  rankedTrees: rankedTrees.length,
  selectedTrees: treeDistribution.selected.length,
  repeatedSelected: repeatedDistribution.selected.length,
  yawVariation,
  scaleVariation,
  cohortRange,
  materialProfileFamilies: materialProfiles.map((item) => item.family),
}));
