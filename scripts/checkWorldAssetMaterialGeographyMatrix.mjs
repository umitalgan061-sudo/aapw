#!/usr/bin/env node

/**
 * Material/geography compatibility matrix for the live world asset pipeline.
 *
 * The existing placement material adapter is intentionally conservative: it can tint a model with
 * dampness, dryness, cold, mineral, moss, lichen and snow context, but a material response can only be
 * convincing when the asset family itself is plausible for the surface. This matrix therefore checks
 * both layers at once.
 *
 * The important distinction is:
 *   geometry suitability != geographic plausibility != material plausibility
 *
 * A flat patch of land can accept a tree geometrically while still being dry heath, a wind-scoured
 * ridge, a volcanic shoulder or a permanent-ice field where the tree should not exist. The test keeps
 * these concepts independent and bounded.
 */

import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  WORLD_ASSET_GEOGRAPHY_FAMILIES,
  assetGeographyPlacementDecision,
  sampleWorldAssetGeographyProfile,
  summarizeAssetGeography,
} from '../src/3d/world/worldAssetGeographyProfile.js';
import {
  WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY,
  applyWorldPlacementMaterialContext,
} from '../src/3d/materials/worldPlacementMaterialContext.js';

function surface(overrides = {}) {
  return {
    x: 0,
    z: 0,
    height: 24,
    slopeDegrees: 5,
    aspectRadians: 0.4,
    moisture: 0.56,
    snow: 0,
    waterDepth: 0,
    riverDistance: 180,
    lakeDistance: 200,
    coastDistance: 240,
    roadDistance: 50,
    settlementDistance: 180,
    biome: 'meadow',
    concavity: 0,
    erosion: 0.34,
    deposition: 0.58,
    shelter: 0.54,
    lithic: 0.22,
    ...overrides,
  };
}

const ENVIRONMENTS = Object.freeze({
  temperateMeadow: surface({ biome: 'meadow', height: 18, slopeDegrees: 4, moisture: 0.58, deposition: 0.68, shelter: 0.62 }),
  wetMeadow: surface({ biome: 'meadow', height: 16, slopeDegrees: 5, moisture: 0.76, riverDistance: 25, deposition: 0.80, concavity: 0.32 }),
  forestFloor: surface({ biome: 'forest', height: 46, slopeDegrees: 8, moisture: 0.70, deposition: 0.56, shelter: 0.76 }),
  dryHeath: surface({ biome: 'heath', height: 110, slopeDegrees: 14, moisture: 0.34, deposition: 0.30, erosion: 0.58, shelter: 0.40 }),
  marsh: surface({ biome: 'marsh', height: 7, slopeDegrees: 2, moisture: 0.94, riverDistance: 8, deposition: 0.86, concavity: 0.82 }),
  floodplain: surface({ biome: 'riparian floodplain', height: 12, slopeDegrees: 3, moisture: 0.79, riverDistance: 6, deposition: 0.91, concavity: 0.46 }),
  coast: surface({ biome: 'coast beach', height: 4, slopeDegrees: 6, moisture: 0.69, coastDistance: 4, deposition: 0.77 }),
  coastalCliff: surface({ biome: 'coast cliff', height: 16, slopeDegrees: 42, moisture: 0.61, coastDistance: 8, lithic: 0.90, erosion: 0.88, shelter: 0.26 }),
  tundra: surface({ biome: 'tundra', height: 38, slopeDegrees: 6, moisture: 0.64, snow: 0.31, shelter: 0.74 }),
  permanentIce: surface({ biome: 'permanent-ice', height: 22, slopeDegrees: 5, moisture: 0.70, snow: 0.96, shelter: 0.54 }),
  alpine: surface({ biome: 'alpine mountain', height: 380, slopeDegrees: 34, moisture: 0.43, snow: 0.42, lithic: 0.85, erosion: 0.72, shelter: 0.25 }),
  scree: surface({ biome: 'scree talus', height: 300, slopeDegrees: 49, moisture: 0.30, snow: 0.12, lithic: 0.96, erosion: 0.90, deposition: 0.16, shelter: 0.18, concavity: -0.62 }),
  volcanic: surface({ biome: 'volcanic basalt', height: 88, slopeDegrees: 24, moisture: 0.20, snow: 0.03, lithic: 0.98, erosion: 0.84, deposition: 0.18, shelter: 0.22 }),
  volcanicSnow: surface({ biome: 'volcanic snowfield', height: 420, slopeDegrees: 21, moisture: 0.36, snow: 0.66, lithic: 0.95, erosion: 0.70, deposition: 0.22 }),
});

