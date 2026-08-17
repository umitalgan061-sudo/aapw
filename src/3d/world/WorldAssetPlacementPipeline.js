import * as THREE from 'three';
import {
  autoAssignMaterials,
  applyMaterialRecipe,
  createMaterialManifest,
  validateMaterialAssignment,
} from '../materials/MaterialAssignmentCore.js';

export const WORLD_SURFACE_POLICY_PRESETS = Object.freeze({
  vegetation: Object.freeze({
    maxSlopeDegrees: 38,
    maxWaterDepth: 0.05,
    minRoadDistance: 0.75,
    forbiddenBiomes: ['ocean', 'lake', 'river', 'cliff'],
  }),
  tree: Object.freeze({
    maxSlopeDegrees: 34,
    maxWaterDepth: 0.05,
    minRoadDistance: 1.5,
    forbiddenBiomes: ['ocean', 'lake', 'river', 'cliff', 'alpine-bare'],
  }),
  rock: Object.freeze({ maxSlopeDegrees: 72, maxWaterDepth: 0.8 }),
  building: Object.freeze({ maxSlopeDegrees: 12, maxWaterDepth: 0.02, minRoadDistance: 0 }),
  settlement: Object.freeze({ maxSlopeDegrees: 12, maxWaterDepth: 0.02, minRoadDistance: 0 }),
  bridge: Object.freeze({ maxSlopeDegrees: 24, maxWaterDepth: Infinity }),
});

const POLICY_NUMERIC_FIELDS = Object.freeze([
  ['minSlopeDegrees', false], ['maxSlopeDegrees', true],
  ['minWaterDepth', false], ['maxWaterDepth', true],
  ['minRoadDistance', false], ['maxRoadDistance', true],
  ['minSettlementDistance', false], ['maxSettlementDistance', true],
  ['minMoisture', false], ['maxMoisture', true],
]);
const POLICY_LIST_FIELDS = Object.freeze([
  'allowedBiomes', 'forbiddenBiomes', 'allowedWaterTypes', 'forbiddenWaterTypes',
]);
const POLICY_RANGES = Object.freeze([
  ['minSlopeDegrees', 'maxSlopeDegrees', 'slope'],
  ['minWaterDepth', 'maxWaterDepth', 'water-depth'],
  ['minRoadDistance', 'maxRoadDistance', 'road-distance'],
  ['minSettlementDistance', 'maxSettlementDistance', 'settlement-distance'],
  ['minMoisture', 'maxMoisture', 'moisture'],
]);

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
    const rawHeight = groundHeight(x, z, object);
    if (rawHeight === null || rawHeight === undefined || rawHeight === '') {
      return { ok: false, error: 'surface:non-finite-height' };
    }
    const height = Number(rawHeight);
    if (!Number.isFinite(height)) return { ok: false, error: 'surface:non-finite-height' };
    surface = normalizeWorldSurfaceSample({ height });
  } else if (requireSurfaceContext) {
    return { ok: false, error: 'surface:missing-query' };
  }

  if (!surface) return { ok: true, surface: null, policy: null };

  const evaluation = evaluateWorldSurfacePlacement(
    surface.sample,
    mergeWorldSurfacePolicy(metadata, placementPolicy),
  );
  const policy = evaluation.policy || null;
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

export function resolveWorldSurfacePolicy(metadata = {}, override = null) {
  const validation = validateWorldSurfacePolicy(mergeWorldSurfacePolicy(metadata, override));
  if (!validation.ok) {
    throw new TypeError(`Invalid world surface placement policy: ${validation.errors.join(',')}`);
  }
  return validation.policy;
}

