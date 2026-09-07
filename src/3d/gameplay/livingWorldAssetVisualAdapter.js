/**
 * Şafak Kartalı — geography-aware actor visual adapter.
 *
 * This module is deliberately an adapter over the merged shared material/placement authorities.
 * It never imports EditorMaterialStudio.js, never replaces an authored source asset and never owns
 * spawning. Existing NPC/creature controllers can use it to prove that the model currently in the
 * Three.js scene has the expected semantic surfaces for its geographic role, and to request the
 * shared layered fallback only when an authored model is genuinely under-specified.
 */
import {
  analyzeMaterialSurfaces,
  autoAssignMaterials,
  buildRecommendedLayerRecipe,
  createMaterialManifest,
  validateMaterialAssignment,
} from '../materials/MaterialAssignmentCore.js';
import { auditWorldAssetPlacement } from '../world/WorldAssetPlacementPipeline.js';
import { resolveLivingWorldGeography, resolveLivingWorldAssetProfile } from './livingWorldGeographyAdapter.js';

export const LIVING_WORLD_VISUAL_POLICY = Object.freeze({
  id: 'living-world-actor-visual-2026-09-07-v1',
  deterministic: true,
  noSecondMaterialFramework: true,
  materialAuthority: 'MaterialAssignmentCore.js',
  placementAuthority: 'WorldAssetPlacementPipeline.js',
  editorMaterialStudioRuntimeImport: false,
  preserveAuthoredMaterialsWhenHealthy: true,
  layeredFallbackOnlyWhenUnderSpecified: true,
  semanticCoverageThreshold: 0.55,
  texturedMaterialRatioThreshold: 0.50,
  strongTexturedMaterialRatioThreshold: 0.80,
  minimumTextureDimension: 128,
  preferredTextureDimension: 512,
  mobilePreferredTextureDimension: 256,
});

export const LIVING_WORLD_ROLE_SURFACES = Object.freeze({
  human: Object.freeze(['skin', 'hair', 'eyes', 'clothing', 'boots', 'gear']),
  guard: Object.freeze(['skin', 'hair', 'eyes', 'clothing', 'boots', 'gear']),
  farmer: Object.freeze(['skin', 'hair', 'eyes', 'clothing', 'boots', 'gear']),
  companion: Object.freeze(['skin', 'hair', 'eyes', 'clothing', 'boots', 'gear']),
  horse: Object.freeze(['coat', 'mane', 'tail', 'hoof', 'saddle', 'harness']),
  wildlife: Object.freeze(['fur', 'eye', 'claw', 'tooth']),
  wolf: Object.freeze(['fur', 'eye', 'claw', 'tooth']),
  bear: Object.freeze(['fur', 'eye', 'claw', 'tooth']),
  deer: Object.freeze(['fur', 'eye', 'hoof', 'antler']),
  bison: Object.freeze(['fur', 'eye', 'hoof', 'horn']),
  sheep: Object.freeze(['fur', 'eye', 'hoof', 'horn']),
  cow: Object.freeze(['fur', 'eye', 'hoof', 'horn']),
  goat: Object.freeze(['fur', 'eye', 'hoof', 'horn']),
  fox: Object.freeze(['fur', 'eye', 'claw', 'tooth']),
  bird: Object.freeze(['feather', 'eye', 'beak', 'claw']),
  dragon: Object.freeze(['scale', 'wing', 'eye', 'horn', 'claw']),
  creature: Object.freeze(['fur', 'eye', 'claw', 'tooth']),
});

