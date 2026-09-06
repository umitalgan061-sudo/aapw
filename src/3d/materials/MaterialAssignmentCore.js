import { matchPalette } from './textureMatcher.js';
import { findPalette } from './palettes.js';
import { applyKitToObject, getPaletteMaterial } from './textureFactory.js';
import { surveyParts } from './meshPartClassifier.js';
import { kitForPalette, resolveKit } from './figureKits.js';
import { createLayeredMaterial, meshHeightRange, MAX_BANDS } from './layeredMaterial.js';
import { hashString } from './textureCore.js';
import { applyWorldMaterialSurfaceFabric } from './worldMaterialSurfaceFabric.js';

/**
 * Shared, DOM-free material pipeline used by both editor tooling and autonomous world builders.
 * The editor may add UI around these functions, but material decisions and application live here.
 */

export function describeMaterialSubject(object, metadata = {}) {
  return {
    id: metadata.id || object?.userData?.editorAssetId || object?.userData?.assetId || '',
    name: metadata.name || object?.name || '',
    category: metadata.category || object?.userData?.assetCategory || '',
    src: metadata.src || object?.userData?.assetSrc || object?.userData?.sourcePath || '',
  };
}

export function collectMaterialMeshes(root) {
  const meshes = [];
  root?.traverse?.((child) => {
    if (child?.isMesh && !child.isInstancedMesh) meshes.push(child);
  });
  return meshes;
}

export function analyzeMaterialSurfaces(root) {
  const meshes = collectMaterialMeshes(root);
  const survey = surveyParts(root);
  const surfaces = survey.map((surface) => {
    const meshIndex = meshes.indexOf(surface.mesh);
    const materials = Array.isArray(surface.mesh.material) ? surface.mesh.material : [surface.mesh.material];
    return {
      ...surface,
      meshIndex,
      key: `m${meshIndex}:s${surface.materialIndex}`,
      material: materials[surface.materialIndex] || null,
    };
  }).filter((surface) => surface.meshIndex >= 0);

  return {
    meshes,
    surfaces,
    meshCount: meshes.length,
    surfaceCount: surfaces.length,
    uvMeshCount: meshes.filter((mesh) => Boolean(mesh.geometry?.attributes?.uv)).length,
    namedSurfaceCount: surfaces.filter((surface) => Boolean(surface.slot)).length,
    placeholder: Boolean(root?.userData?.isPlaceholder || meshes.some((mesh) => mesh.userData?.isPlaceholder)),
  };
}

export function buildAutoMaterialRecipe(object, {
  metadata = {},
  paletteId,
  textureSize = 256,
} = {}) {
  const subject = describeMaterialSubject(object, metadata);
  const match = paletteId ? null : matchPalette(subject);
  const chosen = paletteId || match?.paletteId;
  if (!findPalette(chosen)) return null;
  return {
    version: 1,
    mode: 'auto',
    basePaletteId: chosen,
    textureSize: clampTextureSize(textureSize),
    reason: paletteId ? 'explicit' : match?.reason || 'matched',
  };
}

export function buildRecommendedLayerRecipe(object, {
  metadata = {},
  paletteId,
  textureSize = 256,
  targetMeshIndex = 0,
} = {}) {
  const auto = buildAutoMaterialRecipe(object, { metadata, paletteId, textureSize });
  if (!auto) return null;
  const palette = findPalette(auto.basePaletteId);
  const kit = kitForPalette(palette);
  if (!kit?.bands?.length) return null;
  const seed = hashString(`${object?.userData?.editorId || object?.userData?.assetId || object?.name || 'asset'}|shared-material-core`);
  const resolved = resolveKit(kit, seed);
  return {
    version: 1,
    mode: 'layers',
    basePaletteId: auto.basePaletteId,
    textureSize: clampTextureSize(textureSize),
    targetMeshIndex,
    layers: resolved.bands.slice(0, MAX_BANDS).map((band) => ({ to: band.to, palette: band.palette })),
  };
}

