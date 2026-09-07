import {
  prepareTerrainEnvironmentAssetContext,
  assertTerrainEnvironmentAttachReady,
} from './terrainEnvironmentContract.js';
import {
  prepareWorldAssetForPlacement,
  attachPreparedWorldAsset,
} from './WorldAssetPlacementPipeline.js';

const freeze = (value) => Object.freeze(value);

/**
 * Runtime bridge for autonomous environment placement.
 *
 * This module intentionally does not own material assignment, grounding, or scene attachment.
 * It only converts the terrain/environment contract context into the existing shared
 * WorldAssetPlacementPipeline call so every autonomous asset follows the same sequence as editor
 * authored assets.
 */
export function prepareTerrainEnvironmentSceneAsset(object, {
  asset,
  category,
  worldX = 0,
  worldZ = 0,
  seedOrdinal = 0,
  biome = '',
  climate = '',
  winter = false,
  sample = {},
  placementPolicy = null,
  surfaceQuery = null,
  groundHeight = null,
  metadata = {},
} = {}) {
  const context = prepareTerrainEnvironmentAssetContext(asset, {
    category,
    worldX,
    worldZ,
    seedOrdinal,
    biome,
    climate,
    winter,
    sample,
  });
  const gate = assertTerrainEnvironmentAttachReady(context);
  if (!gate.ok) return freeze({ ok: false, stage: 'terrain-environment-contract', gate, context });

  const prepared = prepareWorldAssetForPlacement(object, {
    metadata: {
      ...metadata,
      id: context.asset.id,
      src: context.asset.src,
      category: context.profile.category,
      environmentContractId: context.contractId,
      environmentManifest: context.plan,
    },
    materialRecipe: context.plan.material.recipe || null,
    paletteId: context.plan.material.paletteId,
    position: { x: worldX, y: 0, z: worldZ },
    scale: context.transform.scale,
    groundHeight,
    surfaceQuery,
    placementPolicy: placementPolicy || context.plan.placement.policy,
    requireSurfaceContext: true,
    snapToGround: true,
    footprintGrounding: 'auto',
  });
  if (!prepared.ok) return freeze({ ok: false, stage: 'world-asset-placement', gate, context, prepared });

  return freeze({ ok: true, stage: 'prepared', gate, context, prepared });
}

export function attachTerrainEnvironmentSceneAsset(scene, result) {
  if (!result?.ok || !result.prepared?.ok) return { ok: false, error: 'asset-not-prepared' };
  const attached = attachPreparedWorldAsset(scene, result.prepared);
  if (!attached.ok) return attached;
  return {
    ok: true,
    object: attached.object,
    manifest: {
      ...result.context.plan,
      worldPlacementManifest: attached.manifest,
    },
  };
}