const EXPECTED = Object.freeze({
  tree: Object.freeze({
    allowed: ['temperateMeadow', 'wetMeadow', 'forestFloor', 'floodplain', 'tundra'],
    disfavoured: ['dryHeath', 'marsh', 'coastalCliff', 'permanentIce', 'scree', 'volcanic'],
  }),
  vegetation: Object.freeze({
    allowed: ['temperateMeadow', 'wetMeadow', 'forestFloor', 'dryHeath', 'floodplain', 'coast', 'tundra'],
    disfavoured: ['permanentIce', 'scree'],
  }),
  shrub: Object.freeze({
    allowed: ['dryHeath', 'tundra', 'coast', 'forestFloor', 'floodplain'],
    disfavoured: ['permanentIce', 'scree'],
  }),
  rock: Object.freeze({
    allowed: ['coastalCliff', 'alpine', 'scree', 'volcanic', 'volcanicSnow'],
    disfavoured: ['marsh', 'temperateMeadow'],
  }),
  snow: Object.freeze({
    allowed: ['tundra', 'permanentIce', 'alpine', 'volcanicSnow'],
    disfavoured: ['temperateMeadow', 'forestFloor', 'dryHeath'],
  }),
  waterside: Object.freeze({
    allowed: ['marsh', 'floodplain', 'coast', 'coastalCliff'],
    disfavoured: ['dryHeath', 'scree', 'permanentIce'],
  }),
  building: Object.freeze({
    allowed: ['temperateMeadow', 'wetMeadow', 'forestFloor', 'dryHeath', 'coast', 'floodplain'],
    disfavoured: ['marsh', 'permanentIce', 'scree'],
  }),
  settlement: Object.freeze({
    allowed: ['temperateMeadow', 'forestFloor', 'dryHeath', 'coast', 'floodplain'],
    disfavoured: ['marsh', 'permanentIce', 'scree', 'alpine'],
  }),
});

function score(family, environment) {
  const p = sampleWorldAssetGeographyProfile(ENVIRONMENTS[environment], { family });
  return p;
}

function familyProfiles(family) {
  return Object.fromEntries(Object.keys(ENVIRONMENTS).map((environment) => [environment, score(family, environment)]));
}

for (const family of Object.keys(WORLD_ASSET_GEOGRAPHY_FAMILIES)) {
  const profiles = familyProfiles(family);
  for (const [environment, p] of Object.entries(profiles)) {
    assert(p.placementScore >= 0 && p.placementScore <= 1, `${family}/${environment} score must be bounded`);
    assert(p.domains && Object.keys(p.domains).length === 10, `${family}/${environment} must expose all domains`);
    assert(p.material && p.material.family === family, `${family}/${environment} material family mismatch`);
    assert(Number.isFinite(p.preferredRotationRadians), `${family}/${environment} rotation must be finite`);
  }
}

for (const [family, expectation] of Object.entries(EXPECTED)) {
  const familyScores = familyProfiles(family);
  for (const environment of expectation.allowed) {
    const p = familyScores[environment];
    assert(p.placementScore >= 0.20, `${family} should remain plausible in ${environment}`);
  }
  for (const environment of expectation.disfavoured) {
    const p = familyScores[environment];
    assert(p.placementScore < 0.84, `${family} should not become excellent in ${environment}`);
  }
}

const treePlain = score('tree', 'temperateMeadow');
const treeForest = score('tree', 'forestFloor');
const treeScree = score('tree', 'scree');
const treeIce = score('tree', 'permanentIce');
assert(treeForest.placementScore >= treeScree.placementScore, 'tree should prefer forest to scree');
assert(treePlain.placementScore > treeIce.placementScore, 'tree should prefer temperate plain to permanent ice');
assert(treePlain.material.cold < treeIce.material.cold, 'tree material cold response must reflect climate');

const rockAlpine = score('rock', 'alpine');
const rockVolcanic = score('rock', 'volcanic');
const rockMeadow = score('rock', 'temperateMeadow');
assert(rockAlpine.placementScore > rockMeadow.placementScore, 'rock should prefer alpine geology to meadow');
assert(rockVolcanic.material.mineral > rockMeadow.material.mineral, 'volcanic rock must carry mineral response');

const snowIce = score('snow', 'permanentIce');
const snowMeadow = score('snow', 'temperateMeadow');
const snowAlpine = score('snow', 'alpine');
assert(snowIce.placementScore > snowMeadow.placementScore, 'snow must prefer permanent ice to temperate meadow');
assert(snowAlpine.placementScore > snowMeadow.placementScore, 'snow should prefer alpine to temperate meadow');
assert(snowIce.material.snowCover > snowMeadow.material.snowCover, 'snow material context must rise on permanent ice');

const waterMarsh = score('waterside', 'marsh');
const waterCoast = score('waterside', 'coast');
const waterDry = score('waterside', 'dryHeath');
assert(waterMarsh.placementScore > waterDry.placementScore, 'waterside must prefer marsh to dry heath');
assert(waterCoast.placementScore > waterDry.placementScore, 'waterside must prefer coast to dry heath');

