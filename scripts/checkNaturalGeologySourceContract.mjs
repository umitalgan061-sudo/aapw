#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NATURAL_GEOLOGY_PLACEMENT_POLICY } from '../src/3d/world/naturalGeologyPlacement.js';

const ROOT = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');
const placementSource = read('src/3d/world/naturalGeologyPlacement.js');
const renderSource = read('src/3d/world/naturalGeology.js');
const valyriaSource = read('src/3d/world/valyriaGeology.js');
const manifest = JSON.parse(read('assets_manifest.json'));

assert.equal(NATURAL_GEOLOGY_PLACEMENT_POLICY.renderOnly, true);
assert.equal(NATURAL_GEOLOGY_PLACEMENT_POLICY.geographyAuthorityUnchanged, true);
assert.equal(NATURAL_GEOLOGY_PLACEMENT_POLICY.heightAuthority, 'world/terrain.js');
assert.equal(NATURAL_GEOLOGY_PLACEMENT_POLICY.deterministic, true);
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.minimumNearestNeighborMeters >= 20);
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.settlementReserveMeters >= 120);
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.roadReserveMeters >= 18);
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.shorelineReserveMeters >= 8);

for (const snippet of ['generateNaturalGeologyPlacements', 'sampleTerrainFrame', 'minimumDistanceToRoadMeters', 'minimumDistanceToSeatMeters', 'regionalStrataAngle', 'minimumNearestNeighborMeters', "kind === 'asset-proxy'", 'valyriaInfluenceAtWorldXZ']) {
  assert(placementSource.includes(snippet), `placement contract lost: ${snippet}`);
}
for (const snippet of ["from '../assetLoader.js'", 'createNaturalGeology', 'createValyriaVolcanicSurface', 'upgradeNaturalGeologyAssets', 'createNaturalRockPrototypeGeometry', 'validateNaturalGeologyAsset', 'hostedPreflightMinBytes', 'maximumHydratedSourceBytes', 'referenceLandscapeRuntimeLoad: false', 'assets/models/fbx/rocky_terrain_low_poly.glb', 'assets/models/fbx/desert_rocks.glb', 'assets/models/fbx/rugged_mountain_landscape.glb']) {
  assert(renderSource.includes(snippet), `renderer contract lost: ${snippet}`);
}
for (const snippet of ['valyria-asset-informed-doom-geology-2026-08-27-v2', 'coreCenter', 'neckCenter', 'canonicalCoastlinePreserved: true', 'valyriaInfluence01', 'valyriaUpliftMeters', 'valyriaSurfaceWeights', 'applyValyriaSurfaceColor', 'valyriaGeologyClassAtWorldXZ']) {
  assert(valyriaSource.includes(snippet), `Valyria contract lost: ${snippet}`);
}
assert(!valyriaSource.includes("from 'three'"), 'Valyria authority must remain renderer-independent');
assert(!valyriaSource.includes('Math.random()'), 'Valyria geology must remain deterministic');
for (const forbidden of ['Math.random()', 'setTerrainHeight', 'writeHeight', 'flattenPads.push', 'WORLD_REFERENCE_BASE_SURFACE_MASK =', 'createHeightSampler(']) {
  assert(!placementSource.includes(forbidden), `placement became geography authority: ${forbidden}`);
  assert(!renderSource.includes(forbidden), `render layer became geography authority: ${forbidden}`);
}

const manifestFiles = new Set(manifest.assets.map((entry) => entry.file));
for (const file of [...NATURAL_GEOLOGY_PLACEMENT_POLICY.directAssetFamilies, ...NATURAL_GEOLOGY_PLACEMENT_POLICY.referenceOnlyAssets]) {
  assert(manifestFiles.has(file), `unregistered geology model: ${file}`);
}
assert(NATURAL_GEOLOGY_PLACEMENT_POLICY.knownLfsBytes['assets/models/fbx/rugged_mountain_landscape.glb'] > 40_000_000);
assert(!renderSource.includes('loadModel(NATURAL_GEOLOGY_RENDER_POLICY.referenceLandscapeAsset'), '50MB landscape must remain reference-only');

console.log('[checkNaturalGeologySourceContract] PASS');
console.log(JSON.stringify({ policyId: NATURAL_GEOLOGY_PLACEMENT_POLICY.id, directAssets: NATURAL_GEOLOGY_PLACEMENT_POLICY.directAssetFamilies, referenceOnlyAssets: NATURAL_GEOLOGY_PLACEMENT_POLICY.referenceOnlyAssets, knownLfsBytes: NATURAL_GEOLOGY_PLACEMENT_POLICY.knownLfsBytes, valyriaPolicy: NATURAL_GEOLOGY_PLACEMENT_POLICY.valyriaPolicyId }, null, 2));
