#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTerrainChunk, disposeTerrainChunk } from '../src/3d/world/terrain.js';
import { applyPindex05DetailToTerrainMesh, PINDEX05_DETAIL_POLICY } from '../src/3d/world/worldReferencePindex05Detail.js';
import { applyRuntimePindexTerrainQualityV2ToMesh, RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY } from '../src/3d/world/worldReferenceSurfaceTerrainVisual.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const visualSource = fs.readFileSync(path.join(root, 'src/3d/world/worldReferenceSurfaceTerrainVisual.ts'), 'utf8');
const soilSource = fs.readFileSync(path.join(root, 'src/3d/world/worldReferencePindex05Detail.legacy.js'), 'utf8');

function run(command, args, cwd, label) {
  const result = spawnSync(command, args, { cwd, env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${label} failed with status ${result.status}`);
}

function gitOutput(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: process.env });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function captureCreateSceneBeforeAfter() {
  const ci = process.env.CI === 'true';
  if (!ci) return;
  run('git', ['fetch', 'origin', 'main'], root, 'fetch current origin/main');
  const mainSha = gitOutput(['rev-parse', 'origin/main'], root);
  const mergeBase = gitOutput(['merge-base', 'HEAD', mainSha], root);
  assert.equal(mergeBase, mainSha, 'createScene before/after proof requires an exact-current-main base');
  const headSha = gitOutput(['rev-parse', 'HEAD'], root);
  console.log(`[checkPindexTerrainAntiTiling] createScene proof base=${mainSha} head=${headSha}`);

  const lfsInclude = 'assets/textures/yüzey/**,assets/models/settlements/castles/**,assets/models/characters/**,assets/animations/peasant_girl/**,assets/models/animals/**,assets/models/creatures/dragon/**';
  run('git', ['lfs', 'pull', `--include=${lfsInclude}`, '--exclude='], root, 'hydrate acceptance-only LFS assets');
  run('git', ['lfs', 'checkout'], root, 'checkout acceptance-only LFS assets');

  const baselineDir = path.join(os.tmpdir(), `aapw-create-scene-baseline-${process.pid}`);
  const artifactRoot = path.join(root, 'artifacts/full-world-3d-topdown/createScene-acceptance');
  let worktreeAdded = false;
  try {
    await fsp.rm(baselineDir, { recursive: true, force: true });
    run('git', ['worktree', 'add', '--detach', baselineDir, mainSha], root, 'create exact-main visual baseline worktree');
    worktreeAdded = true;
    await fsp.symlink(path.join(root, 'node_modules'), path.join(baselineDir, 'node_modules'), 'dir');
    run('git', ['lfs', 'checkout'], baselineDir, 'hydrate exact-main worktree assets');

    run(process.execPath, ['scripts/checkWorldEnvironmentAcceptanceMatrix.mjs'], baselineDir, 'baseline shipped createScene matrix');
    const beforeSource = path.join(baselineDir, 'artifacts/world-environment-acceptance');
    const beforeTarget = path.join(artifactRoot, 'before-main');
    await fsp.mkdir(beforeTarget, { recursive: true });
    await fsp.cp(beforeSource, beforeTarget, { recursive: true, force: true });

    run(process.execPath, ['scripts/checkWorldEnvironmentAcceptanceMatrix.mjs'], root, 'candidate shipped createScene matrix');
    const afterSource = path.join(root, 'artifacts/world-environment-acceptance');
    const afterTarget = path.join(artifactRoot, 'after-pr');
    await fsp.mkdir(afterTarget, { recursive: true });
    await fsp.cp(afterSource, afterTarget, { recursive: true, force: true });
  } finally {
    if (worktreeAdded) run('git', ['worktree', 'remove', '--force', baselineDir], root, 'remove exact-main baseline worktree');
    await fsp.rm(baselineDir, { recursive: true, force: true });
  }
}

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

await captureCreateSceneBeforeAfter();

console.log('[checkPindexTerrainAntiTiling] PASS', JSON.stringify({
  qualityPolicyId: RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.id,
  pindex05PolicyId: PINDEX05_DETAIL_POLICY.id,
  roughnessDetailRevision: RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.roughnessDetailRevision,
  normalWeatheredVertices,
  canonicalHeightUnchanged: true,
  fixedPeriodAtlasSamples: 0,
}));
