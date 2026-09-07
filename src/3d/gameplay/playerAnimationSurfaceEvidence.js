/**
 * Shared-material-backed visual evidence for the shipped player model.
 *
 * This adapter never assigns materials itself. It delegates surface inspection/validation to the
 * merged MaterialAssignmentCore and adds only player-specific semantic role evidence, so character
 * surface quality can be verified without creating another material framework.
 *
 * @module gameplay/playerAnimationSurfaceEvidence
 */
import {
  analyzeMaterialSurfaces,
  validateMaterialAssignment,
} from '../materials/MaterialAssignmentCore.js';

const ROLE_RULES = Object.freeze([
  ['skin', /skin|face|body|head/i],
  ['hair', /hair|ponytail|beard/i],
  ['cloth', /cloth|dress|shirt|tunic|trouser|skirt|fabric/i],
  ['leather', /leather|belt|strap|glove/i],
  ['metal', /metal|steel|armor|armour|blade|mail|chain/i],
  ['boot', /boot|shoe|footwear/i],
]);

function safeName(value) {
  return String(value ?? '').trim();
}

function classifySurface(surface) {
  const haystack = [surface?.meshName, surface?.materialName, surface?.slot].map(safeName).join(' ');
  const match = ROLE_RULES.find(([, pattern]) => pattern.test(haystack));
  return match ? match[0] : 'unclassified';
}

function materialTextureSlots(material) {
  return Object.freeze({
    map: Boolean(material?.map),
    normalMap: Boolean(material?.normalMap),
    roughnessMap: Boolean(material?.roughnessMap),
    metalnessMap: Boolean(material?.metalnessMap),
    aoMap: Boolean(material?.aoMap),
    alphaMap: Boolean(material?.alphaMap),
  });
}

function collectTextureSizes(material) {
  const sizes = [];
  const imageFields = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap'];
  for (const field of imageFields) {
    const image = material?.[field]?.image;
    const width = Number(image?.width);
    const height = Number(image?.height);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      sizes.push({ width, height, field });
    }
  }
  return sizes;
}

function roleCounts(surfaces) {
  const counts = {};
  for (const surface of surfaces) {
    const role = classifySurface(surface);
    counts[role] = (counts[role] || 0) + 1;
  }
  return counts;
}

export function inspectPlayerSurfaceEvidence(root, { requireSharedValidation = true } = {}) {
  if (!root || typeof root !== 'object') {
    return Object.freeze({
      ok: false,
      errors: Object.freeze(['player-model-missing']),
      warnings: Object.freeze([]),
      meshCount: 0,
      surfaceCount: 0,
      textureBearingSurfaceCount: 0,
      roleCounts: Object.freeze({}),
      textureSizes: Object.freeze([]),
    });
  }
  const analysis = analyzeMaterialSurfaces(root);
  const validation = validateMaterialAssignment(root);
  const errors = [...validation.errors];
  const warnings = [...validation.warnings];
  if (requireSharedValidation && !validation.ok) errors.push('shared-material-validation-failed');

  const surfaces = analysis.surfaces.map((surface) => {
    const textures = materialTextureSlots(surface.material);
    return Object.freeze({
      key: surface.key,
      meshName: safeName(surface.meshName),
      materialName: safeName(surface.materialName),
      slot: safeName(surface.slot),
      role: classifySurface(surface),
      textures,
      textureCount: Object.values(textures).filter(Boolean).length,
      paletteId: surface.material?.userData?.paletteId || null,
    });
  });
  const textureBearingSurfaceCount = surfaces.filter((surface) => surface.textureCount > 0).length;
  const textureSizes = [];
  for (const surface of analysis.surfaces) textureSizes.push(...collectTextureSizes(surface.material));
  if (analysis.meshCount === 0) errors.push('no-player-meshes');
  if (analysis.surfaceCount === 0) errors.push('no-player-material-surfaces');
  if (textureBearingSurfaceCount === 0) warnings.push('no-authored-texture-slots-observed');
  if (analysis.meshCount === 1 && analysis.surfaceCount === 1 && textureBearingSurfaceCount === 0) warnings.push('single-surface-flat-material-risk');

  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze([...new Set(errors)]),
    warnings: Object.freeze([...new Set(warnings)]),
    meshCount: analysis.meshCount,
    surfaceCount: analysis.surfaceCount,
    uvMeshCount: analysis.uvMeshCount,
    namedSurfaceCount: analysis.namedSurfaceCount,
    textureBearingSurfaceCount,
    generatedMaterialCount: validation.generatedMaterialCount,
    materialSlotCount: validation.materialSlotCount,
    roleCounts: Object.freeze(roleCounts(surfaces)),
    surfaces: Object.freeze(surfaces),
    textureSizes: Object.freeze(textureSizes.map((size) => Object.freeze({ ...size }))),
  });
}

export function buildPlayerSurfaceManifest(root, metadata = {}) {
  const evidence = inspectPlayerSurfaceEvidence(root);
  return Object.freeze({
    version: 1,
    playerAssetId: String(metadata.id || ''),
    sourcePath: String(metadata.src || ''),
    meshCount: evidence.meshCount,
    surfaceCount: evidence.surfaceCount,
    textureBearingSurfaceCount: evidence.textureBearingSurfaceCount,
    roleCounts: evidence.roleCounts,
    textureSizes: evidence.textureSizes,
    surfaces: evidence.surfaces,
    validation: Object.freeze({
      ok: evidence.ok,
      errors: evidence.errors,
      warnings: evidence.warnings,
    }),
  });
}

export function hasLayeredPlayerSurfaceLanguage(evidence) {
  if (!evidence || typeof evidence !== 'object') return false;
  const roles = evidence.roleCounts || {};
  const roleHits = ['skin', 'hair', 'cloth', 'leather', 'metal', 'boot'].filter((role) => Number(roles[role]) > 0).length;
  return roleHits >= 2 || Number(evidence.surfaceCount) >= 2 || Number(evidence.textureBearingSurfaceCount) >= 2;
}

export function summarizePlayerSurfaceQuality(evidence) {
  const valid = Boolean(evidence?.ok);
  const layered = hasLayeredPlayerSurfaceLanguage(evidence);
  const textured = Number(evidence?.textureBearingSurfaceCount || 0) > 0;
  return Object.freeze({
    valid,
    layered,
    textured,
    visualFailure: !valid || (!layered && !textured),
    meshCount: Number(evidence?.meshCount || 0),
    surfaceCount: Number(evidence?.surfaceCount || 0),
    textureBearingSurfaceCount: Number(evidence?.textureBearingSurfaceCount || 0),
  });
}
