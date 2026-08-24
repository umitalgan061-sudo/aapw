#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolveWorldSurfacePlacement } from '../src/3d/world/WorldAssetPlacementPipeline.js';

function buildingSurface(x, z) {
  return {
    height: 42 + x * 0.035 - z * 0.018,
    slopeDegrees: 5,
    waterDepth: 0,
    roadDistance: 6,
    biome: 'settlement',
  };
}

function makeFoundationMesh() {
  const geometry = new THREE.BoxGeometry(8, 5, 12);
  geometry.translate(0, 2.5, 0);
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(120, 300, -75);
  mesh.rotation.y = Math.PI / 5;
  mesh.updateMatrixWorld(true);
  return mesh;
}

const embedded = makeFoundationMesh();
const embeddedResult = resolveWorldSurfacePlacement(embedded, {
  metadata: { category: 'building' },
  surfaceQuery: buildingSurface,
  requireSurfaceContext: true,
  foundationInsetMeters: 0.04,
});
assert.equal(embeddedResult.ok, true, embeddedResult.error);
assert.equal(embeddedResult.footprint?.groundingMode, 'embedded-low-side');
assert.equal(embeddedResult.footprint?.samples?.length, 9, 'building grounding must sample centre + 8 footprint probes');
assert(embeddedResult.footprint.heightRange > 0, 'test terrain must vary across the rotated footprint');

embedded.updateMatrixWorld(true);
const embeddedBox = new THREE.Box3().setFromObject(embedded);
assert(
  embeddedBox.min.y <= embeddedResult.footprint.minHeight,
  `foundation underside ${embeddedBox.min.y} must not sit above low-side terrain ${embeddedResult.footprint.minHeight}`,
);
for (const sample of embeddedResult.footprint.samples) {
  assert(
    embeddedBox.min.y <= sample.height + 1e-9,
    `foundation underside ${embeddedBox.min.y} must not float above sample ${sample.height}`,
  );
}

let conformCall = null;
const conformed = makeFoundationMesh();
const conformedResult = resolveWorldSurfacePlacement(conformed, {
  metadata: { category: 'building' },
  surfaceQuery: buildingSurface,
  requireSurfaceContext: true,
  foundationInsetMeters: 0.02,
  conformTerrain(payload) {
    conformCall = payload;
    return { ok: true, height: payload.targetHeight };
  },
});
assert.equal(conformedResult.ok, true, conformedResult.error);
assert.equal(conformedResult.footprint?.groundingMode, 'terrain-conform');
assert.equal(conformCall?.samples?.length, 9, 'terrain conformer receives the complete footprint');
assert(conformCall?.orientedFootprint, 'terrain conformer must receive the root-oriented footprint basis');
assert(Math.abs(conformCall.orientedFootprint.halfWidthMeters - 4) < 1e-6, 'rotated 8m local width must remain 8m instead of inflating to its world AABB');
assert(Math.abs(conformCall.orientedFootprint.halfDepthMeters - 6) < 1e-6, 'rotated 12m local depth must remain 12m instead of inflating to its world AABB');
assert(conformCall.bounds.width * conformCall.bounds.depth > 96, 'world AABB remains a conservative compatibility envelope around the tighter oriented footprint');
assert.equal(conformCall.targetHeight, conformedResult.footprint.maxHeight, 'conformer targets the high-side foundation plane');

conformed.updateMatrixWorld(true);
const conformedBox = new THREE.Box3().setFromObject(conformed);
assert(
  Math.abs(conformedBox.min.y - (conformedResult.footprint.targetGroundHeight - 0.02)) < 1e-6,
  'conformed foundation underside must align to the returned terrain plane minus the anti-seam inset',
);

const tree = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1), new THREE.MeshBasicMaterial());
tree.position.set(10, 999, 15);
const treeResult = resolveWorldSurfacePlacement(tree, {
  metadata: { category: 'tree' },
  surfaceQuery: () => ({
    height: 12.5,
    slopeDegrees: 4,
    waterDepth: 0,
    roadDistance: 5,
    biome: 'temperate-forest',
  }),
  requireSurfaceContext: true,
});
assert.equal(treeResult.ok, true, treeResult.error);
assert.equal(treeResult.footprint, null, 'non-structure assets keep the established centre-sample path');
assert.equal(tree.position.y, 12.5);

console.log('[checkWorldFootprintGrounding] PASS: structures sample their root-oriented footprint, never hover on the low side, expose an oriented terrain-conform hook, and non-structures keep centre snapping.');
