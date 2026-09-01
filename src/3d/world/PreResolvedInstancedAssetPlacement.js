import * as THREE from 'three';
import {
  createMaterialManifest,
  validateMaterialAssignment,
} from '../materials/MaterialAssignmentCore.js';
import { attachPreparedWorldAsset } from './WorldAssetPlacementPipeline.js';

/**
 * Bridges already-resolved InstancedMesh batches into the shared world material/placement lifecycle.
 *
 * This module deliberately does not decide geography, terrain height, biome, road or settlement
 * suitability. Those decisions must have been made by the caller's canonical placement authority
 * before matrices reach this adapter. The adapter only validates that the prepared batch is finite,
 * that its authored material can be described by MaterialAssignmentCore, emits the same manifest and
 * readiness metadata expected by WorldAssetPlacementPipeline, and delegates the actual attachment to
 * `attachPreparedWorldAsset()`.
 *
 * It exists because a large instanced batch cannot be re-run through point/footprint placement as one
 * Object3D at the origin: the real transforms live in `instanceMatrix`, not `object.position`.
 * Re-expanding hundreds of rocks into individual Mesh objects just to satisfy that API would destroy
 * the instancing/performance contract. This adapter keeps one shared placement authority while making
 * the already-resolved-batch case explicit and auditable.
 *
 * @module world/PreResolvedInstancedAssetPlacement
 */

export const PRE_RESOLVED_INSTANCED_ASSET_POLICY = Object.freeze({
  id: 'pre-resolved-instanced-world-asset-2026-09-01-v1',
  materialAuthority: 'materials/MaterialAssignmentCore.js',
  attachmentAuthority: 'world/WorldAssetPlacementPipeline.js',
  geographyAuthority: 'caller-owned-pre-resolved-placement',
  mutatesInstanceMatrices: false,
  mutatesAuthoredMaterials: false,
  requiresFiniteMatrices: true,
  requiresCountParity: true,
});

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();

function finiteMatrix(matrix) {
  const elements = matrix?.elements;
  if (!elements || elements.length !== 16) return false;
  for (let i = 0; i < 16; i += 1) {
    if (!Number.isFinite(elements[i])) return false;
  }
  return true;
}

function finiteTransformFromMatrix(matrix) {
  if (!finiteMatrix(matrix)) return false;
  matrix.decompose(_position, _quaternion, _scale);
  return [
    _position.x, _position.y, _position.z,
    _quaternion.x, _quaternion.y, _quaternion.z, _quaternion.w,
    _scale.x, _scale.y, _scale.z,
  ].every(Number.isFinite);
}

function validateInstanceMatrices(object) {
  const errors = [];
  if (!object?.isInstancedMesh) return { ok: false, errors: ['not-instanced-mesh'], count: 0 };
  if (!Number.isInteger(object.count) || object.count < 0) {
    return { ok: false, errors: ['invalid-instance-count'], count: Number(object.count) || 0 };
  }
  for (let index = 0; index < object.count; index += 1) {
    object.getMatrixAt(index, _matrix);
    if (!finiteTransformFromMatrix(_matrix)) {
      errors.push(`non-finite-instance-matrix:${index}`);
      break;
    }
  }
  return { ok: errors.length === 0, errors, count: object.count };
}

function sourcePrototypeFor(object) {
  const prototype = new THREE.Mesh(object.geometry, object.material);
  prototype.name = `${object.name || 'instanced-asset'}-material-prototype`;
  prototype.userData = {
    ...object.userData,
    isPlaceholder: Boolean(object.userData?.isPlaceholder),
  };
  return prototype;
}

function cloneRecord(value) {
  if (!value || typeof value !== 'object') return value ?? null;
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}

function normalizedPlacementIds(object, placementIds) {
  const ids = Array.isArray(placementIds)
    ? placementIds
    : Array.isArray(object?.userData?.placementIds)
      ? object.userData.placementIds
      : [];
  return ids.map((id) => String(id));
}

/**
 * Prepare one already-grounded InstancedMesh for shared world attachment without changing authored
 * source materials or any instance transform.
 *
 * @param {THREE.InstancedMesh} object
 * @param {object} options
 * @param {object} [options.metadata]
 * @param {string[]} [options.placementIds]
 * @param {string|number|null} [options.placementChecksum]
 * @param {string|null} [options.placementPolicyId]
 * @param {object|null} [options.batchMetadata]
 * @returns {{ok: boolean, object?: THREE.InstancedMesh, manifest?: object, validation?: object, error?: string}}
 */
