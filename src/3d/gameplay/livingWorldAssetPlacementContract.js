/**
 * Şafak Kartalı — asset-first world placement admission bridge.
 *
 * No model loading or scene attachment is implemented here. The existing shared Material/Placement
 * contract is authoritative. This adapter inspects caller-provided asset metadata, rejects obvious
 * placeholders/LFS pointers where appropriate, requires material validation, and emits a deterministic
 * placement request that the existing `WorldAssetPlacementPipeline` can consume.
 */

const freeze = (value) => Object.freeze(value);
const num = (v, f = 0) => Number.isFinite(Number(v)) ? Number(v) : f;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, num(v, lo)));
const str = (v, f = '') => v == null || v === '' ? f : String(v);

export const ASSET_PLACEMENT_POLICY = freeze({
  id: 'safak-kartali-asset-placement-2026-09-14-v1',
  deterministic: true,
  sharedMaterialModule: 'src/3d/materials/MaterialAssignmentCore.js',
  sharedPlacementModule: 'src/3d/world/WorldAssetPlacementPipeline.js',
  maxRequestsPerTick: 12,
  maxTextureSize: 4096,
  minimumTextureSize: 64,
  maxSlopeDegrees: 38,
  settlementBufferMeters: 6,
  roadBufferMeters: 3,
  waterClearanceMeters: 2,
});

const FAMILY_ROOTS = freeze({
  human: 'assets/models/characters',
  horse: 'assets/models/animals',
  wolf: 'assets/models/animals',
  animal: 'assets/models/animals',
  creature: 'assets/models/creatures',
  dragon: 'assets/models/dragons',
});

const REQUIRED_ROLES = freeze({
  human: freeze(['skin', 'hair', 'eyes', 'clothing', 'boots', 'gear']),
  horse: freeze(['coat', 'mane', 'tail', 'hoof', 'saddle', 'harness']),
  animal: freeze(['fur', 'eye', 'claw', 'tooth']),
  wolf: freeze(['fur', 'eye', 'claw', 'tooth']),
  creature: freeze(['fur', 'eye', 'claw', 'tooth']),
  dragon: freeze(['scale', 'wing', 'eye', 'horn', 'claw']),
});

