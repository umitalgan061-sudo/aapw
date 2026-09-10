/**
 * Asset/material/placement evidence contract for the player world-coverage slice.
 *
 * This module deliberately receives observations rather than loading or transforming assets.
 * When a model-bearing caller supplies evidence, the shared #590 successor must remain the
 * authoritative MaterialAssignmentCore + WorldAssetPlacementPipeline pair. This layer verifies
 * that order and records the evidence for shipped runtime acceptance.
 *
 * @module gameplay/playerWorldCoverageAssetEvidence
 */

const SHARED_MATERIAL = 'src/3d/materials/MaterialAssignmentCore.js';
const SHARED_PLACEMENT = 'src/3d/world/WorldAssetPlacementPipeline.js';
const EDITOR_MATERIAL = 'src/3d/editor/EditorMaterialStudio.js';

const REQUIRED_SURFACE_ROLES = Object.freeze(['skin', 'hair', 'eye', 'cloth', 'leather', 'metal', 'boot', 'weapon']);
const KNOWN_ASSET_STATES = Object.freeze(['loaded', 'pointer', 'missing', 'error', 'unknown']);
const KNOWN_PIPELINE_STEPS = Object.freeze(['source-asset', 'material-core', 'validate', 'placement-pipeline', 'ground-snap', 'scene-attach']);

function stringValue(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function bool(value, fallback = false) {
  return typeof value === 'boolean' ? value : fallback;
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positiveInt(value, fallback = 0) {
  return Math.max(0, Math.floor(finite(value, fallback)));
}

function uniqueSorted(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => stringValue(value)).filter(Boolean))].sort();
}

function normalizeMaterialSlot(slot, index) {
  const material = slot?.material ?? slot ?? {};
  const role = stringValue(slot?.role ?? material.role, 'unknown').toLowerCase();
  return {
    index: positiveInt(slot?.index, index),
    name: stringValue(slot?.name ?? material.name, `slot-${index}`),
    role,
    hasUv: bool(slot?.hasUv ?? material.hasUv),
    hasNormal: bool(slot?.hasNormal ?? material.hasNormal),
    hasRoughness: bool(slot?.hasRoughness ?? material.hasRoughness),
    hasMetalness: bool(slot?.hasMetalness ?? material.hasMetalness),
    textureSizes: Array.isArray(slot?.textureSizes ?? material.textureSizes)
      ? (slot?.textureSizes ?? material.textureSizes).map((size) => positiveInt(size)).filter(Boolean).sort((a, b) => a - b)
      : [],
    paletteId: stringValue(slot?.paletteId ?? material.paletteId, ''),
    generated: bool(slot?.generated ?? material.generated),
    authored: bool(slot?.authored ?? material.authored),
  };
}

