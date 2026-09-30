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
const SURFACE_ROLE_ORDER = Object.freeze(['skin', 'hair', 'cloth', 'leather', 'metal', 'boot']);
const TEXTURE_FIELDS = Object.freeze(['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap']);
const TEXTURE_POLICY = Object.freeze({ minDimension: 64, maxDimension: 2048, preferredSizes: Object.freeze([256, 512, 1024]) });

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
  for (const field of TEXTURE_FIELDS) {
    const image = material?.[field]?.image;
    const width = Number(image?.width);
    const height = Number(image?.height);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) sizes.push({ width, height, field });
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

function distinctPaletteIds(surfaces) {
  return [...new Set(surfaces.map((surface) => surface.paletteId).filter(Boolean).map(String))].sort();
}

function textureQuality(textureSizes) {
  const oversized = textureSizes.filter(({ width, height }) => Math.max(width, height) > TEXTURE_POLICY.maxDimension);
  const undersized = textureSizes.filter(({ width, height }) => Math.max(width, height) < TEXTURE_POLICY.minDimension);
  const preferred = textureSizes.filter(({ width, height }) => TEXTURE_POLICY.preferredSizes.includes(Math.max(width, height)) && width === height);
  return Object.freeze({
    count: textureSizes.length,
    oversizedCount: oversized.length,
    undersizedCount: undersized.length,
    preferredSizeCount: preferred.length,
    maxDimension: textureSizes.length ? Math.max(...textureSizes.map(({ width, height }) => Math.max(width, height))) : 0,
    minDimension: textureSizes.length ? Math.min(...textureSizes.map(({ width, height }) => Math.min(width, height))) : 0,
  });
}

export function inspectPlayerSurfaceEvidence(root, { requireSharedValidation = true } = {}) {
  if (!root || typeof root !== 'object') {
    return Object.freeze({ ok: false, errors: Object.freeze(['player-model-missing']), warnings: Object.freeze([]), meshCount: 0, surfaceCount: 0, textureBearingSurfaceCount: 0, roleCounts: Object.freeze({}), textureSizes: Object.freeze([]), paletteIds: Object.freeze([]), textureQuality: textureQuality([]) });
  }
  const analysis = analyzeMaterialSurfaces(root);
  const validation = validateMaterialAssignment(root);
  const errors = [...validation.errors]; const warnings = [...validation.warnings];
  if (requireSharedValidation && !validation.ok) errors.push('shared-material-validation-failed');

  const surfaces = analysis.surfaces.map((surface) => {
    const textures = materialTextureSlots(surface.material);
    return Object.freeze({ key: surface.key, meshName: safeName(surface.meshName), materialName: safeName(surface.materialName), slot: safeName(surface.slot), role: classifySurface(surface), textures, textureCount: Object.values(textures).filter(Boolean).length, paletteId: surface.material?.userData?.paletteId || null });
  });
  const textureBearingSurfaceCount = surfaces.filter((surface) => surface.textureCount > 0).length;
  const textureSizes = []; for (const surface of analysis.surfaces) textureSizes.push(...collectTextureSizes(surface.material));
  if (analysis.meshCount === 0) errors.push('no-player-meshes');
  if (analysis.surfaceCount === 0) errors.push('no-player-material-surfaces');
  if (textureBearingSurfaceCount === 0) warnings.push('no-authored-texture-slots-observed');
  if (analysis.meshCount === 1 && analysis.surfaceCount === 1 && textureBearingSurfaceCount === 0) warnings.push('single-surface-flat-material-risk');

  const quality = textureQuality(textureSizes);
  if (quality.oversizedCount) warnings.push('oversized-player-texture');
  if (quality.undersizedCount) warnings.push('undersized-player-texture');
  const paletteIds = distinctPaletteIds(surfaces);
  if (surfaces.length >= 3 && paletteIds.length <= 1) warnings.push('single-palette-multi-surface-risk');

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
    roleCoverage: Object.freeze(SURFACE_ROLE_ORDER.filter((role) => Number(roleCounts(surfaces)[role]) > 0)),
    paletteIds: Object.freeze(paletteIds),
    paletteCount: paletteIds.length,
    surfaces: Object.freeze(surfaces),
    textureSizes: Object.freeze(textureSizes.map((size) => Object.freeze({ ...size }))),
    textureQuality: quality,
  });
}

