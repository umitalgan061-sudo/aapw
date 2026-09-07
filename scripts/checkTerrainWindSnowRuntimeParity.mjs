#!/usr/bin/env node
/**
 * Static source-to-runtime ownership proof for the wind/snow slice.
 *
 * The numerical suites validate the algorithm. This check validates the live source graph: the
 * terrain biome shader must still own the snow-coverage call path, while the wind/snow module stays
 * a render-only helper and does not introduce a second terrain, water or asset authority.
 */

import fs from 'node:fs';
import assert from 'node:assert/strict';

const terrainPath = 'src/3d/world/terrain.js';
const shadingPath = 'src/3d/world/terrainBiomeShading.js';
const windPath = 'src/3d/world/terrainWindSnowExposure.js';

const terrain = fs.readFileSync(terrainPath, 'utf8');
const shading = fs.readFileSync(shadingPath, 'utf8');
const wind = fs.readFileSync(windPath, 'utf8');

const expect = (condition, message) => {
  if (!condition) {
    console.error(`[checkTerrainWindSnowRuntimeParity] FAIL: ${message}`);
    process.exit(1);
  }
};

expect(shading.includes("from './terrainWindSnowExposure.js'"),
  'terrain biome shading must retain the live wind/snow module import');
expect(shading.includes('terrainWindExposureFromNeighbours'),
  'biome shading must continue to derive wind exposure from terrain neighbours');
expect(shading.includes('resolveTerrainWindSnowAdjustment'),
  'biome shading must continue to send exposure through the climate-aware resolver');
expect(shading.includes('terrainWindward') && shading.includes('terrainLee'),
  'terrain snow coverage must keep explicit windward/lee inputs');
expect(terrain.includes('createHeightSampler'),
  'terrain.js must retain the canonical terrain sampler authority');
expect(terrain.includes('CURRENT_TERRAIN_POLICY'),
  'terrain.js must retain the canonical owner-map policy marker');
expect(wind.includes('heightAuthorityUnchanged: true'),
  'wind/snow module must remain explicitly non-authoritative for height');
expect(wind.includes('renderOnly: true'),
  'wind/snow module must remain render-only');
expect(wind.includes('ridgelineExposure'),
  'production module must expose fold-aware ridge response');
expect(wind.includes('shelterPocket'),
  'production module must expose fold-aware lee shelter response');
expect(wind.includes('snowMobility'),
  'production module must expose bounded snow mobility response');
expect(wind.includes('crustScour'),
  'production module must expose bounded exposed-crust response');
expect(wind.includes('packGain'),
  'production module must expose bounded pack response');
expect(wind.includes('Math.max(ridgelineExposure, windwardWeight * 0.34)'),
  'compatibility projection must make the richer response visible on the shipped renderer path');
expect(wind.includes('Math.max(shelterPocket, leeWeight * 0.38)'),
  'lee compatibility projection must remain bounded and renderer-visible');
expect(wind.includes('Math.max(snowMobility, Math.max(windwardWeight, leeWeight) * 0.24)'),
  'mobility compatibility projection must remain bounded and renderer-visible');
expect(!wind.includes('Math.random('),
  'snow surface response must remain deterministic');
expect(!wind.includes('createHeightSampler('),
  'wind/snow surface module must not create a second height authority');
expect(!wind.includes('setY(') && !wind.includes('.position.y'),
  'wind/snow surface module must not mutate world geometry transforms');

const forbiddenAuthorities = [
  'water.js',
  'vegetation.js',
  'WorldAssetPlacementPipeline.js',
  'MaterialAssignmentCore.js',
];
for (const authority of forbiddenAuthorities) {
  expect(!wind.includes(authority), `wind/snow module must not duplicate ${authority}`);
}

const policyMatch = wind.match(/id:\s*'([^']+)'/);
expect(policyMatch, 'wind/snow policy id must be explicit');
expect(policyMatch[1].includes('2026-09-07'), 'current production policy must carry the current dated id');

const callIndex = shading.indexOf('resolveTerrainWindSnowAdjustment');
const inputIndex = shading.indexOf('terrainWindward', callIndex);
expect(callIndex >= 0 && inputIndex >= callIndex,
  'the live snow resolver call must be followed by its terrain wind inputs');

console.log(JSON.stringify({
  policyId: policyMatch[1],
  canonicalTerrainSampler: terrain.includes('createHeightSampler'),
  canonicalTerrainPolicy: terrain.includes('CURRENT_TERRAIN_POLICY'),
  shadingImport: shading.includes("from './terrainWindSnowExposure.js'"),
  climateResolverAttached: callIndex >= 0,
  windInputsPresent: inputIndex >= callIndex,
  deterministic: !wind.includes('Math.random('),
  secondHeightAuthority: wind.includes('createHeightSampler('),
}, null, 2));
console.log('[checkTerrainWindSnowRuntimeParity] PASS');
