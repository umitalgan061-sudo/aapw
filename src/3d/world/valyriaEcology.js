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
  valyriaInfluenceAtWorldXZ,
} from './valyriaGeology.js';

export const VALYRIA_BARREN_ECOLOGY_POLICY = Object.freeze({
  id: 'valyria-barren-ecology-placement-2026-08-29-v2-feathered-refugia',
  geologyPolicyId: VALYRIA_GEOLOGY_POLICY.id,
  placementOnly: true,
  terrainHeightAuthorityUnchanged: true,
  colliderAuthorityUnchanged: true,
  canonicalWaterAuthorityUnchanged: true,
  deterministic: true,
  exclusionInfluence: VALYRIA_GEOLOGY_POLICY.vegetationExclusionInfluence,
  transitionWidth: 0.22,
  macroRefugiaMeters: 940,
  mesoRefugiaMeters: 310,
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

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function hashCell(ix, iz, salt) {
  let h = (Math.imul(ix | 0, 0x1f123bb5) ^ Math.imul(iz | 0, 0x5f356495) ^ salt) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h / 0xffffffff;
}

function valueNoiseAtWorldXZ(worldX, worldZ, scaleMeters, salt) {
  const gx = worldX / scaleMeters;
  const gz = worldZ / scaleMeters;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = smoothstep01(gx - ix);
  const fz = smoothstep01(gz - iz);
  const a = hashCell(ix, iz, salt);
  const b = hashCell(ix + 1, iz, salt);
  const c = hashCell(ix, iz + 1, salt);
  const d = hashCell(ix + 1, iz + 1, salt);
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  return ab + (cd - ab) * fz;
}

function ecologyRefugiaAtWorldXZ(worldX, worldZ) {
  const macro = valueNoiseAtWorldXZ(
    worldX,
    worldZ,
    VALYRIA_BARREN_ECOLOGY_POLICY.macroRefugiaMeters,
    0x51a9d36b,
  );
  const meso = valueNoiseAtWorldXZ(
    worldX,
    worldZ,
    VALYRIA_BARREN_ECOLOGY_POLICY.mesoRefugiaMeters,
    0x2cb4e1f7,
  );
  return clamp01(macro * 0.68 + meso * 0.32);
}

export function valyriaEcologyProfileAtWorldXZ(worldX, worldZ) {
  const influence = valyriaInfluenceAtWorldXZ(worldX, worldZ);
  const threshold = VALYRIA_BARREN_ECOLOGY_POLICY.exclusionInfluence;
  const transitionStart = Math.max(0, threshold - VALYRIA_BARREN_ECOLOGY_POLICY.transitionWidth);
  const doomPressure = smoothstep01((influence - transitionStart) / Math.max(1e-6, threshold - transitionStart));
  const refugia = ecologyRefugiaAtWorldXZ(worldX, worldZ);
  const survival = clamp01(1 - doomPressure * (0.82 + (1 - refugia) * 0.18));
  const barren = influence >= threshold;
  return Object.freeze({
    influence,
    barren,
    refugia,
    ordinaryTreeDensity: barren ? 0 : survival ** 1.35,
    ordinaryGrassDensity: barren ? 0 : Math.sqrt(survival),
    proceduralVillageAllowed: !barren && survival >= 0.42,
  });
}

export function isOrdinaryEcologyAllowedAtWorldXZ(worldX, worldZ) {
  const profile = valyriaEcologyProfileAtWorldXZ(worldX, worldZ);
  if (profile.barren) return false;
  const acceptance = hashCell(Math.floor(worldX / 54), Math.floor(worldZ / 54), 0x3d72c91f);
  return acceptance <= profile.ordinaryGrassDensity;
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
    if (!isOrdinaryEcologyAllowedAtWorldXZ(worldX, worldZ)) {
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
