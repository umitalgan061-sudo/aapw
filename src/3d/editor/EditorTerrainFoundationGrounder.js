import * as THREE from 'three';
import { resolveWorldSurfacePlacement } from '../world/WorldAssetPlacementPipeline.js';
import { createTerrainFoundationConformer } from '../world/terrainFoundationConformer.js';

const NON_STRUCTURE_PRIMITIVES = new Set(['land-cell', 'water-cell', 'road-segment', 'tree', 'soldier']);
const STRUCTURE_TERMS = Object.freeze([
  'architecture', 'architectural', 'building', 'structure', 'settlement', 'village',
  'castle', 'citadel', 'keep', 'tower', 'wall', 'gate', 'gatehouse', 'fort', 'fortress',
  'fortification', 'house', 'hall', 'manor', 'inn', 'tavern', 'hut', 'cottage', 'barn',
  'stable', 'sept', 'temple', 'shrine', 'bridge', 'dock', 'pier', 'quay', 'harbor',
  'harbour', 'rampart', 'battlement', 'ruin', 'monument',
  // Editor library and authored content also use Turkish category/name metadata.
  'mimari', 'bina', 'yapi', 'yapı', 'yerlesim', 'yerleşim', 'koy', 'köy', 'kale',
  'hisar', 'sur', 'kule', 'kopru', 'köprü', 'iskele', 'liman', 'ahır', 'ahir',
]);
const TURKISH_STRUCTURE_STEMS = Object.freeze([
  'mimari', 'bina', 'yapi', 'yapı', 'yerlesim', 'yerleşim', 'koy', 'köy', 'kale',
  'hisar', 'sur', 'kule', 'kopru', 'köprü', 'iskele', 'liman', 'ahır', 'ahir',
]);
const STRUCTURE_PATTERN = new RegExp(`(^|[^a-z0-9çğıöşü])(${STRUCTURE_TERMS.join('|')})(?=$|[^a-z0-9çğıöşü])`, 'iu');

function structureDescriptor(asset) {
  return [asset?.id, asset?.name, asset?.category, asset?.kind, asset?.primitive, asset?.src]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('tr-TR');
}

function hasLocalizedStructureStem(descriptor) {
  const words = descriptor.split(/[^a-z0-9çğıöşü]+/iu).filter(Boolean);
  return words.some((word) => TURKISH_STRUCTURE_STEMS.some((stem) => word === stem || word.startsWith(stem)));
}

export function isEditorStructureAsset(asset) {
  if (!asset) return false;
  if (asset.terrainFoundation === false || asset.structureLike === false) return false;
  if (asset.terrainFoundation === true || asset.structureLike === true) return true;
  const primitive = String(asset.primitive || '').trim().toLowerCase();
  if (NON_STRUCTURE_PRIMITIVES.has(primitive)) return false;
  const descriptor = structureDescriptor(asset);
  return STRUCTURE_PATTERN.test(descriptor) || hasLocalizedStructureStem(descriptor);
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

  function groundObject(object, asset, { x = object?.position?.x, z = object?.position?.z } = {}) {
    if (!object || !Number.isFinite(Number(x)) || !Number.isFinite(Number(z))) {
      return { ok: false, error: 'editor-ground-invalid-object-or-position' };
    }
    if (!isEditorStructureAsset(asset)) {
      return centerGroundObject(object, groundCollider.getGroundHeight, Number(x), Number(z));
    }

    object.position.x = Number(x);
    object.position.z = Number(z);
    object.updateMatrixWorld(true);
    const editorId = object.userData?.editorId || object.uuid;
    const result = resolveWorldSurfacePlacement(object, {
      metadata: { id: editorId, category: 'structure', src: asset?.src || '' },
      groundHeight: groundCollider.getGroundHeight,
      footprintGrounding: 'always',
      foundationInsetMeters: 0.04,
      conformTerrain: terrainConformer.conformTerrain,
      requireSurfaceContext: true,
    });
    if (!result.ok) return result;

    object.userData ||= {};
    object.userData.editorFoundationKey = `asset:${editorId}`;
    object.userData.editorGroundingMode = result.footprint?.groundingMode || 'terrain-conform';
    object.updateMatrixWorld(true);
    return { ...result, mode: 'terrain-conform' };
  }

  function removeObjectFoundation(object) {
    const key = object?.userData?.editorFoundationKey;
    if (!key) return { ok: false, error: 'foundation-not-registered' };
    const result = terrainConformer.removeFoundation(key);
    if (result.ok) {
      delete object.userData.editorFoundationKey;
      delete object.userData.editorGroundingMode;
    }
    return result;
  }

  return Object.freeze({
    groundObject,
    removeObjectFoundation,
    isStructureAsset: isEditorStructureAsset,
    getDynamicPads: terrainConformer.getDynamicPads,
    policy: terrainConformer.policy,
  });
}
