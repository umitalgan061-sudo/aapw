import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolveWorldSurfacePlacement } from '../src/3d/world/WorldAssetPlacementPipeline.js';

function addWing(root, x) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(16, 4, 16), new THREE.MeshBasicMaterial());
  mesh.position.set(x, 2, 0);
  root.add(mesh);
  return mesh;
}

const structure = new THREE.Group();
addWing(structure, -60);
addWing(structure, -20);
addWing(structure, 60);
structure.updateMatrixWorld(true);

// Aggregate footprint probes sit at x=-68, 0, 68 and therefore all miss the narrow high middle
// wing at x=-20. Island-local sampling must still discover the 42m ridge below that wing.
const terrainHeight = (x, z) => (Math.abs(x + 20) <= 8 && Math.abs(z) <= 8 ? 42 : 10);
let conformPayload = null;
const result = resolveWorldSurfacePlacement(structure, {
  footprintGrounding: 'always',
  placementPolicy: {},
  groundHeight: terrainHeight,
  conformTerrain(payload) {
    conformPayload = payload;
    return { ok: true, height: payload.targetHeight };
  },
});

assert.equal(result.ok, true, 'compound structure placement succeeds');
assert.ok(conformPayload, 'terrain conform callback receives payload');
assert.equal(result.footprint.samples.length, 9, 'aggregate footprint remains canonical nine probes');
assert.equal(result.footprint.footprintIslands.length, 3, 'three disconnected ground-contact islands retained');
assert.equal(result.footprint.islandSamples.length, 27, 'each island contributes nine terrain samples');
assert.equal(conformPayload.islandPoints.length, 27, 'conformer receives island-local point diagnostics');
assert.equal(conformPayload.islandSamples.length, 27, 'conformer receives island-local surface diagnostics');
assert.equal(Math.max(...conformPayload.samples.map((sample) => sample.height)), 10, 'aggregate nine probes reproduce blind spot');
assert.equal(Math.max(...conformPayload.islandSamples.map((sample) => sample.height)), 42, 'island-local probes capture middle ridge');
assert.equal(conformPayload.maxHeight, 42, 'foundation target includes island-local maximum');
assert.equal(conformPayload.targetHeight, 42, 'terrain conform target rises to highest true island contact');
assert.equal(result.footprint.maxHeight, 42, 'stored footprint reports combined maximum');
assert.equal(result.footprint.minHeight, 10, 'stored footprint reports combined minimum');
assert.equal(result.footprint.targetGroundHeight, 42, 'placed structure uses corrected target height');
assert.ok(Math.abs(structure.position.y - 41.96) < 1e-9, 'default 4cm inset is applied below corrected foundation plane');

// No conform callback: the embedded fallback must also consider island-local samples when choosing
// its lowest safe plane. Use a high aggregate envelope with one lower disconnected island.
const embedded = new THREE.Group();
addWing(embedded, -60);
addWing(embedded, -20);
addWing(embedded, 60);
embedded.updateMatrixWorld(true);
const lowIslandTerrain = (x, z) => (Math.abs(x + 20) <= 8 && Math.abs(z) <= 8 ? 6 : 10);
const embeddedResult = resolveWorldSurfacePlacement(embedded, {
  footprintGrounding: 'always',
  placementPolicy: {},
  groundHeight: lowIslandTerrain,
});
assert.equal(embeddedResult.ok, true);
assert.equal(embeddedResult.footprint.groundingMode, 'embedded-low-side');
assert.equal(embeddedResult.footprint.minHeight, 6, 'embedded fallback includes lower island samples');
assert.equal(embeddedResult.footprint.targetGroundHeight, 6, 'embedded fallback chooses true lowest island contact');
assert.ok(Math.abs(embedded.position.y - 5.96) < 1e-9, 'embedded placement uses corrected island-local minimum');

console.log('FOUNDATION_ISLAND_PLACEMENT_SAMPLING_OK', JSON.stringify({
  aggregateProbeCount: result.footprint.samples.length,
  islandProbeCount: result.footprint.islandSamples.length,
  aggregateMaximum: Math.max(...conformPayload.samples.map((sample) => sample.height)),
  correctedMaximum: result.footprint.maxHeight,
  embeddedMinimum: embeddedResult.footprint.minHeight,
}));
