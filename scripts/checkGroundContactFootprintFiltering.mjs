#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolveWorldSurfacePlacement } from '../src/3d/world/WorldAssetPlacementPipeline.js';

function surface(x, z) {
  return {
    height: 18 + x * 0.012 - z * 0.009,
    slopeDegrees: 3,
    waterDepth: 0,
    roadDistance: 5,
    biome: 'settlement',
  };
}

function addBox(root, {
  width,
  height,
  depth,
  x = 0,
  y = 0,
  z = 0,
  exclude = false,
  name = 'part',
}) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(0, height * 0.5, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.name = name;
  mesh.position.set(x, y, z);
  if (exclude) mesh.userData.terrainFootprintExclude = true;
  root.add(mesh);
  return mesh;
}

const structure = new THREE.Group();
structure.position.set(135, 250, -90);
structure.rotation.y = Math.PI / 7;

// True ground-contact body: 12 x 20 m.
addBox(structure, { width: 12, height: 8, depth: 20, name: 'grounded-main-hall' });

// A low raised annex begins only 0.8 m above the global foundation. It still belongs to the
// foundation band and extends the real footprint from x=+6 to x=+9.
addBox(structure, {
  width: 4,
  height: 4,
  depth: 4,
  x: 7,
  y: 0.8,
  name: 'low-raised-annex',
});

// Imported roofs, banners, balconies and marker/helper meshes can have much wider X/Z extents but
// no contact with the foundation plane. They must not force terrain flattening under empty air.
addBox(structure, {
  width: 60,
  height: 3,
  depth: 60,
  y: 10,
  name: 'elevated-roof-and-balcony-envelope',
});

// Authors also need an explicit escape hatch for floor-level helper/collision geometry that should
// never own terrain. This proxy is intentionally enormous and touches y=0.
addBox(structure, {
  width: 80,
  height: 1,
  depth: 80,
  exclude: true,
  name: 'editor-collision-helper',
});

structure.updateMatrixWorld(true);
let conformPayload = null;
const result = resolveWorldSurfacePlacement(structure, {
  metadata: { category: 'building', id: 'ground-contact-filter-fixture' },
  surfaceQuery: surface,
  requireSurfaceContext: true,
  conformTerrain(payload) {
    conformPayload = payload;
    return { ok: true, height: payload.targetHeight };
  },
});

assert.equal(result.ok, true, result.error);
assert.equal(result.footprint?.groundingMode, 'terrain-conform');
assert.equal(result.footprint?.samples?.length, 9, 'ground-contact filtering must keep the canonical 9-probe contract');
assert(conformPayload?.orientedFootprint, 'ground-contact geometry must still publish an oriented footprint');

const footprint = conformPayload.orientedFootprint;
assert(
  Math.abs(footprint.halfWidthMeters - 7.5) < 1e-5,
  `grounded body + low annex should resolve to 15 m width, got ${footprint.halfWidthMeters * 2}`,
);
assert(
  Math.abs(footprint.halfDepthMeters - 10) < 1e-5,
  `elevated 60 m roof/helper must not inflate the grounded 20 m depth, got ${footprint.halfDepthMeters * 2}`,
);

// The local X footprint is [-6, +9], so the local centre is +1.5. Verify its world-space centre
// after root yaw, proving the filter did not silently fall back to a world AABB.
const expectedCenter = structure.localToWorld(new THREE.Vector3(1.5, 0, 0));
assert(Math.abs(footprint.centerX - expectedCenter.x) < 1e-5, 'filtered footprint centre X must stay root-oriented');
assert(Math.abs(footprint.centerZ - expectedCenter.z) < 1e-5, 'filtered footprint centre Z must stay root-oriented');

const expectedArea = 15 * 20;
const compatibilityArea = conformPayload.bounds.width * conformPayload.bounds.depth;
assert(
  compatibilityArea >= expectedArea - 1e-6,
  'world AABB compatibility envelope must still contain the tighter ground-contact footprint',
);
assert(
  compatibilityArea < 60 * 60,
  'elevated roof envelope must not leak back into terrain-conform bounds',
);

assert.equal(
  conformPayload.targetHeight,
  Math.max(...conformPayload.samples.map((sample) => sample.height)),
  'terrain conformer must still target the highest ground-contact footprint probe',
);

// Control: if the wide mesh actually touches the floor and is not opted out, it legitimately owns
// the terrain footprint. This prevents the filter from becoming a generic "ignore large children" hack.
const groundedWide = new THREE.Group();
groundedWide.position.set(-40, 10, 60);
addBox(groundedWide, { width: 10, height: 5, depth: 12, name: 'core' });
addBox(groundedWide, { width: 44, height: 2, depth: 32, y: 0.2, name: 'grounded-wide-plinth' });
groundedWide.updateMatrixWorld(true);
let groundedPayload = null;
const groundedResult = resolveWorldSurfacePlacement(groundedWide, {
  metadata: { category: 'building' },
  surfaceQuery: surface,
  requireSurfaceContext: true,
  conformTerrain(payload) {
    groundedPayload = payload;
    return { ok: true, height: payload.targetHeight };
  },
});
assert.equal(groundedResult.ok, true, groundedResult.error);
assert(groundedPayload?.orientedFootprint?.halfWidthMeters >= 21.9, 'near-floor wide plinth must remain part of the real foundation');
assert(groundedPayload?.orientedFootprint?.halfDepthMeters >= 15.9, 'near-floor wide plinth depth must remain part of the real foundation');

console.log('[checkGroundContactFootprintFiltering] PASS: elevated-only/import helper geometry no longer inflates terrain foundations, low raised/grounded parts remain included, explicit helper opt-out is honored, and the canonical oriented 9-probe contract is preserved.');