const SURFACE_ALIASES = Object.freeze({
  skin: Object.freeze(['skin', 'body', 'flesh', 'human']),
  hair: Object.freeze(['hair', 'beard', 'brow']),
  eyes: Object.freeze(['eye', 'eyes', 'iris', 'pupil']),
  clothing: Object.freeze(['cloth', 'clothing', 'shirt', 'tunic', 'robe', 'armor', 'dress', 'jacket', 'torso']),
  boots: Object.freeze(['boot', 'boots', 'shoe', 'shoes', 'foot', 'feet', 'leg']),
  gear: Object.freeze(['gear', 'belt', 'bag', 'weapon', 'shield', 'strap', 'equipment', 'metal']),
  coat: Object.freeze(['coat', 'body', 'hide', 'fur', 'horse']),
  mane: Object.freeze(['mane', 'neck-hair']),
  tail: Object.freeze(['tail']),
  hoof: Object.freeze(['hoof', 'hooves', 'foot', 'feet']),
  saddle: Object.freeze(['saddle', 'seat']),
  harness: Object.freeze(['harness', 'bridle', 'reins', 'halter']),
  fur: Object.freeze(['fur', 'pelt', 'hide', 'coat', 'body']),
  eye: Object.freeze(['eye', 'eyes', 'iris', 'pupil']),
  claw: Object.freeze(['claw', 'talon', 'nail', 'paw']),
  tooth: Object.freeze(['tooth', 'teeth', 'fang', 'mouth']),
  antler: Object.freeze(['antler', 'antlers']),
  horn: Object.freeze(['horn', 'horns']),
  feather: Object.freeze(['feather', 'feathers', 'plume', 'wing']),
  beak: Object.freeze(['beak', 'bill']),
  scale: Object.freeze(['scale', 'scales', 'hide', 'armor']),
  wing: Object.freeze(['wing', 'wings', 'membrane']),
});

const REGION_VISUAL_CLIMATE = Object.freeze({
  snow: Object.freeze({ cold: 1, wet: 0.55, dry: 0.15, volcanic: 0, paletteBias: 'snow', scale: 0.98 }),
  north: Object.freeze({ cold: 0.82, wet: 0.50, dry: 0.18, volcanic: 0, paletteBias: 'boreal', scale: 1 }),
  marsh: Object.freeze({ cold: 0.22, wet: 1, dry: 0.05, volcanic: 0, paletteBias: 'marsh', scale: 0.99 }),
  mountain: Object.freeze({ cold: 0.65, wet: 0.35, dry: 0.28, volcanic: 0.08, paletteBias: 'highland', scale: 0.99 }),
  westerlands: Object.freeze({ cold: 0.28, wet: 0.43, dry: 0.26, volcanic: 0, paletteBias: 'temperate', scale: 1 }),
  reach: Object.freeze({ cold: 0.18, wet: 0.40, dry: 0.20, volcanic: 0, paletteBias: 'fertile', scale: 1.01 }),
  desert: Object.freeze({ cold: 0.02, wet: 0.05, dry: 1, volcanic: 0.05, paletteBias: 'dorne', scale: 0.99 }),
  steppe: Object.freeze({ cold: 0.20, wet: 0.18, dry: 0.72, volcanic: 0, paletteBias: 'steppe', scale: 1.01 }),
  arid: Object.freeze({ cold: 0.04, wet: 0.08, dry: 0.92, volcanic: 0.18, paletteBias: 'red-waste', scale: 0.99 }),
  coast: Object.freeze({ cold: 0.16, wet: 0.72, dry: 0.24, volcanic: 0, paletteBias: 'maritime', scale: 1 }),
  jungle: Object.freeze({ cold: 0.02, wet: 0.95, dry: 0.08, volcanic: 0, paletteBias: 'jungle', scale: 1.02 }),
  valyria: Object.freeze({ cold: 0.02, wet: 0.04, dry: 0.65, volcanic: 1, paletteBias: 'volcanic', scale: 1.03 }),
  temperate: Object.freeze({ cold: 0.18, wet: 0.42, dry: 0.24, volcanic: 0, paletteBias: 'temperate', scale: 1 }),
});

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function listMaterials(material) {
  if (!material) return [];
  return Array.isArray(material) ? material.filter(Boolean) : [material];
}

function listMeshes(object) {
  const meshes = [];
  object?.traverse?.((node) => {
    if (node?.isMesh && !node?.isInstancedMesh) meshes.push(node);
  });
  return meshes;
}

function getRoleFamily({ role = 'guard', speciesId = null } = {}) {
  const normalizedSpecies = normalize(speciesId);
  if (normalizedSpecies && LIVING_WORLD_ROLE_SURFACES[normalizedSpecies]) return normalizedSpecies;
  const normalizedRole = normalize(role);
  if (normalizedRole === 'wildlife' || normalizedRole === 'creature') return 'wildlife';
  return normalizedRole && LIVING_WORLD_ROLE_SURFACES[normalizedRole] ? normalizedRole : 'human';
}

