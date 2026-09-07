#!/usr/bin/env node
/**
 * Static source-to-runtime ownership proof for the wind/snow slice.
 *
 * This check is deliberately source-oriented: the numerical suites validate the algorithm, while
 * this file verifies that the production terrain path is still wired to that algorithm and that no
 * detached replacement authority appeared in the same change.
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

expect(terrain.includes("from './terrainWindSnowExposure.js'"),
  'terrain height/render source must retain the existing wind snow module import');
expect(shading.includes("from './terrainWindSnowExposure.js'"),
  'terrain biome shading must retain the existing wind snow module import');
expect(shading.includes('terrainWindExposureFromNeighbours'),
  'biome shading must continue to derive wind exposure from canonical neighbours');
expect(shading.includes('resolveTerrainWindSnowAdjustment'),
  'biome shading must continue to send exposure through the climate-aware resolver');
expect(shading.includes('terrainWindward') && shading.includes('terrainLee'),
  'terrain snow coverage must keep explicit windward/lee inputs');
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
  'compatibility projection must make the richer response visible on the existing renderer path');
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

console.log(JSON.stringify({
  policyId: policyMatch[1],
  terrainImport: terrain.includes("from './terrainWindSnowExposure.js'"),
  shadingImport: shading.includes("from './terrainWindSnowExposure.js'"),
  climateResolverAttached: shading.includes('resolveTerrainWindSnowAdjustment'),
  canonicalNeighboursAttached: shading.includes('terrainWindExposureFromNeighbours'),
  deterministic: !wind.includes('Math.random('),
  secondHeightAuthority: wind.includes('createHeightSampler('),
}, null, 2));
console.log('[checkTerrainWindSnowRuntimeParity] PASS');
