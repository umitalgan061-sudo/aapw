#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createNaturalGeology,
  createValyriaVolcanicSurface,
  disposeNaturalGeology,
  NATURAL_GEOLOGY_RENDER_POLICY,
} from '../src/3d/world/naturalGeology.js';
import { WORLD_SCALE } from '../src/3d/config.js';

assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.renderOnly, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.geographyAuthorityUnchanged, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.canonicalTerrainOwnsValyriaSurface, true);
assert.equal(NATURAL_GEOLOGY_RENDER_POLICY.legacyValyriaSurfaceOverlayEnabled, false);

const seaLevelMeters = 6;
const sampleHeightMeters = (x, z) => 132
  + Math.sin(x / 510) * 18
  + Math.cos(z / 430) * 13
  + Math.sin((x + z) / 190) * 6;

const result = createNaturalGeology({
  sampleHeightMeters,
  seaLevelMeters,
  seed: 1337,
  seats: [],
  roadEdges: [],
  worldWidthMeters: WORLD_SCALE.WORLD_WIDTH_METERS,
  worldDepthMeters: WORLD_SCALE.WORLD_DEPTH_METERS,
  isMobileClass: false,
});

assert(result?.group?.isGroup, 'natural geology did not return a render group');
assert(result.placements.length > 20, `synthetic geology fixture produced too few placements: ${result.placements.length}`);
assert.equal(result.group.getObjectByName(NATURAL_GEOLOGY_RENDER_POLICY.valyriaSurfaceName), undefined,
  'production natural-geology group reintroduced the duplicate Valyria surface overlay');
assert.equal(result.group.userData.naturalGeology.valyriaSurfaceAuthority, 'canonical-terrain');
assert.equal(result.group.userData.naturalGeology.legacyValyriaSurfaceOverlayEnabled, false);
assert.equal(result.group.userData.naturalGeology.valyriaSurface, undefined,
  'production metadata still claims ownership of a second Valyria surface');

const geologyMeshes = [];
result.group.traverse((node) => {
  if (node.isMesh || node.isInstancedMesh) geologyMeshes.push(node);
});
assert(geologyMeshes.length >= 2, 'asset-informed/procedural outcrop families disappeared');
assert(geologyMeshes.every((mesh) => mesh.name !== NATURAL_GEOLOGY_RENDER_POLICY.valyriaSurfaceName),
  'legacy Valyria overlay is still reachable through production geology traversal');

// The legacy helper stays callable only as a diagnostic comparison surface. Keeping this explicit
// helper makes the retirement reversible for QA while preventing it from entering the shipped scene.
const diagnostic = createValyriaVolcanicSurface({
  sampleHeightMeters,
  seaLevelMeters,
  worldWidthMeters: WORLD_SCALE.WORLD_WIDTH_METERS,
  worldDepthMeters: WORLD_SCALE.WORLD_DEPTH_METERS,
  gridMeters: 180,
});
assert(diagnostic?.isMesh, 'diagnostic legacy surface helper disappeared unexpectedly');
assert.equal(diagnostic.name, NATURAL_GEOLOGY_RENDER_POLICY.valyriaSurfaceName);
assert.equal(diagnostic.userData.valyriaVolcanicSurface?.legacyDebugOnly, true,
  'legacy overlay helper is not explicitly marked debug-only');
assert(diagnostic.geometry.getAttribute('position').count > 0, 'diagnostic comparison surface is empty');
diagnostic.geometry.dispose();
diagnostic.material.dispose();

disposeNaturalGeology(result.group);
assert.equal(result.group.children.length, 0, 'natural geology disposal left scene children behind');

console.log('[checkValyriaSingleSurfaceAuthority] PASS');
console.log(JSON.stringify({
  policyId: NATURAL_GEOLOGY_RENDER_POLICY.id,
  placementCount: result.placements.length,
  productionRenderableCount: geologyMeshes.length,
  valyriaSurfaceAuthority: 'canonical-terrain',
  duplicateOverlayCount: 0,
  legacyDiagnosticTriangleCount: diagnostic.geometry.index?.count ? diagnostic.geometry.index.count / 3 : 0,
}, null, 2));