function expectedSurfacesFor({ role = 'guard', speciesId = null } = {}) {
  return [...(LIVING_WORLD_ROLE_SURFACES[getRoleFamily({ role, speciesId })] || LIVING_WORLD_ROLE_SURFACES.human)];
}

function textureDimension(texture) {
  const image = texture?.image || texture?.source?.data || texture?.source?.image || null;
  const width = Number(image?.width ?? image?.videoWidth ?? 0);
  const height = Number(image?.height ?? image?.videoHeight ?? 0);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height, min: Math.min(width, height), max: Math.max(width, height) }
    : null;
}

function textureSummary(texture) {
  if (!texture) return null;
  const size = textureDimension(texture);
  return {
    size,
    colorSpace: texture.colorSpace ?? null,
    flipY: texture.flipY ?? null,
    channel: texture.channel ?? null,
  };
}

function tokenScore(name, aliases) {
  const normalized = normalize(name);
  if (!normalized) return 0;
  let score = 0;
  for (const token of aliases || []) {
    const alias = normalize(token);
    if (!alias) continue;
    if (normalized === alias) score = Math.max(score, 1);
    else if (normalized.startsWith(`${alias}-`) || normalized.endsWith(`-${alias}`)) score = Math.max(score, 0.9);
    else if (normalized.includes(alias)) score = Math.max(score, 0.6);
  }
  return score;
}

