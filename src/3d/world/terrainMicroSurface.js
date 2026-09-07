/**
 * Composite render-only terrain PBR surface.
 *
 * The mature generic terrain photoreal shader lives in `terrainMicroSurfaceCore.js`. This public
 * facade deliberately keeps its API stable while layering the dedicated cryosphere fabric after the
 * core shader has established canonical colour-derived snow/firn/rock masks. Splitting the layers
 * prevents new snow material work from turning the already-large coast/rock/vegetation shader into
 * another monolith.
 *
 * Neither layer owns geography. `terrain.js`, map.png/Pindex, hydrology and collider sampling remain
 * authoritative; this module only composes render materials.
 * @module world/terrainMicroSurface
 */

import {
  TERRAIN_MICRO_SURFACE_POLICY as TERRAIN_MICRO_SURFACE_CORE_POLICY,
  terrainMicroUvAt,
  getSharedTerrainMicroSurfaceTextures,
  applyTerrainMicroSurface as applyTerrainMicroSurfaceCore,
} from './terrainMicroSurfaceCore.js';
import {
  TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY,
  getSharedTerrainCryosphereSurfaceAtlas,
  installTerrainCryosphereSurfaceFabric,
  auditTerrainCryosphereSurfaceFabric,
} from './terrainCryosphereSurfaceFabric.js';

export { terrainMicroUvAt, getSharedTerrainMicroSurfaceTextures };
export {
  TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY,
  getSharedTerrainCryosphereSurfaceAtlas,
  auditTerrainCryosphereSurfaceFabric,
};

export const TERRAIN_MICRO_SURFACE_POLICY = Object.freeze({
  ...TERRAIN_MICRO_SURFACE_CORE_POLICY,
  id: 'terrain-micro-surface-world-uv-pbr-v9-dedicated-cryosphere-fabric',
  basePolicyId: TERRAIN_MICRO_SURFACE_CORE_POLICY.id,
  cryosphereSurfaceFabricPolicyId: TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.id,
  dedicatedCryosphereFabricAtlas: true,
  cryosphereWorldSpaceMultiScale: true,
  cryosphereWindAlignedSastrugi: true,
  cryosphereBlueIceLenses: true,
  cryosphereMineralAblation: true,
  cryosphereVariableRoughness: true,
  cryosphereMicroNormal: true,
  canonicalSnowCoverageUnchanged: true,
  canonicalCryosphereMaskUnchanged: true,
});

/**
 * Install the generic terrain surface first, then the snow/ice-only fabric layer. The second layer
 * intentionally consumes the core shader's established `terrainPhoto*` masks instead of recomputing
 * latitude, owner-map climate or snow coverage from a second source.
 */
export function applyTerrainMicroSurface(material) {
  applyTerrainMicroSurfaceCore(material);
  installTerrainCryosphereSurfaceFabric(material);

  material.userData ||= {};
  material.userData.terrainMicroSurface = Object.freeze({
    ...material.userData.terrainMicroSurface,
    policyId: TERRAIN_MICRO_SURFACE_POLICY.id,
    basePolicyId: TERRAIN_MICRO_SURFACE_CORE_POLICY.id,
    cryosphereSurfaceFabricPolicyId: TERRAIN_CRYOSPHERE_SURFACE_FABRIC_POLICY.id,
    dedicatedCryosphereFabricAtlas: true,
    cryosphereWorldSpaceMultiScale: true,
    cryosphereWindAlignedSastrugi: true,
    cryosphereBlueIceLenses: true,
    cryosphereMineralAblation: true,
    cryosphereVariableRoughness: true,
    cryosphereMicroNormal: true,
    canonicalSnowCoverageUnchanged: true,
    canonicalCryosphereMaskUnchanged: true,
  });
  material.needsUpdate = true;
  return material;
}
