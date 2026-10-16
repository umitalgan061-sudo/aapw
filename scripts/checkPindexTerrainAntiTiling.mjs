#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTerrainChunk, disposeTerrainChunk } from '../src/3d/world/terrain.js';
import { applyPindex05DetailToTerrainMesh, PINDEX05_DETAIL_POLICY } from '../src/3d/world/worldReferencePindex05Detail.js';
import { applyRuntimePindexTerrainQualityV2ToMesh, RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY } from '../src/3d/world/worldReferenceSurfaceTerrainVisual.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const visualSource = fs.readFileSync(path.join(root, 'src/3d/world/worldReferenceSurfaceTerrainVisual.ts'), 'utf8');
const soilSource = fs.readFileSync(path.join(root, 'src/3d/world/worldReferencePindex05Detail.legacy.js'), 'utf8');

assert.equal(RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.repeatAtlasRemoved, true);
assert.equal(RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.roughnessDetailRevision, 'v3-nonperiodic-world-space-value-noise');
assert.deepEqual(RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.roughnessDetailFrequencies, [0.021, 0.0087, 0.0031, 0.013]);
assert.equal(PINDEX05_DETAIL_POLICY.worldSpaceNormalWeathering, true);
assert.deepEqual(PINDEX05_DETAIL_POLICY.normalStrengthBySurface, { sea: 0, lake: 0, soil: 0.35, rock: 0.52, snow: 0.14 });
assert.equal(PINDEX05_DETAIL_POLICY.normalGradientStepFraction, 0.18);
assert.doesNotMatch(visualSource, /pindexQualityDetailAtlas|buildRuntimePindexQualityV2DetailAtlas/);
assert.match(visualSource, /float pindexQualityHash\(vec2 p\)/);
assert.match(visualSource, /float pindexQualityNoise\(vec2 p\)/);
assert.match(visualSource, /pindexQualityNoiseA=pindexQualityNoise/);
assert.match(visualSource, /pindexQualityRoughNoise=pindexQualityNoise/);
assert.match(soilSource, /applyPindex05WeatheredNormal\(/);
assert.match(soilSource, /normal\.setXYZ\(/);
assert.doesNotMatch(soilSource, /position\.set[XYZ]\(/);
assert.doesNotMatch(soilSource, /geometry\.setAttribute\(['"]position['"]/);
assert.doesNotMatch(soilSource, /createHeightSampler|waterDepth|collider|hydrology/i);

function createProbe() {
  return createTerrainChunk({ chunkX: 0, chunkZ: 0, size: 500, segments: 8, seed: 77 });
}
const first = createProbe();
const second = createProbe();
const shaderProbe = createProbe();
let normalWeatheredVertices = 0;
try {
  const firstPosition = first.geometry.getAttribute('position');
  const firstNormal = first.geometry.getAttribute('normal');
  assert(firstPosition && firstNormal, 'canonical terrain must expose position and vertex normal attributes');
  const positionBefore = Float32Array.from(firstPosition.array);
  const normalBefore = Float32Array.from(firstNormal.array);
  const firstSummary = applyPindex05DetailToTerrainMesh(first);
  const secondSummary = applyPindex05DetailToTerrainMesh(second);
  normalWeatheredVertices = firstSummary.weatheredNormalVertices;
  assert(normalWeatheredVertices > 0, 'Pindex-05 near-ground normal weathering must affect dry land');
  assert(normalWeatheredVertices <= firstSummary.touchedVertices);
  assert.deepEqual(firstSummary, secondSummary, 'normal/weathering statistics must be deterministic');
  assert.deepEqual(Array.from(firstPosition.array), Array.from(positionBefore), 'render-only surface weathering must not change canonical terrain heights');
  assert.notDeepEqual(Array.from(firstNormal.array), Array.from(normalBefore), 'world-space surface weathering must produce measurable normal relief');
  assert.deepEqual(Array.from(first.geometry.getAttribute('normal').array), Array.from(second.geometry.getAttribute('normal').array), 'normal weathering must reproduce the same field on the same seeded terrain');

  const qualitySummary = applyRuntimePindexTerrainQualityV2ToMesh(shaderProbe);
  assert.equal(qualitySummary.policyId, RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.id);
  const shaderHook = shaderProbe.material.onBeforeCompile.toString();
  assert(shaderHook.includes('pindexQualityNoise'), 'live terrain material must install analytic non-periodic noise');
  assert(shaderHook.includes('pindexQualityRoughNoise'), 'live terrain material must use world-space roughness breakup');
  assert(!shaderHook.includes('pindexQualityDetailAtlas'), 'live terrain material must not sample a fixed-period detail atlas');
  assert(shaderProbe.material.customProgramCacheKey().includes(RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.id), 'shader cache key must invalidate for the new surface policy');
} finally {
  disposeTerrainChunk(first);
  disposeTerrainChunk(second);
  disposeTerrainChunk(shaderProbe);
}

console.log('[checkPindexTerrainAntiTiling] PASS', JSON.stringify({
  qualityPolicyId: RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.id,
  pindex05PolicyId: PINDEX05_DETAIL_POLICY.id,
  roughnessDetailRevision: RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.roughnessDetailRevision,
  normalWeatheredVertices,
  canonicalHeightUnchanged: true,
  fixedPeriodAtlasSamples: 0,
}));