export function normalizeWorldSurfaceSample(sample) {
  if (typeof sample === 'number' && Number.isFinite(sample)) sample = { height: sample };
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
    return { ok: false, error: 'missing-sample', sample: null };
  }

  const rawHeight = sample.height ?? sample.groundHeight ?? sample.y;
  if (rawHeight === null || rawHeight === undefined || rawHeight === '') {
    return { ok: false, error: 'non-finite-height', sample: { ...sample, height: null } };
  }
  const height = Number(rawHeight);
  if (!Number.isFinite(height)) {
    return { ok: false, error: 'non-finite-height', sample: { ...sample, height: null } };
  }

  const normalized = {
    height,
    slopeDegrees: optionalFinite(sample.slopeDegrees ?? sample.slope),
    waterDepth: optionalFinite(sample.waterDepth),
    roadDistance: optionalFinite(sample.roadDistance),
    settlementDistance: optionalFinite(sample.settlementDistance),
    moisture: optionalFinite(sample.moisture),
    biome: sample.biome == null ? null : String(sample.biome).toLowerCase(),
    waterType: sample.waterType == null ? null : String(sample.waterType).toLowerCase(),
  };

  for (const key of ['slopeDegrees', 'waterDepth', 'roadDistance', 'settlementDistance']) {
    if (normalized[key] !== null && normalized[key] < 0) {
      return { ok: false, error: `negative-${key}`, sample: normalized };
    }
  }
  if (normalized.moisture !== null && (normalized.moisture < 0 || normalized.moisture > 1)) {
    return { ok: false, error: 'moisture-out-of-range', sample: normalized };
  }
  return { ok: true, sample: normalized };
}

export function evaluateWorldSurfacePlacement(surface, policy = {}) {
  const normalizedSurface = normalizeWorldSurfaceSample(surface);
  if (!normalizedSurface.ok) return { ok: false, errors: [normalizedSurface.error], surface: normalizedSurface.sample };
  const policyValidation = validateWorldSurfacePolicy(policy);
  const normalizedPolicy = policyValidation.policy;
  const sample = normalizedSurface.sample;
  if (!policyValidation.ok) {
    return { ok: false, errors: policyValidation.errors, surface: sample, policy: normalizedPolicy };
  }
  const errors = [];

  requirePolicyContext(errors, sample, normalizedPolicy);
  compareMax(errors, 'slope-too-steep', sample.slopeDegrees, normalizedPolicy.maxSlopeDegrees);
  compareMin(errors, 'slope-too-flat', sample.slopeDegrees, normalizedPolicy.minSlopeDegrees);
  compareMax(errors, 'water-too-deep', sample.waterDepth, normalizedPolicy.maxWaterDepth);
  compareMin(errors, 'water-too-shallow', sample.waterDepth, normalizedPolicy.minWaterDepth);
  compareMin(errors, 'too-close-to-road', sample.roadDistance, normalizedPolicy.minRoadDistance);
  compareMax(errors, 'too-far-from-road', sample.roadDistance, normalizedPolicy.maxRoadDistance);
  compareMin(errors, 'too-close-to-settlement', sample.settlementDistance, normalizedPolicy.minSettlementDistance);
  compareMax(errors, 'too-far-from-settlement', sample.settlementDistance, normalizedPolicy.maxSettlementDistance);
  compareMin(errors, 'too-dry', sample.moisture, normalizedPolicy.minMoisture);
  compareMax(errors, 'too-wet', sample.moisture, normalizedPolicy.maxMoisture);

  if (sample.biome && normalizedPolicy.allowedBiomes.length && !normalizedPolicy.allowedBiomes.includes(sample.biome)) errors.push('biome-not-allowed');
  if (sample.biome && normalizedPolicy.forbiddenBiomes.includes(sample.biome)) errors.push('biome-forbidden');
  if (sample.waterType && normalizedPolicy.allowedWaterTypes.length && !normalizedPolicy.allowedWaterTypes.includes(sample.waterType)) errors.push('water-type-not-allowed');
  if (sample.waterType && normalizedPolicy.forbiddenWaterTypes.includes(sample.waterType)) errors.push('water-type-forbidden');

  return { ok: errors.length === 0, errors, surface: sample, policy: normalizedPolicy };
}

