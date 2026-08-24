import * as THREE from 'three';
import { resolveWorldSurfacePlacement } from '../world/WorldAssetPlacementPipeline.js';
import { createTerrainFoundationConformer } from '../world/terrainFoundationConformer.js';
import { isStructureGroundingCandidate } from '../world/structureGroundingPolicy.js';

const EDITOR_REGROUND_SURFACE_POLICY_OVERRIDE = Object.freeze({
  maxSlopeDegrees: null,
  maxWaterDepth: null,
  minRoadDistance: null,
});

export function isEditorStructureAsset(asset) {
  return isStructureGroundingCandidate(asset);
}

function isStructureObject(object, asset) {
  return isStructureGroundingCandidate(asset, object?.userData);
}

function centerGroundObject(object, groundHeight, x, z) {
  object.position.set(0, 0, 0);
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const localBaseY = Number.isFinite(box.min.y) ? box.min.y : 0;
  const y = Number(groundHeight(x, z));
  if (!Number.isFinite(y)) return { ok: false, error: 'editor-ground-non-finite-height' };
  object.position.set(x, y - localBaseY, z);
  object.updateMatrixWorld(true);
  return { ok: true, mode: 'center-base', height: y };
}

function liveFoundationKeyForObject(object) {
  const remembered = object?.userData?.terrainFoundationKey;
  if (remembered !== null && remembered !== undefined && String(remembered).trim()) return String(remembered);
  return object?.uuid ? `object:${object.uuid}` : null;
}

export function createEditorTerrainFoundationGrounder({ chunkManager, groundCollider } = {}) {
  if (!chunkManager?.loaded || !Array.isArray(chunkManager.flattenPads)) {
    throw new TypeError('EditorTerrainFoundationGrounder: live ChunkManager with mutable flattenPads is required.');
  }
  if (typeof groundCollider?.getGroundHeight !== 'function') {
    throw new TypeError('EditorTerrainFoundationGrounder: live groundCollider is required.');
  }

  const terrainConformer = createTerrainFoundationConformer({
    flattenPads: chunkManager.flattenPads,
    chunkManager,
    chunkSizeMeters: chunkManager.chunkSizeMeters,
  });

  function groundHeightWithoutSelfFoundation(object, x, z) {
    const foundationKey = liveFoundationKeyForObject(object);
    if (!foundationKey) return groundCollider.getGroundHeight(x, z);

    const removed = [];
    for (let index = chunkManager.flattenPads.length - 1; index >= 0; index -= 1) {
      const pad = chunkManager.flattenPads[index];
      if (pad?.foundationKey !== foundationKey) continue;
      removed.push({ index, pad });
      chunkManager.flattenPads.splice(index, 1);
    }
    if (!removed.length) return groundCollider.getGroundHeight(x, z);

    // Re-grounding a moved/scaled structure must sample canonical/neighbour terrain under its previous
    // foundation rather than feeding any part of the old cluster back into the next cluster. Remove the
    // complete synchronous self-cluster, query the already-live collider, then restore exact pad objects
    // at their original indexes. Other static/dynamic pads stay active throughout the sample.
    try {
      return groundCollider.getGroundHeight(x, z);
    } finally {
      removed.sort((a, b) => a.index - b.index);
      for (const { index, pad } of removed) chunkManager.flattenPads.splice(index, 0, pad);
    }
  }

  function groundObject(object, asset, { x = object?.position?.x, z = object?.position?.z } = {}) {
    if (!object || !Number.isFinite(Number(x)) || !Number.isFinite(Number(z))) {
      return { ok: false, error: 'editor-ground-invalid-object-or-position' };
    }
    if (!isStructureObject(object, asset)) {
      return centerGroundObject(object, groundCollider.getGroundHeight, Number(x), Number(z));
    }

    object.position.x = Number(x);
    object.position.z = Number(z);
    object.updateMatrixWorld(true);
    const editorId = object.userData?.editorId || object.uuid;
    const editorFoundationKey = `asset:${editorId}`;
    const structureSource = asset || object.userData || {};
    const result = resolveWorldSurfacePlacement(object, {
      metadata: { id: editorId, category: 'structure', src: structureSource.src || '' },
      groundHeight: (sampleX, sampleZ) => groundHeightWithoutSelfFoundation(object, sampleX, sampleZ),
      placementPolicy: EDITOR_REGROUND_SURFACE_POLICY_OVERRIDE,
      footprintGrounding: 'always',
      foundationInsetMeters: 0.04,
      conformTerrain: terrainConformer.conformTerrain,
      requireSurfaceContext: true,
    });
    if (!result.ok) return result;

    if (!liveFoundationKeyForObject(object)) return { ok: false, error: 'editor-ground-missing-foundation-key' };
    object.userData ||= {};
    object.userData.editorFoundationKey = editorFoundationKey;
    object.userData.editorGroundingMode = result.footprint?.groundingMode || 'terrain-conform';
    object.updateMatrixWorld(true);
    return { ...result, mode: 'terrain-conform' };
  }

  function removeObjectFoundation(object) {
    if (!object?.userData?.editorFoundationKey && !liveFoundationKeyForObject(object)) {
      return { ok: false, error: 'foundation-not-registered' };
    }
    const result = terrainConformer.removeFoundation(object);
    if (result.ok) {
      delete object.userData.editorFoundationKey;
      delete object.userData.editorGroundingMode;
    }
    return result;
  }

  function removeObjectFoundations(objects, options = {}) {
    const candidates = (Array.isArray(objects) ? objects : [objects])
      .filter((object) => object && (object.userData?.editorFoundationKey || liveFoundationKeyForObject(object)));
    if (!candidates.length) {
      return { ok: true, removedCount: 0, missingKeys: [], rebuiltChunkCount: 0 };
    }
    const liveKeys = new Map(candidates.map((object) => [object, liveFoundationKeyForObject(object)]));
    const result = terrainConformer.removeFoundations(candidates, options);
    const missing = new Set(result.missingKeys || []);
    for (const object of candidates) {
      const key = liveKeys.get(object);
      if (key && !missing.has(key)) {
        delete object.userData.editorFoundationKey;
        delete object.userData.editorGroundingMode;
      }
    }
    return result;
  }

  return Object.freeze({
    groundObject,
    removeObjectFoundation,
    removeObjectFoundations,
    isStructureAsset: isEditorStructureAsset,
    isStructureObject,
    getDynamicPads: terrainConformer.getDynamicPads,
    policy: terrainConformer.policy,
  });
}