export function applyMaterialRecipe(object, recipe, { metadata = {} } = {}) {
  if (!object || !recipe) return { ok: false, error: 'missing-object-or-recipe' };
  let result = null;
  if (recipe.mode === 'auto') result = applyAutoRecipe(object, recipe, metadata);
  else if (recipe.mode === 'surface') result = applySurfaceRecipe(object, recipe);
  else if (recipe.mode === 'layers') result = applyLayerRecipe(object, recipe);
  else return { ok: false, error: `unsupported-mode:${recipe.mode}` };

  if (result.ok) {
    object.userData.materialRecipe = cloneRecipe(recipe);
    object.userData.editorMaterialRecipe = cloneRecipe(recipe);
    const subject = describeMaterialSubject(object, metadata);
    const variant = object.userData?.editorId || object.userData?.assetId || subject.id || subject.name || object.name || 'asset';
    const fabric = applyWorldMaterialSurfaceFabric(object, {
      paletteId: recipe.basePaletteId || result.paletteId || '',
      subject,
      variant,
    });
    result.worldMaterialSurfaceFabric = fabric;
  }
  return result;
}

export function autoAssignMaterials(object, options = {}) {
  const recipe = buildAutoMaterialRecipe(object, options);
  if (!recipe) return { ok: false, error: 'no-palette-match' };
  return { ...applyMaterialRecipe(object, recipe, options), recipe };
}

function applyAutoRecipe(object, recipe, metadata) {
  rememberOriginalMaterials(object);
  const subject = describeMaterialSubject(object, metadata);
  const variant = object.userData?.editorId || object.userData?.assetId || subject.id || subject.name || '';
  const size = clampTextureSize(recipe.textureSize);
  const applied = applyKitToObject(object, recipe.basePaletteId, {
    variant,
    size,
    layeredSize: size,
  });
  if (!applied.ok) return { ok: false, error: 'no-dressable-mesh' };
  object.userData.autoTexturePaletteId = recipe.basePaletteId;
  return {
    ok: true,
    mode: 'auto',
    paletteId: recipe.basePaletteId,
    meshes: applied.named + applied.banded + applied.main + applied.plain,
    ...applied,
  };
}

function applySurfaceRecipe(object, recipe) {
  const analysis = analyzeMaterialSurfaces(object);
  const size = clampTextureSize(recipe.textureSize);
  const pending = new Map();
  let applied = 0;

  for (const surface of analysis.surfaces) {
    const paletteId = recipe.surfaceOverrides?.[surface.key];
    if (!findPalette(paletteId)) continue;
    if (!pending.has(surface.mesh)) {
      pending.set(surface.mesh, Array.isArray(surface.mesh.material) ? [...surface.mesh.material] : [surface.mesh.material]);
    }
    const variant = `${object.userData?.editorId || object.userData?.assetId || object.name || 'asset'}:${surface.key}`;
    const material = getPaletteMaterial(paletteId, { size, variant });
    if (!material) continue;
    pending.get(surface.mesh)[surface.materialIndex] = material;
    applied += 1;
  }

  for (const [mesh, materials] of pending) {
    rememberOriginalMaterial(mesh);
    mesh.material = materials.length === 1 ? materials[0] : materials;
  }
  return { ok: applied > 0, mode: 'surface', surfaces: applied };
}

function applyLayerRecipe(object, recipe) {
  const meshes = collectMaterialMeshes(object);
  const mesh = meshes[Number(recipe.targetMeshIndex) || 0];
  if (!mesh || !Array.isArray(recipe.layers) || !recipe.layers.length) {
    return { ok: false, error: 'invalid-layer-target' };
  }
  const range = meshHeightRange(mesh);
  if (!range) return { ok: false, error: 'missing-height-range' };
  const material = createLayeredMaterial({
    bands: recipe.layers.slice(0, MAX_BANDS),
    heightRange: range,
    variant: `${object.userData?.editorId || object.userData?.assetId || object.name || 'asset'}:shared`,
    size: clampTextureSize(recipe.textureSize),
  });
  if (!material) return { ok: false, error: 'layer-material-failed' };
  rememberOriginalMaterial(mesh);
  mesh.material = material;
  return { ok: true, mode: 'layers', layers: Math.min(recipe.layers.length, MAX_BANDS), mesh };
}