const settlementPlain = score('settlement', 'temperateMeadow');
const settlementMarsh = score('settlement', 'marsh');
const settlementIce = score('settlement', 'permanentIce');
assert(settlementPlain.placementScore > settlementMarsh.placementScore, 'settlement should prefer stable plain to marsh');
assert(settlementPlain.placementScore > settlementIce.placementScore, 'settlement should prefer temperate plain to permanent ice');

const aspectA = sampleWorldAssetGeographyProfile(surface({ x: 200, z: 300, aspectRadians: 0, biome: 'heath', moisture: 0.38, height: 130 }), { family: 'shrub' });
const aspectB = sampleWorldAssetGeographyProfile(surface({ x: 200, z: 300, aspectRadians: Math.PI, biome: 'heath', moisture: 0.38, height: 130 }), { family: 'shrub' });
assert(Math.abs(aspectA.preferredRotationRadians - aspectB.preferredRotationRadians) > 0.02, 'asset orientation should react to aspect context');

const cohortSamples = [];
for (let i = 0; i < 20; i += 1) {
  const p = sampleWorldAssetGeographyProfile(surface({ x: 100 + i * 17.4, z: -260 + i * 9.8, biome: 'forest', height: 46, moisture: 0.69 }), { family: 'tree' });
  cohortSamples.push(p.cohort);
}
assert(Math.max(...cohortSamples) - Math.min(...cohortSamples) > 0.06, 'forest candidates should not collapse to one cohort value');

const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshStandardMaterial({ color: 0x6a533f }));
const adapterSurface = ENVIRONMENTS.forestFloor;
const adapterResult = applyWorldPlacementMaterialContext(mesh, adapterSurface, {
  groundingMode: 'embedded-low-side',
  heightRange: 1.1,
  samples: [adapterSurface],
  islandSamples: [],
});
assert(adapterResult && typeof adapterResult === 'object', 'material adapter must return a context');
assert(mesh.userData.worldPlacementMaterialContext, 'material adapter context must be persisted');
assert(mesh.userData.worldAssetSurfaceResponse, 'material surface response must be persisted');
assert(WORLD_PLACEMENT_MATERIAL_CONTEXT_POLICY.maximumColorMix <= 0.14 + 1e-9, 'material tint ceiling must remain bounded');

const decisionCases = [
  ['tree', 'forestFloor'],
  ['rock', 'scree'],
  ['snow', 'permanentIce'],
  ['waterside', 'marsh'],
  ['settlement', 'temperateMeadow'],
];
for (const [family, environment] of decisionCases) {
  const p = score(family, environment);
  const d = assetGeographyPlacementDecision(p);
  assert(['accept-strong', 'accept-conditional'].includes(d.decision), `${family}/${environment} must have a positive decision`);
}

const poorCases = [
  ['tree', 'permanentIce'],
  ['tree', 'scree'],
  ['building', 'marsh'],
  ['settlement', 'permanentIce'],
  ['waterside', 'dryHeath'],
];
for (const [family, environment] of poorCases) {
  const p = score(family, environment);
  const d = assetGeographyPlacementDecision(p);
  assert(Array.isArray(d.reasons), `${family}/${environment} poor case needs explainable reasons`);
}

const summaries = [];
for (const family of Object.keys(WORLD_ASSET_GEOGRAPHY_FAMILIES)) {
  for (const environment of ['temperateMeadow', 'forestFloor', 'dryHeath', 'marsh', 'permanentIce', 'alpine', 'scree', 'volcanic']) {
    summaries.push({ family, environment, summary: summarizeAssetGeography(score(family, environment)) });
  }
}

const familyEnvironmentMatrix = {};
for (const family of Object.keys(WORLD_ASSET_GEOGRAPHY_FAMILIES)) {
  familyEnvironmentMatrix[family] = {};
  for (const environment of Object.keys(ENVIRONMENTS)) {
    const p = score(family, environment);
    familyEnvironmentMatrix[family][environment] = {
      score: Number(p.placementScore.toFixed(6)),
      class: p.placementClass,
      moisture: Number(p.surface.moisture.toFixed(6)),
      slope: Number(p.surface.slopeDegrees.toFixed(4)),
      snow: Number(p.surface.snow.toFixed(6)),
      cohort: Number(p.cohort.toFixed(6)),
      topDomains: summarizeAssetGeography(p).topDomains,
    };
  }
}

console.log('[checkWorldAssetMaterialGeographyMatrix] PASS', JSON.stringify({
  policy: WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.id,
  environments: Object.keys(ENVIRONMENTS).length,
  families: Object.keys(WORLD_ASSET_GEOGRAPHY_FAMILIES).length,
  decisionPositiveCases: decisionCases.length,
  poorCases: poorCases.length,
  summaries: summaries.length,
  matrix: familyEnvironmentMatrix,
}));
