/**
 * Browser-only compatibility adapter for world/terrain.js.
 *
 * game3d.html/editor.html map the historical terrain module URL to this module. Every existing live
 * consumer therefore keeps its established import API while receiving the current full-map height
 * source. The legacy module is loaded with a query suffix only for deterministic PRNG/disposal and
 * mesh construction; every vertex height is overwritten before the mesh is returned.
 */
import {
  createTerrainChunk as createLegacyTerrainChunk,
  disposeTerrainChunk,
  mulberry32,
  DEFAULT_MAX_HEIGHT_METERS,
} from './terrain.js?legacy=1';
import {
  CURRENT_TERRAIN_POLICY,
  createCurrentTerrainHeightSampler,
} from './currentTerrainRuntime.js';

export { disposeTerrainChunk, mulberry32, DEFAULT_MAX_HEIGHT_METERS };
export { CURRENT_TERRAIN_POLICY } from './currentTerrainRuntime.js';

export const CURRENT_TERRAIN_ADAPTER_POLICY = Object.freeze({
  id: 'current-terrain-browser-adapter-2026-08-14-v1',
  terrainPolicyId: CURRENT_TERRAIN_POLICY.id,
  renderAndPhysicsSingleSource: true,
  legacyProceduralFallback: false,
});

function publishRuntimeUse(kind) {
  if (typeof globalThis === 'undefined') return;
  const prior = globalThis.__WESTEROS_CURRENT_TERRAIN__ ?? { samplers: 0, chunks: 0 };
  const next = {
    policyId: CURRENT_TERRAIN_POLICY.id,
    adapterPolicyId: CURRENT_TERRAIN_ADAPTER_POLICY.id,
    renderAndPhysicsSingleSource: true,
    legacyProceduralFallback: false,
    samplers: prior.samplers + (kind === 'sampler' ? 1 : 0),
    chunks: prior.chunks + (kind === 'chunk' ? 1 : 0),
  };
  globalThis.__WESTEROS_CURRENT_TERRAIN__ = Object.freeze(next);
  if (typeof document !== 'undefined' && document.body) {
    document.body.dataset.currentTerrain = CURRENT_TERRAIN_POLICY.id;
  }
}

/** Drop-in replacement for terrain.js createHeightSampler used by physics/rivers/scene systems. */
export function createHeightSampler(_seed, _fbmOptions, flattenPads = []) {
  publishRuntimeUse('sampler');
  return createCurrentTerrainHeightSampler({ flattenPads });
}

/** Drop-in replacement for terrain.js createTerrainChunk used by every ChunkManager/LOD path. */
export function createTerrainChunk(options) {
  const mesh = createLegacyTerrainChunk(options);
  const sampleHeightMeters = createCurrentTerrainHeightSampler({ flattenPads: options?.flattenPads ?? [] });
  const position = mesh.geometry.getAttribute('position');
  for (let index = 0; index < position.count; index += 1) {
    const worldX = mesh.position.x + position.getX(index);
    const worldZ = mesh.position.z + position.getZ(index);
    position.setY(index, sampleHeightMeters(worldX, worldZ));
  }
  position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  mesh.userData.currentTerrainPolicy = CURRENT_TERRAIN_POLICY.id;
  mesh.userData.currentTerrainSingleSource = true;
  publishRuntimeUse('chunk');
  return mesh;
}
