#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PINDEX08_DETAIL_POLICY } from '../src/3d/world/worldReferencePindex08Detail.js';
import {
  WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY,
  WORLD_REFERENCE_LAKE_CELL_COUNT,
} from '../src/3d/world/worldReferenceMountainRelief.js';
import { TERRAIN_LAKE_BASIN_CONFORM_POLICY } from '../src/3d/world/terrain.js';
import { WORLD_REFERENCE_BASE_SURFACE_MASK } from '../src/3d/world/worldReferenceSurfacePindexes.js';
import { QA_ROOT, round, writeJsonArtifact } from './lib/lakeBasinQa.mjs';

function read(relativePath) {
  return readFileSync(resolve(QA_ROOT, relativePath), 'utf8');
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function requireSnippet(source, snippet, label = snippet) {
  const index = source.indexOf(snippet);
  assert(index >= 0, `required production source snippet missing: ${label}`);
  return index;
}

function forbidSnippet(source, snippet, label = snippet) {
  assert(!source.includes(snippet), `forbidden production source snippet detected: ${label}`);
}

function requireOrder(source, snippets, label) {
  let cursor = -1;
  for (const snippet of snippets) {
    const index = source.indexOf(snippet);
    assert(index >= 0, `${label}: missing snippet ${snippet}`);
    assert(index > cursor, `${label}: source order drifted around ${snippet}`);
    cursor = index;
  }
}

const terrainPath = 'src/3d/world/terrain.js';
const mountainPath = 'src/3d/world/worldReferenceMountainRelief.js';
const pindex08Path = 'src/3d/world/worldReferencePindex08Detail.js';
const surfacePath = 'src/3d/world/worldReferenceSurfacePindexes.js';
const terrain = read(terrainPath);
const mountain = read(mountainPath);
const pindex08 = read(pindex08Path);
const surface = read(surfacePath);

assert.equal(WORLD_REFERENCE_LAKE_CELL_COUNT, 6);
assert.equal(WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.surfaceMaskSha256,
  WORLD_REFERENCE_BASE_SURFACE_MASK.maskSha256);
assert.equal(TERRAIN_LAKE_BASIN_CONFORM_POLICY.lakeAuthorityPolicyId,
  WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id);
assert.equal(PINDEX08_DETAIL_POLICY.renderOnly, true,
  'parallel Pindex08 visual work must remain render-only');
assert.equal(PINDEX08_DETAIL_POLICY.geographyAuthorityUnchanged, true,
  'parallel Pindex08 visual work must not become a height/geography authority');

requireSnippet(terrain, "sampleReferenceLakeBasinScale,", 'terrain imports canonical lake-basin scale');
requireSnippet(terrain, 'const lakeDryEnhancementScale = terrainLakeBasinDryScale(nx, ny);',
  'terrain samples basin scale in canonical unwarped map coordinates');
forbidSnippet(terrain, 'terrainLakeBasinDryScale(wx, wy)',
  'lake basin scale must not follow coast-warped coordinates');
forbidSnippet(terrain, 'terrainLakeBasinDryScale(worldX, worldZ)',
  'lake basin scale consumes normalized owner-map coordinates, not world metres');
requireSnippet(terrain, 'nonMountainDryEnhancement * lakeDryEnhancementScale');
requireSnippet(terrain, 'detailTaper * lakeDryEnhancementScale');
requireSnippet(terrain, 'const wetRelative = -3.0 - waterWeight * 5.25');
forbidSnippet(terrain, 'wetRelative * lakeDryEnhancementScale');
forbidSnippet(terrain, 'waterWeight *= lakeDryEnhancementScale');
forbidSnippet(terrain, 'lakeWeight *= lakeDryEnhancementScale');
forbidSnippet(terrain, 'seaWeight *= lakeDryEnhancementScale');

requireOrder(terrain, [
  'const lakeWeight = clamp01(sample.surfaceWeights.lake ?? 0);',
  'const waterWeight = clamp01(seaWeight + lakeWeight);',
  'const lakeDryEnhancementScale = terrainLakeBasinDryScale(nx, ny);',
  'const dryRelativeBase = 1.0',
  'const valyriaMeters = valyriaUpliftMeters(nx, ny, dryRelativeBase, waterWeight);',
  'const dryRelative = dryRelativeBase + valyriaMeters;',
  'const wetRelative = -3.0 - waterWeight * 5.25',
  'let heightMeters = SEA_LEVEL + lerp(dryRelative, wetRelative, waterWeight);',
  'heightMeters += reliefDetailMeters(wx, wy, {',
  'const hydrology = sampleSeatSafeReferenceHydrology',
], 'terrain lake-basin authority order');

const dryBlockStart = requireSnippet(terrain, 'const nonMountainDryEnhancement = upliftMeters');
const dryBlockEnd = requireSnippet(terrain, 'const wetRelative = -3.0 - waterWeight * 5.25');
const dryBlock = terrain.slice(dryBlockStart, dryBlockEnd);
for (const requiredTerm of [
  'upliftMeters',
  'sample.reliefInfluence * 28',
  'sample.biomeInfluence * 7',
  'rockWeight * 8',
  'snowWeight * 12',
  'micro',
]) {
  assert(dryBlock.includes(requiredTerm), `dry enhancement lost audited term: ${requiredTerm}`);
}
assert(dryBlock.includes('+ mountainMeters;'), 'mountain relief must stay outside the second dry-scale multiplication');
forbidSnippet(dryBlock, 'mountainMeters * lakeDryEnhancementScale',
  'mountain relief is already tapered in worldReferenceMountainRelief and must not be double-squared');

requireSnippet(mountain, 'const LAKE_CODE = WORLD_REFERENCE_BASE_SURFACE_MASK.codes.lake;');
requireSnippet(mountain, 'const LAKE_CELL_CENTERS = collectLakeCellCenters();');
requireSnippet(mountain, 'const LAKE_DISTANCE_FIELD = buildLakeDistanceField();');
requireSnippet(mountain, 'export function sampleReferenceLakeDistanceNormalized');
requireSnippet(mountain, 'export function sampleReferenceLakeBasinScale');
forbidSnippet(mountain, 'Math.random()', 'mountain/lake authority must remain deterministic');

const lakeCollectionStart = requireSnippet(mountain, 'function collectLakeCellCenters()');
const lakeCollectionEnd = requireSnippet(mountain, 'const LAKE_CELL_CENTERS = collectLakeCellCenters();');
const lakeCollectionBlock = mountain.slice(lakeCollectionStart, lakeCollectionEnd);
assert(lakeCollectionBlock.includes('DECODED_SURFACE_MASK'));
assert(lakeCollectionBlock.includes('LAKE_CODE'));
assert(!/\[[0-9.]+\s*,\s*[0-9.]+\]/.test(lakeCollectionBlock),
  'canonical lake centers must be decoded from the mask, not duplicated as literal coordinate arrays');

assert(pindex08.includes('renderOnly: true'));
assert(pindex08.includes('geographyAuthorityUnchanged: true'));
forbidSnippet(pindex08, 'position.setY(', 'Pindex08 detail must not mutate terrain height');
forbidSnippet(pindex08, '.position.y =', 'Pindex08 detail must not mutate terrain height');

const report = Object.freeze({
  policyIds: {
    mountain: WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id,
    terrainConform: TERRAIN_LAKE_BASIN_CONFORM_POLICY.id,
    pindex08: PINDEX08_DETAIL_POLICY.id,
  },
  authorities: {
    surfaceMaskSha256: WORLD_REFERENCE_BASE_SURFACE_MASK.maskSha256,
    lakeCellCount: WORLD_REFERENCE_LAKE_CELL_COUNT,
    pindex08RenderOnly: PINDEX08_DETAIL_POLICY.renderOnly,
    pindex08GeographyAuthorityUnchanged: PINDEX08_DETAIL_POLICY.geographyAuthorityUnchanged,
  },
  sourceDigests: {
    [terrainPath]: sha256(terrain),
    [mountainPath]: sha256(mountain),
    [pindex08Path]: sha256(pindex08),
    [surfacePath]: sha256(surface),
  },
  sourceSizes: {
    terrainLines: terrain.split('\n').length,
    mountainLines: mountain.split('\n').length,
    pindex08Lines: pindex08.split('\n').length,
    surfaceLines: surface.split('\n').length,
    terrainBytes: Buffer.byteLength(terrain, 'utf8'),
    mountainBytes: Buffer.byteLength(mountain, 'utf8'),
  },
  dryEnhancementExponent: TERRAIN_LAKE_BASIN_CONFORM_POLICY.dryEnhancementExponent,
  theoreticalMinimumDryScale: round(
    WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.lakeBasinTaper.minimumScale
      ** TERRAIN_LAKE_BASIN_CONFORM_POLICY.dryEnhancementExponent,
    6,
  ),
});

writeJsonArtifact('artifacts/lake-basin-exact-head/source-regression.json', report);
console.log('[checkLakeBasinSourceRegression] PASS');
console.log(JSON.stringify(report, null, 2));