export function preparePreResolvedInstancedWorldAsset(object, {
  metadata = {},
  placementIds = null,
  placementChecksum = null,
  placementPolicyId = null,
  batchMetadata = null,
} = {}) {
  if (!object?.isInstancedMesh) return { ok: false, error: 'missing-instanced-mesh' };
  if (object.userData?.isPlaceholder) return { ok: false, error: 'placeholder-model' };

  const ids = normalizedPlacementIds(object, placementIds);
  if (ids.length && ids.length !== object.count) {
    return { ok: false, error: `placement-count-mismatch:${ids.length}:${object.count}` };
  }

  const matrixValidation = validateInstanceMatrices(object);
  if (!matrixValidation.ok) {
    return { ok: false, error: matrixValidation.errors.join(','), matrixValidation };
  }

  // MaterialAssignmentCore currently models dressable source meshes rather than InstancedMesh
  // batches. A zero-cost prototype references the exact geometry/material pair used by the batch;
  // no material is cloned, replaced or disposed here.
  const prototype = sourcePrototypeFor(object);
  const validation = validateMaterialAssignment(prototype, { requireGeneratedTexture: false });
  if (!validation.ok) {
    return { ok: false, error: `material:${validation.errors.join(',')}`, validation };
  }

  const materialManifest = createMaterialManifest(prototype, {
    metadata,
    placement: null,
  });

  object.userData ||= {};
  if (metadata.id) object.userData.assetId = metadata.id;
  if (metadata.category) object.userData.assetCategory = metadata.category;
  if (metadata.src) object.userData.assetSrc = metadata.src;

  const manifest = Object.freeze({
    ...materialManifest,
    placement: Object.freeze({
      mode: 'pre-resolved-instanced',
      count: object.count,
      placementPolicyId: placementPolicyId || null,
      placementChecksum: placementChecksum == null ? null : String(placementChecksum),
      placementIdsPresent: ids.length === object.count,
      firstPlacementId: ids[0] ?? null,
      lastPlacementId: ids.at(-1) ?? null,
      batchMetadata: cloneRecord(batchMetadata),
    }),
    validation: Object.freeze({
      ...materialManifest.validation,
      instanceCount: object.count,
      finiteInstanceMatrices: true,
      authoredMaterialPreserved: true,
    }),
  });

  object.userData.preResolvedInstancedAsset = Object.freeze({
    policyId: PRE_RESOLVED_INSTANCED_ASSET_POLICY.id,
    placementPolicyId: placementPolicyId || null,
    placementChecksum: placementChecksum == null ? null : String(placementChecksum),
    instanceCount: object.count,
    authoredMaterialPreserved: true,
    matricesMutated: false,
  });
  object.userData.worldPlacementManifest = manifest;
  object.userData.worldPlacementSurface = null;
  object.userData.worldPlacementFootprint = null;
  object.userData.worldPlacementPolicy = placementPolicyId
    ? Object.freeze({ id: placementPolicyId, preResolved: true })
    : Object.freeze({ preResolved: true });
  object.userData.materialReadyForWorld = true;

  return {
    ok: true,
    object,
    validation,
    matrixValidation,
    manifest,
  };
}

/**
 * Attach a prepared batch through the shared WorldAssetPlacementPipeline attachment gate.
 */
export function attachPreResolvedInstancedWorldAsset(scene, object, options = {}) {
  const prepared = preparePreResolvedInstancedWorldAsset(object, options);
  if (!prepared.ok) return prepared;
  const attached = attachPreparedWorldAsset(scene, prepared);
  return attached.ok ? prepared : attached;
}

export function auditPreResolvedInstancedWorldAsset(object) {
  const errors = [];
  if (!object?.isInstancedMesh) errors.push('not-instanced-mesh');
  if (!object?.userData?.materialReadyForWorld) errors.push('placement-gate-not-used');
  if (object?.userData?.preResolvedInstancedAsset?.policyId !== PRE_RESOLVED_INSTANCED_ASSET_POLICY.id) {
    errors.push('missing-pre-resolved-policy');
  }
  const matrices = validateInstanceMatrices(object);
  errors.push(...matrices.errors);
  const ids = normalizedPlacementIds(object, null);
  if (ids.length && ids.length !== object.count) errors.push('placement-count-mismatch');
  if (!object?.userData?.worldPlacementManifest?.validation?.authoredMaterialPreserved) {
    errors.push('authored-material-manifest-missing');
  }
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    instanceCount: Number(object?.count) || 0,
    placementPolicyId: object?.userData?.preResolvedInstancedAsset?.placementPolicyId || null,
    placementChecksum: object?.userData?.preResolvedInstancedAsset?.placementChecksum || null,
    manifest: object?.userData?.worldPlacementManifest || null,
  });
}