export function normalizeAssetEvidence(input = {}) {
  const meshes = Array.isArray(input.meshes) ? input.meshes : [];
  const slots = Array.isArray(input.materialSlots) ? input.materialSlots : [];
  const normalizedSlots = slots.map(normalizeMaterialSlot);
  const surfaceRoles = uniqueSorted([
    ...(Array.isArray(input.surfaceRoles) ? input.surfaceRoles : []),
    ...normalizedSlots.map((slot) => slot.role),
  ]);
  const assetState = KNOWN_ASSET_STATES.includes(input.assetState) ? input.assetState : 'unknown';
  const textureSizes = uniqueSorted([]);
  for (const slot of normalizedSlots) for (const size of slot.textureSizes) textureSizes.push(String(size));
  return {
    assetId: stringValue(input.assetId ?? input.id, 'unknown-asset'),
    sourcePath: stringValue(input.sourcePath ?? input.src, ''),
    extension: stringValue(input.extension, '').toLowerCase(),
    assetState,
    isLfsPointer: assetState === 'pointer' || bool(input.isLfsPointer),
    loaderVerified: bool(input.loaderVerified),
    missingAsset: assetState === 'missing' || assetState === 'error',
    meshCount: meshes.length,
    materialSlotCount: normalizedSlots.length,
    materialSlots: normalizedSlots,
    surfaceRoles,
    requiredRoleCoverage: Object.fromEntries(REQUIRED_SURFACE_ROLES.map((role) => [role, surfaceRoles.includes(role)])),
    namedPartCount: positiveInt(input.namedPartCount),
    layeredFallback: bool(input.layeredFallback),
    importedMaterialsPreserved: bool(input.importedMaterialsPreserved, true),
    paletteIds: uniqueSorted(Array.isArray(input.paletteIds) ? input.paletteIds : normalizedSlots.map((slot) => slot.paletteId)),
    textureSizes: textureSizes.map(Number).filter(Boolean).sort((a, b) => a - b),
    placeholder: bool(input.placeholder),
    editorMaterialStudioImported: bool(input.editorMaterialStudioImported),
    threeImportedForEvidence: bool(input.threeImportedForEvidence),
    sharedMaterialAuthority: stringValue(input.sharedMaterialAuthority, SHARED_MATERIAL),
    sharedPlacementAuthority: stringValue(input.sharedPlacementAuthority, SHARED_PLACEMENT),
    placementOrder: uniqueSorted(input.placementOrder ?? KNOWN_PIPELINE_STEPS),
    groundDeltaMeters: input.groundDeltaMeters === null || input.groundDeltaMeters === undefined ? null : Math.abs(finite(input.groundDeltaMeters)),
    consoleErrorCount: positiveInt(input.consoleErrorCount),
    pageErrorCount: positiveInt(input.pageErrorCount),
  };
}

function orderedExactly(values, expected) {
  if (!Array.isArray(values)) return false;
  return expected.every((value, index) => values[index] === value) && values.length >= expected.length;
}

export function validatePlayerAssetEvidence(input = {}, {
  requireNamedSurfaces = false,
  requireGeneratedMaterials = false,
  requireLoadedAsset = false,
  maxGroundDeltaMeters = 0.18,
} = {}) {
  const evidence = normalizeAssetEvidence(input);
  const errors = [];
  const warnings = [];
  if (evidence.meshCount <= 0) errors.push('no-renderable-mesh');
  if (evidence.placeholder) errors.push('placeholder-model');
  if (evidence.missingAsset) errors.push('missing-asset');
  if (requireLoadedAsset && evidence.assetState !== 'loaded') errors.push('asset-not-loaded');
  if (evidence.editorMaterialStudioImported) errors.push('editor-material-runtime-import');
  if (evidence.sharedMaterialAuthority !== SHARED_MATERIAL) errors.push('wrong-material-authority');
  if (evidence.sharedPlacementAuthority !== SHARED_PLACEMENT) errors.push('wrong-placement-authority');
  if (!orderedExactly(evidence.placementOrder, KNOWN_PIPELINE_STEPS)) errors.push('wrong-placement-order');
  if (requireNamedSurfaces && evidence.namedPartCount <= 0 && !evidence.layeredFallback) errors.push('missing-layered-fallback');
  if (requireGeneratedMaterials && evidence.materialSlotCount > 0 && !evidence.materialSlots.some((slot) => slot.generated)) errors.push('no-generated-material');
  if (evidence.consoleErrorCount > 0) errors.push('console-errors');
  if (evidence.pageErrorCount > 0) errors.push('page-errors');
  if (evidence.groundDeltaMeters !== null && evidence.groundDeltaMeters > maxGroundDeltaMeters) errors.push('grounding-delta-too-large');
  if (evidence.materialSlotCount === 1 && evidence.meshCount === 1 && evidence.namedPartCount === 0 && !evidence.layeredFallback) warnings.push('single-surface-material-risk');
  if (evidence.assetState === 'pointer' && !evidence.loaderVerified) warnings.push('lfs-pointer-not-hydrated');
  if (evidence.surfaceRoles.length < 2 && evidence.meshCount > 0) warnings.push('low-surface-role-diversity');
  return Object.freeze({
    ok: errors.length === 0,
    errors,
    warnings,
    evidence,
    sourceAssetRequired: true,
    sharedMaterialAuthority: SHARED_MATERIAL,
    sharedPlacementAuthority: SHARED_PLACEMENT,
    editorMaterialForbidden: EDITOR_MATERIAL,
  });
}