export function buildPlayerSurfaceManifest(root, metadata = {}) {
  const evidence = inspectPlayerSurfaceEvidence(root);
  return Object.freeze({
    version: 2,
    playerAssetId: String(metadata.id || ''), sourcePath: String(metadata.src || ''),
    meshCount: evidence.meshCount, surfaceCount: evidence.surfaceCount,
    textureBearingSurfaceCount: evidence.textureBearingSurfaceCount,
    roleCounts: evidence.roleCounts, roleCoverage: evidence.roleCoverage,
    paletteIds: evidence.paletteIds, paletteCount: evidence.paletteCount,
    textureSizes: evidence.textureSizes, textureQuality: evidence.textureQuality,
    surfaces: evidence.surfaces,
    validation: Object.freeze({ ok: evidence.ok, errors: evidence.errors, warnings: evidence.warnings }),
  });
}

export function hasLayeredPlayerSurfaceLanguage(evidence) {
  if (!evidence || typeof evidence !== 'object') return false;
  const roleHits = SURFACE_ROLE_ORDER.filter((role) => Number(evidence.roleCounts?.[role]) > 0).length;
  return roleHits >= 2 || Number(evidence.surfaceCount) >= 2 || Number(evidence.textureBearingSurfaceCount) >= 2;
}

export function scorePlayerSurfaceMaterialDiversity(evidence) {
  if (!evidence || typeof evidence !== 'object') return Object.freeze({ score: 0, roleScore: 0, textureScore: 0, paletteScore: 0, warnings: Object.freeze(['missing-evidence']) });
  const roleScore = Math.min(1, Number((evidence.roleCoverage?.length || 0) / 4));
  const textureScore = Math.min(1, Number(evidence.textureBearingSurfaceCount || 0) / Math.max(1, Number(evidence.surfaceCount || 1)));
  const paletteScore = Number(evidence.paletteCount || 0) >= 2 ? 1 : Number(evidence.surfaceCount || 0) <= 1 ? 0.5 : 0;
  const score = (roleScore * 0.45) + (textureScore * 0.35) + (paletteScore * 0.20);
  const warnings = [];
  if (roleScore < 0.5) warnings.push('insufficient-semantic-surface-roles');
  if (textureScore < 0.5) warnings.push('insufficient-textured-surfaces');
  if (paletteScore === 0) warnings.push('palette-diversity-missing');
  return Object.freeze({ score: Math.round(score * 1000) / 1000, roleScore: Math.round(roleScore * 1000) / 1000, textureScore: Math.round(textureScore * 1000) / 1000, paletteScore: Math.round(paletteScore * 1000) / 1000, warnings: Object.freeze(warnings) });
}

export function summarizePlayerSurfaceQuality(evidence) {
  const valid = Boolean(evidence?.ok); const layered = hasLayeredPlayerSurfaceLanguage(evidence); const textured = Number(evidence?.textureBearingSurfaceCount || 0) > 0; const diversity = scorePlayerSurfaceMaterialDiversity(evidence);
  return Object.freeze({ valid, layered, textured, visualFailure: !valid || (!layered && !textured), diversityScore: diversity.score, diversityWarnings: diversity.warnings, meshCount: Number(evidence?.meshCount || 0), surfaceCount: Number(evidence?.surfaceCount || 0), textureBearingSurfaceCount: Number(evidence?.textureBearingSurfaceCount || 0), paletteCount: Number(evidence?.paletteCount || 0) });
}

export { ROLE_RULES, SURFACE_ROLE_ORDER, TEXTURE_POLICY };