function inferSurfaceRole(mesh, material, expected) {
  const name = `${mesh?.name || ''} ${material?.name || ''}`.trim();
  const ranked = expected
    .map((role) => ({ role, score: tokenScore(name, SURFACE_ALIASES[role] || [role]) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.role.localeCompare(b.role));
  return ranked[0] || { role: null, score: 0 };
}

function materialFeatures(material) {
  if (!material) return {
    baseColor: null, normal: null, roughness: null, metalness: null, ao: null, emissive: null, displacement: null,
  };
  return {
    baseColor: textureSummary(material.map ?? material.diffuseMap ?? null),
    normal: textureSummary(material.normalMap ?? null),
    roughness: textureSummary(material.roughnessMap ?? null),
    metalness: textureSummary(material.metalnessMap ?? null),
    ao: textureSummary(material.aoMap ?? null),
    emissive: textureSummary(material.emissiveMap ?? null),
    displacement: textureSummary(material.displacementMap ?? null),
  };
}

function semanticCoverage(entries, expected) {
  if (!expected.length) return 1;
  const covered = new Set(entries.filter((entry) => entry.role && entry.roleScore >= 0.6).map((entry) => entry.role));
  return covered.size / expected.length;
}

function textureCoverage(entries) {
  const materials = entries.length;
  if (!materials) return 0;
  return entries.filter((entry) => entry.features.baseColor).length / materials;
}

function normalCoverage(entries) {
  const materials = entries.length;
  if (!materials) return 0;
  return entries.filter((entry) => entry.features.normal).length / materials;
}

function preferredTextureDimension({ mobile = false } = {}) {
  return mobile ? LIVING_WORLD_VISUAL_POLICY.mobilePreferredTextureDimension : LIVING_WORLD_VISUAL_POLICY.preferredTextureDimension;
}

function textureQuality(entry, { mobile = false } = {}) {
  const preferred = preferredTextureDimension({ mobile });
  const size = entry?.features?.baseColor?.size?.min;
  if (!Number.isFinite(size)) return { score: 0, band: 'untextured' };
  if (size < LIVING_WORLD_VISUAL_POLICY.minimumTextureDimension) return { score: 0.15, band: 'undersized' };
  if (size < preferred) return { score: 0.60, band: 'usable' };
  if (size < preferred * 2) return { score: 0.90, band: 'preferred' };
  return { score: 1, band: 'high-resolution' };
}

function pbrScore(entry) {
  const features = entry?.features || {};
  const values = [features.baseColor, features.normal, features.roughness, features.metalness, features.ao].filter(Boolean);
  if (!values.length) return 0;
  let score = features.baseColor ? 0.45 : 0;
  if (features.normal) score += 0.20;
  if (features.roughness) score += 0.15;
  if (features.metalness) score += 0.10;
  if (features.ao) score += 0.10;
  return Math.min(1, score);
}

function roleMaterialHealth(entry, { mobile = false } = {}) {
  const texture = textureQuality(entry, { mobile });
  return {
    textureScore: texture.score,
    textureBand: texture.band,
    pbrScore: pbrScore(entry),
    hasBaseColor: Boolean(entry?.features?.baseColor),
    hasNormal: Boolean(entry?.features?.normal),
    hasRoughness: Boolean(entry?.features?.roughness),
    hasMetalness: Boolean(entry?.features?.metalness),
    hasAo: Boolean(entry?.features?.ao),
  };
}

function determineFallbackNeed({ validation, semanticScore, texturedRatio, entries }) {
  if (!validation?.ok) return 'validation-failure';
  if (semanticScore < LIVING_WORLD_VISUAL_POLICY.semanticCoverageThreshold) return 'semantic-under-specification';
  if (texturedRatio < LIVING_WORLD_VISUAL_POLICY.texturedMaterialRatioThreshold) return 'texture-under-specification';
  if (entries.length === 1 && texturedRatio === 0) return 'single-surface-untextured';
  return null;
}

function safeAssetPath(path) {
  return typeof path === 'string' && /^assets\/models\//.test(path) ? path : null;
}

export function geographicVisualClimate(region, {
  moisture = 0,
  waterDepth = 0,
  slopeDegrees = 0,
  dayTemperatureBias = 0,
} = {}) {
  const base = REGION_VISUAL_CLIMATE[normalize(region)] || REGION_VISUAL_CLIMATE.temperate;
  const wetness = clamp(base.wet + Math.max(0, finite(moisture)) * 0.35 + Math.max(0, finite(waterDepth)) * 0.4, 0, 1);
  const exposure = clamp(Math.abs(finite(slopeDegrees)) / 45, 0, 1);
  const cold = clamp(base.cold + (-finite(dayTemperatureBias) * 0.08) + exposure * 0.08, 0, 1);
  const dry = clamp(base.dry + Math.max(0, 1 - wetness) * 0.15, 0, 1);
  return Object.freeze({
    region: normalize(region) || 'temperate',
    cold: Number(cold.toFixed(3)),
    wet: Number(wetness.toFixed(3)),
    dry: Number(dry.toFixed(3)),
    volcanic: base.volcanic,
    paletteBias: base.paletteBias,
    scaleBias: base.scale,
    exposure: Number(exposure.toFixed(3)),
  });
}

export function resolveLivingWorldVisualContext({
  worldX = 0,
  worldZ = 0,
  role = 'guard',
  speciesId = null,
  groundHeight = null,
  slopeDegrees = 0,
  waterDepth = 0,
  settlementDistance = Infinity,
  roadDistance = Infinity,
  moisture = 0,
  dayTemperatureBias = 0,
  seed = 0x51afac,
} = {}) {
  const geography = resolveLivingWorldGeography({
    worldX,
    worldZ,
    role,
    speciesId,
    groundHeight,
    slopeDegrees,
    waterDepth,
    settlementDistance,
    roadDistance,
    seed,
  });
  const climate = geographicVisualClimate(geography.region, { moisture, waterDepth, slopeDegrees, dayTemperatureBias });
  const profile = resolveLivingWorldAssetProfile({ worldX, worldZ, role, speciesId });
  const authoredCandidates = (profile?.assetCandidates || []).map(safeAssetPath).filter(Boolean);
  return Object.freeze({
    ok: geography.ok,
    region: geography.region,
    reason: geography.reason,
    profileId: geography.profileId,
    normalizedReference: geography.normalizedReference,
    climate,
    expectedSurfaces: expectedSurfacesFor({ role, speciesId }),
    assetCandidates: authoredCandidates,
    assetFamily: profile?.family || getRoleFamily({ role, speciesId }),
    habitat: profile?.habitat || null,
  });
}

export function inspectLivingWorldAssetVisual(object, {
  role = 'guard',
  speciesId = null,
  region = 'temperate',
  mobile = false,
  requireGeneratedTexture = false,
  sourcePath = null,
  assetId = null,
} = {}) {
  const expected = expectedSurfacesFor({ role, speciesId });
  const analysis = analyzeMaterialSurfaces(object);
  const entries = [];
  for (const mesh of analysis.meshes) {
    const materials = listMaterials(mesh.material);
    materials.forEach((material, materialIndex) => {
      const roleMatch = inferSurfaceRole(mesh, material, expected);
      const health = roleMaterialHealth({ features: materialFeatures(material) }, { mobile });
      entries.push({
        meshName: mesh.name || '',
        materialName: material?.name || '',
        materialIndex,
        role: roleMatch.role,
        roleScore: roleMatch.score,
        generatedByFactory: Boolean(material?.userData?.generatedByTextureFactory),
        layeredMaterial: Boolean(material?.userData?.layeredMaterial),
        features: materialFeatures(material),
        ...health,
      });
    });
  }

  const validation = validateMaterialAssignment(object, { requireGeneratedTexture });
  const semanticScore = semanticCoverage(entries, expected);
  const texturedRatio = textureCoverage(entries);
  const normalRatio = normalCoverage(entries);
  const climate = geographicVisualClimate(region);
  const fallbackReason = determineFallbackNeed({ validation, semanticScore, texturedRatio, entries });
  const presentRoles = [...new Set(entries.map((entry) => entry.role).filter(Boolean))].sort();
  const missingRoles = expected.filter((expectedRole) => !presentRoles.includes(expectedRole));
  const averageTextureQuality = entries.length
    ? entries.reduce((sum, entry) => sum + entry.textureScore, 0) / entries.length
    : 0;
  const averagePbrScore = entries.length
    ? entries.reduce((sum, entry) => sum + entry.pbrScore, 0) / entries.length
    : 0;

  return Object.freeze({
    policyId: LIVING_WORLD_VISUAL_POLICY.id,
    ok: validation.ok,
    role: getRoleFamily({ role, speciesId }),
    speciesId: speciesId || null,
    region: normalize(region) || 'temperate',
    climate,
    expectedSurfaces: expected,
    presentRoles,
    missingRoles,
    semanticCoverage: Number(semanticScore.toFixed(3)),
    texturedMaterialRatio: Number(texturedRatio.toFixed(3)),
    normalMappedMaterialRatio: Number(normalRatio.toFixed(3)),
    averageTextureQuality: Number(averageTextureQuality.toFixed(3)),
    averagePbrScore: Number(averagePbrScore.toFixed(3)),
    meshCount: analysis.meshCount,
    surfaceCount: analysis.surfaceCount,
    materialSlotCount: entries.length,
    generatedMaterialCount: validation.generatedMaterialCount,
    warnings: [...validation.warnings],
    errors: [...validation.errors],
    fallbackReason,
    sourcePath: sourcePath || null,
    assetId: assetId || object?.userData?.assetId || null,
    surfaces: entries,
  });
}

export function shouldPreserveAuthoredVisuals(audit) {
  if (!audit?.ok) return false;
  if (audit.fallbackReason) return false;
  return audit.semanticCoverage >= LIVING_WORLD_VISUAL_POLICY.semanticCoverageThreshold
    && audit.texturedMaterialRatio >= LIVING_WORLD_VISUAL_POLICY.strongTexturedMaterialRatioThreshold;
}

export function prepareLivingWorldAssetVisual(object, {
  role = 'guard',
  speciesId = null,
  region = 'temperate',
  paletteId = null,
  textureSize = null,
  mobile = false,
  allowLayeredFallback = true,
  requireGeneratedTexture = false,
  metadata = {},
} = {}) {
  if (!object) return { ok: false, error: 'missing-object' };
  const before = inspectLivingWorldAssetVisual(object, {
    role, speciesId, region, mobile, requireGeneratedTexture,
    sourcePath: metadata.src, assetId: metadata.id,
  });
  if (shouldPreserveAuthoredVisuals(before)) {
    return { ok: true, status: 'authored-preserved', before, after: before, changed: false };
  }

  if (!allowLayeredFallback) {
    return { ok: false, error: before.fallbackReason || 'visual-quality-below-threshold', before, after: before, changed: false };
  }

  const targetTextureSize = textureSize || preferredTextureDimension({ mobile });
  let operation = null;
  if (before.meshCount === 1 && before.materialSlotCount === 1) {
    const recipe = buildRecommendedLayerRecipe(object, {
      metadata,
      paletteId,
      textureSize: targetTextureSize,
      targetMeshIndex: 0,
    });
    if (!recipe) {
      return { ok: false, error: 'layered-fallback-recipe-unavailable', before, after: before, changed: false };
    }
    operation = { mode: 'layers', recipe };
  } else {
    const result = autoAssignMaterials(object, { metadata, paletteId, textureSize: targetTextureSize });
    if (!result?.ok) {
      return { ok: false, error: `auto-dressing:${result?.error || 'failed'}`, before, after: before, changed: false };
    }
    operation = { mode: 'auto', recipe: result.recipe, result };
  }

  const after = inspectLivingWorldAssetVisual(object, {
    role, speciesId, region, mobile, requireGeneratedTexture,
    sourcePath: metadata.src, assetId: metadata.id,
  });
  return Object.freeze({
    ok: after.ok && !after.fallbackReason,
    status: operation.mode === 'layers' ? 'shared-layered-fallback' : 'shared-auto-dressing',
    before,
    after,
    changed: true,
    operation,
  });
}

export function createLivingWorldVisualManifest(object, {
  role = 'guard',
  speciesId = null,
  region = 'temperate',
  placement = null,
  metadata = {},
} = {}) {
  const audit = inspectLivingWorldAssetVisual(object, { role, speciesId, region, sourcePath: metadata.src, assetId: metadata.id });
  const materialManifest = createMaterialManifest(object, { metadata, placement });
  return Object.freeze({
    version: 1,
    policyId: LIVING_WORLD_VISUAL_POLICY.id,
    asset: {
      id: metadata.id || object?.userData?.assetId || null,
      src: metadata.src || object?.userData?.assetSrc || null,
      role: audit.role,
      speciesId: speciesId || null,
      region: audit.region,
    },
    geographicVisual: {
      climate: audit.climate,
      expectedSurfaces: audit.expectedSurfaces,
      semanticCoverage: audit.semanticCoverage,
      texturedMaterialRatio: audit.texturedMaterialRatio,
      normalMappedMaterialRatio: audit.normalMappedMaterialRatio,
      averageTextureQuality: audit.averageTextureQuality,
      averagePbrScore: audit.averagePbrScore,
    },
    surfaces: audit.surfaces.map((surface) => ({
      meshName: surface.meshName,
      materialName: surface.materialName,
      role: surface.role,
      roleScore: surface.roleScore,
      baseColor: surface.features.baseColor,
      normal: surface.features.normal,
      roughness: surface.features.roughness,
      metalness: surface.features.metalness,
      ao: surface.features.ao,
      generatedByFactory: surface.generatedByFactory,
      layeredMaterial: surface.layeredMaterial,
    })),
    materialManifest,
    validation: {
      ok: audit.ok,
      errors: [...audit.errors],
      warnings: [...audit.warnings],
      fallbackReason: audit.fallbackReason,
    },
  });
}

export function auditLivingWorldVisualPlacement(object, {
  role = 'guard',
  speciesId = null,
  region = 'temperate',
  metadata = {},
} = {}) {
  const visual = inspectLivingWorldAssetVisual(object, { role, speciesId, region, sourcePath: metadata.src, assetId: metadata.id });
  const placement = auditWorldAssetPlacement(object);
  return Object.freeze({
    ok: visual.ok && placement.ok,
    visual,
    placement,
    errors: [...visual.errors, ...placement.errors.map((error) => `placement:${error}`)],
    warnings: [...visual.warnings, ...placement.warnings.map((warning) => `placement:${warning}`)],
  });
}

export function applyLivingWorldVisualMetadata(object, {
  role = 'guard',
  speciesId = null,
  region = 'temperate',
  climate = null,
  sourcePath = null,
  assetId = null,
} = {}) {
  if (!object) return null;
  const resolvedClimate = climate || geographicVisualClimate(region);
  object.userData ||= {};
  object.userData.livingWorldVisual = {
    policyId: LIVING_WORLD_VISUAL_POLICY.id,
    role: getRoleFamily({ role, speciesId }),
    speciesId: speciesId || null,
    region: normalize(region) || 'temperate',
    climate: resolvedClimate,
    sourcePath: sourcePath || object.userData.assetSrc || null,
    assetId: assetId || object.userData.assetId || null,
  };
  return object.userData.livingWorldVisual;
}

export function buildLivingWorldVisualEvidence(object, context = {}) {
  const visualContext = resolveLivingWorldVisualContext(context);
  const audit = inspectLivingWorldAssetVisual(object, {
    role: context.role,
    speciesId: context.speciesId,
    region: visualContext.region,
    mobile: context.mobile,
    sourcePath: context.sourcePath,
    assetId: context.assetId,
  });
  const manifest = createLivingWorldVisualManifest(object, {
    role: context.role,
    speciesId: context.speciesId,
    region: visualContext.region,
    placement: context.placement,
    metadata: { id: context.assetId, src: context.sourcePath },
  });
  return Object.freeze({
    ok: audit.ok,
    geography: visualContext,
    visual: audit,
    manifest,
    acceptance: {
      missingAsset: !(context.sourcePath || visualContext.assetCandidates.length),
      sourcePathIsRepositoryAsset: Boolean(safeAssetPath(context.sourcePath)),
      semanticCoveragePass: audit.semanticCoverage >= LIVING_WORLD_VISUAL_POLICY.semanticCoverageThreshold,
      textureCoveragePass: audit.texturedMaterialRatio >= LIVING_WORLD_VISUAL_POLICY.texturedMaterialRatioThreshold,
      authoredPreserved: shouldPreserveAuthoredVisuals(audit),
      fallbackApplied: Boolean(object?.userData?.materialRecipe || object?.userData?.editorMaterialRecipe),
    },
  });
}

export function deterministicVisualVariant({ assetId = '', speciesId = '', region = '', worldSeed = 0x51afac } = {}) {
  let hash = 2166136261;
  const input = `${worldSeed}:${assetId}:${speciesId}:${region}`;
  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function chooseVisualPaletteHint({ region = 'temperate', speciesId = null } = {}) {
  const normalizedRegion = normalize(region);
  const climate = REGION_VISUAL_CLIMATE[normalizedRegion] || REGION_VISUAL_CLIMATE.temperate;
  const species = normalize(speciesId);
  const suffix = species ? `${climate.paletteBias}-${species}` : climate.paletteBias;
  return Object.freeze({
    region: normalizedRegion || 'temperate',
    speciesId: species || null,
    paletteHint: climate.paletteBias,
    deterministicVariantKey: suffix,
  });
}

export function visualSurfaceRoleReport(audit) {
  const expected = audit?.expectedSurfaces || [];
  const entries = audit?.surfaces || [];
  return Object.freeze(expected.map((role) => {
    const matches = entries.filter((entry) => entry.role === role);
    return {
      role,
      present: matches.length > 0,
      materialCount: matches.length,
      texturedCount: matches.filter((entry) => entry.hasBaseColor).length,
      normalMappedCount: matches.filter((entry) => entry.hasNormal).length,
      averagePbrScore: matches.length ? Number((matches.reduce((sum, entry) => sum + entry.pbrScore, 0) / matches.length).toFixed(3)) : 0,
    };
  }));
}

export function visualAuditSummary(audit) {
  return Object.freeze({
    ok: Boolean(audit?.ok),
    role: audit?.role || null,
    speciesId: audit?.speciesId || null,
    region: audit?.region || null,
    meshes: audit?.meshCount ?? 0,
    materials: audit?.materialSlotCount ?? 0,
    semanticCoverage: audit?.semanticCoverage ?? 0,
    texturedMaterialRatio: audit?.texturedMaterialRatio ?? 0,
    normalMappedMaterialRatio: audit?.normalMappedMaterialRatio ?? 0,
    averageTextureQuality: audit?.averageTextureQuality ?? 0,
    averagePbrScore: audit?.averagePbrScore ?? 0,
    missingRoles: [...(audit?.missingRoles || [])],
    fallbackReason: audit?.fallbackReason || null,
    sourcePath: audit?.sourcePath || null,
  });
}

export function validateLivingWorldVisualContract({ audit, placementAudit = null, sourcePath = null } = {}) {
  const errors = [];
  const warnings = [];
  if (!audit?.ok) errors.push('visual-validation-failed');
  if (audit?.semanticCoverage < LIVING_WORLD_VISUAL_POLICY.semanticCoverageThreshold) errors.push('semantic-surface-coverage');
  if (audit?.texturedMaterialRatio < LIVING_WORLD_VISUAL_POLICY.texturedMaterialRatioThreshold) warnings.push('textured-material-coverage');
  if (!sourcePath && !(audit?.assetId || audit?.sourcePath)) warnings.push('source-path-missing');
  if (sourcePath && !safeAssetPath(sourcePath)) errors.push('asset-outside-repository-model-root');
  if (placementAudit && !placementAudit.ok) errors.push('placement-contract-failed');
  return Object.freeze({
    ok: errors.length === 0,
    errors,
    warnings,
    policyId: LIVING_WORLD_VISUAL_POLICY.id,
    materialAuthority: LIVING_WORLD_VISUAL_POLICY.materialAuthority,
    placementAuthority: LIVING_WORLD_VISUAL_POLICY.placementAuthority,
  });
}

export function deriveActorVisualEvidence({
  object,
  role,
  speciesId,
  worldX,
  worldZ,
  slopeDegrees,
  waterDepth,
  settlementDistance,
  roadDistance,
  moisture,
  dayTemperatureBias,
  seed,
  mobile,
  metadata = {},
  placement = null,
} = {}) {
  const context = resolveLivingWorldVisualContext({
    worldX, worldZ, role, speciesId, slopeDegrees, waterDepth, settlementDistance, roadDistance, moisture,
    dayTemperatureBias, seed,
  });
  const visualAudit = inspectLivingWorldAssetVisual(object, {
    role, speciesId, region: context.region, mobile, sourcePath: metadata.src, assetId: metadata.id,
  });
  const manifest = createLivingWorldVisualManifest(object, {
    role, speciesId, region: context.region, placement, metadata,
  });
  const placementAudit = object?.userData?.materialReadyForWorld ? auditWorldAssetPlacement(object) : null;
  const contract = validateLivingWorldVisualContract({ audit: visualAudit, placementAudit, sourcePath: metadata.src });
  return Object.freeze({
    ok: contract.ok && context.ok,
    geography: context,
    visual: visualAudit,
    placement: placementAudit,
    contract,
    manifest,
  });
}

export function listAssetCandidatesWithSurfaceExpectations({
  worldX = 0,
  worldZ = 0,
  role = 'guard',
  speciesId = null,
} = {}) {
  const context = resolveLivingWorldVisualContext({ worldX, worldZ, role, speciesId });
  return Object.freeze(context.assetCandidates.map((sourcePath, index) => ({
    index,
    sourcePath,
    role: getRoleFamily({ role, speciesId }),
    expectedSurfaces: [...context.expectedSurfaces],
    region: context.region,
    profileId: context.profileId,
    climate: context.climate,
  })));
}

export function geographicVisualTags({ region = 'temperate', role = 'guard', speciesId = null } = {}) {
  const climate = geographicVisualClimate(region);
  const family = getRoleFamily({ role, speciesId });
  const tags = new Set([family, normalize(region) || 'temperate', climate.paletteBias]);
  if (climate.cold >= 0.7) tags.add('cold-weather');
  if (climate.wet >= 0.7) tags.add('wet-surface');
  if (climate.dry >= 0.7) tags.add('dry-surface');
  if (climate.volcanic >= 0.7) tags.add('volcanic-exposure');
  return Object.freeze([...tags].sort());
}

export function visualDistributionWeight({ region = 'temperate', speciesId = null, role = 'guard' } = {}) {
  const climate = geographicVisualClimate(region);
  const family = getRoleFamily({ role, speciesId });
  const familyBias = family === 'dragon' ? (climate.volcanic * 0.7 + climate.dry * 0.3) : family === 'horse' ? (1 - climate.cold * 0.6) : family === 'wildlife' ? (1 - climate.volcanic * 0.3) : 1;
  return Number(clamp(familyBias, 0.05, 1).toFixed(3));
}

export function mergeVisualContextIntoActorMetadata(object, context = {}) {
  if (!object) return null;
  const visualContext = resolveLivingWorldVisualContext(context);
  object.userData ||= {};
  object.userData.livingWorldVisualContext = visualContext;
  object.userData.livingWorldVisualTags = geographicVisualTags(context);
  object.userData.livingWorldVisualVariant = deterministicVisualVariant({
    assetId: context.assetId || object.userData.assetId,
    speciesId: context.speciesId,
    region: visualContext.region,
    worldSeed: context.seed,
  });
  return object.userData.livingWorldVisualContext;
}