export function buildPlayerAssetEvidenceManifest(entries = [], options = {}) {
  const rows = (Array.isArray(entries) ? entries : []).map((entry) => validatePlayerAssetEvidence(entry, options));
  const missingAssetCount = rows.filter((row) => row.evidence.missingAsset).length;
  const loadedCount = rows.filter((row) => row.evidence.assetState === 'loaded').length;
  const pointerCount = rows.filter((row) => row.evidence.assetState === 'pointer').length;
  const placeholderCount = rows.filter((row) => row.evidence.placeholder).length;
  const errors = rows.flatMap((row) => row.errors.map((error) => `${row.evidence.assetId}:${error}`));
  return Object.freeze({
    version: 1,
    count: rows.length,
    accepted: errors.length === 0,
    loadedCount,
    pointerCount,
    missingAssetCount,
    placeholderCount,
    surfaceRoleUnion: uniqueSorted(rows.flatMap((row) => row.evidence.surfaceRoles)),
    paletteUnion: uniqueSorted(rows.flatMap((row) => row.evidence.paletteIds)),
    textureSizes: [...new Set(rows.flatMap((row) => row.evidence.textureSizes))].sort((a, b) => a - b),
    errors,
    warnings: rows.flatMap((row) => row.warnings.map((warning) => `${row.evidence.assetId}:${warning}`)),
    materialAuthority: SHARED_MATERIAL,
    placementAuthority: SHARED_PLACEMENT,
    editorMaterialUiForbidden: true,
  });
}

export function buildModelPlacementProof({ asset, material, placement, runtime } = {}) {
  const evidence = {
    asset: normalizeAssetEvidence(asset),
    material: normalizeAssetEvidence(material),
    placement: normalizeAssetEvidence(placement),
    runtime: {
      spawnObserved: bool(runtime?.spawnObserved),
      inputObserved: bool(runtime?.inputObserved),
      animationObserved: bool(runtime?.animationObserved),
      combatObserved: bool(runtime?.combatObserved),
      equipmentObserved: bool(runtime?.equipmentObserved),
      consoleErrorCount: positiveInt(runtime?.consoleErrorCount),
      pageErrorCount: positiveInt(runtime?.pageErrorCount),
    },
  };
  const validation = buildPlayerAssetEvidenceManifest([asset, material, placement], { requireNamedSurfaces: true });
  const runtimeOk = Object.values(evidence.runtime).every((value) => typeof value !== 'number' || value === 0)
    && evidence.runtime.spawnObserved
    && evidence.runtime.inputObserved
    && evidence.runtime.animationObserved
    && evidence.runtime.combatObserved
    && evidence.runtime.equipmentObserved;
  return Object.freeze({
    version: 1,
    accepted: validation.accepted && runtimeOk,
    runtimeOk,
    evidence,
    manifest: validation,
  });
}

export function getPlayerWorldCoverageAssetContract() {
  return Object.freeze({
    sharedMaterial: SHARED_MATERIAL,
    sharedPlacement: SHARED_PLACEMENT,
    editorMaterialUi: EDITOR_MATERIAL,
    pipelineOrder: KNOWN_PIPELINE_STEPS,
    requiredSurfaceRoles: REQUIRED_SURFACE_ROLES,
    pointerIsNotMissing: true,
    sourceOverwriteForbidden: true,
    primitivePlaceholderForbidden: true,
    missingAssetDefinition: 'observed-loader-failure-only',
  });
}
