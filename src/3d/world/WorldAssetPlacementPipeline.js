import * as THREE from 'three';
import {
  autoAssignMaterials,
  applyMaterialRecipe,
  createMaterialManifest,
  validateMaterialAssignment,
} from '../materials/MaterialAssignmentCore.js';
import {
  isStructureGroundingCandidate,
  resolveStructureSurfaceProfile,
} from './structureGroundingPolicy.js';
import { createDisconnectedFoundationIslandProbes } from './foundationIslandProbes.js';
import { worldFootprintFor } from './WorldAssetFootprintGeometry.js';
import {
  isPlainObject,
  optionalFinite,
  validateWorldSurfacePolicy,
  normalizePlacementPolicy,
} from './WorldSurfacePolicySchema.js';

export { validateWorldSurfacePolicy, normalizePlacementPolicy };

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
  waterside: Object.freeze({ maxSlopeDegrees: 18, maxWaterDepth: Infinity, minRoadDistance: 0 }),
});

/**
 * Shared placement gate for editor-authored and autonomous world assets.
 *
 * Structure-like assets use footprint-aware grounding by default. The placement core samples the
 * centre, four corners and four edge midpoints of the object's world-space footprint instead of
 * trusting one origin sample. If a caller supplies `conformTerrain`, the callback is asked to bring
 * the ground to one foundation plane; otherwise the object is embedded to the lowest sampled point,
 * which guarantees no footprint corner can remain visibly suspended above the terrain.
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
  footprintGrounding = 'auto',
  foundationInsetMeters = 0.04,
  conformTerrain = null,
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
    footprintGrounding,
    foundationInsetMeters,
    conformTerrain,
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
    placementFootprint: surfaceResult.footprint || null,
    placementPolicy: surfaceResult.policy,
  };
  object.userData.worldPlacementSurface = surfaceResult.surface;
  object.userData.worldPlacementFootprint = surfaceResult.footprint || null;
  object.userData.worldPlacementPolicy = surfaceResult.policy;
  object.userData.worldPlacementManifest = manifest;
  object.userData.materialReadyForWorld = true;

  return {
    ok: true,
    object,
    material: materialResult,
    validation,
    surface: surfaceResult.surface,
    footprint: surfaceResult.footprint || null,
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
  const storedFootprint = object?.userData?.worldPlacementFootprint;
  const storedPolicy = object?.userData?.worldPlacementPolicy;
  if (storedSurface && storedPolicy) {
    const surfaceAudit = evaluateWorldSurfacePlacement(storedSurface, storedPolicy);
    errors.push(...surfaceAudit.errors.map((error) => `surface:${error}`));
  }
  if (storedFootprint?.samples?.length && storedPolicy) {
    storedFootprint.samples.forEach((sample, index) => {
      const audit = evaluateWorldSurfacePlacement(sample, storedPolicy);
      errors.push(...audit.errors.map((error) => `footprint-${index}:${error}`));
    });
  }
  if (storedFootprint?.islandSamples?.length && storedPolicy) {
    storedFootprint.islandSamples.forEach((sample, index) => {
      const audit = evaluateWorldSurfacePlacement(sample, storedPolicy);
      errors.push(...audit.errors.map((error) => `footprint-island-${index}:${error}`));
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings: [...validation.warnings],
    surface: storedSurface || null,
    footprint: storedFootprint || null,
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
  footprintGrounding = 'auto',
  foundationInsetMeters = 0.04,
  conformTerrain = null,
} = {}) {
  const x = object?.position?.x;
  const z = object?.position?.z;
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return { ok: false, error: 'surface:non-finite-xz' };
  }

  const query = createSurfaceQuery(surfaceQuery, groundHeight, object);
  if (!query) {
    if (requireSurfaceContext) return { ok: false, error: 'surface:missing-query' };
    return { ok: true, surface: null, footprint: null, policy: null };
  }

  const policySource = mergeWorldSurfacePolicy(metadata, placementPolicy, object?.userData);
  const policyValidation = validateWorldSurfacePolicy(policySource);
  if (!policyValidation.ok) {
    return {
      ok: false,
      error: `surface:${policyValidation.errors.join(',')}`,
      surface: null,
      footprint: null,
      policy: policyValidation.policy,
      evaluation: policyValidation,
    };
  }
  const policy = policyValidation.policy;

  const useFootprint = shouldUseFootprintGrounding(metadata, object?.userData, footprintGrounding);
  const footprintGeometry = useFootprint ? worldFootprintFor(object) : null;
  const pointRecords = footprintGeometry?.points?.length
    ? footprintGeometry.points
    : [{ label: 'center', x, z }];

  const normalizedSamples = [];
  for (let index = 0; index < pointRecords.length; index += 1) {
    const point = pointRecords[index];
    const normalized = normalizeWorldSurfaceSample(query(point.x, point.z));
    if (!normalized.ok) {
      return {
        ok: false,
        error: `surface:${normalized.error}`,
        surface: normalized.sample,
        footprint: null,
        policy,
      };
    }
    const evaluation = evaluateWorldSurfacePlacement(normalized.sample, policy);
    if (!evaluation.ok) {
      return {
        ok: false,
        error: `surface:${evaluation.errors.join(',')}`,
        surface: normalized.sample,
        footprint: null,
        policy,
        evaluation,
      };
    }
    normalizedSamples.push({ ...normalized.sample, x: point.x, z: point.z, label: point.label });
  }

  const centerSurface = normalizedSamples.find((sample) => sample.label === 'center') || normalizedSamples[0];
  if (!useFootprint || !footprintGeometry || normalizedSamples.length === 1) {
    if (snapToGround) object.position.y = centerSurface.height;
    return { ok: true, surface: stripPlacementCoordinates(centerSurface), footprint: null, policy };
  }

  const islandPointRecords = createDisconnectedFoundationIslandProbes(footprintGeometry.footprintIslands || []);
  const islandSamples = [];
  for (const point of islandPointRecords) {
    const normalized = normalizeWorldSurfaceSample(query(point.x, point.z));
    if (!normalized.ok) {
      return {
        ok: false,
        error: `surface:${normalized.error}`,
        surface: normalized.sample,
        footprint: null,
        policy,
      };
    }
    const evaluation = evaluateWorldSurfacePlacement(normalized.sample, policy);
    if (!evaluation.ok) {
      return {
        ok: false,
        error: `surface:${evaluation.errors.join(',')}`,
        surface: normalized.sample,
        footprint: null,
        policy,
        evaluation,
      };
    }
    islandSamples.push({
      ...normalized.sample,
      x: point.x,
      z: point.z,
      label: point.label,
      islandIndex: point.islandIndex,
    });
  }

  const heightSamples = islandSamples.length ? [...normalizedSamples, ...islandSamples] : normalizedSamples;
  const heights = heightSamples.map((sample) => sample.height);
  const minHeight = Math.min(...heights);
  const maxHeight = Math.max(...heights);
  const inset = Number.isFinite(Number(foundationInsetMeters))
    ? Math.max(0, Number(foundationInsetMeters))
    : 0;

  let targetGroundHeight = maxHeight;
  let terrainConformed = false;
  if (typeof conformTerrain === 'function') {
    const result = conformTerrain({
      object,
      metadata,
      bounds: footprintGeometry.bounds,
      orientedFootprint: footprintGeometry.orientedFootprint || null,
      footprintIslands: footprintGeometry.footprintIslands || [],
      points: pointRecords.map((point) => ({ ...point })),
      samples: normalizedSamples.map((sample) => ({ ...sample })),
      islandPoints: islandPointRecords.map((point) => ({ ...point })),
      islandSamples: islandSamples.map((sample) => ({ ...sample })),
      targetHeight: maxHeight,
      minHeight,
      maxHeight,
    });
    if (result === false || result?.ok === false) {
      return {
        ok: false,
        error: `surface:${result?.error || 'terrain-conform-failed'}`,
        surface: stripPlacementCoordinates(centerSurface),
        footprint: null,
        policy,
      };
    }
    if (Number.isFinite(Number(result?.height))) targetGroundHeight = Number(result.height);
    terrainConformed = true;
  } else {
    targetGroundHeight = minHeight;
  }

  const baseOffsetY = footprintGeometry.baseOffsetY;
  if (snapToGround) object.position.y = targetGroundHeight - baseOffsetY - inset;

  const footprint = Object.freeze({
    groundingMode: terrainConformed ? 'terrain-conform' : 'embedded-low-side',
    minHeight,
    maxHeight,
    heightRange: maxHeight - minHeight,
    targetGroundHeight,
    baseOffsetY,
    insetMeters: inset,
    bounds: footprintGeometry.bounds,
    orientedFootprint: footprintGeometry.orientedFootprint || null,
    footprintIslands: footprintGeometry.footprintIslands || [],
    samples: normalizedSamples.map(stripPlacementCoordinates),
    islandSamples: islandSamples.map(stripPlacementCoordinates),
  });

  return {
    ok: true,
    surface: stripPlacementCoordinates(centerSurface),
    footprint,
    policy,
  };
}

export function resolveWorldSurfacePolicy(metadata = {}, override = null, fallbackMetadata = null) {
  const validation = validateWorldSurfacePolicy(mergeWorldSurfacePolicy(metadata, override, fallbackMetadata));
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

function mergeWorldSurfacePolicy(metadata, override, fallbackMetadata = null) {
  if (override !== null && override !== undefined && !isPlainObject(override)) return override;
  const category = String(metadata?.category || metadata?.kind || '').trim().toLowerCase();
  const exactPreset = WORLD_SURFACE_POLICY_PRESETS[category] || null;
  const structureProfile = exactPreset ? null : resolveStructureSurfaceProfile(metadata, fallbackMetadata);
  const preset = exactPreset || (structureProfile ? WORLD_SURFACE_POLICY_PRESETS[structureProfile] : null);
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

function createSurfaceQuery(surfaceQuery, groundHeight, object) {
  if (typeof surfaceQuery === 'function') {
    return (x, z) => surfaceQuery(x, z, object);
  }
  if (typeof groundHeight === 'function') {
    return (x, z) => {
      const rawHeight = groundHeight(x, z, object);
      if (rawHeight === null || rawHeight === undefined || rawHeight === '') return null;
      return { height: Number(rawHeight) };
    };
  }
  return null;
}

function shouldUseFootprintGrounding(metadata, objectMetadata, footprintGrounding) {
  if (footprintGrounding === true || footprintGrounding === 'always') return true;
  if (footprintGrounding === false || footprintGrounding === 'never') return false;
  return isStructureGroundingCandidate(metadata, objectMetadata);
}

function stripPlacementCoordinates(sample) {
  const { x: _x, z: _z, label: _label, ...surface } = sample;
  return surface;
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