import * as THREE from 'three';
import {
  autoAssignMaterials,
  applyMaterialRecipe,
  createMaterialManifest,
  validateMaterialAssignment,
} from '../materials/MaterialAssignmentCore.js';
import {
  evaluateWorldSurfacePlacement,
  normalizeWorldSurfaceSample,
  resolveWorldSurfacePolicy,
} from './WorldSurfacePlacementPolicy.js';

export {
  WORLD_SURFACE_POLICY_PRESETS,
  evaluateWorldSurfacePlacement,
  normalizePlacementPolicy,
  normalizeWorldSurfaceSample,
  resolveWorldSurfacePolicy,
} from './WorldSurfacePlacementPolicy.js';

/**
 * Shared placement gate for editor-authored and autonomous world assets.
 * A model is dressed and validated before callers attach it to the live scene.
 */
export function prepareWorldAssetForPlacement(object, {
  metadata = {},
  materialRecipe = null,
  paletteId,
  textureSize = 256,
  position = null,
  rotation = null,
  scale = null,
  groundHeight = null,
  surfaceQuery = null,
  placementPolicy = null,
  requireSurfaceContext = false,
  snapToGround = true,
  requireGeneratedTexture = true,
} = {}) {
  if (!object) return { ok: false, error: 'missing-object' };
  if (object.userData?.isPlaceholder) return { ok: false, error: 'placeholder-model' };

  object.userData ||= {};
  if (metadata.id) object.userData.assetId = metadata.id;
  if (metadata.category) object.userData.assetCategory = metadata.category;
  if (metadata.src) object.userData.assetSrc = metadata.src;

  const materialResult = materialRecipe
    ? applyMaterialRecipe(object, materialRecipe, { metadata })
    : autoAssignMaterials(object, { metadata, paletteId, textureSize });
  if (!materialResult.ok) return { ok: false, error: `material:${materialResult.error || 'assignment-failed'}` };

  applyTransform(object, { position, rotation, scale });

  const surfaceResult = resolveWorldSurfacePlacement(object, {
    metadata,
    groundHeight,
    surfaceQuery,
    placementPolicy,
    requireSurfaceContext,
    snapToGround,
  });
  if (!surfaceResult.ok) return surfaceResult;

  object.updateMatrixWorld?.(true);
  const validation = validateMaterialAssignment(object, { requireGeneratedTexture });
  if (!validation.ok) return { ok: false, error: validation.errors.join(','), validation };

  const placement = {
    position: vectorRecord(object.position),
    rotation: eulerRecord(object.rotation),
    scale: vectorRecord(object.scale),
  };
  const manifest = {
    ...createMaterialManifest(object, { metadata, placement }),
    placementSurface: surfaceResult.surface,
    placementPolicy: surfaceResult.policy,
  };
  object.userData.worldPlacementSurface = surfaceResult.surface;
  object.userData.worldPlacementPolicy = surfaceResult.policy;
  object.userData.worldPlacementManifest = manifest;
  object.userData.materialReadyForWorld = true;

  return {
    ok: true,
    object,
    material: materialResult,
    validation,
    surface: surfaceResult.surface,
    placementPolicy: surfaceResult.policy,
    manifest,
  };
}

export function attachPreparedWorldAsset(scene, prepared) {
  if (!scene || !prepared?.ok || !prepared.object?.userData?.materialReadyForWorld) {
    return { ok: false, error: 'asset-not-prepared' };
  }
  scene.add(prepared.object);
  return { ok: true, object: prepared.object, manifest: prepared.manifest };
}

export function placeWorldAsset(scene, object, options = {}) {
  const prepared = prepareWorldAssetForPlacement(object, options);
  if (!prepared.ok) return prepared;
  const attached = attachPreparedWorldAsset(scene, prepared);
  return attached.ok ? prepared : attached;
}

export function auditWorldAssetPlacement(object) {
  const validation = validateMaterialAssignment(object, { requireGeneratedTexture: true });
  const errors = [...validation.errors];
  if (!object?.userData?.materialReadyForWorld) errors.push('placement-gate-not-used');
  if (hasNonFiniteTransform(object)) errors.push('non-finite-transform');
  const storedSurface = object?.userData?.worldPlacementSurface;
  const storedPolicy = object?.userData?.worldPlacementPolicy;
  if (storedSurface && storedPolicy) {
    const surfaceAudit = evaluateWorldSurfacePlacement(storedSurface, storedPolicy);
    errors.push(...surfaceAudit.errors.map((error) => `surface:${error}`));
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings: [...validation.warnings],
    surface: storedSurface || null,
    placementPolicy: storedPolicy || null,
    manifest: object?.userData?.worldPlacementManifest || null,
  };
}

export function resolveWorldSurfacePlacement(object, {
  metadata = {},
  groundHeight = null,
  surfaceQuery = null,
  placementPolicy = null,
  requireSurfaceContext = false,
  snapToGround = true,
} = {}) {
  const x = object?.position?.x;
  const z = object?.position?.z;
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return { ok: false, error: 'surface:non-finite-xz' };
  }

  let surface = null;
  if (typeof surfaceQuery === 'function') {
    surface = normalizeWorldSurfaceSample(surfaceQuery(x, z, object));
    if (!surface.ok) return { ok: false, error: `surface:${surface.error}`, surface: surface.sample };
  } else if (typeof groundHeight === 'function') {
    const height = Number(groundHeight(x, z, object));
    if (!Number.isFinite(height)) return { ok: false, error: 'surface:non-finite-height' };
    surface = normalizeWorldSurfaceSample({ height });
  } else if (requireSurfaceContext) {
    return { ok: false, error: 'surface:missing-query' };
  }

  if (!surface) return { ok: true, surface: null, policy: null };

  const policy = resolveWorldSurfacePolicy(metadata, placementPolicy);
  const evaluation = evaluateWorldSurfacePlacement(surface.sample, policy);
  if (!evaluation.ok) {
    return {
      ok: false,
      error: `surface:${evaluation.errors.join(',')}`,
      surface: surface.sample,
      policy,
      evaluation,
    };
  }

  if (snapToGround) object.position.y = surface.sample.height;
  return { ok: true, surface: surface.sample, policy, evaluation };
}

function applyTransform(object, { position, rotation, scale }) {
  if (position) object.position.copy(asVector3(position, object.position));
  if (rotation) {
    if (rotation.isEuler) object.rotation.copy(rotation);
    else object.rotation.set(
      finite(rotation.x, object.rotation.x),
      finite(rotation.y, object.rotation.y),
      finite(rotation.z, object.rotation.z),
      rotation.order || object.rotation.order,
    );
  }
  if (scale !== null && scale !== undefined) {
    if (Number.isFinite(scale)) object.scale.setScalar(scale);
    else object.scale.copy(asVector3(scale, object.scale));
  }
}

function asVector3(value, fallback) {
  if (value?.isVector3) return value;
  return new THREE.Vector3(
    finite(value?.x, fallback.x),
    finite(value?.y, fallback.y),
    finite(value?.z, fallback.z),
  );
}

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function vectorRecord(vector) {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function eulerRecord(euler) {
  return { x: euler.x, y: euler.y, z: euler.z, order: euler.order };
}

function hasNonFiniteTransform(object) {
  const values = [
    object?.position?.x, object?.position?.y, object?.position?.z,
    object?.rotation?.x, object?.rotation?.y, object?.rotation?.z,
    object?.scale?.x, object?.scale?.y, object?.scale?.z,
  ];
  return values.some((value) => !Number.isFinite(value));
}
