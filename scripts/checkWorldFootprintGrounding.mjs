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

function assertWorldPointInsideOrientedFootprint(point, footprint, label) {
  const dx = point.x - footprint.centerX;
  const dz = point.z - footprint.centerZ;
  const alongX = dx * footprint.axisX.x + dz * footprint.axisX.z;
  const alongZ = dx * footprint.axisZ.x + dz * footprint.axisZ.z;
  assert(
    Math.abs(alongX) <= footprint.halfWidthMeters + 1e-6,
    `${label}: projected X ${alongX} must stay inside half-width ${footprint.halfWidthMeters}`,
  );
  assert(
    Math.abs(alongZ) <= footprint.halfDepthMeters + 1e-6,
    `${label}: projected Z ${alongZ} must stay inside half-depth ${footprint.halfDepthMeters}`,
  );
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

// Imported GLB/FBX structures are frequently a root Group with transformed child meshes rather than
// one root mesh. Lock that hierarchy contract: root yaw + non-uniform scale + a locally rotated and
// offset child must still publish one root-oriented footprint containing every real child base corner.
const nested = new THREE.Group();
nested.position.set(-210, 280, 165);
nested.rotation.y = Math.PI / 6;
nested.scale.set(1.65, 1, 0.72);
const nestedGeometry = new THREE.BoxGeometry(10, 7, 24);
nestedGeometry.translate(0, 3.5, 0);
const nestedChild = new THREE.Mesh(nestedGeometry, new THREE.MeshBasicMaterial());
nestedChild.position.set(4, 0, -3);
nestedChild.rotation.y = Math.PI / 9;
nestedChild.scale.set(1.15, 1, 0.85);
nested.add(nestedChild);
nested.updateMatrixWorld(true);
let nestedConformCall = null;
const nestedResult = resolveWorldSurfacePlacement(nested, {
  metadata: { category: 'building', id: 'nested-imported-hall' },
  surfaceQuery: buildingSurface,
  requireSurfaceContext: true,
  conformTerrain(payload) {
    nestedConformCall = payload;
    return { ok: true, height: payload.targetHeight };
  },
});
assert.equal(nestedResult.ok, true, nestedResult.error);
assert.equal(nestedConformCall?.samples?.length, 9, 'nested imported structures must keep the complete footprint probe set');
assert(nestedConformCall?.orientedFootprint, 'nested imported structures must publish a root-oriented footprint');
nestedGeometry.computeBoundingBox();
for (const x of [nestedGeometry.boundingBox.min.x, nestedGeometry.boundingBox.max.x]) {
  for (const z of [nestedGeometry.boundingBox.min.z, nestedGeometry.boundingBox.max.z]) {
    const worldCorner = nestedChild.localToWorld(new THREE.Vector3(x, nestedGeometry.boundingBox.min.y, z));
    assertWorldPointInsideOrientedFootprint(
      worldCorner,
      nestedConformCall.orientedFootprint,
      `nested child base corner ${x},${z}`,
    );
  }
}
assert(
  nestedConformCall.orientedFootprint.halfWidthMeters > 5 && nestedConformCall.orientedFootprint.halfDepthMeters > 5,
  'nested child transforms and non-uniform root scale must materially contribute to the resolved footprint',
);
assert.equal(
  nestedConformCall.targetHeight,
  Math.max(...nestedConformCall.samples.map((sample) => sample.height)),
  'nested structure terrain conforming must target the highest real footprint probe',
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

console.log('[checkWorldFootprintGrounding] PASS: structures sample their root-oriented footprint, nested transformed child geometry remains covered, foundations never hover on the low side, terrain conforming targets the complete probe set, and non-structures keep centre snapping.');