export function restoreOriginalMaterials(root) {
  if (!root) return 0;
  let restored = 0;
  root.traverse?.((child) => {
    if (!child?.isMesh && !child?.isInstancedMesh) return;
    if (child.userData?.originalMaterial === undefined) return;
    child.material = child.userData.originalMaterial;
    delete child.userData.autoTexturePaletteId;
    restored += 1;
  });
  if (restored) {
    delete root.userData.autoTexturePaletteId;
    delete root.userData.materialRecipe;
    delete root.userData.editorMaterialRecipe;
    delete root.userData.worldMaterialSurfaceFabric;
  }
  return restored;
}

export function validateMaterialAssignment(root, { requireGeneratedTexture = false } = {}) {
  const analysis = analyzeMaterialSurfaces(root);
  const errors = [];
  const warnings = [];
  if (analysis.placeholder) errors.push('placeholder-model');
  if (!analysis.meshCount) errors.push('no-renderable-mesh');
  if (analysis.uvMeshCount < analysis.meshCount) warnings.push('mesh-without-uv');

  let generated = 0;
  let materialSlots = 0;
  for (const mesh of analysis.meshes) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materialSlots += materials.length;
    for (const material of materials) {
      if (material?.userData?.generatedByTextureFactory || material?.userData?.layeredMaterial) generated += 1;
    }
  }
  if (requireGeneratedTexture && generated === 0) errors.push('no-generated-material');
  if (analysis.meshCount === 1 && materialSlots === 1 && generated === 0) warnings.push('single-surface-untextured-risk');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    ...analysis,
    generatedMaterialCount: generated,
    materialSlotCount: materialSlots,
  };
}

export function createMaterialManifest(object, { metadata = {}, placement = null } = {}) {
  const validation = validateMaterialAssignment(object);
  return {
    version: 1,
    asset: describeMaterialSubject(object, metadata),
    recipe: cloneRecipe(object?.userData?.materialRecipe || object?.userData?.editorMaterialRecipe || null),
    surfaces: validation.surfaces.map((surface) => ({
      key: surface.key,
      mesh: surface.meshName,
      material: surface.materialName,
      slot: surface.slot,
      paletteId: surface.material?.userData?.paletteId || null,
      worldSurfaceProfile: surface.material?.userData?.worldMaterialSurfaceFabric?.profileId || null,
    })),
    placement: placement ? { ...placement } : null,
    worldMaterialSurfaceFabric: object?.userData?.worldMaterialSurfaceFabric || null,
    validation: {
      ok: validation.ok,
      errors: [...validation.errors],
      warnings: [...validation.warnings],
      meshCount: validation.meshCount,
      surfaceCount: validation.surfaceCount,
      generatedMaterialCount: validation.generatedMaterialCount,
    },
  };
}

function rememberOriginalMaterials(root) {
  root?.traverse?.((child) => {
    if (!child?.isMesh && !child?.isInstancedMesh) return;
    rememberOriginalMaterial(child);
  });
}

function rememberOriginalMaterial(mesh) {
  mesh.userData ||= {};
  if (mesh.userData.originalMaterial === undefined) mesh.userData.originalMaterial = mesh.material;
}

function clampTextureSize(value) {
  const size = Number(value) || 256;
  if (size <= 128) return 128;
  if (size <= 256) return 256;
  return 512;
}

function cloneRecipe(value) {
  if (!value) return null;
  try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
}