function hash(value) { let h = 2166136261; for (const c of String(value)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0; return (h ^ (h >>> 16)) >>> 0; }
function pathFamily(path) { const p = str(path).replaceAll('\\', '/').toLowerCase(); for (const [family, root] of Object.entries(FAMILY_ROOTS)) if (p.startsWith(root)) return family; return null; }
function extension(path) { const p = str(path).toLowerCase(); const dot = p.lastIndexOf('.'); return dot >= 0 ? p.slice(dot) : ''; }
function isPointerText(value) { const text = str(value).trim(); return text.startsWith('version https://git-lfs.github.com/spec/v1') || /(^|\n)oid sha256:[0-9a-f]{40,}/.test(text) && text.length < 300; }
function positionOf(value) { const p = value?.object3D?.position ?? value?.position ?? value?.transform?.position; if (!p) return null; const x = num(p.x, NaN); const y = num(p.y, NaN); const z = num(p.z, NaN); return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null; }
function round(v, d = 5) { const p = 10 ** d; return Math.round(num(v) * p) / p; }

export function classifyAssetFamily({ path = '', kind = '', category = '' } = {}) {
  const direct = pathFamily(path);
  if (direct) return direct;
  const combined = `${kind} ${category} ${path}`.toLowerCase();
  if (/dragon|ejder/.test(combined)) return 'dragon';
  if (/wolf|kurt/.test(combined)) return 'wolf';
  if (/horse|at|stallion|mare/.test(combined)) return 'horse';
  if (/creature|canavar|monster|beast/.test(combined)) return 'creature';
  if (/animal|fauna|deer|bear|fox|bird|boar|sheep|goat|cat|bee/.test(combined)) return 'animal';
  return 'human';
}

export function requiredSurfaceRoles(family) { return REQUIRED_ROLES[family] ?? REQUIRED_ROLES.human; }

export function inspectAssetMetadata(asset = {}) {
  const family = classifyAssetFamily(asset);
  const path = str(asset.path ?? asset.src);
  const bytes = Math.max(0, num(asset.byteLength ?? asset.size));
  const ext = extension(path);
  const pointer = Boolean(asset.lfsPointer) || isPointerText(asset.content);
  const imported = ['.glb', '.gltf', '.fbx', '.blend'].includes(ext);
  const placeholder = Boolean(asset.placeholder) || /placeholder|dummy|primitive|marker-/i.test(path) || asset.placeholder === true;
  const roles = requiredSurfaceRoles(family);
  return freeze({ family, path, extension: ext, bytes, lfsPointer: pointer, importedFormat: imported, placeholder, requiredRoles: roles, sourceExists: asset.exists !== false });
}

export function validateAssetSource(asset = {}) {
  const meta = inspectAssetMetadata(asset);
  const reasons = [];
  if (!meta.path) reasons.push('missing-source-path');
  if (meta.sourceExists === false) reasons.push('source-missing');
  if (meta.placeholder) reasons.push('placeholder-model');
  if (!meta.importedFormat) reasons.push('unsupported-import-format');
  if (meta.lfsPointer && meta.bytes > 0 && meta.bytes < 512) reasons.push('unhydrated-lfs-pointer');
  return freeze({ ok: reasons.length === 0, reasons: freeze(reasons), meta });
}

export function analyzeMaterialEvidence(evidence = {}, family = 'human') {
  const required = requiredSurfaceRoles(family);
  const slots = Array.isArray(evidence.slots) ? evidence.slots.map(String) : [];
  const slotNames = new Set(slots.map((slot) => slot.toLowerCase()));
  const named = required.filter((role) => slots.some((slot) => slot.toLowerCase().includes(role)));
  const missing = required.filter((role) => !named.includes(role));
  const meshCount = Math.max(0, Math.floor(num(evidence.meshCount)));
  const materialCount = Math.max(0, Math.floor(num(evidence.materialCount)));
  const textureSize = Math.max(0, Math.floor(num(evidence.textureSize)));
  const layeredFallback = meshCount === 1 && materialCount <= 1;
  const ready = meshCount > 0 && materialCount > 0 && textureSize >= ASSET_PLACEMENT_POLICY.minimumTextureSize;
  return freeze({ ready, meshCount, materialCount, textureSize, namedRoles: freeze(named), missingRoles: freeze(missing), layeredFallback, roleCoverage: required.length ? named.length / required.length : 1, slotNames: freeze([...slotNames].sort()) });
}

export function buildMaterialRecipeRequest(asset, evidence = {}, palette = '') {
  const meta = inspectAssetMetadata(asset);
  const analysis = analyzeMaterialEvidence(evidence, meta.family);
  return freeze({
    subject: freeze({ id: str(asset.id, hash(meta.path).toString(16)), family: meta.family, path: meta.path }),
    paletteId: str(palette),
    mode: analysis.layeredFallback ? 'layers' : analysis.missingRoles.length ? 'surface' : 'preserve-or-surface',
    requiredRoles: meta.requiredRoles,
    namedRoles: analysis.namedRoles,
    missingRoles: analysis.missingRoles,
    textureSize: Math.min(ASSET_PLACEMENT_POLICY.maxTextureSize, Math.max(ASSET_PLACEMENT_POLICY.minimumTextureSize, analysis.textureSize || 256)),
    preserveImportedMaterial: !analysis.layeredFallback && analysis.missingRoles.length === 0,
  });
}

export function validateMaterialResult(result = {}, family = 'human') {
  const reasons = [];
  if (result.ok === false) reasons.push(str(result.error, 'material-assignment-failed'));
  const validation = result.validation ?? result.materialValidation ?? result;
  if (validation.missingMaterial || validation.missingMaterials) reasons.push('missing-material');
  if (validation.placeholder) reasons.push('placeholder-material');
  if (validation.singleSurfaceFailure) reasons.push('single-surface-without-fallback');
  const analysis = analyzeMaterialEvidence({ slots: result.slots ?? Object.keys(result.slotAssignments ?? {}), meshCount: result.meshes ?? result.meshCount, materialCount: result.generatedMaterialCount ?? result.materialCount, textureSize: result.textureSize }, family);
  if (!analysis.ready && result.ok !== true) reasons.push('material-not-ready');
  return freeze({ ok: reasons.length === 0, reasons: freeze([...new Set(reasons)]), analysis });
}

export function validateGroundAlignment(context = {}) {
  const slope = Math.abs(num(context.slopeDegrees, 0));
  const y = num(context.groundHeight, NaN);
  const onWater = Boolean(context.onWater);
  const insideSettlement = Boolean(context.insideSettlement);
  const onRoad = Boolean(context.onRoad);
  const reasons = [];
  if (!Number.isFinite(y)) reasons.push('ground-height-missing');
  if (slope > ASSET_PLACEMENT_POLICY.maxSlopeDegrees) reasons.push('slope-too-steep');
  if (onWater && num(context.waterDepthMeters) > 0) reasons.push('water-surface');
  if (context.requiresSettlement && !insideSettlement) reasons.push('outside-required-settlement');
  if (context.requiresRoad && !onRoad) reasons.push('outside-required-road');
  return freeze({ ok: reasons.length === 0, reasons: freeze(reasons), groundHeight: Number.isFinite(y) ? round(y, 3) : null, slopeDegrees: round(slope, 2), onWater, insideSettlement, onRoad });
}

export function validateHabitatAlignment(asset = {}, context = {}) {
  const family = classifyAssetFamily(asset);
  const distanceToSettlement = num(context.distanceToSettlementMeters, Infinity);
  const distanceToRoad = num(context.distanceToRoadMeters, Infinity);
  const requiredSettlement = family === 'human' || family === 'horse';
  const wild = ['wolf', 'animal', 'creature', 'dragon'].includes(family);
  const reasons = [];
  if (wild && Boolean(context.insideSettlement) && family !== 'dragon') reasons.push('wildlife-inside-settlement');
  if (family === 'dragon' && Boolean(context.insideSettlement) && distanceToSettlement < 30) reasons.push('dragon-settlement-buffer');
  if (wild && num(context.waterDepthMeters) > 4) reasons.push('deep-water-habitat');
  if (requiredSettlement && distanceToSettlement > 200 && context.requiresSettlement) reasons.push('human-too-far-from-settlement');
  if (family !== 'human' && family !== 'horse' && Number.isFinite(distanceToRoad) && distanceToRoad < 2 && context.avoidRoad === true) reasons.push('road-buffer');
  return freeze({ ok: reasons.length === 0, family, reasons: freeze(reasons), habitat: str(context.biome, 'unknown'), distanceToSettlementMeters: Number.isFinite(distanceToSettlement) ? round(distanceToSettlement, 2) : null, distanceToRoadMeters: Number.isFinite(distanceToRoad) ? round(distanceToRoad, 2) : null });
}

export function buildPlacementRequest(asset, materialResult, context = {}) {
  const meta = inspectAssetMetadata(asset);
  const source = validateAssetSource(asset);
  const material = validateMaterialResult(materialResult, meta.family);
  const ground = validateGroundAlignment(context);
  const habitat = validateHabitatAlignment(asset, context);
  const accepted = source.ok && material.ok && ground.ok && habitat.ok;
  const position = positionOf(context.position) ?? (Number.isFinite(num(context.x, NaN)) && Number.isFinite(num(context.y, NaN)) && Number.isFinite(num(context.z, NaN)) ? { x: num(context.x), y: num(context.y), z: num(context.z) } : null);
  return freeze({ accepted, reasons: freeze([...source.reasons, ...material.reasons, ...ground.reasons, ...habitat.reasons]), asset: meta, material, ground, habitat, position, manifestId: `safak-place-${hash(JSON.stringify({ id: asset?.id, path: meta.path, position, biome: habitat.habitat })).toString(16).padStart(8, '0')}` });
}

export function executePlacementContract({ asset, materialCore, placementPipeline, materialEvidence = {}, paletteId = '', context = {} } = {}) {
  const source = validateAssetSource(asset);
  if (!source.ok) return freeze({ ok: false, stage: 'source', reasons: source.reasons });
  const recipe = buildMaterialRecipeRequest(asset, materialEvidence, paletteId);
  let materialResult = materialEvidence;
  if (typeof materialCore?.autoAssignMaterials === 'function') materialResult = materialCore.autoAssignMaterials(asset.object ?? asset, { metadata: recipe.subject, recipe });
  const materialValidation = validateMaterialResult(materialResult, source.meta.family);
  if (!materialValidation.ok) return freeze({ ok: false, stage: 'material', reasons: materialValidation.reasons, recipe, materialValidation });
  if (typeof materialCore?.validateMaterialAssignment === 'function') {
    const checked = materialCore.validateMaterialAssignment(asset.object ?? asset);
    if (checked?.ok === false) return freeze({ ok: false, stage: 'material-validation', reasons: freeze(['shared-core-rejected']) });
  }
  const request = buildPlacementRequest(asset, materialResult, context);
  if (!request.accepted) return freeze({ ok: false, stage: 'placement-admission', reasons: request.reasons, request, recipe });
  if (typeof placementPipeline?.prepareWorldAssetForPlacement === 'function') {
    const prepared = placementPipeline.prepareWorldAssetForPlacement(asset.object ?? asset, context);
    if (prepared?.materialReadyForWorld === false) return freeze({ ok: false, stage: 'shared-placement-prepare', reasons: freeze(['shared-pipeline-not-ready']), request, recipe });
  }
  let attached = null;
  if (typeof placementPipeline?.applyTransform === 'function') attached = placementPipeline.applyTransform(asset.object ?? asset, context);
  const manifest = typeof placementPipeline?.createPlacementManifest === 'function' ? placementPipeline.createPlacementManifest(asset.object ?? asset, { ...request, materialManifest: materialResult?.manifest }) : null;
  return freeze({ ok: true, request, recipe, attached: Boolean(attached), manifest });
}

export function placementAudit(result = {}) {
  const errors = [];
  if (result.ok !== true) errors.push('placement-not-accepted');
  if (result?.request?.asset?.placeholder) errors.push('placeholder');
  if (result?.request?.asset?.lfsPointer && result?.request?.asset?.bytes < 512) errors.push('lfs-not-hydrated');
  if (!result?.request?.material?.analysis?.ready) errors.push('material-analysis');
  if (!result?.request?.ground?.ok) errors.push('ground');
  if (!result?.request?.habitat?.ok) errors.push('habitat');
  return freeze({ ok: !errors.length, errors: freeze([...new Set(errors)]), fingerprint: hash(JSON.stringify(result ?? null)).toString(16).padStart(8, '0') });
}

export function placementManifest(result = {}) { return freeze({ contract: ASSET_PLACEMENT_POLICY.id, sharedMaterialModule: ASSET_PLACEMENT_POLICY.sharedMaterialModule, sharedPlacementModule: ASSET_PLACEMENT_POLICY.sharedPlacementModule, accepted: result.ok === true, manifestId: result?.request?.manifestId ?? '', assetFamily: result?.request?.asset?.family ?? '', sourcePath: result?.request?.asset?.path ?? '', materialMode: result?.recipe?.mode ?? '', groundAligned: result?.request?.ground?.ok === true, habitatAligned: result?.request?.habitat?.ok === true }); }
