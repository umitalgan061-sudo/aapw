#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TERRAIN_SEASONAL_EROSION_GLSL, TERRAIN_SEASONAL_EROSION_SHADER_POLICY } from '../src/3d/world/terrainSeasonalErosionShader.js';
import { validateIntegrationManifest, integrationManifestReport } from '../src/3d/world/terrainSeasonalErosionIntegrationManifest.js';

const requiredFunctions=['terrainSeasonalErosionColor','terrainSeasonalErosionRoughness','terrainSeasonalErosionNormal','tseHash','tseNoise','tseFbm','tseSlope','tseWet','tseFrost','tseErode'];
const requiredIncludes=['#include <common>','#include <color_fragment>','#include <roughnessmap_fragment>','#include <normal_fragment_maps>'];
const forbiddenTokens=['position.y+=','transformed.y+=','vTerrainLowWorldPosition.y+=','heightField=','terrainHeight='];

assert.equal(TERRAIN_SEASONAL_EROSION_SHADER_POLICY.renderOnly,true);
assert.equal(TERRAIN_SEASONAL_EROSION_SHADER_POLICY.deterministic,true);
assert.equal(TERRAIN_SEASONAL_EROSION_SHADER_POLICY.canonicalHeightUnchanged,true);
assert.equal(TERRAIN_SEASONAL_EROSION_SHADER_POLICY.canonicalHydrologyUnchanged,true);
for(const fn of requiredFunctions)assert(TERRAIN_SEASONAL_EROSION_GLSL.includes(fn),`missing ${fn}`);
for(const include of requiredIncludes)assert(TERRAIN_SEASONAL_EROSION_GLSL.includes(include.replace('#include ',''))===false,`unexpected literal include ${include}`);
for(const token of forbiddenTokens)assert.equal(TERRAIN_SEASONAL_EROSION_GLSL.includes(token),false,`forbidden geometry token ${token}`);
assert(TERRAIN_SEASONAL_EROSION_GLSL.length>1800);
assert(TERRAIN_SEASONAL_EROSION_GLSL.length<12000);
const report=integrationManifestReport();
assert.equal(validateIntegrationManifest().ok,true);
assert.equal(report.validation.ok,true);
console.log(`Seasonal erosion shader contract passed (${TERRAIN_SEASONAL_EROSION_GLSL.length} GLSL chars).`);
