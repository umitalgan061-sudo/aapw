#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const REPORT = 'artifacts/winter-tree-visual-qa/snow-pine-report.json';
const report = JSON.parse(await readFile(REPORT, 'utf8'));

assert.equal(
  report.assetPath,
  'assets/models/vegetation/pine_Zt62gceKXZ.glb',
  'material-slot proof must inspect the hydrated preferred pine, not a fallback asset',
);
assert.equal(report.status?.status, 'active', 'hydrated preferred pine must be the active runtime representation');
assert.equal(report.proceduralHidden, true, 'procedural pine must be hidden after the real model activates');
assert.equal(report.replacementMeshes, report.materials?.length, 'every replacement mesh must expose one auditable material slot');
assert.equal(report.replacementMeshes, 2, 'verified preferred pine currently has distinct trunk and foliage render meshes');

const trunk = report.materials.find((material) => material.treatment === 'winter-trunk-source-map');
const foliage = report.materials.find((material) => material.treatment === 'snow-foliage-shader');
assert(trunk, 'hydrated preferred pine must preserve its separately treated trunk material');
assert(foliage, 'hydrated preferred pine must preserve its separately treated foliage material');

assert.equal(trunk.map, true, 'trunk treatment must retain the imported source texture map');
assert.equal(foliage.map, true, 'foliage treatment must retain the imported source texture map');
assert.equal(trunk.metalness, 0, 'tree bark must remain non-metallic');
assert.equal(foliage.metalness, 0, 'snowy needles must remain non-metallic');
assert(trunk.opacity > 0 && foliage.opacity > 0, 'both imported material surfaces must remain visible');
assert(
  foliage.transparent === true || foliage.alphaTest > 0,
  'foliage must retain an alpha-cut/transparent silhouette rather than becoming an opaque slab',
);
assert.notEqual(
  trunk.treatment,
  foliage.treatment,
  'trunk and foliage must never collapse to a single whole-model material treatment',
);

assert(report.bounds?.size?.[1] > 8.5 && report.bounds.size[1] < 8.7, 'material proof must remain attached to the normalized 8.6 m runtime tree');
assert(report.browserErrors?.length === 0, 'hydrated material-slot proof must be free of browser/console errors');

console.log('[checkWinterPineHydratedMaterialSlots] PASS', JSON.stringify({
  asset: report.assetPath,
  replacementMeshes: report.replacementMeshes,
  treatments: report.materials.map((material) => material.treatment),
  mappedMaterials: report.materials.filter((material) => material.map).length,
  foliageAlpha: { transparent: foliage.transparent, alphaTest: foliage.alphaTest },
  heightMeters: report.bounds.size[1],
}));
