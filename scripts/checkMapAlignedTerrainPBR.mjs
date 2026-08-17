#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import {
  CURRENT_TERRAIN_ALBEDO_POLICY,
  CURRENT_TERRAIN_POLICY,
  TERRAIN_MICRO_SURFACE_POLICY,
  createTerrainChunk,
  disposeTerrainChunk,
  terrainMapUvAt,
} from '../src/3d/world/terrain.js';
import { WORLD_REFERENCE_BASE_SURFACE_MASK } from '../src/3d/world/worldReferenceSurfacePindexes.js';

const EPSILON = 1e-7;
const near = (a, b, message) => assert(Math.abs(a - b) <= EPSILON, `${message}: ${a} != ${b}`);

assert.equal(
  CURRENT_TERRAIN_POLICY.sourceMapSha256,
  WORLD_REFERENCE_BASE_SURFACE_MASK.sourceMapSha256,
  'terrain height and canonical map surface must share the exact owner map provenance',
);
assert.equal(
  CURRENT_TERRAIN_ALBEDO_POLICY.sourceMapSha256,
  WORLD_REFERENCE_BASE_SURFACE_MASK.sourceMapSha256,
  'terrain albedo projection must be bound to the same map.png provenance',
);
assert.equal(CURRENT_TERRAIN_ALBEDO_POLICY.mapping, 'full-owner-map-global-uv');
assert.equal(CURRENT_TERRAIN_ALBEDO_POLICY.wrap, 'clamp-to-edge');
assert.equal(CURRENT_TERRAIN_ALBEDO_POLICY.mobileFallback, 'canonical-vertex-color');

const overlayPath = CURRENT_TERRAIN_ALBEDO_POLICY.assetPath;
const mtlPath = CURRENT_TERRAIN_ALBEDO_POLICY.sourceMaterialPath;
const objPath = CURRENT_TERRAIN_ALBEDO_POLICY.sourceMeshPath;
assert(statSync(overlayPath).size > 10_000_000, 'authored terrain overlay must be a real hydrated image, not an LFS pointer');
const mtl = readFileSync(mtlPath, 'utf8');
assert(/map_Kd[^\r\n]*overlay\.png/i.test(mtl), 'terrain MTL must prove overlay.png is the authored diffuse source');
const kd = mtl.match(/^\s*Kd\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/m);
assert(kd, 'terrain MTL must declare its diffuse factor');
for (const component of kd.slice(1).map(Number)) {
  near(component, CURRENT_TERRAIN_ALBEDO_POLICY.sourceDiffuseFactor, 'runtime authored diffuse factor must match source MTL Kd');
}
const objHeader = readFileSync(objPath, 'utf8').slice(0, 1024);
assert(objHeader.includes('# object Terrain'), 'authored mesh family must identify its terrain object');

const probes = [
  [0, 0], [-250, -250], [250, 250], [-1750, 900], [2200, -1300],
];
for (const [x, z] of probes) {
  const first = terrainMapUvAt(x, z);
  const second = terrainMapUvAt(x, z);
  assert.deepEqual(first, second, `map UV must be deterministic at ${x},${z}`);
  assert(first.u >= 0 && first.u <= 1 && first.v >= 0 && first.v <= 1, 'map UV must remain clamped to owner-map texture domain');
}
assert(terrainMapUvAt(-250, 0).u < terrainMapUvAt(250, 0).u, 'west-to-east world movement must advance U without mirrored geography');
assert(terrainMapUvAt(0, -250).v > terrainMapUvAt(0, 250).v, 'south-to-north map movement must preserve the explicit top-down V flip');

const west = createTerrainChunk({ chunkX: 0, chunkZ: 0, size: 500, segments: 2, seed: 77 });
const east = createTerrainChunk({ chunkX: 1, chunkZ: 0, size: 500, segments: 2, seed: 77 });
assert.equal(west.material.isMeshStandardMaterial, true, 'terrain must stay on physically based MeshStandardMaterial');
assert.equal(west.material.roughness, TERRAIN_MICRO_SURFACE_POLICY.roughnessBase, 'macro material must expose the micro-PBR base roughness');
assert.equal(west.material.metalness, 0);
assert.equal(west.material.map, null, 'headless regression must use the intentional canonical-color fallback');
assert.equal(west.userData.currentTerrainAlbedo.mapAlignedUv, true);
assert.equal(west.userData.currentTerrainAlbedo.textureEnabled, false);
assert.equal(west.userData.currentTerrainAlbedo.authoredColorFidelity, false, 'headless fallback must not claim authored texture color fidelity');

function boundary(mesh, localX) {
  const position = mesh.geometry.getAttribute('position');
  const uv = mesh.geometry.getAttribute('uv');
  const rows = [];
  for (let i = 0; i < position.count; i += 1) {
    if (Math.abs(position.getX(i) - localX) > EPSILON) continue;
    rows.push({ z: position.getZ(i), y: position.getY(i), u: uv.getX(i), v: uv.getY(i) });
  }
  return rows.sort((a, b) => a.z - b.z);
}

const westEdge = boundary(west, 250);
const eastEdge = boundary(east, -250);
assert.equal(westEdge.length, 3, 'expected all west chunk seam vertices');
assert.equal(eastEdge.length, westEdge.length, 'adjacent chunk seam vertex count must match');
for (let i = 0; i < westEdge.length; i += 1) {
  near(westEdge[i].z, eastEdge[i].z, 'adjacent seam local Z');
  near(westEdge[i].y, eastEdge[i].y, 'adjacent seam canonical height');
  near(westEdge[i].u, eastEdge[i].u, 'adjacent seam global U');
  near(westEdge[i].v, eastEdge[i].v, 'adjacent seam global V');
}

disposeTerrainChunk(west);
disposeTerrainChunk(east);
console.log('[checkMapAlignedTerrainPBR] PASS: map.png provenance, authored terrain diffuse source/factor, global non-tiling UVs, seam continuity, PBR material and mobile/headless fallback are deterministic.');