export function validateWorldSurfacePolicy(policy = {}) {
  const source = policy && typeof policy === 'object' && !Array.isArray(policy) ? policy : null;
  const normalizedPolicy = normalizePlacementPolicy(source || {});
  if (!source) return { ok: false, errors: ['policy-invalid-object'], policy: normalizedPolicy };

  const errors = [];
  for (const [key, allowInfinity] of POLICY_NUMERIC_FIELDS) {
    const value = source[key];
    if (value === null || value === undefined || value === '') continue;
    const numeric = Number(value);
    if ((!Number.isFinite(numeric) && !(allowInfinity && numeric === Infinity)) || numeric < 0) {
      errors.push(`policy-invalid-${policyErrorKey(key)}`);
    }
  }
  for (const key of POLICY_LIST_FIELDS) {
    const value = source[key];
    if (value === null || value === undefined) continue;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
      errors.push(`policy-invalid-${policyErrorKey(key)}`);
    }
  }
  if (normalizedPolicy.minMoisture !== null && normalizedPolicy.minMoisture > 1) errors.push('policy-invalid-min-moisture');
  if (normalizedPolicy.maxMoisture !== null && normalizedPolicy.maxMoisture > 1) errors.push('policy-invalid-max-moisture');
  for (const [minKey, maxKey, label] of POLICY_RANGES) {
    const min = normalizedPolicy[minKey];
    const max = normalizedPolicy[maxKey];
    if (min !== null && max !== null && min > max) errors.push(`policy-inverted-${label}-range`);
  }

  return { ok: errors.length === 0, errors: [...new Set(errors)], policy: normalizedPolicy };
}

export function normalizePlacementPolicy(policy = {}) {
  const source = policy && typeof policy === 'object' && !Array.isArray(policy) ? policy : {};
  return {
    minSlopeDegrees: optionalFinite(source.minSlopeDegrees),
    maxSlopeDegrees: optionalFinite(source.maxSlopeDegrees, true),
    minWaterDepth: optionalFinite(source.minWaterDepth),
    maxWaterDepth: optionalFinite(source.maxWaterDepth, true),
    minRoadDistance: optionalFinite(source.minRoadDistance),
    maxRoadDistance: optionalFinite(source.maxRoadDistance, true),
    minSettlementDistance: optionalFinite(source.minSettlementDistance),
    maxSettlementDistance: optionalFinite(source.maxSettlementDistance, true),
    minMoisture: optionalFinite(source.minMoisture),
    maxMoisture: optionalFinite(source.maxMoisture, true),
    allowedBiomes: normalizedStringList(source.allowedBiomes),
    forbiddenBiomes: normalizedStringList(source.forbiddenBiomes),
    allowedWaterTypes: normalizedStringList(source.allowedWaterTypes),
    forbiddenWaterTypes: normalizedStringList(source.forbiddenWaterTypes),
  };
}

function mergeWorldSurfacePolicy(metadata, override) {
  const category = String(metadata?.category || metadata?.kind || '').toLowerCase();
  const preset = WORLD_SURFACE_POLICY_PRESETS[category] || null;
  return { ...(preset || {}), ...(override || {}) };
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

function normalizedStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim().toLowerCase()).filter(Boolean))].sort();
}

function policyErrorKey(key) {
  return key.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}

function requirePolicyContext(errors, sample, policy) {
  requireNumericContext(errors, sample, policy, 'slopeDegrees', ['minSlopeDegrees', 'maxSlopeDegrees'], 'missing-slope');
  requireNumericContext(errors, sample, policy, 'waterDepth', ['minWaterDepth', 'maxWaterDepth'], 'missing-water-depth');
  requireNumericContext(errors, sample, policy, 'roadDistance', ['minRoadDistance', 'maxRoadDistance'], 'missing-road-distance');
  requireNumericContext(errors, sample, policy, 'settlementDistance', ['minSettlementDistance', 'maxSettlementDistance'], 'missing-settlement-distance');
  requireNumericContext(errors, sample, policy, 'moisture', ['minMoisture', 'maxMoisture'], 'missing-moisture');
  if ((policy.allowedBiomes.length || policy.forbiddenBiomes.length) && !sample.biome) errors.push('missing-biome');
  if ((policy.allowedWaterTypes.length || policy.forbiddenWaterTypes.length) && !sample.waterType) errors.push('missing-water-type');
}

function requireNumericContext(errors, sample, policy, sampleKey, policyKeys, message) {
  if (sample[sampleKey] !== null) return;
  if (policyKeys.some((key) => policy[key] !== null)) errors.push(message);
}

function compareMin(errors, message, value, limit) {
  if (value !== null && limit !== null && value < limit) errors.push(message);
}

function compareMax(errors, message, value, limit) {
  if (value !== null && limit !== null && value > limit) errors.push(message);
}

function optionalFinite(value, allowInfinity = false) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (allowInfinity && number === Infinity) return Infinity;
  return Number.isFinite(number) ? number : null;
}
