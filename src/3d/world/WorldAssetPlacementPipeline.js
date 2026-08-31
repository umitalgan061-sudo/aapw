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
const POLICY_FIELDS = Object.freeze([
  ...POLICY_NUMERIC_FIELDS.map(([key]) => key),
  ...POLICY_LIST_FIELDS,
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

export function validateWorldSurfacePolicy(policy = {}) {
  const source = isPlainObject(policy) ? policy : null;
  const normalizedPolicy = normalizePlacementPolicy(source || {});
  if (!source) return { ok: false, errors: ['policy-invalid-object'], policy: normalizedPolicy };

  const errors = [];
  for (const key of Object.keys(source)) {
    if (!POLICY_FIELDS.includes(key)) errors.push(`policy-unknown-${policyErrorKey(key)}`);
  }
  for (const [key, allowInfinity] of POLICY_NUMERIC_FIELDS) {
    const value = source[key];
    if (value === null || value === undefined || value === '') continue;
    if (typeof value !== 'number' && typeof value !== 'string') {
      errors.push(`policy-invalid-${policyErrorKey(key)}`);
      continue;
    }
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
  const source = isPlainObject(policy) ? policy : {};
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

function expandBoxWithGeometryCorners(targetBox, geometryBox, matrixWorld, inverseRoot, scratch) {
  for (const x of [geometryBox.min.x, geometryBox.max.x]) {
    for (const y of [geometryBox.min.y, geometryBox.max.y]) {
      for (const z of [geometryBox.min.z, geometryBox.max.z]) {
        scratch.set(x, y, z).applyMatrix4(matrixWorld).applyMatrix4(inverseRoot);
        targetBox.expandByPoint(scratch);
      }
    }
  }
}

const GROUND_CONTACT_BAND_POLICY = Object.freeze({
  minimumMeters: 0.5,
  maximumMeters: 2,
  structureHeightFraction: 0.12,
});

const GROUND_CONTACT_ISLAND_POLICY = Object.freeze({ mergeGapMeters: 1.5, maximumIslands: 4 });

function boxesConnectedInXZ(a, b, gapMeters) {
  const gapX = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const gapZ = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return gapX <= gapMeters && gapZ <= gapMeters;
}

function clusterGroundContactBoxes(boxes) {
  if (!Array.isArray(boxes) || boxes.length <= 1) return boxes?.length ? [boxes[0].clone()] : [];
  const groups = [];
  for (const box of boxes) {
    const touching = [];
    for (let index = 0; index < groups.length; index += 1) {
      if (groups[index].members.some((member) => boxesConnectedInXZ(member, box, GROUND_CONTACT_ISLAND_POLICY.mergeGapMeters))) touching.push(index);
    }
    if (!touching.length) { groups.push({ members: [box], bounds: box.clone() }); continue; }
    const target = groups[touching[0]];
    target.members.push(box); target.bounds.union(box);
    for (let index = touching.length - 1; index >= 1; index -= 1) {
      const merged = groups[touching[index]];
      target.members.push(...merged.members); target.bounds.union(merged.bounds); groups.splice(touching[index], 1);
    }
  }
  const islands = groups.map((group) => group.bounds);
  return islands.length <= GROUND_CONTACT_ISLAND_POLICY.maximumIslands ? islands : [];
}

function rootLocalGeometryBounds(object) {
  object.updateMatrixWorld?.(true);
  const inverseRoot = object.matrixWorld.clone().invert();
  const scratch = new THREE.Vector3();
  const geometryBoxes = [];
  object.traverse?.((node) => {
    if (node?.userData?.terrainFootprintExclude === true || node?.userData?.foundationFootprintExclude === true) return;
    const geometry = node?.geometry;
    if (!geometry?.attributes?.position) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return;
    const nodeBox = new THREE.Box3();
    expandBoxWithGeometryCorners(nodeBox, geometry.boundingBox, node.matrixWorld, inverseRoot, scratch);
    if (!nodeBox.isEmpty()) geometryBoxes.push(nodeBox);
  });
  if (!geometryBoxes.length) return null;

  const allGeometryBox = new THREE.Box3();
  geometryBoxes.forEach((box) => allGeometryBox.union(box));
  if (allGeometryBox.isEmpty()) return null;

  const structureHeight = Math.max(0, allGeometryBox.max.y - allGeometryBox.min.y);
  const groundContactBandMeters = Math.max(
    GROUND_CONTACT_BAND_POLICY.minimumMeters,
    Math.min(
      GROUND_CONTACT_BAND_POLICY.maximumMeters,
      structureHeight * GROUND_CONTACT_BAND_POLICY.structureHeightFraction,
    ),
  );
  const groundContactCeiling = allGeometryBox.min.y + groundContactBandMeters;
  const groundedBox = new THREE.Box3();
  const groundedGeometryBoxes = [];
  for (const box of geometryBoxes) {
    if (box.min.y > groundContactCeiling + 1e-6) continue;
    groundedBox.union(box);
    groundedGeometryBoxes.push(box);
  }

  // Defensive fallback: precision/authoring anomalies must never erase a valid structure footprint.
  const resolvedBox = groundedGeometryBoxes.length > 0 && !groundedBox.isEmpty() ? groundedBox : allGeometryBox;
  const candidateBoxes = groundedGeometryBoxes.length > 0 ? groundedGeometryBoxes : geometryBoxes;
  const islands = clusterGroundContactBoxes(candidateBoxes);
  if (islands.length > 1) resolvedBox.groundContactIslands = islands;
  return resolvedBox;
}

function worldFootprintFor(object) {
  if (!object?.isObject3D) return null;
  object.updateMatrixWorld?.(true);
  const localBox = rootLocalGeometryBounds(object);
  if (!localBox) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return null;
    const minX = box.min.x;
    const maxX = box.max.x;
    const minZ = box.min.z;
    const maxZ = box.max.z;
    const centerX = (minX + maxX) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;
    return {
      baseOffsetY: box.min.y - object.position.y,
      orientedFootprint: null,
      footprintIslands: [],
      bounds: Object.freeze({ minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ }),
      points: [
        { label: 'center', x: centerX, z: centerZ },
        { label: 'north-west', x: minX, z: minZ },
        { label: 'north-east', x: maxX, z: minZ },
        { label: 'south-west', x: minX, z: maxZ },
        { label: 'south-east', x: maxX, z: maxZ },
        { label: 'north-mid', x: centerX, z: minZ },
        { label: 'south-mid', x: centerX, z: maxZ },
        { label: 'west-mid', x: minX, z: centerZ },
        { label: 'east-mid', x: maxX, z: centerZ },
      ],
    };
  }

  const localCenterX = (localBox.min.x + localBox.max.x) * 0.5;
  const localCenterZ = (localBox.min.z + localBox.max.z) * 0.5;
  const halfWidth = (localBox.max.x - localBox.min.x) * 0.5;
  const halfDepth = (localBox.max.z - localBox.min.z) * 0.5;
  const localRecords = [
    ['center', localCenterX, localCenterZ],
    ['north-west', localBox.min.x, localBox.min.z],
    ['north-east', localBox.max.x, localBox.min.z],
    ['south-west', localBox.min.x, localBox.max.z],
    ['south-east', localBox.max.x, localBox.max.z],
    ['north-mid', localCenterX, localBox.min.z],
    ['south-mid', localCenterX, localBox.max.z],
    ['west-mid', localBox.min.x, localCenterZ],
    ['east-mid', localBox.max.x, localCenterZ],
  ];
  const points = localRecords.map(([label, localX, localZ]) => {
    const world = object.localToWorld(new THREE.Vector3(localX, localBox.min.y, localZ));
    return { label, x: world.x, z: world.z };
  });
  const centerWorld = object.localToWorld(new THREE.Vector3(localCenterX, localBox.min.y, localCenterZ));
  const xWorld = object.localToWorld(new THREE.Vector3(localCenterX + 1, localBox.min.y, localCenterZ));
  const zWorld = object.localToWorld(new THREE.Vector3(localCenterX, localBox.min.y, localCenterZ + 1));
  const axisXLength = Math.hypot(xWorld.x - centerWorld.x, xWorld.z - centerWorld.z) || 1;
  const axisZLength = Math.hypot(zWorld.x - centerWorld.x, zWorld.z - centerWorld.z) || 1;
  const orientedFootprint = Object.freeze({
    centerX: centerWorld.x,
    centerZ: centerWorld.z,
    axisX: Object.freeze({ x: (xWorld.x - centerWorld.x) / axisXLength, z: (xWorld.z - centerWorld.z) / axisXLength }),
    axisZ: Object.freeze({ x: (zWorld.x - centerWorld.x) / axisZLength, z: (zWorld.z - centerWorld.z) / axisZLength }),
    halfWidthMeters: halfWidth * axisXLength,
    halfDepthMeters: halfDepth * axisZLength,
  });
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minZ = Math.min(...points.map((point) => point.z));
  const maxZ = Math.max(...points.map((point) => point.z));
  const bottomWorldY = Math.min(...localRecords.slice(1, 5).map(([, localX, localZ]) => (
    object.localToWorld(new THREE.Vector3(localX, localBox.min.y, localZ)).y
  )));
  const islandBoxes = Array.isArray(localBox.groundContactIslands) ? localBox.groundContactIslands : [];
  const footprintIslands = islandBoxes.map((islandBox, index) => {
    const islandCenterX = (islandBox.min.x + islandBox.max.x) * 0.5;
    const islandCenterZ = (islandBox.min.z + islandBox.max.z) * 0.5;
    const islandCenter = object.localToWorld(new THREE.Vector3(islandCenterX, islandBox.min.y, islandCenterZ));
    const corners = [
      [islandBox.min.x, islandBox.min.z], [islandBox.max.x, islandBox.min.z],
      [islandBox.max.x, islandBox.max.z], [islandBox.min.x, islandBox.max.z],
    ].map(([localX, localZ]) => object.localToWorld(new THREE.Vector3(localX, islandBox.min.y, localZ)));
    return Object.freeze({
      index, centerX: islandCenter.x, centerZ: islandCenter.z,
      axisX: orientedFootprint.axisX, axisZ: orientedFootprint.axisZ,
      halfWidthMeters: (islandBox.max.x - islandBox.min.x) * 0.5 * axisXLength,
      halfDepthMeters: (islandBox.max.z - islandBox.min.z) * 0.5 * axisZLength,
      bounds: Object.freeze({
        minX: Math.min(...corners.map((point) => point.x)), maxX: Math.max(...corners.map((point) => point.x)),
        minZ: Math.min(...corners.map((point) => point.z)), maxZ: Math.max(...corners.map((point) => point.z)),
      }),
    });
  });
  return {
    baseOffsetY: bottomWorldY - object.position.y,
    orientedFootprint,
    footprintIslands,
    bounds: Object.freeze({ minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ }),
    points,
  };
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

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const number = Number(value);
  if (allowInfinity && number === Infinity) return Infinity;
  return Number.isFinite(number) ? number : null;
}