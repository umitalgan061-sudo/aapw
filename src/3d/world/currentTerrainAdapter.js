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

// settlements.js currently publishes a 38m fully-flat castle pad with a 75m easing edge. That
// radius was tuned for the historical procedural terrain. The current full-map source can carry a
// much larger height delta at a seat (especially where seat-safe hydrology raises coastal castles),
// so the same 37m transition ring can create a short >20-degree cart approach. Widen only pads that
// exactly match the established settlement contract; custom gameplay/editor flatten pads retain
// their caller-owned radii. The 225m outer edge keeps even high coastal seats on a gradual approach
// while remaining local relative to the multi-kilometre road network. Both render chunks and every
// height sampler pass through this helper, preserving the single-source render/physics invariant.
const SETTLEMENT_PAD_INNER_RADIUS_METERS = 38;
const LEGACY_SETTLEMENT_PAD_OUTER_RADIUS_METERS = 75;
const CURRENT_SETTLEMENT_PAD_OUTER_RADIUS_METERS = 225;
const RADIUS_EPSILON = 1e-9;

function currentTerrainFlattenPads(flattenPads = []) {
  return flattenPads.map((pad) => {
    const isSettlementPad = Math.abs(pad.innerRadiusMeters - SETTLEMENT_PAD_INNER_RADIUS_METERS) <= RADIUS_EPSILON
      && Math.abs(pad.outerRadiusMeters - LEGACY_SETTLEMENT_PAD_OUTER_RADIUS_METERS) <= RADIUS_EPSILON;
    return isSettlementPad
      ? { ...pad, outerRadiusMeters: CURRENT_SETTLEMENT_PAD_OUTER_RADIUS_METERS }
      : pad;
  });
}

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
  // Keep canonical settlement-pad metadata truthful for callers that retain the same objects after
  // constructing a sampler (including ADR-0118's boundary guard): if the adapter widens a known
  // 38m/75m castle pad, its caller-visible outer radius must describe the same 225m influence the
  // returned sampler actually applies. Custom/editor pads never clone here and therefore retain
  // their caller-owned radii unchanged.
  for (let index = 0; index < flattenPads.length; index += 1) {
    const currentPad = currentTerrainFlattenPads([flattenPads[index]])[0];
    if (currentPad !== flattenPads[index] && Object.isExtensible(flattenPads[index])) {
      flattenPads[index].outerRadiusMeters = currentPad.outerRadiusMeters;
    }
  }
  return createCurrentTerrainHeightSampler({ flattenPads: currentTerrainFlattenPads(flattenPads) });
}

/** Drop-in replacement for terrain.js createTerrainChunk used by every ChunkManager/LOD path. */
export function createTerrainChunk(options) {
  const mesh = createLegacyTerrainChunk(options);
  const flattenPads = currentTerrainFlattenPads(options?.flattenPads ?? []);
  const sampleHeightMeters = createCurrentTerrainHeightSampler({ flattenPads });
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
