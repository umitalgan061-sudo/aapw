/**
 * Valyria barren-ecology placement adapter.
 *
 * The Doom is not merely dark terrain: ordinary trees, village scatter and meadow grass should not
 * repopulate its shattered volcanic core. Placement consumers in this project already reject samples
 * at/below the shoreline. Rather than duplicate Valyria checks in three separate systems, this module
 * supplies one placement-only height adapter which reports an intentionally non-placeable sentinel for
 * the Doom and delegates every other coordinate to the canonical collider sampler unchanged.
 *
 * Important ownership rule: this adapter is NEVER terrain or collider authority. Natural geology,
 * roads, physics, water and the player continue to read the real canonical height sampler. Only
 * ecological/decorative placement gets the barren-region sentinel.
 *
 * @module world/valyriaEcology
 */

import {
  VALYRIA_GEOLOGY_POLICY,
  isValyriaBarrenAtWorldXZ,
  valyriaInfluenceAtWorldXZ,
} from './valyriaGeology.js';

export const VALYRIA_BARREN_ECOLOGY_POLICY = Object.freeze({
  id: 'valyria-barren-ecology-placement-2026-08-27-v1',
  geologyPolicyId: VALYRIA_GEOLOGY_POLICY.id,
  placementOnly: true,
  terrainHeightAuthorityUnchanged: true,
  colliderAuthorityUnchanged: true,
  canonicalWaterAuthorityUnchanged: true,
  deterministic: true,
  exclusionInfluence: VALYRIA_GEOLOGY_POLICY.vegetationExclusionInfluence,
  excludedOrdinarySystems: Object.freeze([
    'vegetation-tree-scatter',
    'procedural-villages',
    'wind-grass-ground-cover',
  ]),
  preservedSystems: Object.freeze([
    'natural-geology',
    'terrain-render',
    'terrain-collider',
    'roads',
    'settlements',
    'water',
  ]),
  // Existing placement APIs reject <= seaLevel + their own shore margin. Returning a point safely
  // below sea level is therefore an explicit no-placement signal without teaching each consumer a new
  // callback shape or allowing this adapter to leak into gameplay height authority.
  rejectionDepthBelowSeaMeters: 2,
});

export function valyriaEcologyProfileAtWorldXZ(worldX, worldZ) {
  const influence = valyriaInfluenceAtWorldXZ(worldX, worldZ);
  const barren = influence >= VALYRIA_BARREN_ECOLOGY_POLICY.exclusionInfluence;
  return Object.freeze({
    influence,
    barren,
    ordinaryTreeDensity: barren ? 0 : 1,
    ordinaryGrassDensity: barren ? 0 : 1,
    proceduralVillageAllowed: !barren,
  });
}

export function isOrdinaryEcologyAllowedAtWorldXZ(worldX, worldZ) {
  return !isValyriaBarrenAtWorldXZ(
    worldX,
    worldZ,
    VALYRIA_BARREN_ECOLOGY_POLICY.exclusionInfluence,
  );
}

/**
 * Build one shared placement-only sampler for vegetation, villages and wind grass.
 *
 * The returned object, rather than a bare function, makes ownership visible at call sites and gives QA
 * a stable policy identifier. `sampleHeightMeters` preserves the complete argument list for existing
 * callers, including optional surface-output objects, whenever the point is outside the Doom.
 */
export function createValyriaBarrenEcologyPlacementProbe({
  sampleHeightMeters,
  seaLevelMeters,
}) {
  if (typeof sampleHeightMeters !== 'function') {
    throw new TypeError('createValyriaBarrenEcologyPlacementProbe requires sampleHeightMeters');
  }
  if (!Number.isFinite(seaLevelMeters)) {
    throw new TypeError('createValyriaBarrenEcologyPlacementProbe requires finite seaLevelMeters');
  }

  const rejectionHeightMeters = seaLevelMeters - VALYRIA_BARREN_ECOLOGY_POLICY.rejectionDepthBelowSeaMeters;

  const placementSampleHeightMeters = function valyriaBarrenPlacementSampleHeightMeters(
    worldX,
    worldZ,
    ...rest
  ) {
    if (isValyriaBarrenAtWorldXZ(
      worldX,
      worldZ,
      VALYRIA_BARREN_ECOLOGY_POLICY.exclusionInfluence,
    )) {
      const maybeOutSurface = rest.length > 0 ? rest[rest.length - 1] : null;
      if (maybeOutSurface && typeof maybeOutSurface === 'object') {
        maybeOutSurface.valyriaBarrenPlacementRejected = true;
      }
      return rejectionHeightMeters;
    }
    return sampleHeightMeters(worldX, worldZ, ...rest);
  };

  return Object.freeze({
    policyId: VALYRIA_BARREN_ECOLOGY_POLICY.id,
    geologyPolicyId: VALYRIA_BARREN_ECOLOGY_POLICY.geologyPolicyId,
    sampleHeightMeters: placementSampleHeightMeters,
    isAllowedAtWorldXZ: isOrdinaryEcologyAllowedAtWorldXZ,
    profileAtWorldXZ: valyriaEcologyProfileAtWorldXZ,
    rejectionHeightMeters,
    terrainHeightAuthorityUnchanged: true,
    colliderAuthorityUnchanged: true,
  });
}
