import assert from 'node:assert/strict';
import {
  TERRAIN_SURFACE_COMPOSITION_POLICY,
  composeSurfaceResponse,
  createTerrainSurfaceMaterialManifest,
  sampleSurfaceGrid,
  assertSurfaceResponseSafe,
} from '../src/3d/world/terrainSurfaceComposition.js';

const base = {
  worldX: 1220,
  worldZ: -860,
  height01: 0.62,
  slope01: 0.48,
  moisture01: 0.31,
  waterDistanceMeters: 180,
  biome: 'temperate',
  seed: 283,
};

const a = composeSurfaceResponse(base);
const b = composeSurfaceResponse(base);
assert.deepEqual(a, b, 'same world sample must be deterministic');
assertSurfaceResponseSafe(a);
assert.equal(TERRAIN_SURFACE_COMPOSITION_POLICY.uvMode, 'world-space');
assert.equal(TERRAIN_SURFACE_COMPOSITION_POLICY.antiTiling, true);

const nearWater = composeSurfaceResponse({ ...base, waterDistanceMeters: 0, moisture01: 0.05 });
assert.ok(nearWater.wet > a.wet, 'shoreline must increase wet response');
assert.ok(nearWater.wetEdge > 0, 'shoreline must expose wet-edge response');

const alpine = composeSurfaceResponse({ ...base, biome: 'alpine', height01: 0.88 });
assert.ok(alpine.snow > a.snow, 'alpine high ground must increase snow response');
assert.ok(alpine.normalGain >= 0);
assert.ok(alpine.normalGain <= TERRAIN_SURFACE_COMPOSITION_POLICY.maxNormalGain);

const gridA = sampleSurfaceGrid({ x: 0, z: 0 }, { x: 64, y: 0, z: 64 }, 8, base);
const gridB = sampleSurfaceGrid({ x: 0, z: 0 }, { x: 64, y: 0, z: 64 }, 8, base);
assert.deepEqual(gridA, gridB, 'surface grids must be deterministic');
assert.ok(gridA.some((sample) => sample.erosionBreakup !== gridA[0].erosionBreakup));

const manifest = createTerrainSurfaceMaterialManifest(base);
assert.equal(manifest.worldSpace, true);
assert.equal(manifest.canonicalAuthority, 'owner-map-height-hydrology-collider');
assert.match(manifest.deterministicKey, /1220\|-860\|283\|temperate/);

assert.throws(
  () => assertSurfaceResponseSafe({ albedoDelta: Infinity, roughnessDelta: 0, normalGain: 0, wetEdge: 0 }),
  /finite/,
);

assert.throws(
  () => assertSurfaceResponseSafe({ albedoDelta: 0.5, roughnessDelta: 0, normalGain: 0, wetEdge: 0 }),
  /albedo/,
);

console.log('TERRAIN_SURFACE_COMPOSITION_PASS');
